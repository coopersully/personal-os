use crate::{
    desktop::DesktopState,
    transport::{send, ApiRequest},
};
use serde_json::{json, Value};
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;
pub fn show(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        let _ = app.set_dock_visibility(true);
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
pub fn hide(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        let _ = app.set_dock_visibility(false);
    }
}
pub fn safe_route(path: &str) -> bool {
    if path.contains(['\\', '#', '\r', '\n']) || path.contains("..") {
        return false;
    }
    let route = path.split('?').next().unwrap_or("");
    [
        "/today",
        "/tasks",
        "/reminders",
        "/calendar",
        "/settings",
        "/finances",
        "/mail",
        "/goals",
        "/motives",
    ]
    .iter()
    .any(|root| route == *root || route.starts_with(&format!("{root}/")))
}
pub async fn forward(app: &tauri::AppHandle, value: Value) {
    *app.state::<DesktopState>().pending_action.lock().await = Some(value);
    let _ = app.emit("desktop-action", ());
}
pub fn deep_link(app: &tauri::AppHandle, url: url::Url) {
    if url.scheme() != "ilo" || !url.username().is_empty() || url.password().is_some() {
        return;
    }
    let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    let value = match url.host_str() {
        Some("open") => {
            json!({"action":"open","path":params.get("path").map(String::as_str).unwrap_or("/today")})
        }
        Some("join") => {
            json!({"action":"join","url":params.get("url"),"serverUrl":params.get("serverUrl"),"accountId":params.get("accountId")})
        }
        _ => return,
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        action(app, value).await;
    });
}
pub async fn action(app: tauri::AppHandle, value: Value) {
    let action = value["action"].as_str().unwrap_or("");
    if matches!(action, "complete" | "join") {
        let state = app.state::<DesktopState>();
        let settings = state.settings.lock().await;
        if value["serverUrl"].as_str() != Some(settings.server_url.as_str()) {
            return;
        }
        let account = state.account_id.lock().await;
        if action == "join" && account.is_none() {
            *state.deferred_action.lock().await = Some((std::time::Instant::now(), value.clone()));
            state.refresh.notify_one();
            show(&app);
            return;
        }
        if value["accountId"].as_str() != account.as_deref() {
            return;
        }
    }
    match action {
        "open" => {
            if let Some(path) = value["path"].as_str().filter(|p| safe_route(p)) {
                show(&app);
                forward(&app, json!({"action":"open","path":path})).await;
            }
        }
        "capture" => {
            if ["task", "reminder", "event"].contains(&value["kind"].as_str().unwrap_or("")) {
                show(&app);
                forward(&app, value).await;
            }
        }
        "join" => {
            if let Some(raw) = value["url"].as_str() {
                if let Ok(url) = url::Url::parse(raw) {
                    if url.scheme() == "https"
                        && url.host_str().is_some()
                        && url.username().is_empty()
                        && url.password().is_none()
                    {
                        let _ = app.opener().open_url(raw, None::<&str>);
                    }
                }
            }
        }
        "complete" => {
            let kind = value["kind"].as_str().unwrap_or("");
            let id = value["id"].as_str().unwrap_or("");
            if !["task", "reminder"].contains(&kind)
                || id.is_empty()
                || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            {
                return;
            }
            let server_url = value["serverUrl"].as_str().unwrap_or("").to_string();
            let result = send(
                &app,
                ApiRequest {
                    server_url,
                    path: format!("/v1/{kind}s/{id}/complete"),
                    method: "POST".into(),
                    body: Some("{\"completed\":true}".into()),
                    expected_account_id: value["accountId"].as_str().map(str::to_owned),
                },
            )
            .await;
            match result {
                Ok(r) if (200..300).contains(&r.status) => {
                    let _ = app.emit("desktop-material-changed", ());
                }
                _ => {
                    show(&app);
                    forward(&app,json!({"action":"error","message":"Could not complete this item. Open it to retry or sign in again."})).await;
                }
            }
        }
        "hide" => hide(&app),
        "refresh" => {
            app.state::<DesktopState>().refresh.notify_one();
        }
        _ => {}
    }
}
pub async fn resume_deferred(app: &tauri::AppHandle) {
    let deferred = app
        .state::<DesktopState>()
        .deferred_action
        .lock()
        .await
        .take();
    if let Some((created, value)) = deferred {
        if created.elapsed() < std::time::Duration::from_secs(600) {
            action(app.clone(), value).await;
        }
    }
}
pub fn setup(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::TrayIconBuilder,
    };
    let open = MenuItem::with_id(app, "open", "Open ilo", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick", "Quick access", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit ilo", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quick, &settings, &quit])?;
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("ilo")
        .on_menu_event(|app, event| {
            let app = app.clone();
            match event.id.as_ref() {
                "open" => show(&app),
                "quit" => app.exit(0),
                "settings" => {
                    show(&app);
                    tauri::async_runtime::spawn(async move {
                        forward(
                            &app,
                            json!({"action":"open","path":"/settings?section=desktop"}),
                        )
                        .await;
                    });
                }
                "quick" => {
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::native::call(&app, json!({"op":"quick_access"})).await;
                    });
                }
                _ => {}
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    #[cfg(target_os = "macos")]
    {
        let application_menu = Menu::default(app)?;
        if let Some(submenu) = application_menu
            .items()?
            .first()
            .and_then(|item| item.as_submenu())
        {
            submenu.insert(
                &MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?,
                1,
            )?;
        }
        app.set_menu(application_menu)?;
    }
    crate::native::initialize(app);
    let deep_app = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            deep_link(&deep_app, url);
        }
    });
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls {
            deep_link(app, url);
        }
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let settings = app.state::<DesktopState>().settings.lock().await.clone();
        if let Err(error) =
            crate::native::call(&app, json!({"op":"configure","settings":settings})).await
        {
            let _ = app.emit("desktop-native-error", error);
        }
        crate::coordinator::run(app).await;
    });
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn route_validation() {
        assert!(safe_route("/calendar?day=2026-09-08"));
        for path in ["//evil.test", "/settings/../x", "/unknown", "/mail\\evil"] {
            assert!(!safe_route(path));
        }
    }
}
