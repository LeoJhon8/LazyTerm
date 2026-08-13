# Dependency License Audit

> [简体中文](../../developer/dependency-license-audit.md) | **English**

Most recent baseline check: 2026-08-03.

This file records a package-manager metadata license baseline for comparison during dependency upgrades. It does not replace a release-time review of actual packaged files, copyright notices, and full license texts.

This is a historical audit record, not a live report that updates with lockfiles. After dependencies change, rerun the audit and record the new date, tooling, and results. Do not update only the numeric totals.

## Project License Choice

LazyTerm uses `GPL-3.0-or-later`. The default VNC build links LibVNCClient under `GPL-2.0-or-later`; choosing GPLv3 or later is compatible through LibVNCClient's “or later” terms.

## Frontend Dependencies

Audit source: license fields for 550 packages in `package-lock.json` at the baseline date.

Major expressions included MIT, Apache-2.0, ISC, BSD, MPL-2.0, LGPL-3.0-or-later, BlueOak-1.0.0, Python-2.0, CC-BY-4.0, SIL OFL, Zlib, and 0BSD. No dependency was found that required the project to adopt a GPL-incompatible license.

LGPL entries came from Sharp platform runtime packages and libvips. They were optional platform packages in the build-tool dependency tree; release review must still confirm whether the actual artifact includes the relevant binaries and notices.

Two legacy packages lacked a standard `license` field:

- `console-browserify@1.2.0`
- `querystring-es3@0.2.1`

Their legacy `licenses` metadata and bundled license files declared MIT.

## Rust Dependencies

Audit source: 730 packages returned by `cargo metadata --format-version 1 --locked` at the baseline date.

No Cargo package lacked license metadata. Most dependencies used MIT, Apache-2.0, BSD, ISC, MPL-2.0, Zlib, Unicode-3.0, BSL-1.0, CC0, or combinations of them.

Dependencies whose metadata contained GPL/LGPL text were:

| Package | License expression | Notes |
| --- | --- | --- |
| `app` | `GPL-3.0-or-later` | LazyTerm itself |
| `unescaper@0.1.8` | `GPL-3.0/MIT` | Metadata offers GPLv3 or MIT; compatible with the project |
| `r-efi@5.3.0` | `MIT OR Apache-2.0 OR LGPL-2.1-or-later` | MIT or Apache-2.0 may be selected |

## Checks Still Required Before Release

- Generate a dependency inventory from final installers instead of relying only on lockfiles.
- Include required copyright notices and full license texts with binaries.
- Rerun the audit after adding, upgrading, or replacing dependencies and prebuilt DLLs.
- Manually review licenses that cannot be expressed with valid SPDX syntax.
- Verify exact versions, source availability, and distribution duties for FreeRDP, WinPR, OpenSSL, LibVNCClient, the MsTscAx sidecar, and bundled DLLs.
