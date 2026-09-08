use crate::desktop::{api_path, canonical_server, DesktopState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiRequest {
    pub path: String,
    pub method: String,
    pub body: Option<String>,
    pub server_url: String,
    pub expected_account_id: Option<String>,
}
#[derive(Serialize)]
pub struct ApiResponse {
    pub status: u16,
    pub body: String,
}
async fn read_response(mut response: reqwest::Response) -> Result<ApiResponse, String> {
    let status = response.status().as_u16();
    if (300..400).contains(&status) {
        return Err("The API redirected this request. Use the server's final HTTPS origin.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The API response was interrupted.")?
    {
        if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
            return Err("API response exceeded the desktop limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(ApiResponse {
        status,
        body: String::from_utf8(bytes).map_err(|_| "The API returned invalid text.")?,
    })
}
pub async fn send(app: &tauri::AppHandle, request: ApiRequest) -> Result<ApiResponse, String> {
    api_path(&request.path)?;
    let pathname = request.path.split('?').next().unwrap_or("");
    if !["GET", "POST", "PATCH", "DELETE", "PUT"].contains(&request.method.as_str()) {
        return Err("Unsupported HTTP method.".into());
    }
    if request
        .body
        .as_ref()
        .is_some_and(|b| b.len() > 2 * 1024 * 1024)
    {
        return Err("Request is too large.".into());
    }
    let state = app.state::<DesktopState>();
    let settings = state.settings.lock().await;
    if request.server_url != settings.server_url {
        return Err("The selected server changed. Retry from the current account.".into());
    }
    if let Some(expected) = &request.expected_account_id {
        if state.account_id.lock().await.as_ref() != Some(expected) {
            return Err("This action belongs to a different signed-in account.".into());
        }
    }
    let generation = state.generation.load(Ordering::SeqCst);
    let mut changed = state.changed.subscribe();
    let origin = settings.server_url.clone();
    let credential =
        crate::native::call(app, json!({"op":"keychain_get","serverUrl":origin})).await?;
    let token = credential["value"].as_str().map(str::to_owned);
    if pathname == "/v1/auth/logout" && request.method == "POST" {
        crate::native::call(app, json!({"op":"keychain_delete","serverUrl":origin})).await?;
        crate::native::call(app, json!({"op":"clear"})).await?;
        *state.account_id.lock().await = None;
        *state.pending_action.lock().await = None;
        *state.deferred_action.lock().await = None;
        state.invalidate();
        let _ = app.emit("desktop-session-invalidated", ());
        let client = state.client.clone();
        tauri::async_runtime::spawn(async move {
            if let Some(token) = token {
                let _ = client
                    .post(format!("{origin}/v1/auth/logout"))
                    .header("authorization", format!("Session {token}"))
                    .send()
                    .await;
            }
        });
        return Ok(ApiResponse {
            status: 204,
            body: String::new(),
        });
    }
    drop(settings);
    let method =
        reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|e| e.to_string())?;
    let mut network = state
        .client
        .request(method, format!("{origin}{}", request.path));
    if let Some(ref token) = token {
        network = network.header("authorization", format!("Session {token}"));
    }
    if let Some(ref body) = request.body {
        network = network
            .header("content-type", "application/json")
            .body(body.clone());
    }
    let result = tokio::select! {
        result=async {read_response(network.send().await.map_err(|_|"Cannot reach the API server. Check the address and connection.")?).await}=>result,
        _=changed.changed()=>return Err("The desktop account or settings changed during this request.".into())
    };
    let mut settings = state.settings.lock().await;
    if state.generation.load(Ordering::SeqCst) != generation || settings.server_url != origin {
        return Err("The selected account changed during this request.".into());
    }
    let mut response = result?;
    if response.status == 401 && token.is_some() {
        crate::native::call(app, json!({"op":"keychain_delete","serverUrl":origin})).await?;
        crate::native::call(app, json!({"op":"clear"})).await?;
        *state.account_id.lock().await = None;
        *state.pending_action.lock().await = None;
        *state.deferred_action.lock().await = None;
        state.invalidate();
        let _ = app.emit("desktop-session-invalidated", ());
    }
    if (200..300).contains(&response.status) {
        if request.method == "POST"
            && (pathname == "/v1/auth/login" || pathname == "/v1/auth/register")
        {
            let mut value: Value = serde_json::from_str(&response.body)
                .map_err(|_| "The server did not return an ilo login response.")?;
            let account = value["user"]["id"]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or("No account was returned.")?
                .to_string();
            let token = value["sessionToken"]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or("No desktop session was returned.")?;
            crate::native::call(
                app,
                json!({"op":"keychain_set","serverUrl":origin,"value":token}),
            )
            .await?;
            activate_account(app, &state, &mut settings, &account).await?;
            value
                .as_object_mut()
                .ok_or("Invalid login response.")?
                .remove("sessionToken");
            response.body = value.to_string();
            state.invalidate();
        } else if pathname == "/v1/me" {
            if let Ok(value) = serde_json::from_str::<Value>(&response.body) {
                let account = value["user"]["id"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .ok_or("The server did not return a valid account")?;
                if state.account_id.lock().await.as_deref() != Some(account) {
                    activate_account(app, &state, &mut settings, account).await?;
                    state.invalidate();
                }
            }
        }
        if pathname == "/v1/pinterest" && request.method == "PATCH" {
            crate::wallpaper::settings_changed();
        }
        if request.method != "GET" {
            state.refresh.notify_one();
        }
    }
    Ok(response)
}
async fn activate_account(
    app: &tauri::AppHandle,
    state: &DesktopState,
    settings: &mut crate::desktop::DesktopSettings,
    account: &str,
) -> Result<(), String> {
    let next = crate::preferences::load(&state.settings_path, settings, account);
    let temporary = state.settings_path.with_extension("tmp");
    std::fs::write(
        &temporary,
        serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(temporary, &state.settings_path).map_err(|e| e.to_string())?;
    if state
        .account_id
        .lock()
        .await
        .as_deref()
        .is_some_and(|previous| previous != account)
    {
        crate::native::call(app, json!({"op":"clear"})).await?;
    }
    crate::native::call(app, json!({"op":"configure","settings":next})).await?;
    *settings = next;
    *state.account_id.lock().await = Some(account.to_string());
    let _ = app.emit("desktop-settings-changed", json!({"serverChanged":false}));
    Ok(())
}
#[tauri::command]
pub async fn desktop_request(
    app: tauri::AppHandle,
    request: ApiRequest,
) -> Result<ApiResponse, String> {
    send(&app, request).await
}
#[tauri::command]
pub async fn desktop_test_connection(
    app: tauri::AppHandle,
    server_url: String,
) -> Result<Value, String> {
    let origin = canonical_server(&server_url)?;
    let state = app.state::<DesktopState>();
    let response = read_response(
        state
            .client
            .get(format!("{origin}/v1/me"))
            .send()
            .await
            .map_err(|_| "Cannot reach this server.")?,
    )
    .await?;
    let value: Value = serde_json::from_str(&response.body)
        .map_err(|_| "This address returned a webpage instead of an ilo API response.")?;
    if response.status == 401 && value["error"]["code"] == "unauthorized" {
        return Ok(json!({"ok":true,"serverUrl":origin}));
    }
    Err(format!(
        "This server did not return the expected ilo authentication response (HTTP {}).",
        response.status
    ))
}
