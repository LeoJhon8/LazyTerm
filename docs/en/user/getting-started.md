# Getting Started

> [简体中文](../../user/getting-started.md) | **English**

This guide explains how to obtain or run LazyTerm from source, along with the data and credential boundaries relevant to first use.

## Obtaining the Application

Prebuilt availability depends on the current release. Check [GitHub Releases](https://github.com/An-egg/LazyTerm/releases) first. The repository currently contains these build paths:

| Platform | Build target |
| --- | --- |
| Windows | x64, NSIS / MSI |
| macOS | Apple Silicon, DMG / App |
| Linux | Build from source after installing system dependencies |

If no artifact matches your platform, follow the source instructions below.

## Source Prerequisites

- Node.js 20+
- npm
- Rust 1.85+ stable toolchain
- Platform prerequisites for Tauri 2

Windows additionally requires or benefits from:

- Microsoft Edge WebView2 Runtime
- Visual Studio 2022 C++ Build Tools and the Windows 10/11 SDK
- .NET SDK 8+ for the MsTscAx RDP sidecar
- FreeRDP and LibVNCClient development files for embedded RDP/VNC

See [Windows development setup](../developer/development-setup-windows.md) for the complete procedure.

## Installing Dependencies

Run from the repository root:

```powershell
npm ci
```

Use `npm install` only when intentionally adding or upgrading dependencies because it can modify `package-lock.json`.

## Starting the Application

Start the complete desktop application:

```powershell
npm run tauri:dev
```

Start only the frontend development server:

```powershell
npm run dev
```

When running only the frontend, terminal, protocol, and system functionality that depends on Tauri IPC is unavailable.

## First Use

1. Open Quick Connect or New Connection from the welcome page.
2. Select local terminal, SSH, RDP, VNC, serial, Telnet, or AI CLI.
3. Before saving reusable remote connections, create credentials in Settings; profiles reference credential IDs.
4. Use tabs and split panes to manage multiple sessions.
5. To reuse a pane group across restarts, save the current multi-pane tab as a workspace template.
6. Configure terminal behavior, appearance, layout, AI, credentials, and data sync in Settings.

## Configuring the AI Assistant

1. Create an `API Key` credential in credential settings.
2. In AI settings, enter an OpenAI-compatible service URL and model name.
3. Select the credential and save the configuration.
4. Place the AI module in a visible slot and start a conversation.

The endpoint must use HTTP or HTTPS. LazyTerm calls a compatible `/v1/chat/completions` endpoint and supports SSE streaming.

## Data and Recovery

- Settings, the session tree, workspace templates, and quick commands are stored in WebView localStorage.
- Tabs, active connections, and the current pane tree exist only in memory and are not restored automatically after the app closes.
- Credentials are stored as an encrypted vault document. A master-password vault must be unlocked after startup before its complete credentials can be used.
- Git configuration sync is explicitly triggered by the user and treats localStorage as the source of truth.

Common application data directories:

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%/LazyTerm/` |
| macOS | `~/Library/Application Support/LazyTerm/` |
| Linux | `~/.config/LazyTerm/` |

The exact storage-file location can vary between WebView and packaging environments. Before exporting, syncing, or clearing data, confirm the scope in the application's data settings.

## Next Steps

- [Features](./features.md)
- [Shortcuts](./shortcuts.md)
- [Troubleshooting](./troubleshooting.md)
