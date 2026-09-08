#!/bin/bash
# Build the complete host + extension before notarization; never modify a notarized app.
set -euo pipefail
: "${APPLE_CERTIFICATE:?Base64 Developer ID certificate required}"
: "${APPLE_CERTIFICATE_PASSWORD:?Certificate password required}"
: "${APPLE_SIGNING_IDENTITY:?Developer ID Application identity required}"
: "${APPLE_ID:?Apple notarization account required}"
: "${APPLE_PASSWORD:?App-specific notarization password required}"
: "${APPLE_TEAM_ID:?Apple team required}"
: "${ILO_HOST_PROFILE_BASE64:?Provisioned host profile required}"
: "${ILO_WIDGET_PROFILE_BASE64:?Provisioned widget profile required}"
: "${ILO_KEYCHAIN_ACCESS_GROUP:?Provisioned shared Keychain group required}"
root="$(cd "$(dirname "$0")/.." && pwd)"
desktop="$(cd "$root/.." && pwd)"
workspace="$(mktemp -d)"
keychain="$workspace/signing.keychain-db"
keychain_password="$(uuidgen)"
cleanup() { security delete-keychain "$keychain" >/dev/null 2>&1 || true; rm -rf "$workspace"; }
trap cleanup EXIT
python3 - "$workspace" <<'PY'
import os, base64, pathlib, sys
root = pathlib.Path(sys.argv[1])
for source, name in [('APPLE_CERTIFICATE','certificate.p12'), ('ILO_HOST_PROFILE_BASE64','host.provisionprofile'), ('ILO_WIDGET_PROFILE_BASE64','widget.provisionprofile')]:
    target=root/name
    target.write_bytes(base64.b64decode(os.environ[source], validate=True))
    target.chmod(0o600)
PY
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$workspace/certificate.p12" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
cd "$desktop"
# The initial bundle is ad-hoc; embedding signs the complete bundle exactly once with Developer ID.
env -u APPLE_CERTIFICATE -u APPLE_CERTIFICATE_PASSWORD -u APPLE_SIGNING_IDENTITY -u APPLE_ID -u APPLE_PASSWORD -u APPLE_TEAM_ID pnpm exec tauri build --bundles app --ci
app="$desktop/src-tauri/target/release/bundle/macos/Nomi.app"
export ILO_SIGNING_IDENTITY="$APPLE_SIGNING_IDENTITY" ILO_SIGNING_KEYCHAIN="$keychain"
export ILO_HOST_ENTITLEMENTS="$root/Widgets/Host.entitlements"
export ILO_HOST_PROVISIONING_PROFILE="$workspace/host.provisionprofile"
export ILO_WIDGET_PROVISIONING_PROFILE="$workspace/widget.provisionprofile"
"$root/scripts/embed-widgets.sh" "$app"
ditto -c -k --keepParent "$app" "$workspace/nohmi.zip"
xcrun notarytool submit "$workspace/nohmi.zip" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
xcrun stapler staple "$app"
xcrun stapler validate "$app"
spctl --assess --type execute --verbose=2 "$app"
mkdir -p "$workspace/image" "$desktop/src-tauri/target/release/bundle/dmg"
ditto "$app" "$workspace/image/Nomi.app"
ln -s /Applications "$workspace/image/Applications"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
image="$desktop/src-tauri/target/release/bundle/dmg/nohmi_${version}_$(uname -m).dmg"
hdiutil create -volname nohmi -srcfolder "$workspace/image" -ov -format UDZO "$image"
codesign --force --timestamp --keychain "$keychain" --sign "$APPLE_SIGNING_IDENTITY" "$image"
xcrun notarytool submit "$image" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
xcrun stapler staple "$image"
xcrun stapler validate "$image"
