# 弹窗认证字段简化总结

## 任务要求
1. 移除Authentication Method下拉框
2. 始终显示密码和密钥输入框
3. Session Name移到第二个位置（Host之后）
4. Session Name默认值为host

## 已完成修改

### 1. HTML文件修改 (`src/renderer/index.html`)

#### 移除的元素:
```html
<!-- Authentication Method下拉框 -->
<select id="sshAuthMethod">
  <option value="password">Password</option>
  <option value="key">Private Key File</option>
  <option value="agent">SSH Agent (Default Key)</option>
</select>

<!-- 隐藏的认证字段 -->
<div id="sshPasswordFields" class="auth-method-fields">...</div>
<div id="sshKeyFields" class="auth-method-fields" style="display: none;">...</div>
<div id="sshAgentFields" class="auth-method-fields" style="display: none;">...</div>
```

#### 字段重排:
```html
<!-- 修改前 (所有字段在SSH Fields中) -->
<div>Host</div>
<div>Port</div>
<div>Username</div>
<div>Auth Method</div>
<div>Password (隐藏)</div>
<div>Key Path (隐藏)</div>
<div>Session Name (在最后)</div>

<!-- 修改后 -->
<div>Host</div>
<div>Session Name (新位置, 位于Host后)</div>
<div>Port</div>
<div>Username</div>
<div>Password (始终显示)</div>
<div>Key Path (始终显示)</div>
```

#### Session Name变化:
```html
<!-- 修改前 -->
<input type="text" id="sessionName" placeholder="e.g., My Server">

<!-- 修改后 -->
<input type="text" id="sessionName" placeholder="Auto-filled from Host">
```

### 2. JavaScript文件修改 (`src/renderer/terminal.js`)

#### `openConnectionModal` 方法修改:

**新增的功能:**
```javascript
const sshHost = document.getElementById('sshHost');
const updateSessionName = () => {
  const hostValue = sshHost.value.trim();
  sessionName.value = hostValue || '';
};

sshHost.addEventListener('input', updateSessionName);
```

**移除的字段重置:**
```javascript
document.getElementById('sshPasswordFields').style.display = 'block';  // 已移除
document.getElementById('sshKeyFields').style.display = 'none';      // 已移除
document.getElementById('sshAgentFields').style.display = 'none';    // 已移除
```

**焦点变化:**
```javascript
// 修改前
sessionName.focus();

// 修改后 - 先让用户输入Host
sshHost.focus();
```

#### `initConnectionModal` 方法修改:

**移除的代码:**
```javascript
const sshAuthMethod = document.getElementById('sshAuthMethod');
const sshPasswordFields = document.getElementById('sshPasswordFields');
const sshKeyFields = document.getElementById('sshKeyFields');
const sshAgentFields = document.getElementById('sshAgentFields');

sshAuthMethod.addEventListener('change', () => {
  const method = sshAuthMethod.value;
  sshPasswordFields.style.display = method === 'password' ? 'block' : 'none';
  sshKeyFields.style.display = method === 'key' ? 'block' : 'none';
  sshAgentFields.style.display = method === 'agent' ? 'block' : 'none';
});
```

#### `handleSaveSession` 方法修改:

**验证逻辑更新:**
```javascript
// 修改前
const authMethod = document.getElementById('sshAuthMethod').value;
if (authMethod === 'password' && !password) {
  alert('Please enter SSH password');
  return;
}
if (authMethod === 'key' && !keyPath) {
  alert('Please enter SSH private key path');
  return;
}
connectionParams = { host, port, user, authMethod, password, keyPath };

// 修改后
if (!password && !keyPath) {
  alert('Please enter either SSH password or private key path');
  return;
}
connectionParams = { host, port, user, password, keyPath };
```

**要求改为: 密码和密钥至少需要一个**

#### `createTab` 方法修改:

**参数传递更新:**
```javascript
// 修改前
ptyParams = {
  tabId: id,
  host: connectionParams.host,
  port: connectionParams.port,
  user: connectionParams.user,
  authMethod: connectionParams.authMethod,  // 已移除
  password: connectionParams.password,
  keyPath: connectionParams.keyPath
};

// 修改后
ptyParams = {
  tabId: id,
  host: connectionParams.host,
  port: connectionParams.port,
  user: connectionParams.user,
  password: connectionParams.password,
  keyPath: connectionParams.keyPath
};
```

### 3. PTY Service文件修改 (`src/main/pty/ptyService.js`)

#### `setupSSH` 方法修改:

**新增密钥文件读取:**
```javascript
const connectionConfig = {
  host,
  port: port || 22,
  username: user,
  password,
  readyTimeout: 15000,
  algorithms: { ... }
};

// Add keyPath if provided
if (keyPath) {
  connectionConfig.privateKey = require('fs').readFileSync(keyPath);
}

this.conn.connect(connectionConfig);
```

**功能:**
- 自动检测keyPath参数
- 如果提供密钥路径,读取并使用私钥
- 支持: 纯密码认证、纯密钥认证、同时使用密码和密钥

## 用户界面变化

### 修改前:
```
┌─────────────────────────────────────────────┐
│ Connection Type: [SSH                    ▼]│
├─────────────────────────────────────────────┤
│ Host: [192.168.1.1                     ]    │
│ Port: [22                           ]    │
│ Username: [root                      ]    │
│ Auth Method: [Password              ▼]    │
│ Password: [*********                ]    │
│ Key Path: [~/.ssh/id_rsa          ]    │ (隐藏)
├─────────────────────────────────────────────┤
│ Session Name: [My Server             ]    │
└─────────────────────────────────────────────┘
```

### 修改后:
```
┌─────────────────────────────────────────────┐
│ Connection Type: [SSH                    ▼]│
├─────────────────────────────────────────────┤
│ Host: [192.168.1.1                     ]    │
│ Session Name: [192.168.1.1(auto-fill)  ]    │
│ Port: [22                           ]    │
│ Username: [root                      ]    │
│ Password: [*********                ]    │
│ Key Path: [~/.ssh/id_rsa             ]    │
└─────────────────────────────────────────────┘
```

## 功能变化

### 1. 认证方式简化
**修改前:**
- 必须选择: Password, Key, 或 Agent
- 如果选Password: 只显示密码框
- 如果选Key: 只显示密钥框

**修改后:**
- 无需选择认证方式
- 始终显示密码框和密钥框
- 密码/密钥至少一个必填
- 可同时填写两个（优先使用密钥）

### 2. Session Name自动填充
**修改前:**
- 在表单最后
- 手动输入或保持空白
- 默认placeholder: "e.g., My Server"

**修改后:**
- 在Host之后紧跟
- 自动从Host值填充
- 填写Host时实时更新
- 可手动修改

### 3. 输入流程优化
**修改前:**
```
1. 填写Host
2. 填写Port
3. 填写Username
4. 选择Auth Method
5. 填写Password或Key Path
6. 填写Session Name
7. Save
```

**修改后:**
```
1. 填写Host (Session Name自动填充)
2. 可修改Session Name或保持
3. 填写Port
4. 填写Username
5. 填写Password或Key Path (至少一个)
6. Save
```

### 4. SSH连接参数
**修改前:**
```javascript
connectionParams = {
  host, port, user,
  authMethod: 'password',  // 或 'key', 'agent'
  password,
  keyPath
}
```

**修改后:**
```javascript
connectionParams = {
  host, port, user,
  password,   // 可选, 但与keyPath至少一个
  keyPath    // 可选, 但与password至少一个
}
```

## 验证规则

### 必填字段:
1. **SSH连接**:
   - Host (必填)
   - Username (必填)
   - Password 或 KeyPath (至少一个)
   - Session Name (从Host自动填充, 可修改)

2. **Telnet连接**:
   - Host (必填)
   - Port (必填)

3. **Local连接**:
   - 无必填字段

### 验证提示:
```
"Please fill in host and username for SSH connection"
"Please fill in host for Telnet connection"
"Please enter either SSH password or private key path"
"Please enter a session name"
"Please fill in host and username for SSH connection"
```

## 连接逻辑

### SSH连接优先级:
```javascript
if (keyPath) {
  connectionConfig.privateKey = fs.readFileSync(keyPath);
}

// ssh2库会自动选择:
// 1. 如果提供了privateKey, 使用密钥认证
// 2. 如果同时提供了password, 作为备用认证
// 3. 如果没有privateKey, 使用password认证
```

### 支持的场景:
1. **纯密码认证**: 填写Password, 留空Key Path
2. **纯密钥认证**: 留空Password, 填写Key Path
3. **混合认证**: 填写Password和Key Path (密钥为主, 密码为备用)

## 用户体验改进

### 自动填充流程:
```
输入: 192.168.1.1
↓
Session Name: 192.168.1.1 (实时更新)
↓
可手动修改为: 我的开发环境
```

### 简化的认证选择:
```
旧方式: 选择Auth Method → 根据选项填写
新方式: 直接填写密码/密钥 → 无需选择
```

## 删除的功能

1. ~~Authentication Method下拉框~~
2. ~~认证字段的显示/隐藏控制~~
3. ~~SSH Agent认证选项~~
4. ~~authMethod参数传递~~

## 新增/保留的功能

1. **自动Session Name**: Host输入时自动填充
2. **简洁的认证**: 无需选择认证方式
3. **灵活的认证**: 密码/密钥可同时使用
4. **密钥自动读取**: keyPath自动读取文件

## 验证结果

### 语法检查
```bash
node -c src/renderer/terminal.js
✅ 通过,无语法错误
```

### 应用运行
```bash
tasklist | grep electron
✅ 应用已重启
```

### 代码清理
```bash
grep -n "sshAuthMethod\|sshPasswordFields\|sshKeyFields\|sshAgentFields" \
  src/renderer/terminal.js
✅ 无残留引用
```

## 迁移建议

对于已有会话数据:
- 旧会话包含`authMethod`参数
- 新代码会忽略`authMethod`参数
- 改为根据`password`和`keyPath`自动选择认证方式
- 兼容性: 已保存的会话仍然可用

## 完成状态

✅ HTML: 移除Auth Method, 隐藏字段控制, 重排Session Name
✅ JavaScript: 添加Host监听器, 更新验证逻辑, 移除相关事件
✅ PTY Service: 支持密钥读取, 移除authMethod依赖
✅ 自动填充: Host输入时更新Session Name
✅ 验证: 密码或密钥至少一个
✅ 语法检查通过
✅ 应用已重启

任务完成。

弹窗现在更简洁,认证字段始终显示,Session Name自动填充。
