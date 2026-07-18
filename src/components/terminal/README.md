# 终端视图组件架构

## 概述

本目录包含 LazyTerm 的会话视图。视图均为 React 函数组件，由 `PaneView` 在确认面板和会话有效后按协议选择渲染。

## 渲染流程

1. `PaneContainer` 在没有面板树时显示品牌欢迎页。
2. `PaneView` 校验面板与会话，并按会话类型选择具体视图。
3. `TerminalViewClass` 渲染 SSH、本地终端、串口、Telnet 和 AI CLI。
4. `RemoteDesktopViewClass` 与 `VncViewClass` 渲染图形会话。
5. 会话视图遇到瞬时失效状态时返回 `null`，不再渲染重复的空状态页面。

## 文件结构

```text
src/components/terminal/
├── BaseSessionView.tsx           # 通用 props、样式常量和工具函数
├── BaseGraphicSessionView.tsx    # RDP/VNC 共用的 Canvas 与输入工具
├── TerminalViewClass.tsx         # 终端视图
├── RemoteDesktopViewClass.tsx    # RDP 远程桌面视图
├── VncViewClass.tsx              # VNC 桌面视图
├── NativeRdpHostView.tsx         # Native RDP 宿主视图
├── ConnectionStatusOverlay.tsx   # 连接状态遮罩
├── SessionTransitionMask.tsx     # 画面过渡遮罩
└── index.ts                      # 统一导出
```

## 共享能力

`BaseSessionView.tsx` 提供：

- `BaseSessionViewProps`
- `clamp`
- `VIEW_CONTAINER_CLASSNAME`
- `CANVAS_CLASSNAME`
- `HIDDEN_CLASSNAME`
- `INTERACTIVE_CONTAINER_CLASSNAME`

`BaseGraphicSessionView.tsx` 提供：

- `useBaseGraphicSessionView`：管理 Canvas、帧尺寸、图像渲染与视觉就绪通知。
- RDP 扫描码和 VNC Keysym 映射。
- RDP/VNC 指针坐标换算。
- VNC 光标样式生成。

## 添加新视图

1. 创建函数组件并接收 `BaseSessionViewProps`。
2. 从会话 Store 获取与 `sessionId` 对应的会话和连接器。
3. 无有效会话或连接器时返回 `null`。
4. 使用共享容器样式，并设置 `data-view-type`、`data-session-id` 和 `data-pane-id`。
5. 在 `PaneView` 中添加会话类型分发，并从 `index.ts` 导出。

```tsx
export function ExampleView({ paneId, sessionId }: BaseSessionViewProps) {
  const session = useTabsStore((state) =>
    state.sessions.find((item) => item.id === sessionId)
  );

  if (!session) return null;

  return (
    <main
      className={VIEW_CONTAINER_CLASSNAME}
      data-view-type="example"
      data-session-id={sessionId}
      data-pane-id={paneId}
    >
      {/* 视图内容 */}
    </main>
  );
}
```
