# FreeRDP RDP FFI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current embedded `ironrdp` canvas backend with a FreeRDP C library FFI backend while keeping the existing frontend RDP frame/input protocol.

**Architecture:** Add a small C wrapper around FreeRDP and expose a narrow Rust-safe client API. Keep `rdp.rs` command names and frame packet format stable so the frontend remains largely unchanged. Preserve `msrdpax` and `mstsc` paths for later backend selection work.

**Tech Stack:** Tauri 2, Rust FFI, FreeRDP 3 C library, WinPR, `cc` build script, existing JPEG/RGBA frame channel protocol.

---

### Task 1: Build Integration

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/build.rs`
- Create: `src-tauri/src/protocol/freerdp_ffi/wrapper.c`
- Create: `src-tauri/src/protocol/freerdp_ffi/mod.rs`

- [ ] Add `rdp-freerdp` default feature and remove `ironrdp`/`ironrdp-blocking` dependencies from the active RDP path.
- [ ] Add `build.rs` probing for `FREERDP_ROOT`, `FREERDP_INCLUDE_DIR`, `FREERDP_LIB_DIR`, then `pkg-config` (`freerdp3`, `winpr3`) on non-Windows.
- [ ] Compile `freerdp_ffi/wrapper.c` with the detected include paths.
- [ ] Link `freerdp3` and `winpr3` with a clear error if FreeRDP is missing.
- [ ] Run `cargo check` and confirm either a successful compile or the expected FreeRDP-missing build message.

### Task 2: C Wrapper Surface

**Files:**
- Modify: `src-tauri/src/protocol/freerdp_ffi/wrapper.c`
- Modify: `src-tauri/src/protocol/freerdp_ffi/mod.rs`

- [ ] Define opaque `LazyFreeRdpClient`.
- [ ] Implement `LazyFreeRdpConfig`, `LazyFreeRdpFrame`, pointer/key/resize APIs, and error retrieval.
- [ ] Configure FreeRDP settings for server, port, username, password, domain, NLA, GDI framebuffer, and certificate ignore for first pass.
- [ ] Copy changed framebuffer regions to RGBA buffers owned by the wrapper before returning them to Rust.
- [ ] Keep all FreeRDP calls on one backend thread.

### Task 3: Rust Runtime Adapter

**Files:**
- Create: `src-tauri/src/protocol/freerdp_client.rs`
- Replace: `src-tauri/src/protocol/rdp_core.rs`
- Modify: `src-tauri/src/protocol/mod.rs`

- [ ] Add `FreeRdpClient` safe wrapper with `connect`, `poll_frame`, `send_pointer`, `send_key`, `resize`, and `close`.
- [ ] Reuse current RDP frame packet encoding: 13-byte header plus JPEG/RGBA payload.
- [ ] Map current `RdpControlMsg` into FreeRDP input calls.
- [ ] Keep `run_rdp_session` signature compatible with `rdp.rs`, or adjust `rdp.rs` minimally.

### Task 4: Verification

**Files:**
- Verify: `src-tauri`

- [ ] Run `cargo check`.
- [ ] Run the existing frontend type check only if frontend types changed.
- [ ] Confirm no `#[cfg(test)]`, `mod tests`, or `test_` blocks were added under business source directories.
- [ ] Document FreeRDP install environment variables in the final response.
