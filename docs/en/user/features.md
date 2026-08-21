# Features

> [简体中文](../../user/features.md) | **English**

## Multi-Protocol Connections

LazyTerm places text terminals and graphical remote desktops in the same tabbed, split-pane workspace:

| Type | Main capabilities |
| --- | --- |
| Local terminal | Creates a PTY through a local shell, with working directory, shell, elevation, and startup-command options |
| SSH | Password, private-key, and interactive authentication paths with credential-vault references |
| AI CLI | Runs a user-configured AI command-line tool as a normal terminal session |
| Telnet | Connects to compatible Telnet devices and services |
| Serial | Configurable port, baud rate, data bits, parity, stop bits, and flow control |
| RDP | Embedded FreeRDP canvas; optional native MsTscAx host on Windows |
| VNC | Frames, keyboard/mouse input, key sequences, remote cursor, clipboard, and remote resizing |

SSH, Telnet, serial, RDP, and VNC use backoff reconnects for recoverable failures. Authentication rejection, certificate/host-key issues, and invalid configuration normally require user action and are not retried indefinitely.

## Session Tree and Credentials

The session tree stores and organizes reusable configuration:

- Use folders to group connections by project, environment, or customer.
- Create, edit, duplicate, delete, drag-sort, import, and export nodes.
- Remote profiles prefer `credentialId` references instead of storing plaintext passwords or private-key contents in normal configuration.
- The credential vault encrypts sensitive fields with AES-GCM and supports optional master-password protection.
- While a master-password vault is locked, only credential metadata is visible and dependent connections cannot obtain the encrypted secrets.

## Tabs, Split Panes, and Workspace Templates

The central workspace supports:

- Multiple tabs with drag-and-drop ordering.
- Arbitrarily nested horizontal and vertical split panes.
- A mix of local terminal, SSH, RDP, VNC, and other views in one workspace.
- Pane focus, ratio adjustment, maximize operations, and per-pane font zoom.
- Saving multi-pane session groups as workspace templates.

Active tabs and the current pane tree live only in runtime memory and are not restored automatically after restart. Workspace templates are the explicit cross-restart layout mechanism. A template stores session definitions, the recursive layout, ratios, and focus, but not plaintext credentials.

## Custom Layout and View Modes

The session tree, history, quick commands, and AI assistant can be placed in top, bottom, left, or right slots. Slot sizes and module ordering are configurable.

LazyTerm provides three mutually exclusive view modes:

- `normal`: shows interface regions according to the user's slot configuration.
- `focus`: hides the left, right, and bottom slots while retaining the title bar and top tabs.
- `immersive`: hides the title bar and all slots so the session area fills the window.

## Terminal Experience

The terminal view is built on xterm.js:

- Themes, fonts, font size, opacity, and background images.
- Copy, paste, right-click behavior, and per-pane font zoom.
- Terminal-buffer search with case-sensitive, whole-word, and regular-expression options.
- Command history, quick commands, and optional autocomplete.
- An optional command timeline for locating submitted commands.
- Application or system notifications after long-running commands finish.
- Automatic selection of a compatible rendering path when opacity or a background image is enabled.

## SFTP File Transfers

SSH profiles support independent SFTP operations:

- Browse remote directories.
- Upload one or many files.
- Download files or recursively download directory contents.
- Show total and current-file progress.
- Cancel an active upload or download.

SFTP uses the associated SSH profile and credentials but does not require an already open terminal session.

## Graphical Remote Desktops

### RDP

- **FreeRDP**: renders into an embedded LazyTerm canvas and participates in normal tabs and panes.
- **MsTscAx**: Windows only; an independent sidecar hosts Microsoft's RDP ActiveX control.

Both paths share application-level connection state and reconnect behavior, but their presentation pipelines differ. See [RDP architecture](../developer/rdp-architecture.md) for details.

### VNC

VNC uses LibVNCClient FFI and supports region updates, remote cursors, clipboard synchronization, text input, key sequences, refresh requests, and server-supported desktop resizing.

RDP and VNC apply `interactive`, `balanced`, `background`, or `suspended` quality budgets according to focus and visibility, reducing background-session resource use.

## AI Assistant

The AI module connects to an OpenAI-compatible endpoint:

- Configure an API base URL, model, and credential reference.
- Stream responses, stop generation, regenerate, and render Markdown.
- Insert a full response code block or a selection within it into the focused character terminal; multiline insertions require confirmation.
- Choose whether to include the current topic history as continued context.
- Store the API key in the credential vault; AI configuration does not persist the key in plaintext.

The assistant does not automatically gain access to local terminals, files, or the internet. Only content explicitly sent by the user becomes model input.

## Configuration Sync and Updates

- `localStorage` is the source of truth for user configuration.
- A user-selected Git repository can store selected configuration in `lazy-term-config.json` at its root.
- Sync, commit/push, and pull are explicitly initiated by the user rather than running continuously in the background.
- The application can check, download, and install updates. It prefers GitHub Releases and automatically falls back to the Gitee mirror when GitHub times out, is unavailable, or has no installer for the current platform.
