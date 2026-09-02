use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            apply_pinterest_wallpaper,
            desktop_preview_environment
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Nomi");
}

#[tauri::command]
fn apply_pinterest_wallpaper(
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
    if image_urls.len() < 4 || image_urls.len() > 20 {
        return Err("Choose between 4 and 20 Pinterest images for the collage.".into());
    }
    if image_urls.iter().any(|url| !url.starts_with("https://")) {
        return Err("Pinterest wallpaper images must use HTTPS URLs.".into());
    }
    if layout != "grid" && layout != "stack" {
        return Err("Choose either the grid or stack wallpaper layout.".into());
    }
    if mosaic_fit != "preserve" && mosaic_fit != "fill" {
        return Err("Choose either preserve images or fill the wallpaper frame.".into());
    }
    if !matches!(background_mode.as_str(), "white" | "custom" | "matched" | "random") {
        return Err("Choose a supported wallpaper backdrop.".into());
    }
    if !is_hex_color(&background_color) {
        return Err("Wallpaper backdrop colors must use a six-digit hex value.".into());
    }
    if !(32..=96).contains(&tile_size) || !(0..=16).contains(&rotation_degrees) {
        return Err("Wallpaper appearance settings are outside the supported range.".into());
    }
    if !(0..=72).contains(&frame_spacing) {
        return Err("Wallpaper spacing is outside the supported range.".into());
    }
    if !(0..=80).contains(&corner_radius)
        || [padding_bottom, padding_end, padding_start, padding_top]
            .iter()
            .any(|padding| !(0..=240).contains(padding))
    {
        return Err("Wallpaper edge and corner settings are outside the supported range.".into());
    }
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?.join("wallpapers");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    // macOS caches a wallpaper by its URL. Reusing one filename means it can keep
    // displaying an old image even after that file has been replaced.
    let refresh_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let output_directory = directory.join(refresh_id.to_string());
    std::fs::create_dir_all(&output_directory).map_err(|error| error.to_string())?;
    let safe_board_label: String = board_label
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, ' ' | '-' | '_'))
        .take(48)
        .collect();
    let output = output_directory.join(format!(
        "Pinterest Collage — {}.png",
        if safe_board_label.trim().is_empty() { "Board" } else { safe_board_label.trim() }
    ));
    let background_color = serde_json::to_string(&background_color).map_err(|error| error.to_string())?;
    let background_mode = serde_json::to_string(&background_mode).map_err(|error| error.to_string())?;
    let urls = serde_json::to_string(&image_urls).map_err(|error| error.to_string())?;
    let layout = serde_json::to_string(&layout).map_err(|error| error.to_string())?;
    let mosaic_fit = serde_json::to_string(&mosaic_fit).map_err(|error| error.to_string())?;
    let output_path = serde_json::to_string(&output.to_string_lossy()).map_err(|error| error.to_string())?;
    let script = format!(r#"
ObjC.import('AppKit');
ObjC.import('Foundation');
const urls = {urls};
const backgroundColor = {background_color};
const backgroundMode = {background_mode};
const cornerRadius = {corner_radius};
const frameSpacing = {frame_spacing};
const layout = {layout};
const mosaicFit = {mosaic_fit};
const paddingBottom = {padding_bottom};
const paddingEnd = {padding_end};
const paddingStart = {padding_start};
const paddingTop = {padding_top};
const tileSize = {tile_size};
const rotationDegrees = {rotation_degrees};
const outputPath = {output_path};
const screens = $.NSScreen.screens;
const screen = $.NSScreen.mainScreen || screens.objectAtIndex(0);
const size = screen.frame.size;
const width = Math.max(1440, Math.round(size.width));
const height = Math.max(900, Math.round(size.height));
const columns = Math.max(2, Math.min(5, Math.round(7 - tileSize / 18)));
const stackPositions = [[0.03, 0.10], [0.39, 0.06], [0.17, 0.34], [0.51, 0.40], [0.00, 0.53], [0.33, 0.61]];
const imagesToDraw = layout === 'stack' ? urls.slice(0, stackPositions.length) : urls;
const loadedImages = imagesToDraw.map((url) => {{
  const data = $.NSData.dataWithContentsOfURL($.NSURL.URLWithString($(url)));
  if (!data) return null;
  const image = $.NSImage.alloc.initWithData(data);
  if (!image) return null;
  const source = image.size;
  return {{ image, ratio: source.height / source.width, source }};
}}).filter((entry) => entry !== null);
function colorFromHex(hex) {{
  const value = hex.slice(1);
  return $.NSColor.colorWithCalibratedRedGreenBlueAlpha(
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
    1,
  );
}}
function matchedBackdrop() {{
  let red = 0;
  let green = 0;
  let blue = 0;
  let samples = 0;
  loadedImages.forEach((entry) => {{
    const bitmap = $.NSBitmapImageRep.imageRepWithData(entry.image.TIFFRepresentation);
    if (!bitmap) return;
    const stepX = Math.max(1, Math.floor(bitmap.pixelsWide / 8));
    const stepY = Math.max(1, Math.floor(bitmap.pixelsHigh / 8));
    for (let x = 0; x < bitmap.pixelsWide; x += stepX) {{
      for (let y = 0; y < bitmap.pixelsHigh; y += stepY) {{
        const color = bitmap.colorAtXY(x, y);
        red += color.redComponent;
        green += color.greenComponent;
        blue += color.blueComponent;
        samples += 1;
      }}
    }}
  }});
  if (!samples) return colorFromHex(backgroundColor);
  return $.NSColor.colorWithCalibratedRedGreenBlueAlpha(
    red / samples * 0.38 + 0.62,
    green / samples * 0.38 + 0.62,
    blue / samples * 0.38 + 0.62,
    1,
  );
}}
function backdrop() {{
  if (backgroundMode === 'custom') return colorFromHex(backgroundColor);
  if (backgroundMode === 'matched') return matchedBackdrop();
  if (backgroundMode === 'random') {{
    const palette = ['#DCE8F2', '#E9DFD0', '#DCE9DC', '#EEE0EA', '#F0E5D3', '#E1E2F1'];
    return colorFromHex(palette[Math.floor(Date.now() / 86400000) % palette.length]);
  }}
  return $.NSColor.colorWithCalibratedWhiteAlpha(1, 1);
}}
const canvas = $.NSImage.alloc.initWithSize($.NSMakeSize(width, height));
canvas.lockFocus;
backdrop().setFill;
$.NSBezierPath.fillRect($.NSMakeRect(0, 0, width, height));
function drawImage(entry, x, y, drawWidth, drawHeight, angle, cover = false) {{
  if (angle || cornerRadius) {{
    $.NSGraphicsContext.saveGraphicsState;
  }}
  if (angle) {{
    const transform = $.NSAffineTransform.transform;
    transform.translateXByYBy(x + drawWidth / 2, y + drawHeight / 2);
    transform.rotateByDegrees(angle);
    transform.translateXByYBy(-x - drawWidth / 2, -y - drawHeight / 2);
    transform.concat;
  }}
  if (cornerRadius) {{
    $.NSBezierPath
      .bezierPathWithRoundedRectXRadiusYRadius(
        $.NSMakeRect(x, y, drawWidth, drawHeight),
        Math.min(cornerRadius, drawWidth / 2),
        Math.min(cornerRadius, drawHeight / 2),
      )
      .addClip;
  }}
  const sourceRect = cover
    ? (() => {{
        const scale = Math.max(drawWidth / entry.source.width, drawHeight / entry.source.height);
        const sourceWidth = drawWidth / scale;
        const sourceHeight = drawHeight / scale;
        return $.NSMakeRect(
          (entry.source.width - sourceWidth) / 2,
          (entry.source.height - sourceHeight) / 2,
          sourceWidth,
          sourceHeight,
        );
      }})()
    : $.NSMakeRect(0, 0, entry.source.width, entry.source.height);
  entry.image.drawInRectFromRectOperationFraction($.NSMakeRect(x, y, drawWidth, drawHeight), sourceRect, $.NSCompositingOperationSourceOver, 1);
  if (angle || cornerRadius) $.NSGraphicsContext.restoreGraphicsState;
}}
if (layout === 'stack') {{
  const usableWidth = width - paddingStart - paddingEnd;
  const usableHeight = height - paddingTop - paddingBottom;
  loadedImages.forEach((entry, index) => {{
    const position = stackPositions[index % stackPositions.length];
    const cardWidth = usableWidth * (0.32 + tileSize * 0.0048);
    const cardHeight = usableHeight * 0.56;
    const scale = Math.max(cardWidth / entry.source.width, cardHeight / entry.source.height);
    const drawWidth = entry.source.width * scale;
    const drawHeight = entry.source.height * scale;
    const x = paddingStart + usableWidth * position[0] - (drawWidth - cardWidth) / 2;
    const y = paddingBottom + usableHeight * position[1] - (drawHeight - cardHeight) / 2;
    drawImage(entry, x, y, drawWidth, drawHeight, (index % 2 === 0 ? -1 : 1) * rotationDegrees);
  }});
}} else {{
  const gridColumns = Array.from({{ length: columns }}, () => []);
  loadedImages.forEach((entry, index) => gridColumns[index % columns].push(entry));
  const maxItems = Math.max(...gridColumns.map((column) => column.length));
  const ratios = gridColumns.map((column) => column.reduce((total, entry) => total + entry.ratio, 0));
  const inverseRatioSum = ratios.reduce((total, ratio) => total + 1 / Math.max(ratio, 0.1), 0);
  const availableHeight = height - paddingTop - paddingBottom - Math.max(0, maxItems - 1) * frameSpacing;
  const availableWidth = width - paddingStart - paddingEnd - Math.max(0, columns - 1) * frameSpacing;
  const sharedHeight = Math.min(availableHeight, availableWidth / inverseRatioSum);
  const columnWidths = mosaicFit === 'fill'
    ? ratios.map(() => availableWidth / columns)
    : ratios.map((ratio) => sharedHeight / Math.max(ratio, 0.1));
  const gridWidth = columnWidths.reduce((total, columnWidth) => total + columnWidth, 0) + Math.max(0, columns - 1) * frameSpacing;
  let x = paddingStart + (mosaicFit === 'preserve' ? (availableWidth - gridWidth) / 2 : 0);
  gridColumns.forEach((column, columnIndex) => {{
    const columnWidth = columnWidths[columnIndex];
    const columnHeight = columnWidth * ratios[columnIndex] + Math.max(0, column.length - 1) * frameSpacing;
    let y = height - paddingTop - (mosaicFit === 'preserve' ? (availableHeight - columnHeight) / 2 : 0);
    column.forEach((entry, index) => {{
      const drawHeight = mosaicFit === 'fill'
        ? (availableHeight - Math.max(0, column.length - 1) * frameSpacing) / column.length
        : columnWidth * entry.ratio;
      y -= drawHeight;
      drawImage(entry, x, y, columnWidth, drawHeight, (index + columnIndex) % 2 === 0 ? -rotationDegrees * 0.15 : rotationDegrees * 0.15, mosaicFit === 'fill');
      y -= frameSpacing;
    }});
    x += columnWidth + frameSpacing;
  }});
}}
 canvas.unlockFocus;
const representation = $.NSBitmapImageRep.imageRepWithData(canvas.TIFFRepresentation);
const png = representation.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({{}}));
png.writeToFileAtomically($(outputPath), true);
const imageUrl = $.NSURL.fileURLWithPath($(outputPath));
for (let index = 0; index < screens.count; index += 1) {{
  const error = Ref();
  const targetScreen = screens.objectAtIndex(index);
  if (!$.NSWorkspace.sharedWorkspace.setDesktopImageURLForScreenOptionsError(imageUrl, targetScreen, $({{}}), error)) {{
    throw new Error(ObjC.unwrap(error[0].localizedDescription));
  }}
}}
"#,
        background_color = background_color,
        background_mode = background_mode,
        corner_radius = corner_radius,
        frame_spacing = frame_spacing,
        layout = layout,
        mosaic_fit = mosaic_fit,
        output_path = output_path,
        padding_bottom = padding_bottom,
        padding_end = padding_end,
        padding_start = padding_start,
        padding_top = padding_top,
        rotation_degrees = rotation_degrees,
        tile_size = tile_size,
        urls = urls,
    );
    let result = std::process::Command::new("osascript")
        .args(["-l", "JavaScript", "-e", &script])
        .output()
        .map_err(|error| format!("Could not create the wallpaper collage: {error}"))?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).trim().to_owned());
    }
    if let Ok(entries) = std::fs::read_dir(&directory) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path == output_directory {
                continue;
            }
            if path.is_dir() {
                let _ = std::fs::remove_dir_all(path);
            } else if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name == "pinterest-collage.png" || name.starts_with("pinterest-collage-"))
            {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    Ok(output.to_string_lossy().into_owned())
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
