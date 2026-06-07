# Mac Capture Readiness

> 返回 [README](../README.md) · 相关：[安全机制](./05-security.md) · [采集器详解](./02-collectors.md) · [采集器增强计划（已完成阶段）](./07-collector-enhancement-plan.md)

## 定位

**目标**：在 macOS 上做开发环境的 **capture / rebuild reference** — 当需要重装机器、切换设备或灾难恢复时，**通过快照能查到原机长什么样**：装了哪些 App、哪些 brew 包、哪些 coding agent 及其核心 prompt、哪些开机启动项、哪些代理软件及其配置。

**非目标**：不做自动 restore，不做 one-click 重建。Otter 是**只读 capture**，不持有"对外恢复"语义。任何关于"如何根据快照重建"的逻辑都是**人读**或**第三方工具读**，不在 collector 职责内。

## 5 类核心覆盖目标

zheng-li 明确点名（msg=40cc654e）、本规约最高优先级覆盖的 5 类：

| # | 类别 | 含义 | 重装恢复价值 |
|---|---|---|---|
| 1 | **Applications** | 本机所有用户可见 GUI App | 知道要重新下载/购买哪些 App |
| 2 | **Brew packages** | Homebrew 的 formula / cask / tap / pinned，及 Brewfile | 可读 Brewfile / 人工重装参考 |
| 3 | **Coding agents** | Claude / Codex / Gemini / OpenCode / Hermes / OpenClaw 的 config + 核心 prompt md | 知道每个 agent 装在哪、关键 system prompt / skill / 个性化设置是什么 |
| 4 | **Startup items** | LaunchAgents（user + system）+ LaunchDaemons + crontab + 登录项 | 知道开机会自动跑什么（避免漏装关键 daemon、识别恶意残留） |
| 5 | **Proxy / Clash** | Clash / Mihomo / Verge / Stash / Surge / sing-box / v2ray / xray 的 config | 知道原机的代理软件 + **redact 后的规则结构**（订阅 URL、节点凭据必须脱敏） |

W1 实施波次（[Wave 1 计划](#wave-1-计划)）按这 5 类组织，不发散到长尾工具。

## 数据敏感度分级

每一条采集项必须落到以下 4 级中的一级。设计 collector 时，先打分级再决定 include/exclude/redact 策略。

| 等级 | 含义 | 处理 | 例子 |
|---|---|---|---|
| **content** | 完整内容采集（必要时脱敏后） | 读文件全文 → 走对应 `redact*Secrets()` → 写入 snapshot | `~/.zshrc`、`~/.codex/config.toml`、`~/.claude/CLAUDE.md` |
| **inventory-only** | 只列名（+ 可选元数据如版本、修改时间、大小） | 不读内容，仅列条目 | `/Applications/*.app`（含 version）、`~/Library/Fonts/*`（文件名）、brew formula 列表 |
| **presence-only** | 只记"存在 / 不存在"（+ 可选 hash / mtime） | 仅 stat，不读内容、不列细节 | `~/.ssh/id_*`（密钥存在性，类型 + mtime） |
| **never-collect** | 绝对不读、不上传、不放入 snapshot | collector 在白名单/黑名单 gate 里硬性排除；不能依赖 redact 兜底 | `~/.aws/credentials`、`~/.codex/auth.json`、SSH/GPG 私钥、`*.sqlite*`、`history.jsonl` |

**关键原则**：`never-collect` 不依赖 redact 救场 — redact 是 `content` 类的二次防线，不是 `never-collect` 的首道防线。

## Never-collect 清单（强制 hard-block）

以下路径任何 collector 都**不允许采集内容**，只能 `presence-only` 或完全跳过。新增 collector 时必须把这些路径加入 exclude gate，**不能假设上游 redact 会拦住**。

### 凭据 / OAuth / Session token（hard-block）
```
~/.aws/credentials, ~/.aws/cli/cache/, ~/.aws/sso/cache/
~/.azure/az.sess
~/.gcloud/credentials.db, ~/.gcloud/access_tokens.db
~/.gcloud/application_default_credentials.json, ~/.gcloud/legacy_credentials/
~/.codex/auth.json
~/.gemini/oauth_creds.json
~/.pypirc, ~/.cargo/credentials.toml
所有 Slock agent token（sk_agent_*）、machine API key（sk_machine_*）
```

### 私钥 / 证书（hard-block 内容，允许 presence-only 元数据）
```
~/.ssh/id_*  (presence-only：只记 key type + mtime，绝不读内容)
~/.ssh/*.pem, ~/.ssh/*.key  (presence-only)
~/.gnupg/private-keys-v1.d/, ~/.gnupg/openpgp-revocs.d/  (presence-only)
*.p12, *.pfx, *.jks, *.keystore
```

> **`~/.ssh/known_hosts` 现状与 W1 收敛**：`ShellConfigCollector` 当前作为 `SSH_SAFE_FILES` 读全文（明文 host:port 列表，OpenSSH 默认 `HashKnownHosts no`，会暴露访问过的主机历史）。这不是凭据，但属于行为指纹。**W1 收敛**：改为 inventory-only — 仅记录条目数 + 文件 mtime + size，不再写入 content；`~/.ssh/config` 保持 content（含别名/User/IdentityFile 路径，重装参考价值高）。该改动作为 `ShellConfigCollector` 的 W1 微调项，与 LaunchAgents 同批走。

### 长期对话历史 / 缓存 / 工作 DB（与重装无关，且常含敏感对话）
```
*.sqlite, *.sqlite-shm, *.sqlite-wal, *.db
~/.codex/sessions/, ~/.codex/cache/, ~/.codex/shell_snapshots/
~/.codex/history.jsonl, ~/.codex/log/, ~/.codex/tmp/
~/.codex/memories/  (二进制 DB 形式存储的，跳过；md 形式可单独决定)
~/.claude/transcripts/, ~/.claude/debug/, ~/.claude/telemetry/
~/.claude/sessions/*.jsonl  (会话原文，只用 sessions-index.json 摘要)
~/.claude/cache/, ~/.claude/paste-cache/, ~/.claude/shell-snapshots/
~/.claude/session-env/, ~/.claude/statsig/
~/.gemini/history/, ~/.gemini/tmp/
~/.hermes/*/sessions/, ~/.hermes/*/state.db, ~/.hermes/*/.env
~/.opencode/sessions/, ~/.opencode/cache/  (若存在)
所有 IDE / 浏览器历史 SQLite
```

### 代理软件运行时数据（与配置无关）
```
{clash,mihomo,verge,surge}/cache.db, cache/, logs/
*.mmdb, Country.mmdb, GeoLite2-*.mmdb  (GeoIP 数据库)
{clash,mihomo}/*.dat (规则缓存)
sing-box/cache.db
```

### macOS 系统敏感
```
~/Library/Keychains/  (整个目录 never collect)
~/Library/Cookies/, ~/Library/HTTPStorages/
~/Library/Mail/, ~/Library/Messages/  (TCC 域内)
~/Library/Safari/  (TCC 域内)
~/Library/Application Support/{Slack,Discord,WeChat,Telegram}/*  (聊天记录)
```

## Redact-required content 清单（可采但**必须结构化脱敏**）

以下路径属于 `content` 级（重装参考价值高），但**必须**走对应的 `redact*Secrets()` 才能写入 snapshot。任何 collector 在采集这些路径时必须显式调用对应 redact，不能裸输出。

| 路径 | 脱敏方式 | 敏感字段 |
|---|---|---|
| `~/.docker/config.json` | `redactJsonSecrets()` | `auths.*.auth`、`auths.*.password`、`HttpHeaders.Authorization`、`credHelpers.*` 部分 |
| `~/.npmrc` | `redactShellSecrets()` 行级 | `//registry.*/:_authToken`、`//registry.*/:_password`、`_auth` |
| `~/.config/gh/hosts.yml` | `redactYamlSecrets()` | `oauth_token`、`*.git_protocol` 旁的 token、`user` 可保留 |
| `~/.azure/azureProfile.json` | `redactJsonSecrets()` | `tokens`、`accessToken`、`subscription[*].user.name` 保留 |
| `~/.azure/az.json` | `redactJsonSecrets()` | `installationId` 保留，session token 字段 redact |
| `~/.codex/config.toml` | `redactTomlSecrets()`（W1 新增） | `api_key`、`token`、`*_secret` 等 |
| `~/.gemini/settings.json` / `projects.json` / `state.json` / `trustedFolders.json` | `redactJsonSecrets()` | 任何 token 字段；路径/项目 ID 保留 |
| `~/.gemini/google_accounts.json` | **inventory-only**：仅记账号数量 + 文件 size + mtime；**不读 content** | 含 Google account id 可关联个人身份，作为 inventory 不展开 |
| Proxy 配置（Clash/Mihomo/Verge/Surge/sing-box/v2ray/xray） | `redactClashYaml / redactSingBoxJson / redactSurgeConf` 等专用语义脱敏 | 见 [Proxy 专用脱敏](#proxy语义脱敏按路径级规则) |
| LaunchAgents plist | 字段白名单 + 值级脱敏 | 见 [LaunchAgents 字段边界](#launchagents--launchdaemons-plist-字段边界) |

**审计意义**：明确"哪些路径只能脱敏后采"是为了避免开发者拿"redact 会兜底"做兜底逻辑。本清单是 collector 自检 checklist 的输入。

## 专用脱敏规则

通用脱敏（JSON / YAML / shell / line-ini）由 `packages/cli/src/utils/redact.ts` 提供。以下场景需要 **collector-level 专用脱敏**，不能复用全局 key 表。

### TOML（新增，给 Codex 用）

`~/.codex/config.toml` 是 W1 必须采集的 content，但全局 `redact.ts` 当前不支持 TOML。需要新增 `redactTomlSecrets(text, additionalKeys?)`：

- 行级 key=value 处理，识别裸 key 和 `[section]` 内 key
- 内置敏感 key：`api_key`、`token`、`secret`、`password`、`auth_token`、`refresh_token`、`access_token`、`*_key`、`*_secret`、`bearer`
- 支持 `additionalKeys` 形参，让 collector 注入自己的敏感 key（不污染默认表）
- 替换为 `"***REDACTED***"`（带引号，保持 TOML 合法性）
- 处理多行字符串（`"""..."""`、`'''...'''`）：整段替换
- 数组形式（`api_keys = ["..."]`）：整数组替换

### Proxy（语义脱敏，按路径级规则）

Proxy 配置不能靠"key 名匹配"兜底 — 订阅 URL、节点 server 地址都是普通 key 名。`ProxyConfigCollector` 必须内置专用 `redactClashYaml / redactSingBoxJson / redactSurgeConf`，按 schema 路径级处理：

#### Clash / Mihomo / Clash Verge Rev / Stash（YAML）
| 路径 | 处理 |
|---|---|
| `proxies[*].password` | redact |
| `proxies[*].uuid` | redact |
| `proxies[*].alterId` | redact |
| `proxies[*].auth-str` | redact |
| `proxies[*].psk` | redact |
| `proxies[*].server` | **默认 redact**（节点地址通常等同凭据） |
| `proxies[*].port` | 保留（统计有意义） |
| `proxies[*].name` / `type` / `cipher` | 保留（rebuild reference 价值） |
| `proxy-providers.*.url` | **redact**（订阅 URL） |
| `proxy-providers.*.path` | 保留（本地 cache 路径，无敏感） |
| `rule-providers.*.url` | **redact** |
| `external-controller` | 保留地址，但 |
| `external-controller-tls.*` | redact `secret` |
| `secret`（顶层 RESTful API key） | redact |
| `authentication[*]` | redact |
| `dns.nameserver-policy.*` | 保留（公共 DNS 列表，无敏感） |
| 其他 `rules` / `dns` / `tun` / `proxy-groups` 结构 | 保留 |

#### sing-box（JSON）
| 路径 | 处理 |
|---|---|
| `outbounds[*].password` / `uuid` / `password_str` | redact |
| `outbounds[*].server` | 默认 redact |
| `outbounds[*].server_port` | 保留 |
| `outbounds[*].tls.utls.fingerprint` | 保留 |
| `experimental.clash_api.secret` | redact |
| `experimental.v2ray_api.listen` | 保留 |

#### Surge（INI-like `.conf`）
| 段 / 行模式 | 处理 |
|---|---|
| `[Proxy]` 段内的行（如 `MyNode = ss, server.example.com, 443, encrypt-method=aes-256-gcm, password=xxx`） | 整行内 `password=`/`username=`/`encrypt-method=` 后的值 redact |
| `[Proxy Group]` 内 `select`/`url-test` 行 | 保留 |
| `[General] http-listen` / `socks5-listen` | 保留地址（监听本机），但 `auth=user:pass` redact |
| `[MITM] ca-passphrase` | redact |
| `[MITM] hostname` 中含 `*.suffix` | 保留（规则） |

#### v2ray / xray
- 与 sing-box 同结构，按 `outbounds[*].settings.vnext[*].users[*].id` / `password` redact，`address` 默认 redact

#### 可关闭 server-redact
- `ProxyConfigCollector` 提供 `keepNodeServers: boolean` 选项（默认 false）。多数用户的节点地址即凭据，少数场景（自建机场）可显式开放。文档默认推荐 false。

### LaunchAgents / LaunchDaemons（plist 字段边界）

新增 / 增强的 `LaunchAgentsCollector` 抓 plist 时只能采以下字段：

| 字段 | 采集 | 备注 |
|---|---|---|
| `Label` | ✅ content | 唯一识别 |
| `ProgramArguments` | ✅ content + **值级脱敏** | 数组逐项扫 token / Bearer / URL with auth；命中即整项 redact |
| `Program` | ✅ content | 可执行路径，无敏感 |
| `RunAtLoad` | ✅ content | bool |
| `KeepAlive` | ✅ content | bool / dict（如 `{NetworkState: true}`） |
| `StartInterval` / `StartCalendarInterval` | ✅ content | 调度信息 |
| `WorkingDirectory` | ✅ content | 路径 |
| `StandardOutPath` / `StandardErrorPath` | ✅ content | 路径 |
| `EnvironmentVariables` | ❌ **never collect** | 常含 token / API key，整个 dict 跳过 |
| `Sockets` | ✅ inventory-only | 只记 key 名 + listen 地址，不展开 |
| 其他字段 | ❌ 跳过 | 留白名单制，未列出的不采 |

值级脱敏模式（用于 `ProgramArguments` 单项）：
- `Bearer\s+[A-Za-z0-9._-]+` → `Bearer ***`
- `https?://[^:]+:[^@]+@` → `https://***:***@`
- `(api[_-]?key|token|secret)=\S+` → `$1=***`
- 长度 > 32 且看似 base64 / hex 的孤立 token → `***REDACTED***`

## 现有 13 个 collector 覆盖矩阵

| Collector | 5 类映射 | 数据级 | 当前状态 | W1 补齐 |
|---|---|---|---|---|
| `ApplicationsCollector` | 1. Apps | inventory（name+version）+ 图标上传 | ✅ 顶层 .app | **递归 `/Applications/Setapp/` 子目录**；可选 `/System/Applications` inventory-only |
| `HomebrewCollector` | 2. Brew | content（formula/cask/tap/pinned） | ✅ 已覆盖 | **`brew bundle dump --describe` 生成 Brewfile** |
| `ClaudeConfigCollector` | 3. Coding agents | content（root .md/.json）+ 摘要 | ✅ root files + 会话摘要 | **`~/.claude/commands/*.md`**（7 个）+ **`~/.claude/skills/`** 最小白名单（每 skill 仅采 `SKILL.md` frontmatter + location/source，**不**跟随 symlink 到 readme/scripts/references） |
| `OpenCodeConfigCollector` | 3. Coding agents | content + skill frontmatter | ✅ 完整 | 无 |
| `HermesCollector` | 3. Coding agents | content（多 profile） | ✅ 完整 | 无 |
| 〈新〉`CodexConfigCollector` | 3. Coding agents | content（config.toml + skills/ + plugins/ + memories/.md） | ❌ 缺 | **W1 新建**（依赖 `redactTomlSecrets()`） |
| 〈新〉`GeminiConfigCollector` | 3. Coding agents | content（settings/projects/state/trustedFolders 走 redactJsonSecrets） + inventory-only（google_accounts.json 仅 size+mtime+顶层 key 数） | ❌ 缺 | **W1 新建** |
| 〈新〉`OpenClawCollector` | 3. Coding agents | 混合：user config（如有）+ workspace repos inventory | ❌ 缺 | **W1 新建**：两层探针 |
| `ShellConfigCollector` | — | content（dotfiles） | ✅ 含 `~/.ssh/{config,known_hosts}` 全文 | **W1 收敛**：`~/.ssh/known_hosts` 改为 inventory-only（条目数 + mtime + size），`~/.ssh/config` 保持 content |
| `VSCodeCollector` | — | content（extensions/settings/keybindings/snippets） | ✅ | — |
| `DockerCollector` | — | content（config redacted + contexts） | ✅ | — |
| `FontsCollector` | — | inventory（~/Library/Fonts） | ✅ | — |
| `DevToolchainCollector` | — | content（fnm/volta/npm/bun/rustup/cargo/pyenv/rbenv/go） | ✅ | W2：pnpm globals、uv、pipx、mise、asdf、Go modules |
| `CloudCLICollector` | — | content（Azure/AWS/GCloud/Railway 安全子集） | ✅ | W2：gh 多 profile、GPG inventory |
| `MacOSDefaultsCollector` | 4. Startup（登录项部分） | content（7 个 domain + 登录项） | ✅ | 无 |
| `LaunchAgentsCollector` | 4. Startup | inventory（文件名） + content（crontab） | ⚠️ 仅文件名 | **抓 plist 关键字段**（白名单制，见上节） + **扫 `/Library/LaunchAgents`** + **扫 `/Library/LaunchDaemons`** |
| 〈新〉`ProxyConfigCollector` | 5. Proxy | content（按 [Proxy 专用脱敏](#proxy语义脱敏按路径级规则)） | ❌ 缺 | **W1 新建** |

## Wave 1 计划

按 5 类组织，不发散到长尾工具：

### 1. Apps
- `ApplicationsCollector` 支持子目录递归（仅 `/Applications/Setapp/`，避免误进 `Microsoft Office/` 等 .app 内部嵌套）
- 可选 `/System/Applications` inventory-only（开关默认 off，可由 CLI flag 开启）

### 2. Brew
- 新增 `BrewfileCollector` 子项（或扩 `HomebrewCollector`），执行 `brew bundle dump --describe --file=-` 拿原始 Brewfile，作为 content 存储

### 3. Coding agents
- **前置**：在 `packages/cli/src/utils/redact.ts` 增加 `redactTomlSecrets(text, additionalKeys?)`
- 新增 `CodexConfigCollector`（**严格 allowlist，不递归任意 md/json/toml**）：
  - include：
    - `~/.codex/config.toml`（走 `redactTomlSecrets()`）
    - `~/.codex/skills/*/SKILL.md`（每 skill 顶层 SKILL.md，frontmatter + 描述；**不**递归扫 references/scripts）
    - `~/.codex/skills/*/manifest.json`（若存在）
    - `~/.codex/plugins/*/{plugin.json,manifest.json,plugin.toml,README.md}`（每 plugin 仅其顶层 manifest + README）
    - `~/.codex/memories/*.md`（顶层 md 文件，不递归子目录）
  - exclude：`auth.json`、`*.sqlite*`、`sessions/`、`cache/`、`shell_snapshots/`、`history.jsonl`、`log/`、`tmp/`、`models_cache.json`、`plugins/*/{src,node_modules,dist,build,test,tests}/`、`skills/*/{references,scripts,templates}/`
- 新增 `GeminiConfigCollector`（**严格 allowlist**）：
  - include（content，走 `redactJsonSecrets()`）：`settings.json`、`projects.json`、`state.json`、`trustedFolders.json`
  - **inventory-only**：`google_accounts.json`（仅记 size + mtime + 顶层 key 数量，不读 value；含 Google account id 可关联个人身份）
  - exclude：`oauth_creds.json`、`history/`、`tmp/`、`installation_id`
- 扩 `ClaudeConfigCollector`：
  - 补 `~/.claude/commands/*.md`（顶层 md，content）
  - 补 `~/.claude/skills/`：每 skill 仅采 `SKILL.md`（frontmatter + body）+ `manifest.json`（若存在）；**symlink 仅跟随 1 层取目标的 SKILL.md/manifest 元数据，不进入目标目录的 readme/scripts/references/templates**；遇到指向 workspace 仓库的 symlink，记录 source path 但不拉内容
- 新增 `OpenClawCollector`：两层探针（路径**可配置 + 测试时可注入**，见 [安全审计清单 §6 修订](#安全审计清单)）
  - **Layer 1 — user config**：扫 `~/.openclaw`、`~/.config/openclaw`、`~/Library/Application Support/OpenClaw` / `openclaw`，存在则按 `SKILL.md` / `config.{toml,json,yaml}` allowlist 采（与 OpenCode collector 同模式）
  - **Layer 2 — known workspace repos inventory**（默认探针 `~/workspace/personal/openclaw`、`~/workspace/personal/openclaw-mini`，**可由 `--openclaw-repo <path>` 覆盖 / `homeDir` 等价物注入测试路径**）：每仓库采
    - `git rev-parse HEAD`（commit）
    - `git remote -v`（remote URLs）
    - 选定核心 md（顶层）：`AGENTS.md` / `CLAUDE.md`（若是指向 `AGENTS.md` 的 symlink 跳过避免重复）/ `README.md` / `docs.acp.md`
    - 选定核心 md（指定子目录，**1 层深**）：`.pi/prompts/*.md` / `workspace-templates/*.md`
    - **不**递归整 repo，不进 `src/`/`apps/`/`extensions/`/`docs/`/`node_modules/`/`dist/`

### 4. Startup
- 扩 `LaunchAgentsCollector` 支持 3 个位置：`~/Library/LaunchAgents/`、`/Library/LaunchAgents/`、`/Library/LaunchDaemons/`
- 每个 plist 用 `plutil -convert json -o - <plist>` 读，按上述[字段边界](#launchagents--launchdaemons-plist-字段边界)白名单提取
- 输出按 `scope: 'user' | 'system-agent' | 'system-daemon'` 分组

### 5. Proxy
- 新增 `ProxyConfigCollector`，探针位置：
  - `~/.config/clash/`、`~/.config/mihomo/`、`~/.config/sing-box/`、`~/.config/v2ray/`、`~/.config/xray/`
  - `~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/`
  - `~/Library/Application Support/com.stashapp.Stash/`
  - `~/Library/Application Support/Surge/`、`~/Library/Application Support/com.nssurge.surge-mac/`
  - `/etc/clash/`、`/usr/local/etc/clash/`、`/opt/homebrew/etc/clash/`
- 各路径按上述[路径级脱敏](#proxy语义脱敏按路径级规则)处理
- exclude：`cache.db`、`*.mmdb`、`*.dat`、`logs/`、`cache/`
- presence-only 报告：是否安装了对应 CLI（`clash` / `mihomo` / `sing-box` / `v2ray` / `xray` 在 PATH 中）

## Wave 2 / Wave 3 计划

**Wave 2 — 长尾开发环境**
- `DevToolchainCollector` 扩：pnpm globals、uv tools、pipx、mise、asdf、Go modules
- `CloudCLICollector` 扩：gh 多 profile、GPG inventory（不读私钥，只列 `gpg --list-keys`）
- 可选：`mas list`、`brew services list`、`launchctl list`（与 plist 文件清单对比）

**Wave 3 — Rebuild Reference 视图/报告**
- Web 仪表盘按 Apps / Brew / Agents / Startup / Proxy 分类重组展示
- 可选 `otter snapshot report` CLI：从快照生成 markdown，按 5 类输出"重装清单"

## 安全审计清单

每个新增 / 扩展的 collector 必须自检：

1. ✅ 已落到 4 级敏感度的某一级，README/docstring 明示
2. ✅ never-collect 路径在 collector gate 里硬性排除（不依赖 redact）
3. ✅ content 类输出走过 `redact*Secrets()`，且 redact 函数有单元测试覆盖典型敏感样本
4. ✅ 新增专用 redact（如 Proxy / TOML）必须有独立测试文件（`packages/cli/tests/redact-{toml,proxy}.test.ts`）
5. ✅ 新增 collector 必须有 dry-run 单元测试 + 覆盖率达到 ≥ 90%
6. ✅ 不引入硬编码的"魔法路径" — 所有路径必须通过 `homedir` 等价物或显式 collector option 注入，方便测试。已知路径默认值（如 `OpenClawCollector` 默认探针 `~/workspace/personal/{openclaw,openclaw-mini}`、`ProxyConfigCollector` 默认探针 `/etc/clash` 等）允许写在 collector 的 `defaultProbes` 常量里，但必须可由 collector option / CLI flag 覆盖，且单元测试通过注入临时路径完成验证
7. ✅ 失败要落到 `result.errors`，不能整次扫描崩盘

## 与 [docs/05-security.md](./05-security.md) 的关系

本文档是 **W1 实施规约**，定义"采什么、怎么采、怎么脱敏、什么坚决不采"。`05-security.md` 是 **运行时机制文档**，定义"redact 工具如何工作、四层防御如何配合"。

两者关系：本文档定义需求 → 05 文档定义实现。W1 实现完成后，`05-security.md` 需要相应补 TOML / Proxy 脱敏策略章节。
