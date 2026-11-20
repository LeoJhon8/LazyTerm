## 26.102.9155 更新 / Changes

- 支持给 tmux 会话添加本地标签，在恢复列表和已连接会话对应的标签页上悬停查看。
- 支持保存和切换多套 AI 配置。AI 可按所选权限在本地或 SSH 终端执行命令，用户可以查看进度、确认命令或停止接管。
- 改进 Windows 原生 RDP 的连接状态、窗口定位和侧栏拖动。认证失败后可使用仅限当前会话的新凭据重试。
- Windows x64 安装包随附 Visual C++ 运行库。新增面向开发和演示的独立 Demo 构建，可模拟本地终端、SSH 和 SFTP。

- Add local tags to tmux sessions and view them by hovering over a session in the restore list or an attached session's tab.
- Save and switch between AI profiles. AI can run commands in local or SSH terminals according to the selected permissions, with progress, command approval, and stop controls.
- Improve native Windows RDP connection status, positioning, and sidebar resizing. Retry authentication with credentials that apply only to the current session.
- Bundle the Visual C++ runtime with Windows x64 installers. A separate Demo build for development and demonstrations simulates local terminals, SSH, and SFTP.

## 下载 / Downloads

- `LazyTerm_*_windows_x64-setup.exe`：Windows x64，推荐安装程序 / recommended Windows installer
- `LazyTerm_*_windows_x64.msi`：Windows x64，适合集中部署 / MSI package for managed deployment
- `LazyTerm_*_macos_arm64.dmg`：macOS Apple Silicon
- `LazyTerm_*_android_arm64.apk`：Android 7.0+ ARM64 真机 / Android 7.0+ ARM64 devices

Android 版当前支持 SSH、配置、历史、快捷命令、主题、多终端标签、后台保活、自动重连和应用内更新；不包含桌面版的其他协议与工作区功能。x86_64 APK 仅供模拟器调试，不作为发布产物。

The Android app currently includes SSH, profiles, history, quick commands, themes, multiple terminal tabs, background continuity, automatic reconnect, and in-app updates. It does not include the desktop-only protocols or workspace features. x86_64 APKs are for emulator debugging only and are not release artifacts.

Windows and macOS installers do not use a commercial code-signing certificate. SmartScreen or Gatekeeper may show an unknown-publisher warning. The Android APK uses LazyTerm's stable release key so upgrades can verify and retain the application identity. Verify `SHA256SUMS.txt` before installing. In-app updates compare available GitHub and Gitee versions and prefer GitHub when both offer the same version.

构建来源证明可使用 GitHub CLI 验证：

```powershell
gh attestation verify .\LazyTerm_<version>_windows_x64-setup.exe --repo LeoJhon8/LazyTerm
```

Build provenance can be verified with GitHub CLI:

```bash
gh attestation verify ./LazyTerm_<version>_macos_arm64.dmg --repo LeoJhon8/LazyTerm
```
