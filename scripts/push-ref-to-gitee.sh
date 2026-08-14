#!/usr/bin/env bash

set -euo pipefail

source_ref="${1:?Usage: push-ref-to-gitee.sh <source-ref> <target-ref>}"
target_ref="${2:?Usage: push-ref-to-gitee.sh <source-ref> <target-ref>}"
max_attempts="${GITEE_PUSH_MAX_ATTEMPTS:-5}"

if [[ -z "${GITEE_USERNAME:-}" || -z "${GITEE_TOKEN:-}" ]]; then
  echo "GITEE_USERNAME and GITEE_TOKEN are required." >&2
  exit 1
fi

if [[ ! "${GITEE_REPOSITORY:-}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "GITEE_REPOSITORY must use owner/repository format." >&2
  exit 1
fi

if [[ ! "$max_attempts" =~ ^[1-9][0-9]*$ ]]; then
  echo "GITEE_PUSH_MAX_ATTEMPTS must be an integer between 1 and 10." >&2
  exit 1
fi

if (( max_attempts > 10 )); then
  echo "GITEE_PUSH_MAX_ATTEMPTS must be an integer between 1 and 10." >&2
  exit 1
fi

case "$target_ref" in
  refs/heads/*|refs/tags/*) ;;
  *)
    echo "Target ref must be under refs/heads or refs/tags: $target_ref" >&2
    exit 1
    ;;
esac

local_commit="$(git rev-parse "${source_ref}^{commit}")"
gitee_url="https://gitee.com/${GITEE_REPOSITORY}.git"
credential_helper='!f() { echo "username=$GITEE_USERNAME"; echo "password=$GITEE_TOKEN"; }; f'
git_gitee=(
  git
  -c http.version=HTTP/1.1
  -c credential.helper="$credential_helper"
)

remote_commit() {
  local refs=""

  refs="$(
    timeout 2m "${git_gitee[@]}" ls-remote \
      "$gitee_url" \
      "$target_ref" \
      "${target_ref}^{}" \
      2>/dev/null
  )" || return 1

  awk -v direct="$target_ref" -v peeled="${target_ref}^{}" '
    $2 == direct { direct_sha = $1 }
    $2 == peeled { peeled_sha = $1 }
    END { print peeled_sha != "" ? peeled_sha : direct_sha }
  ' <<< "$refs"
}

remote_matches_local() {
  local remote_sha=""

  remote_sha="$(remote_commit)" || return 1
  [[ -n "$remote_sha" && "$remote_sha" == "$local_commit" ]]
}

is_non_retryable_failure() {
  local log_file="$1"

  grep -Eiq \
    'authentication failed|http 40[13]|returned error: 40[13]|permission denied|access denied|non-fast-forward|fetch first|protected branch|protected tag|already exists' \
    "$log_file"
}

for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
  if remote_matches_local; then
    echo "Gitee already has $target_ref at $local_commit."
    exit 0
  fi

  log_file="$(mktemp)"
  echo "Pushing $source_ref to Gitee $target_ref (attempt $attempt/$max_attempts)."

  set +e
  timeout 5m "${git_gitee[@]}" push --porcelain \
    "$gitee_url" \
    "${source_ref}:${target_ref}" \
    2>&1 | tee "$log_file"
  push_status=${PIPESTATUS[0]}
  set -e

  if [[ "$push_status" -eq 0 ]]; then
    rm -f -- "$log_file"
    echo "Pushed $target_ref to Gitee at $local_commit."
    exit 0
  fi

  # A network error can happen after Gitee accepts the update but before Git
  # receives the response. Verify the remote before attempting the same push.
  if remote_matches_local; then
    rm -f -- "$log_file"
    echo "Gitee accepted $target_ref despite the client-side push error."
    exit 0
  fi

  if is_non_retryable_failure "$log_file"; then
    echo "Gitee rejected the push with a non-retryable error." >&2
    rm -f -- "$log_file"
    exit "$push_status"
  fi

  rm -f -- "$log_file"
  if [[ "$attempt" -eq "$max_attempts" ]]; then
    echo "Unable to push $target_ref to Gitee after $max_attempts attempts." >&2
    exit "$push_status"
  fi

  delay=$((15 * (1 << (attempt - 1))))
  if [[ "$delay" -gt 120 ]]; then
    delay=120
  fi
  echo "Retrying the Gitee push in ${delay}s."
  sleep "$delay"
done
