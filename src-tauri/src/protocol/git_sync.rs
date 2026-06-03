use crate::utils::create_hidden_command;
use std::path::Path;

#[tauri::command]
pub async fn git_check_repo(path: String) -> Result<bool, String> {
    let repo_path = Path::new(&path);
    if !repo_path.exists() || !repo_path.is_dir() {
        return Ok(false);
    }

    let output = create_hidden_command("git")
        .arg("status")
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    Ok(output.status.success())
}

#[tauri::command]
pub async fn git_commit_and_push(path: String, commit_msg: String) -> Result<(), String> {
    let repo_path = Path::new(&path);
    if !repo_path.exists() || !repo_path.is_dir() {
        return Err("Directory does not exist".to_string());
    }

    // git add .
    let add_output = create_hidden_command("git")
        .arg("add")
        .arg(".")
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to execute git add: {}", e))?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(format!("git add failed: {}", stderr));
    }

    // git commit -m "..."
    // We don't fail if commit fails, because there might be nothing to commit.
    let _commit_output = create_hidden_command("git")
        .arg("commit")
        .arg("-m")
        .arg(&commit_msg)
        .current_dir(repo_path)
        .output();

    // git push
    let push_output = create_hidden_command("git")
        .arg("push")
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to execute git push: {}", e))?;

    if !push_output.status.success() {
        let stderr = String::from_utf8_lossy(&push_output.stderr);
        return Err(format!("git push failed: {}", stderr));
    }

    Ok(())
}

#[tauri::command]
pub async fn git_pull(path: String) -> Result<(), String> {
    let repo_path = Path::new(&path);
    if !repo_path.exists() || !repo_path.is_dir() {
        return Err("Directory does not exist".to_string());
    }

    // git pull --rebase
    let pull_output = create_hidden_command("git")
        .arg("pull")
        .arg("--rebase")
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to execute git pull: {}", e))?;

    if !pull_output.status.success() {
        let stderr = String::from_utf8_lossy(&pull_output.stderr);
        return Err(format!("git pull failed: {}", stderr));
    }

    Ok(())
}
