# 🦦 Otter

**macOS 开发环境备份工具** — 扫描你的配置文件、dotfiles、已安装应用和包列表，生成 JSON 快照并上传至 Webhook。

> 一键备份开发环境，随时恢复到熟悉的状态。

---

## ✨ 主要功能

- 🐚 **Shell 配置采集** — `.zshrc`、`.bashrc`、`.gitconfig`、`.npmrc` 等 dotfiles，敏感凭据自动脱敏
- 🔑 **SSH 密钥检测** — 扫描 `~/.ssh/` 目录，报告密钥存在性（类型 + 修改时间），不采集密钥内容，提示用户手动备份
- 🤖 **Claude 配置采集** — 精准采集 `~/.claude/` 下的核心配置，会话仅保留摘要（标题/token/模型），不含完整对话
- 💻 **OpenCode 配置采集** — `~/.config/opencode/` 下的配置和技能文件，内置凭据脱敏，技能列表含 SKILL.md 描述和路径
- 🍺 **Homebrew 采集** — 已安装的 formulae 和 casks 列表（仅名称）
- 📱 **应用采集** — `/Applications` 目录下所有 `.app` 名称列表
- 🎨 **应用图标导出** — `otter export-icons` 命令将 app 图标提取为 PNG 文件（基于 macOS sips，无外部依赖）
- 🔒 **三层安全机制** — 采集过滤 → 内容脱敏 → 传输保护，详见 [安全文档](docs/05-security.md)
- 📦 **JSON 快照** — 压缩至 ~1 MB，支持 Webhook 上传

## 📁 项目结构

```
otter/
├── packages/
│   ├── core/          # 核心类型定义 (SnapshotData, CollectorResult, etc.)
│   └── cli/           # CLI 主包
│       ├── src/
│       │   ├── cli.ts              # 入口，citty 命令注册
│       │   ├── collectors/         # 5 个采集器 (shell, claude, opencode, homebrew, apps)
│       │   │   └── base.ts         # BaseCollector 基类
│       │   ├── snapshot/           # 快照构建器
│       │   ├── uploader/           # Webhook 上传器
│       │   ├── config/             # 配置管理
│       │   ├── utils/              # 工具函数 (redact.ts, icons.ts 等)
│       │   └── __tests__/          # 测试文件
│       └── package.json
├── docs/                           # 详细文档
├── vitest.config.ts
└── package.json                    # Bun monorepo 根配置
```

## 🚀 快速开始

### 环境要求

- **Bun** >= 1.0
- **Node.js** >= 18
- **macOS**（采集器依赖 macOS 路径）

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/user/otter.git && cd otter

# 安装依赖
bun install

# 构建所有包
bun run build

# 运行扫描（生成快照）
bun run --filter @otter/cli start -- scan
```

### 开发命令

```bash
bun run test              # 运行全部测试
bun run test:watch        # 监听模式
bun run test:coverage     # 生成覆盖率报告
bun run build             # 构建所有包
bun run lint              # 类型检查
```

### 导出应用图标

```bash
# 默认导出到 ~/.otter/icons/ (128px PNG)
otter export-icons

# 自定义输出目录和尺寸
otter export-icons --output ./my-icons --size 256
```

## 📚 详细文档

| 文档 | 内容 |
|------|------|
| [01-架构概览](docs/01-architecture.md) | Monorepo 结构、三层数据流、核心类型、技术栈 |
| [02-采集器详解](docs/02-collectors.md) | BaseCollector API、5 个采集器实现细节、新增采集器指南 |
| [03-开发指南](docs/03-development.md) | 环境搭建、命令速查、Git Hooks、Commit 规范、文档同步要求 |
| [04-测试规范](docs/04-testing.md) | 覆盖率目标、测试结构、编写规范、当前统计 |
| [05-安全机制](docs/05-security.md) | 三层安全体系、脱敏模式、SSH 保护、安全审计清单 |

## 🛠️ 技术栈

- **运行时**: Bun + Node.js (ESM)
- **语言**: TypeScript 5.7+ (strict)
- **CLI 框架**: [citty](https://github.com/unjs/citty)
- **日志**: [consola](https://github.com/unjs/consola) + [picocolors](https://github.com/alexeyraspopov/picocolors)
- **测试**: [Vitest](https://vitest.dev/) + @vitest/coverage-v8
- **包管理**: Bun workspaces (monorepo)
- **Git Hooks**: [Husky](https://typicode.github.io/husky/)

---

## 🤖 Agent 须知

> 以下内容面向 AI Agent（Claude / OpenCode 等），人类开发者可忽略。

### 核心规则

1. **代码变更必须同步更新对应文档**，文档位于 `docs/` 目录
2. **单元测试覆盖率目标: 90%**，运行 `bun run test:coverage` 验证
3. **原子化 Commit**：每个 Commit 仅包含一个逻辑完整的变更，遵循 Conventional Commits 格式
4. **安全红线**：严禁在快照中包含明文凭据，所有敏感字段必须经过 `redact.ts` 脱敏
5. **采集约束**：
   - Applications / Homebrew 采集器仅产出名称列表，不含文件内容
   - 禁止采集二进制文件、`.git` 目录、构建产物、debug 日志、缓存文件
   - AI 会话数据仅保留摘要（标题、token/模型用量、时间戳），不含完整对话

### 开发流程

```
修改代码 → 运行 bun run lint → 运行 bun run test → 更新文档 → git commit
```

### 关键文件速查

| 用途 | 路径 |
|------|------|
| 核心类型 | `packages/core/src/types.ts` |
| 采集器基类 | `packages/cli/src/collectors/base.ts` |
| 凭据脱敏 | `packages/cli/src/utils/redact.ts` |
| 图标导出 | `packages/cli/src/utils/icons.ts` |
| 快照构建 | `packages/cli/src/snapshot/builder.ts` |
| 测试配置 | `vitest.config.ts` |

---

## 📄 License

[MIT](LICENSE)
