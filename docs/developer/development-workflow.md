# 开发工作流

> **简体中文** | [English](../en/developer/development-workflow.md)

## 常用命令

```powershell
# 严格按锁文件安装依赖
npm ci

# 只启动前端
npm run dev

# 启动完整 Tauri 应用
npm run tauri:dev

# ESLint
npm run lint

# TypeScript 编译检查
& .\node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit

# Rust 编译检查
cargo check --manifest-path .\src-tauri\Cargo.toml
```

Windows 原生 RDP sidecar：

```powershell
npm run build:msrdpax-sidecar:debug
npm run build:msrdpax-sidecar:release
```

打包命令仅在发布或明确需要安装包时执行：

```powershell
npm run tauri:build
```

该命令会先运行 `scripts/update-version.js`，因此会修改版本字段，不适合当作日常验证命令。

## 验证约定

默认验证只使用编译和静态检查：

- TypeScript：`tsc --noEmit`
- Rust：`cargo check`
- 代码规范：`npm run lint`
- 文档：`git diff --check`、本地链接检查和人工审阅

除非任务明确要求，不使用 `npm run build`、`npm run tauri:build`、`cargo build` 或 `cargo check --tests` 作为验证方式。

项目当前约定不由自动化修改创建、更新或运行测试代码，包括单元测试、集成测试、E2E、mock、fixture 和临时测试脚本。行为验证由维护者进行快速人工检查；编译失败时需要保留原始错误，并说明是否与当前改动相关。

## 代码边界

| 目录 | 职责 |
| --- | --- |
| `src/components/` | UI、布局、弹窗和会话视图 |
| `src/store/` | Zustand 运行时状态与持久化配置 |
| `src/connectors/` | 协议连接接口、事件监听和前端生命周期 |
| `src/services/connection/` | 重连、就绪屏障、质量策略和错误归类 |
| `src/services/` | Tauri IPC 和应用服务 |
| `src/lib/` | 工作区、凭据、布局等领域逻辑 |
| `src-tauri/src/protocol/` | Rust 协议命令和后台任务 |
| `src-tauri/capabilities/` | Tauri 权限边界 |
| `src-tauri/native/` | sidecar 和随附原生运行时 |

UI 不应直接调用协议 command；先扩展 Connector 或 Service。持久化 Store 不应保存 Connector、Promise、Channel、监听器取消函数或原生句柄。

## 修改现有协议

至少检查：

1. Connector 是否在启动后端前完成必要监听注册。
2. 状态是否通过 `ConnectionStateEmitter` 和 `tabs.ts` 汇总。
3. 旧 generation 的回调是否会被忽略。
4. 关闭路径是否清理前端监听、Supervisor 注册和 Rust 会话句柄。
5. 错误是否经过 `connectionErrors.ts` 分类，并提供可重试标记。
6. 图形协议是否响应可见性、质量策略、全帧刷新和尺寸变化。
7. 用户可见行为与中英文文案是否同步。

## 新增 Tauri command

至少检查：

1. Rust 命令实现及参数是否可序列化。
2. `src-tauri/src/lib.rs` 是否注册 command。
3. `src-tauri/capabilities/` 是否需要新增或收紧权限。
4. 前端是否通过 `services/` 或 `connectors/` 统一调用。
5. 高频写入是否需要 `invokeTauriSerialized` 保证顺序。
6. 后台清理是否适合 `invokeTauriBackground`，以及错误是否仍有日志。
7. 用户可见错误是否经过统一展示层。

## 新增协议

推荐顺序：

1. 在 `src/types/terminal.ts` 定义协议、配置和 Connector 能力。
2. 在 `src/connectors/` 实现连接器，并接入统一状态事件。
3. 在 `ConnectorFactory.ts` 增加工厂分支和凭据解析。
4. 在 `src-tauri/src/protocol/` 实现命令、后台任务、控制通道和关闭逻辑。
5. 在 `src-tauri/src/lib.rs` 注册命令并审查 capabilities。
6. 在会话树、连接表单、快速连接和 `PaneView` 接入 UI。
7. 在 Supervisor 中明确是否自动重连，以及哪些错误可重试。
8. 图形协议接入 Readiness 和 Quality 策略。
9. 同步更新中英文 UI 文案、用户文档、架构文档和故障排查。

详见 [架构设计](./architecture.md#扩展新协议)。

## 持久化变更

- 新增持久化字段时评估是否需要 `version` 与 `migrate`。
- 用户可见文案发生更名或语义变化时，同步修改翻译键、调用点和所有语言值，并删除旧键。
- 参与 Git 同步的 Store 需要显式加入 `git-aware-storage.ts` 的白名单。
- 凭据、API Key、私钥正文和口令只能进入加密保险库，不能写入普通配置或日志。
- 活跃连接、标签页和当前分屏树默认不持久化；如果要改变该边界，必须更新架构与恢复策略。

## 文档维护

- 中文用户文档：`docs/user/`
- 中文开发者文档：`docs/developer/`
- 英文镜像：`docs/en/user/`、`docs/en/developer/`
- 中文索引：`docs/README.md`
- 英文索引：`docs/en/README.md`

修改已有文档时同步更新同路径的英文版。新增文档后更新两个索引，并在中英文文档顶部提供语言切换链接。根目录 README 只承载项目入口级信息，详细实现放在 `docs/`。

历史记录类文档（许可证审计、发布清单）必须保留真实执行日期；仅翻译内容不能把旧审计标记为最新审计。

## 提交前

1. 查看 `git status --short`，不要覆盖用户的无关改动。
2. 对代码改动执行适当的 lint 与编译检查。
3. 对文档执行 `git diff --check` 并检查本地相对链接。
4. 提交前查看 staged diff；commit message 使用中文，准确描述实际变化。
