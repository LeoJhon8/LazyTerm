# Development Workflow

> [简体中文](../../developer/development-workflow.md) | **English**

## Common Commands

```powershell
# Install exactly from the lockfile
npm ci

# Frontend only
npm run dev

# Full Tauri application
npm run tauri:dev

# ESLint
npm run lint

# TypeScript compile check
& .\node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit

# Rust compile check
cargo check --manifest-path .\src-tauri\Cargo.toml
```

Native Windows RDP sidecar:

```powershell
npm run build:msrdpax-sidecar:debug
npm run build:msrdpax-sidecar:release
```

Run packaging only for releases or when an installer is explicitly needed:

```powershell
npm run tauri:build
```

This command runs `scripts/update-version.js` first and therefore changes version fields. It is not a routine verification command.

## Verification Rules

Default verification uses compilation and static checks:

- TypeScript: `tsc --noEmit`
- Rust: `cargo check`
- Code style: `npm run lint`
- Documentation: `git diff --check`, local-link checks, and review

Unless explicitly required, do not use `npm run build`, `npm run tauri:build`, `cargo build`, or `cargo check --tests` as verification.

Current project rules prohibit automated changes from creating, updating, or running test code, including unit, integration, E2E, mock, fixture, and temporary test scripts. Maintainers perform focused manual behavior checks. If a compile check fails, preserve the original error and state whether it is related to the current change.

## Code Boundaries

| Directory | Responsibility |
| --- | --- |
| `src/components/` | UI, layout, dialogs, and session views |
| `src/store/` | Zustand runtime state and persistent configuration |
| `src/connectors/` | Protocol interfaces, event listeners, and frontend lifecycle |
| `src/services/connection/` | Reconnects, readiness barriers, quality policies, and error classification |
| `src/services/` | Tauri IPC and application services |
| `src/lib/` | Workspace, credential, layout, and other domain logic |
| `src-tauri/src/protocol/` | Rust protocol commands and background tasks |
| `src-tauri/capabilities/` | Tauri permission boundaries |
| `src-tauri/native/` | Sidecars and bundled native runtimes |

UI code should not call protocol commands directly; extend a Connector or Service first. Persistent stores must not contain Connectors, Promises, Channels, listener cleanup functions, or native handles.

## Changing an Existing Protocol

Check at least:

1. Required listeners are registered before starting the backend.
2. State flows through `ConnectionStateEmitter` and `tabs.ts`.
3. Callbacks from an old generation are ignored.
4. The close path cleans frontend listeners, Supervisor registration, and Rust session handles.
5. Errors are classified by `connectionErrors.ts` with a retryable flag.
6. Graphical protocols respond to visibility, quality policy, full refresh, and size changes.
7. User-visible behavior and both UI languages remain synchronized.

## Adding a Tauri Command

Check at least:

1. Rust implementation and serializable parameters.
2. Command registration in `src-tauri/src/lib.rs`.
3. Whether `src-tauri/capabilities/` must grant or restrict permissions.
4. A unified frontend call through `services/` or `connectors/`.
5. Whether frequent writes need `invokeTauriSerialized` to preserve order.
6. Whether cleanup belongs in `invokeTauriBackground`, while retaining error logs.
7. Unified presentation for user-visible errors.

## Adding a Protocol

Recommended order:

1. Define protocol, configuration, and Connector capabilities in `src/types/terminal.ts`.
2. Implement the Connector in `src/connectors/` and emit unified connection state.
3. Add factory selection and credential resolution in `ConnectorFactory.ts`.
4. Implement Rust commands, background tasks, control channels, and cleanup in `src-tauri/src/protocol/`.
5. Register commands in `src-tauri/src/lib.rs` and review capabilities.
6. Integrate session tree, forms, Quick Connect, and `PaneView`.
7. Define Supervisor reconnect behavior and retryable failures.
8. Integrate Readiness and Quality policies for a graphical protocol.
9. Update Chinese/English UI strings, user docs, architecture, and troubleshooting.

See [Architecture design](./architecture.md#adding-a-protocol).

## Persistence Changes

- When adding a persistent field, decide whether the Store needs `version` and `migrate`.
- When user-visible wording changes meaning, update translation keys, call sites, and all language values, then remove the obsolete key.
- Stores participating in Git sync must be explicitly added to the allowlist in `git-aware-storage.ts`.
- Credentials, API keys, private-key contents, and passphrases belong only in the encrypted vault, never normal configuration or logs.
- Active connections, tabs, and the current pane tree are not persisted by default. Changing this boundary requires architecture and recovery-design updates.

## Documentation Maintenance

- Chinese user docs: `docs/user/`
- Chinese developer docs: `docs/developer/`
- English mirror: `docs/en/user/` and `docs/en/developer/`
- Chinese index: `docs/README.md`
- English index: `docs/en/README.md`

Update the English counterpart when changing a Chinese document. New documents require both indexes and language-switch links at the top of each version. Root READMEs should remain project entry points; implementation details belong in `docs/`.

Historical records such as license audits and release checklists must retain real execution dates. Translation alone does not make an old audit current.

## Before Committing

1. Inspect `git status --short` and preserve unrelated user changes.
2. Run appropriate lint and compile checks for code changes.
3. Run `git diff --check` and validate local links for documentation changes.
4. Inspect the staged diff before committing. Commit messages should follow the repository's Chinese commit-message convention and describe the actual change.
