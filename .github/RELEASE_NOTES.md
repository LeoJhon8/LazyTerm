## 下载 / Downloads

- `LazyTerm_*_windows_x64-setup.exe`：Windows x64，推荐安装程序 / recommended Windows installer
- `LazyTerm_*_windows_x64.msi`：Windows x64，适合集中部署 / MSI package for managed deployment
- `LazyTerm_*_macos_arm64.dmg`：macOS Apple Silicon
- `LazyTerm_*_android_arm64.apk`：Android 7.0+ ARM64 真机 / Android 7.0+ ARM64 devices

Android 版当前支持 SSH、配置、历史、快捷命令、主题、多终端标签、后台保活、自动重连和应用内更新；不包含桌面版的其他协议与工作区功能。x86_64 APK 仅供模拟器调试，不作为发布产物。

The Android app currently includes SSH, profiles, history, quick commands, themes, multiple terminal tabs, background continuity, automatic reconnect, and in-app updates. It does not include the desktop-only protocols or workspace features. x86_64 APKs are for emulator debugging only and are not release artifacts.

Windows and macOS installers do not use a commercial code-signing certificate. SmartScreen or Gatekeeper may show an unknown-publisher warning. The Android APK uses LazyTerm's stable release key so upgrades can verify and retain the application identity. Verify `SHA256SUMS.txt` before installing. In-app updates try GitHub Releases first and automatically fall back to the Gitee mirror when GitHub is unavailable.

构建来源证明可使用 GitHub CLI 验证：

```powershell
gh attestation verify .\LazyTerm_<version>_windows_x64-setup.exe --repo LeoJhon8/LazyTerm
```

Build provenance can be verified with GitHub CLI:

```bash
gh attestation verify ./LazyTerm_<version>_macos_arm64.dmg --repo LeoJhon8/LazyTerm
```
