# 开发工作流

## 常用命令

安装依赖：

```powershell
npm ci
```

启动前端：

```powershell
npm run dev
```

启动完整桌面应用：

```powershell
npm run tauri:dev
```

代码检查：

```powershell
npm run lint
```

TypeScript 编译检查：

```powershell
.\node_modules\.bin\tsc -p tsconfig.app.json --noEmit
```

Rust 编译检查：

```powershell
cd .\src-tauri
cargo check
```

## 验证约定

默认只做编译类检查：

- TypeScript：`tsc --noEmit`
- Rust：`cargo check`

不要把 `npm run build`、`npm run tauri:build` 或 `cargo build` 作为默认验证命令。需要发布包或用户明确要求时再执行构建。

## 目录约定

- 前端组件放在 `src/components/`。
- 协议连接生命周期放在 `src/connectors/`。
- Tauri IPC 封装放在 `src/services/`。
- 可持久化状态放在 `src/store/`。
- Rust 协议实现放在 `src-tauri/src/protocol/`。
- Tauri 权限放在 `src-tauri/capabilities/`。
- Windows 原生 sidecar 放在 `src-tauri/native/`。

## 新增 Tauri 命令

新增命令时至少检查：

1. Rust 命令实现。
2. `src-tauri/src/lib.rs` 是否注册。
3. `src-tauri/capabilities/` 是否授权。
4. 前端 `services/` 或 `connectors/` 是否有统一封装。
5. 用户可见错误是否能在 UI 中展示。

## 新增协议

推荐顺序：

1. 在 `src/types/` 定义配置和连接器类型。
2. 在 `src/connectors/` 实现连接器。
3. 在 `src-tauri/src/protocol/` 实现后端命令。
4. 在 `src-tauri/src/lib.rs` 注册命令。
5. 更新 `src-tauri/capabilities/`。
6. 在会话树、快速连接或连接弹窗中接入 UI。
7. 更新用户文档和开发者文档。

## 文档维护

文档按读者拆分：

- 面向使用者的内容放在 `docs/user/`。
- 面向维护者的内容放在 `docs/developer/`。
- 新增文档后同步更新 `docs/README.md`。
- `README.md` 只保留项目入口级说明，不承载过长维护细节。

