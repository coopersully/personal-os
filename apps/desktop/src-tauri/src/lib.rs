mod coordinator;
mod desktop;
mod lifecycle;
mod native;
mod preferences;
mod transport;
mod wallpaper;
mod wallpaper_schedule;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            lifecycle::show(app)
        }))
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            app.manage(desktop::DesktopState::load(app.handle()).map_err(std::io::Error::other)?);
            lifecycle::setup(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    lifecycle::hide(window.app_handle());
                }
            }
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            desktop::desktop_settings,
            desktop::desktop_take_action,
            desktop::desktop_save_settings,
            desktop::desktop_native_action,
            transport::desktop_request,
            transport::desktop_test_connection,
            apply_pinterest_wallpaper,
            desktop_preview_environment
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Nomi")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                lifecycle::show(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[tauri::command]
async fn apply_pinterest_wallpaper(
    app: tauri::AppHandle,
    background_color: String,
    background_mode: String,
    board_label: String,
    corner_radius: i32,
    image_urls: Vec<String>,
    frame_spacing: i32,
    layout: String,
    mosaic_fit: String,
    padding_bottom: i32,
    padding_end: i32,
    padding_start: i32,
    padding_top: i32,
    tile_size: i32,
    rotation_degrees: i32,
) -> Result<String, String> {
    let generation = app
        .state::<desktop::DesktopState>()
        .generation
        .load(std::sync::atomic::Ordering::SeqCst);
    let revision = wallpaper::settings_revision();
    wallpaper_schedule::manual(
        &app,
        wallpaper::WallpaperRequest {
            background_color,
            background_mode,
            board_label,
            corner_radius,
            image_urls,
            frame_spacing,
            layout,
            mosaic_fit,
            padding_bottom,
            padding_end,
            padding_start,
            padding_top,
            tile_size,
            rotation_degrees,
        },
        generation,
        revision,
    )
    .await
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value
            .chars()
            .skip(1)
            .all(|character| character.is_ascii_hexdigit())
}

#[tauri::command]
fn desktop_preview_environment(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let primary_monitor = app.primary_monitor().map_err(|error| error.to_string())?;
    let monitor = app
        .get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .or(primary_monitor)
        .ok_or_else(|| "No primary display is available.".to_string())?;
    let screen = monitor.size();
    let screen_position = monitor.position();
    let work_area = monitor.work_area();
    let start = (work_area.position.x - screen_position.x).max(0) as u32;
    let top = (work_area.position.y - screen_position.y).max(0) as u32;
    let end = screen
        .width
        .saturating_sub(start)
        .saturating_sub(work_area.size.width);
    let bottom = screen
        .height
        .saturating_sub(top)
        .saturating_sub(work_area.size.height);
    let platform = std::env::consts::OS;
    Ok(serde_json::json!({
        "platform": match platform {
            "macos" => "macos",
            "windows" => "windows",
            "linux" => "linux",
            _ => "unknown",
        },
        "screen": { "width": screen.width, "height": screen.height },
        "hasNotch": mac_has_notch(),
        "safeArea": { "top": top, "bottom": bottom, "start": start, "end": end },
    }))
}

#[cfg(target_os = "macos")]
fn mac_has_notch() -> bool {
    let script = r#"
ObjC.import('AppKit');
try {
  const screen = $.NSScreen.mainScreen;
  const left = screen.auxiliaryTopLeftArea;
  const right = screen.auxiliaryTopRightArea;
  console.log(Boolean(left && right && left.size.width > 0 && right.size.width > 0));
} catch (_) { console.log(false); }
"#;
    std::process::Command::new("osascript")
        .args(["-l", "JavaScript", "-e", script])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim() == "true")
        .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
fn mac_has_notch() -> bool {
    false
}
