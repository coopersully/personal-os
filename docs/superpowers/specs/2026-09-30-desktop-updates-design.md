# Desktop downloads and automatic updates

## Intent and scope

Install nohmi once, sign in to the production account, and receive future signed macOS releases when opening the app. A consolidated Downloads surface and Settings show the current stable release and release notes. User authorized autonomous design, planning, self-review and implementation on 2026-09-30.

Use the existing Tauri shell, production API default and Apple signing pipeline. Keep the bundle identifier and Keychain/App Group identities. Support macOS 14+ on Apple Silicon and Intel with separate artifacts. Windows keeps its installer workflow but cannot block a macOS release. Automatic Windows updates are outside this first macOS delivery.

## Release authority

GitHub Releases is the sole stable release ledger. A versioned tag produces notarized DMGs and updater archives for both Mac architectures, checksums, release notes and latest.json. Publish the complete draft only after all Mac artifacts and manifest validate; never advertise an incomplete release. Tags, package, Cargo and Tauri versions must agree. The updater archive is made from the final signed, widget-embedded, notarized and stapled app, not the initial Tauri bundle. Use distinct Apple and Tauri updater signing identities. Signatures bind the exact app version, and the client requires that signed version to match the feed. CI stores the private updater key; the app embeds the public key at build time. Missing signing configuration fails release builds; development builds report updates unavailable.

Use the HTTPS GitHub latest release feed with default newer-only version comparison. Keep endpoint and public key independent of the user's API server setting. No account token is sent to the release service. Roll forward with a higher patch version to recover from a bad release; never silently downgrade. Publishing is distinct from merging source.

## User experience and lifecycle

A fresh release build checks for updates before mounting the interactive app. Show a compact startup status with an Open now escape while checking/downloading. Checking has an 8-second deadline and a client-enforced 1 MiB manifest cap; downloads have a 120-second deadline and reject payloads over 256 MiB. On failure, open the existing app and expose the failure in Settings. A successful signed download installs and relaunches automatically only while the startup gate still owns the session. Open now irrevocably releases that automatic-install authority for this launch. Once the app is interactive, checks may download but never install or restart automatically. Settings offers Restart to update with explicit confirmation to save work; an active ritual blocks it.

Check once on cold launch and on reopening, at most once per six hours unless manually requested. Serialize all operations. The native process owns status and verified downloaded bytes so closing a settings view does not interrupt the operation. Do not persist an unverified install instruction. A later fresh launch can re-download; a killed process safely starts again. Keep updates disabled in development, unsupported platforms, or builds without a signing key. No unbounded retries. Installation is not cancellable after its commit point; suppress the startup escape at that stage.

Settings shows installed version, available version, check/download/install state, progress when total length is known, release notes, last check and retry/manual check. A public /downloads page shows latest published Mac installers, version and notes, or a truthful unavailable/not-yet-published state. Settings links to that same information. Use existing shadcn Card, Item, Button, Alert and progress primitives, semantic theme tokens and accessible live status. Server-side release lookup is bounded and cached and returns only validated GitHub artifact links. Self-hosted deployments must not advertise production-matched installers as their own.

## Boundary record

- Owner: native updater owns check/download/signature verification/install; CI owns signing and publication; API connector owns public release metadata.
- Authority: HTTPS fixed repository feed and embedded updater public key; Apple Developer ID, notarization and host/widget profiles for distribution.
- Transport: outbound HTTPS 443 to GitHub and its release-asset hosts; no API credentials attached. Production API remains independently configured.
- Bounds: check 8 seconds; download 120 seconds and 256 MiB; one native operation; six-hour automatic retry throttle; metadata response size cap and five-minute cache.
- Commit point: signed bytes verified before plugin installation. Before install, failure/cancel leaves current bundle untouched. Installation atomically exchanges the old and new macOS bundle names on the same filesystem. A failed exchange leaves the old bundle intact; no delete or privileged fallback is allowed. Do not kill the operation with a deadline.
- Recovery: failure opens current app and preserves an actionable status; next launch/manual check retries. Offline launch works. Bad release recovery uses a higher signed version.
- Observation: sanitized statuses only, version and time visible; no secret values or raw remote errors in UI.
- Disconfirming case: green mocks cannot prove Apple authorization, Gatekeeper acceptance, release artifact accessibility, installed widget continuity or replacement from /Applications. Require a signed old-to-new installed-app smoke before calling distribution verified.

## Acceptance and self-review

Exercise no update, newer update, older version, offline, malformed feed, invalid signature, concurrent checks, escape during download, ritual-active restart, manual retry, missing key, unsupported platform, and release version/architecture mismatch. Never mount interactive forms before startup installation settles. A download alone is not installation success. The public page must not show guessed download URLs. Review revised the design to use a startup gate instead of guessing whether mounted forms have unsaved changes. The first complete signed release is published by an operator as a controlled rollout; verify the installed old-to-new upgrade before enabling unattended publication.

## Technical references

- [Tauri updater](https://v2.tauri.app/plugin/updater/)
- [GitHub runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)


## Approved automatic release extension — 2026-09-30

A successful main push CI run reconciles desktop changes against the last public release, reserves
an immutable increasing version, and packages both signed architectures. Default increment is
patch; standalone merged-commit `Desktop-Release: minor` or `major` trailers select larger bumps.
Release-only version commits preserve main's protected PR history and record their verified source.
Publication requires a complete artifact set, the live Mac API reporting readiness and the current
main source revision, and the rollout switch. The existing controller's Git archive stamps the
revision; this proves API source and database readiness, not completion of the private controller
transaction. Initial installed-upgrade acceptance precedes enabling the switch.
See `docs/releasing.md` for exact scope, deadlines, recovery and operator actions.

Signing credentials reside only in main-only GitHub environments, with updater keys isolated from Apple/build credentials. Unmerged/tag-selected workflows cannot use them. The updater private key is injected only into archive signing on a separate publication runner with no application dependencies. Signed candidate delivery uses complete drafts from verified main.
