# Releasing nohmi

Releases are immutable, semantically versioned Git tags. The stable desktop channel accepts `vX.Y.Z` tags only. Keep candidates as draft
releases until installed-app acceptance is complete; drafts are not offered to
automatic update clients.

## Automatic desktop releases

After each successful **push CI run on main**, the desktop workflow compares that exact source
with the source of the highest public stable desktop release. Bundled web/native changes, shared
packages, patches, lockfiles and build configuration require packaging. Markdown, JavaScript/
TypeScript test files, and changes confined to API/MCP applications or infrastructure do not.
Shared-package changes conservatively trigger a release even when only a server uses that package.
The first successful main run creates the initial candidate.

Versions default to a patch above the highest reserved stable tag or checked-in desktop version,
whichever is greater. A merged commit message may contain the exact standalone trailer
`Desktop-Release: minor` or `Desktop-Release: major`; the highest requested bump since the last
public release wins. For squash merges, put the trailer in the squash commit body. A trailer in a
PR description alone does not affect versioning. Reserved but failed versions are never reused
for a different source; gaps are allowed.

The workflow creates a release-only commit parented to the CI-verified main SHA, updating only
`apps/desktop/package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and its lockfile.
Its annotated `vX.Y.Z` tag records `Nohmi-Source: <SHA>`. It never pushes a version commit to main
or bypasses branch protection. Main's checked-in version is a development floor; published tags
and Settings identify installed release versions. Packaging is called directly in the same workflow,
so it does not depend on a bot-pushed tag triggering a second workflow.

Both architectures must build, sign, notarize, and upload before the complete draft is assembled.
Automatic publication requires Actions variable `NOHMI_DESKTOP_AUTO_PUBLISH=true`, the same source
still being current main, and successful `production/ilo` deployment status for that source.
The publication wait is bounded to 30 minutes; each GitHub command is bounded to 60 seconds.
Mac packaging has a 60-minute job limit. Manual tag pushes always create drafts.

The first rollout keeps automatic publication disabled until installed-app acceptance is complete.
After enabling it, the normal operator action is simply merging an approved PR. Release notes,
installers, signatures, checksums and the updater manifest are published together. Installed apps
then discover the newer version on launch; Downloads and Settings show that same GitHub release.

### Recovery and delivery guarantees

- One repository-wide desktop release concurrency group serializes reservation through publication.
  Pending runs may be superseded by GitHub; the next successful current-main run compares all changes
  since the last public release, so it includes changes from skipped runs.
- Rerun **all jobs** of a failed release while its source is current main. It reuses the reserved
  tag and can repair draft uploads. Public assets are never overwritten. If the source has moved,
  rerun CI on current main instead; it reserves a newer version and includes unpublished changes.
- A failed or missing deployment status, incomplete artifact set, API failure, or superseded source
  leaves the release unpublished. Inspect the Actions run and draft. Never publish a partial draft.
- To pause new public updates, clear `NOHMI_DESKTOP_AUTO_PUBLISH`; packaging continues into drafts.
  To recover from an already published defect, merge a fix and ship a higher version.
- Authority: the workflow's repository-scoped token can create tags, manage releases, and read
  deployment statuses. Apple and updater signing use existing Actions secrets. HTTPS to GitHub and
  Apple is required. The durable reservation is the tag; public release publication is the client
  delivery commit point. GitHub/Apple outages and revoked credentials can still prevent delivery
  despite passing source tests. Actions logs, draft state, tag/source association, and release assets
  provide recovery evidence without printing secrets.

## Manual release checklist

1. Merge reviewed source into main after verification. Ensure production deployed successfully.
2. For an explicitly versioned manual release, update all desktop version files in a reviewed PR,
   then create and push the matching annotated `vX.Y.Z` tag.
3. Wait for both signed/notarized architectures and the complete draft release.
4. Complete installed-app acceptance, inspect release notes and artifacts, and publish the draft.
5. Verify Downloads, Settings and the installed update path against the published version.

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

For the first rollout, keep automatic publication disabled. Validate the downloaded signed
candidate, Gatekeeper acceptance, account continuity and complete two-architecture draft. An
operator then publishes the first complete release and immediately exercises the installed
old-to-new check/download/replacement/relaunch path before enabling unattended publication.
This is a controlled first public rollout, not proof of an upgrade before a feed exists.
Also exercise signature rejection, escape during download, ritual recovery, Keychain/widget
access, Finder/Dock reopen, offline launch and a read-only install location at the appropriate
native or installed integration layer; record any architecture-specific evidence gaps explicitly.
If first-upgrade acceptance fails, leave automation disabled, preserve the installed app, and
repair with a higher signed version. Apple credential presence and green unit tests alone do not
prove installed replacement. Subsequent releases use the automatic publication gates above.

### Signed candidate builds

Push a unique `desktop-candidate/<description>` tag to exercise the same Mac
signing and notarization pipeline before merging or publishing a stable release.
Candidate runs validate agreement between source versions and upload both Mac
architecture artifacts to Actions. They skip GitHub release creation and never
change the public update feed. Download the candidate artifacts from that run
for installed-app acceptance. Never move or reuse a candidate tag.
