# 采集器增强计划

> 返回 [README](../README.md) · 上一篇 [Dashboard](./06-dashboard.md)

## 背景

当前 Otter 内置 5 个采集器（shell-config、homebrew、applications、claude-config、opencode-config），覆盖了 dotfiles、Homebrew 包名、应用列表和 AI 工具配置。但以"迁移到新 Mac"为目标场景来评估，数据丰富度存在明显缺口。

本文档基于 macOS 环境的实际验证（2026-03-07），逐项列出可通过 CLI 获取的增强项，按优先级分组，每项给出实现细节。

## 执行进度

> 本节用于记录实际落地状态，确保 collector、测试、dashboard 三线同步推进。

| 阶段 | 范围 | 状态 | 备注 |
|------|------|------|------|
| Phase P0 | Homebrew + Applications 增强 | 已完成 | Homebrew 已补版本 / taps / pinned，Applications 已补 ~/Applications 与版本 |
| Phase P1 | Dev Toolchain / VS Code / Docker / Cloud CLI | 已完成 | 已完成 collector、注册、dashboard metadata 展示、L1/L2/L3/L4 验证 |
| Phase P2 | macOS Defaults / Launch Agents / Fonts | 已完成 | 已完成系统级 collector 与轻量环境 collector，并纳入默认注册 |
| Dashboard | Snapshot detail 同步适配新元数据 | 已完成 | 已支持 version / meta badges、collector 搜索、分类过滤与概览统计 |
| Testing | 四层测试补强 | 进行中 | L1/L2 现有基线可复用，L3/L4 补 rich snapshot 验证 |

### 进度日志

- 2026-03-07 1) 建立执行进度区，开始按 P0 → P1 → P2 推进，并要求 dashboard 同步适配新增 metadata
- 2026-03-07 2) 完成 P0：增强 `HomebrewCollector` 与 `ApplicationsCollector`，补充对应单元测试并通过 L1/L2
- 2026-03-07 3) 完成 P1：新增 `vscode` / `docker` / `dev-toolchain` / `cloud-cli` collector，注册到默认扫描链路，并同步 dashboard metadata badge 展示
- 2026-03-07 4) 完成 P2：新增 `fonts` / `macos-defaults` / `launch-agents` collector，补充单元测试与默认注册
- 2026-03-07 5) 完成四层验证：L1 `bun run test`、L2 `bun run lint`、L3 `bun run test:e2e`、L4 `bun run test:e2e:ui`
- 2026-03-07 6) 开始补 dashboard 第二轮：为 snapshot detail 增加 collector 搜索、分类过滤和概览统计，缓解 12 个 collector 下的信息密度问题
- 2026-03-07 7) 完成 dashboard 第二轮：snapshot detail 已支持 collector 搜索、分类过滤和概览统计，并重新通过四层测试

---

## P0 — 现有采集器增强

改动最小、收益最高的项目。涉及已有 collector 的增量修改。

### P0-1. Homebrew Collector 补全

**文件**: `packages/cli/src/collectors/homebrew.ts`

**现状**:
- 只跑 `brew list --formula` 和 `brew list --cask`，输出裸包名
- `CollectedListItem.version` 字段存在于类型定义中但从未填充
- 不采集 taps

**增强项**:

#### a) 版本信息

将命令改为 `brew list --formula --versions` 和 `brew list --cask --versions`。

输出格式变化：
```
# brew list --formula
ast-grep

# brew list --formula --versions
ast-grep 0.41.0
```

解析逻辑：按空格 split，第一段为 name，其余为 version（可能有多版本共存，如 `python 3.12.1 3.11.7`，取第一个或全部拼接）。填充到 `CollectedListItem.version` 字段。

#### b) Taps 列表

新增命令 `brew tap`，输出格式：

```
alexsjones/llmfit
anomalyco/tap
bats-core/bats-core
```

每行一个 tap，解析为 `CollectedListItem`，`meta.type = "tap"`。

#### c) Pinned 包（可选）

命令 `brew list --pinned`，输出被 pin 住不自动升级的包。添加 `meta.pinned = "true"` 到对应项，或作为独立列表。

**预估工作量**: 改 1 个文件 + 改测试，约 1h。

---

### P0-2. Applications Collector 补全

**文件**: `packages/cli/src/collectors/applications.ts`

**现状**:
- 只扫描 `/Applications/`
- 不提取应用版本

**增强项**:

#### a) 扫描 `~/Applications/`

部分通过 Homebrew Cask 或手动安装的应用可能落在用户目录下（如 Chrome 的 PWA apps）。增加对 `~/Applications/` 的 readdir，合并去重。

#### b) 应用版本提取

读取 `/Applications/{name}.app/Contents/Info.plist` 中的 `CFBundleShortVersionString`：

```bash
defaults read "/Applications/Docker.app/Contents/Info.plist" CFBundleShortVersionString
```

在 Node.js 中：
```typescript
const { execSync } = require("child_process");
const version = execSync(
  `defaults read "${appsDir}/${entry.name}/Contents/Info.plist" CFBundleShortVersionString`
).toString().trim();
```

填充到 `CollectedListItem.version`。`defaults read` 失败时（某些 app 无此 key）静默忽略。

**预估工作量**: 改 1 个文件 + 改测试，约 1h。

---

## P1 — 新增采集器（开发工具链）

全新 collector，覆盖日常开发高频依赖的工具链状态。

### P1-1. DevToolchainCollector（开发工具链采集器）

**新文件**: `packages/cli/src/collectors/dev-toolchain.ts`
**ID**: `"dev-toolchain"`
**Label**: `"Development Toolchain"`
**Category**: `"environment"`

采集语言版本管理器、全局包、开发 CLI 工具的状态。全部输出为 `lists`（无文件内容）。

#### a) Node.js 版本管理器

按优先级检测安装了哪个版本管理器，仅采集已安装的：

| 管理器 | 检测方式 | 采集命令 | 输出 |
|--------|----------|----------|------|
| fnm | `which fnm` | `fnm list` | 每行格式 `* v24.13.0 default`，解析版本号 + 别名 |
| nvm | `which nvm` 或 `$NVM_DIR` | `nvm list` | 解析版本列表 |
| volta | `which volta` | `volta list all` | 解析工具+版本 |

输出示例：
```json
{ "name": "node/v24.13.0", "version": "24.13.0", "meta": { "type": "node-version", "manager": "fnm", "default": "true" } }
```

#### b) npm / Bun 全局包

| 命令 | 条件 | 输出 |
|------|------|------|
| `npm list -g --depth=0 --json` | npm 可用时 | JSON 格式，解析 `dependencies` 对象的 key/version |
| `bun pm ls -g` | bun 可用时 | 解析包名和版本 |

输出示例：
```json
{ "name": "vercel", "version": "50.22.0", "meta": { "type": "npm-global" } }
```

#### c) Rust 工具链

| 命令 | 输出 |
|------|------|
| `rustup show` | 已安装工具链（如 `stable-aarch64-apple-darwin`）+ 默认工具链 + targets |
| `cargo install --list` | 全局安装的二进制工具（如 `cargo-llvm-cov v0.8.4`） |

输出示例：
```json
{ "name": "stable-aarch64-apple-darwin", "meta": { "type": "rust-toolchain", "default": "true" } }
{ "name": "cargo-llvm-cov", "version": "0.8.4", "meta": { "type": "cargo-global" } }
```

#### d) 其他语言（按需扩展）

| 工具 | 检测 | 命令 | meta.type |
|------|------|------|-----------|
| pyenv | `which pyenv` | `pyenv versions` | `python-version` |
| rbenv | `which rbenv` | `rbenv versions` | `ruby-version` |
| Go | `which go` | `go version` | `go-version` |

**实现要点**:
- 每个子采集使用 `_execCommand` 封装，命令不存在时静默跳过（push 到 `errors` 说明未安装）
- 所有子命令独立失败，不影响其他子命令
- 不采集文件内容（如 `~/.cargo/config.toml`），避免与 ShellConfigCollector 职责重叠

**预估工作量**: 新建 1 个文件 + 测试，约 3h。

---

### P1-2. VSCodeCollector（编辑器配置采集器）

**新文件**: `packages/cli/src/collectors/vscode.ts`
**ID**: `"vscode"`
**Label**: `"VS Code / Cursor Configuration"`
**Category**: `"config"`

VS Code 和 Cursor 是最常用的编辑器。配置迁移是换机最繁琐的部分之一。

#### a) 扩展列表

**首选方式** — CLI 命令（如果 `code` 或 `cursor` 在 PATH 中）：

```bash
code --list-extensions --show-versions
```

输出格式：
```
github.copilot@1.300.0
github.copilot-chat@0.38.1
```

**回退方式** — 读 extensions 目录：

| 编辑器 | 目录 |
|--------|------|
| VS Code | `~/.vscode/extensions/` |
| Cursor | `~/.cursor/extensions/` |

目录名格式为 `publisher.extension-version`，解析即可。

同时检查 `extensions.json`（位于同目录）获取完整元数据。

输出为 `lists`：
```json
{ "name": "github.copilot-chat", "version": "0.38.1", "meta": { "type": "vscode-extension", "editor": "vscode" } }
```

#### b) 配置文件

| 编辑器 | 配置根目录 |
|--------|-----------|
| VS Code | `~/Library/Application Support/Code/User/` |
| Cursor | `~/Library/Application Support/Cursor/User/` |

采集以下文件（如存在）：

| 文件 | 说明 | 脱敏 |
|------|------|------|
| `settings.json` | 编辑器设置 | **是** — 可能包含 API key、proxy 密码 |
| `keybindings.json` | 自定义快捷键 | 否 |
| `snippets/*.json` | 用户代码片段 | 否 |

**不采集**：`globalStorage/`（含 DB 文件和缓存）、`workspaceStorage/`（含项目级别状态）。

**实现要点**:
- 同时支持 VS Code 和 Cursor，通过配置数组遍历
- macOS 专属路径（`~/Library/Application Support/`），Linux/Windows 暂不考虑
- `snippets/` 用 `collectDir` 递归，但限制 `maxFileSize` 为 128 KB

**预估工作量**: 新建 1 个文件 + 测试，约 2h。

---

### P1-3. DockerCollector（Docker 配置采集器）

**新文件**: `packages/cli/src/collectors/docker.ts`
**ID**: `"docker"`
**Label**: `"Docker Configuration"`
**Category**: `"environment"`

#### a) Docker 配置文件

| 文件 | 说明 | 脱敏 |
|------|------|------|
| `~/.docker/config.json` | Docker CLI 配置（含 registry auths、credential helpers） | **是** — `auths` 字段含 base64 编码的凭据 |

#### b) Docker Context 列表

命令 `docker context ls --format json`：

```json
{"Current":true,"Description":"Docker Desktop","DockerEndpoint":"unix:///Users/nocoo/.docker/run/docker.sock","Name":"desktop-linux"}
```

输出为 `lists`：
```json
{ "name": "desktop-linux", "meta": { "type": "docker-context", "current": "true", "endpoint": "unix:///Users/nocoo/.docker/run/docker.sock" } }
```

**不采集**：运行中的容器/镜像列表（属于运行时状态，非配置）。

**预估工作量**: 新建 1 个文件 + 测试，约 1.5h。

---

### P1-4. CloudCLICollector（云服务 CLI 配置采集器）

**新文件**: `packages/cli/src/collectors/cloud-cli.ts`
**ID**: `"cloud-cli"`
**Label**: `"Cloud CLI Configuration"`
**Category**: `"config"`

采集各云平台 CLI 工具的配置文件。**核心原则**：只采集 profile 名称和区域等结构信息，**严格脱敏**所有 token/key/session。

#### a) Azure CLI

| 文件 | 说明 | 脱敏 |
|------|------|------|
| `~/.azure/config` | CLI 配置（default subscription 等） | **是** |
| `~/.azure/azureProfile.json` | 账户 profile 列表 | **是** — 含 subscription ID、tenant ID |
| `~/.azure/clouds.config` | 云环境配置 | 否 |

**不采集**：`az.sess`（session token）、`az.json`（含 access token）。

#### b) AWS CLI（如存在）

| 文件 | 说明 | 脱敏 |
|------|------|------|
| `~/.aws/config` | profile 定义（区域、输出格式） | **是** |
| `~/.aws/credentials` | **不采集** — 纯凭据文件，没有安全的采集方式 |

仅记录 profile 名称列表（从 `config` 的 `[profile xxx]` 节解析），输出为 `lists`。

#### c) GCP CLI（如存在）

| 文件 | 说明 | 脱敏 |
|------|------|------|
| `~/.config/gcloud/properties` | 配置属性 | **是** |
| `~/.config/gcloud/configurations/` | 多配置文件 | **是** |

**不采集**：`credentials.db`、`access_tokens.db`、`application_default_credentials.json`。

#### d) Railway CLI

| 文件 | 说明 | 脱敏 |
|------|------|------|
| `~/.config/railway/config.json` | 项目配置 | **是** |

**实现要点**:
- 每个子平台独立采集，目录不存在时静默跳过
- `~/.aws/credentials` 明确排除在外，即使开了 redact 也不安全（整个文件都是凭据）
- Azure 的 `az.sess`、`az.json` 同理排除

**预估工作量**: 新建 1 个文件 + 测试，约 2h。

---

## P2 — 新增采集器（macOS 系统级）

采集 macOS 系统偏好设置和用户级配置，这些是换机后最耗时手动恢复的部分。

### P2-1. MacOSDefaultsCollector（系统偏好采集器）

**新文件**: `packages/cli/src/collectors/macos-defaults.ts`
**ID**: `"macos-defaults"`
**Label**: `"macOS System Preferences"`
**Category**: `"environment"`

**核心命令**: `defaults read <domain>` 或 `defaults export <domain> -`（输出 plist XML 到 stdout）。

推荐使用 `defaults export <domain> -` 导出 XML plist，比 `defaults read` 的文本格式更易还原。

#### 采集域列表

| 域 | 说明 | 典型内容 | 验证行数 |
|----|------|----------|----------|
| `com.apple.dock` | Dock 设置 | autohide、orientation、magnification、persistent-apps 列表 | 368 行 |
| `com.apple.finder` | Finder 设置 | ShowPathbar、ShowStatusBar、AppleShowAllFiles | 1712 行 |
| `com.apple.AppleMultitouchTrackpad` | 触控板 | Clicking、DragLock、力度 | 31 行 |
| `com.apple.driver.AppleBluetoothMultitouch.trackpad` | 蓝牙触控板 | 与上面互补 | 26 行 |
| `NSGlobalDomain` | 全局偏好 | KeyRepeat、AppleInterfaceStyle（暗色模式）、滚动方向 | 148 行 |
| `com.apple.symbolichotkeys` | 键盘快捷键 | 系统级快捷键映射 | 162 行 |
| `com.apple.screencapture` | 截图设置 | 保存位置、格式、是否显示缩略图 | 3 行 |

每个域导出为一个 `CollectedFile`：
- `path`: `macos-defaults/{domain}.plist`（虚拟路径）
- `content`: `defaults export <domain> -` 的 XML plist 输出
- 不脱敏（这些域不含凭据）

#### 登录项

命令：
```bash
osascript -e 'tell application "System Events" to get the name of every login item'
```

输出示例：`Owl, CleanShot X, Voicenotes, Raycast, ...`

解析为 `lists`，`meta.type = "login-item"`。

**实现要点**:
- Finder 域较大（1712 行），但在 512 KB 限制内
- `defaults export` 可能在无 TCC 权限时失败（如 `com.apple.Safari`），只采集上述安全域
- `osascript` 在 headless 环境可能无法执行，需静默失败

**预估工作量**: 新建 1 个文件 + 测试，约 2.5h。

---

### P2-2. LaunchAgentsCollector（启动项采集器）

**新文件**: `packages/cli/src/collectors/launch-agents.ts`
**ID**: `"launch-agents"`
**Label**: `"Launch Agents & Daemons"`
**Category**: `"environment"`

#### a) 用户 LaunchAgents 列表

目录 `~/Library/LaunchAgents/`，列出 `.plist` 文件名：

```
com.runner.scheduler.plist
homebrew.mxcl.caddy.plist
```

输出为 `lists`，`meta.type = "user-agent"`。

#### b) 用户 LaunchAgents 内容（可选）

对于感兴趣的 plist，使用 `plutil -convert xml1 -o - <file>` 转为可读 XML，采集为 `files`。

建议仅采集非 Apple、非 Google 的自定义 plist（通过 label prefix 过滤 `com.apple.*`、`com.google.*`），避免噪声。

#### c) crontab

命令 `crontab -l`，如果有内容则作为单个 `CollectedFile`（`path: crontab`），需 redact（可能包含带密码的 URL）。

**预估工作量**: 新建 1 个文件 + 测试，约 1.5h。

---

### P2-3. FontsCollector（字体采集器）

**新文件**: `packages/cli/src/collectors/fonts.ts`
**ID**: `"fonts"`
**Label**: `"Installed Fonts"`
**Category**: `"environment"`

只采集用户安装的字体（非系统内置）。

#### 采集方式

读取 `~/Library/Fonts/` 目录，列出文件名：

```
3270-Regular.ttf
Anonymice Powerline Bold Italic.ttf
CPMono_v07 Black.otf
```

输出为 `lists`：
```json
{ "name": "3270-Regular", "meta": { "type": "font", "format": "ttf" } }
```

解析文件名去掉扩展名作为 `name`，扩展名记录到 `meta.format`。

**不采集**：字体文件本身（二进制），不采集 `/System/Library/Fonts/`（系统自带，无需迁移）。

**预估工作量**: 新建 1 个文件 + 测试，约 0.5h。

---

## P3 — 低优先级增强

视场景需要再决定是否实现。

### P3-1. Raycast 扩展列表

**难点**: Raycast 扩展目录名是 UUID（如 `720ba690-c227-4168-aef1-913bc1c813fb`），无直接 CLI 导出扩展名。

**可能方案**:
- 读取 `~/Library/Application Support/com.raycast.macos/` 下的 SQLite 数据库（`raycast-activities-enc.sqlite`），但加密无法直接读取
- 读取扩展目录内的 `package.json` 获取扩展名和版本
- 等 Raycast 提供官方导出 CLI

**建议**: 暂时只列出扩展 UUID 和数量，作为参考信息。待 Raycast 有更好的导出方式后再增强。

### P3-2. 更多编辑器支持

| 编辑器 | 配置路径 | 优先级 |
|--------|----------|--------|
| Zed | `~/.config/zed/settings.json` | 低（用户量较小） |
| JetBrains | `~/Library/Application Support/JetBrains/` | 低（JetBrains 自带 Settings Sync） |
| Sublime Text | `~/Library/Application Support/Sublime Text/Packages/User/` | 低 |

### P3-3. GPG 密钥存在性检测

类似 SSH 密钥的处理方式：
```bash
gpg --list-keys --keyid-format long 2>/dev/null
```

只记录 key ID、用户名、过期时间，不导出私钥。

---

## 实施计划总览

| 编号 | 改动类型 | 标题 | 改动范围 | 预估工时 |
|------|----------|------|----------|----------|
| P0-1 | 增强 | Homebrew 补全（版本 + taps） | 改 1 文件 | 1h |
| P0-2 | 增强 | Applications 补全（版本 + ~/Applications） | 改 1 文件 | 1h |
| P1-1 | 新建 | DevToolchainCollector | 新建 1 文件 | 3h |
| P1-2 | 新建 | VSCodeCollector | 新建 1 文件 | 2h |
| P1-3 | 新建 | DockerCollector | 新建 1 文件 | 1.5h |
| P1-4 | 新建 | CloudCLICollector | 新建 1 文件 | 2h |
| P2-1 | 新建 | MacOSDefaultsCollector | 新建 1 文件 | 2.5h |
| P2-2 | 新建 | LaunchAgentsCollector | 新建 1 文件 | 1.5h |
| P2-3 | 新建 | FontsCollector | 新建 1 文件 | 0.5h |
| — | 注册 | collectors/index.ts 注册新采集器 | 改 1 文件 | 0.5h |
| — | 文档 | 更新 02-collectors.md | 改 1 文件 | 1h |
| — | 测试 | 各采集器单元测试 | 新建多文件 | 含在各项中 |

**总预估**: ~16.5h

### 实施顺序建议

```
Phase 1 (快速胜利):  P0-1 → P0-2           → 发版 patch
Phase 2 (核心扩展):  P1-1 → P1-2 → P1-3    → 发版 minor
Phase 3 (云+系统):   P1-4 → P2-1 → P2-2    → 发版 minor
Phase 4 (收尾):      P2-3 → P3-*            → 发版 minor
```

每个 Phase 完成后都是可发布状态，确保增量交付。

---

## 类型系统影响

当前 `CollectedListItem` 定义：
```typescript
interface CollectedListItem {
  name: string;
  version?: string;
  meta?: Record<string, string>;
}
```

`version` 字段已存在但从未使用。本计划大量利用该字段，无需改类型定义。

`CollectorCategory` 当前为 `"config" | "environment"`，新采集器均可归入这两类，无需扩展。

## 安全考量

- **绝不采集** `~/.aws/credentials`、`~/.azure/az.sess`、`.env` 文件
- 所有含凭据风险的文件必须开启 `redact: true`
- Docker `config.json` 的 `auths` 段含 base64 凭据，需确保 JSON redaction 能覆盖
- macOS defaults 域限定在白名单内，不采集 Safari、Mail 等可能含隐私的域
- Cloud CLI 配置只采集 profile 结构，不采集 session/token 文件

## 相关文档

- [采集器详解](./02-collectors.md)
- [安全机制](./05-security.md)
- [架构概览](./01-architecture.md)
