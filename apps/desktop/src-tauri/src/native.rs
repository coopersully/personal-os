#[cfg(not(target_os = "macos"))]
use serde_json::json;
use serde_json::Value;
#[cfg(target_os = "macos")]
use std::ffi::{c_char, CStr, CString};
use std::sync::OnceLock;
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn ilo_native_set_callback(callback: extern "C" fn(*const c_char));
    fn ilo_native_dispatch(request: *const c_char) -> *mut c_char;
}
#[cfg(target_os = "macos")]
extern "C" fn receive_action(data: *const c_char) {
    if data.is_null() {
        return;
    }
    let Ok(value) =
        serde_json::from_str::<Value>(&unsafe { CStr::from_ptr(data) }.to_string_lossy())
    else {
        return;
    };
    if let Some(app) = APP.get() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            crate::lifecycle::action(app, value).await;
        });
    }
}
pub fn initialize(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
    #[cfg(target_os = "macos")]
    unsafe {
        ilo_native_set_callback(receive_action);
    }
}
#[cfg(target_os = "macos")]
fn dispatch(value: Value) -> Result<Value, String> {
    let request = CString::new(value.to_string()).map_err(|e| e.to_string())?;
    let ptr = unsafe { ilo_native_dispatch(request.as_ptr()) };
    if ptr.is_null() {
        return Err("The macOS companion did not respond.".into());
    }
    let text = unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned();
    unsafe {
        libc::free(ptr.cast());
    }
    let result: Value =
        serde_json::from_str(&text).map_err(|_| "Invalid macOS companion response.")?;
    if result["ok"] == false {
        return Err(result["error"]
            .as_str()
            .unwrap_or("The macOS operation failed.")
            .into());
    }
    Ok(result)
}
pub async fn call(app: &tauri::AppHandle, value: Value) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        let (send, receive) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            let _ = send.send(dispatch(value));
        })
        .map_err(|e| e.to_string())?;
        receive
            .await
            .map_err(|_| "macOS companion stopped.".to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        let operation = value["op"].as_str().unwrap_or("");
        if operation.starts_with("keychain_") {
            let origin = value["serverUrl"].as_str().ok_or("Missing server origin")?;
            let entry = keyring::Entry::new("app.personal-os.desktop.session", origin)
                .map_err(|e| e.to_string())?;
            match operation {
                "keychain_get" => {
                    return match entry.get_password() {
                        Ok(secret) => Ok(json!({"ok":true,"value":secret})),
                        Err(keyring::Error::NoEntry) => Ok(json!({"ok":true,"value":null})),
                        Err(e) => Err(e.to_string()),
                    }
                }
                "keychain_set" => entry
                    .set_password(value["value"].as_str().ok_or("Missing credential")?)
                    .map_err(|e| e.to_string())?,
                "keychain_delete" => match entry.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => {}
                    Err(e) => return Err(e.to_string()),
                },
                _ => return Err("Invalid credential operation".into()),
            }
        }
        Ok(
            json!({"ok":true,"notificationPermission":"unavailable","launchAtLogin":false,"widgetsAvailable":false,"value":null}),
        )
    }
}
