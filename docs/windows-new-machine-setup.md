# 新 Windows 电脑开发环境搭建指南

这份文档面向 `lazy-term` 项目，目标是让一台全新的 Windows 电脑从零开始，最终达到下面的状态：

- 可以拉取代码
- 可以启动前端开发环境
- 可以启动 Tauri 桌面应用开发环境
- 可以构建 Rust / Tauri 部分
- 在需要时可以构建 `msrdpax` sidecar

---

## 1. 你需要安装什么

这个项目当前技术栈包含：

- 前端：React + TypeScript + Vite
- 桌面端：Tauri 2
- 后端：Rust
- 可选组件：`.NET SDK 8+`（用于 `msrdpax` sidecar）

在一台全新的 Windows 电脑上，建议安装以下组件：

1. `Git`
2. `Node.js LTS`
3. `Rustup + Rust stable (MSVC toolchain)`
4. `Visual Studio 2022 Build Tools`
5. `Microsoft Edge WebView2 Runtime`
6. `VS Code` 或你常用的编辑器
7. `.NET SDK 8+`（如果你要构建 `msrdpax` sidecar）

---

## 2. 官方要求和建议

这部分建议基于官方文档整理：

- Tauri 2 在 Windows 开发时需要：
  - `Microsoft C++ Build Tools`
  - `Microsoft Edge WebView2`
- Rust 官方在 Windows 上推荐使用 `rustup` 安装 Rust
- Rust 在 Windows 上建议使用 `x86_64-pc-windows-msvc`
- Node.js 建议使用官方 `LTS` 版本

参考：

- Tauri prerequisites: `https://v2.tauri.app/start/prerequisites/`
- Rust install: `https://rust-lang.org/tools/install/`
- Rust Windows MSVC target: `https://doc.rust-lang.org/stable/rustc/platform-support/windows-msvc.html`
- Node.js downloads: `https://nodejs.org/en/download/`

---

## 3. 推荐安装顺序

建议按这个顺序安装，能减少环境问题：

1. 更新 Windows
2. 安装 `Git`
3. 安装 `Node.js LTS`
4. 安装 `Visual Studio 2022 Build Tools`
5. 确认 `WebView2 Runtime`
6. 安装 `Rustup`
7. 安装 `VS Code`
8. 安装 `.NET SDK 8+`
9. 重启电脑一次

---

## 4. 逐步安装

### 4.1 更新系统

先执行一次系统更新，避免后面出现 SDK 或证书问题。

操作：

1. 打开“设置”
2. 进入“Windows 更新”
3. 安装所有可用更新
4. 如果系统要求，先重启

---

### 4.2 安装 Git

用途：

- 拉取仓库
- 提交代码

如果你习惯命令行，可以用 `winget`：

```powershell
winget install --id Git.Git -e
```

安装完成后验证：

```powershell
git --version
```

---

### 4.3 安装 Node.js LTS

这个项目需要 Node 环境来运行 Vite、ESLint、Tauri CLI 等。

建议：

- 安装官方 `LTS`
- 不要装太旧的版本
- 对这个项目，优先用 `Node 20+`

如果使用 `winget`：

```powershell
winget install --id OpenJS.NodeJS.LTS -e
```

安装完成后验证：

```powershell
node -v
npm -v
```

---

### 4.4 安装 Visual Studio 2022 Build Tools

这是 Windows 下 Rust/Tauri 构建的关键依赖。

必须安装：

- `Desktop development with C++`

建议同时勾选：

- `MSVC v143`
- `Windows 10/11 SDK`
- `C++ CMake tools for Windows`

如果你已经安装了完整的 Visual Studio 2022，也可以直接使用，但必须包含上面的 C++ 组件。

安装完成后，建议重开一个 PowerShell，再执行：

```powershell
where cl
```

如果能找到 `cl.exe`，说明 C++ 编译工具链基本就绪。

---

### 4.5 确认 WebView2 Runtime

Tauri 在 Windows 上依赖 WebView2。

通常：

- Windows 10 1803+ 和 Windows 11 往往已经自带
- 但新机器或精简系统不一定完整

如果需要安装，可以从微软官方安装 WebView2 Runtime。

验证思路：

- 能正常运行其它基于 WebView2 的桌面应用
- 或者后续如果 `tauri dev` 启动时报 WebView2 相关错误，再补装

---

### 4.6 安装 Rustup 和 Rust

这个项目的 Rust 部分跑在 Tauri 后端里。

推荐安装方式：

- 使用 `rustup`
- 目标工具链使用 `MSVC`

如果使用 `winget`：

```powershell
winget install --id Rustlang.Rustup -e
```

安装后执行：

```powershell
rustup toolchain install stable-x86_64-pc-windows-msvc
rustup default stable-x86_64-pc-windows-msvc
rustc -V
cargo -V
rustup show
```

注意：

- 本项目 `src-tauri/Cargo.toml` 里声明的最低 Rust 版本是 `1.77.2`
- 使用最新稳定版通常没问题，但必须是 `MSVC`，不要切到 `GNU`

---

### 4.7 安装 VS Code

不是必须，但实际开发建议装。

建议扩展：

- `rust-analyzer`
- `ESLint`
- `Tailwind CSS IntelliSense`
- `Tauri`

如果使用 `winget`：

```powershell
winget install --id Microsoft.VisualStudioCode -e
```

---

### 4.8 安装 .NET SDK 8+

这一步不是项目基础运行必须，但如果你要构建下面这个 sidecar，就需要：

- `scripts/build-msrdpax-sidecar.ps1`
- `src-tauri/native/msrdpax-host/msrdpax-host.csproj`

注意：

- 当前 `msrdpax-host` 目标框架是 `net9.0-windows`
- 仓库已配置运行时主版本前滚，因此机器上只有 `.NET 10` 运行时也可以启动它
- 如果你本地残留的是旧构建产物，修改项目后需要重新执行一次 `npm run build:msrdpax-sidecar:debug` 或 `npm run build:msrdpax-sidecar:release`，让新的 `runtimeconfig.json` 生效

安装完成后验证：

```powershell
dotnet --version
```

如果没有 `dotnet`，构建 sidecar 时会直接失败。

---

## 5. 克隆项目并初始化

建议把代码放到一个稳定目录，比如：

```text
C:\dev\lazy-term
```

操作：

```powershell
mkdir C:\dev -ErrorAction SilentlyContinue
cd C:\dev
git clone <你的仓库地址> lazy-term
cd .\lazy-term
```

然后安装前端依赖：

```powershell
npm install
```

---

## 6. Windows 下的 LibVNCClient 额外说明

当前项目的 VNC 后端在 Windows/MSVC 下依赖你手动编译安装的 `libvncserver/libvncclient`。

推荐直接安装到下面这个默认目录：

```text
C:\dev\libvncserver\install
```

如果你使用这个默认目录，当前项目的 `src-tauri/build.rs` 会自动探测，不需要每次新开终端都手动设置环境变量。

如果你安装到其他目录，再在当前 PowerShell 中设置：

```powershell
$env:LIBVNCSERVER_ROOT='你的安装目录'
```

推荐构建步骤：

```powershell
git clone https://github.com/LibVNC/libvncserver C:\dev\libvncserver
cmake -S C:\dev\libvncserver -B C:\dev\libvncserver\build-msvc -G "Visual Studio 17 2022" -A x64 -DWITH_OPENSSL=ON -DWITH_GNUTLS=OFF -DWITH_SDL=OFF -DWITH_GTK=OFF -DWITH_EXAMPLES=OFF -DWITH_TESTS=OFF -DCMAKE_INSTALL_PREFIX=C:\dev\libvncserver\install
cmake --build C:\dev\libvncserver\build-msvc --config Release
cmake --install C:\dev\libvncserver\build-msvc --config Release
```

注意：

- 不要使用 MSYS2 `pacman` 的 `mingw` 版本库给当前 Rust `x86_64-pc-windows-msvc` 目标链接
- 如果 `npm run tauri dev` 在新终端里报找不到 `LibVNCClient`，优先检查你是否安装到了默认目录，或者是否设置了 `LIBVNCSERVER_ROOT`

```powershell
npm ci
```

说明：

- 仓库里有 `package-lock.json`
- 新机器初始化优先用 `npm ci`
- 日常新增依赖再用 `npm install`

---

## 6. 启动开发环境

### 6.1 只启动前端

```powershell
npm run dev
```

用途：

- 调试 UI
- 不依赖 Rust/Tauri 窗口

限制：

- 只能做前端层开发
- 不能验证完整桌面端行为

---

### 6.2 启动完整桌面开发环境

```powershell
npm run tauri:dev
```

这是项目日常开发的主命令。

它会：

1. 启动 Vite
2. 编译 Rust/Tauri 后端
3. 拉起桌面窗口

如果第一次启动较慢，属于正常现象。

---

## 7. 构建命令

前端构建：

```powershell
npm run build
```

桌面应用构建：

```powershell
npm run tauri:build
```

代码检查：

```powershell
npm run lint
```

可选：构建 `msrdpax` sidecar：

```powershell
npm run build:msrdpax-sidecar:debug
npm run build:msrdpax-sidecar:release
```

---

## 8. 首次验收清单

新电脑环境装完以后，至少跑一遍下面这些命令：

```powershell
git --version
node -v
npm -v
rustc -V
cargo -V
dotnet --version
npm ci
npm run lint
npm run build
npm run tauri:dev
```

如果你暂时不需要 `msrdpax` sidecar，那么 `dotnet --version` 可以不是必须项。

---

## 9. 常见问题排查

### 9.1 `cargo` 或 `rustc` 找不到

原因通常是：

- Rust 没装好
- 终端没有重新打开
- PATH 没刷新

处理：

1. 关掉当前 PowerShell
2. 重新打开终端
3. 再执行 `rustup show`

---

### 9.2 `cl.exe` 找不到

这通常说明 C++ Build Tools 没装完整。

重点检查：

- 是否安装了 `Desktop development with C++`
- 是否带上了 MSVC 和 Windows SDK

---

### 9.3 `tauri dev` 启动失败并提示 WebView2

处理：

1. 安装或修复 `Microsoft Edge WebView2 Runtime`
2. 重启系统
3. 再试 `npm run tauri:dev`

---

### 9.4 `npm ci` 失败

常见原因：

- Node 版本过旧
- 网络或代理问题
- 锁文件和 npm 版本兼容问题

先检查：

```powershell
node -v
npm -v
```

---

### 9.5 `dotnet SDK was not found`

这是 `scripts/build-msrdpax-sidecar.ps1` 里明确会抛出的错误。

处理：

- 安装 `.NET SDK 8+`
- 安装后重新打开终端
- 再执行 sidecar 构建命令

---

## 10. 建议的日常工作流

每天开发前：

```powershell
cd C:\dev\lazy-term
git pull
npm ci
npm run tauri:dev
```

如果你频繁切分支，`npm ci` 比 `npm install` 更稳。

如果只是普通同步，也可以这样：

```powershell
git pull
npm run tauri:dev
```

---

## 11. 建议的目录和工具约定

为了减少机器差异，建议统一：

- 代码目录：`C:\dev\...`
- 终端：`PowerShell 7` 或 Windows PowerShell
- Node：统一用 `LTS`
- Rust：统一用 `stable-x86_64-pc-windows-msvc`
- 包管理：统一用 `npm`

这样做的原因很直接：

- 仓库里已经提交了 `package-lock.json`
- Tauri 在 Windows 上默认走 MSVC 方案最稳
- 新机器排错时路径和工具链越统一越省时间

---

## 12. 你可以直接照抄的安装后检查脚本

如果你想快速确认环境，可以手动逐条执行下面这些命令：

```powershell
git --version
node -v
npm -v
where cl
rustc -V
cargo -V
rustup show
dotnet --version
cd C:\dev\lazy-term
npm ci
npm run lint
npm run build
```

最后再执行：

```powershell
npm run tauri:dev
```

只要这一步能把桌面应用拉起来，基础开发环境就算完成。

---

## 13. Windows 下常用的 AI Agent 工具

如果你想在这台新 Windows 电脑上把 AI agent 也一起配好，建议按下面的组合来选。

先给结论：

- 终端型 agent：适合改代码、跑命令、做项目级操作
- 编辑器型 agent：适合边看边改、局部重构、交互式修改
- 仓库托管型 agent：适合让 agent 在 PR / Issue 维度异步工作

对于这个项目，优先建议：

1. `Windows Terminal`
2. `PowerShell 7`
3. `VS Code`
4. 任选一个终端型 AI agent
5. 任选一个编辑器型 AI agent

### 13.1 基础工具

#### Windows Terminal

用途：

- 多标签终端
- 同时开多个项目会话
- 更适合搭配 AI agent 使用

安装：

```powershell
winget install --id Microsoft.WindowsTerminal -e
```

#### PowerShell 7

用途：

- 比旧版 Windows PowerShell 更现代
- 对脚本、编码和插件兼容性更好

安装：

```powershell
winget install --id Microsoft.PowerShell -e
```

建议：

- 把 `PowerShell 7` 设成 `Windows Terminal` 默认 shell

#### GitHub CLI

用途：

- 登录 GitHub
- 拉 PR / 提交 Issue / 看仓库状态
- 很多 AI 工作流最终都要和 GitHub 交互

安装：

```powershell
winget install --id GitHub.cli -e
```

验证：

```powershell
gh --version
gh auth login
```

---

### 13.2 终端型 AI agent

这类工具直接在终端里工作，适合：

- 阅读整个仓库
- 改多文件
- 跑命令
- 执行构建、测试、修复流程

#### OpenAI Codex CLI

适合：

- 终端内直接做代码代理工作
- 需要本地读写代码和执行命令

安装方式参考官方：

- OpenAI Help: `https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started`
- GitHub repo: `https://github.com/openai/codex`

文档中提到的基础安装方式是：

```powershell
npm install -g @openai/codex
```

说明：

- 适合本项目这类“前端 + Rust + Tauri”混合仓库
- 如果你习惯以终端为中心开发，它会比纯编辑器型助手更直接

#### Claude Code

适合：

- 大仓库探索
- 从命令行发起较完整的编码任务

官方资料：

- 产品页：`https://www.anthropic.com/claude-code`
- 安装文档：`https://docs.anthropic.com/en/docs/claude-code/getting-started`

官方文档给出的基础安装方式：

```powershell
npm install -g @anthropic-ai/claude-code
```

注意：

- 官方文档明确写了 Windows 10+ 可用，但通常依赖 `WSL`、`Git for Windows` 或兼容 shell
- 如果你想尽量保持“纯原生 Windows + PowerShell”路线，先确认你的工作流是否匹配

---

### 13.3 编辑器型 AI agent

这类工具适合：

- 边看代码边提问
- 选中代码做解释或重构
- 在 IDE 内完成局部修改

#### GitHub Copilot

适合：

- VS Code 内联补全
- Chat
- Agent 模式
- 和 GitHub 仓库工作流联动

官方资料：

- Docs: `https://docs.github.com/en/copilot`
- Coding agent: `https://docs.github.com/en/copilot/concepts/coding-agent/coding-agent`

建议：

- 如果你已经强依赖 GitHub，这通常是最稳的默认选项
- 对团队协作也最容易标准化

#### Cursor

适合：

- 把编辑器和 AI 工作流放在一个界面里
- 强调多文件理解和直接修改

官方下载：

- `https://cursor.com/download`

说明：

- 官方下载页显示提供 Windows 版本
- 如果你偏向“编辑器即 agent”，它是常见选择之一

#### VS Code + 其它扩展型 agent

常见思路：

- 保持 `VS Code` 为主编辑器
- 通过扩展接入 AI 能力

优点：

- 不改变原有编辑器习惯
- 迁移成本低

缺点：

- 深度代理能力通常不如终端型 agent 直接

---

### 13.4 仓库托管型 agent

这类工具不是在你本机终端里直接跑，而是在代码托管平台上异步执行任务。

#### GitHub Copilot Coding Agent

适合：

- 让 agent 基于 `Issue` 或 `PR` 工作
- 异步完成小范围改动
- 你负责审核结果

官方资料：

- `https://docs.github.com/en/copilot/concepts/coding-agent/coding-agent`

说明：

- 更适合“把任务派给 agent，然后回来 review”
- 不替代本机调试环境
- 对需要真实本地依赖和桌面 GUI 的项目，仍然要保留本机开发链路

---

### 13.5 针对这个项目的推荐组合

`lazy-term` 是一个 Windows 下的 `Tauri + Rust + React` 桌面项目，所以推荐不要把开发环境复杂化。

推荐组合 A：稳妥型

- `Windows Terminal`
- `PowerShell 7`
- `VS Code`
- `GitHub Copilot`

适合：

- 团队协作
- 低迁移成本
- 保持原生 Windows 开发流程

推荐组合 B：终端主导型

- `Windows Terminal`
- `PowerShell 7`
- `VS Code`
- `OpenAI Codex CLI`

适合：

- 你习惯在终端里推进任务
- 需要 agent 直接读写项目并执行命令

推荐组合 C：编辑器主导型

- `Windows Terminal`
- `PowerShell 7`
- `Cursor`

适合：

- 你更喜欢在单一 GUI 中完成阅读、对话和改动

不太建议一开始就这样配：

- 同时装太多 agent 并混用
- 同时启用多个会自动改代码的扩展

原因很简单：

- 出问题时很难判断是谁改的
- Windows 新机初始化阶段，先保证工具链稳定比堆功能重要

---

### 13.6 我对你这个项目的实际建议

如果你的目标是“在新 Windows 电脑上尽快稳定开始开发这个项目”，建议顺序如下：

1. 先完成本指南前 12 节的基础开发环境
2. 再安装 `Windows Terminal + PowerShell 7 + GitHub CLI`
3. 然后在下面两组里二选一

方案 1：

- `VS Code + GitHub Copilot`

方案 2：

- `VS Code + OpenAI Codex CLI`

等你确认本机 `npm run tauri:dev` 和 `npm run build` 稳定以后，再考虑是否补装更多 agent 工具。

---

## 14. Windows 下配合 AI agent 常用的命令行工具

这一节说的是类似 `jq` 这样的工具：不是 AI 产品本身，而是 AI agent 在终端里工作时常会用到的辅助工具。

建议优先安装下面这些：

1. `ripgrep (rg)`
2. `jq`
3. `fd`
4. `fzf`
5. `bat`
6. `eza`
7. `yq`
8. `delta`
9. `7zip`
10. `curl`

如果你想尽量简单，至少先装：

- `rg`
- `jq`
- `fd`
- `fzf`
- `bat`

### 14.1 `ripgrep (rg)`

用途：

- 全项目快速搜文本
- 比 `grep` 更适合大仓库
- AI agent 做代码检索时非常常用

安装：

```powershell
winget install --id BurntSushi.ripgrep.MSVC -e
```

验证：

```powershell
rg --version
```

常用示例：

```powershell
rg "TerminalView"
rg "tauri" src src-tauri
rg --files
```

### 14.2 `jq`

用途：

- 处理 JSON
- 看接口返回
- 格式化配置文件
- 过滤 `package.json`、日志、命令输出

安装：

```powershell
winget install --id jqlang.jq -e
```

验证：

```powershell
jq --version
```

常用示例：

```powershell
Get-Content package.json | jq ".scripts"
Get-Content package.json | jq ".dependencies | keys"
```

### 14.3 `fd`

用途：

- 快速找文件
- 比 `find` 更直接
- AI agent 做路径发现时很好用

安装：

```powershell
winget install --id sharkdp.fd -e
```

验证：

```powershell
fd --version
```

常用示例：

```powershell
fd package.json
fd TerminalView src
fd "\\.ts$" src
```

### 14.4 `fzf`

用途：

- 交互式筛选
- 在大量文件、历史命令、分支、搜索结果里快速选择

安装：

```powershell
winget install --id junegunn.fzf -e
```

验证：

```powershell
fzf --version
```

常见搭配：

```powershell
fd . src | fzf
rg "connector" src | fzf
git branch | fzf
```

### 14.5 `bat`

用途：

- 更适合阅读代码的 `cat`
- 带语法高亮和行号
- AI agent 输出文件内容时很常用

安装：

```powershell
winget install --id sharkdp.bat -e
```

验证：

```powershell
bat --version
```

常用示例：

```powershell
bat package.json
bat src-tauri\Cargo.toml
```

### 14.6 `eza`

用途：

- 更清晰地列目录
- 比默认 `dir` / `ls` 更适合快速看项目结构

安装：

```powershell
winget install --id eza-community.eza -e
```

验证：

```powershell
eza --version
```

常用示例：

```powershell
eza
eza -la
eza -T src
```

### 14.7 `yq`

用途：

- 处理 YAML
- 看 GitHub Actions、CI 配置、容器配置时很方便

安装：

```powershell
winget install --id MikeFarah.yq -e
```

验证：

```powershell
yq --version
```

### 14.8 `delta`

用途：

- 增强 `git diff`
- 更适合 review agent 生成的改动

安装：

```powershell
winget install --id dandavison.delta -e
```

验证：

```powershell
delta --version
```

建议配置：

```powershell
git config --global core.pager delta
git config --global interactive.diffFilter "delta --color-only"
```

### 14.9 `7zip`

用途：

- 解压各种压缩包
- 处理 SDK、离线资源、构建产物

安装：

```powershell
winget install --id 7zip.7zip -e
```

### 14.10 `curl`

用途：

- 下载文件
- 测接口
- 拉取脚本或 API 返回

Windows 新版通常自带，但建议确认一下：

```powershell
curl --version
```

---

## 15. 推荐的一次性安装命令

如果你想在新机器上一次装完这些常用工具，可以逐条执行：

```powershell
winget install --id BurntSushi.ripgrep.MSVC -e
winget install --id jqlang.jq -e
winget install --id sharkdp.fd -e
winget install --id junegunn.fzf -e
winget install --id sharkdp.bat -e
winget install --id eza-community.eza -e
winget install --id MikeFarah.yq -e
winget install --id dandavison.delta -e
winget install --id 7zip.7zip -e
```

装完后重开终端，再验证：

```powershell
rg --version
jq --version
fd --version
fzf --version
bat --version
eza --version
yq --version
delta --version
```

---

## 16. 对这个项目最有价值的工具组合

针对 `lazy-term` 这个仓库，我建议最少装这 5 个：

1. `rg`
2. `jq`
3. `fd`
4. `bat`
5. `delta`

原因：

- `rg`：查代码最快
- `jq`：看 `package.json`、JSON 输出和调试数据方便
- `fd`：找文件快
- `bat`：读代码输出更清楚
- `delta`：review 改动更直观

如果你经常在大量结果里切换，再补：

6. `fzf`

如果你经常处理 YAML 或 CI，再补：

7. `yq`
