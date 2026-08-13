# Public Repository Release Checklist

> [简体中文](../../developer/public-release-checklist.md) | **English**

This document records preparation only; it does not change GitHub repository visibility. A maintainer must manually switch the repository to Public after every check is complete.

Checkbox state is a historical record of repository preparation. Translation, formatting, or routine documentation changes must not alter completion state; check an item only after actual verification.

## Licensing and Distribution

- [x] The project license is consistently `GPL-3.0-or-later`.
- [x] License declarations in `package.json`, `Cargo.toml`, and README agree.
- [x] Installer resources include `LICENSE` and `THIRD_PARTY_NOTICES.md`.
- [x] Current FreeRDP, WinPR, and OpenSSL DLL versions and SHA-256 values have been recorded.
- [x] A GPLv3 compatibility baseline was run against `package-lock.json` and Cargo metadata.
- [ ] Confirm the exact download URL, build source, and source tag for every prebuilt DLL, and update third-party notices whenever a binary changes.
- [ ] Generate a complete third-party inventory from final installers and review all copyright notices and full license texts that must accompany distribution.

The GPL permits private internal development, but distributing GPL binaries to third parties requires providing the complete corresponding source for that version. Before the repository is public, do not publish binaries built under the new license to a public update server.

## Identity and Intellectual Property

- [ ] Confirm every contribution may be published under GPL-3.0-or-later and contains no proprietary employer, customer, or third-party project code.
- [ ] Review all Git author names and email addresses; decide whether to retain history, rewrite addresses to GitHub noreply, or publish a clean snapshot.
- [ ] If history rewriting is necessary, create a read-only backup and rehearse in a separate clone. Never force-push the only copy.

## Sensitive Information

- [x] A full-history baseline scan with Gitleaks 8.30.1 completed on 2026-08-03 with no findings.
- [ ] Run Gitleaks over full history again on the final public candidate: `gitleaks git . --redact=100`.
- [ ] Manually inspect history for `.env` files, certificates, private keys, tokens, real hosts, usernames, logs, and exported connection configuration.
- [ ] Revoke or rotate any credential that ever entered Git history; deleting files or rewriting history does not make a credential safe again.

## Security and Community Settings

- [x] `SECURITY.md`, `CONTRIBUTING.md`, and `SUPPORT.md` exist.
- [x] Bug, feature, and pull request templates exist.
- [ ] Enable Private Vulnerability Reporting in GitHub repository settings.
- [ ] Confirm issue labels, repository description, topics, and default-branch protection.
- [ ] Define the support scope of the first public release and prepare a known-issues list.

## Release Integrity

- [ ] Create a source tag for the first public release and ensure every binary maps exactly to that tag.
- [ ] Distribute license files, third-party notices, checksums, and the corresponding source URL with installers.
- [ ] Review Windows and macOS signing workflows and keep signing credentials out of the repository and logs.
- [ ] From an unauthenticated environment, verify access to source, Releases, issue templates, and the private security-reporting entry point.

## Changing Visibility

- [ ] Confirm again that the default branch and all historical references have passed the sensitive-data review.
- [ ] Have a maintainer manually change repository visibility to Public.
- [ ] Immediately perform an anonymous clone and verify the project homepage, license detection, and release download links.
