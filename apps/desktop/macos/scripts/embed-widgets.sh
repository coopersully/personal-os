#!/bin/bash
set -euo pipefail
# Run after Tauri creates the bundle and before notarization. Never signs with an invented identity.
: "${ILO_SIGNING_IDENTITY:?Set the real Apple signing identity}"
: "${ILO_KEYCHAIN_ACCESS_GROUP:?Set the provisioned TEAMID.app.personal-os.desktop group}"
: "${ILO_HOST_ENTITLEMENTS:?Set the existing host entitlement plist to preserve required Tauri capabilities}"
: "${ILO_WIDGET_PROVISIONING_PROFILE:?Set the matching widget provisioning profile}"
: "${ILO_HOST_PROVISIONING_PROFILE:?Set the matching host provisioning profile}"
app="${1:?Usage: embed-widgets.sh /path/to/ilo.app}"
root="$(cd "$(dirname "$0")/.." && pwd)"
[[ -d "$app/Contents" ]] || { printf 'Not an application bundle: %s\n' "$app" >&2; exit 1; }
export ILO_APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
export ILO_APP_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$app/Contents/Info.plist")"
"$root/scripts/build-widgets.sh"
output="${ILO_WIDGET_OUTPUT:-$root/build}"
mkdir -p "$app/Contents/PlugIns"
ditto "$output/IloWidgets.appex" "$app/Contents/PlugIns/IloWidgets.appex"
python3 - "$ILO_HOST_ENTITLEMENTS" "$output/Host.entitlements" "$app/Contents/Info.plist" "${ILO_APP_GROUP:-group.app.personal-os.desktop}" "$ILO_KEYCHAIN_ACCESS_GROUP" <<'PY'
import plistlib, sys
source, destination, info_path, group, keychain = sys.argv[1:]
with open(source, 'rb') as f: entitlements = plistlib.load(f)
for key, value in [('com.apple.security.application-groups', group), ('keychain-access-groups', keychain)]:
    values = entitlements.setdefault(key, [])
    if value not in values: values.append(value)
with open(destination, 'wb') as f: plistlib.dump(entitlements, f)
with open(info_path, 'rb') as f: info = plistlib.load(f)
info['IloAppGroup'], info['IloKeychainAccessGroup'] = group, keychain
with open(info_path, 'wb') as f: plistlib.dump(info, f)
PY
cp "$ILO_HOST_PROVISIONING_PROFILE" "$app/Contents/embedded.provisionprofile"
python3 "$root/scripts/profile-entitlements.py" "$ILO_HOST_PROVISIONING_PROFILE" "$output/Host.entitlements" "$output/Host.entitlements" "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" "${ILO_APP_GROUP:-group.app.personal-os.desktop}" "$ILO_KEYCHAIN_ACCESS_GROUP"
keychain_args=()
if [[ -n "${ILO_SIGNING_KEYCHAIN:-}" ]]; then keychain_args=(--keychain "$ILO_SIGNING_KEYCHAIN"); fi
codesign "${keychain_args[@]}" --force --options runtime --timestamp --sign "$ILO_SIGNING_IDENTITY" --entitlements "$output/Host.entitlements" "$app"
codesign --verify --deep --strict --verbose=2 "$app"
printf 'Embedded and signed widgets in %s. Notarize and perform installed-app acceptance next.\n' "$app"
