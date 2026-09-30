# Releasing nohmi

Releases are immutable, semantically versioned Git tags. The stable desktop channel accepts `vX.Y.Z` tags only. Keep candidates as draft
releases until installed-app acceptance is complete; drafts are not offered to
automatic update clients.

## Release checklist

1. Merge a reviewed pull request into `main` after `pnpm verify` passes.
2. Confirm that a staging deployment has applied the same migrations and that
   its backup/restore path has been exercised.
3. Update public documentation and write release notes with **Added**,
   **Changed**, **Fixed**, **Security**, **Self-hosting**, and **Known limits**
   sections as applicable.
4. Create and push an annotated `vX.Y.Z` tag. The release workflow builds the
   Mac installers and updater packages and attaches them to a GitHub draft release.
5. Verify both downloaded macOS architecture artifacts on clean machines before
   publishing the draft. Do not publish an unsigned desktop installer.
6. Build and deploy the API, MCP, and web images from the same release commit;
   keep exactly one API replica during migration-capable rollouts.
7. For every changed external boundary, reconcile the
   [boundary record](engineering/external-boundary-reliability.md) against the deployed environment,
   then run its least-privileged, non-destructive smoke from the real runtime. Record configured,
   authorized, reachable, and verified as separate results; process health alone is insufficient.
8. Publish the GitHub release, deployment notes, and any security advisory.

## Signing requirements

The macOS release needs `APPLE_CERTIFICATE`,
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
`APPLE_PASSWORD`, and `APPLE_TEAM_ID` GitHub secrets. Windows releases need a
base64-encoded `WINDOWS_CERTIFICATE` PFX plus
`WINDOWS_CERTIFICATE_PASSWORD`. Set `PERSONAL_OS_API_BASE_URL` as a GitHub
Actions variable. The release workflow intentionally fails before building if
any required signing or production-API value is missing.

Export the Developer ID certificate **with its private key** as a password-protected
PKCS#12 (`.p12`) bundle. Verify that macOS `security import` accepts it before
uploading its base64 contents. OpenSSL 3 default PKCS#12 exports can be rejected
by Keychain as a password/MAC error; use Keychain Access export or a macOS-compatible
PKCS#12 export and repeat the import check.

Store all CI signing material only as GitHub Actions secrets. Never commit
certificates, provisioning profiles, Apple credentials, or updater private
keys.

## Compatibility

The desktop renderer is built with `VITE_API_BASE_URL`. Official installers
must point to the official HTTPS API; self-hosted builds may use their own API
address. Keep the desktop version in `apps/desktop/src-tauri/tauri.conf.json`
aligned with the release tag.

## Desktop downloads and automatic updates

The official `/downloads` page and Settings → Desktop app read the same public
`GET /v1/desktop-release` projection of GitHub's latest stable release. The official
API enables this only when `API_BASE_URL` is `https://nohmi-api.coopersully.me`;
self-hosted APIs return `disabled` instead of advertising production installers.
Missing releases and transport failures remain distinct. Metadata reads use a
five-second timeout, a 1 MiB body cap, coalescing, and a five-minute cache (30 seconds
for failures). No account credentials go to GitHub. Release notes render as text.

The Mac workflow builds Apple Silicon and Intel separately. `vX.Y.Z` must match
`apps/desktop/package.json`, Cargo package version and Tauri configuration. It
produces immutable `nohmi_X.Y.Z_aarch64.dmg` and `nohmi_X.Y.Z_x86_64.dmg`, matching
`.app.tar.gz` updater archives and `.sig` files, `SHA256SUMS`, and `latest.json`.
The updater archive is created **after** embedding widgets, Developer ID signing,
notarization and stapling. `tauri signer sign --app-version` binds its version into
the signed trusted comment; the installed app requires that binding. Windows
installers have an independent manually dispatched workflow and do not block Mac
releases. That workflow supplies a CI artifact, not an automatic Windows update.

In addition to the Apple secrets above, configure:

- `ILO_HOST_PROFILE_BASE64` and `ILO_WIDGET_PROFILE_BASE64` secrets for the
  provisioned host and widget extension.
- `ILO_KEYCHAIN_ACCESS_GROUP` Actions variable matching both profiles.
- `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets.
- `NOHMI_UPDATER_PUBLIC_KEY` Actions variable containing the public key generated
  by the Tauri signer. Keep a securely backed-up private key: changing the trusted
  key without a transition release strands installed clients.

Generate the updater key with `pnpm --filter @personal-os/desktop exec tauri signer
generate` in a secure operator environment. Upload private material directly to
GitHub secrets; never paste it into issues, logs, chat or repository files. The
public key is embedded at compile time. Development builds and builds without a
key do not check or install updates. Release packaging fails without the key.
The production connection remains `https://nohmi-api.coopersully.me`, independently
of the updater's fixed GitHub HTTPS endpoint.

A release build checks at startup before mounting interactive forms. Check timeout
is eight seconds; download timeout is 120 seconds, with a 256 MiB download cap.
**Open now** permanently cancels automatic installation authority for that launch.
After opening, native state retains verified downloaded bytes; Settings can offer
**Restart to update**. Confirmation tells the person to save work, and an active
ritual blocks restart. Background checks on reopen are throttled to six hours;
manual checks bypass the throttle but share the same operation lock. Checks never
send account credentials. Failed checks open the current app; no failed check is
reported as up to date. A fresh launch may download again after process exit.
Installation itself is not cancelled or timed out once replacement has begun.

The durable release commit point is publication of the complete GitHub draft.
Never publish `latest.json` before both platforms and signatures exist. The app
uses GitHub's `/releases/latest/download/latest.json` endpoint and default newer-only
comparison. To recover from a bad published app, ship a higher signed patch
version; do not replace immutable assets or silently downgrade clients.

Before publishing the first stable release, install a signed old build into
Applications, publish a newer signed candidate to a controlled update feed, and
exercise check, signature rejection, escape during download, automatic replacement,
relaunch, existing account login, ritual recovery, Keychain and widget access.
Also test Finder/Dock reopen, offline launch, read-only install location and both
architectures. Remove the test feed override from production artifacts. Apple
credential presence and green unit tests do not prove these installed-app checks.
The first public release requires an explicit operator publication after this
acceptance. Subsequent updates are delivered by publishing the next complete draft.

### Signed candidate builds

Push a unique `desktop-candidate/<description>` tag to exercise the same Mac
signing and notarization pipeline before merging or publishing a stable release.
Candidate runs validate agreement between source versions and upload both Mac
architecture artifacts to Actions. They skip GitHub release creation and never
change the public update feed. Download the candidate artifacts from that run
for installed-app acceptance. Never move or reuse a candidate tag.
