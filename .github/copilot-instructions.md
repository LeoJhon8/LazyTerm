# Lazy Terminal - AI Coding Agent Instructions

## Project Overview

Lazy Terminal is a Tauri 2 desktop terminal application built with React 19, TypeScript, Zustand, xterm.js, and Rust. It supports local terminals, SSH sessions, SSH profile trees, SFTP uploads, configurable slot-based layout, and persistent appearance settings.

```text
Frontend UI -> Zustand stores -> Terminal connectors -> Tauri IPC -> Rust backend
```

## Current Architecture

### Core layers

1. Frontend React app renders layout, dialogs, session tree, tab bar, quick commands, and terminal UI.
2. Zustand stores own persisted UI state and session metadata.
3. Connector classes encapsulate local PTY and SSH transport behavior.
4. Tauri commands/events bridge frontend actions to Rust.
5. Rust manages portable-pty, russh, russh-sftp, and system shell discovery.

### Session lifecycle

```text
User action in SessionModule
  -> useTabsStore.addSession()
  -> create LocalConnector or SshConnector
  -> connector.open()
  -> Tauri command creates backend session and returns sessionId
  -> connector listens to terminal-data-{sessionId}
  -> TerminalView writes output into xterm
  -> keyboard input flows back through connector.write()
```

Important behavior in the current app:

- `tabs.ts` persists session metadata, but connector instances are memory-only.
- Local session disconnects trigger connector recreation for the same tab.
- SSH disconnects currently fall back to a local connector.
- Connection failures remove the failed tab and surface a UI error dialog through `connectionError`.

## Layout System

The app uses a five-area slot layout:

- Left slot: `SessionModule` plus the settings entry point.
- Right slot: `HistoryModule`.
- Top slot: tab bar.
- Bottom slot: quick command bar.
- Center: `TerminalView`.

Layout is defined in `src/config/default-slot-config.ts` and persisted in `src/store/slot-config.ts`.

Current constraints:

- `SettingsModule` is a hidden placeholder; the actual settings UI is managed by layout components, not by the module body itself.
- Top and bottom slots are single-module regions.
- Left and right slots can collapse independently, and `App.tsx` translates store state into CSS variables like `--lw`, `--rw`, `--th`, and `--bh`.

## State Management

All app state uses Zustand. Main stores:

- `src/store/settings.ts`: terminal font, shell, panel sizes, background image, opacity, custom CSS.
- `src/store/tabs.ts`: session list, active tab, connection error, reorder/close operations.
- `src/store/slot-config.ts`: slot composition and collapse state.
- `src/store/history.ts`: command history.
- `src/store/quick-commands.ts`: quick command templates.
- `src/store/ssh-profiles.ts`: tree of folders and SSH profiles.

Rules to keep:

- Persist only serializable state.
- Do not try to persist connector instances, event subscriptions, or live terminal objects.
- When adding store methods, keep them small and side-effect boundaries explicit.

## Connector Pattern

Connectors implement `ITerminalConnector` from `src/types/terminal.ts`.

Current protocols:

- `local`: backed by `create_terminal` in Rust.
- `ssh`: backed by `create_ssh_session` in Rust.
- `telnet`: type exists, implementation does not.

Frontend should interact with sessions through connectors, not direct ad hoc `invoke()` calls from UI components.

## Session Tree And SSH Workflows

`SessionModule.tsx` is more than a simple list. It currently owns:

- SSH profile tree rendering.
- Folder/profile CRUD.
- Drag-and-drop reordering.
- Direct SSH connection flow.
- Local shell discovery for new local sessions.
- SFTP upload dialog and progress tracking.
- Context menus and destructive confirmation dialogs.

When modifying tree DnD behavior:

- Compute drop position in DnD context handlers, not row-level mouse events.
- Support `before`, `after`, and `inside` semantics consistently.
- Prevent moving a folder into its own descendant.

## Terminal Rendering Notes

Terminal rendering depends on layout timing and container sizing.

- `TerminalView` and its host containers must keep stable `h-full` / `min-h-0` behavior.
- The `.xterm` host should stretch to full height, otherwise font-size changes can leave visual gaps.
- Focus restoration must not depend only on non-zero size checks because tab switches can momentarily measure as zero.
- On Windows local PTY, xterm setup should remain aligned with modern ConPTY behavior instead of legacy windows mode assumptions.
- SSH sessions should request PTY size close to the actual frontend terminal size, not a fixed `80x24`, to avoid remote prompt wrapping artifacts.

## Appearance System

Appearance is controlled primarily by `src/store/settings.ts` and applied in `src/App.tsx`.

The current system supports:

- terminal theme selection and custom theme colors
- background image enable/disable
- image blur and opacity
- UI opacity and blur mode
- injected custom CSS

When working on appearance:

- Keep the background image layer separate from content layers.
- If image mode is `clear`, UI blur must be disabled through CSS variables.
- Avoid introducing duplicate blur sources on sidebars, rails, or the terminal host.

## Backend Integration

Primary backend file: `src-tauri/src/lib.rs`.

Key responsibilities already implemented there:

- local PTY creation with `portable-pty`
- shell discovery
- SSH authentication using password or private key
- SFTP upload with progress events and cancellation state
- frontend event emission for terminal data and terminal close

When adding a backend capability:

1. Add the Rust command and wire it into the Tauri command list.
2. Add or update the frontend connector/store/UI call site.
3. Verify any capability or permission config if command access changes.
4. Test in `npm run tauri:dev`, not only in the browser.

## File Organization Guide

```text
src/
  components/
    dialogs/        SSH connect dialog, slot config dialog
    layout/         left/right/top/bottom slot rendering and handles
    modules/        session tree, history, quick commands, tab bar
    terminal/       TerminalView and xterm integration
    ui/             Radix-based primitives
  config/           themes and default slot config
  connectors/       LocalConnector, SshConnector
  hooks/            terminal setup helpers
  lib/              shared utilities
  store/            Zustand stores
  types/            connector and config types

src-tauri/
  src/lib.rs        local terminal, SSH, SFTP, shell lookup
```

## Development Commands

```bash
npm install
npm run dev
npm run tauri:dev
npm run lint
npm run build
npm run tauri:build
```

## Working Conventions

### Frontend

- Use existing Tailwind and Radix patterns.
- Read state from stores directly in modules unless a component is intentionally presentational.
- Keep changes aligned with the current slot-based layout and CSS variable approach.

### Stores

- Keep store actions deterministic where possible.
- For destructive tab actions, preserve connector cleanup.
- Reordering logic should preserve existing session objects, not recreate them unnecessarily.

### Rust/Tauri

- Prefer clear error messages because frontend surfaces them directly.
- Preserve event naming conventions like `terminal-data-{sessionId}` and `terminal-close-{sessionId}`.
- Be careful with Windows-specific shell behavior and admin launch paths.

## Testing Checklist

1. Frontend-only change: run `npm run lint` and manually test via `npm run tauri:dev`.
2. Terminal rendering change: test tab switching, resize, font-size changes, and reconnect flow.
3. SSH change: test password and private-key login, disconnect handling, and remote resize.
4. Session tree change: test drag/drop before/after/inside and import/export preservation.
5. Appearance change: test with and without background image, and with `frosted` versus `clear` UI mode.

## High-Value Files

- `src/App.tsx`: layout CSS variables, theme sync, background image layer, custom CSS injection.
- `src/components/modules/SessionModule.tsx`: SSH tree, DnD, SFTP upload, local shell discovery.
- `src/components/terminal/TerminalView.tsx`: xterm lifecycle and connector binding.
- `src/store/settings.ts`: persisted appearance and terminal preferences.
- `src/store/tabs.ts`: session lifecycle and failure recovery.
- `src/store/ssh-profiles.ts`: folder/profile tree state and move logic.
- `src-tauri/src/lib.rs`: local PTY, SSH, SFTP, and shell commands.
