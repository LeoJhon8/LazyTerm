---
trigger: always_on
---
# Technical Requirements
- **Core Framework**: `Ink` (React-based CLI) 用于响应式布局。
- **Layout Manager**: 使用 `yoga-layout` (Flexbox) 实现圣杯布局的动态伸缩。
- **Mouse Handling**: 
  - 使用 `term-mouse` 监听坐标。
  - 区域边界判定：定义 X/Y 轴坐标区间，识别鼠标处于“拖拽区”还是“点击区”。
- **State Persistence**: 只有在用户点击“Save Layout”或拖拽结束时,才将新的 `dimensions` 写入配置文件。
- **Terminal Emulator**: 集成 `xterm.js` 的终端渲染逻辑和 `node-pty`。
- 不要创建测试js文件