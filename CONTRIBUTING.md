# 贡献指南

感谢你愿意改进 LazyTerm。项目接受缺陷报告、功能建议、文档改进和代码贡献；维护工作按 best-effort 方式进行，不承诺响应时间或合并期限。

## 提交 Issue 前

- 搜索现有 Issue，避免重复报告。
- Bug 请使用 Bug Report 模板，并提供可复现步骤、LazyTerm 版本、操作系统和连接类型。
- 功能建议请说明使用场景和期望行为，不必预先设计完整实现。
- 安全问题不要提交公开 Issue，请遵循 [安全政策](./SECURITY.md)。
- 不要上传密码、私钥、Token、真实服务器地址或未脱敏日志。

## 开发环境

基础环境和 Windows 依赖见：

- [Windows 开发环境](./docs/developer/development-setup-windows.md)
- [开发工作流](./docs/developer/development-workflow.md)
- [架构说明](./docs/developer/architecture.md)

安装前端依赖：

```powershell
npm ci
```

启动完整桌面应用：

```powershell
npm run tauri:dev
```

## 修改约定

- 前端状态统一放在 `src/store/`，协议调用通过 `src/connectors/` 或 `src/services/` 接入。
- 新增 Tauri 命令后，同步检查 `src-tauri/src/lib.rs` 和 `src-tauri/capabilities/`。
- 用户可见文本应接入现有中英文国际化资源。
- 不要提交构建产物、本地配置、凭据、真实连接信息或仅用于调试的日志开关。
- 引入新依赖或二进制文件前，确认其许可证与 GPL-3.0-or-later 兼容，并更新 `THIRD_PARTY_NOTICES.md`。

## 提交 Pull Request

建议让每个 Pull Request 聚焦一个主题，并在描述中说明：

- 修改了什么以及用户可见的行为变化。
- 相关 Issue（如有）。
- 已执行的检查和未验证的范围。
- 新增或更新的第三方依赖及其许可证。

提交前建议执行：

```powershell
npm run lint
.\node_modules\.bin\tsc -p tsconfig.app.json --noEmit
cargo check --manifest-path .\src-tauri\Cargo.toml
```

如果检查失败，请在 Pull Request 中保留原始错误并说明是否与本次修改相关。

## 贡献许可

提交代码、文档或其他可版权化内容，即表示你有权提交这些内容，并同意按项目的 [GNU GPL v3.0 or later](./LICENSE) 许可分发你的贡献。第三方内容必须保留原始版权和许可证声明。
