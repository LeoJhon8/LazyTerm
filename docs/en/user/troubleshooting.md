# Troubleshooting

> [简体中文](../../user/troubleshooting.md) | **English**

Before troubleshooting a connection, record the LazyTerm version, operating system, connection type, sanitized target, error summary, and technical details. Never upload passwords, private keys, tokens, or real server information.

## Local Terminal Creation Fails

### Causes

- The default shell does not exist or its path is wrong.
- The current process cannot access the shell or working directory.
- The app still has old environment variables after a tool was installed.

### Fix

- On Windows, verify `powershell.exe`, `pwsh.exe`, or Git Bash.
- Select the shell again in Settings and confirm the working directory exists.
- Restart LazyTerm so it loads the current environment.

```powershell
Get-Command powershell.exe
Get-Command pwsh.exe -ErrorAction SilentlyContinue
powershell.exe -NoProfile
```

LazyTerm recreates the Connector when a local shell exits unexpectedly. If it keeps exiting, run that shell directly in a system terminal to inspect its startup error.

## SSH Fails or Keeps Reconnecting

### Causes

- Incorrect host, port, username, or authentication method.
- The credential vault is locked, or the profile references a deleted credential.
- Incorrect private-key path, format, or passphrase.
- DNS, network, firewall, SSH service, or host-key failure.

### Fix

- Review the profile and credential reference.
- Unlock the credential vault when master-password mode is enabled.
- Test the same parameters with the system SSH client.
- Correct non-retryable host-key or authentication failures before reconnecting manually.

```powershell
Test-NetConnection example.com -Port 22
ssh user@example.com
```

LazyTerm uses backoff reconnects for recoverable network failures. `reconnecting` does not mean the new connection is ready; only `connected` marks the current generation as usable.

## The Credential Vault Cannot Be Unlocked

### Causes

- Incorrect master password.
- A damaged or incompatible vault document in localStorage.
- An imported master-password vault whose password is unknown.

### Fix

- Verify keyboard layout, capitalization, and input method, then retry.
- Preserve the current data before importing a known-good vault or Git configuration backup.
- Clearing the vault destroys its credentials and should be a last resort when no recoverable backup exists.

LazyTerm cannot recover a forgotten master password and must not print decrypted secrets to logs.

## RDP Connection Problems

### Causes

- The remote RDP service, port, or network is unavailable.
- FreeRDP security or negotiation is incompatible with the server.
- The MsTscAx sidecar is missing, cannot launch, or fails to mount its native window.
- Incorrect credentials or domain configuration.

### Fix

- On Windows, try both FreeRDP and MsTscAx in Settings.
- Non-Windows platforms can use only FreeRDP.
- The MsTscAx path requires a built and packaged sidecar; development also requires the .NET SDK.
- If switching tabs, resizing, or reconnecting leaves a blank surface, refocus the session or reconnect manually.

```powershell
Test-NetConnection example.com -Port 3389
```

FreeRDP renders through a canvas while MsTscAx uses a native child window, so presentation issues must be diagnosed separately. See [RDP architecture](../developer/rdp-architecture.md).

## VNC Build or Connection Fails

### Causes

- LibVNCClient headers or libraries are missing for Windows/MSVC.
- `LIBVNCSERVER_ROOT` does not contain `include` and `lib`.
- The remote VNC server, authentication, or security type is incompatible.
- Required runtime DLLs are missing.

### Fix

- Build LibVNCClient according to [Windows development setup](../developer/development-setup-windows.md).
- For a non-default prefix, set:

```powershell
$env:LIBVNCSERVER_ROOT = "C:\dev\libvncserver\install"
```

- Confirm `include\rfb\rfbclient.h` and `lib\vncclient.lib` exist.
- Check the server, port, password, shared mode, and view-only mode.

## SFTP Upload or Download Fails

### Causes

- Invalid SSH credentials or a disabled remote SFTP subsystem.
- Missing permissions for the local or remote directory.
- An invalid remote path or an unreadable file inside a directory transfer.
- Network interruption or user cancellation.

### Fix

- Verify that the same profile can establish SSH.
- Check permissions on both sides.
- Retry with one file to isolate path and batch-content failures.
- Inspect the transfer dialog or notification center for the specific file and technical details.

## Serial Connection Fails

### Causes

- The device is disconnected, has no driver, or was not detected.
- Another application owns the serial port.
- Baud rate, data bits, parity, stop bits, or flow control do not match.
- The port name changed after reconnecting a USB serial device.

```powershell
[System.IO.Ports.SerialPort]::GetPortNames()
```

Close other serial applications, refresh the port list, and match every parameter to the device documentation. Serial participates in automatic reconnects, but a removed device or changed port name usually still requires a configuration update.

## AI Assistant Request Fails

### Causes

- The endpoint is not HTTP/HTTPS or is not OpenAI compatible.
- Wrong model, invalid API key, or locked credential vault.
- The service does not support `/v1/chat/completions` or returns an incompatible response.
- Network, proxy, rate-limit, or provider failure.

### Fix

- Review the Base URL, model, and credential reference in AI settings.
- The URL may point to the service root or `/v1`; LazyTerm appends `/chat/completions`.
- Verify key permissions, model access, balance, and limits with the provider.
- Retry without linked context if the request is too large.

## Git Configuration Sync Fails

### Causes

- The selected directory is not a Git repository or is not writable.
- Branch, remote, or authentication configuration is unavailable.
- `lazy-term-config.json` contains invalid data.
- The worktree has conflicts requiring user intervention.

```powershell
git -C C:\path\to\repo status
git -C C:\path\to\repo remote -v
```

Back up the repository configuration before syncing. Pull writes Git configuration into localStorage; if both sides contain important edits, merge them manually in Git first.

## `npm ci` Fails

### Causes

- Node.js is older than 20, or `node` / `npm` is missing from PATH.
- Network, proxy, or npm registry failure.
- `package-lock.json` does not match `package.json`.

```powershell
node -v
npm -v
npm config get registry
npm ci
```

Do not delete `package-lock.json` merely to bypass an error. When dependencies truly need an update, use `npm install` intentionally and review the lockfile diff.

## Rust Cannot Find FreeRDP or LibVNCClient

On Windows, set the install prefixes in the current PowerShell:

```powershell
$env:FREERDP_ROOT = "C:\dev\freerdp\install"
$env:LIBVNCSERVER_ROOT = "C:\dev\libvncserver\install"
```

FreeRDP needs `include`, `lib`, and `bin`; LibVNCClient needs `include` and `lib`. Non-Windows builds use `pkg-config` to find `freerdp3`, `freerdp-client3`, `winpr3`, and `libvncclient`.

## Still Need Help

Read the [support policy](../../../SUPPORT.md) before filing an issue. Include:

- LazyTerm version and operating system.
- Connection type and selected backend.
- Reproduction steps.
- The UI error summary and sanitized technical details.
- Whether a native system client reproduces the problem.
