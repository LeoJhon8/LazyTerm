# 统一连接状态设计

## 目标

为本地终端、SSH、Telnet、串口、AI CLI、RDP 和 VNC 建立同一套连接生命周期，使 Store 成为唯一状态源，统一断开、失败和手动重连行为。

## 状态模型

状态阶段为 `idle`、`connecting`、`authenticating`、`connected`、`reconnecting`、`disconnected`、`failed`、`closing`。每个会话记录原因、技术详情、状态变更时间、首次连接时间和连接尝试次数。

## 职责

Connector 上报协议事实，不决定 UI 行为。`tabs.ts` 订阅 Connector 状态并更新 Session；本地终端异常退出后自动重建，其他协议保持当前输出或最后画面并提供手动重连。视图只读取 Session 状态，首帧加载和尺寸同步仍属于视觉状态。

## 行为变化

- 删除 SSH 断开后自动切换到本地终端。
- 删除串口专用断开集合。
- 所有终端协议共用断开和失败提示。
- RDP/VNC/Native RDP 使用统一状态决定覆盖层。
- 标签页使用低干扰颜色点显示连接状态。
- 本阶段不实现网络恢复自动重连和持久化诊断历史。

## 验证

遵循项目规则，不创建或运行测试代码。使用 `tsc --noEmit`、`cargo check` 和代码审查验证。
