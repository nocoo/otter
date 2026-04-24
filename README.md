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
  <img src="https://img.shields.io/badge/Vite-6-646cff?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/Cloudflare-Worker-f38020?logo=cloudflare&logoColor=white" alt="Cloudflare Worker" />
  <img src="https://img.shields.io/badge/tests-502%20passing-brightgreen" alt="Tests" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
</p>

---

## 这是什么

Otter 是一个 macOS 开发环境的快照备份工具。它扫描你的 dotfiles、Shell 配置、Homebrew 包列表、已安装应用、AI Agent 配置等信息，生成一份 JSON 快照，通过 Webhook 上传到云端。配套的 Web 仪表盘提供快照浏览、文件对比和历史管理。

**核心思路**：你不需要备份整个硬盘 — 只需记住"开发环境长什么样"，就能随时重建。

```
CLI (macOS)                   Cloudflare (single Worker)
┌──────────────────┐          ┌──────────────────────────────┐
│  12 个采集器      │          │  Hono on Workers             │
│  Shell · Brew ·  │  Webhook │  ┌────────────────────────┐  │
│  Apps · Claude · │─────────►│  │ /api/*  → D1 binding   │  │
│  OpenCode ...    │  (gzip)  │  │ /v1/*   → 兼容老 ingest │  │
│                  │          │  │ SPA fallback (assets)  │  │
│  图标导出 · 上传  │─────────►│  └────────────────────────┘  │
└──────────────────┘          │  D1 (snapshots) + R2 (blobs) │
                              └──────────────────────────────┘
                                            ▲
                              Vite SPA (浏览器) ┤ React 19 + react-router 7
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
- **Cloudflare Access SSO** — 浏览器 SSO；CLI 走 `apiKeyAuth` Bearer token
- **暗色模式** — 跟随系统主题

## 安装

```bash
# 从 npm 全局安装
npm install -g @nocoo/otter

# 登录（浏览器 SSO 授权拿 Bearer token）
otter login

# 执行备份
otter backup
```

## 命令一览

| 命令 | 说明 |
|------|------|
| `otter login` | 浏览器 SSO 登录，铸 Bearer token |
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
│   ├── core/                        # @otter/core — 共享类型定义（零运行时依赖）
│   ├── cli/                         # @nocoo/otter — CLI 工具（npm 发布）
│   ├── api/                         # @otter/api — Hono createApp 工厂 + middleware/lib
│   ├── web/                         # @otter/web — Vite 6 SPA（React 19 + react-router 7 + SWR）
│   └── worker/                      # @otter/worker — 单一 Cloudflare Worker，托管 /api/* + SPA 静态资源
├── docs/                            # 项目文档
│   └── archive/                     # 已完成迁移计划（08 / 09）
├── scripts/                         # release.ts / run-e2e-spa.ts / verify-test-resources.ts
└── vitest.config.ts                 # 测试配置
```

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | [Bun](https://bun.sh) + Node.js (ESM) |
| 语言 | TypeScript 5.7+ (strict) |
| CLI 框架 | [citty](https://github.com/unjs/citty) (UnJS) |
| Web 框架 | [Vite 6](https://vite.dev) + [React 19](https://react.dev) + [react-router 7](https://reactrouter.com) + [SWR](https://swr.vercel.app) |
| API 框架 | [Hono](https://hono.dev) on Cloudflare Workers |
| UI | [shadcn/ui](https://ui.shadcn.com) + [Tailwind v4](https://tailwindcss.com) |
| 认证 | Cloudflare Access SSO（浏览器） + Bearer api_tokens（CLI） |
| 数据库 | [Cloudflare D1](https://developers.cloudflare.com/d1/) (binding) |
| 对象存储 | [Cloudflare R2](https://developers.cloudflare.com/r2/) (binding) |
| 语法高亮 | [Shiki](https://shiki.style) |
| 测试 | [Vitest](https://vitest.dev) + [Playwright](https://playwright.dev) + @vitest/coverage-v8 |
| 部署 | [Cloudflare Workers](https://workers.cloudflare.com)（`wrangler deploy`） |
| Git Hooks | [Husky](https://typicode.github.io/husky/) (pre-commit + pre-push) |

## 开发

### 环境要求

- **Bun** >= 1.0
- **Node.js** >= 20
- **macOS**（采集器依赖 macOS 原生命令）
- **Cloudflare Wrangler**（已 `wrangler login`，账号需挂载 `otter` worker / D1 / R2 资源）
- **本地 caddy**（可选，用 `*.dev.hexly.ai` 调试时需要本地 TLS 反代）

### 快速开始

```bash
git clone https://github.com/nocoo/otter.git && cd otter
bun install

# （可选）一键跑全部测试
bun run test
bun run lint        # tsc 全包类型检查
bun run lint:biome  # biome 格式 + lint
```

### 本地调试 Web SPA（surety 模式：vite 本地 + 线上 worker）

1. 复制 env 模板（注意：vite 从 `packages/web/` 读 .env，所以必须放这里）：
   ```bash
   cp .env.example packages/web/.env
   ```
2. 通过浏览器铸 Bearer token（先过 Cloudflare Access SSO）：
   ```
   https://otter.hexly.ai/api/auth/cli?callback=http://127.0.0.1:65535/cb&state=mint
   ```
   redirect URL 里的 `?token=otk_...` 就是 token，写到 `packages/web/.env` 的 `OTTER_DEV_API_TOKEN`。
3. 启 vite：
   ```bash
   bun run dev   # http://localhost:7019
   ```
4. （可选）配 caddy 把 `https://otter.dev.hexly.ai` 反代到 `localhost:7019`，享受 TLS 调试体验。Vite 已在 `allowedHosts` 里放行 `*.dev.hexly.ai`。

### 本地调试 Worker（bat 模式：完全本地 D1 + miniflare）

如果想完全脱离生产数据，把 `packages/web/.env` 的 `OTTER_API_URL` 改成 `http://localhost:8787`，然后另开一个终端：

```bash
bun run dev:worker   # wrangler dev --local，端口 8787，本地 D1 / R2 模拟
```

worker 的 `accessAuth` 看到 `host` 是 localhost 时会自动 stamp 成 `dev@localhost`，所以本地 dev 不需要 Bearer token。

### 部署

```bash
bun run deploy       # build SPA → wrangler deploy（生产）
bun run deploy:test  # build SPA → wrangler deploy --env test
```

`packages/web/dist` 通过 `[assets]` binding 由 worker 直接托管，所以一次 `wrangler deploy` 把 SPA 和 API 一起推上去。

### 常用命令

| 命令 | 说明 |
|------|------|
| `bun run dev` | 启动 Vite SPA dev server（`:7019`，`/api/*` 反代到 prod worker） |
| `bun run dev:worker` | （可选）`wrangler dev --local`，本地 D1/R2 模拟 |
| `bun run build` | 构建 SPA 到 `packages/web/dist` |
| `bun run deploy` | build + `wrangler deploy`（生产 worker） |
| `bun run deploy:test` | build + `wrangler deploy --env test`（test 环境） |
| `bun run test` | 502+ 单元测试（Vitest） |
| `bun run test:watch` | 监听模式 |
| `bun run test:coverage` | 覆盖率报告 |
| `bun run lint` | tsc 全包类型检查（core → cli → web → api） |
| `bun run lint:biome` / `lint:biome:fix` | Biome 检查 / 自动修 |
| `bun run test:e2e` | Playwright BDD E2E |

## 测试

502+ 单元测试 + 6 个 Playwright spec / 28 用例。质量门槛：

| 维度 | Gate | 触发 |
|------|------|------|
| G1 | Biome strict + lint-staged | pre-commit |
| L1 | Vitest 502+，覆盖率 ≥90% / 89% | pre-commit |
| tsc | TypeScript strict（4 个 tsconfig） | pre-commit |
| G2 | osv-scanner + gitleaks | pre-push |
| L2 | API E2E（real HTTP，web :17019 → api :17020） | pre-push |
| L3 | Playwright（web :27019 → api :27020） | pre-push |
| D1 | `otter-db-test` D1 + `otter-snapshots-test` R2（env override + guard + marker） | E2E runner |

## 安全机制

- **采集过滤** — 排除二进制文件、`.git`、构建产物、缓存、debug 日志
- **Shell 脱敏** — `export KEY=value` 模式自动替换为 `***REDACTED***`
- **JSON/JSONL 脱敏** — 深层遍历 JSON 结构，命中敏感 key 即脱敏
- **凭据扫描** — 值级别正则匹配（AWS key、GitHub token、npm token 等）
- **SSH 保护** — 仅记录密钥存在性，绝不采集密钥内容
- **AI 会话** — 仅保留摘要（标题、token 用量、时间戳），不含完整对话
- **传输安全** — gzip 压缩 + HTTPS Webhook
- **鉴权** — Cloudflare Access SSO（浏览器） + Bearer token（CLI）双栈，公开路由仅 `/api/live` + `/v1/live`

## 文档

| 文档 | 内容 |
|------|------|
| [架构概览](docs/01-architecture.md) | Monorepo 结构、数据流、核心类型、Web ↔ API 通信 |
| [采集器详解](docs/02-collectors.md) | BaseCollector API、12 个采集器、新增指南 |
| [开发指南](docs/03-development.md) | 环境搭建、surety/bat 两种本地模式、命令速查、Commit 规范 |
| [测试规范](docs/04-testing.md) | 覆盖率目标、测试结构、编写规范 |
| [安全机制](docs/05-security.md) | 四层安全体系、脱敏模式、审计清单 |
| [Dashboard](docs/06-dashboard.md) | Vite SPA 路由、API 端点、D1 schema |
| [采集器增强计划](docs/07-collector-enhancement-plan.md) | P0/P1/P2 采集器增强进度 |

## License

[MIT](LICENSE) © 2026
