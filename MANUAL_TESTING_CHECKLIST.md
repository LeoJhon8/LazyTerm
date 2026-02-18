# Manual Testing Checklist for Lazy Terminal

## Prerequisites
- Electron app is running (`npm start`)
- App window is visible
- DevTools available (Ctrl+Shift+I) for debugging

## Test 1: Basic Local Command Execution
**Status:** ⬜ Not Tested | ⬜ Pass | ⬜ Fail

### Test Commands to Run:
- [ ] `echo "Hello World"` → Should display output on next line
- [ ] `pwd` or `Get-Location` (Windows) → Shows current directory
- [ ] `ls -la` (Linux/Mac) or `Get-ChildItem` (Windows) → Directory listing
- [ ] `date` → Shows current date/time

### Expected Results:
- All commands execute and display output
- Prompt returns after command completion
- No error messages in terminal

**If Fail:** Check DevTools Console for `pty-error` events

---

## Test 2: Interactive Programs - Vim
**Status:** ⬜ Not Tested | ⬜ Pass | ⬜ Fail

### Steps:
1. Type `vim` and press Enter
2. Press `i` to enter Insert mode
3. Type some text: `This is a test`
4. Press `Esc` to exit Insert mode
5. Type `:w` and press Enter (save)
6. Type `:q` and press Enter (quit)

### Expected Results:
- Vim opens in terminal
- Edit mode works (text appears when typing)
- Cursor movement functions
- Can save and quit properly
- Terminal returns to normal shell

**If Fail:** PTY not handling cursor control or escape sequences properly
**Check:** node-pty ConPTY support on Windows

---

## Test 3: Interactive Programs - Top/htop
**Status:** ⬜ Not Tested | ⬜ Pass | ⬜ Fail

### Steps:
1. Type `top` (Linux/Mac) and press Enter
   - If on Windows, try `Get-Process` instead
2. Observe real-time updates
3. Press `q` to quit

### Expected Results:
- Process list displays
- Values update in real-time (top only)
- Quit works with `q`

**If Fail:** PTY not handling screen refreshing properly

---

## Test 4: Long-Running Commands & Streaming Output
**Status:** ⬜ Not Tested | ⬜ Pass | ⬜ Fail

### Steps:
1. Type `ping -n 5 127.0.0.1` (Windows) or `ping -c 5 127.0.0.1` (Linux/Mac)
2. Watch real-time output streaming
3. Wait for completion

### Expected Results:
- Ping responses appear one-by-one (not all at once)
- Real-time streaming visible
- Command completes after 5 pings
- Prompt returns

**If Fail:** Buffer issues or event propagation problems

---

## Test 5: Signal Handling (Ctrl+C)
**Status:** ⬜ Not Tested | ⬜ Pass | ⬜ Fail

### Steps:
1. Type `ping -n 20 127.0.0.1` (Windows) or `ping -c 20 127.0.0.1` (Linux/Mac)
2. Wait for 2-3 pings
3. Press `Ctrl+C`
4. Verify process stops

### Expected Results:
- Process interrupts immediately
- "Command terminated" or similar message
- Prompt returns quickly

**If Fail:** Signal not properly forwarded to PTY

---

## Test 6: Cursor Control
**Status:** ⬜ Not Tested | ⬜ Pass | ⬜ Fail

### Steps:
1. Type a command but don't press Enter
2. Use arrow keys to move cursor
3. Try left/right arrows
4. Try backspace/delete
5. Press Enter to execute

### Expected Results:
- Cursor moves left and right
- Backspace deletes characters
- Command executes correctly

**If Fail:** xterm.js or PTY not handling input properly

---

## Test 7: Tab Switching
**Status:** ⬜ Not Tested | ⬜ Pass | ⬜ Fail

### Steps:
1. Click `+` button to create 2-3 tabs
2. In Tab 1: Run `ping -n 3 127.0.0.1` (wait for completion)
3. Switch to Tab 2
4. In Tab 2: Run `echo "Tab 2 test"`
5. Switch back to Tab 1
6. Try running another command

### Expected Results:
- Each tab has independent PTY session
- Tab 1 shows previous output and accepts new commands
- Tab 2 shows its own commands
- No data loss when switching
- Sessions stay alive

**If Fail:** Tab-to-session_id mapping or session cleanup issues

---

## Test 8: SSH Connection Test
**Status:** ⬜ Not Tested | ⬜ Pass | ⬜ Fail

### Requirements:
- SSH server credentials (host, user, password)

### Steps:
1. Click 📡 button (new-connection-btn)
2. Select "SSH" from dropdown
3. Enter:
   - Host: e.g., 192.168.1.100
   - Username: e.g., testuser
   - Password: e.g., password123
4. Click "Connect"
5. Run `ls -la` or similar command
6. Try running `vim test.txt` (create and save)
7. Logout (type `exit`)

### Expected Results:
- Connection establishes
- Remote shell prompt appears
- Commands execute on remote server
- Interactive programs work
- Session closes on exit

**If Fail:** Check ssh2 client configuration and password auth

---

## Test 9: Session Persistence (Save)
**Status:** ⬜ Not Tested | ⬜ Pass | ⬜ Fail

### Steps:
1. Create a local session
2. Run a few commands
3. Click 💾 button (saveSessionBtn)
4. Give it a name: "Test Local Session"
5. Click Save
6. Check if session appears in saved sessions list

### Expected Results:
- Session saved to storage (check config file)
- Session appears in saved sessions dropdown/list
- Connection parameters preserved (host, type, env)
- Command history NOT saved (expected - PTY content is transient)

**If Fail:** Check `saveActiveTabState()` method in ptyService.js

---

## Test 10: Session Persistence (Load)
**Status:** ⬜ Not Tested | ⬜ Pass | ⬜ Fail

### Steps:
1. Close app (optional) or just create new tab
2. Load saved session from dropdown/list
3. Verify new session established
4. Run a command

### Expected Results:
- New PTY session created with same parameters
- Old terminal content NOT restored (expected)
- New prompt appears
- Commands execute normally

**If Fail:** Check `loadState()` method in ptyService.js

---

## Test 11: Terminal Resize
**Status:** ⬜ Not Tested | ⬜ Pass | ⬜ Fail

### Steps:
1. Run `ping 127.0.0.1` (without count flag - it runs forever)
2. Resize the Electron window
3. Observe terminal output
4. Press Ctrl+C to stop

### Expected Results:
- Terminal fits to window
- No text wrapping issues
- No visual glitches
- PTY resize events sent correctly
- FitAddon adjusts terminal size

**If Fail:** Check resize event handlers and FitAddon

---

## Test 12: Error Handling
**Status:** ⬜ Not Tested | ⬜ Pass | ⬜ Fail

### Steps:
1. Type an invalid command: `nonexistent_command_12345`
2. Try to connect to non-existent SSH server
3. Check console logs for errors

### Expected Results:
- Error displayed (command not found)
- Error doesn't crash the app
- App continues working after error
- Error logged to DevTools console

**If Fail:** Check error handling in event listeners

---

## How to Report Issues

For any test failures, please provide:

1. **Test that failed**: (e.g., Test 2: Interactive Programs - Vim)
2. **What you did**: Exact steps
3. **What happened**: Error message, unexpected behavior
4. **Expected vs Actual**: What should happen vs what did
5. **DevTools Output**: Console errors/warnings (Ctrl+Shift+I > Console tab)
6. **Main Process Logs**: Check terminal where `npm start` is running

**Screenshot/video of the issue would be helpful if possible.**

---

## Testing Checklist Summary

| Test | Status | Notes |
|------|--------|-------|
| 1. Basic Commands | ⬜ |  |
| 2. Vim | ⬜ |  |
| 3. Top/htop | ⬜ |  |
| 4. Streaming Output | ⬜ |  |
| 5. Ctrl+C Signal | ⬜ |  |
| 6. Cursor Control | ⬜ |  |
| 7. Tab Switching | ⬜ |  |
| 8. SSH Connection | ⬜ |  |
| 9. Save Session | ⬜ |  |
| 10. Load Session | ⬜ |  |
| 11. Resize Window | ⬜ |  |
| 12. Error Handling | ⬜ |  |

**Overall Progress:** 0/12 tests completed
