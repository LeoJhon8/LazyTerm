<p align="center">
  <img src="./src-tauri/icons/LazyTerm-128.png" width="96" height="96" alt="LazyTerm icon">
</p>

<h1 align="center">LazyTerm</h1>

<p align="center">A multi-protocol desktop terminal workspace for local development and remote operations</p>

<p align="center">
  <a href="./README.md">简体中文</a> · <strong>English</strong>
</p>

LazyTerm is built with Tauri 2, React 19, TypeScript, and Rust. It brings local shells, SSH, AI CLI tools, RDP, VNC, serial, Telnet, and SFTP file transfers into one customizable, split-pane desktop workspace.

It is designed for managing multiple hosts, mixing text terminals with remote desktops, and saving reusable connection and layout templates for different projects.

## Highlights

- **One workspace for multiple protocols**: local terminals, SSH, AI CLI, Telnet, serial, RDP, and VNC share the same tab and pane model.
- **Recursive split panes and workspace templates**: create arbitrary horizontal or vertical layouts and save their sessions, ratios, focus, and font overrides.
- **Two RDP paths**: FreeRDP renders into a WebView canvas, while Windows can optionally use the native MsTscAx host.
- **Full VNC interaction**: region updates, remote cursors, clipboard synchronization, text input, key sequences, and remote desktop resizing.
- **SFTP file transfers**: remote directory browsing, batch upload/download, progress reporting, and cancellation.
- **Modern terminal UX**: xterm.js rendering with search, autocomplete, a command timeline, quick commands, command history, and font zoom.
- **Connection resilience**: consistent stages and errors, plus backoff reconnects for recoverable SSH, Telnet, serial, RDP, and VNC failures.
- **Adaptive graphics quality**: RDP/VNC frame rate and image quality respond to focus, pane visibility, and application visibility.
- **Credential vault**: sensitive fields are encrypted with AES-GCM, with optional master-password protection; profiles store credential references.
- **AI assistant and AI CLI sessions**: configure an OpenAI-compatible endpoint for streamed conversations or run AI command-line tools as terminal sessions.
- **Customizable application layout**: place sessions, history, quick commands, and the AI assistant in resizable side or bottom slots.
- **Configuration sync and updates**: explicitly sync primary configuration to a Git repository and use built-in update checks, downloads, and installation.

## Protocol Support

| Capability | Frontend | Backend | Notes |
| --- | --- | --- | --- |
| Local shell | xterm.js terminal | portable-pty | Working directory, shell, elevated mode, and startup command |
| SSH | xterm.js terminal | russh | Password, private-key, and interactive authentication paths |
| AI CLI | xterm.js terminal | portable-pty | Starts a user-configured CLI command |
| Telnet | xterm.js terminal | Tokio TCP | Intended for compatible legacy devices and services |
| Serial | xterm.js terminal | serialport | Common baud rate, data bits, parity, stop bits, and flow control |
| RDP | Canvas / native child window | FreeRDP / MsTscAx | MsTscAx is available only on Windows |
| VNC | Canvas | LibVNCClient FFI | Input, cursor, clipboard, and quality-policy support |
| SFTP | File-transfer dialogs | russh-sftp | Upload, download, remote browsing, progress, and cancellation |

## Current Build Targets

| Platform | Current build path | RDP backends |
| --- | --- | --- |
| Windows x64 | GitHub Actions produces NSIS / MSI artifacts; local builds are supported | FreeRDP, MsTscAx |
| macOS Apple Silicon | GitHub Actions produces a DMG; local builds are supported | FreeRDP |
| Linux | Build from source after installing Tauri and native-library dependencies | FreeRDP |

Prebuilt artifacts, SHA-256 checksums, and build provenance are published through [GitHub Releases](https://github.com/LeoJhon8/LazyTerm/releases), then mirrored one-way to Gitee. In-app updates try GitHub Releases first and automatically fall back to Gitee when GitHub times out, is unreachable, or has no valid installer. Maintainers should follow the [release process](./docs/en/developer/release-process.md).

## Quick Start

### Prerequisites

- Node.js 20+
- npm
- Rust 1.85+ stable toolchain
- [Platform prerequisites for Tauri 2](https://v2.tauri.app/start/prerequisites/)

For Windows development, you will typically also need:

- Microsoft Edge WebView2 Runtime
- Visual Studio 2022 C++ Build Tools and the Windows 10/11 SDK
- .NET SDK 8+ to build the MsTscAx sidecar
- FreeRDP and LibVNCClient development files

See the [Windows development setup](./docs/en/developer/development-setup-windows.md) for the full procedure.

On Debian or Ubuntu, install the base system packages first:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

For graphical protocols on macOS:

```bash
brew install libvncserver freerdp
```

### Install and Run

```powershell
npm ci
npm run tauri:dev
```

To run only the frontend development server:

```powershell
npm run dev
```

### Build Installers

Build the native Windows RDP sidecar:

```powershell
npm run build:msrdpax-sidecar:release
```

Build the desktop application:

```powershell
npm run tauri:build
```

`tauri:build` runs `scripts/update-version.js` first to synchronize the version from the latest Git commit's UTC timestamp.

### Compile and Code Checks

```powershell
npm run lint
& .\node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit
cargo check --manifest-path .\src-tauri\Cargo.toml
```

## Usage Overview

1. Create a connection from the welcome page, Quick Connect, or the session tree.
2. Place terminal, RDP, and VNC sessions in tabs and split panes.
3. Organize reusable connections in folders and save multi-pane layouts as workspace templates.
4. Open an SFTP upload or download dialog from an SSH profile.
5. Configure appearance, terminal behavior, layout slots, credentials, the AI assistant, and Git sync in Settings.
6. Use focus or immersive mode when you want fewer interface distractions.

## Common Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl + T` | Create a new tab |
| `Ctrl + W` | Close the current tab |
| `Ctrl + Tab` | Switch to the next tab |
| `Ctrl + Shift + Tab` | Switch to the previous tab |
| `Ctrl + F` | Search the current terminal buffer |
| `Ctrl + mouse wheel` | Change the current terminal font size |
| `Ctrl + Shift + C` | Copy selected terminal text |
| `Ctrl + Shift + V` | Paste into the terminal |
| `Ctrl + Shift + F` | Toggle focus mode |
| `F11` | Toggle immersive mode |

See the [shortcut reference](./docs/en/user/shortcuts.md) for details.

## Architecture Overview

```text
React UI
  -> Zustand runtime and configuration stores
  -> Connection Supervisor / Readiness / Quality
  -> Protocol Connectors
  -> Tauri invoke / event / binary Channel
  -> Rust protocol backend
  -> PTY / SSH / FreeRDP / LibVNCClient / serialport / sidecar
```

- `tabs.ts` is the application-level source of truth for session connection state.
- Connectors isolate the UI from protocol backends and own frontend listeners and connection resources.
- `ConnectionSupervisor` manages generations, error classification, and automatic reconnects.
- RDP/VNC frames use Tauri binary channels; text terminals mainly use per-session events.
- The Rust backend owns the actual session handles, asynchronous tasks, FFI clients, and native sidecar.

See the full [architecture design](./docs/en/developer/architecture.md) and the dedicated [RDP architecture](./docs/en/developer/rdp-architecture.md).

## Data and Security Boundaries

- Tabs, active sessions, Connectors, and the current pane tree exist only in runtime memory and are not restored automatically after restart.
- Settings, the session tree, workspace templates, quick commands, and other user configuration are stored in WebView localStorage.
- Git sync treats localStorage as the source of truth and reads or writes `lazy-term-config.json` in the repository root only when requested by the user.
- The credential vault stores an encrypted document; master-password mode derives its key with PBKDF2-SHA-256.
- Workspace templates and profiles use `credentialId` references and should not contain plaintext passwords, API keys, private-key contents, or private-key passphrases.
- The AI assistant API key is managed by the credential vault; AI configuration stores only the endpoint, model, and credential reference.

Common application data directories:

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%/LazyTerm/` |
| macOS | `~/Library/Application Support/LazyTerm/` |
| Linux | `~/.config/LazyTerm/` |

## Project Layout

```text
src/
  components/             # Layout, session views, dialogs, modules, and base UI
  connectors/             # Local, SSH, RDP, VNC, serial, Telnet, and AI CLI connectors
  services/connection/    # Reconnects, readiness, quality policies, and error classification
  services/               # Tauri IPC and application services
  store/                  # Zustand runtime state and persistent configuration
  lib/                    # Workspace, credential, layout, and event domain logic
  hooks/                  # Terminal, view-mode, and dialog hooks
  types/                  # Session, IPC, and workspace-template types
  i18n/                   # Chinese and English UI strings

src-tauri/
  src/protocol/           # PTY, SSH, SFTP, RDP, VNC, serial, Telnet, Git, and updater
  src/state.rs            # Active backend session registries
  src/lib.rs              # Tauri plugins, managed state, and command registration
  native/msrdpax-host/    # Native Windows RDP sidecar
  native/freerdp-runtime/ # Windows FreeRDP runtime
  capabilities/           # Tauri permission configuration
```

## Documentation

The detailed documentation is available in English and Simplified Chinese.

| Document | Contents |
| --- | --- |
| [Documentation index](./docs/en/README.md) | All English user and developer documents |
| [Getting started](./docs/en/user/getting-started.md) | Environment, startup, and first use |
| [Features](./docs/en/user/features.md) | Protocol and workspace capabilities |
| [Troubleshooting](./docs/en/user/troubleshooting.md) | Connection, build, and native dependency issues |
| [Architecture design](./docs/en/developer/architecture.md) | State ownership, connection orchestration, IPC, and persistence |
| [Development workflow](./docs/en/developer/development-workflow.md) | Daily development and change guidelines |

## Troubleshooting

### The local terminal cannot be created

Verify that the configured shell exists. On Windows, check `powershell.exe`, `pwsh.exe`, or the Git Bash path, then select the default shell again in Settings.

### SSH, Telnet, or remote desktop keeps reconnecting

Check the host, port, network, credentials, and remote service. LazyTerm automatically retries only failures classified as recoverable; authentication, certificate, or host-key failures generally require user action.

### RDP or VNC does not build on Windows

Follow the [Windows development setup](./docs/en/developer/development-setup-windows.md) to prepare FreeRDP, LibVNCClient, the C++ toolchain, and the optional .NET sidecar environment.

### SFTP cannot transfer files

Verify the SSH credentials, confirm that the remote SFTP subsystem is enabled, and check permissions for both the local and remote directories.

See [troubleshooting](./docs/en/user/troubleshooting.md) for more information.

## Contributing and Support

Issues, pull requests, and documentation improvements are welcome. Please read:

- [Contributing guide](./CONTRIBUTING.md)
- [Support policy](./SUPPORT.md)
- [Security policy](./SECURITY.md)

When reporting a problem, include the LazyTerm version, operating system, connection type, reproduction steps, and sanitized logs. Do not upload passwords, private keys, tokens, real server addresses, or terminal output containing personal information.

## License

LazyTerm is licensed under the [GNU General Public License v3.0 or later](./LICENSE). Distribution of modified versions or binaries must comply with the GPL and include the corresponding source code.

The default VNC build links LibVNCClient under GPL-2.0-or-later. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for licensing details about third-party components, fonts, and bundled binaries.

Copyright (c) 2025-present LazyTerm Contributors

## Acknowledgements

LazyTerm builds on many excellent projects, especially [Tauri](https://tauri.app/), [React](https://react.dev/), [xterm.js](https://xtermjs.org/), [Zustand](https://zustand.docs.pmnd.rs/), [russh](https://github.com/warp-tech/russh), [FreeRDP](https://www.freerdp.com/), [LibVNCServer / LibVNCClient](https://github.com/LibVNC/libvncserver), [Radix UI](https://www.radix-ui.com/), and [shadcn/ui](https://ui.shadcn.com/).

Development has also been assisted by tools such as Codex, Copilot, CodeBuddy, Lingma, and Antigravity, as well as models or platforms including ChatGPT, Gemini, GLM, Claude, Kimi, Doubao, and Qwen.
