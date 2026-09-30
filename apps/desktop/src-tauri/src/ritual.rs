use crate::{
    desktop::DesktopState,
    transport::{send, ApiRequest},
};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::Manager;
use tokio::sync::{Mutex, Notify};
#[derive(Default)]
pub struct RitualRuntime {
    pub lock: Mutex<()>,
    pub refresh: Notify,
    health: Mutex<(u64, Value)>,
    shown: Mutex<Option<String>>,
    manual: Mutex<Option<String>>,
    preview: Mutex<Option<Value>>,
    ready: Mutex<Option<String>>,
    presentation: Mutex<Option<Value>>,
}
async fn identity(app: &tauri::AppHandle) -> Result<(String, String, u64), String> {
    let state = app.state::<DesktopState>();
    // Hold the same settings fence as login/logout and server switching while
    // restoring an identity previously verified with this retained credential.
    let settings = state.settings.lock().await;
    let server = settings.server_url.clone();
    let mut account_id = state.account_id.lock().await;
    if account_id.is_none() {
        let restored = crate::native::call(
            app,
            json!({"op":"ritual_restore_account","serverUrl":server}),
        )
        .await?;
        *account_id = restored["accountId"].as_str().map(str::to_owned);
    }
    let account = account_id.clone().ok_or("Sign in to use rituals.")?;
    Ok((server, account, state.generation.load(Ordering::SeqCst)))
}
pub async fn recovery_account(
    app: &tauri::AppHandle,
    server: &str,
) -> Result<Option<String>, String> {
    if !cfg!(target_os = "macos") {
        return Ok(None);
    }
    let value = crate::native::call(
        app,
        json!({"op":"ritual_store_read","identity":format!("recovery|{server}")}),
    )
    .await?;
    Ok(value["value"]["accountId"]
        .as_str()
        .filter(|account| !account.is_empty())
        .map(str::to_owned))
}
pub async fn retain_recovery_account(
    app: &tauri::AppHandle,
    server: &str,
    account: &str,
) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Ok(());
    }
    crate::native::call(app, json!({"op":"ritual_store_write","identity":format!("recovery|{server}"),"value":{"accountId":account}})).await?;
    Ok(())
}
fn has_recovery_evidence(data: &Value) -> bool {
    data["storageWarning"] == true
        || !queue(data).is_empty()
        || data["conflicts"]
            .as_array()
            .is_some_and(|items| !items.is_empty())
}
pub async fn prepare_account_activation(
    app: &tauri::AppHandle,
    server: &str,
    account: &str,
) -> Result<(), String> {
    if let Some(previous) = recovery_account(app, server).await? {
        if previous != account {
            let data = read(app, &identity_key(server, &previous)).await?;
            if has_recovery_evidence(&data) {
                return Err("Previous account ritual changes are waiting for recovery. Export or discard them in the desktop connection settings before signing into another account.".into());
            }
            crate::native::call(
                app,
                json!({"op":"ritual_store_delete","identity":identity_key(server, &previous)}),
            )
            .await?;
            crate::native::call(
                app,
                json!({"op":"ritual_store_delete","identity":format!("recovery|{server}")}),
            )
            .await?;
        }
    }
    Ok(())
}
async fn local_identity(
    app: &tauri::AppHandle,
) -> Result<Option<(String, String, u64, bool)>, String> {
    match identity(app).await {
        Ok((server, account, generation)) => Ok(Some((server, account, generation, false))),
        Err(error) if error == "Sign in to use rituals." => {
            let state = app.state::<DesktopState>();
            let server = state.settings.lock().await.server_url.clone();
            Ok(recovery_account(app, &server).await?.map(|account| {
                (
                    server,
                    account,
                    state.generation.load(Ordering::SeqCst),
                    true,
                )
            }))
        }
        Err(error) => Err(error),
    }
}

fn compact_occurrence_responses(occurrence: &mut Value) {
    if let Some(responses) = occurrence
        .get_mut("responses")
        .and_then(Value::as_array_mut)
    {
        let mut seen = std::collections::HashSet::new();
        responses.reverse();
        responses.retain(|response| {
            response["stepId"]
                .as_str()
                .is_some_and(|id| seen.insert(id.to_owned()))
        });
        responses.reverse();
    }
}
fn compact_cached_responses(data: &mut Value) {
    if let Some(current) = data
        .get_mut("state")
        .and_then(|state| state.get_mut("current"))
    {
        compact_occurrence_responses(current);
    }
    if let Some(upcoming) = data
        .get_mut("state")
        .and_then(|state| state.get_mut("upcoming"))
        .and_then(Value::as_array_mut)
    {
        for occurrence in upcoming {
            compact_occurrence_responses(occurrence);
        }
    }
    if let Some(history) = data.get_mut("localHistory").and_then(Value::as_array_mut) {
        for occurrence in history {
            compact_occurrence_responses(occurrence);
        }
    }
}
async fn read(app: &tauri::AppHandle, key: &str) -> Result<Value, String> {
    let mut data = crate::native::call(app, json!({"op":"ritual_store_read","identity":key}))
        .await?["value"]
        .clone();
    compact_cached_responses(&mut data);
    Ok(data)
}
async fn write(app: &tauri::AppHandle, key: &str, value: &Value) -> Result<(), String> {
    crate::native::call(
        app,
        json!({"op":"ritual_store_write","identity":key,"value":value}),
    )
    .await?;
    Ok(())
}
fn identity_key(server: &str, account: &str) -> String {
    format!("{server}|{account}")
}
fn current_time() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn should_show(state: &Value, now: &str) -> bool {
    let current = &state["current"];
    current["status"] == "pending"
        && current["dueAt"].as_str().is_some_and(|v| v <= now)
        && current["expiresAt"].as_str().is_some_and(|v| v > now)
        && !current["snoozedUntil"].as_str().is_some_and(|v| v > now)
}
fn can_open_current(state: &Value, now: &str) -> bool {
    let mut state = state.clone();
    if let Some(current) = state.get_mut("current").and_then(Value::as_object_mut) {
        current.insert("snoozedUntil".into(), Value::Null);
    }
    should_show(&state, now)
}
async fn animate_completion(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("ritual") {
        let _ = window.eval("document.documentElement.classList.add('ritual-exiting')");
        let result = crate::native::call(app, json!({"op":"ritual_fade_out"})).await;
        let duration = result
            .ok()
            .and_then(|v| v["durationMs"].as_u64())
            .unwrap_or(650);
        tokio::time::sleep(std::time::Duration::from_millis(duration)).await;
    }
}
async fn reset_presentation(runtime: &RitualRuntime) {
    *runtime.ready.lock().await = None;
    *runtime.presentation.lock().await = None;
    *runtime.preview.lock().await = None;
    *runtime.shown.lock().await = None;
}
pub async fn hide(app: &tauri::AppHandle) {
    reset_presentation(&app.state::<RitualRuntime>()).await;
    if let Some(window) = app.get_webview_window("ritual") {
        let _ = window.destroy();
    }
    let _ = crate::native::call(app, json!({"op":"ritual_backdrop","visible":false})).await;
}
async fn present(app: &tauri::AppHandle, data: &Value, force: bool) -> Result<(), String> {
    let mut preview = app.state::<RitualRuntime>().preview.lock().await.clone();
    if let Some(state) = &preview {
        let (server, account, _) = identity(app).await?;
        if state["previewIdentity"].as_str() != Some(identity_key(&server, &account).as_str()) {
            *app.state::<RitualRuntime>().preview.lock().await = None;
            preview = None;
        }
    }
    let force = force || preview.is_some();
    let mut state = preview.unwrap_or_else(|| data["state"].clone());
    let id = state["current"]["id"].as_str().map(str::to_owned);
    let runtime = app.state::<RitualRuntime>();
    if force {
        *runtime.manual.lock().await = id.clone();
    }
    let manual = runtime.manual.lock().await.clone() == id && id.is_some();
    if force || manual {
        state["current"]["snoozedUntil"] = Value::Null;
    }
    if (!force && !manual && data["enabled"] != true) || !should_show(&state, &current_time()) {
        hide(app).await;
        return Ok(());
    }
    if runtime.ready.lock().await.as_ref() == id.as_ref() && id.is_some() {
        let native = crate::native::call(app, json!({"op":"ritual_backdrop","visible":true,"kind":state["current"]["definition"]["kind"]})).await?;
        if native["visible"] != true {
            hide(app).await;
            return Err("Ritual presentation unavailable; retrying with a new checklist".into());
        }
    }
    let id = state["current"]["id"]
        .as_str()
        .ok_or("Invalid ritual occurrence")?;
    let runtime = app.state::<RitualRuntime>();
    let mut shown = runtime.shown.lock().await;
    if shown.as_deref() != Some(id) {
        *runtime.ready.lock().await = None;
        *runtime.presentation.lock().await = Some(state.clone());
        if let Some(window) = app.get_webview_window("ritual") {
            window.destroy().map_err(|e| e.to_string())?;
        }
        let steps = state["current"]["definition"]["steps"]
            .as_array()
            .map_or(0, Vec::len);
        let height = (468.0 + steps as f64 * 90.0).min(900.0);
        let window = tauri::WebviewWindowBuilder::new(
            app,
            "ritual",
            tauri::WebviewUrl::App("index.html#ritual".into()),
        )
        .title("nohmi ritual")
        .inner_size(648.0, height)
        .min_inner_size(320.0, 300.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(!cfg!(target_os = "macos"))
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
        if let Some(monitor) = window.current_monitor().map_err(|e| e.to_string())? {
            let size = monitor.size();
            let scale = monitor.scale_factor();
            let _ = window.set_size(tauri::LogicalSize::new(
                648f64.min((size.width as f64 / scale - 64.0).max(320.0)),
                height.min((size.height as f64 / scale - 64.0).max(300.0)),
            ));
        }
        window.center().map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        let window_address = window.ns_window().map_err(|e| e.to_string())? as usize;
        #[cfg(not(target_os = "macos"))]
        let window_address = 0usize;
        let prepared = crate::native::call(
            app,
            json!({"op":"ritual_style_checklist","windowAddress":window_address,"prepare":true}),
        )
        .await?;
        if prepared["prepared"] != true {
            window.destroy().map_err(|e| e.to_string())?;
            return Err(
                "Ritual presentation is unavailable while the session is locked or unknown".into(),
            );
        }
        window.show().map_err(|e| e.to_string())?;
        *shown = Some(id.into());
    }
    Ok(())
}
async fn api(
    app: &tauri::AppHandle,
    server: &str,
    account: &str,
    path: &str,
    method: &str,
    body: Option<Value>,
) -> Result<(u16, Value), String> {
    let response = send(
        app,
        ApiRequest {
            server_url: server.into(),
            expected_account_id: Some(account.into()),
            path: path.into(),
            method: method.into(),
            body: body.map(|v| v.to_string()),
        },
    )
    .await?;
    let value =
        serde_json::from_str(&response.body).map_err(|_| "Invalid ritual server response")?;
    validate_api_result(method, response.status, &value)?;
    Ok((response.status, value))
}
fn valid_definition(value: &Value) -> bool {
    value["id"].as_str().is_some_and(|id| !id.is_empty())
        && matches!(value["kind"].as_str(), Some("morning" | "night"))
        && value["revision"]
            .as_u64()
            .is_some_and(|revision| revision > 0)
        && value["enabled"].is_boolean()
        && value["title"].is_string()
        && value["time"].is_string()
        && value["timeZone"].is_string()
        && value["enabledAt"]
            .as_str()
            .is_some_and(|at| chrono::DateTime::parse_from_rfc3339(at).is_ok())
        && value["steps"].as_array().is_some_and(|steps| {
            !steps.is_empty()
                && steps.len() <= 20
                && steps.iter().all(|step| {
                    step["id"].is_string()
                        && step["label"].is_string()
                        && matches!(
                            step["kind"].as_str(),
                            Some(
                                "checkbox"
                                    | "short_text"
                                    | "time"
                                    | "date"
                                    | "number"
                                    | "multiple_choice"
                            )
                        )
                })
        })
}
fn valid_occurrence(value: &Value) -> bool {
    value["id"].is_string()
        && value["ritualId"].is_string()
        && valid_definition(&value["definition"])
        && value["revision"]
            .as_u64()
            .is_some_and(|revision| revision > 0)
        && matches!(
            value["status"].as_str(),
            Some("pending" | "completed" | "skipped" | "missed" | "cancelled_configuration")
        )
        && ["dueAt", "expiresAt"].iter().all(|field| {
            value[*field]
                .as_str()
                .is_some_and(|at| chrono::DateTime::parse_from_rfc3339(at).is_ok())
        })
        && value["responses"].as_array().is_some_and(|items| {
            items.iter().all(|response| {
                response["id"].is_string()
                    && response["stepId"].is_string()
                    && response["submitted"].is_boolean()
                    && (response["value"].is_string() || response["value"].is_boolean())
            })
        })
        && value["actions"].as_array().is_some_and(|items| {
            items
                .iter()
                .all(|action| action["id"].is_string() && action["kind"].is_string())
        })
}
fn valid_state(value: &Value) -> bool {
    value["definitions"].as_array().is_some_and(|definitions| {
        definitions.len() <= 2 && definitions.iter().all(valid_definition)
    }) && value
        .get("current")
        .is_some_and(|current| current.is_null() || valid_occurrence(current))
        && value.get("upcoming").is_none_or(|upcoming| {
            upcoming
                .as_array()
                .is_some_and(|items| items.iter().all(valid_occurrence))
        })
        && value["serverNow"]
            .as_str()
            .is_some_and(|at| chrono::DateTime::parse_from_rfc3339(at).is_ok())
        && value["snoozeCount"].is_u64()
        && matches!(
            value["syncStatus"].as_str(),
            Some("saved" | "queued" | "conflict")
        )
}
fn validate_api_result(method: &str, status: u16, value: &Value) -> Result<(), String> {
    if !(200..300).contains(&status) {
        return Ok(());
    }
    let valid = if method == "POST" {
        valid_state(&value["state"])
            && match value["outcome"].as_str() {
                Some("applied" | "conflict") => true,
                Some("confirmation_required") => {
                    value["count"].is_u64() && value["challengeId"].is_string()
                }
                _ => false,
            }
    } else {
        valid_state(value)
    };
    if valid {
        Ok(())
    } else {
        Err("Invalid ritual server response".into())
    }
}
fn retryable_ritual_status(status: u16) -> bool {
    matches!(status, 408 | 429 | 500..=599)
}
fn queue(data: &Value) -> Vec<Value> {
    data["queue"].as_array().cloned().unwrap_or_default()
}
fn automatic_snooze_confirmation(item: &Value, result: &Value) -> Option<Value> {
    let request_id = item["autoConfirmRequestId"].as_str()?;
    if item["body"]["kind"] != "snooze"
        || result["outcome"] != "confirmation_required"
        || result["historyUnavailable"] == true
        || !result["count"].as_u64().is_some_and(|count| count < 2)
        || !result["state"]["current"]["revision"].is_u64()
        || !result["challengeId"].is_string()
    {
        return None;
    }
    let mut next = item.clone();
    next.as_object_mut()?.remove("autoConfirmRequestId");
    next["body"]["requestId"] = json!(request_id);
    next["body"]["kind"] = json!("confirm_snooze");
    next["body"]["expectedRevision"] = result["state"]["current"]["revision"].clone();
    next["body"]["challengeId"] = result["challengeId"].clone();
    next["body"]["displayedCount"] = result["count"].clone();
    Some(next)
}

async fn sync(
    app: &tauri::AppHandle,
    server: &str,
    account: &str,
    generation: u64,
    data: &mut Value,
) -> Result<(), String> {
    let (status, latest) = api(app, server, account, "/v1/rituals/current", "GET", None).await?;
    if status != 200 {
        return Err(format!("Rituals unavailable (HTTP {status})"));
    }
    if app
        .state::<DesktopState>()
        .generation
        .load(Ordering::SeqCst)
        != generation
    {
        return Err("Account changed".into());
    }
    purge_deleted(data, &latest);
    archive_conflicts(data);
    let mut pending = queue(data);
    while let Some(item) = pending.first().cloned() {
        let (status, result) = api(
            app,
            server,
            account,
            item["path"].as_str().ok_or("Invalid queued path")?,
            item["method"].as_str().ok_or("Invalid queued method")?,
            Some(item["body"].clone()),
        )
        .await?;
        if app
            .state::<DesktopState>()
            .generation
            .load(Ordering::SeqCst)
            != generation
        {
            return Err("Account changed".into());
        }
        if retryable_ritual_status(status) {
            return Err("The ritual server is temporarily unavailable.".into());
        }
        if !(200..300).contains(&status) || result["outcome"] == "conflict" {
            pending[0]["conflict"] = json!(true);
            pending[0]["serverError"] = result["error"]["message"].clone();
            data["queue"] = json!(pending);
            archive_conflicts(data);
            pending = queue(data);
            write(app, &identity_key(server, account), data).await?;
            continue;
        }
        if let Some(next) = automatic_snooze_confirmation(&item, &result) {
            pending[0] = next;
            data["state"] = result["state"].clone();
            data["queue"] = json!(pending);
            // Persist the stable follow-up identity before attempting the network.
            write(app, &identity_key(server, account), data).await?;
            continue;
        }
        pending.remove(0);
        data["queue"] = json!(pending);
        write(app, &identity_key(server, account), data).await?;
    }
    data["queue"] = json!(pending);
    if pending.is_empty() {
        let (status, value) = api(app, server, account, "/v1/rituals/current", "GET", None).await?;
        if status != 200 {
            return Err(format!("Rituals unavailable (HTTP {status})"));
        }
        if app
            .state::<DesktopState>()
            .generation
            .load(Ordering::SeqCst)
            != generation
        {
            return Err("Account changed".into());
        }
        adopt_authoritative(data, value);
    }
    write(app, &identity_key(server, account), data).await
}
#[tauri::command]
pub async fn ritual_ready(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    occurrence_id: String,
) -> Result<(), String> {
    if window.label() != "ritual" {
        return Err("Invalid ritual window".into());
    }
    let runtime = app.state::<RitualRuntime>();
    let _lock = runtime.lock.lock().await;
    identity(&app).await?;
    if runtime.shown.lock().await.as_deref() != Some(occurrence_id.as_str()) {
        return Err("Ritual changed".into());
    }
    if runtime.ready.lock().await.as_deref() == Some(occurrence_id.as_str()) {
        return Ok(());
    }
    let state = runtime
        .presentation
        .lock()
        .await
        .clone()
        .ok_or("Ritual closed")?;
    let kind = &state["current"]["definition"]["kind"];
    let native = crate::native::call(
        &app,
        json!({"op":"ritual_backdrop","visible":true,"kind":kind}),
    )
    .await?;
    if native["visible"] != true {
        hide(&app).await;
        return Err("Ritual presentation unavailable".into());
    }
    #[cfg(target_os = "macos")]
    let address = window.ns_window().map_err(|e| e.to_string())? as usize;
    #[cfg(not(target_os = "macos"))]
    let address = 0usize;
    window.set_focus().map_err(|e| e.to_string())?;
    let styled = crate::native::call(
        &app,
        json!({"op":"ritual_style_checklist","windowAddress":address,"animate":true,"kind":kind}),
    )
    .await?;
    if styled["prepared"] != true {
        hide(&app).await;
        return Err("Ritual checklist unavailable; retrying presentation".into());
    }
    *runtime.ready.lock().await = Some(occurrence_id);
    Ok(())
}
#[tauri::command]
pub async fn ritual_state(app: tauri::AppHandle) -> Result<Value, String> {
    let runtime = app.state::<RitualRuntime>();
    let _lock = runtime.lock.lock().await;
    let (server, account, _) = identity(&app).await?;
    if let Some(state) = runtime.preview.lock().await.clone() {
        if state["previewIdentity"].as_str() == Some(identity_key(&server, &account).as_str()) {
            return Ok(state);
        }
    }
    let data = read(&app, &identity_key(&server, &account)).await?;
    if data["state"].is_null() {
        return Err(
            "Waiting for the ritual server. Open Settings → Rituals to configure your day.".into(),
        );
    }
    Ok(data["state"].clone())
}
#[tauri::command]
pub async fn ritual_preferences(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let runtime = app.state::<RitualRuntime>();
    let _lock = runtime.lock.lock().await;
    let (server, account, _) = identity(&app).await?;
    let key = identity_key(&server, &account);
    let mut data = read(&app, &key).await?;
    data["enabled"] = json!(enabled);
    if !enabled {
        *runtime.manual.lock().await = None;
    }
    write(&app, &key, &data).await?;
    present(&app, &data, false).await
}
#[tauri::command]
pub async fn ritual_open(app: tauri::AppHandle) -> Result<(), String> {
    if crate::updates::startup_blocking(&app) {
        return Err("Open nohmi before starting a ritual".into());
    }
    let runtime = app.state::<RitualRuntime>();
    let _lock = runtime.lock.lock().await;
    let (server, account, generation) = identity(&app).await?;
    let mut data = read(&app, &identity_key(&server, &account)).await?;
    let synced = sync(&app, &server, &account, generation, &mut data).await;
    if !can_open_current(&data["state"], &current_time()) {
        synced?;
        return Err(
            "No current ritual is available. Open Ritual settings to configure or preview one."
                .into(),
        );
    }
    present(&app, &data, true).await
}
#[tauri::command]
pub async fn ritual_preview(
    app: tauri::AppHandle,
    state: Option<Value>,
    completed: Option<bool>,
) -> Result<(), String> {
    let runtime = app.state::<RitualRuntime>();
    let _lock = runtime.lock.lock().await;
    let (server, account, _) = identity(&app).await?;
    if state.is_none() && completed == Some(true) {
        animate_completion(&app).await;
    }
    hide(&app).await;
    *runtime.manual.lock().await = None;
    if let Some(mut state) = state {
        if !matches!(
            state["current"]["definition"]["kind"].as_str(),
            Some("morning" | "night")
        ) || !state["current"]["definition"]["steps"]
            .as_array()
            .is_some_and(|s| !s.is_empty() && s.len() <= 20)
        {
            return Err("Invalid ritual preview".into());
        }
        state["preview"] = json!(true);
        state["previewIdentity"] = json!(identity_key(&server, &account));
        state["current"]["status"] = json!("pending");
        state["current"]["dueAt"] = json!(current_time());
        state["current"]["expiresAt"] =
            json!((chrono::Utc::now() + chrono::Duration::hours(1)).to_rfc3339());
        *runtime.preview.lock().await = Some(state);
        present(&app, &json!({}), true).await?;
    }
    Ok(())
}
#[tauri::command]
pub async fn ritual_mutate(
    app: tauri::AppHandle,
    path: String,
    method: String,
    body: Value,
    auto_confirm_request_id: Option<String>,
) -> Result<Value, String> {
    if !path.starts_with("/v1/rituals/occurrences/") || !matches!(method.as_str(), "PUT" | "POST") {
        return Err("Invalid ritual operation".into());
    }
    let runtime = app.state::<RitualRuntime>();
    let _lock = runtime.lock.lock().await;
    let (server, account, generation) = identity(&app).await?;
    let key = identity_key(&server, &account);
    let mut data = read(&app, &key).await?;
    if data["state"]["current"].is_null() {
        return Err("No ritual is available".into());
    }
    let id = data["state"]["current"]["id"]
        .as_str()
        .ok_or("Missing occurrence")?;
    if !path.starts_with(&format!("/v1/rituals/occurrences/{id}/")) {
        return Err("The ritual has changed".into());
    }
    let mut pending = queue(&data);
    if pending.len() >= 100 {
        return Err("Sync pending changes before adding more.".into());
    }
    let request_id = body["requestId"]
        .as_str()
        .ok_or("Missing request identity")?
        .to_owned();
    if pending.iter().any(|p| p["body"]["requestId"] == request_id) {
        return Err("This action is already waiting to sync.".into());
    }
    pending.push(json!({"path":path,"method":method,"body":body,"autoConfirmRequestId":auto_confirm_request_id,"ritualId":data["state"]["current"]["ritualId"]}));
    data["queue"] = json!(pending);
    write(&app, &key, &data).await?;
    while pending.len() == 1 {
        let item = pending[0].clone();
        let active_body = &item["body"];
        if let Ok((status, result)) = api(
            &app,
            &server,
            &account,
            item["path"].as_str().ok_or("Invalid queued path")?,
            item["method"].as_str().ok_or("Invalid queued method")?,
            Some(active_body.clone()),
        )
        .await
        {
            if app
                .state::<DesktopState>()
                .generation
                .load(Ordering::SeqCst)
                != generation
            {
                return Err("Account changed".into());
            }
            if !retryable_ritual_status(status) {
                data["queue"] = json!([]);
                if (200..300).contains(&status) {
                    if let Some(next) = automatic_snooze_confirmation(&item, &result) {
                        pending[0] = next;
                        data["state"] = result["state"].clone();
                        data["queue"] = json!(pending);
                        write(&app, &key, &data).await?;
                        continue;
                    }
                    data["state"] = if method == "POST" {
                        result["state"].clone()
                    } else {
                        result.clone()
                    };
                    if result["outcome"] == "applied" && active_body["kind"] == "confirm_snooze" {
                        record_local_snooze(&mut data, active_body);
                    }
                    if dismisses_action(active_body, &result) {
                        *runtime.manual.lock().await = None;
                    }
                    write(&app, &key, &data).await?;
                    if body["kind"] == "complete" && result["outcome"] == "applied" {
                        animate_completion(&app).await;
                    }
                    present(&app, &data, false).await?;
                    return Ok(result);
                }
                pending[0]["conflict"] = json!(true);
                pending[0]["serverError"] = result["error"]["message"].clone();
                data["queue"] = json!(pending);
                archive_conflicts(&mut data);
                data["state"]["syncStatus"] = json!("conflict");
                write(&app, &key, &data).await?;
                return Err(result["error"]["message"]
                    .as_str()
                    .unwrap_or("The ritual changed. Review pending changes in Settings.")
                    .into());
            }
        }
        break;
    }
    if app
        .state::<DesktopState>()
        .generation
        .load(Ordering::SeqCst)
        != generation
    {
        return Err("Account changed".into());
    }
    // Unknown offline history requires an explicit decision. Do not let a later
    // sync silently auto-confirm a challenge the user is still considering.
    let active = pending.last_mut().ok_or("Missing queued mutation")?;
    active
        .as_object_mut()
        .ok_or("Invalid queued mutation")?
        .remove("autoConfirmRequestId");
    let active_body = active["body"].clone();
    data["queue"] = json!(pending);
    write(&app, &key, &data).await?;
    let result = apply_offline(&mut data, &path, &method, &active_body)?;
    if dismisses_action(&active_body, &result) {
        *runtime.manual.lock().await = None;
    }
    write(&app, &key, &data).await?;
    if body["kind"] == "complete" && result["outcome"] == "applied" {
        animate_completion(&app).await;
    }
    present(&app, &data, false).await?;
    Ok(result)
}
pub(crate) fn decode_segment(segment: &str) -> Result<String, String> {
    let mut decoded = Vec::with_capacity(segment.len());
    let mut bytes = segment.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let high = bytes.next().and_then(|b| (b as char).to_digit(16));
            let low = bytes.next().and_then(|b| (b as char).to_digit(16));
            match (high, low) {
                (Some(high), Some(low)) => decoded.push((high * 16 + low) as u8),
                _ => return Err("Invalid encoded step".into()),
            }
        } else {
            decoded.push(byte);
        }
    }
    String::from_utf8(decoded).map_err(|_| "Invalid encoded step".into())
}

fn apply_offline(
    data: &mut Value,
    path: &str,
    method: &str,
    body: &Value,
) -> Result<Value, String> {
    let now = current_time();
    let local_count = local_snooze_count(data, &data["state"]["current"]["ritualId"], &now);
    if body["kind"] == "confirm_snooze" {
        record_local_snooze(data, body);
    }
    let state = &mut data["state"];
    state["syncStatus"] = json!("queued");
    let current = &mut state["current"];
    if current["status"] != "pending"
        || current["expiresAt"]
            .as_str()
            .is_some_and(|v| v <= now.as_str())
    {
        return Err("This ritual has expired. Your attempt is saved for review.".into());
    }
    current["revision"] = json!(current["revision"].as_u64().unwrap_or(1) + 1);
    if method == "PUT" {
        let step_id = decode_segment(path.rsplit('/').next().ok_or("Missing step")?)?;
        let responses = current["responses"]
            .as_array_mut()
            .ok_or("Invalid ritual responses")?;
        responses.retain(|response| response["stepId"] != step_id);
        responses.push(json!({"id":body["requestId"],"requestId":body["requestId"],"stepId":step_id,"value":body["value"],"submitted":body["submitted"],"observedAt":body["observedAt"],"recordedAt":now}));
        return Ok(state.clone());
    }
    match body["kind"].as_str() {
        Some("complete") => {
            let done = current["definition"]["steps"]
                .as_array()
                .is_some_and(|steps| {
                    steps.iter().all(|step| {
                        let answer = current["responses"]
                            .as_array()
                            .and_then(|r| r.iter().rev().find(|r| r["stepId"] == step["id"]));
                        answer.is_some_and(|r| {
                            r["submitted"] == true
                                && if step["kind"] == "checkbox" {
                                    r["value"] == true
                                } else {
                                    r["value"].as_str().is_some_and(|v| {
                                        if v.trim().is_empty() {
                                            return false;
                                        }
                                        match step["kind"].as_str() {
                                            Some("time") => {
                                                v.len() == 5
                                                    && chrono::NaiveTime::parse_from_str(v, "%H:%M")
                                                        .is_ok()
                                            }
                                            Some("date") => {
                                                v.len() == 10
                                                    && chrono::NaiveDate::parse_from_str(
                                                        v, "%Y-%m-%d",
                                                    )
                                                    .is_ok()
                                            }
                                            Some("number") => {
                                                v.parse::<f64>().is_ok_and(|n| n.is_finite())
                                            }
                                            Some("multiple_choice") => {
                                                step["options"].as_array().is_some_and(|options| {
                                                    options
                                                        .iter()
                                                        .any(|option| option.as_str() == Some(v))
                                                })
                                            }
                                            _ => true,
                                        }
                                    })
                                }
                        })
                    })
                });
            if done {
                current["status"] = json!("completed");
                current["settledAt"] = json!(now);
            }
            Ok(json!({"outcome": if done { "applied" } else { "conflict" }, "state":state}))
        }
        Some("snooze") => Ok(
            json!({"outcome":"confirmation_required","count":local_count,"challengeId":body["requestId"],"historyUnavailable":true,"state":state}),
        ),
        Some("confirm_snooze") => {
            current["snoozedUntil"] = json!((chrono::Utc::now() + chrono::Duration::minutes(10))
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
            state["snoozeCount"] = json!(state["snoozeCount"].as_u64().unwrap_or(0) + 1);
            Ok(json!({"outcome":"applied","state":state}))
        }
        Some("skip") => {
            current["status"] = json!("skipped");
            current["settledAt"] = json!(now);
            Ok(json!({"outcome":"applied","state":state}))
        }
        Some("cancel_snooze") => Ok(json!({"outcome":"applied","state":state})),
        _ => Err("Invalid ritual action".into()),
    }
}
fn delivery_health(stage: Option<&str>, at: chrono::DateTime<chrono::Utc>) -> Value {
    match stage {
        Some(stage @ ("identity" | "store_read" | "sync" | "store_write" | "presentation")) => {
            json!({
                "stage":stage,
                "failedAt":at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                "nextRetryAt":(at + chrono::Duration::seconds(5)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
            })
        }
        _ => Value::Null,
    }
}
fn health_for_generation(health: &(u64, Value), generation: u64) -> Value {
    if health.0 == generation {
        health.1.clone()
    } else {
        Value::Null
    }
}

async fn wait_for_refresh(refresh: &Notify) -> bool {
    tokio::select! {
        _ = refresh.notified() => true,
        _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => false,
    }
}

pub async fn run(app: tauri::AppHandle) {
    let mut force_sync = true;
    let mut last_sync = std::time::Instant::now() - std::time::Duration::from_secs(30);
    loop {
        {
            let runtime = app.state::<RitualRuntime>();
            let _lock = runtime.lock.lock().await;
            let generation = app
                .state::<DesktopState>()
                .generation
                .load(Ordering::SeqCst);
            let unhealthy =
                !health_for_generation(&*runtime.health.lock().await, generation).is_null();
            let mut failure = None;
            match identity(&app).await {
                Ok((server, account, identity_generation)) => {
                    let key = identity_key(&server, &account);
                    match read(&app, &key).await {
                        Ok(mut data) => {
                            if force_sync
                                || unhealthy
                                || last_sync.elapsed() >= std::time::Duration::from_secs(30)
                                || !queue(&data).is_empty()
                            {
                                // Bound stale transport before falling back to cached delivery.
                                if !matches!(
                                    tokio::time::timeout(
                                        std::time::Duration::from_secs(10),
                                        sync(
                                            &app,
                                            &server,
                                            &account,
                                            identity_generation,
                                            &mut data
                                        )
                                    )
                                    .await,
                                    Ok(Ok(()))
                                ) {
                                    failure = Some("sync");
                                }
                                last_sync = std::time::Instant::now();
                            }
                            let before = data.clone();
                            advance_offline(&mut data, &current_time());
                            if data != before && write(&app, &key, &data).await.is_err() {
                                failure = Some("store_write");
                            }
                            if app
                                .state::<DesktopState>()
                                .generation
                                .load(Ordering::SeqCst)
                                == identity_generation
                            {
                                if present(&app, &data, false).await.is_err() {
                                    failure = Some("presentation");
                                }
                            } else {
                                hide(&app).await;
                            }
                        }
                        Err(_) => {
                            failure = Some("store_read");
                            hide(&app).await;
                        }
                    }
                }
                Err(_) => {
                    failure = Some("identity");
                    hide(&app).await;
                }
            }
            let active_generation = app
                .state::<DesktopState>()
                .generation
                .load(Ordering::SeqCst);
            *runtime.health.lock().await = (
                active_generation,
                if generation == active_generation {
                    delivery_health(failure, chrono::Utc::now())
                } else {
                    Value::Null
                },
            );
        }
        force_sync = wait_for_refresh(&app.state::<RitualRuntime>().refresh).await;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn failed_native_presentation_resets_stale_ready_window_for_recreation() {
        let runtime = RitualRuntime::default();
        *runtime.ready.lock().await = Some("today".into());
        *runtime.shown.lock().await = Some("today".into());
        *runtime.presentation.lock().await = Some(json!({"current":{"id":"today"}}));
        reset_presentation(&runtime).await;
        assert!(runtime.ready.lock().await.is_none());
        assert!(runtime.shown.lock().await.is_none());
        assert!(runtime.presentation.lock().await.is_none());
        // The next scheduling pass can create and prepare the same occurrence.
        *runtime.shown.lock().await = Some("today".into());
        assert!(runtime.ready.lock().await.is_none());
    }

    #[test]
    fn temporary_http_failures_keep_mutations_retryable() {
        for status in [408, 429, 500, 502, 503, 599] {
            assert!(retryable_ritual_status(status));
        }
        for status in [200, 400, 401, 403, 404, 409, 422] {
            assert!(!retryable_ritual_status(status));
        }
    }

    #[test]
    fn protocol_validation_accepts_real_states_and_rejects_partial_successes() {
        let definition = json!({"id":"morning","kind":"morning","title":"Morning","enabled":true,"revision":1,"time":"06:00","timeZone":"UTC","enabledAt":"2026-09-29T00:00:00Z","steps":[{"id":"one","label":"One","kind":"checkbox"}]});
        let occurrence = json!({"id":"today","ritualId":"morning","definition":definition,"revision":1,"status":"pending","dueAt":"2026-09-29T06:00:00Z","expiresAt":"2026-09-30T06:00:00Z","responses":[],"actions":[]});
        let state = json!({"definitions":[definition],"current":occurrence,"upcoming":[],"serverNow":"2026-09-29T12:00:00Z","snoozeCount":0,"syncStatus":"saved"});
        assert!(validate_api_result("GET", 200, &state).is_ok());
        assert!(validate_api_result("PUT", 200, &state).is_ok());
        let empty = json!({"definitions":[],"current":null,"serverNow":"2026-09-29T12:00:00Z","snoozeCount":0,"syncStatus":"saved"});
        assert!(validate_api_result("GET", 200, &empty).is_ok());
        for outcome in ["applied", "conflict"] {
            assert!(
                validate_api_result("POST", 200, &json!({"outcome":outcome,"state":state})).is_ok()
            );
        }
        assert!(validate_api_result("POST", 200, &json!({"outcome":"confirmation_required","count":0,"challengeId":"challenge","state":state})).is_ok());
        for malformed in [
            json!({}),
            json!(null),
            json!({"definitions":[]}),
            json!({"outcome":"applied"}),
        ] {
            assert!(validate_api_result("GET", 200, &malformed).is_err());
            assert!(validate_api_result("POST", 200, &malformed).is_err());
        }
        for field in [
            "definitions",
            "current",
            "serverNow",
            "snoozeCount",
            "syncStatus",
        ] {
            let mut malformed = state.clone();
            malformed.as_object_mut().unwrap().remove(field);
            assert!(
                validate_api_result("GET", 200, &malformed).is_err(),
                "missing {field}"
            );
        }
        let mut malformed = state.clone();
        malformed["current"]["responses"] = json!([{"value":"private"}]);
        assert!(validate_api_result("PUT", 200, &malformed).is_err());
        assert!(validate_api_result(
            "POST",
            200,
            &json!({"outcome":"confirmation_required","state":state})
        )
        .is_err());
        assert!(
            validate_api_result("GET", 503, &json!({"error":{"message":"unavailable"}})).is_ok()
        );
    }

    #[test]
    fn recovery_gate_keeps_queued_conflicted_and_quarantined_evidence_until_discard() {
        let mut recovered = json!({"queue":[{"body":{"value":"unsynced answer"}}],"conflicts":[]});
        assert!(has_recovery_evidence(&recovered));
        recovered["queue"] = json!([]);
        recovered["conflicts"] = json!([{"body":{"value":"rejected correction"}}]);
        assert!(has_recovery_evidence(&recovered));
        recovered["conflicts"] = json!([]);
        recovered["storageWarning"] = json!(true);
        assert!(has_recovery_evidence(&recovered));
        recovered["storageWarning"] = json!(false);
        assert!(!has_recovery_evidence(&recovered));
        assert_eq!(
            identity_key("https://server.test", "previous-account"),
            "https://server.test|previous-account"
        );
    }

    #[test]
    fn delivery_health_is_redacted_retryable_and_clears_on_recovery_or_account_change() {
        let at = chrono::DateTime::parse_from_rfc3339("2026-09-29T12:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        for stage in [
            "identity",
            "store_read",
            "sync",
            "store_write",
            "presentation",
        ] {
            let health = delivery_health(Some(stage), at);
            assert_eq!(
                health,
                json!({"stage":stage,"failedAt":"2026-09-29T12:00:00.000Z","nextRetryAt":"2026-09-29T12:00:05.000Z"})
            );
            assert_eq!(health_for_generation(&(2, health.clone()), 2), health);
            assert!(health_for_generation(&(2, health), 3).is_null());
        }
        assert!(delivery_health(None, at).is_null());
        assert!(delivery_health(Some("private response or raw provider error"), at).is_null());
    }

    #[tokio::test]
    async fn native_refresh_wakes_only_ritual_loop_and_coalesces_bursts() {
        let runtime = RitualRuntime::default();
        let coordinator_refresh = Notify::new();
        runtime.refresh.notify_one();
        runtime.refresh.notify_one();
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(100),
            wait_for_refresh(&runtime.refresh)
        )
        .await
        .unwrap());
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(10),
            wait_for_refresh(&runtime.refresh)
        )
        .await
        .is_err());
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(10),
            coordinator_refresh.notified()
        )
        .await
        .is_err());
        let state = json!({"current":{"status":"pending","dueAt":"2026-09-29T06:00:00Z","expiresAt":"2026-09-29T21:00:00Z"}});
        assert!(!should_show(&state, "2026-09-29T05:59:59Z"));
        runtime.refresh.notify_one();
        assert!(wait_for_refresh(&runtime.refresh).await);
        assert!(should_show(&state, "2026-09-29T06:00:00Z"));
    }

    #[test]
    fn respects_due_expiry_and_snooze() {
        let mut s = json!({"current":{"status":"pending","dueAt":"2026-09-29T06:00:00Z","expiresAt":"2026-09-29T21:00:00Z"}});
        assert!(should_show(&s, "2026-09-29T08:00:00Z"));
        s["current"]["snoozedUntil"] = json!("2026-09-29T08:10:00Z");
        assert!(!should_show(&s, "2026-09-29T08:00:00Z"));
        assert!(!should_show(&s, "2026-09-29T22:00:00Z"));
    }
}

#[tauri::command]
pub async fn ritual_local(app: tauri::AppHandle, discard: bool) -> Result<Value, String> {
    let runtime = app.state::<RitualRuntime>();
    let _lock = runtime.lock.lock().await;
    let (server, account, generation, recovery) = local_identity(&app)
        .await?
        .ok_or("Sign in to use rituals.")?;
    let key = identity_key(&server, &account);
    let mut data = read(&app, &key).await?;
    if discard {
        crate::native::call(&app, json!({"op":"ritual_store_delete","identity":key})).await?;
        if let Some(object) = data.as_object_mut() {
            object.remove("storageWarning");
        }

        data["queue"] = json!([]);
        data["localHistory"] = json!([]);
        data["conflicts"] = json!([]);
        data["state"] = Value::Null;
        write(&app, &key, &data).await?;
        if !recovery {
            let _ = sync(&app, &server, &account, generation, &mut data).await;
        }
    }
    let mut evidence = queue(&data);
    evidence.extend(data["conflicts"].as_array().cloned().unwrap_or_default());
    let health = health_for_generation(
        &*runtime.health.lock().await,
        app.state::<DesktopState>()
            .generation
            .load(Ordering::SeqCst),
    );
    Ok(
        json!({"queue":evidence,"enabled":data["enabled"],"localHistory":data["localHistory"],"deliveryHealth":health,"recovery":recovery,"storageWarning":data["storageWarning"] == true}),
    )
}
pub async fn require_synced(app: &tauri::AppHandle) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Ok(());
    }
    if let Some((server, account, _, _)) = local_identity(app).await? {
        let data = read(app, &identity_key(&server, &account)).await?;
        if has_recovery_evidence(&data) {
            return Err("Ritual changes are waiting to sync. Open Settings → Rituals to export or discard them before signing out or switching servers.".into());
        }
    }
    Ok(())
}
#[cfg(test)]
mod recovery_tests {
    use super::*;
    #[test]
    fn sleep_catches_up_from_cached_horizon_without_stacking() {
        let mut data = json!({"state":{"current":{"id":"old","dueAt":"2026-09-29T06:00:00Z","expiresAt":"2026-09-29T21:00:00Z","status":"pending","responses":[{"value":"partial"}]},"upcoming":[{"id":"night","dueAt":"2026-09-29T21:00:00Z","expiresAt":"2026-09-30T06:00:00Z","status":"pending"},{"id":"morning","dueAt":"2026-09-30T06:00:00Z","expiresAt":"2026-09-30T21:00:00Z","status":"pending"}]}});
        data["queue"] = json!([{"path":"/v1/rituals/occurrences/old/responses/one"}]);
        advance_offline(&mut data, "2026-09-30T08:00:00Z");
        assert_eq!(data["state"]["current"]["id"], "morning");
        assert_eq!(data["localHistory"][0]["status"], "missed");
        assert_eq!(data["localHistory"][0]["responses"][0]["value"], "partial");
        advance_offline(&mut data, "2026-09-30T08:00:00Z");
        assert_eq!(data["localHistory"].as_array().unwrap().len(), 1);
    }
}

fn advance_offline(data: &mut Value, now: &str) {
    let next = data["state"]["upcoming"]
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .filter(|item| {
                    item["dueAt"].as_str().is_some_and(|t| t <= now)
                        && item["expiresAt"].as_str().is_some_and(|t| t > now)
                })
                .last()
        })
        .cloned();
    if let Some(next) = next {
        let current = &data["state"]["current"];
        if current["id"] == next["id"]
            || current["dueAt"]
                .as_str()
                .is_some_and(|t| t >= next["dueAt"].as_str().unwrap_or(""))
        {
            return;
        }
        let mut old = current.clone();
        if old["status"] == "pending" {
            old["status"] = json!("missed");
            old["settledAt"] = next["dueAt"].clone();
        }
        let mut history = data["localHistory"].as_array().cloned().unwrap_or_default();
        if has_pending_evidence(data, &old) {
            history.push(old);
        }
        data["localHistory"] = json!(history);
        data["state"]["current"] = next;
        data["state"]["snoozeCount"] = json!(0);
        data["state"]["syncStatus"] = json!("queued");
    }
}

fn purge_deleted(data: &mut Value, latest: &Value) {
    let ids: Vec<Value> = latest["definitions"]
        .as_array()
        .map(|defs| defs.iter().map(|d| d["id"].clone()).collect())
        .unwrap_or_default();
    let retained: Vec<Value> = queue(data)
        .into_iter()
        .filter(|item| ids.contains(&item["ritualId"]))
        .collect();
    data["queue"] = json!(retained);
    let history: Vec<Value> = data["localHistory"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|item| ids.contains(&item["ritualId"]))
        .collect();
    data["localHistory"] = json!(history);
    for field in ["conflicts", "localSnoozes"] {
        let retained: Vec<Value> = data[field]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|item| ids.contains(&item["ritualId"]))
            .collect();
        data[field] = json!(retained);
    }
    data["state"]["definitions"] = latest["definitions"].clone();
    data["state"]["upcoming"] = latest["upcoming"].clone();
    if !ids.contains(&data["state"]["current"]["ritualId"]) {
        data["state"] = latest.clone();
    }
}

#[cfg(test)]
mod deletion_tests {
    use super::*;
    #[test]
    fn purges_deleted_rituals_but_preserves_other_pending_evidence() {
        let mut data = json!({"state":{"current":{"ritualId":"deleted"}},"queue":[{"ritualId":"deleted"},{"ritualId":"kept"}],"localHistory":[{"ritualId":"deleted"},{"ritualId":"kept"}]});
        let latest = json!({"definitions":[{"id":"kept"}],"current":null});
        purge_deleted(&mut data, &latest);
        assert_eq!(data["queue"], json!([{"ritualId":"kept"}]));
        assert_eq!(data["localHistory"], json!([{"ritualId":"kept"}]));
        assert_eq!(data["state"], latest);
    }
    #[test]
    fn offline_snooze_requires_confirmation_and_cancel_does_not_defer() {
        let mut data = json!({"state":{"current":{"status":"pending","revision":1,"expiresAt":"2099-01-01T00:00:00Z"},"snoozeCount":0}});
        let result = apply_offline(
            &mut data,
            "/actions",
            "POST",
            &json!({"kind":"snooze","requestId":"stable"}),
        )
        .unwrap();
        assert_eq!(result["challengeId"], "stable");
        assert_eq!(result["historyUnavailable"], true);
        apply_offline(
            &mut data,
            "/actions",
            "POST",
            &json!({"kind":"cancel_snooze"}),
        )
        .unwrap();
        assert_eq!(data["state"]["snoozeCount"], 0);
        assert!(data["state"]["current"]["snoozedUntil"].is_null());
    }
}

#[cfg(test)]
mod review_regressions {
    use super::*;
    #[test]
    fn conflict_does_not_block_next_occurrence_and_authoritative_state_wins() {
        let mut data = json!({"state":{"current":{"id":"old","status":"pending"}},"queue":[{"body":{"requestId":"a"},"ritualId":"morning","conflict":true},{"body":{"requestId":"b"},"ritualId":"night"}]});
        archive_conflicts(&mut data);
        assert_eq!(queue(&data).len(), 1);
        assert_eq!(queue(&data)[0]["body"]["requestId"], "b");
        assert_eq!(data["conflicts"][0]["body"]["requestId"], "a");
        let latest = json!({"current":{"id":"old","status":"completed"}});
        adopt_authoritative(&mut data, latest);
        assert_eq!(data["state"]["current"]["status"], "completed");
    }
    #[test]
    fn local_count_ages_events_and_survives_day_boundaries() {
        let data = json!({"localSnoozes":[{"ritualId":"morning","at":"2026-09-27T09:00:00Z"},{"ritualId":"morning","at":"2026-09-29T09:00:00Z"},{"ritualId":"night","at":"2026-09-29T21:00:00Z"}]});
        assert_eq!(
            local_snooze_count(&data, &json!("morning"), "2026-09-30T10:00:00Z"),
            1
        );
    }
}

fn archive_conflicts(data: &mut Value) {
    let (rejected, active): (Vec<Value>, Vec<Value>) = queue(data)
        .into_iter()
        .partition(|item| item["conflict"] == true);
    let mut conflicts = data["conflicts"].as_array().cloned().unwrap_or_default();
    conflicts.extend(rejected);
    data["conflicts"] = json!(conflicts);
    data["queue"] = json!(active);
}
// Only unsynchronized mutations need a separate recovery snapshot. Successful
// queue replay already persisted its bodies server-side; conflicts must remain.
fn has_pending_evidence(data: &Value, occurrence: &Value) -> bool {
    let Some(id) = occurrence["id"].as_str() else {
        return false;
    };
    let prefix = format!("/v1/rituals/occurrences/{id}/");
    ["queue", "conflicts"].iter().any(|field| {
        data[*field].as_array().is_some_and(|items| {
            items.iter().any(|item| {
                item["path"]
                    .as_str()
                    .is_some_and(|path| path.starts_with(&prefix))
            })
        })
    })
}

fn adopt_authoritative(data: &mut Value, state: Value) {
    let history: Vec<Value> = data["localHistory"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|occurrence| has_pending_evidence(data, occurrence))
        .collect();
    data["localHistory"] = json!(history);
    data["state"] = state;
    if data["conflicts"].as_array().is_some_and(|v| !v.is_empty()) {
        data["state"]["syncStatus"] = json!("conflict");
    }
}
fn local_snooze_count(data: &Value, ritual: &Value, now: &str) -> usize {
    let Ok(end) = chrono::DateTime::parse_from_rfc3339(now) else {
        return 0;
    };
    let start = end - chrono::Duration::hours(72);
    data["localSnoozes"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|item| {
                    item["ritualId"] == *ritual
                        && item["at"]
                            .as_str()
                            .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
                            .is_some_and(|at| at >= start && at <= end)
                })
                .count()
        })
        .unwrap_or(0)
}
fn record_local_snooze(data: &mut Value, body: &Value) {
    let mut entries = data["localSnoozes"].as_array().cloned().unwrap_or_default();
    let start = chrono::Utc::now() - chrono::Duration::hours(72);
    entries.retain(|item| {
        item["at"]
            .as_str()
            .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
            .is_some_and(|at| at >= start)
    });
    if !entries
        .iter()
        .any(|item| item["requestId"] == body["requestId"])
    {
        entries.push(json!({"requestId":body["requestId"],"ritualId":data["state"]["current"]["ritualId"],"at":body["observedAt"]}));
    }
    data["localSnoozes"] = json!(entries);
}

#[cfg(test)]
mod manual_reopen_tests {
    use super::*;
    #[test]
    fn opening_without_an_eligible_cache_falls_back_but_snoozed_cache_can_reopen() {
        let now = "2026-09-29T12:00:00Z";
        assert!(!can_open_current(&Value::Null, now));
        assert!(!can_open_current(&json!({"current":null}), now));
        let mut state = json!({"current":{"status":"pending","dueAt":"2026-09-29T06:00:00Z","expiresAt":"2026-09-29T21:00:00Z","snoozedUntil":"2026-09-29T12:10:00Z"}});
        assert!(can_open_current(&state, now));
        assert!(!can_open_current(&state, "2026-09-29T22:00:00Z"));
        state["current"]["status"] = json!("completed");
        assert!(!can_open_current(&state, now));
    }
    #[test]
    fn reopened_snooze_stays_visible_for_confirmation_drafts_and_cancellation() {
        assert!(!dismisses_action(
            &json!({"kind":"snooze"}),
            &json!({"outcome":"confirmation_required"})
        ));
        assert!(!dismisses_action(
            &json!({"kind":"cancel_snooze"}),
            &json!({"outcome":"applied"})
        ));
        assert!(dismisses_action(
            &json!({"kind":"confirm_snooze"}),
            &json!({"outcome":"applied"})
        ));
    }
}

fn dismisses_action(body: &Value, result: &Value) -> bool {
    result["outcome"] == "applied"
        && matches!(
            body["kind"].as_str(),
            Some("confirm_snooze" | "skip" | "complete")
        )
}

#[cfg(test)]
mod completion_tests {
    use super::*;

    fn pending(steps: Value) -> Value {
        json!({"state":{"current":{"id":"today","ritualId":"morning","status":"pending","revision":1,"expiresAt":"2099-01-01T00:00:00Z","definition":{"steps":steps},"responses":[]}}})
    }

    fn answer(data: &mut Value, id: &str, value: Value, submitted: bool) {
        apply_offline(data, &format!("/responses/{id}"), "PUT",
            &json!({"requestId":format!("answer-{id}"),"value":value,"submitted":submitted,"observedAt":"2026-09-29T12:00:00Z"})).unwrap();
    }

    fn complete(data: &mut Value) -> Value {
        apply_offline(data, "/actions", "POST", &json!({"kind":"complete"})).unwrap()
    }

    #[test]
    fn repeated_long_answers_keep_cache_bounded_and_legacy_cache_compacts() {
        let mut empty = json!({"state":{"current":null}});
        compact_cached_responses(&mut empty);
        assert!(empty["state"]["current"].is_null());
        let mut data = pending(json!([{"id":"journal","kind":"short_text"}]));
        let mut corrections = Vec::new();
        for index in 0..160 {
            let value = format!("{index}:{}", "x".repeat(4995));
            answer(&mut data, "journal", json!(value), true);
            assert_eq!(
                data["state"]["current"]["responses"]
                    .as_array()
                    .unwrap()
                    .len(),
                1
            );
            corrections.push(data["state"]["current"]["responses"][0].clone());
        }
        assert!(data.to_string().len() < 10000);
        let latest = corrections.last().unwrap().clone();
        data["state"]["current"]["responses"] = json!(corrections);
        data["queue"] = json!([{"body":{"value":"Queued correction"}}]);
        compact_cached_responses(&mut data);
        assert_eq!(data["state"]["current"]["responses"], json!([latest]));
        assert_eq!(data["queue"][0]["body"]["value"], "Queued correction");
        assert_eq!(complete(&mut data)["outcome"], "applied");
    }

    #[test]
    fn automatic_snooze_followup_survives_replay_with_one_stable_identity() {
        let item = json!({"path":"/v1/rituals/occurrences/today/actions","method":"POST",
            "autoConfirmRequestId":"stable-confirm","ritualId":"morning",
            "body":{"kind":"snooze","requestId":"original-press","expectedRevision":1,"deviceId":"mac","observedAt":"2026-09-29T12:00:00Z"}});
        let result = json!({"outcome":"confirmation_required","count":1,"challengeId":"original-press",
            "state":{"current":{"revision":2}}});
        let next = automatic_snooze_confirmation(&item, &result).unwrap();
        assert_eq!(next["body"]["requestId"], "stable-confirm");
        assert_eq!(next["body"]["kind"], "confirm_snooze");
        assert_eq!(next["body"]["challengeId"], "original-press");
        assert_eq!(next["body"]["expectedRevision"], 2);
        // A crash before replacement replays the original and derives the same
        // follow-up. A crash after replacement retries the exact persisted body.
        assert_eq!(automatic_snooze_confirmation(&item, &result).unwrap(), next);
        let restored: Value = serde_json::from_str(&next.to_string()).unwrap();
        assert_eq!(restored, next);
        assert!(automatic_snooze_confirmation(&restored, &result).is_none());
        for changed in [
            json!({"outcome":"confirmation_required","count":2,"challengeId":"original-press","state":{"current":{"revision":2}}}),
            json!({"outcome":"confirmation_required","count":0,"historyUnavailable":true,"challengeId":"original-press","state":{"current":{"revision":2}}}),
            json!({"outcome":"conflict","count":0,"challengeId":"original-press","state":{"current":{"revision":2}}}),
        ] {
            assert!(automatic_snooze_confirmation(&item, &changed).is_none());
        }
        let mut offline_item = item;
        offline_item
            .as_object_mut()
            .unwrap()
            .remove("autoConfirmRequestId");
        assert!(automatic_snooze_confirmation(&offline_item, &result).is_none());
    }

    #[test]
    fn encoded_step_ids_match_the_definition_without_panicking_on_bad_encoding() {
        let mut data = pending(json!([{"id":"mood / ☀+","kind":"short_text"}]));
        answer(&mut data, "mood%20%2F%20%E2%98%80%2B", json!("Good"), true);
        assert_eq!(
            data["state"]["current"]["responses"][0]["stepId"],
            "mood / ☀+"
        );
        assert_eq!(complete(&mut data)["outcome"], "applied");
        for segment in ["%", "%0", "%GG", "%FF", "%C0%AF"] {
            assert!(decode_segment(segment).is_err());
        }
        assert_eq!(decode_segment("literal+plus").unwrap(), "literal+plus");
    }

    #[test]
    fn adoption_retires_synced_history_but_keeps_unmatched_conflict_evidence() {
        let mut data = json!({"localHistory":[{"id":"synced"},{"id":"conflict"},{"id":"queued"}],
            "queue":[{"path":"/v1/rituals/occurrences/queued/responses/one"}],
            "conflicts":[{"path":"/v1/rituals/occurrences/conflict/actions","body":{"kind":"complete"}}]});
        adopt_authoritative(&mut data, json!({"current":{"id":"today"}}));
        assert_eq!(
            data["localHistory"],
            json!([{"id":"conflict"},{"id":"queued"}])
        );
        assert_eq!(data["conflicts"][0]["body"]["kind"], "complete");
        data["queue"] = json!([]);
        adopt_authoritative(&mut data, json!({"current":{"id":"today"}}));
        assert_eq!(data["localHistory"], json!([{"id":"conflict"}]));
    }

    #[test]
    fn normal_online_boundary_does_not_create_recovery_history() {
        let mut data = json!({"state":{"current":{"id":"old","dueAt":"2026-09-29T06:00:00Z","status":"pending"},
            "upcoming":[{"id":"new","dueAt":"2026-09-29T21:00:00Z","expiresAt":"2026-09-30T06:00:00Z"}]}});
        advance_offline(&mut data, "2026-09-29T22:00:00Z");
        assert_eq!(data["localHistory"], json!([]));
        assert_eq!(data["state"]["current"]["id"], "new");
    }

    #[test]
    fn autosaving_all_six_answers_stays_pending_until_explicit_completion() {
        let mut data = pending(json!([
            {"id":"check","kind":"checkbox"}, {"id":"text","kind":"short_text"},
            {"id":"time","kind":"time"}, {"id":"date","kind":"date"},
            {"id":"number","kind":"number"}, {"id":"mood","kind":"multiple_choice","options":["Good","Okay"]}
        ]));
        for (id, value) in [
            ("check", json!(true)),
            ("text", json!("Reflection")),
            ("time", json!("06:30")),
            ("date", json!("2024-02-29")),
            ("number", json!("-1.25")),
            ("mood", json!("Good")),
        ] {
            answer(&mut data, id, value, true);
            assert_eq!(data["state"]["current"]["status"], "pending");
        }
        let result = complete(&mut data);
        assert_eq!(result["outcome"], "applied");
        assert_eq!(data["state"]["current"]["status"], "completed");
        assert!(data["state"]["current"]["settledAt"].is_string());
        assert!(dismisses_action(&json!({"kind":"complete"}), &result));
        assert!(apply_offline(&mut data, "/actions", "POST", &json!({"kind":"complete"})).is_err());
    }

    #[test]
    fn incomplete_and_invalid_answers_do_not_complete_or_dismiss() {
        for (kind, value) in [
            ("checkbox", json!(false)),
            ("checkbox", json!("true")),
            ("short_text", json!("  ")),
            ("short_text", json!(true)),
            ("time", json!("24:00")),
            ("time", json!("6:30")),
            ("date", json!("2026-02-29")),
            ("date", json!("2026-13-01")),
            ("number", json!("Infinity")),
            ("number", json!("NaN")),
            ("number", json!("0xff")),
            ("number", json!("1e999")),
            ("multiple_choice", json!("Unknown")),
        ] {
            let mut data = pending(json!([{"id":"one","kind":kind,"options":["Good","Okay"]}]));
            assert_eq!(complete(&mut data)["outcome"], "conflict");
            answer(&mut data, "one", value, true);
            let result = complete(&mut data);
            assert_eq!(result["outcome"], "conflict", "kind: {kind}");
            assert_eq!(data["state"]["current"]["status"], "pending");
            assert!(!dismisses_action(&json!({"kind":"complete"}), &result));
        }
    }

    #[test]
    fn completion_uses_latest_submitted_response_and_rejects_drafts() {
        let mut data = pending(json!([{"id":"one","kind":"short_text"}]));
        answer(&mut data, "one", json!("Draft"), false);
        assert_eq!(complete(&mut data)["outcome"], "conflict");
        answer(&mut data, "one", json!("Saved"), true);
        answer(&mut data, "one", json!(""), false);
        assert_eq!(complete(&mut data)["outcome"], "conflict");
        answer(&mut data, "one", json!("Final"), true);
        assert_eq!(complete(&mut data)["outcome"], "applied");
    }
}
