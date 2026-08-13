# 发布流程

> **简体中文** | [English](../../en/developer/release-process.md)

本文定义 LazyTerm 的桌面发行流程。GitHub 是代码、Tag 和 Release 的唯一上游；Gitee 是面向国内网络的单向镜像。GitHub Packages 不用于分发桌面应用。

## 发布内容

正式版本使用严格的 `vMajor.Minor.Patch` Tag，例如 `v26.81.2912`，并包含：

| 文件 | 用途 |
| --- | --- |
| `LazyTerm_<version>_windows_x64-setup.exe` | Windows x64 推荐安装程序 |
| `LazyTerm_<version>_windows_x64.msi` | Windows x64 集中部署包 |
| `LazyTerm_<version>_macos_arm64.dmg` | macOS Apple Silicon 磁盘映像 |
| `SHA256SUMS.txt` | 所有安装包的 SHA-256 校验值 |

GitHub 还会提供与 Tag 对应的源码归档。工作流通过 GitHub OIDC 为安装包生成构建来源证明，可使用 `gh attestation verify` 验证。

## 一次性配置

### GitHub

1. 在 `Settings > Actions > General > Workflow permissions` 允许工作流写入仓库内容，使 `GITHUB_TOKEN` 能创建 Release 和上传资产。
2. 在 `Settings > General > Releases` 启用 Release immutability。工作流会先创建草稿、上传全部资产，最后公开。
3. 建议使用 ruleset 保护 `v*` Tag，限制发布 Tag 的创建和删除权限。
4. 建议创建 `breaking-change`、`enhancement`、`feature`、`bug`、`fix`、`documentation` 和 `skip-changelog` 标签，供自动 Release Notes 分类。

### Gitee

Gitee 镜像仓库保持为 `LeoJohn8/LazyTerm` 时，在 GitHub 仓库中配置：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Repository secret | `GITEE_USERNAME` | 有 Gitee 仓库写权限的用户名 |
| Repository secret | `GITEE_TOKEN` | Gitee 私人令牌，用于 Git HTTPS 推送和 API |
| Repository variable（可选） | `GITEE_REPOSITORY` | 默认 `LeoJohn8/LazyTerm`，迁移镜像仓库时覆盖 |

`GITEE_TOKEN` 至少需要仓库读写权限。首次同步会创建或更新 `main` 分支；如果 Gitee 仓库仍使用其他默认分支，首次同步成功后应在 Gitee 仓库设置中把默认分支改为 `main`。如果修改 `GITEE_REPOSITORY`，还必须同步修改 `src/config/update-config.ts` 中的 Gitee 回退地址。

同步是单向且非破坏性的：每次 GitHub `main` 推送都会更新 Gitee `main`，发布完成后再同步当前 Tag 和 Release 资产。工作流不使用 `git push --mirror`，不会删除 Gitee 独有引用。Gitee 仓库不应直接开发或修改同名分支与 Tag。

当前 Windows 和 macOS 产物没有商业代码签名。引入证书前，Release Notes 必须保留未知发布者提示；签名凭据只能存放在 GitHub Actions secrets 中。

## 准备版本

在干净的 `main` 分支执行：

```powershell
git switch main
git pull --ff-only
npm ci
npm run version:sync
npm run version:check
$releaseVersion = (Get-Content .\package.json -Raw | ConvertFrom-Json).version
git diff -- package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
```

`version:sync` 根据最近一次 Git 提交的 UTC 时间生成符合 Windows 限制的三段数字版本，并同步：

- `package.json`
- `package-lock.json`（顶层和根包）
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`

也可以显式指定版本：

```powershell
npm run version:set -- 26.81.2912
```

确认版本和变更后提交并创建附注 Tag：

```powershell
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "准备发布 LazyTerm v$releaseVersion"
git tag -a "v$releaseVersion" -m "LazyTerm v$releaseVersion"
git push origin main
git push origin "v$releaseVersion"
```

不要先推 Tag 再修改版本文件。发布工作流要求 Tag 与五个版本位置完全一致，任一不一致都会在构建前失败。

## 自动发布门禁

推送合法 Tag 后，`.github/workflows/release.yml` 会：

1. 校验 Tag 格式、版本文件与锁文件。
2. 创建或复用草稿 Release，并生成变更记录。
3. 并行构建 Windows x64 的 NSIS/MSI 与 macOS Apple Silicon 的 DMG。
4. 汇总产物并生成 `SHA256SUMS.txt`。
5. 为全部资产生成 GitHub artifact attestations。
6. 所有步骤成功后公开 GitHub Release 并标记为 Latest。
7. 使用独立的 `.github/workflows/mirror-gitee.yml` 将当前 Tag 和 Release 资产同步到 Gitee；日常 `main` 推送也由该工作流持续镜像。

Gitee 同步失败不会撤回已经公开的 GitHub Release，可以在 Actions 页面单独重跑镜像工作流。构建失败时不要移动或复用 Tag；修复原因后重跑失败任务，草稿 Release 会被复用。正式 Release 一旦公开，不应覆盖资产，修复必须使用新版本。

`workflow_dispatch` 只用于针对已有 Tag 重试完整发布，不会从分支临时创建版本。

## 应用内双源更新

应用使用 5 秒短超时请求 GitHub Releases API，选择当前平台安装包后再探测真实附件下载链路。API 或附件 CDN 请求失败、被限流，或 Release 没有有效安装包时，再解析 Gitee Release 页面。因此 GitHub 是首选源，Gitee 镜像负责国内网络回退。

镜像文件名必须保留 `LazyTerm` 前缀和三段数字版本，否则 Gitee 页面解析器不会识别。发布后应分别在可访问和不可访问 GitHub 的网络环境中手工执行一次“检查更新”。

## 发布后验证

```powershell
$releaseVersion = (Get-Content .\package.json -Raw | ConvertFrom-Json).version
gh release view "v$releaseVersion" --repo LeoJhon8/LazyTerm
gh release verify "v$releaseVersion" --repo LeoJhon8/LazyTerm
```

下载资产后核对 SHA-256 并验证来源证明：

```powershell
Get-FileHash .\LazyTerm_*_windows_x64-setup.exe -Algorithm SHA256
gh attestation verify .\LazyTerm_*_windows_x64-setup.exe --repo LeoJhon8/LazyTerm
```

最后由维护者快速人工检查 Windows 安装/启动、macOS 挂载/启动、应用内 GitHub 优先更新和 Gitee 回退更新。
