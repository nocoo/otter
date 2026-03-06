# 开发指南

> 返回 [README](../README.md) · 上一篇 [采集器详解](./02-collectors.md)

## 环境准备

| 依赖 | 最低版本 |
|------|----------|
| Node.js | 18+ |
| Bun | 1.0+ |

```bash
# 克隆仓库
git clone https://github.com/<owner>/otter.git
cd otter

# 安装依赖
bun install

# 构建所有包
bun run build

# 运行测试
bun run test
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `bun run build` | 构建所有 packages（TypeScript → dist/） |
| `bun run test` | 运行全部单元测试（Vitest） |
| `bun run test:watch` | 监听模式运行测试 |
| `bun run test:coverage` | 运行测试并生成覆盖率报告 |
| `bun run lint` | TypeScript 类型检查（`tsc --noEmit`） |
| `node packages/cli/dist/bin.js scan` | 执行扫描（人类可读输出） |
| `node packages/cli/dist/bin.js scan --json` | 执行扫描（JSON 输出） |
| `node packages/cli/dist/bin.js scan --slim` | 精简模式扫描（排除 history.jsonl 等） |
| `node packages/cli/dist/bin.js scan --save` | 扫描并保存快照到本地 |
| `node packages/cli/dist/bin.js config show` | 查看当前配置 |
| `node packages/cli/dist/bin.js config set webhookUrl <url>` | 设置 Webhook 地址 |
| `node packages/cli/dist/bin.js backup` | 扫描并上传快照（自动本地保存） |
| `node packages/cli/dist/bin.js backup --slim` | 精简模式上传 |
| `node packages/cli/dist/bin.js snapshot list` | 查看本地快照列表 |
| `node packages/cli/dist/bin.js snapshot show <id>` | 查看快照详情 |
| `node packages/cli/dist/bin.js snapshot diff <id1> <id2>` | 比较两个快照差异 |
| `node packages/cli/dist/bin.js export-icons` | 导出应用图标为 PNG |

## 项目结构

```
packages/
├── core/                          # @otter/core
│   └── src/
│       ├── types.ts               # 所有接口和类型定义
│       └── index.ts               # 统一导出
└── cli/                           # @otter/cli
    └── src/
        ├── bin.ts                 # CLI 入口
        ├── cli.ts                 # 命令注册（scan / backup / config / snapshot / export-icons）
        ├── index.ts               # 库导出
        ├── collectors/
        │   ├── base.ts            # BaseCollector 抽象基类
        │   ├── claude-config.ts   # Claude Code 配置采集
        │   ├── opencode-config.ts # OpenCode 配置采集
        │   ├── shell-config.ts    # Shell dotfiles 采集
        │   ├── homebrew.ts        # Homebrew 包列表采集
        │   ├── applications.ts    # 已安装应用列表采集
        │   └── index.ts           # 采集器注册工厂
        ├── commands/
        │   ├── scan.ts            # scan 命令逻辑
        │   ├── config.ts          # config 命令逻辑
        │   └── snapshot.ts        # snapshot list/show/diff 命令逻辑
        ├── config/
        │   └── manager.ts         # 配置文件管理器
        ├── snapshot/
        │   └── builder.ts         # 快照构建器
        ├── storage/
        │   └── local.ts           # 本地快照存储（SnapshotStore）
        ├── uploader/
        │   └── webhook.ts         # Webhook 上传器
        ├── utils/
        │   ├── redact.ts          # 凭据脱敏工具
        │   └── icons.ts           # 应用图标导出工具
        └── __tests__/             # 单元测试（镜像 src 结构）
            ├── collectors/
            ├── commands/
            ├── config/
            ├── snapshot/
            ├── uploader/
            └── utils/
```

## Git Hooks

项目使用 Husky 管理 Git hooks。`pre-commit` hook 会自动执行：

1. `vitest run` — 运行全部单元测试
2. `tsc --noEmit` — TypeScript 类型检查

所有测试通过且类型检查无误后才允许提交。

## Commit 规范

遵循 **Conventional Commits** 格式：

```
<type>: <description>
```

| 类型 | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 |
| `refactor` | 重构（不改变行为） |
| `test` | 测试相关 |
| `docs` | 文档 |
| `chore` | 构建、依赖等杂务 |

**要求**：

- 祈使句，全小写，50 字符以内
- **原子化提交**：每个 commit 仅包含一个逻辑完整的变更
- 严禁混合功能与修复
- 每次 commit 后的代码必须能通过测试和构建

## 文档同步要求

**更新代码时必须同步更新相关文档**：

- 新增采集器 → 更新 [02-collectors.md](./02-collectors.md) 和 [README.md](../README.md)
- 修改安全机制 → 更新 [05-security.md](./05-security.md)
- 修改测试配置 → 更新 [04-testing.md](./04-testing.md)
- 修改架构 → 更新 [01-architecture.md](./01-architecture.md)
- 新增命令 → 更新 [README.md](../README.md) 的命令表格

## 相关文档

- [架构概览](./01-architecture.md)
- [测试规范](./04-testing.md)
- [安全机制](./05-security.md)
