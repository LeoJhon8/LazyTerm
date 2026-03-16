# MsTscAx Native Host Design

## Goal

Provide a Windows-only embedded RDP tab that uses the Microsoft Remote Desktop ActiveX control instead of the current canvas-based IronRDP renderer or the external mstsc process.

The target user experience is:

- RDP tabs still live inside the existing tab bar and session workflow.
- The remote desktop surface is rendered by the native Microsoft RDP client stack.
- Switching tabs shows and hides the native surface without spawning a separate top-level mstsc window.
- Resize, focus, clipboard, and disconnect behavior are aligned with the current tab model.

## Non-Goals

- Cross-platform support. This design is Windows-only.
- Replacing the existing IronRDP path immediately. IronRDP should remain available.
- Hosting `mstsc.exe` directly with `SetParent`. That is not the long-term architecture.

## Why Not Embed mstsc.exe Directly

Embedding the existing `mstsc.exe` top-level window with `SetParent` is workable as a short-lived hack, but it is not a stable product architecture.

Main issues:

- `mstsc.exe` owns its own top-level window lifecycle and can recreate windows during connect, reconnect, credential prompts, and full-screen transitions.
- Focus, accelerator keys, Alt+Tab, DPI scaling, minimize/restore, and clipping are brittle when a foreign top-level window is reparented.
- The process does not expose a clean tab-oriented control plane for resize, visibility, connection state, or error propagation.

The correct direction is to host the same Microsoft RDP stack through the MsTscAx ActiveX control inside a child window that we own.

## Recommended Architecture

Use a dedicated Windows-native sidecar host for MsTscAx instead of trying to implement full ActiveX in-place hosting directly inside the Rust Tauri backend.

### Recommendation Summary

- Frontend React remains the tab orchestrator.
- Rust Tauri backend remains the session and IPC orchestrator.
- A Windows sidecar process hosts `AxMsRdpClient` inside a real child window.
- The sidecar window is parented to the Tauri main window client area and positioned to match the active tab content rect.

This keeps the hard Windows UI hosting logic in a runtime that already handles COM/ActiveX cleanly.

## Why Sidecar Instead Of Pure Rust COM Hosting

Pure Rust hosting of MsTscAx is possible in theory but expensive in practice.

To host the control directly in Rust, the app must implement or wrap:

- COM apartment initialization on a UI thread
- ActiveX container lifecycle
- `IOleClientSite`
- `IOleInPlaceSite`
- `IOleInPlaceFrame`
- in-place activation and message routing
- child window creation, parenting, focus, and accelerator translation

That path is a large amount of Windows-specific plumbing before any RDP-specific work starts.

By contrast, a Windows Forms or WPF sidecar can host `AxMsRdpClient` with first-class tooling and far less risk. Rust then coordinates process lifecycle and placement, which is much smaller and easier to maintain.

## High-Level Layout

```text
React Tab + Placeholder Div
  -> Tauri invoke
  -> Rust NativeRdpManager
  -> msrdpax-host sidecar process
  -> child HWND + AxMsRdpClient control
  -> Microsoft RDP stack
```

## Session Model Changes

Extend the current RDP session config with an explicit backend choice.

Suggested shape:

```ts
type RdpBackend = "ironrdp" | "msrdpax" | "mstsc-external";

interface RDPConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  domain?: string;
  nickname?: string;
  width?: number;
  height?: number;
  autoResize?: boolean;
  backend?: RdpBackend;
}
```

Behavior:

- `ironrdp` keeps the current canvas-based implementation.
- `msrdpax` routes the session to the Windows native host flow.
- `mstsc-external` keeps the existing external process launcher.

## Frontend Changes

### 1. Split RemoteDesktopView Into Two Renderers

Current `RemoteDesktopView` is tightly coupled to the IronRDP canvas path.

Recommended split:

- `RemoteDesktopView`: backend switch and shared shell UI.
- `CanvasRdpView`: current IronRDP implementation.
- `NativeRdpHostView`: placeholder div that manages native host placement.

### 2. NativeRdpHostView Responsibilities

The React side should not render pixels for MsTscAx. It should only provide a mount point and coordinate updates.

Responsibilities:

- create a placeholder container in the center pane
- measure its client rect with `ResizeObserver`
- convert CSS pixels to physical pixels using `window.devicePixelRatio`
- send mount and resize commands to the backend
- show/hide host when tab activation changes
- request focus when the container is clicked

### 3. Frontend Commands

Suggested commands:

- `create_native_rdp_session(config)`
- `mount_native_rdp_session(sessionId, rect)`
- `set_native_rdp_session_visible(sessionId, visible)`
- `focus_native_rdp_session(sessionId)`
- `close_native_rdp_session(sessionId)`

Suggested `rect` payload:

```ts
interface NativeHostRect {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}
```

`x`, `y`, `width`, and `height` should be measured in CSS pixels relative to the webview client area. The backend can convert to physical pixels if it already knows the window scale factor; otherwise pass both the rect and `scaleFactor`.

## Rust Backend Changes

### 1. Add NativeRdpManager

Add a Windows-only manager alongside the current `rdp_sessions` map.

Suggested responsibilities:

- launch and supervise the host sidecar process
- keep a session-to-host mapping
- forward mount, resize, show, hide, focus, and close commands
- emit tab-friendly state and error events back to the frontend

Suggested stored state:

```text
session_id
backend = msrdpax
host_process_id
control_channel
visible
mounted_rect
connection_state
```

### 2. Main Window Handle Ownership

Rust should own parent-window resolution. The frontend should never know about HWND values.

The backend should:

- resolve the Tauri main window handle
- pass that parent handle to the sidecar
- keep all native parenting logic off the frontend boundary

### 3. Backend Events

Suggested events:

- `native-rdp-state-{sessionId}`
- `native-rdp-error-{sessionId}`
- `native-rdp-close-{sessionId}`

Suggested state payloads:

- `launching`
- `host-ready`
- `connecting`
- `connected`
- `disconnected`
- `error`

## Sidecar Host Design

### Runtime Choice

Use a Windows Forms sidecar project in .NET.

Reasoning:

- `AxMSTSCLib.AxMsRdpClient*` is straightforward in WinForms.
- COM apartment and ActiveX hosting are solved problems there.
- child window parenting and resize logic are simpler than a pure Rust COM container.

### Sidecar Responsibilities

- create a borderless child host window
- parent it to the HWND supplied by Rust
- host the selected `AxMsRdpClient` control inside that child window
- apply connection properties and credentials
- connect, disconnect, resize, focus, show, hide
- emit structured state and error messages to Rust

### Recommended Control Version

Target the newest available non-safe-for-scripting control that exists on supported systems, then fall back if unavailable.

Preferred order:

- `MsRdpClient11NotSafeForScripting`
- `MsRdpClient10NotSafeForScripting`
- `MsRdpClient9NotSafeForScripting`

The sidecar should own version probing, not the React app.

### Suggested Sidecar IPC

Use line-delimited JSON over stdin/stdout for the first version.

Commands from Rust to sidecar:

- `init`
- `mount`
- `show`
- `hide`
- `focus`
- `connect`
- `disconnect`
- `close`

Events from sidecar to Rust:

- `ready`
- `connecting`
- `connected`
- `disconnected`
- `error`
- `closed`

This matches the earlier sidecar pattern already used in the repo and keeps inspection easy.

## Placement And Resize Model

The native host should only exist for the active visible tab.

Rules:

- When a `msrdpax` tab becomes active, mount and show its child window.
- When it becomes inactive, hide it immediately.
- When the center pane resizes, recompute the host rect and forward a resize.
- When the app is minimized, hide all native RDP child windows.
- When restored, only re-show the active session.

This avoids stacking native surfaces on top of unrelated tabs.

## Focus Model

Focus must be explicit because the remote desktop surface is native and the tab UI is web-rendered.

Rules:

- clicking the placeholder container should invoke `focus_native_rdp_session`
- switching away from the tab should blur or hide the host
- switching back should show and focus only on user interaction, not automatically on every render

## Credential Handling

Do not route MsTscAx through `cmdkey` or temporary `.rdp` files.

For `msrdpax`, credentials should be applied directly through the control API.

Guidance:

- store only serializable config in the frontend as today
- pass credentials over Tauri command boundaries only when opening the session
- avoid persisting plaintext passwords outside the existing saved config behavior
- keep credential prompts disabled when password is supplied and enabled otherwise

## Error Handling

Errors should be surfaced in the same style as current RDP failures.

Map sidecar errors into the existing `connectionError` shape with:

- launch failure
- ActiveX control not available
- COM initialization failure
- authentication failure
- disconnect after connect
- resize or parent-window failure

## Packaging Strategy

The sidecar binary should be built and shipped only on Windows.

Recommended structure:

```text
src-tauri/
  native/
    msrdpax-host/
      msrdpax-host.csproj
      Program.cs
```

Recommended packaging flow:

- build the sidecar in Windows dev and build scripts
- copy the binary into Tauri resources or external binary output
- resolve its runtime path from Rust

## Incremental Delivery Plan

### Phase 1

- add `backend: "msrdpax"` to RDP config
- split frontend RDP view into canvas vs native placeholder
- add Rust `NativeRdpManager` command surface
- implement a no-op or fake sidecar contract to validate tab mount, resize, show, and hide behavior

### Phase 2

- add real Windows Forms sidecar
- host `AxMsRdpClient`
- connect, disconnect, resize, and focus end to end

### Phase 3

- add state events and error mapping
- add reconnect and disconnect UX
- add quality-of-life features like full-screen, clipboard toggles, and printer/drive policies if needed

## Recommendation For This Repo

For this codebase, the best next implementation step is not to replace the current IronRDP code immediately.

Instead:

1. add an explicit RDP backend selector
2. introduce a `NativeRdpHostView` placeholder path on the frontend
3. add a Windows-only Rust manager for native host sessions
4. implement the actual MsTscAx host as a .NET sidecar

That sequence keeps the existing app stable while introducing the Windows-native path behind a clean backend boundary.

## Files Expected To Change In Implementation

- `src/types/terminal.ts`
- `src/store/tabs.ts`
- `src/components/modules/SessionModule.tsx`
- `src/components/dialogs/RdpConnectDialog.tsx`
- `src/components/terminal/RemoteDesktopView.tsx`
- `src/App.tsx`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

Additional new files are expected for the Windows native sidecar and Rust-side manager module.