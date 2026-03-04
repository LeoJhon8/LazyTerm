# Lazy Terminal - AI Coding Agent Instructions

## Project Overview

**Lazy Terminal** is a cross-platform desktop terminal emulator built with Tauri, React, TypeScript, and Rust. It supports both local and SSH connections with a configurable multi-panel layout system.

```
Frontend Flow: React App → Zustand Stores → Tauri IPC → Rust Backend (PTY/SSH)
```

## Architecture & Data Flow

### Core Layers

1. **Frontend (React/TypeScript)**: UI components, state management, terminal rendering
2. **IPC Bridge (Tauri)**: Asynchronous communication via `invoke()` and event listeners
3. **Backend (Rust)**: PTY management, SSH connections, process spawning

### Terminal Session Lifecycle

```
User creates session → TabsStore adds TerminalSession
  → addSession() creates Connector (LocalConnector or SshConnector)
  → TerminalView mounts → initializes xterm.js Terminal
  → Connector.open() → Tauri invoke to Rust backend
  → Rust spawns PTY/SSH → returns sessionId
  → Connector listens to `terminal-data-{sessionId}` events
  → xterm writes output, keyboard input flows: Terminal → Connector.write() → Rust
```

### Layout System

The app uses a **slot-based configurable layout** (5 main areas):
- **Left/Right panels**: Can contain multiple modules (SessionModule, SettingsModule, HistoryModule, PluginsModule)
- **Top panel**: Fixed module (TabBar)
- **Bottom panel**: Fixed module (QuickCmdBar)
- **Center**: Always contains main TerminalView

Configuration defined in `src/config/default-slot-config.ts` and persisted via `useSlotConfigStore`.

## State Management Pattern

All state uses **Zustand stores with persist middleware**:

```typescript
// Example pattern from settings.ts
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Initial state
      theme: "dark",
      // Actions
      setTheme: (theme) => set({ theme }),
    }),
    { name: "lazy-terminal-settings" }
  )
);
```

**Stores location**: `src/store/`
- `settings.ts` - Theme, layout dimensions, terminal preferences
- `tabs.ts` - Active session, session list (connectors NOT persisted)
- `slot-config.ts` - Panel module configuration
- `history.ts` - Command history
- `quick-commands.ts` - Quick command templates

**Key principle**: Connector instances live only in memory; session metadata is persisted.

## Connector Pattern (Terminal Types)

All connectors implement `ITerminalConnector` interface (`src/types/terminal.ts`):

```typescript
export interface ITerminalConnector {
  readonly protocol: 'ssh' | 'local' | 'telnet';
  readonly isConnected: boolean;
  open(): Promise<void>;        // Establish connection
  close(): void;                 // Clean up
  onData(handler: (data: string) => void): Promise<void>;  // Listen to output
  write(data: string | Uint8Array): void;  // Send input
  resize(cols: number, rows: number): void;  // Terminal resize
}
```

**Implementations** (in `src/connectors/`):
- `LocalConnector`: Spawns local PTY via Tauri `invoke("create_terminal")`
- `SshConnector`: Opens SSH session via Tauri `invoke("create_ssh_session")`

**Data flow for local terminal**:
```
TerminalView user input → Terminal.onData()
  → Connector.write(data) 
  → invoke("write_to_terminal", {sessionId, data})
  → Rust writes to PTY
  → Rust sends "terminal-data-{sessionId}" event
  → Connector's event listener → Terminal.write(output)
```

## File Organization Guide

```
src/
├── components/
│   ├── terminal/       TerminalView.tsx (xterm.js integration)
│   ├── layout/         Slot rendering (Left/Right/Top/Bottom)
│   ├── modules/        Session, History, Settings, Plugins, TabBar, QuickCmdBar
│   ├── dialogs/        SshConnectDialog, SlotConfigDialog
│   └── ui/             Radix UI + Tailwind wrappers
├── store/              Zustand stores (persist middleware)
├── connectors/         LocalConnector.ts, SshConnector.ts
├── hooks/              useTerminal.ts (xterm.js setup helper)
├── types/              terminal.ts (ITerminalConnector, SSHConfig, etc.)
├── config/             default-slot-config.ts (module definitions)
└── lib/                utils.ts (utility functions)
```

## Critical Developer Workflows

### Development

```bash
npm run dev          # Hot-reload React dev server (port 5173)
npm run tauri:dev    # Launch Tauri desktop app with hot reload
npm run lint         # ESLint check
npm run build        # Build web version
npm run tauri:build  # Package desktop app
```

The Tauri dev server bridges frontend and Rust backend automatically.

### Building/Testing Checklist

1. **Frontend change**: Use `npm run tauri:dev` to test in desktop context (not just web)
2. **Rust change** (`src-tauri/src/`): Changes auto-reload in Tauri dev mode
3. **Command invocation issue**: Check Tauri capability in `src-tauri/capabilities/default.json`
4. **State persistence issue**: Clear localStorage (settings persisted as `lazy-terminal-*`)

## Key Conventions & Patterns

### 1. Component Composition
- Components don't manage their own styles; use Tailwind classes
- Module components (SessionModule, HistoryModule) are dropbox-compatible via dnd-kit
- Modules receive no props; they read state directly from stores

### 2. Hook Usage
The `useTerminal.ts` hook demonstrates proper xterm.js initialization:
- Create Terminal in useEffect
- Use state (`setTerminalInstance`) to track readiness (not just ref)
- Cleanup on unmount (terminal.dispose(), unlisten events)
- Use `requestAnimationFrame` when updating state after DOM operations

### 3. Tauri Integration
- Use `invoke<T>("command", {params})` for async backend calls
- Use `listen<T>("event-name")` to subscribe to backend events
- Always provide TypeScript types: `invoke<string>("cmd")`
- SSH and local terminal use identical event-driven patterns

### 4. Settings & Config
- Settings (theme, layout, font) are globally persisted
- Slot configuration is UI state (which modules in which panels)
- Both use Zustand persist → localStorage

### 5. Styling
- Radix UI primitive components wrapped in `src/components/ui/`
- Tailwind CSS with custom CSS variables in `App.tsx` for layout (--lw, --rw, etc.)
- Dark mode via `dark` class on document element

## Common Implementation Tasks

### Adding a New Terminal Type
1. Create `NewTypeConnector.ts` implementing `ITerminalConnector`
2. Add type to `ITerminalConnector.protocol` union type
3. Update `SessionModule.tsx` to offer UI for new type
4. Add Tauri backend command (Rust side)

### Adding a New Module
1. Create `src/components/modules/NewModule.tsx` (read from stores, no props)
2. Add module ID to `AVAILABLE_MODULES` in `default-slot-config.ts`
3. Render dynamically in `LeftSlot.tsx` or `RightSlot.tsx` based on slot config
4. Ensure it's compatible with dnd-kit sorting

### Modifying Terminal Rendering
- Edit `TerminalView.tsx` (xterm.js setup)
- Most settings (fontSize, fontFamily, theme) come from `useSettingsStore()`
- WebGL addon loaded conditionally for performance
- Connector already passes data; focus on UI rendering logic

## Testing Connectors

**Local connector** (testing without Rust):
- Verify `Connector.write()` calls `invoke("write_to_terminal")`
- Mock Tauri events: manually dispatch `terminal-data-{sessionId}` events

**SSH connector**:
- Similar pattern; `invoke("create_ssh_session")` returns sessionId
- Same event listening mechanism

## Debugging Tips

1. **Session not connecting**: Check `sessionId` in Connector; verify Tauri event name matches pattern
2. **Terminal not rendering**: Verify xterm.js loaded, check `TerminalView` useEffect dependencies
3. **Layout broken**: CSS variables (`--lw`, `--rw`, etc.) not set? Check `App.tsx` useEffect
4. **Module not appearing**: Verify module ID in slot config and layout slot component

## External Dependencies

- **@xterm/xterm**: Terminal emulation
- **zustand**: State management
- **tauri**: Desktop framework & IPC
- **radix-ui**: Accessible UI components
- **tailwindcss**: Utility CSS
- **dnd-kit**: Drag-and-drop module reordering
- **framer-motion**: Animations

## Key Files to Reference

- `src/App.tsx` - Layout grid, theme setup, CSS variables
- `src/components/layout/SlotManager.tsx` - Slot rendering
- `src/components/terminal/TerminalView.tsx` - xterm integration
- `src/store/tabs.ts` - Session lifecycle management
- `src/types/terminal.ts` - Connector interface contract
- `src-tauri/src/lib.rs` - Rust command definitions
