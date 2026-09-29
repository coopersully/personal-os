use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::{Emitter, Manager};
use tokio::sync::{watch, Mutex, Notify};

pub const HOSTED_SERVER: &str = "https://nohmi-api.coopersully.me";
const LEGACY_HOSTED_SERVER: &str = "https://api.ilo.coopersully.me";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct NotificationSettings {
    pub enabled: bool,
    pub tasks: bool,
    pub reminders: bool,
    pub calendar: bool,
    pub mail: bool,
    pub advance_minutes: u32,
    pub sound: bool,
    pub preview: bool,
    pub quiet_start: Option<String>,
    pub quiet_end: Option<String>,
    pub mail_account_ids: Vec<String>,
    pub calendar_ids: Vec<String>,
}
impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            tasks: true,
            reminders: true,
            calendar: true,
            mail: false,
            advance_minutes: 10,
            sound: true,
            preview: false,
            quiet_start: None,
            quiet_end: None,
            mail_account_ids: vec![],
            calendar_ids: vec![],
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopSettings {
    pub server_url: String,
    pub launch_at_login: bool,
    pub pet_enabled: bool,
    pub pet_color: String,
    pub pet_workspaces: Vec<String>,
    pub widget_workspaces: Vec<String>,
    pub notifications: NotificationSettings,
}
impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            server_url: HOSTED_SERVER.into(),
            launch_at_login: !cfg!(debug_assertions),
            pet_enabled: false,
            pet_color: "#C7D23C".into(),
            pet_workspaces: vec!["tasks".into(), "reminders".into(), "calendar".into()],
            widget_workspaces: vec!["tasks".into(), "reminders".into(), "calendar".into()],
            notifications: NotificationSettings::default(),
        }
    }
}
impl DesktopSettings {
    pub fn validate(&mut self) -> Result<(), String> {
        self.server_url = canonical_server(&self.server_url)?;
        if !crate::is_hex_color(&self.pet_color) {
            return Err("Choose a six-digit pet color.".into());
        }
        if self
            .pet_workspaces
            .iter()
            .chain(self.widget_workspaces.iter())
            .any(|s| {
                ![
                    "tasks",
                    "reminders",
                    "calendar",
                    "finances",
                    "mail",
                    "goals",
                    "motives",
                ]
                .contains(&s.as_str())
            })
        {
            return Err("Choose a supported workspace.".into());
        }
        if self.notifications.advance_minutes > 1440 {
            return Err("Event notice must be within 24 hours.".into());
        }
        let n = &self.notifications;
        if n.quiet_start.is_some() != n.quiet_end.is_some() {
            return Err("Set both quiet-hours times.".into());
        }
        for time in [&n.quiet_start, &n.quiet_end].into_iter().flatten() {
            let Some((h, m)) = time.split_once(':') else {
                return Err("Use HH:MM for quiet hours.".into());
            };
            if h.len() != 2
                || m.len() != 2
                || h.parse::<u32>().map_or(true, |v| v > 23)
                || m.parse::<u32>().map_or(true, |v| v > 59)
            {
                return Err("Use HH:MM for quiet hours.".into());
            }
        }
        Ok(())
    }
}
fn migrate_legacy_hosted_server(settings: &mut DesktopSettings) -> bool {
    if settings.server_url != LEGACY_HOSTED_SERVER {
        return false;
    }
    settings.server_url = HOSTED_SERVER.into();
    true
}
pub fn canonical_server(input: &str) -> Result<String, String> {
    let url = url::Url::parse(input.trim()).map_err(|_| "Enter a valid API server URL.")?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Use an HTTPS server origin, without credentials or a path. HTTP is allowed for localhost only.".into());
    }
    Ok(url.origin().ascii_serialization())
}
pub fn api_path(path: &str) -> Result<(), String> {
    let pathname = path.split('?').next().unwrap_or("");
    if !pathname.starts_with("/v1/")
        || path.contains(['\\', '#', '\r', '\n'])
        || (pathname.contains('%') && !encoded_ritual_response_path(pathname))
        || pathname.split('/').any(|p| p == ".." || p == ".")
    {
        return Err("Invalid API request path.".into());
    }
    Ok(())
}
fn encoded_ritual_response_path(path: &str) -> bool {
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() != 7
        || parts[1..4] != ["v1", "rituals", "occurrences"]
        || parts[5] != "responses"
        || parts[4].is_empty()
        || !parts[4]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return false;
    }
    crate::ritual::decode_segment(parts[6]).is_ok_and(|step| {
        !step.is_empty()
            && step != "."
            && step != ".."
            && !step
                .chars()
                .any(|c| c.is_control() || matches!(c, '/' | '\\' | '%'))
    })
}

pub struct DesktopState {
    pub settings: Mutex<DesktopSettings>,
    pub settings_path: PathBuf,
    pub generation: AtomicU64,
    pub changed: watch::Sender<u64>,
    pub refresh: Notify,
    pub account_id: Mutex<Option<String>>,
    pub client: reqwest::Client,
    pub deferred_action: Mutex<Option<(std::time::Instant, serde_json::Value)>>,
    pub mail_status: Mutex<Option<String>>,
    pub wallpaper_status: Mutex<Option<String>>,
    pub pending_action: Mutex<Option<serde_json::Value>>,
}
impl DesktopState {
    pub fn load(app: &tauri::AppHandle) -> Result<Self, String> {
        let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let settings_path = dir.join("desktop.json");
        let settings_exist = settings_path.exists();
        let mut settings = if settings_exist {
            serde_json::from_slice::<DesktopSettings>(
                &std::fs::read(&settings_path).map_err(|e| e.to_string())?,
            )
            .map_err(|_| "Desktop settings are damaged. Move desktop.json aside to reset them.")?
        } else {
            DesktopSettings::default()
        };
        if cfg!(debug_assertions) && !settings_exist {
            settings.server_url = option_env!("VITE_API_BASE_URL")
                .unwrap_or("http://localhost:8787")
                .into();
        }
        let migrated = migrate_legacy_hosted_server(&mut settings);
        settings.validate()?;
        if migrated {
            let temporary = settings_path.with_extension("tmp");
            std::fs::write(
                &temporary,
                serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            std::fs::rename(temporary, &settings_path).map_err(|e| e.to_string())?;
        }
        Ok(Self {
            settings: Mutex::new(settings),
            settings_path,
            generation: AtomicU64::new(0),
            changed: watch::channel(0).0,
            refresh: Notify::new(),
            account_id: Mutex::new(None),
            pending_action: Mutex::new(None),
            wallpaper_status: Mutex::new(None),
            mail_status: Mutex::new(None),
            deferred_action: Mutex::new(None),
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .map_err(|e| e.to_string())?,
        })
    }
    pub fn invalidate(&self) {
        let g = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.changed.send_replace(g);
        self.refresh.notify_one();
    }
}
#[tauri::command]
pub async fn desktop_settings(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let settings = app.state::<DesktopState>().settings.lock().await.clone();
    let native = crate::native::call(&app, serde_json::json!({"op":"status"})).await?;
    let wallpaper_error = app
        .state::<DesktopState>()
        .wallpaper_status
        .lock()
        .await
        .clone();
    Ok(
        serde_json::json!({"settings":settings,"native":native,"hostedServer":HOSTED_SERVER,"wallpaperError":wallpaper_error}),
    )
}
fn server_switch_cleanup(
    old_origin: &str,
    old_account: Option<&str>,
    new_origin: &str,
) -> Vec<serde_json::Value> {
    let mut operations = vec![serde_json::json!({"op":"clear"})];
    if let Some(account) = old_account {
        operations.push(serde_json::json!({"op":"ritual_store_delete","identity":format!("{old_origin}|{account}")}));
    }
    operations.push(
        serde_json::json!({"op":"ritual_store_delete","identity":format!("recovery|{old_origin}")}),
    );
    operations.push(serde_json::json!({"op":"keychain_delete","serverUrl":old_origin}));
    // Switching always starts signed out, including a previously used destination.
    operations.push(serde_json::json!({"op":"keychain_delete","serverUrl":new_origin}));
    operations
}

#[tauri::command]
pub async fn desktop_save_settings(
    app: tauri::AppHandle,
    mut settings: DesktopSettings,
) -> Result<serde_json::Value, String> {
    settings.validate()?;
    // Match mutation lock order: ritual fence, then settings/account state.
    let ritual_runtime = app.state::<crate::ritual::RitualRuntime>();
    let _ritual_guard = ritual_runtime.lock.lock().await;
    let switching =
        app.state::<DesktopState>().settings.lock().await.server_url != settings.server_url;
    if switching {
        crate::ritual::require_synced(&app).await?;
    }
    let state = app.state::<DesktopState>();
    let mut current = state.settings.lock().await;
    let switched = current.server_url != settings.server_url;
    let old_origin = current.server_url.clone();
    let old_account = match state.account_id.lock().await.clone() {
        Some(account) => Some(account),
        None => crate::ritual::recovery_account(&app, &old_origin).await?,
    };
    let temporary = state.settings_path.with_extension("tmp");
    std::fs::write(
        &temporary,
        serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    // Prepare disk data before changing live state; roll the native layer back on commit failure.
    if let Err(error) = crate::native::call(
        &app,
        serde_json::json!({"op":"configure","settings":settings}),
    )
    .await
    {
        let _ = crate::native::call(
            &app,
            serde_json::json!({"op":"configure","settings":*current}),
        )
        .await;
        let _ = std::fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = std::fs::rename(&temporary, &state.settings_path) {
        let _ = crate::native::call(
            &app,
            serde_json::json!({"op":"configure","settings":*current}),
        )
        .await;
        return Err(error.to_string());
    }
    if switched {
        state.invalidate();
        crate::ritual::hide(&app).await;
        *state.account_id.lock().await = None;
        *state.pending_action.lock().await = None;
        *state.deferred_action.lock().await = None;
        for operation in
            server_switch_cleanup(&old_origin, old_account.as_deref(), &settings.server_url)
        {
            if !cfg!(target_os = "macos")
                && operation["op"]
                    .as_str()
                    .is_some_and(|op| op.starts_with("ritual_"))
            {
                continue;
            }
            if let Err(error) = crate::native::call(&app, operation).await {
                // Never publish a destination whose old private state could not
                // be purged. Completed deletions stay deleted; restoring the old
                // origin can require signing in again, but never restores secrets.
                std::fs::write(
                    &temporary,
                    serde_json::to_vec_pretty(&*current).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
                std::fs::rename(&temporary, &state.settings_path).map_err(|e| e.to_string())?;
                let _ = crate::native::call(
                    &app,
                    serde_json::json!({"op":"configure","settings":*current}),
                )
                .await;
                let _ = app.emit("desktop-session-invalidated", ());
                return Err(format!("Could not clear the previous desktop session. The previous server remains selected; sign in again if needed. {error}"));
            }
        }
    }
    if !switched {
        if let Some(account) = state.account_id.lock().await.as_deref() {
            if let Err(error) = crate::preferences::save(&state.settings_path, &settings, account) {
                // The profile commits last; a failed profile rename leaves its old value intact.
                std::fs::write(
                    &temporary,
                    serde_json::to_vec_pretty(&*current).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
                std::fs::rename(&temporary, &state.settings_path).map_err(|e| e.to_string())?;
                let _ = crate::native::call(
                    &app,
                    serde_json::json!({"op":"configure","settings":*current}),
                )
                .await;
                return Err(error);
            }
        }
    }
    *current = settings;
    drop(current);
    state.invalidate();
    app.emit(
        "desktop-settings-changed",
        serde_json::json!({"serverChanged":switched}),
    )
    .map_err(|e| e.to_string())?;
    desktop_settings(app.clone()).await
}
#[tauri::command]
pub async fn desktop_native_action(
    app: tauri::AppHandle,
    action: String,
) -> Result<serde_json::Value, String> {
    if ![
        "request_notification_permission",
        "test_notification",
        "reset_pet_position",
        "quick_access",
        "open_notification_settings",
    ]
    .contains(&action.as_str())
    {
        return Err("Unsupported desktop action.".into());
    }
    crate::native::call(&app, serde_json::json!({"op":action})).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn server_origins_are_canonical_and_transport_safe() {
        assert_eq!(
            DesktopSettings::default().server_url,
            "https://nohmi-api.coopersully.me"
        );
        let mut legacy = DesktopSettings::default();
        legacy.server_url = "https://api.ilo.coopersully.me".into();
        assert!(migrate_legacy_hosted_server(&mut legacy));
        assert_eq!(legacy.server_url, "https://nohmi-api.coopersully.me");
        assert_eq!(
            canonical_server("https://EXAMPLE.com:443/").unwrap(),
            "https://example.com"
        );
        for value in [
            "http://example.com",
            "https://user:pass@example.com",
            "https://example.com/v1",
            "https://example.com?key=secret",
            "file:///tmp/api",
            "https://example.com/#x",
        ] {
            assert!(canonical_server(value).is_err(), "accepted {value}");
        }
        assert_eq!(
            canonical_server("http://127.0.0.1:8787").unwrap(),
            "http://127.0.0.1:8787"
        );
        assert!(canonical_server("http://[::1]:8787").is_ok());
    }
    #[test]
    fn relative_paths_cannot_escape_the_api_origin() {
        for path in [
            "https://evil.test/v1/me",
            "//evil.test/v1/me",
            "/v1/../me",
            "/v1/%2e%2e/me",
            "/v1/\\evil",
            "/v1/me#fragment",
        ] {
            assert!(api_path(path).is_err(), "accepted {path}");
        }
        assert!(api_path("/v1/tasks?completed=false").is_ok());
    }
    #[test]
    fn server_switch_purges_old_private_state_before_destination_credential() {
        let operations =
            server_switch_cleanup("https://old.test", Some("account"), "https://new.test");
        assert_eq!(
            operations,
            vec![
                serde_json::json!({"op":"clear"}),
                serde_json::json!({"op":"ritual_store_delete","identity":"https://old.test|account"}),
                serde_json::json!({"op":"ritual_store_delete","identity":"recovery|https://old.test"}),
                serde_json::json!({"op":"keychain_delete","serverUrl":"https://old.test"}),
                serde_json::json!({"op":"keychain_delete","serverUrl":"https://new.test"}),
            ]
        );
        let signed_out = server_switch_cleanup("https://old.test", None, "https://new.test");
        assert_eq!(signed_out.len(), 4);
        assert!(signed_out
            .iter()
            .all(|operation| operation["identity"] != "https://old.test|account"));
    }

    #[test]
    fn ritual_response_paths_allow_safe_encoded_ids_only() {
        for id in ["wake%20time", "%E2%98%80", "plus%2Bsign"] {
            assert!(api_path(&format!("/v1/rituals/occurrences/123-ab/responses/{id}")).is_ok());
        }
        for id in [
            "%2e%2e", "%2e", "%2F", "%5C", "%00", "%0A", "%25", "%FF", "%",
        ] {
            assert!(
                api_path(&format!("/v1/rituals/occurrences/123-ab/responses/{id}")).is_err(),
                "accepted {id}"
            );
        }
        assert!(api_path("/v1/tasks/%E2%98%80").is_err());
        assert!(api_path("/v1/rituals/occurrences/%2e%2e/responses/okay").is_err());
        assert!(api_path("/v1/rituals/occurrences/123/responses/x%20y/extra").is_err());
    }

    #[test]
    fn preferences_reject_invalid_color_and_partial_quiet_hours() {
        let mut value = DesktopSettings::default();
        value.pet_color = "red".into();
        assert!(value.validate().is_err());
        value.pet_color = "#123456".into();
        value.notifications.quiet_start = Some("22:00".into());
        assert!(value.validate().is_err());
        value.notifications.quiet_end = Some("08:00".into());
        assert!(value.validate().is_ok());
    }
}

#[tauri::command]
pub async fn desktop_take_action(app: tauri::AppHandle) -> Option<serde_json::Value> {
    app.state::<DesktopState>()
        .pending_action
        .lock()
        .await
        .take()
}
