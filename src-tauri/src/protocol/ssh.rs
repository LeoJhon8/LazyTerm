//! SSH 命令模块（从 commands/ssh.rs 迁移）

use crate::logging;
use crate::protocol::ssh_auth;
use crate::{
    AppState, SshConnectConfig, SshControlMsg, SshSessionOpenResult, SshTerminalSession,
    SshTmuxCapability, SshTmuxSessionInfo,
};
use russh::ChannelMsg;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::Manager;
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

const TMUX_CHECK_COMMAND: &str =
    "if command -v tmux >/dev/null 2>&1; then tmux -V 2>/dev/null || printf 'tmux'; exit 0; else exit 127; fi";
const TMUX_LIST_COMMAND: &str = "tmux list-sessions -F '#{session_name}|#{session_created}|#{session_activity}|#{session_attached}|#{session_windows}' 2>/dev/null || true";
const SHELL_PROBE_COMMAND: &str = "printf '\\n__LAZYTERM_SHELL__:%s\\n' \"$SHELL\"";
const PROBE_OUTPUT_LIMIT: usize = 32 * 1024;
const BASH_SHELL_INTEGRATION: &str = r#"if [[ $- == *i* && -z ${LAZYTERM_SHELL_INTEGRATION_ACTIVE:-} ]]; then
    LAZYTERM_SHELL_INTEGRATION_ACTIVE=1
    export LAZYTERM_SHELL_INTEGRATION_ACTIVE

    __lazyterm_prompt_begin() {
        local __lazyterm_exit_code=$?
        __lazyterm_last_exit_code=$__lazyterm_exit_code
        printf '\033]633;D;%s\007' "$__lazyterm_exit_code"
        return "$__lazyterm_exit_code"
    }

    __lazyterm_prompt_ready() {
        local __lazyterm_exit_code=${__lazyterm_last_exit_code:-0}
        if [[ ${PS1:-} != "${__lazyterm_wrapped_ps1:-}" ]]; then
            __lazyterm_wrapped_ps1='\[\033]633;A\007\]'"${PS1:-}"'\[\033]633;B\007\]'
            PS1=$__lazyterm_wrapped_ps1
        fi
        return "$__lazyterm_exit_code"
    }

    case "$(declare -p PROMPT_COMMAND 2>/dev/null)" in
        "declare -a"*)
            PROMPT_COMMAND=(
                __lazyterm_prompt_begin
                "${PROMPT_COMMAND[@]}"
                __lazyterm_prompt_ready
            )
            ;;
        *)
            PROMPT_COMMAND="__lazyterm_prompt_begin${PROMPT_COMMAND:+;$PROMPT_COMMAND};__lazyterm_prompt_ready"
            ;;
    esac

    PS0=$'\033]633;C\007'"${PS0:-}"
fi
"#;
const ZSH_SHELL_INTEGRATION: &str = r#"if [[ -o interactive && -z ${LAZYTERM_SHELL_INTEGRATION_ACTIVE:-} ]]; then
    typeset -gx LAZYTERM_SHELL_INTEGRATION_ACTIVE=1

    __lazyterm_osc633_preexec() {
        print -n -- $'\033]633;C\007'
    }

    __lazyterm_osc633_precmd() {
        local __lazyterm_exit_code=$?
        print -n -- $'\033]633;D;'"$__lazyterm_exit_code"$'\007'
    }

    typeset -ga preexec_functions precmd_functions
    preexec_functions=(__lazyterm_osc633_preexec ${preexec_functions:#__lazyterm_osc633_preexec})
    precmd_functions=(__lazyterm_osc633_precmd ${precmd_functions:#__lazyterm_osc633_precmd})
    PROMPT=$'%{\033]633;A\007%}'"${PROMPT:-}"$'%{\033]633;B\007%}'
fi
"#;
const FISH_SHELL_INTEGRATION: &str = r#"if status is-interactive; and not set -q LAZYTERM_SHELL_INTEGRATION_ACTIVE
    set -gx LAZYTERM_SHELL_INTEGRATION_ACTIVE 1

    function __lazyterm_osc633_preexec --on-event fish_preexec
        printf '\033]633;C\007'
    end

    function __lazyterm_osc633_postexec --on-event fish_postexec
        set -l __lazyterm_exit_code $status
        printf '\033]633;D;%s\007' $__lazyterm_exit_code
    end
end
"#;

fn shell_integration_script(kind: &str) -> Option<&'static str> {
    match kind {
        "bash" => Some(BASH_SHELL_INTEGRATION),
        "zsh" => Some(ZSH_SHELL_INTEGRATION),
        "fish" => Some(FISH_SHELL_INTEGRATION),
        _ => None,
    }
}

async fn execute_probe_command(
    handle: &russh::client::Handle<ssh_auth::SshClientHandler>,
    command: &str,
) -> Result<(Option<u32>, String), String> {
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|error| format!("打开 SSH 检测通道失败: {error}"))?;
    channel
        .exec(true, command)
        .await
        .map_err(|error| format!("执行 SSH 检测命令失败: {error}"))?;

    tokio::time::timeout(Duration::from_secs(8), async {
        let mut exit_status = None;
        let mut output = Vec::new();
        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                    if output.len() < PROBE_OUTPUT_LIMIT {
                        let remaining = PROBE_OUTPUT_LIMIT - output.len();
                        output.extend_from_slice(&data[..data.len().min(remaining)]);
                    }
                }
                ChannelMsg::ExitStatus {
                    exit_status: status,
                } => {
                    exit_status = Some(status);
                }
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }
        Ok::<_, String>((
            exit_status,
            String::from_utf8_lossy(&output).trim().to_string(),
        ))
    })
    .await
    .map_err(|_| "SSH 检测命令超时".to_string())?
}

async fn detect_shell_integration_kind(
    handle: &russh::client::Handle<ssh_auth::SshClientHandler>,
) -> Option<String> {
    let (_, output) = match tokio::time::timeout(
        Duration::from_secs(2),
        execute_probe_command(handle, SHELL_PROBE_COMMAND),
    )
    .await
    {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => {
            logging::warn(
                "SSH/shell-integration",
                format!("无法检测远端 Shell，跳过 Shell Integration: {error}"),
            );
            return None;
        }
        Err(_) => {
            logging::warn(
                "SSH/shell-integration",
                "检测远端 Shell 超时，跳过 Shell Integration",
            );
            return None;
        }
    };

    let shell = output.lines().find_map(|line| {
        line.trim()
            .strip_prefix("__LAZYTERM_SHELL__:")
            .map(str::trim)
    })?;
    let shell_name = shell
        .rsplit(|character| character == '/' || character == '\\')
        .next()
        .unwrap_or(shell)
        .trim_start_matches('-')
        .to_ascii_lowercase();
    let integration_kind = match shell_name.as_str() {
        "bash" => Some("bash"),
        "zsh" => Some("zsh"),
        "fish" => Some("fish"),
        _ => None,
    };

    if integration_kind.is_none() {
        logging::info(
            "SSH/shell-integration",
            format!("远端 Shell {shell:?} 暂不支持自动 Shell Integration"),
        );
    }
    integration_kind.map(str::to_string)
}

async fn prepare_shell_integration_script(
    handle: &russh::client::Handle<ssh_auth::SshClientHandler>,
    kind: &str,
) -> Result<String, String> {
    let script = shell_integration_script(kind)
        .ok_or_else(|| format!("不支持为 {kind} 准备 Shell Integration"))?;
    let remote_path = format!(
        "/tmp/.lazyterm-shell-integration-{}",
        Uuid::new_v4().simple(),
    );
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|error| format!("打开 Shell Integration 临时文件通道失败: {error}"))?;
    channel
        .exec(true, format!("umask 077; command cat > '{remote_path}'"))
        .await
        .map_err(|error| format!("创建 Shell Integration 临时文件失败: {error}"))?;
    channel
        .data_bytes(script.as_bytes().to_vec())
        .await
        .map_err(|error| format!("写入 Shell Integration 临时文件失败: {error}"))?;
    channel
        .eof()
        .await
        .map_err(|error| format!("结束 Shell Integration 临时文件写入失败: {error}"))?;

    let exit_status = tokio::time::timeout(Duration::from_secs(2), async {
        let mut exit_status = None;
        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::ExitStatus { exit_status: status } => exit_status = Some(status),
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }
        exit_status
    })
    .await
    .map_err(|_| "创建 Shell Integration 临时文件超时".to_string())?;
    if exit_status != Some(0) {
        return Err(format!(
            "创建 Shell Integration 临时文件失败，退出状态: {exit_status:?}",
        ));
    }

    Ok(remote_path)
}

async fn inject_shell_integration(
    handle: &russh::client::Handle<ssh_auth::SshClientHandler>,
    channel: &russh::Channel<russh::client::Msg>,
    kind: &str,
) {
    let remote_path = match tokio::time::timeout(
        Duration::from_secs(3),
        prepare_shell_integration_script(handle, kind),
    )
    .await
    {
        Ok(Ok(path)) => path,
        Ok(Err(error)) => {
            logging::warn(
                "SSH/shell-integration",
                format!("无法准备远端 Shell Integration，当前会话不启用可靠命令通知: {error}"),
            );
            return;
        }
        Err(_) => {
            logging::warn(
                "SSH/shell-integration",
                "准备远端 Shell Integration 超时，当前会话不启用可靠命令通知",
            );
            return;
        }
    };
    let source_command = if kind == "fish" {
        format!(" source '{remote_path}'; command rm -f -- '{remote_path}'\r")
    } else {
        format!(" . '{remote_path}'; command rm -f -- '{remote_path}'\r")
    };

    match channel.data_bytes(source_command.into_bytes()).await {
        Ok(()) => logging::info(
            "SSH/shell-integration",
            format!("已为当前 SSH 会话注入 {kind} Shell Integration"),
        ),
        Err(error) => logging::warn(
            "SSH/shell-integration",
            format!("注入远端 Shell Integration 失败，当前会话不启用可靠命令通知: {error}"),
        ),
    }
}

async fn probe_tmux(
    handle: &russh::client::Handle<ssh_auth::SshClientHandler>,
) -> Result<SshTmuxCapability, String> {
    let (exit_status, output) = execute_probe_command(handle, TMUX_CHECK_COMMAND).await?;
    let available = exit_status == Some(0) || output.to_ascii_lowercase().starts_with("tmux");
    if !available {
        return Ok(SshTmuxCapability {
            available: false,
            version: None,
            sessions: Vec::new(),
        });
    }

    let (_, sessions_output) = execute_probe_command(handle, TMUX_LIST_COMMAND).await?;
    let mut sessions = sessions_output
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('|');
            let name = fields.next()?.trim();
            if !is_valid_tmux_session_name(name) {
                return None;
            }
            Some(SshTmuxSessionInfo {
                name: name.to_string(),
                created_at: fields.next()?.parse().ok()?,
                last_activity_at: fields.next()?.parse().ok()?,
                attached_clients: fields.next()?.parse().ok()?,
                windows: fields.next()?.parse().ok()?,
            })
        })
        .collect::<Vec<_>>();
    sessions.sort_by(|left, right| right.last_activity_at.cmp(&left.last_activity_at));

    Ok(SshTmuxCapability {
        available: true,
        version: (!output.is_empty()).then_some(output),
        sessions,
    })
}

fn is_valid_tmux_session_name(session_name: &str) -> bool {
    !session_name.is_empty()
        && session_name.len() <= 128
        && session_name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn validated_tmux_session_name(config: &SshConnectConfig) -> Result<Option<String>, String> {
    if !config.tmux_persistence {
        return Ok(None);
    }

    let session_name = config
        .tmux_session_name
        .as_deref()
        .ok_or_else(|| "可恢复 SSH 会话缺少 tmux 会话名称".to_string())?;
    if !is_valid_tmux_session_name(session_name) {
        return Err("tmux 会话名称无效".to_string());
    }

    Ok(Some(session_name.to_string()))
}

fn tmux_session_reservation_key(config: &SshConnectConfig, tmux_session_name: &str) -> String {
    format!(
        "{}\0{}\0{}\0{}",
        config.host.trim().to_ascii_lowercase(),
        config.port,
        config.username,
        tmux_session_name,
    )
}

// 调用方先校验名称。通过完整名称解析 ID，兼容不支持 =name 目标语法的 tmux。
fn tmux_session_id_lookup_command(tmux_session_name: &str) -> String {
    format!(
        "tmux list-sessions -F '#{{session_name}}|#{{session_id}}' 2>/dev/null | \
         while IFS='|' read -r name id; do \
         if [ \"$name\" = '{tmux_session_name}' ]; then printf '%s' \"$id\"; break; fi; \
         done"
    )
}

fn tmux_attach_command(tmux_session_name: &str, detach_other_clients: bool) -> String {
    let detach_flag = if detach_other_clients { " -d" } else { "" };
    let lookup_command = tmux_session_id_lookup_command(tmux_session_name);
    format!(
        "tmux_session_id=$({lookup_command}); \
         if [ -z \"$tmux_session_id\" ]; then \
         tmux new-session -d -s {tmux_session_name} || exit $?; \
         tmux_session_id=$({lookup_command}); \
         fi; \
         [ -n \"$tmux_session_id\" ] || exit 1; \
         tmux set-option -t \"$tmux_session_id:\" mouse on || exit $?; \
         exec tmux attach-session{detach_flag} -t \"$tmux_session_id\""
    )
}

async fn release_ssh_reservations(
    client_session_keys: &Arc<tokio::sync::Mutex<HashSet<String>>>,
    tmux_session_keys: &Arc<tokio::sync::Mutex<HashSet<String>>>,
    client_session_key: &str,
    tmux_session_key: Option<&str>,
) {
    client_session_keys.lock().await.remove(client_session_key);
    if let Some(tmux_session_key) = tmux_session_key {
        tmux_session_keys.lock().await.remove(tmux_session_key);
    }
}

/// 创建 SSH 会话
#[tauri::command]
pub async fn create_ssh_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    session_id: String,
    config: SshConnectConfig,
) -> Result<SshSessionOpenResult, String> {
    logging::info(
        "SSH/connect",
        format!(
            "连接尝试: {}@{}:{} keep_alive={:?} keep_alive_interval={:?}",
            config.username,
            config.host,
            config.port,
            config.keep_alive,
            config.keep_alive_interval,
        ),
    );

    let requested_tmux_session_name = validated_tmux_session_name(&config)?;
    let tmux_session_key = requested_tmux_session_name
        .as_deref()
        .map(|tmux_session_name| tmux_session_reservation_key(&config, tmux_session_name));
    let client_session_key = config
        .client_session_key
        .clone()
        .unwrap_or_else(|| session_id.clone());
    if client_session_key.is_empty()
        || client_session_key.len() > 128
        || !client_session_key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err("SSH 逻辑会话标识无效".to_string());
    }
    if !state
        .ssh_client_session_keys
        .lock()
        .await
        .insert(client_session_key.clone())
    {
        return Err("此 LazyTerm SSH 会话已有活动连接".to_string());
    }
    if let Some(tmux_session_key) = tmux_session_key.as_deref() {
        if !state
            .ssh_tmux_session_keys
            .lock()
            .await
            .insert(tmux_session_key.to_string())
        {
            state
                .ssh_client_session_keys
                .lock()
                .await
                .remove(&client_session_key);
            return Err("该远端 tmux 会话已被另一个 LazyTerm 标签页使用".to_string());
        }
    }

    let ready_timeout =
        Duration::from_millis(config.ready_timeout.unwrap_or(30_000).clamp(1_000, 120_000));

    #[cfg(any(target_os = "android", target_os = "ios"))]
    let known_hosts_path = Some(
        app.path()
            .app_data_dir()
            .map_err(|error| format!("无法确定应用数据目录: {error}"))?
            .join("ssh")
            .join("known_hosts"),
    );
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let known_hosts_path = None;

    let readiness_result = tokio::time::timeout(ready_timeout, async {
        // 使用 protocol::ssh_auth 中的 connect_and_authenticate 一站式完成连接和认证
        let handle = ssh_auth::connect_and_authenticate_with_known_hosts(&config, known_hosts_path)
            .await
            .map_err(|e| {
                logging::error("SSH/connect", format!("连接或认证失败: {e}"));
                e
            })?;

        logging::info("SSH/connect", "认证通过，初始化会话通道");

        let tmux_session_name = requested_tmux_session_name.clone();
        let mut tmux_session_restored = false;
        if let Some(tmux_session_name) = tmux_session_name.as_deref() {
            let capability = probe_tmux(&handle).await?;
            if !capability.available {
                return Err("远端未安装 tmux，无法创建可恢复 SSH 会话".to_string());
            }
            let existing_session = capability
                .sessions
                .iter()
                .find(|session| session.name == tmux_session_name);
            if !config.tmux_detach_other_clients
                && existing_session.is_some_and(|session| session.attached_clients > 0)
            {
                return Err("该远端 tmux 会话已有客户端附着，请稍后重试".to_string());
            }
            tmux_session_restored = existing_session.is_some();
        }
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| e.to_string())?;
        let initial_cols = config.initial_cols.unwrap_or(80).clamp(40, 400);
        let initial_rows = config.initial_rows.unwrap_or(24).clamp(12, 200);
        channel
            .request_pty(
                true,
                "xterm-256color",
                initial_cols,
                initial_rows,
                0,
                0,
                &[],
            )
            .await
            .map_err(|e| e.to_string())?;
        logging::info(
            "SSH/channel",
            format!("session {session_id} pty ok: {initial_cols}x{initial_rows}"),
        );
        let _ = channel.set_env(false, "TERM_PROGRAM", "LazyTerm").await;
        let _ = channel
            .set_env(false, "TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"))
            .await;
        let _ = channel.set_env(false, "COLORTERM", "truecolor").await;
        if let Some(tmux_session_name) = tmux_session_name.as_deref() {
            channel
                .exec(
                    true,
                    tmux_attach_command(tmux_session_name, config.tmux_detach_other_clients),
                )
                .await
                .map_err(|e| e.to_string())?;
            logging::info(
                "SSH/channel",
                format!(
                    "session {session_id} tmux persistence active with mouse history scrolling: {tmux_session_name}"
                ),
            );
        } else {
            channel
                .request_shell(true)
                .await
                .map_err(|e| e.to_string())?;
            logging::info("SSH/channel", format!("session {session_id} shell ok"));
        }

        Ok::<_, String>((handle, channel, tmux_session_name, tmux_session_restored))
    })
    .await;
    let (handle, channel, tmux_session_name, tmux_session_restored) = match readiness_result {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => {
            release_ssh_reservations(
                &state.ssh_client_session_keys,
                &state.ssh_tmux_session_keys,
                &client_session_key,
                tmux_session_key.as_deref(),
            )
            .await;
            return Err(error);
        }
        Err(_) => {
            release_ssh_reservations(
                &state.ssh_client_session_keys,
                &state.ssh_tmux_session_keys,
                &client_session_key,
                tmux_session_key.as_deref(),
            )
            .await;
            return Err(format!(
                "SSH 会话就绪超时（{} ms）",
                ready_timeout.as_millis()
            ));
        }
    };
    let shell_integration_kind = if tmux_session_name.is_none() {
        detect_shell_integration_kind(&handle).await
    } else {
        None
    };
    if let Some(kind) = shell_integration_kind.as_deref() {
        inject_shell_integration(&handle, &channel, kind).await;
    }
    let handle = Arc::new(handle);

    let (control_tx, mut control_rx) = mpsc::unbounded_channel::<SshControlMsg>();
    let (background_mode_tx, mut background_mode_rx) =
        tokio::sync::watch::channel(config.background_mode);
    let (mut channel_reader, channel_writer) = channel.split();
    let (channel_closed_tx, mut channel_closed_rx) = oneshot::channel::<()>();
    let close_emitted = Arc::new(AtomicBool::new(false));

    state.ssh_sessions.lock().await.insert(
        session_id.clone(),
        SshTerminalSession {
            control_tx,
            background_mode_tx,
            handle: Arc::clone(&handle),
            client_session_key: client_session_key.clone(),
            tmux_session_key,
            tmux_session_name,
        },
    );

    let keepalive_session_id = session_id.clone();
    let keepalive_handle = Arc::clone(&handle);
    tokio::spawn(async move {
        loop {
            let background_mode_enabled = *background_mode_rx.borrow();
            if !background_mode_enabled {
                if background_mode_rx.changed().await.is_err() {
                    break;
                }
                continue;
            }

            tokio::select! {
                changed = background_mode_rx.changed() => {
                    if changed.is_err() {
                        break;
                    }
                }
                _ = tokio::time::sleep(Duration::from_secs(30)) => {
                    if let Err(error) = keepalive_handle.send_ping().await {
                        logging::warn(
                            "SSH/background",
                            format!("session {keepalive_session_id} background ping failed: {error}"),
                        );
                        break;
                    }
                }
            }
        }
        logging::info(
            "SSH/background",
            format!("session {keepalive_session_id} background keeper stopped"),
        );
    });

    let reader_app = app.clone();
    let reader_session_id = session_id.clone();
    let reader_close_emitted = Arc::clone(&close_emitted);
    let reader_sessions = Arc::clone(&state.ssh_sessions);
    let reader_client_session_keys = Arc::clone(&state.ssh_client_session_keys);
    let reader_tmux_session_keys = Arc::clone(&state.ssh_tmux_session_keys);
    let reader_uses_tmux = requested_tmux_session_name.is_some();
    tokio::spawn(async move {
        let event_name = format!("terminal-data-{reader_session_id}");
        let close_event_name = format!("terminal-close-{reader_session_id}");
        let mut remote_exit_status = None;

        let close_reason = loop {
            match channel_reader.wait().await {
                Some(russh::ChannelMsg::Data { data }) => {
                    let _ =
                        reader_app.emit(&event_name, String::from_utf8_lossy(&data).to_string());
                }
                Some(russh::ChannelMsg::ExtendedData { data, ext }) => {
                    logging::warn(
                        "SSH/channel",
                        format!(
                            "session {reader_session_id} received extended data: ext={ext} bytes={}",
                            data.len()
                        ),
                    );
                    let _ =
                        reader_app.emit(&event_name, String::from_utf8_lossy(&data).to_string());
                }
                Some(russh::ChannelMsg::Eof) => {
                    logging::warn(
                        "SSH/channel",
                        format!("session {reader_session_id} received EOF"),
                    );
                    break "eof";
                }
                Some(russh::ChannelMsg::Close) => {
                    logging::warn(
                        "SSH/channel",
                        format!("session {reader_session_id} received CLOSE"),
                    );
                    break "close";
                }
                Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                    remote_exit_status = Some(exit_status);
                    logging::warn(
                        "SSH/channel",
                        format!("session {reader_session_id} received exit-status={exit_status}"),
                    );
                }
                Some(russh::ChannelMsg::ExitSignal {
                    signal_name,
                    core_dumped,
                    error_message,
                    lang_tag,
                }) => {
                    logging::warn(
                        "SSH/channel",
                        format!(
                            "session {reader_session_id} received exit-signal={signal_name:?} core_dumped={core_dumped} lang={lang_tag} message={error_message}"
                        ),
                    );
                }
                Some(other) => {
                    logging::info(
                        "SSH/channel",
                        format!("session {reader_session_id} received channel message: {other:?}"),
                    );
                }
                None => {
                    logging::warn(
                        "SSH/channel",
                        format!("session {reader_session_id} channel wait returned None"),
                    );
                    break "channel-none";
                }
            }
        };

        let close_reason = if reader_uses_tmux {
            remote_exit_status
                .map(|exit_status| format!("tmux-command-exit-status:{exit_status}"))
                .unwrap_or_else(|| close_reason.to_string())
        } else {
            close_reason.to_string()
        };

        if !reader_close_emitted.swap(true, Ordering::Relaxed) {
            let _ = reader_app.emit(&close_event_name, &close_reason);
        }
        let removed_session = reader_sessions.lock().await.remove(&reader_session_id);
        if let Some(session) = removed_session {
            release_ssh_reservations(
                &reader_client_session_keys,
                &reader_tmux_session_keys,
                &session.client_session_key,
                session.tmux_session_key.as_deref(),
            )
            .await;
        }
        let _ = channel_closed_tx.send(());
    });

    let writer_session_id = session_id.clone();
    let writer_close_emitted = Arc::clone(&close_emitted);
    let writer_sessions = Arc::clone(&state.ssh_sessions);
    let writer_client_session_keys = Arc::clone(&state.ssh_client_session_keys);
    let writer_tmux_session_keys = Arc::clone(&state.ssh_tmux_session_keys);
    tokio::spawn(async move {
        let close_event_name = format!("terminal-close-{writer_session_id}");

        loop {
            tokio::select! {
                _ = &mut channel_closed_rx => {
                    break;
                }
                ctrl = control_rx.recv() => {
                    match ctrl {
                        Some(SshControlMsg::SendData(data)) => {
                            let send_result = tokio::select! {
                                result = channel_writer.data_bytes(data) => result,
                                _ = &mut channel_closed_rx => break,
                            };
                            if let Err(error) = send_result {
                                logging::error(
                                    "SSH/channel",
                                    format!("session {writer_session_id} failed to send data: {error}"),
                                );
                                if !writer_close_emitted.swap(true, Ordering::Relaxed) {
                                    let _ = app.emit(&close_event_name, error.to_string());
                                }
                                let removed_session = writer_sessions.lock().await.remove(&writer_session_id);
                                if let Some(session) = removed_session {
                                    release_ssh_reservations(
                                        &writer_client_session_keys,
                                        &writer_tmux_session_keys,
                                        &session.client_session_key,
                                        session.tmux_session_key.as_deref(),
                                    )
                                    .await;
                                }
                                break;
                            }
                        }
                        Some(SshControlMsg::Resize(cols, rows)) => {
                            if let Err(error) = channel_writer.window_change(cols, rows, 0, 0).await {
                                logging::error(
                                    "SSH/channel",
                                    format!("session {writer_session_id} failed to resize to {cols}x{rows}: {error}"),
                                );
                                if !writer_close_emitted.swap(true, Ordering::Relaxed) {
                                    let _ = app.emit(&close_event_name, error.to_string());
                                }
                                let removed_session = writer_sessions.lock().await.remove(&writer_session_id);
                                if let Some(session) = removed_session {
                                    release_ssh_reservations(
                                        &writer_client_session_keys,
                                        &writer_tmux_session_keys,
                                        &session.client_session_key,
                                        session.tmux_session_key.as_deref(),
                                    )
                                    .await;
                                }
                                break;
                            }
                        }
                        Some(SshControlMsg::Close(closed_tx)) => {
                            logging::info(
                                "SSH/channel",
                                format!("session {writer_session_id} closed by local request"),
                            );
                            if !writer_close_emitted.swap(true, Ordering::Relaxed) {
                                let _ = app.emit(&close_event_name, "local-close");
                            }
                            let _ = channel_writer.close().await;
                            let _ = tokio::time::timeout(
                                Duration::from_secs(3),
                                &mut channel_closed_rx,
                            )
                            .await;
                            let _ = closed_tx.send(());
                            break;
                        }
                        None => {
                            logging::warn(
                                "SSH/channel",
                                format!("session {writer_session_id} control channel closed"),
                            );
                            if !writer_close_emitted.swap(true, Ordering::Relaxed) {
                                let _ = app.emit(&close_event_name, "control-closed");
                            }
                            let _ = channel_writer.close().await;
                            break;
                        }
                    }
                }
            }
        }
    });

    Ok(SshSessionOpenResult {
        session_id,
        tmux_session_restored,
    })
}

/// 向 SSH 会话写入数据
#[tauri::command]
pub async fn write_to_ssh_session(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state.ssh_sessions.lock().await;
    if let Some(session) = sessions.get(&session_id) {
        session
            .control_tx
            .send(SshControlMsg::SendData(data.into_bytes()))
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("SSH会话不存在".to_string())
    }
}

/// 调整 SSH 会话终端大小
#[tauri::command]
pub async fn resize_ssh_session(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.ssh_sessions.lock().await;
    if let Some(session) = sessions.get(&session_id) {
        session
            .control_tx
            .send(SshControlMsg::Resize(cols as u32, rows as u32))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 使用现有已认证连接的独立 channel 检测远端 tmux，不污染可见终端。
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn check_ssh_tmux_capability(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SshTmuxCapability, String> {
    let handle = {
        let sessions = state.ssh_sessions.lock().await;
        Arc::clone(
            &sessions
                .get(&session_id)
                .ok_or_else(|| "SSH会话不存在".to_string())?
                .handle,
        )
    };

    let capability = probe_tmux(&handle).await?;
    logging::info(
        "SSH/background",
        format!(
            "session {session_id} tmux available={} version={:?}",
            capability.available, capability.version
        ),
    );
    Ok(capability)
}

/// 退出当前 tmux pane 的浏览模式。用户输入仍由原 PTY 通道发送，避免重复注入。
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn exit_ssh_tmux_copy_mode(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let (handle, tmux_session_name) = {
        let sessions = state.ssh_sessions.lock().await;
        let session = sessions
            .get(&session_id)
            .ok_or_else(|| "SSH会话不存在".to_string())?;
        let tmux_session_name = session
            .tmux_session_name
            .clone()
            .ok_or_else(|| "当前 SSH 连接未附着 tmux 会话".to_string())?;
        if !is_valid_tmux_session_name(&tmux_session_name) {
            return Err("当前 SSH 连接的 tmux 会话名称无效".to_string());
        }
        (Arc::clone(&session.handle), tmux_session_name)
    };

    let lookup_command = tmux_session_id_lookup_command(&tmux_session_name);
    let command = format!(
        "tmux_session_id=$({lookup_command}); \
         [ -n \"$tmux_session_id\" ] || exit 0; \
         tmux send-keys -t \"$tmux_session_id:\" -X cancel 2>/dev/null || true"
    );
    let (exit_status, output) = execute_probe_command(&handle, &command).await?;
    if matches!(exit_status, Some(status) if status != 0) {
        return Err(if output.is_empty() {
            "退出远端 tmux 浏览模式失败".to_string()
        } else {
            format!("退出远端 tmux 浏览模式失败: {output}")
        });
    }

    Ok(())
}

/// 结束当前 LazyTerm SSH 连接所附着的远端 tmux 会话。
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn kill_ssh_tmux_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let (handle, tmux_session_name) = {
        let sessions = state.ssh_sessions.lock().await;
        let session = sessions
            .get(&session_id)
            .ok_or_else(|| "SSH会话不存在".to_string())?;
        let tmux_session_name = session
            .tmux_session_name
            .clone()
            .ok_or_else(|| "当前 SSH 连接未附着 tmux 会话".to_string())?;
        if !is_valid_tmux_session_name(&tmux_session_name) {
            return Err("当前 SSH 连接的 tmux 会话名称无效".to_string());
        }
        (Arc::clone(&session.handle), tmux_session_name)
    };

    let lookup_command = tmux_session_id_lookup_command(&tmux_session_name);
    let (exit_status, output) = execute_probe_command(
        &handle,
        &format!(
            "tmux_session_id=$({lookup_command}); \
             [ -n \"$tmux_session_id\" ] || exit 1; \
             tmux kill-session -t \"$tmux_session_id\""
        ),
    )
    .await?;
    if exit_status != Some(0) {
        return Err(if output.is_empty() {
            "结束远端 tmux 会话失败".to_string()
        } else {
            format!("结束远端 tmux 会话失败: {output}")
        });
    }

    logging::info(
        "SSH/background",
        format!("session {session_id} killed tmux session {tmux_session_name}"),
    );
    Ok(())
}

/// 动态启停 SSH 后台保活。
#[tauri::command]
pub async fn set_ssh_background_mode(
    state: State<'_, AppState>,
    session_id: String,
    enabled: bool,
) -> Result<(), String> {
    let sessions = state.ssh_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "SSH会话不存在".to_string())?;
    session
        .background_mode_tx
        .send(enabled)
        .map_err(|error| error.to_string())?;
    logging::info(
        "SSH/background",
        format!("session {session_id} background mode enabled={enabled}"),
    );
    Ok(())
}

/// 关闭 SSH 会话
#[tauri::command]
pub async fn close_ssh_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let session = state.ssh_sessions.lock().await.remove(&session_id);
    if let Some(session) = session {
        let client_session_key = session.client_session_key.clone();
        let tmux_session_key = session.tmux_session_key.clone();
        let (closed_tx, closed_rx) = oneshot::channel();
        if session
            .control_tx
            .send(SshControlMsg::Close(closed_tx))
            .is_ok()
        {
            let _ = tokio::time::timeout(Duration::from_secs(5), closed_rx).await;
        }
        release_ssh_reservations(
            &state.ssh_client_session_keys,
            &state.ssh_tmux_session_keys,
            &client_session_key,
            tmux_session_key.as_deref(),
        )
        .await;
    }
    Ok(())
}
