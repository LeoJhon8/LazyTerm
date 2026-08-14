#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must run on macOS." >&2
  exit 1
fi

dmg_input="${1:?Usage: verify-macos-dmg.sh <dmg-path> <report-directory> [expected-version]}"
report_input="${2:?Usage: verify-macos-dmg.sh <dmg-path> <report-directory> [expected-version]}"
expected_version="${3:-}"

if [[ ! -f "$dmg_input" ]]; then
  echo "DMG not found: $dmg_input" >&2
  exit 1
fi

dmg_path="$(cd "$(dirname "$dmg_input")" && pwd)/$(basename "$dmg_input")"
mkdir -p "$report_input"
report_dir="$(cd "$report_input" && pwd)"
temp_root="$(mktemp -d)"
mount_dir="${temp_root}/mount"
install_dir="${temp_root}/Applications"
installed_app="${install_dir}/LazyTerm.app"
app_pid=""
mounted=false

cleanup() {
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill -TERM "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$mount_dir" -quiet || true
  fi
  rm -rf -- "$temp_root"
}
trap cleanup EXIT

mkdir -p "$mount_dir" "$install_dir"
hdiutil attach "$dmg_path" \
  -readonly \
  -nobrowse \
  -mountpoint "$mount_dir" \
  | tee "${report_dir}/hdiutil-attach.log"
mounted=true

bundled_apps=()
while IFS= read -r bundled_app; do
  bundled_apps+=("$bundled_app")
done < <(find "$mount_dir" -maxdepth 1 -type d -name '*.app' -print)
if [[ "${#bundled_apps[@]}" -ne 1 ]]; then
  echo "Expected exactly one application in the DMG, found ${#bundled_apps[@]}." >&2
  exit 1
fi

ditto "${bundled_apps[0]}" "$installed_app"
hdiutil detach "$mount_dir" | tee "${report_dir}/hdiutil-detach.log"
mounted=false

info_plist="${installed_app}/Contents/Info.plist"
app_binary="${installed_app}/Contents/MacOS/app"
if [[ ! -f "$info_plist" || ! -x "$app_binary" ]]; then
  echo "Installed application is missing Info.plist or its executable." >&2
  exit 1
fi

actual_version="$(plutil -extract CFBundleShortVersionString raw "$info_plist")"
bundle_identifier="$(plutil -extract CFBundleIdentifier raw "$info_plist")"
{
  echo "Version: $actual_version"
  echo "Bundle identifier: $bundle_identifier"
  file "$app_binary"
} | tee "${report_dir}/application-info.log"

if [[ -n "$expected_version" && "$actual_version" != "$expected_version" ]]; then
  echo "Expected application version $expected_version, found $actual_version." >&2
  exit 1
fi

if [[ "$bundle_identifier" != "com.lazy.term" ]]; then
  echo "Unexpected bundle identifier: $bundle_identifier" >&2
  exit 1
fi

if ! file "$app_binary" | grep -Eq 'arm64|arm64e'; then
  echo "The packaged executable is not an Apple Silicon binary." >&2
  exit 1
fi

verification_failed=false
bundle_status=passed
launch_status=passed

if ! bash scripts/verify-macos-bundle.sh "$installed_app" \
  > >(tee "${report_dir}/bundle-verification.log") \
  2>&1; then
  echo "Application bundle dependency or code-signature verification failed." >&2
  verification_failed=true
  bundle_status=failed
fi

set +e
codesign -dvvv "$installed_app" \
  > "${report_dir}/codesign-details.log" \
  2>&1
spctl --assess --type execute --verbose=4 "$installed_app" \
  > "${report_dir}/gatekeeper-assessment.log" \
  2>&1
gatekeeper_status=$?
xcrun stapler validate "$dmg_path" \
  > "${report_dir}/notarization-ticket.log" \
  2>&1
notarization_status=$?
set -e

if [[ "$gatekeeper_status" -ne 0 ]]; then
  echo "Gatekeeper rejected the installed application." >&2
  cat "${report_dir}/gatekeeper-assessment.log" >&2
  verification_failed=true
fi

if [[ "$notarization_status" -ne 0 ]]; then
  echo "The DMG does not contain a valid stapled notarization ticket." >&2
  cat "${report_dir}/notarization-ticket.log" >&2
  verification_failed=true
fi

"$app_binary" > "${report_dir}/launch.log" 2>&1 &
app_pid=$!

for ((second = 1; second <= 15; second += 1)); do
  sleep 1
  if ! kill -0 "$app_pid" 2>/dev/null; then
    set +e
    wait "$app_pid"
    launch_status=$?
    set -e
    app_pid=""
    echo "LazyTerm exited during startup after ${second}s with status $launch_status." >&2
    cat "${report_dir}/launch.log" >&2
    verification_failed=true
    launch_status=failed
    break
  fi
done

if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
  echo "LazyTerm remained running for 15 seconds."
  kill -TERM "$app_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  app_pid=""
fi

{
  echo "# macOS package verification"
  echo
  echo "- Version: \`$actual_version\`"
  echo "- Bundle identifier: \`$bundle_identifier\`"
  echo "- Bundle dependencies and signature: $bundle_status"
  echo "- Gatekeeper assessment: $([[ "$gatekeeper_status" -eq 0 ]] && echo passed || echo failed)"
  echo "- Stapled notarization ticket: $([[ "$notarization_status" -eq 0 ]] && echo passed || echo failed)"
  echo "- Launch check: $launch_status (15 seconds)"
} > "${report_dir}/summary.md"

if [[ "$verification_failed" == true ]]; then
  echo "macOS DMG verification failed. See $report_dir for details." >&2
  exit 1
fi

echo "Verified macOS DMG installation and launch: $dmg_path"
