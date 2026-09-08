//! Bounded Pinterest downloads. Composition/application remains in AppKit.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Manager};

const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;
const MAX_CACHE_BYTES: u64 = 128 * 1024 * 1024;
const CACHE_TTL: Duration = Duration::from_secs(7 * 86400);
static JOBS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static NEXT_JOB: AtomicU64 = AtomicU64::new(0);
static SETTINGS_REVISION: AtomicU64 = AtomicU64::new(0);

pub fn settings_revision() -> u64 {
    SETTINGS_REVISION.load(Ordering::SeqCst)
}
/// Call while holding DesktopState.settings, so changes serialize with OS application.
pub fn settings_changed() {
    SETTINGS_REVISION.fetch_add(1, Ordering::SeqCst);
}
fn revision_current(actual: u64, expected: u64) -> Result<(), String> {
    if actual == expected {
        Ok(())
    } else {
        Err("Wallpaper settings changed. Retry with the current preferences.".into())
    }
}
static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

// A cancelled coordinator future must abort downloads before releasing the job lock.
struct DownloadJobs(Vec<tauri::async_runtime::JoinHandle<Result<(String, Vec<u8>), String>>>);
impl Drop for DownloadJobs {
    fn drop(&mut self) {
        for job in &self.0 {
            job.abort();
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperRequest {
    pub background_color: String,
    pub background_mode: String,
    pub board_label: String,
    pub corner_radius: i32,
    pub image_urls: Vec<String>,
    pub frame_spacing: i32,
    pub layout: String,
    pub mosaic_fit: String,
    pub padding_bottom: i32,
    pub padding_end: i32,
    pub padding_start: i32,
    pub padding_top: i32,
    pub tile_size: i32,
    pub rotation_degrees: i32,
}

fn validate_url(raw: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(raw).map_err(|_| "Invalid Pinterest image URL.")?;
    if raw.len() > 2048
        || url.scheme() != "https"
        || url.host_str() != Some("i.pinimg.com")
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("Wallpaper images must use the HTTPS i.pinimg.com origin.".into());
    }
    Ok(url)
}
impl WallpaperRequest {
    fn validate(&self) -> Result<(), String> {
        if !(4..=20).contains(&self.image_urls.len()) {
            return Err("Choose between 4 and 20 Pinterest images.".into());
        }
        for url in &self.image_urls {
            validate_url(url)?;
        }
        if !matches!(self.layout.as_str(), "grid" | "stack")
            || !matches!(self.mosaic_fit.as_str(), "preserve" | "fill")
            || !matches!(
                self.background_mode.as_str(),
                "white" | "custom" | "matched" | "random"
            )
        {
            return Err("Unsupported wallpaper layout, fit or backdrop.".into());
        }
        if self.background_color.len() != 7
            || !self.background_color.starts_with('#')
            || !self.background_color[1..]
                .bytes()
                .all(|b| b.is_ascii_hexdigit())
        {
            return Err("Wallpaper backdrop colors must use a six-digit hex value.".into());
        }
        if !(32..=96).contains(&self.tile_size)
            || !(0..=16).contains(&self.rotation_degrees)
            || !(0..=72).contains(&self.frame_spacing)
            || !(0..=80).contains(&self.corner_radius)
            || [
                self.padding_top,
                self.padding_bottom,
                self.padding_start,
                self.padding_end,
            ]
            .iter()
            .any(|v| !(0..=240).contains(v))
        {
            return Err("Wallpaper appearance settings are outside the supported range.".into());
        }
        Ok(())
    }
}
fn current(app: &AppHandle, generation: u64, revision: u64) -> Result<(), String> {
    revision_current(settings_revision(), revision)?;
    if app
        .state::<crate::desktop::DesktopState>()
        .generation
        .load(Ordering::SeqCst)
        != generation
    {
        Err("Wallpaper job cancelled because the account, server or settings changed.".into())
    } else {
        Ok(())
    }
}
fn cache_key(url: &str) -> String {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    url.hash(&mut hash);
    format!("{:016x}", hash.finish())
}
fn cache_read(root: &Path, url: &str) -> Option<Vec<u8>> {
    let key = cache_key(url);
    // Compare the original URL as well as its hash; collisions cannot return another pin.
    if std::fs::read_to_string(root.join(format!("{key}.url"))).ok()? != url {
        return None;
    }
    let path = root.join(format!("{key}.image"));
    let metadata = std::fs::metadata(&path).ok()?;
    if metadata.len() == 0
        || metadata.len() > MAX_IMAGE_BYTES as u64
        || metadata.modified().ok()?.elapsed().ok()? > CACHE_TTL
    {
        return None;
    }
    std::fs::read(path).ok()
}
fn cache_write(root: &Path, url: &str, bytes: &[u8]) -> Result<(), String> {
    let key = cache_key(url);
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let path = root.join(format!("{key}.image"));
    let temp = root.join(format!("{key}.tmp"));
    std::fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(temp, path).map_err(|e| e.to_string())?;
    std::fs::write(root.join(format!("{key}.url")), url).map_err(|e| e.to_string())?;
    prune_cache(root);
    Ok(())
}
fn prune_cache(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let mut entries: Vec<_> = entries
        .flatten()
        .filter_map(|e| {
            if e.path().extension()?.to_str()? != "image" {
                return None;
            }
            let m = e.metadata().ok()?;
            Some((
                e.path(),
                m.len(),
                m.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            ))
        })
        .collect();
    entries.sort_by_key(|e| e.2);
    let mut total: u64 = entries.iter().map(|e| e.1).sum();
    for (path, size, modified) in entries {
        if total > MAX_CACHE_BYTES || modified.elapsed().unwrap_or(CACHE_TTL) >= CACHE_TTL {
            if std::fs::remove_file(&path).is_ok() {
                total = total.saturating_sub(size);
                let _ = std::fs::remove_file(path.with_extension("url"));
            }
        }
    }
}
fn append_chunk(bytes: &mut Vec<u8>, chunk: &[u8]) -> Result<(), String> {
    if bytes.len().saturating_add(chunk.len()) > MAX_IMAGE_BYTES {
        return Err("A Pinterest image exceeds the 12 MiB limit.".into());
    }
    bytes.extend_from_slice(chunk);
    Ok(())
}
fn image_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .user_agent("ilo-desktop-wallpaper/1")
        .build()
        .map_err(|e| e.to_string())
}
async fn download(client: reqwest::Client, raw: String) -> Result<Vec<u8>, String> {
    let url = validate_url(&raw)?;
    fetch_image(client, url).await
}
async fn fetch_image(client: reqwest::Client, url: url::Url) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Pinterest image download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Pinterest image returned HTTP {}. Redirects are not followed.",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_IMAGE_BYTES as u64)
    {
        return Err("A Pinterest image exceeds the 12 MiB limit.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        append_chunk(&mut bytes, &chunk)?;
    }
    if bytes.is_empty() {
        return Err("Pinterest returned an empty image.".into());
    }
    Ok(bytes)
}

#[allow(dead_code)] // Stable entry point for native integrations without a pre-fetched context.
pub async fn apply(app: &AppHandle, request: WallpaperRequest) -> Result<String, String> {
    let generation = app
        .state::<crate::desktop::DesktopState>()
        .generation
        .load(Ordering::SeqCst);
    apply_for_generation(app, request, generation).await
}

/// Preserve the identity captured before a scheduled job fetched its settings/pins.
#[allow(dead_code)] // Compatibility entry point for identity-scoped callers.
pub async fn apply_for_generation(
    app: &AppHandle,
    request: WallpaperRequest,
    generation: u64,
) -> Result<String, String> {
    apply_for_revision(app, request, generation, settings_revision()).await
}

/// Scheduled callers capture both identity and preference revisions before fetching pins.
pub async fn apply_for_revision(
    app: &AppHandle,
    request: WallpaperRequest,
    generation: u64,
    revision: u64,
) -> Result<String, String> {
    request.validate()?;
    current(app, generation, revision)?;
    if !cfg!(target_os = "macos") {
        return Err("Native wallpaper application is currently available on macOS.".into());
    }
    let _job = JOBS.lock().await;
    current(app, generation, revision)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("wallpapers");
    let cache = root.join("cache");
    let client = if let Some(client) = CLIENT.get() {
        client.clone()
    } else {
        let client = image_client()?;
        let _ = CLIENT.set(client.clone());
        client
    };
    let mut images: HashMap<String, Vec<u8>> = HashMap::new();
    // Repeated pins are intentional, but download each distinct source only once.
    let mut urls = request.image_urls.clone();
    urls.sort();
    urls.dedup();
    for group in urls.chunks(3) {
        let mut jobs = DownloadJobs(Vec::new());
        for url in group {
            let url = url.clone();
            let cache = cache.clone();
            let client = client.clone();
            jobs.0.push(tauri::async_runtime::spawn(async move {
                let cache_url = url.clone();
                let cache_root = cache.clone();
                let cached = tauri::async_runtime::spawn_blocking(move || {
                    cache_read(&cache_root, &cache_url)
                })
                .await
                .map_err(|e| e.to_string())?;
                let bytes = match cached {
                    Some(bytes) => bytes,
                    None => download(client, url.clone()).await?,
                };
                Ok::<_, String>((url, bytes))
            }));
        }
        // Dropping join handles does not abort tasks; abort every outstanding task on cancellation/error.
        let outcome = async {
            for job in &mut jobs.0 {
                let result = tokio::select! {
                    result = job => result.map_err(|e| e.to_string())?,
                    _ = async { loop { tokio::time::sleep(Duration::from_millis(100)).await; if current(app, generation, revision).is_err() { break; } } } => return Err("Wallpaper job cancelled.".into()),
                }?;
                images.insert(result.0, result.1);
            }
            Ok::<_,String>(())
        }.await;
        drop(jobs);
        outcome?;
        current(app, generation, revision)?;
    }
    let id = format!(
        "job-{}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos(),
        NEXT_JOB.fetch_add(1, Ordering::Relaxed)
    );
    let output = root.join(id);
    let paths: Vec<PathBuf> = request
        .image_urls
        .iter()
        .map(|u| output.join(format!("{}.source", cache_key(u))))
        .collect();
    let output_copy = output.clone();
    let images = tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&output_copy).map_err(|e| e.to_string())?;
        for (url, bytes) in &images {
            std::fs::write(
                output_copy.join(format!("{}.source", cache_key(&url))),
                bytes,
            )
            .map_err(|e| e.to_string())?;
        }
        Ok::<_, String>(images)
    })
    .await
    .map_err(|e| e.to_string())??;
    let prepared = async {
        current(app,generation,revision)?;
        crate::native::call(app, serde_json::json!({"op":"wallpaper_prepare", "request":request, "imagePaths": paths, "outputDirectory":output})).await?;
        current(app,generation,revision)?;
        Ok::<_,String>(())
    }.await;
    if let Err(error) = prepared {
        let _ = std::fs::remove_dir_all(&output);
        return Err(error);
    }
    // All images decoded successfully; only now promote sources to the persistent cache.
    tauri::async_runtime::spawn_blocking(move || {
        for (url, bytes) in images {
            let _ = cache_write(&cache, &url, &bytes);
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Err(error) = current(app, generation, revision) {
        let _ = std::fs::remove_dir_all(&output);
        return Err(error);
    }
    // The same lock surrounds transport's settings_changed hook. An acknowledged
    // Pinterest PATCH cannot race the generation/revision check and OS application.
    let state = app.state::<crate::desktop::DesktopState>();
    let transition = state.settings.lock().await;
    let result = match current(app, generation, revision) {
        Ok(()) => {
            crate::native::call(
                app,
                serde_json::json!({"op":"wallpaper_apply", "outputDirectory":output}),
            )
            .await
        }
        Err(error) => Err(error),
    };
    drop(transition);
    // Native marks the job before touching any display. A cancelled queued operation
    // has no marker and is safe to discard; a partial application must remain available.
    let value = match result {
        Ok(value) => value,
        Err(error) => {
            if !output.join(".apply-started").exists() {
                let _ = std::fs::remove_dir_all(&output);
            }
            return Err(error);
        }
    };
    value["path"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "macOS did not return the applied wallpaper path.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn limits_streams_without_trusting_content_length() {
        let mut bytes = vec![0; MAX_IMAGE_BYTES - 1];
        assert!(append_chunk(&mut bytes, &[1]).is_ok());
        assert!(append_chunk(&mut bytes, &[1]).is_err());
        assert_eq!(bytes.len(), MAX_IMAGE_BYTES);
    }
    #[test]
    fn restricts_pin_origin() {
        assert!(validate_url("https://i.pinimg.com/originals/a.jpg").is_ok());
        for url in [
            "http://i.pinimg.com/a",
            "https://i.pinimg.com.evil.test/a",
            "https://i.pinimg.com:444/a",
            "https://x@i.pinimg.com/a",
            "https://i.pinimg.com/a#b",
            "file:///tmp/a",
            "https://evil.test/a",
        ] {
            assert!(validate_url(url).is_err(), "{url}");
        }
    }
    #[test]
    fn request_wire_shape_and_repeated_pins() {
        let mut v = serde_json::json!({"backgroundColor":"#ffffff","backgroundMode":"white","boardLabel":"Board","cornerRadius":0,"imageUrls":vec!["https://i.pinimg.com/a";4],"frameSpacing":12,"layout":"grid","mosaicFit":"preserve","paddingBottom":0,"paddingTop":0,"paddingEnd":0,"paddingStart":0,"tileSize":64,"rotationDegrees":4});
        assert!(serde_json::from_value::<WallpaperRequest>(v.clone())
            .unwrap()
            .validate()
            .is_ok());
        v["paddingTop"] = serde_json::json!(241);
        assert!(serde_json::from_value::<WallpaperRequest>(v)
            .unwrap()
            .validate()
            .is_err());
    }
    #[test]
    fn cache_verifies_url_and_atomic_payload() {
        let root = std::env::temp_dir().join(format!(
            "ilo-wallpaper-test-{}-{}",
            std::process::id(),
            NEXT_JOB.fetch_add(1, Ordering::SeqCst)
        ));
        cache_write(&root, "https://i.pinimg.com/a", &[1, 2, 3]).unwrap();
        assert_eq!(
            cache_read(&root, "https://i.pinimg.com/a"),
            Some(vec![1, 2, 3])
        );
        std::fs::write(
            root.join(format!("{}.url", cache_key("https://i.pinimg.com/a"))),
            "different",
        )
        .unwrap();
        assert!(cache_read(&root, "https://i.pinimg.com/a").is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
    fn local_response(
        response: &'static str,
        delay: Duration,
    ) -> (url::Url, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url =
            url::Url::parse(&format!("http://{}/image", listener.local_addr().unwrap())).unwrap();
        let thread = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 2048];
            let _ = stream.read(&mut request);
            std::thread::sleep(delay);
            let _ = stream.write_all(response.as_bytes());
        });
        (url, thread)
    }
    #[tokio::test]
    async fn download_rejects_redirects_and_empty_images() {
        for response in ["HTTP/1.1 302 Found\r\nLocation: https://i.pinimg.com.evil.test/a\r\nContent-Length: 0\r\n\r\n", "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"] {
            let (url, server) = local_response(response,Duration::ZERO);
            assert!(fetch_image(image_client().unwrap(),url).await.is_err());
            server.join().unwrap();
        }
    }
    #[tokio::test]
    async fn download_timeout_and_declared_size_limit() {
        let (url, server) = local_response(
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nab",
            Duration::from_millis(100),
        );
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(20))
            .build()
            .unwrap();
        assert!(fetch_image(client, url).await.is_err());
        server.join().unwrap();
        let (url, server) = local_response(
            "HTTP/1.1 200 OK\r\nContent-Length: 99999999\r\n\r\n",
            Duration::ZERO,
        );
        assert!(fetch_image(image_client().unwrap(), url)
            .await
            .unwrap_err()
            .contains("12 MiB"));
        server.join().unwrap();
    }
    #[test]
    fn cache_prunes_expired_and_oversized_entries() {
        let root = std::env::temp_dir().join(format!(
            "ilo-wallpaper-prune-{}-{}",
            std::process::id(),
            NEXT_JOB.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&root).unwrap();
        let expired = root.join("expired.image");
        let file = std::fs::File::create(&expired).unwrap();
        file.set_len(1).unwrap();
        file.set_times(std::fs::FileTimes::new().set_modified(SystemTime::UNIX_EPOCH))
            .unwrap();
        let oversized = root.join("oversized.image");
        std::fs::File::create(&oversized)
            .unwrap()
            .set_len(MAX_CACHE_BYTES + 1)
            .unwrap();
        prune_cache(&root);
        assert!(!expired.exists());
        assert!(!oversized.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn cancelling_job_aborts_its_download_tasks() {
        let (send, receive) = tokio::sync::oneshot::channel::<()>();
        let jobs = DownloadJobs(vec![tauri::async_runtime::spawn(async move {
            let _send = send;
            std::future::pending::<()>().await;
            Ok((String::new(), Vec::new()))
        })]);
        drop(jobs);
        assert!(tokio::time::timeout(Duration::from_secs(1), receive)
            .await
            .unwrap()
            .is_err());
    }
    #[test]
    fn preference_revision_cancels_obsolete_work_without_an_account_change() {
        assert!(revision_current(4, 4).is_ok());
        assert!(revision_current(5, 4).is_err());
    }
}
