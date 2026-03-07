# 采集器详解

> 返回 [README](../README.md) · 上一篇 [架构概览](./01-architecture.md)

## 采集器体系

Otter 当前内置 12 个采集器，均继承自 `BaseCollector` 抽象类。采集器分为两类：

| 分类 | 采集器 | 输出类型 |
|------|--------|----------|
| `config` | ClaudeConfigCollector | 文件 + 会话摘要 |
| `config` | OpenCodeConfigCollector | 文件 + 技能列表 |
| `config` | VSCodeCollector | 编辑器配置 + 扩展列表 |
| `config` | CloudCLICollector | 云 CLI 配置 + profile 列表 |
| `environment` | ShellConfigCollector | 文件 |
| `environment` | HomebrewCollector | 列表 |
| `environment` | ApplicationsCollector | 列表 |
| `environment` | DockerCollector | Docker 配置 + context 列表 |
| `environment` | FontsCollector | 用户字体列表 |
| `environment` | DevToolchainCollector | 开发工具链版本 + 全局包 |
| `environment` | MacOSDefaultsCollector | 系统偏好文件 + 登录项 |
| `environment` | LaunchAgentsCollector | 启动项列表 + crontab |

## BaseCollector 基类

**文件**: `packages/cli/src/collectors/base.ts`

提供三个核心方法：

### `safeReadFile(filePath, result, options?)`

安全读取单个文件，内置以下保护：

- **二进制过滤**：跳过已知二进制扩展名（`.sqlite`, `.png`, `.zip` 等）和特殊文件名（`.DS_Store`）
- **大小限制**：默认上限 512 KB，超限文件被跳过并记录到 `errors`
- **凭据脱敏**：设置 `redact: true` 后，自动根据文件类型进行敏感值替换

```typescript
// 选项接口
interface SafeReadOptions {
  maxSize?: number;   // 覆盖默认大小上限
  redact?: boolean;   // 是否脱敏
}
```

### `collectDir(dirPath, result, options?)`

递归采集目录下所有文件，内置以下保护：

- **目录排除**：自动跳过 `.git`, `node_modules`, `cache`, `build`, `dist` 等
- **自定义过滤**：通过 `filter` 函数按路径过滤
- **自定义排除**：通过 `excludeDirs` 添加额外排除目录
- **脱敏传递**：`redact` 选项会递归传递给每个文件

```typescript
interface CollectDirOptions {
  filter?: (filePath: string) => boolean;
  maxFileSize?: number;
  excludeDirs?: Set<string>;
  redact?: boolean;
}
```

### `timed(fn)`

包裹采集逻辑，自动计时并填入 `durationMs`。

---

## 各采集器说明

### 1. ClaudeConfigCollector

**文件**: `packages/cli/src/collectors/claude-config.ts`
**ID**: `claude-config`
**分类**: `config`

采集 Claude Code 的配置文件和会话元数据。

**采集内容**：

| 路径 | 说明 | 特殊处理 |
|------|------|----------|
| `~/CLAUDE.md` | 用户级指令文件 | — |
| `~/.claude/CLAUDE.md` | Claude 级指令文件 | — |
| `~/.claude/settings.json` | 设置（含插件列表、环境变量） | `redact: true` |
| `~/.claude/stats-cache.json` | 使用统计汇总 | — |
| `~/.claude/plugins/installed_plugins.json` | 已安装插件 | — |
| `~/.claude/plugins/blocklist.json` | 插件黑名单 | — |
| `~/.claude/history.jsonl` | 提示词历史 | `redact: true`, `maxSize: 2 MB`, `--slim` 排除 |
| `~/.claude/projects/__sessions-summary.json` | 会话摘要（合成文件） | `--slim` 排除，见下方说明 |

**会话摘要机制**：

遍历 `~/.claude/projects/*/sessions-index.json`，从每个项目的会话索引中提取轻量元数据：

- `sessionId` — 会话标识
- `firstPrompt` — 首条提示词（作为标题）
- `messageCount` — 消息数
- `created` / `modified` — 时间戳
- `gitBranch` — 关联分支
- `projectPath` — 项目路径

**不采集**：`debug/`, `telemetry/`, `transcripts/`, `cache/`, 会话 `.jsonl` 内容文件。

### 2. OpenCodeConfigCollector

**文件**: `packages/cli/src/collectors/opencode-config.ts`
**ID**: `opencode-config`
**分类**: `config`

采集 OpenCode 的配置文件和技能名称列表。

**采集内容**：

- `~/.config/opencode/` 下所有配置文件（排除 `skills/` 子目录），启用 `redact: true`
- `~/.config/opencode/skills/` 和 `~/.agents/skills/` 下的技能信息

**技能列表增强**：

每个技能目录会尝试读取 `SKILL.md` 的 YAML frontmatter，提取以下元数据到 `meta` 字段：

| meta 字段 | 来源 | 说明 |
|-----------|------|------|
| `source` | 目录路径 | `.config/opencode/skills` 或 `.agents/skills` |
| `location` | 推算 | `file://` 协议的 SKILL.md 完整路径 |
| `description` | frontmatter | 技能描述（来自 `description:` 字段） |
| `skillName` | frontmatter | 技能注册名称（来自 `name:` 字段） |

如果 SKILL.md 不存在或没有 frontmatter，仅记录 `source` 和 `location`。

### 3. ShellConfigCollector

**文件**: `packages/cli/src/collectors/shell-config.ts`
**ID**: `shell-config`
**分类**: `environment`

采集 shell 和开发环境 dotfiles。

**采集内容**：

| 文件 | 脱敏 |
|------|------|
| `.zshrc`, `.zprofile`, `.zshenv`, `.zlogin` | **是**（Shell 脚本脱敏） |
| `.bashrc`, `.bash_profile`, `.profile` | **是**（Shell 脚本脱敏） |
| `.gitconfig` | **是**（行级脱敏） |
| `.gitignore_global` | 否 |
| `.vimrc`, `.editorconfig` | 否 |
| `.tmux.conf`, `.wgetrc`, `.curlrc` | **是**（Shell 脚本脱敏） |
| `.npmrc` | **是**（行级脱敏） |
| `.yarnrc`, `.hushlogin` | 否 |
| `.netrc` | **是**（行级脱敏） |
| `.ssh/config`, `.ssh/known_hosts` | 否（不采集密钥文件） |

**SSH 密钥存在性检测**：

扫描 `~/.ssh/` 目录，将发现的密钥文件记录为 `lists`（`CollectedListItem[]`），**不读取密钥内容**：

| meta 字段 | 说明 |
|-----------|------|
| `type` | `private-key` 或 `public-key` |
| `source` | `.ssh` |
| `modifiedAt` | 文件最后修改时间（ISO 8601） |

分类逻辑（`classifySshFile` 函数）：
- `id_*` 开头 → `private-key`
- `identity` → `private-key`
- `*.pub` → `public-key`
- `config`, `known_hosts`, `authorized_keys`, `agent` 等 → 跳过

### 4. HomebrewCollector

**文件**: `packages/cli/src/collectors/homebrew.ts`
**ID**: `homebrew`
**分类**: `environment`

通过 `brew list --formula --versions`、`brew list --cask --versions`、`brew tap` 和 `brew list --pinned` 获取 Homebrew 环境信息。

- 仅输出 `lists`（`CollectedListItem[]`），不采集文件内容
- 每项含 `meta.type`（`formula`、`cask` 或 `tap`）
- formula / cask 会尽量填充 `version`
- pinned formula 会额外带上 `meta.pinned = "true"`

### 5. ApplicationsCollector

**文件**: `packages/cli/src/collectors/applications.ts`
**ID**: `applications`
**分类**: `environment`

扫描 `/Applications/` 与 `~/Applications/` 目录，收集 `.app` 目录名称列表。

- 仅输出 `lists`，不采集文件内容
- 自动去除 `.app` 后缀
- 尝试从 `Contents/Info.plist` 读取 `CFBundleShortVersionString`
- 如配置了 icon base URL，会在 `meta.iconUrl` 中输出确定性图标地址

### 6. VSCodeCollector

**文件**: `packages/cli/src/collectors/vscode.ts`
**ID**: `vscode`
**分类**: `config`

采集 VS Code 与 Cursor 的用户配置与扩展列表。

- 扩展优先通过 `code --list-extensions --show-versions` / `cursor --list-extensions --show-versions` 获取
- CLI 不可用时，回退扫描 `~/.vscode/extensions/` 与 `~/.cursor/extensions/`
- 配置文件采集 `settings.json`、`keybindings.json`、`snippets/*`
- `settings.json` 开启 `redact: true`

### 7. DockerCollector

**文件**: `packages/cli/src/collectors/docker.ts`
**ID**: `docker`
**分类**: `environment`

采集 Docker CLI 配置和 Docker contexts。

- `~/.docker/config.json` 启用 `redact: true`
- `docker context ls --format json` 解析为 `lists`

### 8. FontsCollector

**文件**: `packages/cli/src/collectors/fonts.ts`
**ID**: `fonts`
**分类**: `environment`

采集 `~/Library/Fonts/` 下的用户字体文件名。

- 仅输出 `lists`
- `meta.format` 记录字体扩展名

### 9. DevToolchainCollector

**文件**: `packages/cli/src/collectors/dev-toolchain.ts`
**ID**: `dev-toolchain`
**分类**: `environment`

采集开发工具链版本与全局工具。

- Node 管理器：`fnm list`、`volta list all`
- 全局包：`npm list -g --depth=0 --json`、`bun pm ls -g`
- Rust：`rustup show`、`cargo install --list`
- 其他语言：`pyenv versions --bare`、`rbenv versions --bare`、`go version`
- 工具缺失时记录非致命错误并继续其他子项

### 10. CloudCLICollector

**文件**: `packages/cli/src/collectors/cloud-cli.ts`
**ID**: `cloud-cli`
**分类**: `config`

采集 Azure / AWS / GCloud / Railway CLI 的安全配置子集。

- Azure: `config`、`azureProfile.json`、`clouds.config`
- AWS: 仅采集 `~/.aws/config`，并解析 profile 列表
- GCloud: `properties`、`configurations/*`
- Railway: `~/.config/railway/config.json`
- 明确排除 token / session / credentials 数据库与凭据文件

### 11. MacOSDefaultsCollector

**文件**: `packages/cli/src/collectors/macos-defaults.ts`
**ID**: `macos-defaults`
**分类**: `environment`

导出一组白名单 macOS defaults 域，并记录登录项。

- 通过 `defaults export <domain> -` 生成虚拟 plist 文件
- 通过 `osascript` 读取 login items

### 12. LaunchAgentsCollector

**文件**: `packages/cli/src/collectors/launch-agents.ts`
**ID**: `launch-agents`
**分类**: `environment`

采集用户级启动项与 crontab。

- 扫描 `~/Library/LaunchAgents/*.plist`
- `crontab -l` 输出为单个虚拟文件 `crontab`
- crontab 内容走脱敏流程

---

## 新增采集器指南

1. 在 `packages/cli/src/collectors/` 创建新文件
2. 继承 `BaseCollector`，实现 `id`, `label`, `category`, `collect()` 方法
3. 在 `collectors/index.ts` 的 `createDefaultCollectors()` 中注册
4. 编写对应单元测试（`__tests__/collectors/xxx.test.ts`）
5. **更新本文档**添加新采集器说明

## 相关文档

- [架构概览](./01-architecture.md)
- [开发指南](./03-development.md)
- [安全机制](./05-security.md)
