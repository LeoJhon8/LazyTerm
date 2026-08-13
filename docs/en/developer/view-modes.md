# View Modes

> [简体中文](../../developer/view-modes.md) | **English**

LazyTerm has three mutually exclusive view modes:

| Mode | Shortcut | Description |
| --- | --- | --- |
| `normal` | None | Standard layout using the user's slot configuration |
| `focus` | `Ctrl/Command + Shift + F` | Hides left, right, and bottom slots while retaining the title bar and top slot |
| `immersive` | `F11` | Hides the title bar and every slot so the session area fills the window |

## State Model

`src/store/settings.ts` defines:

```typescript
type ViewMode = "normal" | "focus" | "immersive";
```

`viewMode` lives in the Settings Store but is explicitly removed by `partialize`, so it is not persisted. Startup defaults to `normal`; `useViewMode` also returns to `normal` when the last session closes.

## Visibility Matrix

| Region | `normal` | `focus` | `immersive` |
| --- | --- | --- | --- |
| `CustomTitleBar` | Visible | Visible | Hidden |
| `ImmersiveHoverBar` | Hidden | Hidden | Visible |
| Top slot / tabs | Per configuration | Per configuration | Hidden |
| Left and right slots | Per configuration | Hidden | Hidden |
| Bottom slot | Per configuration | Hidden | Hidden |
| `PaneContainer` | Remaining space | Expands into side/bottom space | Expands to the full window |
| Pane controls | Visible | Visible | Visible |

An empty slot or one without a valid module is also hidden in `normal`, so effective dimensions depend on more than `viewMode`.

## Layout Calculation

`App.tsx` and `SlotManager.tsx` derive layout from the mode, collapse state, and number of valid modules. Important dimensions include:

- Effective left and right slot widths.
- Top-slot height `th`.
- Bottom-row height `bh`.
- Title-bar height.

These values affect WebView session views and, through `windowResizeCoordinator`, the native MsTscAx RDP rectangle. Do not hide a WebView region over native RDP solely with CSS without notifying the native host.

## Shortcuts and Transitions

`useViewMode` first attempts to register Tauri global shortcuts:

- `F11`: enters `immersive` from any other mode; returns to `normal` when already immersive.
- `Ctrl/Command + Shift + F`: enters `focus` from any other mode; returns to `normal` when already focused.

Therefore, `F11` in `focus` goes directly to `immersive`, and the focus shortcut in `immersive` goes directly to `focus`. Failed global registration falls back to a window `keydown` listener.

## Graphical Session Effects

- A pane keeps its session and Connector in every mode; hiding layout does not recreate the connection.
- `PaneView` reports actual visibility to `ConnectionQualityScheduler`, which changes RDP/VNC quality budgets.
- FreeRDP/VNC must resize the canvas or request remote size/refresh after dimensions stabilize.
- MsTscAx must synchronize placeholder rectangle, visibility, focus, and overlay regions.
- Showing or hiding the immersive hover bar must not leave native RDP uncovered by a stale overlay.

## Maintenance Checks

When changing the title bar, slots, modes, or window sizing, verify:

1. Every region matches the matrix in all three modes.
2. Both shortcuts reach the expected mode from every starting mode.
3. Closing the final session returns to `normal`.
4. Terminal, FreeRDP, and VNC size and focus remain correct.
5. MsTscAx synchronizes on tab changes, minimize/restore, DPI changes, and dialog overlays.
6. Quality scheduling puts hidden sessions into background or suspended mode.
