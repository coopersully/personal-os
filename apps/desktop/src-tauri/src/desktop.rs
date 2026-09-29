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
        || pathname.contains('%')
        || pathname.split('/').any(|p| p == ".." || p == ".")
    {
        return Err("Invalid API request path.".into());
    }
    Ok(())
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
#[tauri::command]
pub async fn desktop_save_settings(
    app: tauri::AppHandle,
    mut settings: DesktopSettings,
) -> Result<serde_json::Value, String> {
    settings.validate()?;
    let state = app.state::<DesktopState>();
    let mut current = state.settings.lock().await;
    let switched = current.server_url != settings.server_url;
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
        crate::native::call(&app, serde_json::json!({"op":"clear"})).await?;
        *state.account_id.lock().await = None;
        *state.pending_action.lock().await = None;
        *state.deferred_action.lock().await = None;
        if let Err(error) = crate::native::call(
            &app,
            serde_json::json!({"op":"keychain_delete","serverUrl":settings.server_url}),
        )
        .await
        {
            // Restore the committed origin if its previous session could not be cleared.
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
    desktop_settings(app).await
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
