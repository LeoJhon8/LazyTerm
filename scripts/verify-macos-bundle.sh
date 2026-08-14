#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must run on macOS." >&2
  exit 1
fi

app_bundle="${1:?Usage: verify-macos-bundle.sh /path/to/LazyTerm.app}"
app_bundle="$(cd "$(dirname "$app_bundle")" && pwd)/$(basename "$app_bundle")"
frameworks_dir="${app_bundle}/Contents/Frameworks"

if [[ ! -d "$app_bundle" ]]; then
  echo "Application bundle not found: $app_bundle" >&2
  exit 1
fi

if [[ ! -d "$frameworks_dir" ]]; then
  echo "Frameworks directory not found: $frameworks_dir" >&2
  exit 1
fi

verify_dependency() {
  local dependency="$1"
  local binary="$2"
  local resolved=""

  case "$dependency" in
    /System/*|/usr/lib/*)
      return 0
      ;;
    @rpath/*)
      resolved="${frameworks_dir}/${dependency#@rpath/}"
      ;;
    @loader_path/*)
      resolved="$(dirname "$binary")/${dependency#@loader_path/}"
      ;;
    @executable_path/*)
      resolved="${app_bundle}/Contents/MacOS/${dependency#@executable_path/}"
      ;;
    *)
      echo "Disallowed external dependency '$dependency' in '$binary'." >&2
      return 1
      ;;
  esac

  if [[ ! -e "$resolved" ]]; then
    echo "Bundled dependency '$dependency' from '$binary' does not resolve to '$resolved'." >&2
    return 1
  fi
}

while IFS= read -r -d '' binary; do
  if ! file "$binary" | grep -q 'Mach-O'; then
    continue
  fi

  while IFS= read -r dependency; do
    [[ -z "$dependency" ]] && continue
    verify_dependency "$dependency" "$binary"
  done < <(otool -L "$binary" | awk 'NR > 1 { print $1 }')
done < <(find "${app_bundle}/Contents/MacOS" "$frameworks_dir" -type f -print0)

codesign --verify --deep --strict --verbose=2 "$app_bundle"
echo "Verified macOS bundle dependencies and code signature: $app_bundle"
