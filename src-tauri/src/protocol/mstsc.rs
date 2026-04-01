use crate::RdpConnectConfig;
#[cfg(windows)]
use super::rdp_core::build_rdp_full_address;
#[cfg(windows)]
use std::process::Command;
#[cfg(windows)]
use uuid::Uuid;

#[cfg(windows)]
fn build_mstsc_username(config: &RdpConnectConfig) -> String {
    let username = config.username.trim();
    let domain = config.domain.as_deref().unwrap_or_default().trim();
    if domain.is_empty() {
        username.to_string()
    } else {
        format!("{}\\{}", domain, username)
    }
}

#[cfg(windows)]
fn build_mstsc_credential_targets(config: &RdpConnectConfig) -> Vec<String> {
    let mut targets = vec![format!("TERMSRV/{}", config.host)];
    if config.port != 3389 {
        targets.push(format!("TERMSRV/{0}:{1}", config.host, config.port));
    }
    targets
}

#[cfg(windows)]
fn build_mstsc_rdp_file(config: &RdpConnectConfig) -> String {
    let width = config.width.unwrap_or(1280).clamp(200, 8192);
    let height = config.height.unwrap_or(720).clamp(200, 8192);
    let prompt_for_credentials = if config.password.as_deref().is_some_and(|value| !value.trim().is_empty()) {
        0
    } else {
        1
    };

    [
        "screen mode id:i:1".to_string(),
        format!("desktopwidth:i:{width}"),
        format!("desktopheight:i:{height}"),
        "session bpp:i:32".to_string(),
        format!("full address:s:{}", build_rdp_full_address(config)),
        format!("username:s:{}", build_mstsc_username(config)),
        format!("prompt for credentials:i:{prompt_for_credentials}"),
        "authentication level:i:2".to_string(),
        "enablecredsspsupport:i:1".to_string(),
        "negotiate security layer:i:1".to_string(),
        "redirectclipboard:i:1".to_string(),
        "redirectprinters:i:0".to_string(),
        "drivestoredirect:s:".to_string(),
        "audiomode:i:0".to_string(),
    ]
    .join("\r\n") + "\r\n"
}

#[cfg(windows)]
fn run_cmdkey(args: &[String], context: &str) -> Result<(), String> {
    let output = Command::new("cmdkey")
        .args(args)
        .output()
        .map_err(|error| format!("{context}: 无法启动 cmdkey: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let details = if !stderr.is_empty() { stderr } else { stdout };
    if details.is_empty() {
        Err(format!("{context}: cmdkey 返回失败状态 {}", output.status))
    } else {
        Err(format!("{context}: {details}"))
    }
}

#[cfg(windows)]
fn store_mstsc_credentials(targets: &[String], username: &str, password: &str) -> Result<(), String> {
    for target in targets {
        run_cmdkey(
            &[
                format!("/generic:{target}"),
                format!("/user:{username}"),
                format!("/pass:{password}"),
            ],
            &format!("保存 mstsc 凭据失败 ({target})"),
        )?;
    }

    Ok(())
}

#[cfg(windows)]
fn delete_mstsc_credentials(targets: &[String]) {
    for target in targets {
        let _ = Command::new("cmdkey")
            .arg(format!("/delete:{target}"))
            .output();
    }
}

#[tauri::command]
pub fn launch_mstsc_rdp(config: RdpConnectConfig) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let _ = config;
        return Err("mstsc 方案仅支持 Windows。".to_string());
    }

    #[cfg(windows)]
    {
        let credential_targets = build_mstsc_credential_targets(&config);
        let username = build_mstsc_username(&config);
        let password = config.password.clone().filter(|value| !value.trim().is_empty());

        if let Some(password_value) = password.as_deref() {
            store_mstsc_credentials(&credential_targets, &username, password_value)?;
        }

        let rdp_file_path = std::env::temp_dir().join(format!("lazyterm-mstsc-{}.rdp", Uuid::new_v4()));
        std::fs::write(&rdp_file_path, build_mstsc_rdp_file(&config)).map_err(|error| {
            if password.is_some() {
                delete_mstsc_credentials(&credential_targets);
            }
            format!("写入 mstsc 临时配置失败: {error}")
        })?;

        let spawn_result = Command::new("mstsc.exe")
            .arg(&rdp_file_path)
            .spawn();

        let mut child = match spawn_result {
            Ok(child) => child,
            Err(error) => {
                let _ = std::fs::remove_file(&rdp_file_path);
                if password.is_some() {
                    delete_mstsc_credentials(&credential_targets);
                }
                return Err(format!("启动 mstsc 失败: {error}"));
            }
        };

        std::thread::spawn(move || {
            let _ = child.wait();
            let _ = std::fs::remove_file(&rdp_file_path);
            if password.is_some() {
                delete_mstsc_credentials(&credential_targets);
            }
        });

        Ok(())
    }
}
