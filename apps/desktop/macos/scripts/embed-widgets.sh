#!/bin/bash
set -euo pipefail
# Run after Tauri creates the bundle and before notarization. Never signs with an invented identity.
: "${PERSONAL_OS_SIGNING_IDENTITY:?Set the real Apple signing identity}"
: "${PERSONAL_OS_KEYCHAIN_ACCESS_GROUP:?Set the provisioned TEAMID.app.personal-os.desktop group}"
: "${PERSONAL_OS_HOST_ENTITLEMENTS:?Set the existing host entitlement plist to preserve required Tauri capabilities}"
: "${PERSONAL_OS_WIDGET_PROVISIONING_PROFILE:?Set the matching widget provisioning profile}"
: "${PERSONAL_OS_HOST_PROVISIONING_PROFILE:?Set the matching host provisioning profile}"
app="${1:?Usage: embed-widgets.sh /path/to/nohmi.app}"
root="$(cd "$(dirname "$0")/.." && pwd)"
[[ -d "$app/Contents" ]] || { printf 'Not an application bundle: %s\n' "$app" >&2; exit 1; }
export PERSONAL_OS_APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
export PERSONAL_OS_APP_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$app/Contents/Info.plist")"
"$root/scripts/build-widgets.sh"
output="${PERSONAL_OS_WIDGET_OUTPUT:-$root/build}"
mkdir -p "$app/Contents/PlugIns"
ditto "$output/PersonalOsWidgets.appex" "$app/Contents/PlugIns/PersonalOsWidgets.appex"
python3 - "$PERSONAL_OS_HOST_ENTITLEMENTS" "$output/Host.entitlements" "$app/Contents/Info.plist" "${PERSONAL_OS_APP_GROUP:-group.app.personal-os.desktop}" "$PERSONAL_OS_KEYCHAIN_ACCESS_GROUP" <<'PY'
import plistlib, sys
source, destination, info_path, group, keychain = sys.argv[1:]
with open(source, 'rb') as f: entitlements = plistlib.load(f)
for key, value in [('com.apple.security.application-groups', group), ('keychain-access-groups', keychain)]:
    values = entitlements.setdefault(key, [])
    if value not in values: values.append(value)
with open(destination, 'wb') as f: plistlib.dump(entitlements, f)
with open(info_path, 'rb') as f: info = plistlib.load(f)
info['PersonalOsAppGroup'], info['PersonalOsKeychainAccessGroup'] = group, keychain
with open(info_path, 'wb') as f: plistlib.dump(info, f)
PY
cp "$PERSONAL_OS_HOST_PROVISIONING_PROFILE" "$app/Contents/embedded.provisionprofile"
python3 "$root/scripts/profile-entitlements.py" "$PERSONAL_OS_HOST_PROVISIONING_PROFILE" "$output/Host.entitlements" "$output/Host.entitlements" "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" "${PERSONAL_OS_APP_GROUP:-group.app.personal-os.desktop}" "$PERSONAL_OS_KEYCHAIN_ACCESS_GROUP"
keychain_args=()
if [[ -n "${PERSONAL_OS_SIGNING_KEYCHAIN:-}" ]]; then keychain_args=(--keychain "$PERSONAL_OS_SIGNING_KEYCHAIN"); fi
codesign "${keychain_args[@]}" --force --options runtime --timestamp --sign "$PERSONAL_OS_SIGNING_IDENTITY" --entitlements "$output/Host.entitlements" "$app"
codesign --verify --deep --strict --verbose=2 "$app"
printf 'Embedded and signed widgets in %s. Notarize and perform installed-app acceptance next.\n' "$app"
