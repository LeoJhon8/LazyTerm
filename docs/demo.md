# 独立 Demo 构建

Demo 与正式版复用界面，使用 Vite `demo` 模式替换连接器、SFTP 对话框、存储和外部服务。Rust `demo` feature 使用独立入口，不编译或注册真实协议模块，也不注册文件、HTTP、更新、通知或打开外链插件。

## Windows 使用

沿用项目的 Node.js/npm、Rust、Tauri Windows 开发环境和 WebView2 前置条件。Demo 使用 `--no-default-features`，不需要 FreeRDP、LibVNCClient 或原生 RDP sidecar。

首次生成 Windows 安装包时，Tauri 会自动下载 WiX/NSIS 打包工具，需要能够访问 GitHub 下载地址；工具下载失败不代表应用编译失败。下载完成后可复用本机缓存。

```powershell
# 启动桌面 Demo，前端端口固定为 5174
npm run tauri:dev:demo

# 生成独立 Demo 安装包（需要主动执行；不是默认验证步骤）
npm run tauri:build:demo
```

`npm run dev:demo` 仅启动前端开发服务；完整窗口、剪贴板等功能仍需要 Tauri 宿主，不作为独立网页版发布。

- 名称：`LazyTerm Demo`；应用标识：`com.lazy.term.demo`；可执行文件名：`lazyterm-demo`。
- 前端输出：`dist-demo/`；Rust 输出：`src-tauri/target-demo/`；默认安装包位于其 `release/bundle/`。
- Demo 脚本不运行正式版的版本号更新脚本，也不修改正式版输出目录。
- `tauri.demo.conf.json` 合并覆盖默认和平台配置，使用独立资源列表及能力列表。
- 保留 Cargo 已启用的 asset protocol 以匹配 Tauri 配置，但 Demo 的文件 scope 为空，CSP 也不允许 asset URL。
- 正式构建命令、默认 Cargo features、正式连接器和 SFTP 对话框不变。

## 人工演示流程

1. 在会话列表打开 `web.demo`。所有地址（包括手动输入的地址）在 Demo 中都不会建立真实连接。
2. 输入 `help`，尝试 `pwd`、`ls -la`、`cat README.txt`、`cd logs`、`cat app.log`。支持回车、退格、Ctrl+C、Ctrl+L、上下方向键历史和多行粘贴。未实现完整 Shell，路径不支持空格，不执行管道、重定向或任意程序。
3. 使用现有标签页、分屏、搜索和快捷命令。新建本地终端同样使用模拟 Shell。
4. 在 SSH 会话或标签页右键菜单打开 SFTP 上传，导航至 `uploads`，点击“上传示例文件”。进度完成后，终端中执行 `ls ~/uploads`、`cat ~/uploads/sample-upload.txt`。
5. 打开 SFTP 下载，勾选文件，观察进度和应用内通知。下载不创建电脑文件。传输中可取消；关闭对话框也会取消。上传只有完成后才写入虚拟文件树，再次上传同名示例文件会覆盖其演示内容。
6. 输入 `demo-disconnect`，观察现有连接监督器自动重连；`auth-failed.demo` 固定返回认证失败，其他服务器正常连接。
7. 不同主机有独立文件树；同一主机的多个终端和 SFTP 共享文件树。
8. 点击右下角“重置演示”或重启应用，关闭所有演示会话并恢复预置数据。

## 首版范围与维护

仅提供 SSH、模拟本地终端及 SFTP 场景。RDP/VNC、串口、Telnet、AI CLI、真实 AI 请求、Git 同步、导入导出、原生文件选择和更新不在演示范围。剪贴板和窗口操作仍使用真实桌面能力。

所有应用配置（包括凭据、历史、AI 配置和布局）通过 `appStorage` 接口访问。正式实现仍为原生 `localStorage`；Demo 是预置的内存存储，不读取真实数据，不会把修改留到下次运行。新增持久化入口也必须使用该接口；新增外部服务应同步维护 Demo 构建替换及后端能力范围。

Demo 文件位于 `src/demo/`，仅由 Demo 入口或构建别名引用。SFTP 使用独立演示对话框，以避免修改正式传输流程；未来正式版调整对话框时，需要同步考虑 Demo 外观与交互。终端场景输出使用示例 Linux 英文文本，Demo 界面标签支持中英文。

验证遵守项目规则：代码审查、TypeScript 编译检查、`cargo check`，不新增或运行测试、不截图、不自动打包。涉及 Demo Tauri 配置的检查需在当前 PowerShell 进程设置 `TAURI_CONFIG`，结束后移除该临时环境变量，避免影响正式构建。
