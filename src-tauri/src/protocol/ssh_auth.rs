//! SSH 认证模块
//! 提供共享的 SSH 认证函数，消除 commands.rs 中的重复代码

use async_trait::async_trait;
use russh::client;
use russh_keys::key;
use std::sync::Arc;
use std::time::Duration;

use crate::types::SshConnectConfig;

/// SSH 客户端处理器
#[derive(Clone)]
pub struct SshClientHandler;

impl SshClientHandler {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // 接受所有服务器密钥（生产环境应实现密钥指纹验证）
        Ok(true)
    }

    async fn disconnected(&mut self, _reason: client::DisconnectReason<Self::Error>) -> Result<(), Self::Error> {
        // 连接断开处理
        Ok(())
    }
}

/// 加载 SSH 私钥
/// 
/// 注意：russh_keys 0.45+ 使用 decode_secret_key 而不是 from_openssh
pub async fn load_ssh_key(path: &str, passphrase: Option<String>) -> Result<key::KeyPair, String> {
    let path = std::path::Path::new(path);
    
    if !path.exists() {
        return Err(format!("私钥文件不存在: {}", path.display()));
    }

    let key_content = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("读取私钥文件失败: {}", e))?;

    // decode_secret_key 支持: OpenSSH, PKCS#1, PKCS#8 以及多种加密算法
    russh_keys::decode_secret_key(&key_content, passphrase.as_deref())
        .map_err(|e| format!("私钥解析失败: {:?}. 请检查格式或密码。", e))
}

/// 使用私钥认证
async fn authenticate_with_key(
    handle: &mut client::Handle<SshClientHandler>,
    username: &str,
    key_path: &str,
    passphrase: Option<String>,
) -> Result<(), String> {
    let key_pair = load_ssh_key(key_path, passphrase).await?;
    
    let auth_result = handle
        .authenticate_publickey(username.to_string(), Arc::new(key_pair))
        .await
        .map_err(|e| format!("私钥认证请求失败: {}", e))?;

    if auth_result {
        Ok(())
    } else {
        Err("私钥认证被拒绝".to_string())
    }
}

// 以下函数暂时未被使用，但保留供将来扩展
#[allow(dead_code)]
/// 使用密码认证
async fn authenticate_with_password(
    handle: &mut client::Handle<SshClientHandler>,
    username: &str,
    password: &str,
) -> Result<(), String> {
    let auth_result = handle
        .authenticate_password(username.to_string(), password)
        .await
        .map_err(|e| format!("密码认证请求失败: {}", e))?;

    if auth_result {
        Ok(())
    } else {
        Err("密码认证被拒绝".to_string())
    }
}

/// 执行完整的 SSH 认证（多策略）
/// 
/// 认证策略优先级：
/// 1. 如果提供了私钥路径，先尝试私钥认证
/// 2. 如果私钥认证失败或没有私钥，尝试 keyboard-interactive（支持多轮交互）
/// 3. 如果 keyboard-interactive 失败且有密码，尝试密码认证
/// 
/// 注意：此函数会记录日志到应用日志系统
pub async fn authenticate_ssh(
    handle: &mut client::Handle<SshClientHandler>,
    config: &SshConnectConfig,
) -> Result<(), String> {
    use crate::logging;
    
    let username = &config.username;
    let mut authenticated = false;

    // 策略 1: 私钥认证
    if let Some(ref key_path) = config.private_key_path {
        logging::info("SSH/auth", format!("尝试私钥认证: {key_path}"));
        match authenticate_with_key(handle, username, key_path, config.private_key_passphrase.clone()).await {
            Ok(()) => {
                logging::info("SSH/auth", "私钥认证成功");
                authenticated = true;
            }
            Err(e) => {
                logging::warn("SSH/auth", format!("私钥认证失败: {e}"));
            }
        }
    }

    // 策略 2 & 3: keyboard-interactive -> 密码认证
    if !authenticated {
        if let Some(ref password) = config.password {
            authenticated = authenticate_keyboard_interactive_then_password(
                handle,
                username,
                password,
            ).await?;
        }
    }

    if authenticated {
        Ok(())
    } else {
        logging::warn("SSH/auth", "所有认证方式均已尝试，认证失败");
        Err("SSH 认证失败：密钥或密码错误".to_string())
    }
}

/// Keyboard-interactive 认证，失败时回退到密码认证
/// 
/// 这是 commands.rs 中的实际逻辑，支持多轮交互
async fn authenticate_keyboard_interactive_then_password(
    handle: &mut client::Handle<SshClientHandler>,
    username: &str,
    password: &str,
) -> Result<bool, String> {
    use crate::logging;
    
    logging::info("SSH/auth", "开始 Keyboard-Interactive 认证");

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let kbd_start_res = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        handle.authenticate_keyboard_interactive_start(username.to_string(), None),
    )
    .await;

    let kbd_start_enum = match kbd_start_res {
        Ok(Ok(res)) => Some(res),
        _ => None,
    };

    let mut kbd_authenticated = false;
    let mut should_fallback_to_password = false;

    if let Some(res) = kbd_start_enum {
        let mut current_kbd_res = Ok(res);
        for i in 0..5 {
            match current_kbd_res {
                Ok(client::KeyboardInteractiveAuthResponse::Success) => {
                    logging::info("SSH/auth", "Keyboard-Interactive 认证成功");
                    kbd_authenticated = true;
                    break;
                }
                Ok(client::KeyboardInteractiveAuthResponse::InfoRequest { prompts, name, .. }) => {
                    logging::info(
                        "SSH/auth",
                        format!("收到交互请求: round={} name='{}' prompts={}", i + 1, name, prompts.len()),
                    );
                    let mut responses = Vec::new();
                    for _p in prompts.iter() {
                        responses.push(password.to_string());
                    }
                    current_kbd_res = handle.authenticate_keyboard_interactive_respond(responses).await;
                }
                Ok(client::KeyboardInteractiveAuthResponse::Failure) => {
                    logging::warn("SSH/auth", "Keyboard-Interactive 被拒绝，切换密码认证");
                    should_fallback_to_password = true;
                    break;
                }
                Err(e) => {
                    logging::warn("SSH/auth", format!("Keyboard-Interactive 流程错误: {e:?}"));
                    should_fallback_to_password = true;
                    break;
                }
            }
        }
    } else {
        logging::warn("SSH/auth", "Keyboard-Interactive 启动失败或超时，尝试标准密码认证");
        should_fallback_to_password = true;
    }

    if kbd_authenticated {
        Ok(true)
    } else if should_fallback_to_password {
        logging::info("SSH/auth", "开始标准密码认证");
        match handle.authenticate_password(username.to_string(), password.to_string()).await {
            Ok(true) => {
                logging::info("SSH/auth", "标准密码认证成功");
                Ok(true)
            }
            Ok(false) => {
                logging::warn("SSH/auth", "标准密码认证被服务器拒绝");
                Ok(false)
            }
            Err(e) => {
                logging::warn("SSH/auth", format!("标准密码认证出错: {e:?}"));
                Ok(false)
            }
        }
    } else {
        Ok(false)
    }
}

/// 创建 SSH 客户端配置
pub fn create_ssh_client_config() -> client::Config {
    client::Config {
        inactivity_timeout: Some(Duration::from_secs(300)),
        ..Default::default()
    }
}

/// 建立 SSH 连接并认证
pub async fn connect_and_authenticate(
    config: &SshConnectConfig,
) -> Result<client::Handle<SshClientHandler>, String> {
    let client_config = create_ssh_client_config();
    let client_handler = SshClientHandler::new();

    let mut handle = client::connect(
        Arc::new(client_config),
        (config.host.as_str(), config.port),
        client_handler,
    )
    .await
    .map_err(|e| format!("连接失败: {}", e))?;

    authenticate_ssh(&mut handle, config).await?;

    Ok(handle)
}
