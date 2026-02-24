# Agent Development Guide - Lazy Terminal

## Build Commands

```bash
npm run dev       # Start Vite dev server
npm run build     # TypeScript compilation + Vite build
npm run preview   # Preview production build
npm start         # Launch Electron app
```

**Note**: No test/lint scripts configured in package.json. Add if needed.

## Project Structure

```
src/
├── main/          # Electron main process (Node.js)
├── renderer/      # Electron renderer process (Browser/DOM)
└── types/         # Shared TypeScript type definitions
dist/
├── main/          # Main process build output
└── renderer/      # Renderer build output
```

## Code Style Guidelines

### Formatting (Prettier)

- **Semicolons**: Required
- **Quotes**: Single quotes `'`
- **Indentation**: 2 spaces
- **Max line length**: 100 characters
- **Trailing commas**: ES5 style
- **Arrow function parens**: Avoid when possible `x => x`

### TypeScript Configuration

- **Strict mode**: OFF (loose type checking)
- **Module system**: CommonJS (main), ES modules (renderer)
- **Target**: ES2020
- **Module resolution**: Node

### Import Conventions

```typescript
// External libraries - named imports preferred
import { app, BrowserWindow, ipcMain } from 'electron';
import { Client } from 'ssh2';
import * as pty from 'node-pty';

// Internal modules - relative paths
import { Logger } from './logger';
import type { SessionType } from '../types/types';

// CSS imports at top (renderer only)
import '@xterm/xterm/css/xterm.css';

// Type-only imports (encouraged but not enforced)
import type { SSHParams, LocalParams } from '../types/types';
```

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Classes | PascalCase | `PTYSession` `SessionUI` `XtermWrapper` |
| Interfaces | PascalCase | `SessionConfig` `XtermWrapper` |
| Type Aliases | PascalCase | `SessionType` `IpcResult` |
| Functions/Methods | camelCase | `createSession` `handleSaveSession` |
| Constants | UPPER_SNAKE_CASE | `IS_WIN` `DEFAULT_THEME` |
| Private members | camelCase with `private` keyword | `private sessionId` |
| Modules/files | kebab-case | `terminal-main.ts` `ptyService.ts` |

### Type Definitions

- Use **discriminated unions** for session types:
  ```typescript
  export type SessionConfig =
    | { type: 'local'; params: LocalParams }
    | { type: 'ssh'; params: SSHParams }
    | { type: 'telnet'; params: TelnetParams };
  ```

- **No implicit any** - use explicit types or `any` with ESLint warning tolerance
- Type imports: use `import type { ... }` when possible

### Error Handling

- **IPC responses**: Always return `IpcResult` pattern:
  ```typescript
  interface IpcResult<T = void> {
    sessionId: string;
    success: boolean;
    data?: T;
    message?: string;
    code?: number;
  }
  ```

- Try-catch blocks with meaningful error messages:
  ```typescript
  try {
    const result = await window.electronAPI.ptyCreate(config);
    if (!result.success) {
      console.error(`Failed: ${result.message}`);
    }
  } catch (err) {
    Logger.error('Module', 'Operation failed', err);
  }
  ```

- Empty catch blocks: **AVOID** - always log or rethrow

### Electron IPC Patterns

- **Main process**: Use `ipcMain.handle()`
  ```typescript
  ipcMain.handle('pty-create', async (_, options: PtyCreateOptions) => {
    try {
      const sessionId = await ptyService.createSession(options);
      return { success: true, sessionId, data: { sessionId } };
    } catch (err) {
      return { success: false, sessionId: '', message: (err as Error).message };
    }
  });
  ```

- **Renderer process**: Use `electronAPI` (via preload)
  ```typescript
  const result = await window.electronAPI.ptyCreate(options);
  ```

- **Event listening**: Use unsubscribe pattern (not removeListener):
  ```typescript
  const unsubscribe = api.onPtyData(({ data }) => { ... });
  // Cleanup: unsubscribe();
  ```

### Comments & Documentation

- **JSDoc**: Use for public APIs and complex functions:
  ```typescript
  /**
   * Creates a new PTY session
   * @param options - Session configuration
   * @returns Session ID
   */
  async createSession(options: PtyCreateOptions): Promise<string>
  ```

- **Inline comments**: Use for non-obvious logic, explain WHY not WHAT
- Mixed English/Chinese comments exist - prefer English in new code

### Logging

- Use the custom Logger class:
  ```typescript
  Logger.debug('Module', 'Detailed debug info');
  Logger.info('Module', 'Operation completed');
  Logger.warn('Module', 'Potential issue detected');
  Logger.error('Module', 'Error occurred', err);
  ```

- Console.log allowed (ESLint no-console: off)

## Key Dependencies

- **Electron**: Desktop app framework
- **node-pty**: Terminal emulation (main process)
- **ssh2**: SSH client (main process)
- **@xterm/xterm**: Terminal emulator UI (renderer)
- **Vite**: Build tool + dev server

## Platform Handling

- Use `process.platform` to detect OS (win32, darwin, linux)
- Windows: Handle bash.exe path detection (Git Bash, MSYS2, WSL)
- Use `IS_WIN` constant for consistent checks

## Security Notes

- `contextIsolation: true` in webPreferences
- `nodeIntegration: false`
- Only expose required APIs via preload script
