# Native Pinterest wallpaper implementation

The existing `apply_pinterest_wallpaper` Tauri command keeps its JavaScript argument
shape and now awaits the Rust pipeline instead of running synchronous JXA.

Rust exports from `src-tauri/src/wallpaper.rs`:

- `WallpaperRequest`, with public fields and camelCase Serde serialization matching
  the existing command arguments.
- `apply(&AppHandle, WallpaperRequest) -> Result<String, String>` for manual jobs.
- `apply_for_generation(&AppHandle, WallpaperRequest, u64) -> Result<String, String>`
  for identity-scoped callers.
- `apply_for_revision(&AppHandle, WallpaperRequest, u64, u64)` for callers that
  capture account generation and `settings_revision()` before fetching settings/pins.
- `settings_changed()` invalidates only wallpaper work; the API transport invokes
  it after successful Pinterest settings PATCH while holding the settings mutex.

The process-wide async mutex serializes manual and scheduled jobs. The pipeline
checks account/settings generation while downloading, after preparation and before
application. Download task guards abort outstanding downloads if the coordinator
cancels its future. The final application checks both identity generation and wallpaper preference
revision while holding the account transition lock through native dispatch;
network and composition do not hold it. Scheduling and last-success persistence
belong to `wallpaper_schedule.rs`: a shared manual/scheduled transaction lock
prevents duplicate queued daily work; local records are kept per server/account
and compare exact board/appearance fingerprints independently of server stamps.

## Download and image limits

- 4–20 selected image entries; repeated pins remain supported and each distinct URL
  downloads/decodes once.
- Only HTTPS `i.pinimg.com` on port 443, with no credentials or fragment and a
  maximum URL length of 2048 characters. Redirects are rejected, including redirects
  to the same origin, so downloads cannot escape the allowed origin.
- Up to three simultaneous downloads, 5-second connection timeout and 20-second
  total timeout per request. Both advertised and streamed bodies enforce 12 MiB.
- Validated images are cached for seven days, with oldest-first eviction to 128 MiB.
  Hash keys are checked against the original URL; payload writes use atomic rename.
- ImageIO inspects metadata before decode: maximum 8192 pixels per edge and 32 MP
  per source. EXIF orientation is respected; decoded images are capped to a 4096px
  edge and 64 MP across distinct decoded sources in one job.
- Each display output is bounded to 16384 pixels per edge and 64 MP.

All selected images must download and decode successfully before any wallpaper is
changed. Download/decoding/preparation failures keep the existing wallpapers.

## Composition and file retention

`Wallpaper.swift` separates pure layout/crop calculations and bitmap rendering
from `NSScreen`/`NSWorkspace` integration. Native operations are
`wallpaper_prepare` and `wallpaper_apply`; both are internal bridge operations.
AppKit renders every attached display from its current display mode's physical
pixel dimensions. Padding, gaps and corner radii scale with the display's backing
scale. Grid supports preserved aspect ratios and filled cells; stack cards keep
natural aspect ratios, matching the existing preview's stack behavior. Backdrops
support white, custom color, sampled image colors and a local-day pastel palette.

Every job has a unique directory and each display has its own atomically written
PNG. All display outputs are prepared before application begins. Display changes
between preparation and application reject the job if an output is missing.
AppKit failures report the number of displays applied and each failed display.
A marker written before the first OS mutation distinguishes never-applied jobs
from possible partial application: partial-job files are retained.

Successful-job cleanup retains the current job, every currently reported desktop
image and remembered disconnected-display images in `active-displays.json`.
Unreadable/unwritable retention state skips cleanup. Only obsolete job directories
with a successful-completion marker are eligible for deletion; partial jobs are
never automatically deleted. Public AppKit APIs expose the current desktop image
per screen, so installed acceptance must still exercise macOS Spaces behavior.

## Verification

- `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml wallpaper::tests`:
  nine pipeline tests covering allowed origins, request shape/repeated pins,
  streamed limits, redirect/empty response rejection, timeout/declared-size limits,
  cache lookup/eviction, preference revisions and cancellation aborting child downloads.
  `cargo test ... wallpaper` additionally passes three local scheduling tests for
  daily catch-up, per-server/account records and preference fingerprints. This also compiles
  the integrated Rust/Tauri native host.
- `swift test --package-path apps/desktop/macos`: six wallpaper tests, plus existing
  native tests, covering preserved aspect ratios, exact padded fill coverage,
  Retina scaling, stack layout, impossible dimensions/padding, corrupt image
  rejection, rendered physical pixel dimensions, active/partial file retention and
  the Gregorian local-date palette across UTC midnight.

These checks do not change the developer's wallpaper. A signed installed app still
needs live Pinterest/offline/corrupt-input acceptance and visual comparison of
preview/output on mixed Retina/non-Retina displays, including padding and Spaces.

## API board and date boundary

Provider-specific public board retrieval/extraction now lives in
`packages/connectors/src/pinterest.ts`. Requests normalize supported regional/apex
hosts to HTTPS `www.pinterest.com`, reject credentials/nonstandard ports and all
redirects, and bound the whole request/body to ten seconds and four MiB. Extraction
stops after 100 distinct supported Pinterest images. Provider failures map to API
errors without exposing arbitrary fetch capabilities.

`GET /v1/pinterest/pins` accepts optional `planningDate=YYYY-MM-DD`, validated as a
real ISO calendar date by the domain contract. Omitting it keeps the prior UTC
selection behavior. The native scheduler sends the device local date; the typed
client accepts `listPinterestPins(limit, planningDate)` for matching desktop
manual and preview calls. Daily selection remains server-owned.

Twenty focused TypeScript tests pass across connector, domain, service and client,
including redirect/SSRF rejection, stalled connection/body deadlines, exact byte
boundaries, real calendar dates and local daily selection across UTC midnight.

The desktop preview's random palette now uses the same Gregorian local date and
six-color index as AppKit, ignoring another Mac's `lastAppliedAt`. The existing
web wallpaper interaction test asserts the exact palette color with a stale
application stamp, and passes. The Swift date test covers epoch anchoring and a
New York date differing from UTC.
