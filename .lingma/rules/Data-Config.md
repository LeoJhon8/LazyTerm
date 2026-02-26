---
trigger: always_on
---
# Configuration & Persistence
- **格式支持**:原生支持 `.yaml` 和 `.json`。YAML 优先（对懒人阅读更友好）。
- **静默导入 (Silent Import)**:
  - 当检测到新配置文件导入时,直接热重载(Hot-Reload)界面。
  - **禁止弹出配置预览窗**:直接应用新布局和按钮。
- **配置项内容**:
  - `sessions`: 包含名称、主机、图标、颜色。
  - `shortcuts`: 包含标签、命令字符串、执行模式（立即执行/仅填入）。
  - `layout`: 包含各区域的 `width/height` 和 `position_map`。