<p align="center">
  <img src="otter.png" alt="Otter" width="128" height="128" />
</p>

<h1 align="center">Otter</h1>

<p align="center">
  <strong>macOS 开发环境备份工具</strong><br>
  扫描 · 快照 · 云端同步 · Web 仪表盘
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS-only-2d8553?logo=apple&logoColor=white" alt="macOS" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/tests-318%20passing-brightgreen" alt="Tests" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
</p>

---

## 这是什么

Otter 是一个 macOS 开发环境的快照备份工具。它扫描你的 dotfiles、Shell 配置、Homebrew 包列表、已安装应用、AI Agent 配置等信息，生成一份 JSON 快照，通过 Webhook 上传到云端。配套的 Web 仪表盘提供快照浏览、文件对比和历史管理。

**核心思路**：你不需要备份整个硬盘 — 只需记住"开发环境长什么样"，就能随时重建。

```
CLI (macOS)                        Server (Railway)
┌──────────────────┐               ┌──────────────────────────┐
│  5 个采集器       │               │  Next.js 16 Dashboard    │
│  Shell · Brew ·  │   Webhook     │  ┌────────────────────┐  │
│  Apps · Claude · │──────────────►│  │ 快照列表 · 详情    │  │
│  OpenCode        │   (gzip)      │  │ 文件查看 · 对比    │  │
│                  │               │  │ 统计概览 · 设置    │  │
│  图标导出 · 上传  │──────────────►│  └────────────────────┘  │
│                  │   Icons API   │                          │
└──────────────────┘               │  Cloudflare D1 + R2      │
                                   └──────────────────────────┘
```

## 功能

### CLI

- **Shell 配置采集** — `.zshrc`、`.bashrc`、`.gitconfig`、`.npmrc` 等 dotfiles，敏感凭据自动脱敏
- **SSH 密钥检测** — 扫描 `~/.ssh/`，报告密钥存在性（类型 + 修改时间），不采集密钥内容
- **Claude 配置采集** — `~/.claude/` 核心配置，会话仅保留摘要（标题/token/模型），不含完整对话
- **OpenCode 配置采集** — `~/.config/opencode/` 配置和技能文件，内置凭据脱敏
- **Homebrew 采集** — formulae、casks、taps、pinned 包与版本信息
- **应用采集** — `/Applications` + `~/Applications` 应用列表、版本与图标提取
- **编辑器采集** — VS Code / Cursor 扩展、settings、keybindings、snippets
- **开发工具链采集** — Node/Bun/Rust/Python/Ruby/Go 版本与全局工具
- **Docker / Cloud CLI 采集** — Docker config + contexts，Azure/AWS/GCloud/Railway 安全配置子集
- **macOS 系统偏好采集** — Dock、Finder、快捷键、登录项、LaunchAgents、用户字体
- **图标服务端上传** — 自动提取应用图标为 PNG，通过服务端 API 存储到 R2，零配置
- **快照对比** — `otter snapshot diff` 对比两次快照的文件增删改和列表变化
- **多层安全机制** — 采集过滤 → Shell/JSON/JSONL 脱敏 → 值级凭据扫描 → gzip 压缩传输

### Web 仪表盘

- **快照浏览** — 时间线式快照列表，点击查看详情（机器信息、采集器数据、文件树）
- **文件查看器** — Shiki 语法高亮，行号、自动换行、明暗主题切换
- **统计概览** — 快照总数、活跃 Webhook 数、配置文件数、最近备份时间
- **应用图标展示** — 快照详情页展示 App 图标，含客户端哈希回退兼容
- **Webhook 管理** — 创建、编辑、删除 Webhook
- **Google OAuth** — 邮箱白名单鉴权
- **暗色模式** — 跟随系统主题

## 安装

```bash
# 从 npm 全局安装
npm install -g @nocoo/otter

# 登录（浏览器 OAuth 授权）
otter login

# 执行备份
otter backup
```

## 命令一览

| 命令 | 说明 |
|------|------|
| `otter login` | 浏览器 OAuth 登录，获取 Token |
| `otter scan` | 扫描环境，预览快照内容 |
| `otter scan --slim` | 精简模式（排除 history 和会话摘要，~130 KB） |
| `otter scan --save` | 扫描并本地保存快照 |
| `otter scan --json` | 输出 JSON 到 stdout（进度转 stderr） |
| `otter backup` | 扫描 + 上传 + 保存 + 图标同步 |
| `otter snapshot list` | 查看本地快照列表 |
| `otter snapshot show <id>` | 查看快照详情 |
| `otter snapshot diff <a> <b>` | 对比两个快照差异 |
| `otter export-icons` | 导出应用图标为 PNG |
| `otter config show` | 查看当前配置 |

## 项目结构

```
otter/
├── packages/
│   ├── core/                        # 共享类型定义 (@otter/core)
│   │   └── src/types.ts             #   Snapshot, CollectorResult, OtterConfig
│   ├── cli/                         # CLI 工具 (@nocoo/otter, npm 发布)
│   │   └── src/
│   │       ├── cli.ts               #   citty 命令注册
│   │       ├── collectors/          #   12 个采集器 + BaseCollector 基类
│   │       ├── commands/            #   scan / backup / config / snapshot
│   │       ├── snapshot/            #   快照构建器
│   │       ├── storage/             #   本地快照存储
│   │       ├── uploader/            #   Webhook + 图标上传
│   │       ├── config/              #   配置管理（dev/prod 分离）
│   │       └── utils/               #   脱敏、图标导出、工具函数
│   └── web/                         # Web 仪表盘 (@otter/web, Railway 部署)
│       ├── src/app/                 #   App Router 页面 + API 路由
│       ├── src/components/          #   UI 组件 (shadcn/ui)
│       ├── src/lib/                 #   D1 客户端、R2 存储、工具
│       ├── migrations/              #   D1 数据库迁移
│       └── e2e/                     #   E2E 测试
├── docs/                            # 项目文档
├── scripts/                         # 构建脚本、E2E 辅助
├── Dockerfile                       # 多阶段 Docker 构建
└── vitest.config.ts                 # 测试配置
```

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | [Bun](https://bun.sh) + Node.js (ESM) |
| 语言 | TypeScript 5.7+ (strict) |
| CLI 框架 | [citty](https://github.com/unjs/citty) (UnJS) |
| Web 框架 | [Next.js 16](https://nextjs.org) (App Router, Standalone) |
| UI | [shadcn/ui](https://ui.shadcn.com) + Tailwind CSS v4 |
| 认证 | NextAuth v5 (Google OAuth) |
| 数据库 | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite) |
| 对象存储 | [Cloudflare R2](https://developers.cloudflare.com/r2/) (S3 兼容) |
| 语法高亮 | [Shiki](https://shiki.style) |
| 测试 | [Vitest](https://vitest.dev) + @vitest/coverage-v8 |
| 部署 | Docker (多阶段构建) → [Railway](https://railway.com) |
| Git Hooks | [Husky](https://typicode.github.io/husky/) (pre-commit + pre-push) |

## 开发

### 环境要求

- **Bun** >= 1.0
- **Node.js** >= 18
- **macOS**（采集器依赖 macOS 原生命令）

### 快速开始

```bash
# 克隆仓库
git clone https://github.com/nocoo/otter.git && cd otter

# 安装依赖
bun install

# 构建所有包
bun run build

# 运行扫描
bun run --filter @otter/cli start -- scan
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `bun run build` | 构建所有包 |
| `bun run test` | 运行全部测试（338 tests） |
| `bun run test:watch` | 监听模式 |
| `bun run test:coverage` | 生成覆盖率报告 |
| `bun run lint` | 类型检查（tsc --noEmit） |
| `bun run test:e2e` | L3 API E2E |
| `bun run test:e2e:ui` | L4 Playwright BDD E2E |

## 测试

338 个自动化测试，四层测试架构：

| 层 | 内容 | 触发时机 |
|---|---|---|
| L1 单元测试 | 采集器、脱敏、快照构建、图标上传、API 路由 | pre-commit |
| L2 类型检查 | `tsc --noEmit`（cli + web + core） | pre-commit |
| L3 API E2E | Webhook 端到端、快照 API、健康检查 | pre-push |
| L4 BDD E2E | 完整备份流程与 dashboard metadata 展示 | 按需 |

```bash
bun run test              # L1 全部单元测试
bun run lint              # L2 类型检查
bun run test:e2e          # L3 API E2E
bun run test:e2e:ui       # L4 Playwright BDD E2E
```

## 安全机制

Otter 对敏感数据采取严格保护：

- **采集过滤** — 排除二进制文件、`.git`、构建产物、缓存、debug 日志
- **Shell 脱敏** — `export KEY=value` 模式自动替换为 `***REDACTED***`
- **JSON/JSONL 脱敏** — 深层遍历 JSON 结构，命中敏感 key 即脱敏
- **凭据扫描** — 值级别正则匹配（AWS key、GitHub token、npm token 等）
- **SSH 保护** — 仅记录密钥存在性，绝不采集密钥内容
- **AI 会话** — 仅保留摘要（标题、token 用量、时间戳），不含完整对话
- **传输安全** — gzip 压缩 + HTTPS Webhook

## 文档

| 文档 | 内容 |
|------|------|
| [架构概览](docs/01-architecture.md) | Monorepo 结构、数据流、核心类型 |
| [采集器详解](docs/02-collectors.md) | BaseCollector API、12 个采集器、新增指南 |
| [开发指南](docs/03-development.md) | 环境搭建、命令速查、Git Hooks、Commit 规范 |
| [测试规范](docs/04-testing.md) | 覆盖率目标、测试结构、编写规范 |
| [安全机制](docs/05-security.md) | 四层安全体系、脱敏模式、审计清单 |
| [Dashboard](docs/06-dashboard.md) | 服务端设计、DB Schema、API 路由 |
| [采集器增强计划](docs/07-collector-enhancement-plan.md) | P0/P1/P2 采集器增强与执行进度 |
| [Otter Worker 迁移](docs/08-worker-migration.md) | 旧 worker 回迁 + dual-stack 路由设计 |
| [Vite SPA + 单 Worker 迁移计划](docs/09-vite-spa-migration.md) | 当前迁移计划 + 16 步执行进度看板 |

## License

[MIT](LICENSE) © 2026
