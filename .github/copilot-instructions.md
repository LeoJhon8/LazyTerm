# Lazy Terminal Project Guidelines

## Code Style

- Keep changes aligned with the existing React 19 + TypeScript + Tauri 2 stack and current file organization under `src/` and `src-tauri/`.
- Follow existing Tailwind and Radix patterns for UI work. Reuse shared primitives from `src/components/ui/` before adding new wrappers.
- Read and update Zustand stores directly in feature modules unless a component is intentionally presentational.
- Keep store actions deterministic and keep side effects explicit. Persist only serializable state.
- Do not persist connectors, event subscriptions, xterm instances, canvas state, or pane runtime state.
- Reuse existing abstractions instead of bypassing them:
  - session creation goes through `src/connectors/ConnectorFactory.ts`
  - session interaction goes through connector interfaces in `src/types/terminal.ts`
  - terminal and graphical session rendering goes through the view abstractions in `src/components/terminal/`

## Architecture

Lazy Terminal is a desktop app with this main flow:

```text
React UI -> Zustand stores -> connectors/services -> Tauri IPC -> Rust backend
```

- Frontend layout and appearance orchestration lives in `src/App.tsx` and the slot/layout components under `src/components/layout/`.
- `src/components/modules/SessionModule.tsx` is the workflow hub for the session tree, profile CRUD, drag and drop, direct connect flows, shell discovery, and SFTP upload. Treat it as a feature module, not a simple list.
- Session metadata is persisted in `src/store/tabs.ts`, but connector instances remain memory-only.
- Pane state is managed separately in `src/store/panes.ts` and is intentionally not persisted.
- Terminal and graphical session views use the abstractions documented in `src/components/terminal/README.md`; prefer extending those patterns over introducing ad hoc rendering paths.
- Rust backend entry and command wiring live in `src-tauri/src/lib.rs`; protocol implementations live under `src-tauri/src/protocol/`.

## Build And Test

Use these commands when validating changes:

```bash
npm install
npm run lint
npm run build
npm run tauri:dev
npm run tauri:build
```

- Always run `npm run lint` after frontend changes.
- Run `npm run build` for TypeScript or Vite changes that could affect production output.
- Use `npm run tauri:dev` for anything that touches connectors, session lifecycle, terminal rendering, native desktop behavior, or Rust commands.
- Use `npm run tauri:build` only when packaging behavior matters.
- Windows-only native RDP sidecar builds use:

```bash
npm run build:msrdpax-sidecar:debug
npm run build:msrdpax-sidecar:release
```

## Conventions

- Frontend code should talk to terminals and remote sessions through connectors, not through direct ad hoc `invoke()` calls in UI components.
- When adding a backend capability, update all three layers together: Rust command implementation, Tauri command registration, and the frontend connector/store/UI call site. Check capability config if command access changes.
- Local session disconnects are recreated in place; SSH disconnects currently fall back to a local connector. Preserve or intentionally update that behavior.
- Terminal sizing and focus are fragile areas. When changing terminal layout or rendering, validate resize, tab switching, pane switching, reconnect flow, and font-size changes.
- Keep terminal host containers stable with full-height layout behavior. Avoid CSS changes that break `min-h-0`, `h-full`, or xterm fit timing.
- Appearance changes should flow through `src/store/settings.ts` and `src/App.tsx`. Keep the background image layer separate from content layers and avoid introducing duplicate blur sources.
- Quick command and history routing depend on the focused session or pane state; verify those flows when changing tabs, panes, or graphical-session behavior.
- Session tree drag and drop should compute drop semantics centrally and must not allow moving a folder into its own descendant.
- Preserve clear backend error messages because the frontend surfaces them directly.

## Reference Docs

- See `README.md` for setup, platform prerequisites, and feature overview.
- See `architecture.md` for the system architecture, layout model, and store/backend boundaries.
- See `overview.md` for the dual-screen and focus-versus-display model.
- See `docs/msrdpax-native-host-design.md` for the native RDP host design.
- See `docs/rdp-pipeline-comparison.md` for the RDP rendering pipeline tradeoffs.
- See `src/components/terminal/README.md` for the terminal view abstraction and extension pattern.

## Key Files

- `src/App.tsx`
- `src/components/modules/SessionModule.tsx`
- `src/components/terminal/TerminalViewClass.tsx`
- `src/components/terminal/BaseSessionView.tsx`
- `src/connectors/ConnectorFactory.ts`
- `src/store/tabs.ts`
- `src/store/panes.ts`
- `src/store/settings.ts`
- `src/store/ssh-profiles.ts`
- `src-tauri/src/lib.rs`
