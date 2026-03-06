# 安全机制

> 返回 [README](../README.md) · 上一篇 [测试规范](./04-testing.md)

## 安全设计原则

Otter 在采集开发环境配置时，必须确保不泄露敏感信息。安全防护分为四层：

1. **采集层过滤** — 从源头排除危险文件和目录
2. **内容层脱敏** — 对采集到的文件内容进行凭据替换（JSON / INI / Shell / JSONL 四种策略）
3. **值级凭据扫描** — 扫描 freeform 文本中的 JWT、API Key、Bearer Token 等模式
4. **传输层保护** — gzip 压缩 + HTTPS 上传

## 采集层过滤

### 目录排除

`BaseCollector.collectDir()` 自动跳过以下目录（不可关闭）：

```
.git, node_modules, __pycache__, .cache, cache,
target, build, dist, .next, .nuxt, .turbo
```

### 二进制文件过滤

`BaseCollector.safeReadFile()` 通过文件扩展名和文件名识别二进制文件并跳过：

**已知二进制扩展名**（部分）：
`.sqlite`, `.db`, `.wasm`, `.dylib`, `.exe`, `.png`, `.jpg`, `.zip`, `.tar.gz`, `.pdf`, `.ttf`, `.woff2` 等

**已知二进制文件名**：
`.DS_Store`, `Thumbs.db`, `desktop.ini`

### 文件大小限制

| 限制 | 默认值 | 说明 |
|------|--------|------|
| 单文件上限 | 512 KB | 超限文件被跳过并记录警告 |
| 特殊文件上限 | 2 MB | `history.jsonl` 等已知大文件可单独设定 |

超限时记录到 `result.errors`：
```
Skipped /path/to/file: exceeds size limit (823 KB > 512 KB)
```

### Claude 配置定向采集

`ClaudeConfigCollector` **不使用** `collectDir()` 递归扫描 `~/.claude/`，而是逐一列出要采集的文件。以下目录被完全排除：

```
debug/, telemetry/, transcripts/, cache/, paste-cache/,
shell-snapshots/, session-env/, statsig/
```

所有 `.jsonl` 会话内容文件也不采集，仅从 `sessions-index.json` 提取元数据摘要。

## 内容层脱敏

**工具文件**: `packages/cli/src/utils/redact.ts`

### JSON 脱敏（`redactJsonSecrets`）

深度遍历 JSON 对象，当键名匹配以下模式时，将**字符串值**替换为 `[REDACTED]`：

| 模式 | 匹配示例 |
|------|----------|
| `/token/i` | `ANTHROPIC_AUTH_TOKEN`, `accessToken` |
| `/secret/i` | `clientSecret`, `auth_secret` |
| `/api.?key/i` | `API_KEY`, `apiKey` |
| `/password/i` | `password`, `dbPassword` |
| `/credential/i` | `credentials` |
| `/auth/i` | `_auth`, `authToken` |

特性：
- 仅替换字符串值（数字、布尔值不受影响）
- 无敏感数据时返回原始内容（不重新格式化）
- JSON 解析失败时返回原文

### 行级脱敏（`redactLineSecrets`）

针对 `.npmrc`, `.gitconfig`, `.netrc`, `.env` 等 INI 风格文件，逐行匹配并替换：

| 模式 | 匹配示例 |
|------|----------|
| `_authToken=xxx` | npm registry 认证令牌 |
| `_auth=xxx` | npm 基础认证 |
| `helper = store` | git credential helper |
| `token/secret/password=xxx` | 通用敏感键值对 |

### 自动格式检测（`redactSecrets`）

根据文件路径扩展名或文件名自动选择脱敏策略：

| 匹配规则 | 策略 |
|----------|------|
| `.json` | JSON 深度脱敏（键名匹配） |
| `.jsonl` | JSONL 脱敏（键名 + 值级凭据扫描） |
| `.npmrc`, `.gitconfig`, `.env`, `.env.local`, `.netrc` | 行级脱敏 |
| `.zshrc`, `.bashrc`, `.profile`, `.zprofile`, `.zshenv`, `.zlogin`, `.bash_profile`, `.tmux.conf`, `.wgetrc`, `.curlrc` | Shell 脚本脱敏 |
| 其他 | 不处理 |

### Shell 脚本脱敏（`redactShellSecrets`）

针对 `.zshrc`, `.bashrc`, `.profile` 等 shell 配置文件，识别敏感变量赋值并脱敏：

| 模式 | 匹配示例 |
|------|----------|
| `export KEY=value`（KEY 含 TOKEN/SECRET/KEY/PASSWORD/CREDENTIAL/AUTH） | `export Z_AI_API_KEY="sk-..."` |
| `KEY=value`（同上，无 export） | `GITHUB_TOKEN=ghp_xxx` |

特性：
- 注释行（`#` 开头）自动跳过
- 支持 `export` 和非 `export` 两种形式
- 不影响非敏感变量（如 `export PATH=...`, `EDITOR=nvim`）

### JSONL 值级脱敏（`redactJsonlSecrets`）

针对 `history.jsonl` 等 JSONL 文件，对每行 JSON 执行双重脱敏：

1. **键名脱敏**：与 `redactJsonSecrets` 相同的键名模式匹配
2. **值级凭据扫描**：深度遍历所有字符串值，匹配以下凭据模式并替换为 `[REDACTED]`：

| 凭据类型 | 匹配模式 |
|----------|----------|
| JWT Token | `eyJhbG...` 三段式 base64 |
| Bearer/Token Header | `Bearer xxx`, `Token xxx` |
| AWS Access Key | `AKIA...`（20 字符） |
| GitHub Token | `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` 前缀 |
| Anthropic API Key | `sk-ant-` 前缀 |
| OpenAI API Key | `sk-`, `sk-proj-` 前缀 |
| Slack Token | `xoxb-`, `xoxp-`, `xoxs-`, `xoxa-` 前缀 |
| npm Token | `npm_` 前缀 |
| Cookie Session | `session=`, `sid=`, `connect.sid=` 等 |
| Private Key | `-----BEGIN PRIVATE KEY-----` 块 |
| Generic Long Secret | `token/key/secret=` + 32+ 字符值 |

## 脱敏应用点

| 采集器 | 脱敏文件 | 方式 |
|--------|----------|------|
| ClaudeConfigCollector | `settings.json` | `safeReadFile({ redact: true })` — JSON 键名脱敏 |
| ClaudeConfigCollector | `history.jsonl` | `safeReadFile({ redact: true })` — JSONL 值级凭据扫描 |
| OpenCodeConfigCollector | 全部 JSON 配置 | `collectDir({ redact: true })` |
| ShellConfigCollector | `.zshrc`, `.bashrc`, `.profile` 等 | `safeReadFile({ redact: true })` — Shell 脚本脱敏 |
| ShellConfigCollector | `.gitconfig`, `.npmrc`, `.netrc` | `safeReadFile({ redact: true })` — 行级脱敏 |

## `--slim` 精简模式

`otter scan --slim` 和 `otter backup --slim` 可排除行为数据，仅保留纯配置文件：

| 排除内容 | 大小占比 | 原因 |
|----------|----------|------|
| `history.jsonl` | ~80% (~842 KB) | 提示词历史，含用户输入的 freeform 文本 |
| `__sessions-summary.json` | ~17% (~175 KB) | 会话元数据摘要 |

精简模式下快照从 ~1.15 MB 缩减至 ~130 KB。

## SSH 密钥保护

`ShellConfigCollector` 对 `~/.ssh/` 采取分级策略：

**采集内容（文件）**：`config`, `known_hosts` — 不含敏感信息

**不采集内容（仅存在性报告）**：
- `id_rsa`, `id_ed25519` 等私钥 → 记录为 `{ type: "private-key" }`
- `id_rsa.pub` 等公钥 → 记录为 `{ type: "public-key" }`
- 同时记录 `modifiedAt` 时间戳，帮助识别过期密钥

**完全排除**：`authorized_keys`, `agent`, `environment`, `rc`

快照中密钥的表现形式（仅在 `lists` 中，无 `files` 内容）：
```json
{
  "name": "id_rsa",
  "meta": { "type": "private-key", "source": ".ssh", "modifiedAt": "2026-01-15T..." }
}
```

## 安全审查检查清单

新增采集器或修改采集逻辑时，请确认：

- [ ] 不采集二进制文件
- [ ] 不递归扫描可能含敏感数据的大目录
- [ ] 含凭据的文件启用了 `redact: true`
- [ ] 不采集 SSH 密钥、GPG 密钥等私密文件
- [ ] 超大文件有合理的大小限制
- [ ] 编写了验证脱敏效果的测试用例

## 相关文档

- [采集器详解](./02-collectors.md)
- [测试规范](./04-testing.md)
- [架构概览](./01-architecture.md)
