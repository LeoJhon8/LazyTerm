# Release Process

> [简体中文](../../developer/release-process.md) | **English**

This document defines LazyTerm's desktop release process. GitHub is the single upstream for code, tags, and releases. Gitee is a one-way mirror for networks in mainland China. GitHub Packages is intentionally not used for the desktop application.

## Release Contents

Stable releases use a strict `vMajor.Minor.Patch` tag such as `v26.81.2912` and contain:

| File | Purpose |
| --- | --- |
| `LazyTerm_<version>_windows_x64-setup.exe` | Recommended Windows x64 installer |
| `LazyTerm_<version>_windows_x64.msi` | Windows x64 managed-deployment package |
| `LazyTerm_<version>_macos_arm64.dmg` | macOS Apple Silicon disk image |
| `SHA256SUMS.txt` | SHA-256 checksums for all installers |

GitHub also provides source archives corresponding to the tag. The workflow uses GitHub OIDC to generate build provenance for installers, verifiable with `gh attestation verify`.

## One-time Setup

### GitHub

1. Under `Settings > Actions > General > Workflow permissions`, allow workflows to write repository contents so `GITHUB_TOKEN` can create releases and upload assets.
2. Enable release immutability under `Settings > General > Releases`. The workflow creates a draft, uploads every asset, and only then publishes it.
3. A ruleset protecting `v*` tags is recommended to limit who can create or delete release tags.
4. Create the `breaking-change`, `enhancement`, `feature`, `bug`, `fix`, `documentation`, and `skip-changelog` labels for automatic release-note categories when practical.

### Gitee

When the mirror remains at `LeoJohn8/LazyTerm`, configure the following in the GitHub repository:

| Type | Name | Value |
| --- | --- | --- |
| Repository secret | `GITEE_USERNAME` | A user with write access to the Gitee repository |
| Repository secret | `GITEE_TOKEN` | A Gitee personal token used for Git HTTPS pushes and the API |
| Repository variable (optional) | `GITEE_REPOSITORY` | Defaults to `LeoJohn8/LazyTerm`; override after migration |

`GITEE_TOKEN` needs at least repository read/write permission. The first synchronization creates or updates the `main` branch. If the Gitee repository still uses another default branch, change its default branch to `main` after the first successful synchronization. If `GITEE_REPOSITORY` changes, update the Gitee fallback URL in `src/config/update-config.ts` as well.

Synchronization is one-way and non-destructive. Every GitHub `main` push updates Gitee `main`; after a release, the current tag and release assets are mirrored as well. The workflow does not use `git push --mirror` and therefore does not delete Gitee-only references. Do not develop directly in the Gitee mirror or modify matching branches or tags there.

The current Windows and macOS artifacts do not have commercial code signing. Until certificates are introduced, release notes must retain the unknown-publisher warning. Signing credentials must only be stored in GitHub Actions secrets.

## Prepare a Version

From a clean `main` branch, run:

```powershell
git switch main
git pull --ff-only
npm ci
npm run version:sync
npm run version:check
$releaseVersion = (Get-Content .\package.json -Raw | ConvertFrom-Json).version
git diff -- package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
```

`version:sync` derives a three-component, Windows-compatible version from the latest Git commit's UTC time and synchronizes:

- `package.json`
- `package-lock.json` (top level and root package)
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`

An explicit version can also be selected:

```powershell
npm run version:set -- 26.81.2912
```

After reviewing the version and changes, commit and create an annotated tag:

```powershell
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "准备发布 LazyTerm v$releaseVersion"
git tag -a "v$releaseVersion" -m "LazyTerm v$releaseVersion"
git push origin main
git push origin "v$releaseVersion"
```

Do not push a tag before updating the version files. The release workflow requires the tag and all five version locations to match and fails before building if any value differs.

## Automated Release Gates

After a valid tag is pushed, `.github/workflows/release.yml`:

1. Validates the tag, manifest versions, and lock-file versions.
2. Creates or reuses a draft release and generates release notes.
3. Builds Windows x64 NSIS/MSI and macOS Apple Silicon DMG artifacts in parallel.
4. Collects artifacts and generates `SHA256SUMS.txt`.
5. Generates GitHub artifact attestations for every asset.
6. Publishes the GitHub Release and marks it Latest only after every preceding step succeeds.
7. Uses `.github/workflows/mirror-gitee.yml` to copy the current tag and release assets to Gitee; the same workflow continuously mirrors ordinary `main` pushes.

A Gitee synchronization failure does not retract an already published GitHub Release. Rerun the mirror workflow independently from Actions. Do not move or reuse a tag after a build failure. Correct the cause and rerun failed jobs; the draft release is reused. Published release assets must not be overwritten, so publish a new version for corrections.

`workflow_dispatch` only retries a complete release for an existing tag. It does not create an ad hoc version from a branch.

## Dual-source In-app Updates

The application requests the GitHub Releases API with a five-second timeout, selects an installer for the current platform, and then probes the actual asset download path. If the API or asset CDN fails, GitHub is rate-limited, or no valid installer exists, the application parses the Gitee Release page. GitHub is therefore preferred and the Gitee mirror provides the mainland-China fallback.

Mirrored filenames must retain the `LazyTerm` prefix and three-component numeric version, or the Gitee page parser will not recognize them. After release, manually run Check for updates once from networks where GitHub is reachable and unreachable.

## Post-release Verification

```powershell
$releaseVersion = (Get-Content .\package.json -Raw | ConvertFrom-Json).version
gh release view "v$releaseVersion" --repo LeoJhon8/LazyTerm
gh release verify "v$releaseVersion" --repo LeoJhon8/LazyTerm
```

After downloading an asset, compare its SHA-256 checksum and verify provenance:

```powershell
Get-FileHash .\LazyTerm_*_windows_x64-setup.exe -Algorithm SHA256
gh attestation verify .\LazyTerm_*_windows_x64-setup.exe --repo LeoJhon8/LazyTerm
```

Finally, a maintainer should perform quick manual checks for Windows installation/startup, macOS mounting/startup, GitHub-preferred in-app updates, and Gitee fallback updates.
