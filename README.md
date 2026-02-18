# Lazy Terminal

一个使用 Electron 构建的基础桌面终端应用。

## 功能特性

- 现代化终端界面
- 支持命令历史记录（上下箭头导航）
- 支持键盘快捷键（Ctrl+C 清空输入）
- 内置命令：`help`, `clear`, `history`, `exit`
- 执行系统命令
- 响应式设计，支持窗口缩放

## 项目结构

```
lazy-terminal/
├── src/
│   ├── main/
│   │   ├── index.js       # Electron 主进程入口
│   │   └── preload.js     # 预加载脚本（IPC 暴露）
│   └── renderer/
│       ├── index.html     # 渲染进程 HTML
│       ├── styles.css     # 终端样式
│       └── terminal.js    # 终端逻辑
├── node_modules/
├── package.json           # 项目配置
└── .npmrc                # npm 配置
```

## 安装

1. 克隆项目
2. 安装依赖：
   ```bash
   npm install
   ```
   > 注意：如果 Electron 下载失败，确保 `.npmrc` 文件存在，或者设置环境变量：
   ```bash
   export ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/
   npm install
   ```

## 运行

启动应用：
```bash
npm start
```

开发模式（打开开发者工具）：
```bash
npm run dev
```

## 使用说明

### 内置命令

- `help` - 显示帮助信息
- `clear` 或 `cls` - 清空终端屏幕
- `history` - 显示命令历史
- `exit` - 退出提示

### 快捷键

- **Enter** - 执行命令
- **↑ / ↓** - 浏览命令历史
- **Ctrl + C** - 清空当前输入
- **Focus** - 点击终端区域即可聚焦输入框

### 系统命令

可以执行任何系统命令，例如：
- Windows: `dir`, `echo`, `ipconfig`
- macOS/Linux: `ls`, `echo`, `ifconfig`

## 开发计划

- [ ] 支持多标签页
- [ ] 命令自动补全
- [ ] 主题切换
- [ ] 自定义快捷键
- [ ] 命令别名
- [ ] 环境变量支持

## 许可证

MIT
