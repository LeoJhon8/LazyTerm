#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must run on macOS." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_triple="${1:-aarch64-apple-darwin}"
app_binary="${repo_root}/src-tauri/target/${target_triple}/release/app"
frameworks_dir="${repo_root}/src-tauri/target/${target_triple}/release/macos-frameworks"
bundle_config="${repo_root}/src-tauri/target/${target_triple}/release/macos-bundle.conf.json"
brew_prefix="$(brew --prefix)"
brew_cellar="$(brew --cellar)"

if [[ ! -f "$app_binary" ]]; then
  echo "macOS application binary not found: $app_binary" >&2
  exit 1
fi

case "$frameworks_dir" in
  "${repo_root}/src-tauri/target/"*) ;;
  *)
    echo "Refusing to replace unexpected frameworks directory: $frameworks_dir" >&2
    exit 1
    ;;
esac

rm -rf -- "$frameworks_dir"
mkdir -p "$frameworks_dir"

dependencies() {
  local binary="$1"
  local install_name=""

  install_name="$(otool -D "$binary" 2>/dev/null | awk 'NR == 2 { print $1 }' || true)"
  otool -L "$binary" | awk -v install_name="$install_name" '
    NR > 1 && $1 != install_name { print $1 }
  '
}

is_system_dependency() {
  case "$1" in
    /System/*|/usr/lib/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

find_brew_library() {
  local library_name="$1"
  local match=""

  match="$(find -L "${brew_prefix}/opt" -type f -name "$library_name" -print 2>/dev/null | head -n 1 || true)"
  if [[ -z "$match" ]]; then
    match="$(find "$brew_cellar" -type f -name "$library_name" -print 2>/dev/null | head -n 1 || true)"
  fi

  if [[ -n "$match" ]]; then
    realpath "$match"
  fi
}

resolve_dependency() {
  local dependency="$1"
  local loader="$2"
  local candidate=""
  local library_name="$(basename "$dependency")"

  case "$dependency" in
    @loader_path/*)
      candidate="$(dirname "$loader")/${dependency#@loader_path/}"
      ;;
    @executable_path/*)
      candidate="$(dirname "$app_binary")/${dependency#@executable_path/}"
      ;;
    @rpath/*)
      candidate="$(dirname "$loader")/${dependency#@rpath/}"
      ;;
    /*)
      candidate="$dependency"
      ;;
  esac

  if [[ -n "$candidate" && "$candidate" != *'*'* && -e "$candidate" ]]; then
    realpath "$candidate"
    return 0
  fi

  candidate="$(find_brew_library "$library_name")"
  if [[ -n "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi

  echo "Unable to resolve dependency '$dependency' referenced by '$loader'." >&2
  return 1
}

ensure_frameworks_rpath() {
  local binary="$1"
  if ! otool -l "$binary" | awk '
    $1 == "cmd" && $2 == "LC_RPATH" { in_rpath = 1; next }
    in_rpath && $1 == "path" {
      if ($2 == "@executable_path/../Frameworks") found = 1
      in_rpath = 0
    }
    END { exit(found ? 0 : 1) }
  '; then
    install_name_tool -add_rpath "@executable_path/../Frameworks" "$binary"
  fi
}

declare -a scan_sources=("$app_binary")
declare -a scan_targets=("$app_binary")
declare -a bundled_names=()
declare -a bundled_sources=()

scan_index=0
while (( scan_index < ${#scan_sources[@]} )); do
  source_binary="${scan_sources[$scan_index]}"
  target_binary="${scan_targets[$scan_index]}"

  while IFS= read -r dependency; do
    [[ -z "$dependency" ]] && continue
    is_system_dependency "$dependency" && continue

    resolved="$(resolve_dependency "$dependency" "$source_binary")"
    library_name="$(basename "$dependency")"
    bundled_library="${frameworks_dir}/${library_name}"

    bundled_index=-1
    for index in "${!bundled_names[@]}"; do
      if [[ "${bundled_names[$index]}" == "$library_name" ]]; then
        bundled_index=$index
        break
      fi
    done

    if (( bundled_index >= 0 )) && [[ "${bundled_sources[$bundled_index]}" != "$resolved" ]]; then
      echo "Two dependencies use the same bundled name '$library_name':" >&2
      echo "  ${bundled_sources[$bundled_index]}" >&2
      echo "  $resolved" >&2
      exit 1
    fi

    if (( bundled_index < 0 )); then
      cp -L "$resolved" "$bundled_library"
      chmod u+w "$bundled_library"
      install_name_tool -id "@rpath/${library_name}" "$bundled_library"
      bundled_names+=("$library_name")
      bundled_sources+=("$resolved")
      scan_sources+=("$resolved")
      scan_targets+=("$bundled_library")
    fi

    install_name_tool -change "$dependency" "@rpath/${library_name}" "$target_binary"
  done < <(dependencies "$source_binary")

  ((scan_index += 1))
done

if (( ${#bundled_names[@]} == 0 )); then
  echo "No non-system macOS dynamic libraries were discovered." >&2
  exit 1
fi

ensure_frameworks_rpath "$app_binary"

{
  echo '{'
  echo '  "bundle": {'
  echo '    "macOS": {'
  echo '      "frameworks": ['
  for index in "${!bundled_names[@]}"; do
    suffix=','
    if (( index == ${#bundled_names[@]} - 1 )); then
      suffix=''
    fi
    printf '        "./target/%s/release/macos-frameworks/%s"%s\n' \
      "$target_triple" "${bundled_names[$index]}" "$suffix"
  done
  echo '      ]'
  echo '    }'
  echo '  }'
  echo '}'
} > "$bundle_config"

echo "Bundled ${#bundled_names[@]} non-system dynamic libraries."
echo "Generated Tauri bundle config: $bundle_config"
