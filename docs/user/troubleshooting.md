# 常见问题

> **简体中文** | [English](../en/user/troubleshooting.md)

排查连接问题时，请先记录 LazyTerm 版本、操作系统、连接类型、目标地址（脱敏后）、错误摘要和技术细节。不要上传密码、私钥、Token 或真实服务器信息。

## 本地终端创建失败

### 原因

- 默认 Shell 不存在或路径错误。
- 当前进程没有访问 Shell 或工作目录的权限。
- 安装工具后，应用仍使用旧的环境变量。

### 修复方式

- Windows 优先确认 `powershell.exe`、`pwsh.exe` 或 Git Bash 可用。
- 在设置中重新选择 Shell，并确认工作目录存在。
- 重新启动 LazyTerm，让应用加载最新环境变量。

### 验证方式

```powershell
Get-Command powershell.exe
Get-Command pwsh.exe -ErrorAction SilentlyContinue
powershell.exe -NoProfile
```

本地 Shell 异常退出时 LazyTerm 会自动重建 Connector；如果它持续退出，应直接在系统终端运行该 Shell 以查看启动错误。

## SSH 连接失败或不断重连

### 原因

- 主机、端口、用户名或认证方式错误。
- 凭据保险库未解锁，或会话引用的凭据已删除。
- 私钥路径、格式或口令不正确。
- DNS、网络、防火墙、SSH 服务或主机密钥异常。

### 修复方式

- 检查会话配置和凭据引用。
- 若启用了主密码，先解锁凭据保险库。
- 先用系统 SSH 客户端验证相同参数。
- 对主机密钥变化、认证拒绝等不可重试错误，修正原因后再手动重连。

### 验证方式

```powershell
Test-NetConnection example.com -Port 22
ssh user@example.com
```

LazyTerm 对可恢复的网络错误执行退避重连。状态显示 `reconnecting` 不代表重连已完成；只有 `connected` 才表示当前 generation 可用。

## 凭据保险库无法解锁

### 原因

- 主密码不正确。
- localStorage 中的保险库文档损坏或来自不兼容的数据。
- 导入的主密码保险库缺少正确密码。

### 修复方式

- 确认键盘布局、大小写和输入法后重新输入主密码。
- 如果有导出的保险库或 Git 配置备份，先保留当前数据，再尝试导入已知可用版本。
- 清空保险库会丢失其中凭据，只应在确认没有可恢复备份时操作。

LazyTerm 无法恢复遗忘的主密码，也不应通过日志输出解密后的秘密。

## RDP 连接异常

### 原因

- 远端 RDP 服务、端口或网络不可达。
- FreeRDP 与目标服务器的安全或协商设置不兼容。
- MsTscAx sidecar 缺失、无法启动或原生窗口未正确挂载。
- 认证信息或域配置错误。

### 修复方式

- Windows 可在设置中分别尝试 FreeRDP 与 MsTscAx。
- 非 Windows 平台只能使用 FreeRDP。
- MsTscAx 路径需要已构建和打包的 sidecar；开发环境还需要 .NET SDK。
- 切换标签页、调整窗口或重连时如出现黑屏，可先重新聚焦会话或手动重连。

### 验证方式

```powershell
Test-NetConnection example.com -Port 3389
```

FreeRDP 画面由 Canvas 渲染，MsTscAx 使用原生子窗口，两条路径的画面问题应分别定位。详见 [RDP 架构](../developer/rdp-architecture.md)。

## VNC 构建或连接失败

### 原因

- Windows/MSVC 下缺少 LibVNCClient 头文件或库。
- `LIBVNCSERVER_ROOT` 指向的目录不包含 `include` 和 `lib`。
- 远端 VNC 服务、认证或安全类型不兼容。
- 运行时缺少所需 DLL。

### 修复方式

- 按 [Windows 开发环境](../developer/development-setup-windows.md) 构建 LibVNCClient。
- 非默认安装目录需在当前 PowerShell 设置：

```powershell
$env:LIBVNCSERVER_ROOT = "C:\dev\libvncserver\install"
```

- 确认该目录至少包含 `include\rfb\rfbclient.h` 与 `lib\vncclient.lib`。
- 检查服务器地址、端口、密码以及共享/只读设置。

## SFTP 上传或下载失败

### 原因

- SSH 凭据无效或远端没有启用 SFTP 子系统。
- 本地目录或远端目录没有读写权限。
- 远端路径无效，或目录传输中遇到无法读取的文件。
- 网络中断或用户取消了操作。

### 修复方式

- 先验证同一配置能否建立 SSH 连接。
- 确认本地目标目录和远端目录权限。
- 缩小到单个文件重试，以确定是路径还是批量内容导致失败。
- 从通知中心或传输弹窗查看具体失败文件与技术细节。

## 串口连接失败

### 原因

- 设备未连接、驱动未安装或系统没有识别端口。
- 串口被其他程序占用。
- 波特率、数据位、校验位、停止位或流控不匹配。
- USB 串口设备断开后端口号发生变化。

### 修复方式

```powershell
[System.IO.Ports.SerialPort]::GetPortNames()
```

- 关闭可能占用串口的其他程序。
- 按设备文档重新设置所有串口参数。
- 重新插拔设备后刷新端口列表，并确认新的端口号。

串口属于可自动重连协议，但设备被移除或端口号改变时，通常仍需用户修正配置。

## AI 助手请求失败

### 原因

- 服务地址不是 HTTP/HTTPS，或不是 OpenAI 兼容接口。
- 模型名错误，API Key 无效，或凭据保险库未解锁。
- 服务不支持 `/v1/chat/completions` 或返回了非兼容响应。
- 网络、代理或服务端限流异常。

### 修复方式

- 检查 AI 设置中的 Base URL、模型和凭据引用。
- 服务地址可填写到服务根路径或 `/v1`；LazyTerm 会补全 `/chat/completions`。
- 在服务提供方控制台确认 Key、模型权限、余额和限流状态。
- 清除失败消息后重试，必要时关闭上下文关联以减少请求内容。

## Git 配置同步失败

### 原因

- 选择的目录不是 Git 仓库，或没有文件写入权限。
- 当前分支、远端或认证配置不可用。
- `lazy-term-config.json` 存在无法解析的内容。
- Git 工作区存在需要用户处理的冲突。

### 修复方式

```powershell
git -C C:\path\to\repo status
git -C C:\path\to\repo remote -v
```

同步前先备份仓库中的配置文件。拉取会把 Git 配置写入 localStorage；若两边都有重要修改，应先在 Git 中人工合并。

## `npm ci` 失败

### 原因

- Node.js 版本低于 20，或 `node` / `npm` 不在当前 PATH。
- 网络、代理或 npm registry 异常。
- `package-lock.json` 与 `package.json` 不一致。

### 验证方式

```powershell
node -v
npm -v
npm config get registry
npm ci
```

不要为了绕过锁文件错误随意删除 `package-lock.json`。如果确实要升级依赖，应明确使用 `npm install` 并审查锁文件差异。

## Rust 编译找不到 FreeRDP 或 LibVNCClient

Windows 可在当前 PowerShell 设置：

```powershell
$env:FREERDP_ROOT = "C:\dev\freerdp\install"
$env:LIBVNCSERVER_ROOT = "C:\dev\libvncserver\install"
```

FreeRDP 目录需要 `include`、`lib` 和 `bin`；LibVNCClient 目录需要 `include` 和 `lib`。非 Windows 平台由 `pkg-config` 查找 `freerdp3`、`freerdp-client3`、`winpr3` 和 `libvncclient`。

## 仍然无法解决

提交 Issue 前请阅读 [支持说明](../../SUPPORT.md)，并附上：

- LazyTerm 版本与操作系统。
- 连接类型和所选后端。
- 可复现步骤。
- 界面错误摘要及经过脱敏的技术细节。
- 是否能够用系统原生客户端复现。
