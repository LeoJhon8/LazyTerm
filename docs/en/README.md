# LazyTerm Documentation

> [简体中文](../README.md) | **English**

This directory contains LazyTerm user guides and maintainer documentation. See the repository [README](../../README_EN.md) for the project overview, feature summary, and primary build commands.

## User Documentation

| Document | Contents |
| --- | --- |
| [Getting started](./user/getting-started.md) | Obtaining the app, running from source, first use, and data boundaries |
| [Features](./user/features.md) | Protocols, workspaces, terminals, transfers, AI, and configuration sync |
| [Shortcuts](./user/shortcuts.md) | Global, tab, and terminal keyboard operations |
| [Troubleshooting](./user/troubleshooting.md) | Connections, credentials, SFTP, native dependencies, and development setup |

## Developer Documentation

| Document | Contents |
| --- | --- |
| [Architecture design](./developer/architecture.md) | Workspace/session models, connection orchestration, Tauri IPC, Rust backend, and persistence |
| [Windows development setup](./developer/development-setup-windows.md) | Toolchains, native dependencies, environment variables, and setup scripts |
| [Development workflow](./developer/development-workflow.md) | Daily commands, verification rules, protocol extensions, and bilingual documentation |
| [Release process](./developer/release-process.md) | Version synchronization, GitHub Release gates, one-way Gitee mirroring, checksums, and provenance |
| [RDP architecture](./developer/rdp-architecture.md) | FreeRDP, MsTscAx sidecar, connection state, and performance paths |
| [View modes](./developer/view-modes.md) | State and layout rules for `normal`, `focus`, and `immersive` |
| [Dependency license audit](./developer/dependency-license-audit.md) | Recorded npm, Cargo, and native-dependency license baseline |
| [Public release checklist](./developer/public-release-checklist.md) | Licensing, sensitive data, community settings, and release integrity |

## Maintenance Rules

- `docs/user/` and `docs/developer/` contain the Simplified Chinese source documentation.
- `docs/en/user/` and `docs/en/developer/` mirror the Chinese structure in English.
- When adding or changing a document, update its language counterpart and both documentation indexes.
- Historical audits and release checklists must retain their actual execution dates. Translation or formatting work does not make an old audit current.
