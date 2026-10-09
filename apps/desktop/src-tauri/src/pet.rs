//! App-styled quick access. Native AppKit owns only the sprite and screen positioning.
use crate::{
    desktop::DesktopState,
    transport::{send, ApiRequest},
};
use serde_json::{json, Value};
#[cfg(not(target_os = "macos"))]
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

pub fn hide(app: &tauri::AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if close(&handle).await.is_err() {
            if let Some(window) = handle.get_webview_window("pet") {
                let _ = window.hide();
            }
            crate::lifecycle::show(&handle);
            crate::lifecycle::forward(&handle, json!({"action":"error","message":"Could not close pet quick access cleanly. Try reopening it."})).await;
        }
    });
}
async fn close(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        crate::native::call(app, json!({"op":"pet_close_overlay"})).await?;
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(window) = app.get_webview_window("pet") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
async fn presentation(app: &tauri::AppHandle, op: &str) -> Result<(), String> {
    let window = app
        .get_webview_window("pet")
        .ok_or("Quick access is unavailable.")?;
    #[cfg(target_os = "macos")]
    {
        let address = window.ns_window().map_err(|e| e.to_string())? as usize;
        crate::native::call(app, json!({"op":op, "windowAddress":address})).await?;
    }
    #[cfg(not(target_os = "macos"))]
    if op != "pet_prepare_overlay" {
        if op == "pet_toggle_overlay" && window.is_visible().map_err(|e| e.to_string())? {
            window.hide().map_err(|e| e.to_string())?;
        } else {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
pub async fn toggle(app: &tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window("pet").is_some() {
        app.state::<DesktopState>().refresh.notify_one();
        return presentation(app, "pet_toggle_overlay").await;
    }
    let _window = tauri::WebviewWindowBuilder::new(
        app,
        "pet",
        tauri::WebviewUrl::App("index.html#pet".into()),
    )
    .title("nohmi quick access")
    .inner_size(400.0, 640.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
    // AppKit owns focus/dismissal on macOS. The hidden Tauri owner can blur during
    // reparenting; that must not dismiss the native scene or override its pin policy.
    #[cfg(not(target_os = "macos"))]
    {
        let handle = app.clone();
        let was_focused = AtomicBool::new(false);
        _window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(focused) = event {
                // Creation can emit an initial blur before the first show.
                if was_focused.swap(*focused, Ordering::Relaxed) && !focused {
                    hide(&handle);
                }
            }
        });
    }
    app.state::<DesktopState>().refresh.notify_one();
    presentation(app, "pet_prepare_overlay").await // React announces readiness before showing.
}
fn authorize_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "pet" {
        Ok(())
    } else {
        Err("This action belongs to quick access.".into())
    }
}
#[tauri::command]
pub async fn pet_snapshot(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    authorize_window(&window)?;
    let state = app.state::<DesktopState>();
    let settings = state.settings.lock().await;
    let account = state.account_id.lock().await;
    let mut data = crate::native::call(&app, json!({"op":"pet_snapshot"})).await?;
    #[cfg(target_os = "macos")]
    {
        data["presentation"] = crate::native::call(&app, json!({"op":"pet_presentation"})).await?;
    }
    if account.is_none()
        || data["snapshot"]["accountId"].as_str() != account.as_deref()
        || data["snapshot"]["serverUrl"].as_str() != Some(settings.server_url.as_str())
    {
        return Ok(json!({"snapshot":null,"workspaces":[],"presentation":data["presentation"]}));
    }
    Ok(data)
}
#[tauri::command]
pub async fn pet_action(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    value: Value,
) -> Result<(), String> {
    authorize_window(&window)?;
    match value["action"].as_str().unwrap_or("") {
        "ready" => {
            if let Err(error) = presentation(&app, "pet_ready_overlay").await {
                crate::lifecycle::show(&app);
                crate::lifecycle::forward(&app, json!({"action":"error","message":"Could not open pet quick access. Try again."})).await;
                return Err(error);
            }
            Ok(())
        }
        "close" => close(&app).await,
        "drag" => {
            #[cfg(target_os = "macos")]
            {
                crate::native::call(&app, json!({"op":"pet_prepare_drag"})).await?;
                Ok(())
            }
            #[cfg(not(target_os = "macos"))]
            {
                window
                    .start_dragging()
                    .map_err(|_| "Could not move the pet card.".into())
            }
        }
        "pin" => {
            let pinned = value["pinned"].as_bool().ok_or("Invalid pin state.")?;
            #[cfg(target_os = "macos")]
            crate::native::call(&app, json!({"op":"pet_pin","pinned":pinned})).await?;
            #[cfg(not(target_os = "macos"))]
            window
                .set_always_on_top(pinned)
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        "resize" => {
            if let Some(edge) = value["edge"].as_str() {
                if !["n", "s", "e", "w", "ne", "nw", "se", "sw"].contains(&edge) {
                    return Err("Invalid resize edge.".into());
                }
                #[cfg(target_os = "macos")]
                crate::native::call(&app, json!({"op":"pet_resize","edge":edge})).await?;
            } else {
                let dw = value["dw"]
                    .as_f64()
                    .filter(|v| v.is_finite() && v.abs() <= 100.0)
                    .ok_or("Invalid resize.")?;
                let dh = value["dh"]
                    .as_f64()
                    .filter(|v| v.is_finite() && v.abs() <= 100.0)
                    .ok_or("Invalid resize.")?;
                #[cfg(target_os = "macos")]
                crate::native::call(&app, json!({"op":"pet_resize","dw":dw,"dh":dh})).await?;
            }
            Ok(())
        }
        "move" => {
            let dx = value["dx"]
                .as_f64()
                .filter(|v| v.is_finite() && v.abs() <= 100.0)
                .ok_or("Invalid movement.")?;
            let dy = value["dy"]
                .as_f64()
                .filter(|v| v.is_finite() && v.abs() <= 100.0)
                .ok_or("Invalid movement.")?;
            #[cfg(target_os = "macos")]
            crate::native::call(&app, json!({"op":"pet_move_overlay","dx":dx,"dy":dy})).await?;
            #[cfg(not(target_os = "macos"))]
            {
                let pos = window.outer_position().map_err(|e| e.to_string())?;
                let scale = window.scale_factor().map_err(|e| e.to_string())?;
                window
                    .set_position(tauri::PhysicalPosition::new(
                        pos.x + (dx * scale) as i32,
                        pos.y - (dy * scale) as i32,
                    ))
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        "refresh" => {
            app.state::<DesktopState>().refresh.notify_one();
            Ok(())
        }
        "join" => {
            let state = app.state::<DesktopState>();
            let settings = state.settings.lock().await;
            let account = state.account_id.lock().await;
            if account.is_none()
                || value["serverUrl"].as_str() != Some(settings.server_url.as_str())
                || value["accountId"].as_str() != account.as_deref()
            {
                return Err("Your account changed. Reopen quick access.".into());
            }
            let raw = value["url"].as_str().ok_or("Missing meeting link.")?;
            let url = url::Url::parse(raw).map_err(|_| "Invalid meeting link.")?;
            if url.scheme() != "https"
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err("Invalid meeting link.".into());
            }
            app.opener()
                .open_url(raw, None::<&str>)
                .map_err(|_| "Could not open this meeting link.")?;
            hide(&app);
            Ok(())
        }
        "open" | "capture" => {
            let action = value["action"].as_str().unwrap_or("");
            if action == "open"
                && !value["path"]
                    .as_str()
                    .is_some_and(crate::lifecycle::safe_route)
            {
                return Err("Invalid destination.".into());
            }
            if action == "capture"
                && !["task", "reminder", "event"].contains(&value["kind"].as_str().unwrap_or(""))
            {
                return Err("Invalid capture type.".into());
            }
            crate::lifecycle::action(app.clone(), value).await;
            hide(&app);
            Ok(())
        }
        "complete" => {
            let kind = value["kind"].as_str().unwrap_or("");
            let id = value["id"].as_str().unwrap_or("");
            if !["task", "reminder"].contains(&kind)
                || id.is_empty()
                || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            {
                return Err("Invalid item.".into());
            }
            let state = app.state::<DesktopState>();
            let server = value["serverUrl"]
                .as_str()
                .ok_or("Missing account context.")?;
            let account = value["accountId"]
                .as_str()
                .ok_or("Missing account context.")?;
            {
                let settings = state.settings.lock().await;
                let current = state.account_id.lock().await;
                if settings.server_url != server || current.as_deref() != Some(account) {
                    return Err("Your account changed. Reopen quick access.".into());
                }
            }
            let result = send(
                &app,
                ApiRequest {
                    server_url: server.into(),
                    path: format!("/v1/{kind}s/{id}/complete"),
                    method: "POST".into(),
                    body: Some("{\"completed\":true}".into()),
                    expected_account_id: Some(account.into()),
                },
            )
            .await?;
            if !(200..300).contains(&result.status) {
                return Err("Could not complete this item. Reconnect and try again.".into());
            }
            #[cfg(target_os = "macos")]
            {
                let _ = crate::native::call(&app, json!({"op":"pet_acknowledge"})).await;
            }
            state.refresh.notify_one();
            let _ = app.emit("desktop-material-changed", ());
            Ok(())
        }
        _ => Err("Unsupported quick-access action.".into()),
    }
}
