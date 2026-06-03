//! SSH 认证模块
//! 提供共享的 SSH 认证函数，消除 commands.rs 中的重复代码

use russh::client;
use russh::keys::known_hosts::{check_known_hosts, known_host_keys, learn_known_hosts};
use russh::keys::{self, PrivateKey, PrivateKeyWithHashAlg, PublicKey};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use crate::types::SshConnectConfig;

pub fn build_ssh_client_config(config: &SshConnectConfig) -> client::Config {
    let keepalive_interval = effective_keepalive_interval(config);

    crate::logging::info(
        "SSH/config",
        format!(
            "{}:{} effective keepalive interval: {}",
            config.host,
            config.port,
            keepalive_interval
                .map(|duration| format!("{}s", duration.as_secs()))
                .unwrap_or_else(|| "disabled".to_string())
        ),
    );

    client::Config {
        inactivity_timeout: None,
        keepalive_interval,
        ..Default::default()
    }
}

fn effective_keepalive_interval(config: &SshConnectConfig) -> Option<Duration> {
    if config.keep_alive != Some(true) {
        return None;
    }

    Some(Duration::from_secs(
        config.keep_alive_interval.unwrap_or(60).max(1),
    ))
}

/// SSH 客户端处理器
#[derive(Clone)]
pub struct SshClientHandler {
    host: String,
    port: u16,
}

impl SshClientHandler {
    pub fn new(host: String, port: u16) -> Self {
        Self { host, port }
    }

    /// 验证并更新 known_hosts 文件
    ///
    /// 策略：
    /// 1. 密钥匹配 → 接受
    /// 2. 首次连接（未记录）→ 记录密钥并接受（Trust On First Use）
    /// 3. 密钥变更 → 自动移除旧记录，写入新密钥，接受
    fn verify_and_update_known_hosts(&self, server_key: &PublicKey) {
        use crate::logging;

        match check_known_hosts(&self.host, self.port, server_key) {
            Ok(true) => {
                logging::info(
                    "SSH/hostkey",
                    format!("主机密钥验证通过: {}:{}", self.host, self.port),
                );
            }
            Ok(false) => {
                // 未找到该主机的记录，首次连接 → 记录密钥
                logging::info(
                    "SSH/hostkey",
                    format!(
                        "首次连接主机 {}:{}，记录公钥到 known_hosts",
                        self.host, self.port
                    ),
                );
                if let Err(e) = learn_known_hosts(&self.host, self.port, server_key) {
                    logging::warn("SSH/hostkey", format!("写入 known_hosts 失败: {}", e));
                }
            }
            Err(keys::Error::KeyChanged { line }) => {
                // 密钥已变更！自动移除旧记录并写入新密钥
                logging::warn(
                    "SSH/hostkey",
                    format!(
                        "主机 {}:{} 的公钥已变更（旧记录在第 {} 行），自动更新 known_hosts",
                        self.host, self.port, line
                    ),
                );
                self.remove_and_relearn(server_key);
            }
            Err(e) => {
                // 其他错误（文件不存在、home 目录未知等）→ 尝试记录密钥
                logging::warn(
                    "SSH/hostkey",
                    format!("known_hosts 检查出错: {}，尝试记录新密钥", e),
                );
                if let Err(e2) = learn_known_hosts(&self.host, self.port, server_key) {
                    logging::warn("SSH/hostkey", format!("写入 known_hosts 失败: {}", e2));
                }
            }
        }
    }

    /// 从 known_hosts 中移除该主机的所有旧记录，然后写入新密钥
    fn remove_and_relearn(&self, server_key: &PublicKey) {
        use crate::logging;

        // 利用 keys::known_host_keys 获取该主机在 known_hosts 中所有匹配条目的行号
        let lines_to_remove: HashSet<usize> = match known_host_keys(&self.host, self.port) {
            Ok(entries) => entries.into_iter().map(|(line, _)| line).collect(),
            Err(e) => {
                logging::warn(
                    "SSH/hostkey",
                    format!("读取 known_hosts 条目失败: {}，跳过自动更新", e),
                );
                return;
            }
        };

        if lines_to_remove.is_empty() {
            // 没有匹配的行（理论上不应进入此分支，但防御性处理）
            if let Err(e) = learn_known_hosts(&self.host, self.port, server_key) {
                logging::warn(
                    "SSH/hostkey",
                    format!("写入新密钥到 known_hosts 失败: {}", e),
                );
            }
            return;
        }

        // 获取 known_hosts 文件路径
        let known_hosts_path = match get_known_hosts_path() {
            Some(p) => p,
            None => {
                logging::warn("SSH/hostkey", "无法确定 known_hosts 路径，跳过自动更新");
                return;
            }
        };

        // 读取现有内容
        let content = match std::fs::read_to_string(&known_hosts_path) {
            Ok(c) => c,
            Err(e) => {
                logging::warn("SSH/hostkey", format!("读取 known_hosts 失败: {}", e));
                return;
            }
        };

        // 按行号过滤（known_host_keys 返回的行号从 1 开始）
        let new_lines: Vec<&str> = content
            .lines()
            .enumerate()
            .filter(|(i, _)| !lines_to_remove.contains(&(i + 1)))
            .map(|(_, line)| line)
            .collect();

        let mut new_content = new_lines.join("\n");
        if !new_content.is_empty() && !new_content.ends_with('\n') {
            new_content.push('\n');
        }

        if let Err(e) = std::fs::write(&known_hosts_path, &new_content) {
            logging::warn("SSH/hostkey", format!("重写 known_hosts 失败: {}", e));
            return;
        }

        logging::info(
            "SSH/hostkey",
            format!("已移除 {} 条旧的主机密钥记录", lines_to_remove.len()),
        );

        // 写入新密钥
        if let Err(e) = learn_known_hosts(&self.host, self.port, server_key) {
            logging::warn(
                "SSH/hostkey",
                format!("写入新密钥到 known_hosts 失败: {}", e),
            );
        } else {
            logging::info("SSH/hostkey", "已写入新的主机密钥");
        }
    }
}

/// 获取 known_hosts 文件路径（与 russh keys 内部逻辑一致）
fn get_known_hosts_path() -> Option<std::path::PathBuf> {
    let home = home::home_dir()?;
    #[cfg(target_os = "windows")]
    {
        Some(home.join("ssh").join("known_hosts"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Some(home.join(".ssh").join("known_hosts"))
    }
}

impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        // 验证并管理 known_hosts，始终接受密钥（自动信任策略）
        self.verify_and_update_known_hosts(server_public_key);
        Ok(true)
    }

    async fn disconnected(
        &mut self,
        reason: client::DisconnectReason<Self::Error>,
    ) -> Result<(), Self::Error> {
        crate::logging::warn(
            "SSH/client",
            format!("{}:{} disconnected: {reason:?}", self.host, self.port),
        );
        Ok(())
    }

    async fn channel_close(
        &mut self,
        channel: russh::ChannelId,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        crate::logging::warn(
            "SSH/client",
            format!(
                "{}:{} received channel_close for {channel:?}",
                self.host, self.port
            ),
        );
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel: russh::ChannelId,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        crate::logging::warn(
            "SSH/client",
            format!(
                "{}:{} received channel_eof for {channel:?}",
                self.host, self.port
            ),
        );
        Ok(())
    }
}

/// 加载 SSH 私钥
///
/// 注意：russh keys 使用 decode_secret_key 而不是 from_openssh
pub async fn load_ssh_key(path: &str, passphrase: Option<String>) -> Result<PrivateKey, String> {
    let path = std::path::Path::new(path);

    if !path.exists() {
        return Err(format!("私钥文件不存在: {}", path.display()));
    }

    let key_content = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("读取私钥文件失败: {}", e))?;

    // decode_secret_key 支持: OpenSSH, PKCS#1, PKCS#8 以及多种加密算法
    keys::decode_secret_key(&key_content, passphrase.as_deref())
        .map_err(|e| format!("私钥解析失败: {:?}. 请检查格式或密码。", e))
}

pub fn load_ssh_key_content(
    key_content: &str,
    passphrase: Option<String>,
) -> Result<PrivateKey, String> {
    keys::decode_secret_key(key_content, passphrase.as_deref())
        .map_err(|e| format!("私钥解析失败: {:?}. 请检查格式或密码。", e))
}

/// 使用私钥认证
async fn authenticate_with_key(
    handle: &mut client::Handle<SshClientHandler>,
    username: &str,
    key_path: &str,
    passphrase: Option<String>,
) -> Result<(), String> {
    let key_pair = Arc::new(load_ssh_key(key_path, passphrase).await?);
    let hash_alg = handle
        .best_supported_rsa_hash()
        .await
        .map_err(|e| format!("查询 RSA 签名算法失败: {}", e))?
        .flatten();

    let auth_result = handle
        .authenticate_publickey(
            username.to_string(),
            PrivateKeyWithHashAlg::new(key_pair, hash_alg),
        )
        .await
        .map_err(|e| format!("私钥认证请求失败: {}", e))?;

    if auth_result.success() {
        Ok(())
    } else {
        Err("私钥认证被拒绝".to_string())
    }
}

async fn authenticate_with_key_content(
    handle: &mut client::Handle<SshClientHandler>,
    username: &str,
    key_content: &str,
    passphrase: Option<String>,
) -> Result<(), String> {
    let key_pair = Arc::new(load_ssh_key_content(key_content, passphrase)?);
    let hash_alg = handle
        .best_supported_rsa_hash()
        .await
        .map_err(|e| format!("查询 RSA 签名算法失败: {}", e))?
        .flatten();

    let auth_result = handle
        .authenticate_publickey(
            username.to_string(),
            PrivateKeyWithHashAlg::new(key_pair, hash_alg),
        )
        .await
        .map_err(|e| format!("私钥认证请求失败: {}", e))?;

    if auth_result.success() {
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

    if auth_result.success() {
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
    let mut attempted_key = false;
    let mut attempted_pwd = false;

    // 策略 1: 私钥认证
    if let Some(ref key_path) = config.private_key_path {
        if !key_path.trim().is_empty() {
            attempted_key = true;
            logging::info("SSH/auth", format!("尝试私钥文件认证: {key_path}"));
            match authenticate_with_key(
                handle,
                username,
                key_path,
                config.private_key_passphrase.clone(),
            )
            .await
            {
                Ok(()) => {
                    logging::info("SSH/auth", "私钥认证成功");
                    authenticated = true;
                }
                Err(e) => {
                    logging::warn("SSH/auth", format!("私钥认证失败: {e}"));
                }
            }
        }
    }

    if !authenticated {
        if let Some(ref key_content) = config.private_key {
            if !key_content.trim().is_empty() {
                attempted_key = true;
                logging::info("SSH/auth", "尝试私钥内容认证");
                match authenticate_with_key_content(
                    handle,
                    username,
                    key_content,
                    config.private_key_passphrase.clone(),
                )
                .await
                {
                    Ok(()) => {
                        logging::info("SSH/auth", "私钥认证成功");
                        authenticated = true;
                    }
                    Err(e) => {
                        logging::warn("SSH/auth", format!("私钥认证失败: {e}"));
                    }
                }
            }
        }
    }

    // 策略 2 & 3: keyboard-interactive -> 密码认证
    if !authenticated {
        if let Some(ref password) = config.password {
            if !password.is_empty() {
                attempted_pwd = true;
                authenticated =
                    authenticate_keyboard_interactive_then_password(handle, username, password)
                        .await?;
            }
        }
    }

    if authenticated {
        Ok(())
    } else {
        logging::warn("SSH/auth", "所有认证方式均已尝试，认证失败");
        if attempted_key && attempted_pwd {
            Err("SSH 认证失败：私钥验证失败，且密码错误".to_string())
        } else if attempted_pwd {
            Err("SSH 认证失败：密码错误或被服务器拒绝".to_string())
        } else if attempted_key {
            Err("SSH 认证失败：私钥无效或不匹配".to_string())
        } else {
            Err("SSH 认证失败：未提供有效的密码或私钥".to_string())
        }
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
                Ok(client::KeyboardInteractiveAuthResponse::InfoRequest {
                    prompts, name, ..
                }) => {
                    logging::info(
                        "SSH/auth",
                        format!(
                            "收到交互请求: round={} name='{}' prompts={}",
                            i + 1,
                            name,
                            prompts.len()
                        ),
                    );
                    let mut responses = Vec::new();
                    for _p in prompts.iter() {
                        responses.push(password.to_string());
                    }
                    current_kbd_res = handle
                        .authenticate_keyboard_interactive_respond(responses)
                        .await;
                }
                Ok(client::KeyboardInteractiveAuthResponse::Failure { .. }) => {
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
        logging::warn(
            "SSH/auth",
            "Keyboard-Interactive 启动失败或超时，尝试标准密码认证",
        );
        should_fallback_to_password = true;
    }

    if kbd_authenticated {
        Ok(true)
    } else if should_fallback_to_password {
        logging::info("SSH/auth", "开始标准密码认证");
        match handle
            .authenticate_password(username.to_string(), password.to_string())
            .await
        {
            Ok(auth_result) if auth_result.success() => {
                logging::info("SSH/auth", "标准密码认证成功");
                Ok(true)
            }
            Ok(_) => {
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

/// 建立 SSH 连接并认证
pub async fn connect_and_authenticate(
    config: &SshConnectConfig,
) -> Result<client::Handle<SshClientHandler>, String> {
    let client_config = build_ssh_client_config(config);
    let client_handler = SshClientHandler::new(config.host.clone(), config.port);

    let mut handle = client::connect(
        Arc::new(client_config),
        (config.host.as_str(), config.port),
        client_handler,
    )
    .await
    .map_err(|e| format!("连接失败: {}", e))?;

    crate::logging::info(
        "SSH/connect",
        format!("ssh connected: {}:{}", config.host, config.port),
    );

    authenticate_ssh(&mut handle, config).await?;
    crate::logging::info("SSH/auth", "auth success");

    Ok(handle)
}
