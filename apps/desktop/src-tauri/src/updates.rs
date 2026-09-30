//! The startup gate is the only automatic-install authority. Opening the app revokes it.
use serde::Serialize;
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

const FEED: &str =
    "https://github.com/coopersully/personal-os/releases/latest/download/latest.json";
const MAX_DOWNLOAD_BYTES: u64 = 256 * 1024 * 1024;
const AUTO_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const KEY: &str = match option_env!("NOHMI_UPDATER_PUBLIC_KEY") {
    Some(key) => key,
    None => "",
};
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    installed_version: String,
    available_version: Option<String>,
    phase: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    checked_at: Option<String>,
    error: Option<String>,
    startup_blocking: bool,
}
struct Session {
    status: Status,
    last_attempt: Option<Instant>,
    staged: Option<(Update, Vec<u8>)>,
}
pub struct UpdateState {
    session: Mutex<Session>,
    operation: tokio::sync::Mutex<()>,
}
fn valid_download_url(url: &url::Url, version: &str, arch: &str) -> bool {
    let expected = format!(
        "/coopersully/personal-os/releases/download/v{version}/nohmi_{version}_{arch}.app.tar.gz"
    );
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.path() == expected
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.port().is_none()
}
fn supported() -> bool {
    cfg!(all(target_os = "macos", not(debug_assertions))) && !KEY.trim().is_empty()
}
fn automatic_due(last: Option<Instant>) -> bool {
    last.is_none_or(|time| time.elapsed() >= AUTO_INTERVAL)
}
fn can_install(status: &Status, manual: bool) -> bool {
    status.phase == "ready" && (manual || status.startup_blocking)
}
fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Updates are only available in the main window".into())
    }
}
pub fn setup(app: &tauri::AppHandle) {
    app.manage(UpdateState {
        session: Mutex::new(Session {
            status: Status {
                installed_version: app.package_info().version.to_string(),
                available_version: None,
                phase: if supported() {
                    "checking"
                } else {
                    "unavailable"
                }
                .into(),
                downloaded_bytes: 0,
                total_bytes: None,
                checked_at: None,
                error: None,
                startup_blocking: supported(),
            },
            last_attempt: None,
            staged: None,
        }),
        operation: tokio::sync::Mutex::new(()),
    });
}
fn release_startup(status: &mut Status) -> bool {
    if status.phase == "installing" {
        return false;
    }
    status.startup_blocking = false;
    true
}
fn is_external_intent(action: &str) -> bool {
    matches!(action, "open" | "join" | "complete" | "capture")
}
pub fn external_intent(app: &tauri::AppHandle, action: &str) {
    if !is_external_intent(action) {
        return;
    }
    if let Some(state) = app.try_state::<UpdateState>() {
        release_startup(&mut state.session.lock().unwrap().status);
    }
}
pub fn startup_blocking(app: &tauri::AppHandle) -> bool {
    app.state::<UpdateState>()
        .session
        .lock()
        .unwrap()
        .status
        .startup_blocking
}
pub async fn wait_for_startup(app: &tauri::AppHandle) {
    while app
        .state::<UpdateState>()
        .session
        .lock()
        .unwrap()
        .status
        .startup_blocking
    {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}
pub fn schedule(app: &tauri::AppHandle) {
    if !supported() || app.try_state::<UpdateState>().is_none() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        check(&app, false).await;
    });
}
fn fail(app: &tauri::AppHandle, message: &str) {
    let state = app.state::<UpdateState>();
    let mut session = state.session.lock().unwrap();
    session.status.phase = "error".into();
    session.status.error = Some(message.into());
    session.status.startup_blocking = false;
}
fn check_failure(error: Option<&tauri_plugin_updater::Error>) -> (&'static str, &'static str) {
    use tauri_plugin_updater::Error;
    match error {
        None => ("timeout", "The update check timed out. Please try again"),
        Some(Error::Reqwest(error)) if error.is_timeout() => {
            ("timeout", "The update check timed out. Please try again")
        }
        Some(Error::Reqwest(_)) => (
            "transport",
            "Could not reach the update service. Please try again",
        ),
        Some(Error::Serialization(_) | Error::Io(_) | Error::Semver(_)) => (
            "invalid_feed",
            "The update service returned invalid release information. Please try again later",
        ),
        Some(_) => (
            "release_unavailable",
            "Update information is unavailable. Please try again later",
        ),
    }
}
fn report_check_failure(app: &tauri::AppHandle, error: Option<&tauri_plugin_updater::Error>) {
    let (code, message) = check_failure(error);
    // Static categories only: never log provider bodies, URLs or signature content.
    eprintln!("{{\"event\":\"desktop_update_check_failed\",\"code\":\"{code}\"}}");
    fail(app, message);
}
async fn check(app: &tauri::AppHandle, manual: bool) {
    let state = app.state::<UpdateState>();
    let Ok(_operation) = state.operation.try_lock() else {
        return;
    };
    {
        let mut session = state.session.lock().unwrap();
        if !supported()
            || session.staged.is_some()
            || (!manual && !automatic_due(session.last_attempt))
        {
            return;
        }
        session.last_attempt = Some(Instant::now());
        session.status.checked_at = Some(chrono::Utc::now().to_rfc3339());
        session.status.phase = "checking".into();
        session.status.error = None;
        session.status.available_version = None;
        session.status.downloaded_bytes = 0;
        session.status.total_bytes = None;
    }
    let updater = app
        .updater_builder()
        .pubkey(KEY)
        .endpoints(vec![FEED.parse().unwrap()])
        .and_then(|builder| builder.timeout(Duration::from_secs(8)).build());
    let Ok(updater) = updater else {
        fail(app, "Updates are not configured for this build");
        return;
    };
    let result = tokio::time::timeout(Duration::from_secs(8), updater.check()).await;
    let mut update = match result {
        Ok(Ok(Some(update))) => update,
        Ok(Ok(None)) => {
            let mut session = state.session.lock().unwrap();
            session.status.phase = "current".into();
            session.status.startup_blocking = false;
            return;
        }
        Ok(Err(error)) => {
            report_check_failure(app, Some(&error));
            return;
        }
        Err(_) => {
            report_check_failure(app, None);
            return;
        }
    };
    // Only the official release repository may nominate install bytes. Redirects to
    // GitHub's asset CDN remain protected by HTTPS and the embedded signing key.
    if !valid_download_url(
        &update.download_url,
        &update.version,
        std::env::consts::ARCH,
    ) {
        fail(app, "The release contains an invalid update address");
        return;
    }
    {
        let mut session = state.session.lock().unwrap();
        session.status.phase = "downloading".into();
        session.status.available_version = Some(update.version.clone());
    }
    update.timeout = Some(Duration::from_secs(120));
    let too_large = tokio::sync::Notify::new();
    let download = tokio::time::timeout(
        Duration::from_secs(120),
        update.download(
            |chunk, total| {
                let mut session = state.session.lock().unwrap();
                session.status.downloaded_bytes += chunk as u64;
                session.status.total_bytes = total;
                if session.status.downloaded_bytes > MAX_DOWNLOAD_BYTES
                    || total.is_some_and(|size| size > MAX_DOWNLOAD_BYTES)
                {
                    too_large.notify_one();
                }
            },
            || {},
        ),
    );
    let downloaded = tokio::select! {
        result = download => result,
        _ = too_large.notified() => { fail(app, "The update exceeds the download limit"); return; }
    };
    let bytes = match downloaded {
        Ok(Ok(bytes)) if bytes.len() as u64 <= MAX_DOWNLOAD_BYTES => bytes,
        _ => {
            fail(
                app,
                "The update could not be downloaded and verified. Try again",
            );
            return;
        }
    };
    {
        let mut session = state.session.lock().unwrap();
        session.staged = Some((update, bytes));
        session.status.phase = "ready".into();
    }
    let _ = install(app, false).await;
}
async fn install(app: &tauri::AppHandle, manual: bool) -> Result<(), String> {
    let ritual = app.state::<crate::ritual::RitualRuntime>();
    let _ritual_guard = ritual.lock.lock().await;
    if app
        .get_webview_window("ritual")
        .is_some_and(|window| window.is_visible().unwrap_or(true))
    {
        return Err("Finish or snooze the ritual before restarting".into());
    }
    let staged = {
        let state = app.state::<UpdateState>();
        let mut session = state.session.lock().unwrap();
        if !can_install(&session.status, manual) {
            return Ok(());
        }
        session.status.phase = "installing".into();
        session.staged.take()
    };
    if let Some((update, bytes)) = staged {
        let result = tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await;
        if !matches!(result, Ok(Ok(()))) {
            fail(
                app,
                "The update could not be installed. Download the latest installer or try again",
            );
            return Err("The update could not be installed".into());
        }
        app.restart();
    }
    Ok(())
}
#[tauri::command]
pub fn desktop_update_status(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<Status, String> {
    main_window(&window)?;
    Ok(app
        .state::<UpdateState>()
        .session
        .lock()
        .unwrap()
        .status
        .clone())
}
#[tauri::command]
pub fn desktop_update_open(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    main_window(&window)?;
    let state = app.state::<UpdateState>();
    let mut session = state.session.lock().unwrap();
    if release_startup(&mut session.status) {
        Ok(())
    } else {
        Err("Installation is already in progress".into())
    }
}
#[tauri::command]
pub async fn desktop_update_check(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    main_window(&window)?;
    check(&app, true).await;
    Ok(())
}
#[tauri::command]
pub async fn desktop_update_restart(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    main_window(&window)?;
    let state = app.state::<UpdateState>();
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "An update is already in progress")?;
    install(&app, true).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn check_errors_preserve_redacted_categories_without_blaming_connectivity() {
        use tauri_plugin_updater::Error;
        assert_eq!(check_failure(None).0, "timeout");
        let invalid = Error::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "private body",
        ));
        let (code, message) = check_failure(Some(&invalid));
        assert_eq!(code, "invalid_feed");
        assert!(!message.contains("private body"));
        assert!(!message.contains("online"));
        assert_eq!(
            check_failure(Some(&Error::ReleaseNotFound)).0,
            "release_unavailable"
        );
    }
    #[test]
    fn an_external_intent_releases_automatic_install_authority() {
        for action in ["open", "join", "complete", "capture"] {
            assert!(is_external_intent(action));
        }
        for action in ["refresh", "ritual_refresh", "hide", ""] {
            assert!(!is_external_intent(action));
        }
        let mut status = ready();
        assert!(release_startup(&mut status));
        assert!(!can_install(&status, false));
        assert!(can_install(&status, true));
        status.phase = "installing".into();
        status.startup_blocking = true;
        assert!(!release_startup(&mut status));
        assert!(status.startup_blocking);
    }
    fn ready() -> Status {
        Status {
            installed_version: "0.1.0".into(),
            available_version: Some("0.2.0".into()),
            phase: "ready".into(),
            downloaded_bytes: 100,
            total_bytes: Some(100),
            checked_at: None,
            error: None,
            startup_blocking: true,
        }
    }
    #[test]
    fn automatic_install_requires_unreleased_startup_authority() {
        let mut status = ready();
        assert!(can_install(&status, false));
        status.startup_blocking = false;
        assert!(!can_install(&status, false));
        assert!(can_install(&status, true));
        status.phase = "installing".into();
        assert!(!can_install(&status, true));
    }
    #[test]
    fn rejects_foreign_mismatched_and_credentialed_downloads() {
        let good = "https://github.com/coopersully/personal-os/releases/download/v0.2.0/nohmi_0.2.0_aarch64.app.tar.gz";
        assert!(valid_download_url(
            &good.parse().unwrap(),
            "0.2.0",
            "aarch64"
        ));
        for bad in [
            good.replace("https:", "http:"),
            good.replace("github.com", "evil.test"),
            good.replace("github.com", "user@github.com"),
            good.replace("github.com", "github.com:8443"),
            format!("{good}?token=secret"),
            format!("{good}#anchor"),
            good.replace("aarch64", "x86_64"),
        ] {
            assert!(!valid_download_url(
                &bad.parse().unwrap(),
                "0.2.0",
                "aarch64"
            ));
        }
        assert!(!valid_download_url(
            &good.parse().unwrap(),
            "0.3.0",
            "aarch64"
        ));
    }
    #[test]
    fn automatic_checks_are_throttled_but_first_launch_is_due() {
        assert!(automatic_due(None));
        assert!(!automatic_due(Some(Instant::now())));
        assert!(automatic_due(Some(Instant::now() - AUTO_INTERVAL)));
    }
}
