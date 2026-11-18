#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
arch="${PERSONAL_OS_WIDGET_ARCH:-$(uname -m)}"
sdk="$(xcrun --sdk macosx --show-sdk-path)"
output="${PERSONAL_OS_WIDGET_OUTPUT:-$root/build}"
app_group="${PERSONAL_OS_APP_GROUP:-group.app.personal-os.desktop}"
bundle="$output/PersonalOsWidgets.appex"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
cp "$root/Widgets/Info.plist" "$bundle/Contents/Info.plist"
cp "$root/Widgets/PersonalOsWidgets.entitlements" "$output/PersonalOsWidgets.entitlements"
/usr/libexec/PlistBuddy -c "Set :PersonalOsAppGroup $app_group" "$bundle/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :com.apple.security.application-groups:0 $app_group" "$output/PersonalOsWidgets.entitlements"
if [[ -n "${PERSONAL_OS_KEYCHAIN_ACCESS_GROUP:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Add :PersonalOsKeychainAccessGroup string $PERSONAL_OS_KEYCHAIN_ACCESS_GROUP" "$bundle/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Add :keychain-access-groups array' "$output/PersonalOsWidgets.entitlements"
  /usr/libexec/PlistBuddy -c "Add :keychain-access-groups:0 string $PERSONAL_OS_KEYCHAIN_ACCESS_GROUP" "$output/PersonalOsWidgets.entitlements"
fi
sources=("$root/Sources/PersonalOsNative/Models.swift" "$root/Sources/PersonalOsNative/Storage.swift" "$root/Widgets/PersonalOsWidgets.swift")
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${PERSONAL_OS_APP_VERSION:-0.1.0}" "$bundle/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${PERSONAL_OS_APP_BUILD:-1}" "$bundle/Contents/Info.plist"
# Emit constant values so App Intents configuration/actions receive their required metadata bundle.
# swift's protocol extraction list is JSON, despite the flag's historical name.
printf '%s\n' '["AppIntent", "WidgetConfigurationIntent", "AppEntity", "AppEnum"]' > "$output/const-protocols.json"
xcrun swiftc -swift-version 5 -parse-as-library -application-extension -O -whole-module-optimization \
  -module-name PersonalOsWidgets -target "$arch-apple-macosx14.0" -sdk "$sdk" \
  -Xfrontend -const-gather-protocols-file -Xfrontend "$output/const-protocols.json" \
  -emit-const-values-path "$output/PersonalOsWidgets.swiftconstvalues" \
  -framework SwiftUI -framework WidgetKit -framework AppIntents -framework Security -framework CryptoKit \
  "${sources[@]}" -o "$bundle/Contents/MacOS/PersonalOsWidgets"
printf '%s\n' "${sources[@]}" > "$output/sources.txt"
printf '%s\n' "$output/PersonalOsWidgets.swiftconstvalues" > "$output/const-values.txt"
metadata_args=(
  --output "$bundle/Contents/Resources"
  --toolchain-dir "$(xcode-select -p)/Toolchains/XcodeDefault.xctoolchain"
  --module-name PersonalOsWidgets
  --sdk-root "$sdk"
  --xcode-version "$(xcodebuild -version | awk '/Build version/{print $3}')"
  --platform-family macOS
  --deployment-target 14.0
  --target-triple "$arch-apple-macosx14.0"
  --source-file-list "$output/sources.txt"
  --swift-const-vals-list "$output/const-values.txt"
)
metadata_help="$(xcrun appintentsmetadataprocessor --help 2>&1 || true)"
if grep -Fq -- '--binary-file' <<< "$metadata_help"; then
  metadata_args+=(--binary-file "$bundle/Contents/MacOS/PersonalOsWidgets")
fi
xcrun appintentsmetadataprocessor "${metadata_args[@]}"
plutil -lint "$bundle/Contents/Info.plist" "$output/PersonalOsWidgets.entitlements"
if [[ -n "${PERSONAL_OS_WIDGET_PROVISIONING_PROFILE:-}" ]]; then cp "$PERSONAL_OS_WIDGET_PROVISIONING_PROFILE" "$bundle/Contents/embedded.provisionprofile"; fi
if [[ -n "${PERSONAL_OS_SIGNING_IDENTITY:-}" ]]; then
  : "${PERSONAL_OS_WIDGET_PROVISIONING_PROFILE:?A provisioned WidgetKit profile is required for signing}"
  : "${PERSONAL_OS_KEYCHAIN_ACCESS_GROUP:?A provisioned shared Keychain group is required for signing}"
  python3 "$root/scripts/profile-entitlements.py" "$PERSONAL_OS_WIDGET_PROVISIONING_PROFILE" "$output/PersonalOsWidgets.entitlements" "$output/PersonalOsWidgets.entitlements" "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$bundle/Contents/Info.plist")" "$app_group" "$PERSONAL_OS_KEYCHAIN_ACCESS_GROUP"
  keychain_args=()
  if [[ -n "${PERSONAL_OS_SIGNING_KEYCHAIN:-}" ]]; then keychain_args=(--keychain "$PERSONAL_OS_SIGNING_KEYCHAIN"); fi
  codesign "${keychain_args[@]}" --force --options runtime --timestamp --sign "$PERSONAL_OS_SIGNING_IDENTITY" --entitlements "$output/PersonalOsWidgets.entitlements" "$bundle"
  codesign --verify --strict --verbose=2 "$bundle"
fi
printf 'Built %s\n' "$bundle"
