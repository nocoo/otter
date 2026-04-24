# Otter Dashboard — Web SPA + Worker 设计文档

> 返回 [README](../README.md) · 上一篇 [安全机制](./05-security.md)

## 概述

Otter Dashboard 是 Otter 备份系统的 Web 端，提供快照浏览、文件查看器、Webhook 管理等功能。当前架构为 **Vite 6 SPA**（`packages/web`）+ 单一 **Cloudflare Worker**（`packages/worker`）部署，业务逻辑沉淀在 `@otter/api` 的 `createApp()` 工厂里。

> **历史背景**：早期 Dashboard 是 Next.js 16 + Railway + Google OAuth (NextAuth v5)；2026-04 完成 Vite SPA + 单 Worker 迁移（详见 [archive/09-vite-spa-migration](./archive/09-vite-spa-migration.md)）。

## 技术决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 项目位置 | `packages/web` (monorepo) | 与 `@otter/api` / `@otter/core` 共享类型 |
| 前端框架 | Vite 6 + React 19 + react-router 7 | 比 Next.js 更轻、构建更快，SSR 不是需求 |
| 数据获取 | SWR | 简洁、内置缓存与重新验证 |
| API 框架 | Hono on Cloudflare Workers | 无服务器 + binding 原生集成 D1/R2 |
| 认证（浏览器） | Cloudflare Access SSO | 复用 CF Access 应用，免维护邮箱白名单 |
| 认证（CLI） | Bearer api_tokens | `apiKeyAuth` 中间件，hashed 存 D1 |
| 数据库 | Cloudflare D1 binding | 同进程访问，免 HTTP 跳转 |
| 文件存储 | Cloudflare R2 binding | 存原始快照 JSON + 应用图标 |
| UI 基础 | shadcn/ui + Tailwind v4 | 与 sibling 项目（surety/bat）一致 |
| 部署 | `wrangler deploy` | 一次性推 SPA + worker，单域名同源 |

## 架构总览

```
┌──────────────┐                ┌──────────────────────────────────────┐
│  Otter CLI   │── Bearer ─────▶│   Single Cloudflare Worker            │
│  (用户机器)   │   /api/*       │                                       │
└──────────────┘                │   /api/* → @otter/api createApp()     │
                                │     ├── accessAuth (CF Access JWT)    │
                                │     ├── apiKeyAuth (Bearer api_tokens)│
                                │     ├── /api/live  (公开)             │
                                │     ├── /api/me                       │
                                │     ├── /api/auth/cli                 │
                                │     ├── /api/snapshots                │
                                │     └── /api/webhooks                 │
                                │                                       │
┌──────────────┐                │   /v1/*  → 老 ingest / health（兼容） │
│  浏览器       │── CF Access ──▶│                                       │
│  (Vite SPA)  │   /api/*       │   *     → [assets] binding (SPA dist) │
└──────────────┘                └─────────┬──────────┬──────────────────┘
                                          │          │
                                   ┌──────▼──┐  ┌───▼────┐
                                   │  CF D1  │  │ CF R2  │
                                   │  binding │  │ binding │
                                   └─────────┘  └────────┘
```

**两个域名都指向同一个 worker**：

| 域名 | CF Access | 默认用途 |
|---|---|---|
| `otter.hexly.ai` | 启用（SSO） | 浏览器交互；CLI mint token |
| `otter.nocoo.workers.dev` | 不启用 | Bearer-only 通道；vite proxy 默认目标 |

## D1 Schema

定义在 `packages/worker/migrations/`，由 `wrangler d1 migrations apply otter-db` 推送。

### users（CF Access 自动 upsert）

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT | PK | UUID |
| email | TEXT | UNIQUE NOT NULL | CF Access JWT 里的 email claim |
| name | TEXT | | 显示名 |
| created_at | INTEGER | NOT NULL | Unix ms |
| updated_at | INTEGER | NOT NULL | Unix ms |

### api_tokens（CLI Bearer）

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT | PK | UUID |
| user_email | TEXT | NOT NULL | 绑定到哪个用户 |
| token_hash | TEXT | UNIQUE NOT NULL | sha256(token) |
| created_at | INTEGER | NOT NULL | Unix ms |
| last_used_at | INTEGER | | 最近一次命中 |

token 仅在 mint 时返回明文（`/api/auth/cli` 302 redirect）；DB 只存 hash。

### webhooks

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT | PK | UUID |
| user_email | TEXT | NOT NULL | 所属用户 |
| token | TEXT | UNIQUE NOT NULL | URL 内嵌 token，CLI POST 时认证用 |
| label | TEXT | | 可选标签 |
| is_active | INTEGER | NOT NULL DEFAULT 1 | |
| created_at | INTEGER | NOT NULL | |
| last_used_at | INTEGER | | |

### snapshots（索引表，原始 JSON 存 R2）

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT | PK | CLI 端生成的 UUID |
| user_email | TEXT | NOT NULL | |
| webhook_id | TEXT | NOT NULL | 来源 webhook |
| hostname | TEXT | NOT NULL | |
| platform | TEXT | NOT NULL | e.g. `darwin` |
| arch | TEXT | NOT NULL | e.g. `arm64` |
| username | TEXT | NOT NULL | |
| collector_count | INTEGER | NOT NULL | |
| file_count | INTEGER | NOT NULL | |
| list_count | INTEGER | NOT NULL | |
| size_bytes | INTEGER | NOT NULL | |
| r2_key | TEXT | NOT NULL | R2 对象键 |
| snapshot_at | INTEGER | NOT NULL | CLI 端时间戳 |
| uploaded_at | INTEGER | NOT NULL | 服务端接收时间 |

## R2 存储

```
otter-snapshots                # 生产
  {user_email}/{snapshot_id}.json    # 原始快照（解压后）

otter-snapshots-test           # E2E
  ...

zhe                            # 共享 icons bucket
  apps/otter/{hash}.png        # 应用图标
```

## SPA 路由（react-router 7）

| 路径 | 页面 | 数据 |
|---|---|---|
| `/login` | 登录引导（提示走 CF Access） | — |
| `/` | Dashboard 概览（统计卡片） | SWR `/api/me` + `/api/snapshots?limit=...` |
| `/snapshots` | 快照列表 | SWR `/api/snapshots` |
| `/snapshots/:id` | 快照详情（采集器分组 + 文件树 + Shiki 查看器） | SWR `/api/snapshots/:id` |
| `/settings` | 设置（Webhook CRUD + 账户信息） | SWR `/api/me` + `/api/webhooks` |

## API 路由清单

### 公开

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/live` | 健康探针 `{"ok":true}` |
| GET | `/v1/live` | 老健康探针（向后兼容） |

### 受保护（accessEmail 或 Bearer）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/me` | 当前用户信息 |
| GET | `/api/auth/cli?callback=&state=` | accessEmail 必须，铸 Bearer 并 302 回 loopback |
| GET | `/api/snapshots` | 列表（支持 `?before=&limit=`） |
| GET | `/api/snapshots/:id` | 详情（合并 D1 metadata + R2 内容） |
| DELETE | `/api/snapshots/:id` | 删除（D1 + R2） |
| GET | `/api/webhooks` | 列表 |
| POST | `/api/webhooks` | 创建 |
| PATCH | `/api/webhooks/:id` | 编辑 |
| DELETE | `/api/webhooks/:id` | 删除 |

### Worker 直接挂载（不在 createApp 里，CLI ingest 用）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/ingest/{token}` | CLI 上传快照入口（gzip JSON） |
| POST | `/ingest/{token}/icons` | CLI 上传应用图标（base64 PNG） |
| GET | `/health` | Worker 端 health |

### Webhook 接收流程（CLI → Worker）

```
CLI: otter backup
  → POST /ingest/{token}
  → Content-Encoding: gzip, Content-Type: application/json

Worker:
  1. URL 取 token → D1 webhooks 表查 user_email
  2. 解压 gzip → 解析 JSON → Zod 校验 Snapshot 结构
  3. 存 R2: {user_email}/{snapshot.id}.json
  4. 写 D1 snapshots metadata
  5. 更新 webhooks.last_used_at
  6. 返回 201 { success: true, snapshotId }
```

### 图标上传

```
CLI: otter backup
  → POST /ingest/{token}/icons
  → body: { hash, png_base64 }

Worker:
  1. token → user_email
  2. base64 → bytes
  3. 存 R2 zhe bucket: apps/otter/{hash}.png
  4. 返回 200 { stored }
```

## 设计系统

### 品牌色 — Teal/Cyan

继承 Basalt 三层亮度体系（与 surety / bat 一致），primary 为青绿色：

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| primary | `175 75% 40%` | `175 60% 45%` |
| background (L0) | `220 14% 94%` | `0 0% 9%` |
| card (L1) | `220 14% 97%` | `0 0% 10.6%` |
| secondary (L2) | `0 0% 100%` | `0 0% 12.2%` |

### 字体

- **Body**: Inter
- **Display**: DM Sans

### 组件

- AppShell 浮岛布局（侧边栏 + 圆角内容区）
- LoadingScreen 轨道加载动画
- ThemeToggle 三态主题（system → light → dark）
- shadcn/ui primitives（button、card、dialog、sheet、table、badge、separator、tooltip、dropdown-menu、avatar、scroll-area、skeleton）

## 端口约定

| 用途 | 端口 |
|------|------|
| Vite SPA dev | 7019 |
| `wrangler dev --local`（可选） | 8787 |
| L2 API E2E（vite + wrangler） | 17019 / 17020 |
| L3 Playwright BDD（vite + wrangler） | 27019 / 27020 |

## 环境变量

| 变量 | 用途 | 适用 |
|---|---|---|
| `OTTER_API_URL` | vite proxy 目标（默认 `https://otter.nocoo.workers.dev`） | 本地 dev |
| `OTTER_DEV_API_TOKEN` | vite proxy 注入的 Bearer token | 本地 dev |
| `CF_ACCESS_TEAM_DOMAIN` | CF Access 验签 issuer | worker（wrangler.toml） |
| `CF_ACCESS_AUD` | CF Access JWT audience | worker |
| `CF_ACCOUNT_ID` | Cloudflare 账号（部分 d1-http 路径需要） | worker / scripts |
| `CF_D1_DATABASE_ID` | D1 database UUID | worker（wrangler.toml） |
| `CF_D1_TEST_DATABASE_ID` | E2E 隔离守门 | E2E runner |
| `E2E_SKIP_AUTH` | E2E 测试跳过登录 | E2E runner |

## 鉴权流程图

### 浏览器（CF Access SSO）

```
浏览器 → otter.hexly.ai/api/me
  → CF Access 拦截 → 跳 SSO → 用户登录 → CF 注入 Cf-Access-Jwt-Assertion
  → worker accessAuth: jwtVerify (JWKS) → c.set("accessEmail", payload.email)
  → 路由 requireUser(c) 通过 → 200
```

### CLI（Bearer）

```
otter login
  → 浏览器开 https://otter.hexly.ai/cli/connect?callback=http://127.0.0.1:<port>/cb
  → SPA 跳 /api/auth/cli?callback=...&state=...
  → 同样过 CF Access SSO → accessEmail 拿到
  → /api/auth/cli mint api_token → 302 回 loopback ?token=otk_...
  → CLI 接住 token → 写 ~/.config/otter/config.json

otter backup
  → POST /ingest/{token} （worker 直接挂载，不走 createApp）
  或 POST /api/snapshots Authorization: Bearer otk_...
  → apiKeyAuth: sha256(token) 比对 api_tokens.token_hash → 通过
```

## E2E 测试约定

- 独立 vite + wrangler 进程，端口隔离（17019 / 27019）
- `E2E_SKIP_AUTH=1`（accessAuth 自动 stamp dev@localhost）
- 启动前 `scripts/verify-test-resources.ts` 检查 D1 marker 表
- 启动前清理端口占用
- Snapshot detail 须展示 collector `version` 与 `meta`（如 pinned、editor、current）

## 相关文档

- [架构概览](./01-architecture.md)
- [开发指南](./03-development.md)
- [测试规范](./04-testing.md)
- [安全机制](./05-security.md)
- [archive/09-vite-spa-migration](./archive/09-vite-spa-migration.md)（迁移历史）
