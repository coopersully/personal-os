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
: "${NOHMI_UPDATER_PUBLIC_KEY:?Updater public key required}"
: "${VITE_API_BASE_URL:?Production API required}"
[[ "$VITE_API_BASE_URL" == "https://nohmi-api.coopersully.me" ]] || { echo "Official installers require the production nohmi API" >&2; exit 1; }
: "${TAURI_SIGNING_PRIVATE_KEY:?Updater signing key required}"
root="$(cd "$(dirname "$0")/.." && pwd)"
desktop="$(cd "$root/.." && pwd)"
workspace="$(mktemp -d)"
keychain="$workspace/signing.keychain-db"
keychain_password="$(uuidgen)"
original_keychains=()
while IFS= read -r original_keychain; do
  original_keychain="${original_keychain#*\"}"
  original_keychain="${original_keychain%\"*}"
  [[ -n "$original_keychain" ]] && original_keychains+=("$original_keychain")
done < <(security list-keychains -d user)
cleanup() {
  security list-keychains -d user -s "${original_keychains[@]}" >/dev/null 2>&1 || true
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  rm -rf "$workspace"
}
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
security list-keychains -d user -s "$keychain" "${original_keychains[@]}"
security import "$workspace/certificate.p12" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
# Fresh runners may not have Apple's Developer ID G2 intermediate installed.
# Import the public intermediate into this temporary keychain without changing trust.
curl --fail --silent --show-error --location --max-time 30 \
  https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer \
  -o "$workspace/DeveloperIDG2CA.cer"
printf '%s  %s\n' f16cd3c54c7f83cea4bf1a3e6a0819c8aaa8e4a1528fd144715f350643d2df3a "$workspace/DeveloperIDG2CA.cer" | shasum -a 256 -c -
security import "$workspace/DeveloperIDG2CA.cer" -k "$keychain" >/dev/null
# Prove identity lookup, private-key access and timestamping before compiling.
security find-identity -v -p codesigning "$keychain"
cp /usr/bin/true "$workspace/signing-probe"
codesign --force --timestamp --keychain "$keychain" --sign "$APPLE_SIGNING_IDENTITY" "$workspace/signing-probe"
codesign --verify --strict "$workspace/signing-probe"
cd "$desktop"
# The initial bundle is ad-hoc; embedding signs the complete bundle exactly once with Developer ID.
env -u APPLE_CERTIFICATE -u APPLE_CERTIFICATE_PASSWORD -u APPLE_SIGNING_IDENTITY -u APPLE_ID -u APPLE_PASSWORD -u APPLE_TEAM_ID pnpm exec tauri build --bundles app --ci
app="$desktop/src-tauri/target/release/bundle/macos/nohmi.app"
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
ditto "$app" "$workspace/image/nohmi.app"
ln -s /Applications "$workspace/image/Applications"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
update_arch="$(uname -m)"
if [[ "$update_arch" == "arm64" ]]; then update_arch="aarch64"; fi
image="$desktop/src-tauri/target/release/bundle/dmg/nohmi_${version}_${update_arch}.dmg"
hdiutil create -volname nohmi -srcfolder "$workspace/image" -ov -format UDZO "$image"
codesign --force --timestamp --keychain "$keychain" --sign "$APPLE_SIGNING_IDENTITY" "$image"
xcrun notarytool submit "$image" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
xcrun stapler staple "$image"
xcrun stapler validate "$image"

# Archive only the final widget-embedded, signed and stapled bundle.
archive="$desktop/src-tauri/target/release/bundle/dmg/nohmi_${version}_${update_arch}.app.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$archive" -C "$(dirname "$app")" "$(basename "$app")"
pnpm exec tauri signer sign --app-version "$version" "$archive"
