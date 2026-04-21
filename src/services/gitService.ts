import { invoke } from "@tauri-apps/api/core";

export async function checkGitRepo(path: string): Promise<boolean> {
  return invoke<boolean>("git_check_repo", { path });
}

export async function commitAndPushGitRepo(path: string, commitMsg: string): Promise<void> {
  return invoke<void>("git_commit_and_push", { path, commitMsg });
}

export async function pullGitRepo(path: string): Promise<void> {
  return invoke<void>("git_pull", { path });
}
