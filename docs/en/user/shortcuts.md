# Shortcuts

> [简体中文](../../user/shortcuts.md) | **English**

## Global and Workspace

| Shortcut | Action |
| --- | --- |
| `Ctrl + T` | Create a new tab |
| `Ctrl + W` | Close the current tab |
| `Ctrl + Tab` | Switch to the next tab |
| `Ctrl + Shift + Tab` | Switch to the previous tab |
| `Ctrl + Shift + F` | Toggle focus mode |
| `F11` | Toggle immersive mode |

View-mode shortcuts are registered through Tauri global shortcuts. If registration fails, LazyTerm falls back to key listeners inside the application window. A shortcut may not fire if the operating system or another application has already claimed it.

## Terminal

| Shortcut | Action |
| --- | --- |
| `Ctrl + F` | Open search for the current terminal buffer |
| `Ctrl + Shift + C` | Copy when terminal text is selected |
| `Ctrl + Shift + V` | Paste clipboard contents |
| `Ctrl + mouse wheel` | Change the current pane's terminal font size |

On macOS, terminal search also accepts `Command + F`. Whether other shortcuts map to `Command` depends on the platform and WebView behavior.

Terminal search controls:

| Key | Action |
| --- | --- |
| `Enter` | Go to the next match |
| `Shift + Enter` | Go to the previous match |
| `Esc` | Close search |

The search bar also supports case sensitivity, whole-word matching, and regular expressions.

## Input Priority

- If no terminal text is selected, `Ctrl + Shift + C` continues to the terminal application instead of copying an empty value.
- When an RDP or VNC view has focus, some keys and key combinations are sent to the remote session first.
- Browser, operating-system, input-method, remote-application, or global-shortcut handling can change the final behavior.
- The context menu provides copy, paste, select-all, and search operations when keyboard shortcuts are unavailable.
