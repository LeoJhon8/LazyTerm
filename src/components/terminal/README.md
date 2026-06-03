# 终端视图组件架构

## 概述

本目录包含 Lazy Term 的所有会话视图组件，采用**模板方法模式（Template Method Pattern）**进行设计。

## 架构设计

### 类图

```
┌─────────────────────────────────────────────────────────────────┐
│                    BaseSessionView (抽象基类)                     │
├─────────────────────────────────────────────────────────────────┤
│  + useBaseSessionView(props): BaseSessionViewResult              │
│  # useBaseViewLogic(props): BaseSessionViewResult                │
│  # renderWrapper(result, props): ReactElement                    │
│  # renderContent(result, props): ReactNode     [抽象方法]         │
│  # getViewType(): string                       [抽象方法]         │
│  # getContainerClassName(): string                               │
└─────────────────────────────────────────────────────────────────┘
                              △
                              │ 继承
          ┌───────────────────┼───────────────────┐
          │                   │                   │
┌─────────┴────────┐ ┌────────┴─────────┐ ┌──────┴──────────┐
│ TerminalViewClass │ │ RemoteDesktopViewClass│ │ VncViewClass     │
├───────────────────┤ ├──────────────────┤ ├─────────────────┤
│ 实现 renderContent │ │ 实现 renderContent│ │ 实现 renderContent│
│ 返回: xterm 终端   │ │ 返回: Canvas RDP  │ │ 返回: Canvas VNC │
└───────────────────┘ └──────────────────┘ └─────────────────┘
```

### 核心概念

#### 1. 模板方法模式

`BaseSessionView` 定义了一个**模板方法** `render()`，它规定了视图渲染的算法骨架：

```typescript
// 模板方法（父类定义，子类不应覆盖）
public render(props: BaseSessionViewProps): React.ReactElement | null {
  const baseResult = this.useBaseViewLogic(props);  // 步骤1: 获取基础状态
  return this.renderWrapper(baseResult, props);      // 步骤2: 包装渲染
}
```

#### 2. 抽象方法

子类必须实现以下抽象方法：

- `renderContent(result, props)`: 渲染视图的具体内容
- `getViewType()`: 返回视图类型标识（如 `"terminal"`, `"rdp"`, `"vnc"`）

#### 3. Hook 模式

由于 React 函数组件不支持类的继承，我们使用 **Hook 组合** 来模拟抽象类：

```typescript
// 子组件调用基类 Hook
function TerminalViewClass(props: BaseSessionViewProps) {
  const baseResult = useBaseSessionView(props);  // 获取通用状态
  
  // 子类特有的逻辑...
  
  // 实现 renderContent
  return (
    <main className={...} data-view-type="terminal">
      {/* 具体渲染内容 */}
    </main>
  );
}
```

## 文件结构

```
src/components/terminal/
├── BaseSessionView.tsx           # 抽象基类，定义模板方法和共享资源
├── BaseGraphicSessionView.tsx    # 图形化视图抽象子类（RDP/VNC 共用）
├── TerminalViewClass.tsx         # 终端视图（SSH/本地）
├── RemoteDesktopViewClass.tsx    # RDP 远程桌面视图
├── VncViewClass.tsx              # VNC 桌面视图
├── NativeRdpHostView.tsx         # Native RDP 宿主视图
├── index.ts                      # 统一导出
└── README.md                     # 架构文档
```

## 继承层次

```
BaseSessionView (基础抽象类)
    │
    ├── TerminalViewClass (终端视图)
    │
    └── BaseGraphicSessionView (图形化抽象子类)
            │
            ├── RemoteDesktopViewClass (RDP 视图)
            └── VncViewClass (VNC 视图)
```

## 文件说明

| 文件 | 职责 |
|------|------|
| `BaseSessionView.tsx` | 抽象基类，定义模板方法、公共 Hook、共享组件和工具函数 |
| `TerminalViewClass.tsx` | 终端视图，使用 xterm.js 渲染 SSH/本地终端 |
| `RemoteDesktopViewClass.tsx` | RDP 视图，使用 Canvas 渲染远程桌面（FreeRDP + Native） |
| `VncViewClass.tsx` | VNC 视图，使用 Canvas 渲染 VNC 桌面 |
| `NativeRdpHostView.tsx` | Native RDP 宿主视图，用于托管 Win32 sidecar 窗口 |
| `index.ts` | 统一导出所有组件和工具 |

## 使用方法

### 基础使用

```tsx
import { TerminalViewClass } from "@/components/terminal";

function MyComponent() {
  return (
    <TerminalViewClass 
      paneId="pane-1" 
      sessionId="session-123"
    />
  );
}
```

### 添加新的视图类型

1. 创建新文件，如 `SftpViewClass.tsx`
2. 调用 `useBaseSessionView(props)` 获取基础状态
3. 实现 `renderContent` 逻辑
4. 返回带有 `data-view-type` 属性的 main 元素

```tsx
export function SftpViewClass(props: BaseSessionViewProps) {
  const baseResult = useBaseSessionView(props);
  const { session, sessionTitle } = baseResult;
  
  // SFTP 特有逻辑...
  
  return (
    <main 
      className="terminal-container ..."
      data-view-type="sftp"
      data-session-id={props.sessionId}
      data-pane-id={props.paneId}
    >
      {/* SFTP 文件浏览器 UI */}
    </main>
  );
}
```

## 共享组件

`BaseSessionView` 提供了一些共享的 UI 组件：

- `ConnectionStatusBadge`: 连接状态徽章
- `DisconnectedBanner`: 断开连接提示横幅
- `LoadingPlaceholder`: 加载中占位组件
- `TransitionMask`: 过渡遮罩

## 共享工具函数和常量

### 基础工具（BaseSessionView）
- `clamp(value, min, max)`: 限制数值在指定范围内

### 样式常量
- `VIEW_CONTAINER_CLASSNAME`: 视图主容器样式
- `CANVAS_CLASSNAME`: Canvas 元素可见时的样式
- `HIDDEN_CLASSNAME`: 隐藏元素样式
- `INTERACTIVE_CONTAINER_CLASSNAME`: 交互层容器样式

### 图形化工具（BaseGraphicSessionView）

#### Hook
- `useBaseGraphicSessionView(props)`: 图形化视图通用 Hook
  - `canvasRef`: Canvas 引用
  - `containerRef`: 容器引用
  - `frameSize`: 帧尺寸状态
  - `setFrameSize`: 设置帧尺寸
  - `notifyVisualReady`: 视觉就绪通知
  - `renderRgbaFrame`: 渲染 RGBA 帧到 Canvas
  - `renderBlobFrame`: 渲染 Blob 帧到 Canvas（JPEG/PNG）

#### 键盘映射
- `RDP_SCANCODE_MAP`: RDP 扫描码映射表
- `VNC_KEYSYM_MAP`: VNC Keysym 映射表
- `getRdpScancode(event)`: 获取 RDP 扫描码
- `mapVncKeyboardEvent(event)`: 映射 VNC 键盘事件

#### 指针位置计算
- `getPointerPositionCentered`: 居中缩放模式的指针位置计算
- `getPointerPositionScaled`: 填充模式的指针位置计算

#### 光标样式
- `buildCursorStyleFromRgba`: 从 RGBA 数据构建光标样式

## 使用示例

### 基础视图
```typescript
import { 
  VIEW_CONTAINER_CLASSNAME,
  useBaseSessionView
} from "./BaseSessionView";

function MyView(props) {
  const { session, notifyVisualReady } = useBaseSessionView(props);
  
  return (
    <main className={VIEW_CONTAINER_CLASSNAME}>
      {/* 视图内容 */}
    </main>
  );
}
```

### 图形化视图
```typescript
import { 
  useBaseGraphicSessionView,
  getPointerPositionCentered,
  getRdpScancode
} from "./BaseGraphicSessionView";

function MyGraphicView(props) {
  const {
    canvasRef,
    containerRef,
    frameSize,
    renderRgbaFrame,
    renderBlobFrame
  } = useBaseGraphicSessionView(props);
  
  // 处理鼠标事件
  const handleMouseMove = (event) => {
    const point = getPointerPositionCentered(
      containerRef.current,
      { desktopWidth: frameSize.width, desktopHeight: frameSize.height },
      event.clientX,
      event.clientY
    );
    // 发送指针事件...
  };
  
  // 处理键盘事件
  const handleKeyDown = (event) => {
    const scancode = getRdpScancode(event);
    if (scancode) {
      // 发送键盘事件...
    }
  };
  
  return (
    <main className={VIEW_CONTAINER_CLASSNAME}>
      <canvas ref={canvasRef} />
    </main>
  );
}
```

## 设计优势

1. **代码复用**: 通用逻辑（状态管理、事件处理）集中在基类
2. **结构统一**: 所有视图遵循相同的渲染流程
3. **易于扩展**: 添加新视图类型只需实现抽象方法
4. **类型安全**: TypeScript 确保子类实现所有必需方法
5. **测试友好**: 可以独立测试基类逻辑和子类渲染
