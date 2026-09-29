#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
arch="${ILO_WIDGET_ARCH:-$(uname -m)}"
sdk="$(xcrun --sdk macosx --show-sdk-path)"
output="${ILO_WIDGET_OUTPUT:-$root/build}"
app_group="${ILO_APP_GROUP:-group.app.personal-os.desktop}"
bundle="$output/IloWidgets.appex"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
cp "$root/Widgets/Info.plist" "$bundle/Contents/Info.plist"
cp "$root/Widgets/IloWidgets.entitlements" "$output/IloWidgets.entitlements"
/usr/libexec/PlistBuddy -c "Set :IloAppGroup $app_group" "$bundle/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :com.apple.security.application-groups:0 $app_group" "$output/IloWidgets.entitlements"
if [[ -n "${ILO_KEYCHAIN_ACCESS_GROUP:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Add :IloKeychainAccessGroup string $ILO_KEYCHAIN_ACCESS_GROUP" "$bundle/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Add :keychain-access-groups array' "$output/IloWidgets.entitlements"
  /usr/libexec/PlistBuddy -c "Add :keychain-access-groups:0 string $ILO_KEYCHAIN_ACCESS_GROUP" "$output/IloWidgets.entitlements"
fi
sources=("$root/Sources/IloNative/Models.swift" "$root/Sources/IloNative/Storage.swift" "$root/Widgets/IloWidgets.swift")
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${ILO_APP_VERSION:-0.1.0}" "$bundle/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${ILO_APP_BUILD:-1}" "$bundle/Contents/Info.plist"
# Emit constant values so App Intents configuration/actions receive their required metadata bundle.
# swift's protocol extraction list is JSON, despite the flag's historical name.
printf '%s\n' '["AppIntent", "WidgetConfigurationIntent", "AppEntity", "AppEnum"]' > "$output/const-protocols.json"
xcrun swiftc -swift-version 5 -parse-as-library -application-extension -O -whole-module-optimization \
  -module-name IloWidgets -target "$arch-apple-macosx14.0" -sdk "$sdk" \
  -Xfrontend -const-gather-protocols-file -Xfrontend "$output/const-protocols.json" \
  -emit-const-values-path "$output/IloWidgets.swiftconstvalues" \
  -framework SwiftUI -framework WidgetKit -framework AppIntents -framework Security -framework CryptoKit \
  "${sources[@]}" -o "$bundle/Contents/MacOS/IloWidgets"
printf '%s\n' "${sources[@]}" > "$output/sources.txt"
printf '%s\n' "$output/IloWidgets.swiftconstvalues" > "$output/const-values.txt"
metadata_args=(
  --output "$bundle/Contents/Resources"
  --toolchain-dir "$(xcode-select -p)/Toolchains/XcodeDefault.xctoolchain"
  --module-name IloWidgets
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
  metadata_args+=(--binary-file "$bundle/Contents/MacOS/IloWidgets")
fi
xcrun appintentsmetadataprocessor "${metadata_args[@]}"
plutil -lint "$bundle/Contents/Info.plist" "$output/IloWidgets.entitlements"
if [[ -n "${ILO_WIDGET_PROVISIONING_PROFILE:-}" ]]; then cp "$ILO_WIDGET_PROVISIONING_PROFILE" "$bundle/Contents/embedded.provisionprofile"; fi
if [[ -n "${ILO_SIGNING_IDENTITY:-}" ]]; then
  : "${ILO_WIDGET_PROVISIONING_PROFILE:?A provisioned WidgetKit profile is required for signing}"
  : "${ILO_KEYCHAIN_ACCESS_GROUP:?A provisioned shared Keychain group is required for signing}"
  python3 "$root/scripts/profile-entitlements.py" "$ILO_WIDGET_PROVISIONING_PROFILE" "$output/IloWidgets.entitlements" "$output/IloWidgets.entitlements" "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$bundle/Contents/Info.plist")" "$app_group" "$ILO_KEYCHAIN_ACCESS_GROUP"
  keychain_args=()
  if [[ -n "${ILO_SIGNING_KEYCHAIN:-}" ]]; then keychain_args=(--keychain "$ILO_SIGNING_KEYCHAIN"); fi
  codesign "${keychain_args[@]}" --force --options runtime --timestamp --sign "$ILO_SIGNING_IDENTITY" --entitlements "$output/IloWidgets.entitlements" "$bundle"
  codesign --verify --strict --verbose=2 "$bundle"
fi
printf 'Built %s\n' "$bundle"
