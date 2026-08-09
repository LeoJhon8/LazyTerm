//! 异步 VNC 客户端外观。
//!
//! 所有 LibVNCClient 原生调用都由 `io_actor` 的单一专属线程执行；本模块只负责参数校验、
//! 有界命令排队以及异步响应。

use parking_lot::Mutex;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};

use super::callbacks::CallbackEvent;
use super::frame::FrameUpdateRegion;
use super::io_actor::{spawn_vnc_io_actor, VncActorShared, VncIoCommand};
use super::{MouseButton, VncEncoding, VncError, VncResult};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum VncConnectionState {
    Disconnected,
    Connecting,
    Authenticating,
    Connected,
    Error,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct VncClientConfig {
    pub host: String,
    pub port: u16,
    pub password: Option<String>,
    pub shared: bool,
    pub view_only: bool,
    pub allow_jpeg: bool,
    pub use_remote_cursor: bool,
    pub handle_new_fb_size: bool,
    pub connect_timeout_secs: u32,
    pub read_timeout_secs: u32,
    pub jpeg_quality: u8,
    pub compression_level: u8,
    pub encodings: Vec<VncEncoding>,
}

impl Default for VncClientConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 5900,
            password: None,
            shared: true,
            view_only: false,
            allow_jpeg: true,
            use_remote_cursor: false,
            handle_new_fb_size: true,
            connect_timeout_secs: 15,
            read_timeout_secs: 30,
            jpeg_quality: 8,
            compression_level: 6,
            encodings: vec![
                VncEncoding::CopyRect,
                VncEncoding::Hextile,
                VncEncoding::Rre,
                VncEncoding::Raw,
            ],
        }
    }
}

pub struct VncClient {
    config: VncClientConfig,
    shared: Arc<VncActorShared>,
    command_tx: Mutex<Option<mpsc::Sender<VncIoCommand>>>,
}

impl VncClient {
    pub fn new(config: VncClientConfig) -> Self {
        Self {
            config,
            shared: Arc::new(VncActorShared::new()),
            command_tx: Mutex::new(None),
        }
    }

    pub async fn connect(&self) -> VncResult<mpsc::UnboundedReceiver<CallbackEvent>> {
        let current = *self.shared.state.read();
        if current != VncConnectionState::Disconnected {
            return Err(VncError::InvalidStateTransition {
                current: format!("{current:?}"),
                target: "Connecting".to_string(),
            });
        }

        let (command_tx, event_rx) =
            spawn_vnc_io_actor(self.config.clone(), Arc::clone(&self.shared)).await?;
        *self.command_tx.lock() = Some(command_tx);
        Ok(event_rx)
    }

    async fn request<T>(
        &self,
        build: impl FnOnce(oneshot::Sender<VncResult<T>>) -> VncIoCommand,
    ) -> VncResult<T>
    where
        T: Send + 'static,
    {
        if self.shared.closed.load(Ordering::SeqCst) {
            return Err(VncError::SessionClosed);
        }

        let command_tx = self
            .command_tx
            .lock()
            .clone()
            .ok_or(VncError::SessionClosed)?;
        let (reply_tx, reply_rx) = oneshot::channel();
        command_tx
            .send(build(reply_tx))
            .await
            .map_err(|_| VncError::SessionClosed)?;
        reply_rx.await.map_err(|_| VncError::SessionClosed)?
    }

    pub async fn send_pointer(&self, x: u16, y: u16, buttons: &[MouseButton]) -> VncResult<()> {
        let button_mask = buttons
            .iter()
            .fold(0, |mask, button| mask | button.to_mask()) as u8;
        self.send_pointer_raw(x, y, button_mask).await
    }

    pub async fn send_pointer_raw(&self, x: u16, y: u16, button_mask: u8) -> VncResult<()> {
        self.request(|reply| VncIoCommand::Pointer {
            x,
            y,
            button_mask,
            reply,
        })
        .await
    }

    pub async fn send_key(&self, keysym: u32, down: bool) -> VncResult<()> {
        self.request(|reply| VncIoCommand::Key {
            keysym,
            down,
            reply,
        })
        .await
    }

    pub async fn send_key_sequence(&self, key_syms: Vec<u32>) -> VncResult<()> {
        const MAX_SEQUENCE_LENGTH: usize = 16;
        if key_syms.is_empty() || key_syms.len() > MAX_SEQUENCE_LENGTH {
            return Err(VncError::ProtocolError(format!(
                "Key sequence length must be between 1 and {MAX_SEQUENCE_LENGTH}"
            )));
        }

        self.request(|reply| VncIoCommand::KeySequence { key_syms, reply })
            .await
    }

    pub async fn paste_clipboard(
        &self,
        text: String,
        key_sym: u32,
        modifier_key_syms: Vec<u32>,
    ) -> VncResult<()> {
        const MAX_CLIPBOARD_BYTES: usize = 1024 * 1024;
        if text.len() > MAX_CLIPBOARD_BYTES {
            return Err(VncError::ProtocolError(format!(
                "Clipboard text exceeds {MAX_CLIPBOARD_BYTES} byte limit"
            )));
        }

        self.request(|reply| VncIoCommand::PasteClipboard {
            text,
            key_sym,
            modifier_key_syms,
            reply,
        })
        .await
    }

    pub async fn type_text(&self, text: String, modifier_key_syms: Vec<u32>) -> VncResult<()> {
        const MAX_TEXT_BYTES: usize = 16 * 1024;
        if text.len() > MAX_TEXT_BYTES {
            return Err(VncError::ProtocolError(format!(
                "Text input exceeds {MAX_TEXT_BYTES} byte limit"
            )));
        }

        let key_syms = text
            .chars()
            .map(|character| match character {
                '\n' | '\r' => 0xff0d,
                '\t' => 0xff09,
                ' '..='\u{ff}' => character as u32,
                _ => 0x0100_0000 | character as u32,
            })
            .collect();

        self.request(|reply| VncIoCommand::TypeText {
            key_syms,
            modifier_key_syms,
            reply,
        })
        .await
    }

    pub async fn request_update(
        &self,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        incremental: bool,
    ) -> VncResult<()> {
        if width == 0 || height == 0 {
            return Err(VncError::ProtocolError(
                "Framebuffer update dimensions must be non-zero".to_string(),
            ));
        }

        self.request(|reply| VncIoCommand::RequestUpdate {
            x,
            y,
            width,
            height,
            incremental,
            reply,
        })
        .await
    }

    /// 请求服务端调整桌面尺寸。返回 false 表示服务端尚未声明 ExtendedDesktopSize 能力。
    pub async fn resize_desktop(&self, width: u16, height: u16) -> VncResult<bool> {
        let pixel_count = usize::from(width).saturating_mul(usize::from(height));
        if width < 200
            || height < 200
            || width > 8192
            || height > 8192
            || pixel_count > 32 * 1024 * 1024
        {
            return Err(VncError::ProtocolError(
                "Desktop dimensions are outside the supported safety limits".to_string(),
            ));
        }

        self.request(|reply| VncIoCommand::ResizeDesktop {
            width,
            height,
            reply,
        })
        .await
    }

    pub fn framebuffer_size(&self) -> (u16, u16) {
        self.shared.framebuffer.size()
    }

    pub fn snapshot_rgba(&self) -> (u16, u16, Vec<u8>) {
        self.shared.framebuffer.snapshot_rgba()
    }

    pub fn snapshot_region_rgba(&self, region: FrameUpdateRegion) -> Option<Vec<u8>> {
        self.shared.framebuffer.snapshot_region_rgba(region)
    }

    #[allow(dead_code)]
    pub fn state(&self) -> VncConnectionState {
        *self.shared.state.read()
    }

    pub async fn close(&self) {
        if self.shared.closed.swap(true, Ordering::SeqCst) {
            return;
        }

        let command_tx = self.command_tx.lock().take();
        if let Some(command_tx) = command_tx {
            let _ = command_tx.send(VncIoCommand::Close).await;
        }
    }
}

impl Drop for VncClient {
    fn drop(&mut self) {
        if self.shared.closed.swap(true, Ordering::SeqCst) {
            return;
        }

        if let Some(command_tx) = self.command_tx.get_mut().take() {
            let _ = command_tx.try_send(VncIoCommand::Close);
        }
    }
}
