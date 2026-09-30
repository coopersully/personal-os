//! Device-local scheduling survives renderer suspension and never uses another Mac's applied stamp.
use crate::{
    coordinator::get,
    desktop::DesktopState,
    transport::{send, ApiRequest},
    wallpaper::{apply_for_revision, settings_revision, WallpaperRequest},
};
use chrono::{Datelike, Local, TimeZone, Timelike};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager};

// Read eligibility and record success within the same manual/scheduled transaction.
// Otherwise a queued scheduled job can repeat a manual application that just succeeded.
static APPLICATIONS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const APPEARANCE: &[&str] = &[
    "backgroundColor",
    "backgroundMode",
    "cornerRadius",
    "frameSpacing",
    "layout",
    "mosaicFit",
    "paddingBottom",
    "paddingEnd",
    "paddingStart",
    "paddingTop",
    "tileSize",
    "rotationDegrees",
];
fn fingerprint(settings: &Value) -> String {
    let mut fields = vec![settings["boardUrl"].clone()];
    fields.extend(APPEARANCE.iter().map(|key| settings[*key].clone()));
    // Exact canonical values avoid hash collisions and exclude shared lastAppliedAt metadata.
    Value::Array(fields).to_string()
}
fn due(
    now: chrono::DateTime<Local>,
    stamp: Option<&Value>,
    server: &str,
    user: &str,
    fingerprint: &str,
) -> bool {
    let Some(stamp) = stamp.filter(|s| {
        s["serverUrl"] == server && s["userId"] == user && s["fingerprint"] == fingerprint
    }) else {
        return true;
    };
    let Some(last) = stamp["lastSuccess"]
        .as_str()
        .and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok())
    else {
        return true;
    };
    // On launch apply once if this device has no image. Thereafter refresh at 08:00 local,
    // including one catch-up after sleep, with no burst of missed days.
    let today = Local
        .with_ymd_and_hms(now.year(), now.month(), now.day(), 8, 0, 0)
        .earliest()
        .unwrap_or(now);
    now.hour() >= 8 && last < today
}
fn stamp_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("wallpaper-device.json"))
}
fn stamps(value: Value) -> Vec<Value> {
    match value {
        Value::Array(values) => values,
        value if value.is_object() => vec![value],
        _ => vec![],
    }
}
fn load_stamps(path: &std::path::Path) -> Vec<Value> {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .map(stamps)
        .unwrap_or_default()
}
fn replace_stamp(values: &mut Vec<Value>, stamp: Value) {
    values.retain(|v| v["serverUrl"] != stamp["serverUrl"] || v["userId"] != stamp["userId"]);
    values.push(stamp);
    if values.len() > 128 {
        values.drain(..values.len() - 128);
    }
}
fn context_current(state: &DesktopState, generation: u64, revision: u64) -> Result<(), String> {
    if state.generation.load(Ordering::SeqCst) != generation || settings_revision() != revision {
        Err("Wallpaper account or preferences changed.".into())
    } else {
        Ok(())
    }
}
async fn record_success(
    app: &AppHandle,
    generation: u64,
    revision: u64,
    fingerprint: &str,
) -> Result<(), String> {
    let state = app.state::<DesktopState>();
    let settings = state.settings.lock().await;
    context_current(&state, generation, revision)?;
    let user = state
        .account_id
        .lock()
        .await
        .clone()
        .ok_or("Sign in before applying wallpaper")?;
    let path = stamp_path(app)?;
    let mut values = load_stamps(&path);
    replace_stamp(
        &mut values,
        json!({"serverUrl":settings.server_url,"userId":user,"fingerprint":fingerprint,"lastSuccess":Local::now().to_rfc3339()}),
    );
    let temp = path.with_extension("tmp");
    std::fs::write(&temp, Value::Array(values).to_string()).map_err(|e| e.to_string())?;
    std::fs::rename(temp, path).map_err(|e| e.to_string())?;
    *state.wallpaper_status.lock().await = None;
    Ok(())
}
/// Preserve the invocation's identity before waiting for any other wallpaper job.
pub async fn manual(
    app: &AppHandle,
    request: WallpaperRequest,
    generation: u64,
    revision: u64,
) -> Result<String, String> {
    let _application = APPLICATIONS.lock().await;
    let state = app.state::<DesktopState>();
    let server = {
        let settings = state.settings.lock().await;
        context_current(&state, generation, revision)?;
        if state.account_id.lock().await.is_none() {
            return Err("Sign in before applying wallpaper".into());
        }
        settings.server_url.clone()
    };
    // The invoke shape predates boardUrl. Resolve the saved board under this revision,
    // then record the actual passed appearance, including any still-optimistic UI values.
    let response = get(app, &server, "/v1/pinterest").await?;
    let mut settings = response["settings"].clone();
    let appearance = serde_json::to_value(&request).map_err(|e| e.to_string())?;
    if !settings.is_object() {
        return Err("The server returned invalid wallpaper preferences".into());
    }
    for key in APPEARANCE {
        settings[*key] = appearance[*key].clone();
    }
    let fingerprint = fingerprint(&settings);
    let path = apply_for_revision(app, request, generation, revision).await?;
    record_success(app, generation, revision, &fingerprint).await?;
    Ok(path)
}
pub async fn refresh(
    app: &AppHandle,
    server: &str,
    user: &str,
    generation: u64,
) -> Result<(), String> {
    let revision = settings_revision();
    let _application = APPLICATIONS.lock().await;
    let state = app.state::<DesktopState>();
    context_current(&state, generation, revision)?;
    let response = get(app, server, "/v1/pinterest").await?;
    let mut settings = response["settings"].clone();
    context_current(&state, generation, revision)?;
    if settings["enabled"] != true || !settings["boardUrl"].is_string() {
        return Ok(());
    }
    let fingerprint = fingerprint(&settings);
    let values = load_stamps(&stamp_path(app)?);
    let stamp = values
        .iter()
        .find(|s| s["serverUrl"] == server && s["userId"] == user);
    if !due(Local::now(), stamp, server, user, &fingerprint) {
        return Ok(());
    }
    let pins = get(
        app,
        server,
        &format!(
            "/v1/pinterest/pins?limit=12&planningDate={}",
            Local::now().format("%Y-%m-%d")
        ),
    )
    .await?;
    settings["imageUrls"] = json!(pins["pins"]
        .as_array()
        .ok_or("The board returned no images")?
        .iter()
        .filter_map(|p| p["imageUrl"].as_str())
        .collect::<Vec<_>>());
    let board = settings["boardUrl"]
        .as_str()
        .and_then(|s| url::Url::parse(s).ok())
        .and_then(|u| {
            u.path_segments().map(|p| {
                p.filter(|s| !s.is_empty())
                    .next_back()
                    .unwrap_or("Pinterest")
                    .to_string()
            })
        })
        .unwrap_or("Pinterest".into());
    settings["boardLabel"] = json!(board.replace(['-', '_'], " "));
    let request: WallpaperRequest = serde_json::from_value(settings)
        .map_err(|_| "The server returned invalid wallpaper preferences")?;
    apply_for_revision(app, request, generation, revision).await?;
    record_success(app, generation, revision, &fingerprint).await?;
    // The shared server stamp is informational; this device's stamp remains authoritative.
    let _ = send(
        app,
        ApiRequest {
            server_url: server.into(),
            path: "/v1/pinterest/applied".into(),
            method: "POST".into(),
            body: None,
            expected_account_id: Some(user.into()),
        },
    )
    .await;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn device_schedule_catches_up_once_and_isolates_accounts() {
        let now = Local.with_ymd_and_hms(2026, 9, 8, 9, 0, 0).unwrap();
        assert!(due(now, None, "s", "u", "f"));
        let current =
            json!({"serverUrl":"s","userId":"u","fingerprint":"f","lastSuccess":now.to_rfc3339()});
        assert!(!due(now, Some(&current), "s", "u", "f"));
        assert!(due(now, Some(&current), "s", "other", "f"));
        assert!(due(now, Some(&current), "s", "u", "new preferences"));
        let yesterday = json!({"serverUrl":"s","userId":"u","fingerprint":"f","lastSuccess":(now-chrono::Duration::days(3)).to_rfc3339()});
        assert!(due(now, Some(&yesterday), "s", "u", "f"));
        assert!(!due(
            now - chrono::Duration::hours(2),
            Some(&yesterday),
            "s",
            "u",
            "f"
        ));
    }
    #[test]
    fn stamp_retains_each_server_and_account() {
        let a = json!({"serverUrl":"s","userId":"a","fingerprint":"f"});
        let b = json!({"serverUrl":"s","userId":"b","fingerprint":"f"});
        let mut values = stamps(a.clone());
        replace_stamp(&mut values, b.clone());
        replace_stamp(&mut values, a.clone());
        assert_eq!(values, vec![b, a]);
        replace_stamp(&mut values, json!({"serverUrl":"other","userId":"a"}));
        assert_eq!(values.len(), 3);
    }
    #[test]
    fn fingerprint_ignores_shared_application_stamp_but_tracks_boards_and_appearance() {
        let mut settings = json!({"boardUrl":"https://www.pinterest.com/a/board/","frameSpacing":12,"lastAppliedAt":"old"});
        let original = fingerprint(&settings);
        settings["lastAppliedAt"] = json!("another Mac applied");
        assert_eq!(original, fingerprint(&settings));
        settings["frameSpacing"] = json!(20);
        assert_ne!(original, fingerprint(&settings));
        settings["frameSpacing"] = json!(12);
        settings["boardUrl"] = json!("https://www.pinterest.com/b/board/");
        assert_ne!(original, fingerprint(&settings));
    }
}
