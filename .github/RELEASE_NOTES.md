## 26.101.495 更新 / Changes

- 修复 Android 快捷键导致终端失焦和键盘收起的问题，改善触摸滚动、键盘展开布局及 tmux 检测，并隐藏终端滚动条。
- 更新检测兼容 Android APK 文件名，比较 GitHub 与 Gitee 的可用版本，避免漏掉仅在 Gitee 发布的更新。
- 改进 RDP 输入、剪贴板、远程光标和动态分辨率支持，补充原生连接事件提示，修复视图模式快捷键的重复注册。
- 补齐 RDP 计时函数的跨平台头文件，修复 macOS 发布编译失败。

Android terminal shortcuts retain focus and the keyboard; touch scrolling, keyboard layout and tmux detection are improved. Update checks recognize Android APK filenames and compare available GitHub/Gitee versions. RDP input, clipboard, cursor, resizing and native connection diagnostics are improved, along with view-mode shortcut registration.

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
