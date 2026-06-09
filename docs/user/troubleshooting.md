# 常见问题

## 本地终端创建失败

原因：

- 默认 Shell 不存在。
- Shell 路径配置错误。
- 当前系统环境变量没有刷新。

修复方式：

- Windows 下优先确认 `powershell.exe` 或 `pwsh.exe` 可用。
- 在设置中手动指定 Shell 路径。
- 重新打开终端或重启应用。

验证方式：

```powershell
powershell.exe -NoProfile
pwsh.exe -NoProfile
```

## SSH 连接失败

原因：

- 主机、端口或用户名错误。
- 密码或私钥不可用。
- 远端不接受当前认证方式。

修复方式：

- 检查主机、端口、用户名和认证配置。
- 确认私钥文件路径存在且格式正确。
- 先用系统 SSH 客户端验证同一组连接参数。

验证方式：

```powershell
ssh user@example.com
```

## RDP 连接异常

原因：

- 远端 RDP 服务不可达。
- 当前 RDP 后端不适合目标服务器。
- MsTscAx sidecar 缺少 .NET 或 Windows 原生组件。

修复方式：

- FreeRDP 模式适合内嵌标签页体验。
- MsTscAx sidecar 仅适合 Windows。
- MsTscAx sidecar 仅适合 Windows，并需要对应运行环境。

验证方式：先确认远端 RDP 服务可达，再在 LazyTerm 中分别尝试 FreeRDP 或 MsTscAx sidecar。

## VNC 构建或连接失败

原因：

- Windows/MSVC 下缺少 LibVNCClient。
- `LIBVNCSERVER_ROOT` 未设置，且没有安装到默认路径。
- 远端 VNC 服务不可达。

修复方式：

- 优先按 [Windows 开发环境](../developer/development-setup-windows.md) 准备 LibVNCClient。
- 如果安装在非默认目录，在当前 PowerShell 设置：

```powershell
$env:LIBVNCSERVER_ROOT = "C:\dev\libvncserver\install"
```

## 串口连接失败

原因：

- 设备未连接或未被系统识别。
- 波特率、数据位、校验位、停止位或流控配置不匹配。
- 串口被其他程序占用。

修复方式：

- 确认设备管理器中能看到对应串口。
- 关闭可能占用串口的其它程序。
- 按设备文档重新设置串口参数。

## `npm ci` 失败

原因：

- Node.js 版本过旧。
- 网络或代理异常。
- `package-lock.json` 与当前 npm 版本不兼容。

修复方式：

```powershell
node -v
npm -v
npm ci
```
