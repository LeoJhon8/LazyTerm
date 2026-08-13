## 下载 / Downloads

- `LazyTerm_*_windows_x64-setup.exe`：Windows x64，推荐安装程序 / recommended Windows installer
- `LazyTerm_*_windows_x64.msi`：Windows x64，适合集中部署 / MSI package for managed deployment
- `LazyTerm_*_macos_arm64.dmg`：macOS Apple Silicon

当前安装包未使用商业代码签名证书。Windows SmartScreen 或 macOS Gatekeeper 可能显示未知发布者提示，请在安装前核对 `SHA256SUMS.txt`。应用内更新会优先尝试 GitHub Releases；GitHub 不可用时自动回退到 Gitee。

The current installers are not signed with a commercial code-signing certificate. Windows SmartScreen or macOS Gatekeeper may show an unknown-publisher warning. Verify `SHA256SUMS.txt` before installing. In-app updates try GitHub Releases first and automatically fall back to the Gitee mirror when GitHub is unavailable.

构建来源证明可使用 GitHub CLI 验证：

```powershell
gh attestation verify .\LazyTerm_<version>_windows_x64-setup.exe --repo LeoJhon8/LazyTerm
```

Build provenance can be verified with GitHub CLI:

```bash
gh attestation verify ./LazyTerm_<version>_macos_arm64.dmg --repo LeoJhon8/LazyTerm
```
