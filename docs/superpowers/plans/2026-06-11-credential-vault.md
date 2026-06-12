# Credential Vault Implementation Plan

> **For agentic workers:** Follow this plan inline. Project rules prohibit creating or running tests.

**Goal:** 实现可随配置迁移的 Xshell 风格加密凭据保险库。

**Architecture:** 使用 Web Crypto 的 AES-256-GCM 加密敏感字段。默认模式从固定应用材料派生密钥，主密码模式通过 PBKDF2-SHA-256 派生密钥；Zustand 只持有本次进程解密结果，localStorage 仅保存版本化密文。

**Tech Stack:** React 19、TypeScript、Zustand、Web Crypto、Tauri 2

---

### Task 1: 保险库加密边界

**Files:**
- Create: `src/lib/credential-vault.ts`
- Modify: `src/types/credential.ts`

- [x] 定义版本化保险库、密文和凭据元数据类型。
- [x] 实现 AES-GCM 加解密、默认密钥和 PBKDF2 主密码派生。
- [x] 实现旧明文格式识别与默认模式迁移。

### Task 2: 凭据运行时状态

**Files:**
- Modify: `src/store/credentials.ts`

- [x] 将 Store 改为显式异步初始化和持久化。
- [x] 维护锁定状态、运行时明文和持久化密文。
- [x] 实现新增、编辑、删除、启用主密码、修改主密码、关闭主密码和清空保险库。
- [x] 将会话配置中的明文认证信息迁移为保险库引用。

### Task 3: 解锁和设置交互

**Files:**
- Create: `src/components/dialogs/CredentialVaultUnlockDialog.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/settings/CredentialSettings.tsx`

- [x] 应用启动时初始化保险库，主密码模式显示阻塞式解锁窗口。
- [x] 凭据设置支持异步保存，并提供主密码模式管理。
- [x] 编辑凭据时保留现有秘密，只有用户输入新值时才替换。

### Task 4: 迁移和备份

**Files:**
- Modify: `src/store/git-aware-storage.ts`
- Modify: `src/components/settings/DataSettings.tsx`

- [x] 将密文保险库加入 Git 同步键。
- [x] 将密文保险库加入 JSON 导出和恢复。

### Task 5: 编译检查

- [x] 运行 `tsc -p tsconfig.app.json --noEmit`。
- [x] 运行 `cargo check`。
- [x] 审查 `git diff`，确认持久化内容不存在凭据明文字段。
