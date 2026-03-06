# 安全机制

> 返回 [README](../README.md) · 上一篇 [测试规范](./04-testing.md)

## 安全设计原则

Otter 在采集开发环境配置时，必须确保不泄露敏感信息。安全防护分为三层：

1. **采集层过滤** — 从源头排除危险文件和目录
2. **内容层脱敏** — 对采集到的文件内容进行凭据替换
3. **传输层保护** — 上传时使用 HTTPS

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

根据文件路径扩展名自动选择脱敏策略：

| 扩展名 | 策略 |
|--------|------|
| `.json` | JSON 深度脱敏 |
| `.npmrc`, `.gitconfig`, `.env`, `.env.local`, `.netrc` | 行级脱敏 |
| 其他 | 不处理 |

## 脱敏应用点

| 采集器 | 脱敏文件 | 方式 |
|--------|----------|------|
| ClaudeConfigCollector | `settings.json` | `safeReadFile({ redact: true })` |
| OpenCodeConfigCollector | 全部 JSON 配置 | `collectDir({ redact: true })` |
| ShellConfigCollector | `.gitconfig`, `.npmrc`, `.netrc` | `safeReadFile({ redact: true })` |

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
