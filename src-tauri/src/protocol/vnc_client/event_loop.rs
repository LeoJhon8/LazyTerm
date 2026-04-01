//! VNC 事件循环模块
//!
//! 提供基于 Tokio 的异步事件循环，处理 VNC 服务器消息

#![allow(dead_code)]

use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::time::interval;

use super::callbacks::CallbackEvent;
use super::client::VncClient;
use super::{VncError, VncResult};

/// 控制消息
#[derive(Debug)]
pub enum ControlMessage {
    /// 请求刷新
    RequestRefresh { full: bool },
    /// 关闭事件循环
    Shutdown,
}

/// 事件循环句柄
/// 
/// 用于与事件循环交互，发送控制命令
#[derive(Debug, Clone)]
pub struct VncEventLoopHandle {
    pub(crate) control_tx: mpsc::UnboundedSender<ControlMessage>,
}

impl VncEventLoopHandle {
    /// 请求帧缓冲区刷新
    pub fn request_refresh(&self, full: bool) {
        let _ = self.control_tx.send(ControlMessage::RequestRefresh { full });
    }

    /// 关闭事件循环
    pub fn shutdown(&self) {
        let _ = self.control_tx.send(ControlMessage::Shutdown);
    }
}

/// 启动 VNC 事件循环
/// 
/// 此函数会启动一个新的异步任务来处理 VNC 事件
/// 
/// # 参数
/// - `client`: VNC 客户端实例
/// - `event_handler`: 事件处理回调
/// 
/// # 返回
/// 返回事件循环句柄，可用于控制事件循环
pub fn start_event_loop<F>(
    client: VncClient,
    mut event_handler: F,
) -> (VncEventLoopHandle, oneshot::Receiver<VncResult<()>>)
where
    F: FnMut(CallbackEvent) + Send + 'static,
{
    let (control_tx, mut control_rx) = mpsc::unbounded_channel::<ControlMessage>();
    let (result_tx, result_rx) = oneshot::channel::<VncResult<()>>();

    let handle = VncEventLoopHandle { control_tx };

    // 启动事件循环任务
    tokio::spawn(async move {
        let result = run_event_loop(client, &mut control_rx, &mut event_handler).await;
        let _ = result_tx.send(result);
    });

    (handle, result_rx)
}

/// 运行事件循环
async fn run_event_loop<F>(
    client: VncClient,
    control_rx: &mut mpsc::UnboundedReceiver<ControlMessage>,
    _event_handler: &mut F,
) -> VncResult<()>
where
    F: FnMut(CallbackEvent) + Send,
{
    // 初始请求完整刷新
    let _ = client.request_update(0, 0, 4096, 4096, false).await;

    // 创建定期刷新间隔
    let mut refresh_interval = interval(Duration::from_millis(1000));
    refresh_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    // 创建快照定时器
    let mut pending_full_refresh = true;

    loop {
        tokio::select! {
            // 处理控制消息
            Some(control) = control_rx.recv() => {
                match control {
                    ControlMessage::RequestRefresh { full } => {
                        pending_full_refresh = pending_full_refresh || full;
                    }
                    ControlMessage::Shutdown => {
                        break;
                    }
                }
            }

            // 定期刷新
            _ = refresh_interval.tick() => {
                let incremental = !pending_full_refresh;
                if let Err(e) = client.request_update(0, 0, 4096, 4096, incremental).await {
                    // 连接已关闭，退出循环
                    if matches!(e, VncError::SessionClosed) {
                        break;
                    }
                    return Err(e);
                }
                pending_full_refresh = false;
            }

            // 处理服务器消息
            result = client.handle_message() => {
                match result {
                    Ok(true) => {}
                    Ok(false) => {
                        // 无消息，继续
                    }
                    Err(VncError::SessionClosed) => {
                        break;
                    }
                    Err(e) => {
                        return Err(e);
                    }
                }
            }
        }
    }

    // 关闭客户端
    client.close().await;

    Ok(())
}

/// 简化的同步事件处理（用于非 Tokio 环境）
pub struct SyncEventLoop {
    client: VncClient,
}

impl SyncEventLoop {
    /// 创建新的同步事件循环
    pub fn new(client: VncClient) -> Self {
        Self { client }
    }

    /// 运行一次事件处理迭代
    /// 
    /// 返回 `Ok(true)` 表示处理了消息，`Ok(false)` 表示无消息
    pub async fn poll(&self) -> VncResult<bool> {
        self.client.handle_message().await
    }

    /// 请求刷新
    pub async fn request_refresh(&self, full: bool) -> VncResult<()> {
        self.client.request_update(0, 0, 4096, 4096, !full).await
    }

    /// 关闭
    pub async fn close(self) {
        self.client.close().await;
    }
}
