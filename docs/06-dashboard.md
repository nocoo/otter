# Otter Dashboard — 服务端设计文档

> 返回 [README](../README.md) · 上一篇 [安全机制](./05-security.md)

## 概述

Otter Dashboard 是 Otter 备份系统的 Web 服务端，提供 Webhook 接收、快照浏览和管理功能。作为 `packages/web` 包存在于现有 monorepo 中，与 `@otter/core` 共享类型定义。

## 技术决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 项目位置 | `packages/web` (monorepo) | 与 core 包共享类型，开发效率高 |
| 框架 | Next.js 16 + App Router | 与团队其他项目一致 (Surety, Backy) |
| 运行时 | Bun | 性能优异，与 CLI 包统一 |
| 认证 | Google OAuth + NextAuth v5 | 成熟可靠，邮箱白名单控制访问 |
| 数据库 | Cloudflare D1 (REST API) | Serverless SQLite，免运维，适合 SaaS |
| 文件存储 | Cloudflare R2 (REST API) | S3 兼容，存储快照原始 JSON |
| UI 基础 | Basalt 设计系统 | shadcn/ui + Tailwind v4 + 三层亮度体系 |
| 品牌色 | Teal/Cyan 青绿色 | 水獭主题，清新自然 |
| Webhook 认证 | URL 内含 Token | `/api/webhook/<token>`，CLI 无需改 header |
| 部署 | Railway (Docker standalone) | 统一部署平台 |

## 架构总览

```
┌──────────────┐          ┌──────────────────────────────────┐
│  Otter CLI   │──POST──▶│  Next.js 16 (Railway Container)  │
│  (用户机器)   │          │                                  │
└──────────────┘          │  /api/webhook/[token]            │
                          │    ├── 验证 token (D1)            │
                          │    ├── 解压 gzip → 解析 JSON      │
                          │    ├── 存原始 JSON → R2           │
                          │    └── 写索引 metadata → D1       │
                          │                                  │
┌──────────────┐          │  /api/snapshots, /api/webhooks   │
│  浏览器       │──────────│    ├── NextAuth 鉴权              │
│  Dashboard   │          │    ├── 读 D1 索引                 │
│              │◀─────────│    └── 读 R2 文件内容              │
└──────────────┘          └──────────┬──────────┬────────────┘
                                     │          │
                              ┌──────▼──┐  ┌───▼────┐
                              │  CF D1  │  │ CF R2  │
                              │ (元数据) │  │ (快照)  │
                              └─────────┘  └────────┘
```

## 数据库 Schema (Cloudflare D1)

### users

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | NextAuth 生成 |
| email | TEXT | UNIQUE, NOT NULL | 登录邮箱 |
| name | TEXT | | 显示名 |
| image | TEXT | | 头像 URL |
| created_at | INTEGER | NOT NULL | Unix ms |
| updated_at | INTEGER | NOT NULL | Unix ms |

### webhooks

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | UUIDv4 |
| user_id | TEXT | FK → users, NOT NULL | 所属用户 |
| token | TEXT | UNIQUE, NOT NULL | URL-safe random 32 chars |
| label | TEXT | | 可选名称 |
| is_active | INTEGER | NOT NULL, DEFAULT 1 | 布尔值 |
| created_at | INTEGER | NOT NULL | Unix ms |
| last_used_at | INTEGER | | 最近一次上传时间 |

### snapshots (索引表，原始 JSON 存 R2)

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | 来自 CLI 快照 UUID |
| user_id | TEXT | FK → users, NOT NULL | 所属用户 |
| webhook_id | TEXT | FK → webhooks, NOT NULL | 来源 Webhook |
| hostname | TEXT | NOT NULL | 机器名 |
| platform | TEXT | NOT NULL | e.g. "darwin" |
| arch | TEXT | NOT NULL | e.g. "arm64" |
| username | TEXT | NOT NULL | 机器用户名 |
| collector_count | INTEGER | NOT NULL | 采集器数量 |
| file_count | INTEGER | NOT NULL | 文件总数 |
| list_count | INTEGER | NOT NULL | 列表项总数 |
| size_bytes | INTEGER | NOT NULL | 原始 JSON 大小 |
| r2_key | TEXT | NOT NULL | R2 对象键 |
| snapshot_at | INTEGER | NOT NULL | 快照创建时间 (CLI) |
| uploaded_at | INTEGER | NOT NULL | 服务端接收时间 |

### settings

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| key | TEXT | PK | 设置键名 |
| value | TEXT | NOT NULL | 设置值 |

## R2 存储结构

```
Snapshots bucket (configurable, e.g. otter-snapshots)
  {user_id}/{snapshot_id}.json     # 原始完整 JSON，解压后存储

Icons bucket (configurable, expected: zhe)
  apps/otter/{hash}.png            # 正式应用图标公开对象（供 s.zhe.to/apps/otter/* 读取）
```

## 页面结构

```
/login              # BadgeLogin 风格登录页 (Google OAuth)
/                   # Dashboard 首页 (概览统计卡片)
/snapshots          # 备份列表页 (表格: ID、机器名、采集器数、文件数、时间、大小)
/snapshots/[id]     # 备份详情页 (采集器分组 → 文件列表 → JSON 内容查看器)
/settings           # 设置页 (Webhook 管理 + 账户信息)
```

## API 路由设计

### 公开路由 (Token 鉴权)

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/webhook/[token]` | POST | CLI 上传入口，gzip JSON body |
| `/api/live` | GET | Health check |

### 受保护路由 (NextAuth 鉴权)

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/auth/[...nextauth]` | GET, POST | NextAuth handlers |
| `/api/snapshots` | GET | 快照列表 (分页, 排序) |
| `/api/snapshots/[id]` | GET | 快照详情 (从 R2 取完整 JSON) |
| `/api/webhooks` | GET, POST | 列出/创建 Webhook |
| `/api/webhooks/[id]` | DELETE, PATCH | 删除/启用/禁用 Webhook |
| `/api/settings` | GET, POST | 用户设置 |

### Webhook 接收流程

```
CLI: otter backup
  → POST /api/webhook/{token}
  → Content-Encoding: gzip, Content-Type: application/json

Server:
  1. 从 URL 提取 token → D1 查询 webhooks 表验证 → 获取 user_id
  2. 解压 gzip → 解析 JSON → Zod 验证 Snapshot 结构
  3. 存 R2 snapshots bucket: {user_id}/{snapshot.id}.json
  4. 写 D1 snapshots 表: 提取 metadata (hostname, 文件数等)
  5. 更新 webhooks.last_used_at
  6. 返回 201 { success: true, snapshotId }

图标上传流程：

```
CLI: otter backup
  → POST /api/webhook/{token}/icons

Server:
  1. 验证 webhook token
  2. 解码 base64 PNG
  3. 存 R2 icons bucket:
     - production / dev: zhe/apps/otter/{hash}.png
  4. 返回 200 { stored }
```
```

## 设计系统

### 品牌色 — Teal/Cyan

继承 Basalt 三层亮度体系，将 primary 色替换为青绿色：

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| primary | `175 75% 40%` | `175 60% 45%` |
| background (L0) | `220 14% 94%` | `0 0% 9%` |
| card (L1) | `220 14% 97%` | `0 0% 10.6%` |
| secondary (L2) | `0 0% 100%` | `0 0% 12.2%` |

### 字体

- **Body**: Inter
- **Display**: DM Sans (via `font-display` utility)

### 组件

从 Basalt/Surety 移植的核心组件：
- BadgeLogin 登录页 (换 Otter Logo + Teal 主色)
- AppShell 浮岛布局 (侧边栏 + 圆角内容区)
- LoadingScreen 轨道加载动画
- ThemeToggle 三态主题切换 (system → light → dark)

## 四层测试架构

遵循团队标准的四层测试体系，从项目初始化就建立完整的质量保障：

### L1: 单元测试 (UT)

- **框架**: Vitest (与 CLI 包统一)
- **覆盖率**: ≥ 90% (statements, branches, functions, lines)
- **触发**: pre-commit hook
- **范围**:
  - Cloudflare D1/R2 客户端封装 (mock HTTP)
  - Webhook token 验证逻辑
  - Snapshot metadata 提取逻辑
  - Zod schema 验证
  - 工具函数

### L2: Lint (类型检查 + ESLint)

- **工具**: TypeScript strict + ESLint 9 (flat config)
- **标准**: 零错误零警告
- **触发**: pre-commit hook

### L3: API E2E

- **框架**: 自定义 BDD runner (参考 Backy)
- **范围**: 100% 的 RESTful API route/method 组合
- **端口**: dev=7030, L3=17030
- **触发**: pre-push hook
- **特点**:
  - Mock Cloudflare API (D1/R2)
  - 测试 Webhook 接收完整流程
  - 测试鉴权 (有效/无效 token)

### L4: BDD E2E (UI)

- **框架**: Playwright (Chromium)
- **端口**: L4=27030
- **触发**: 按需执行
- **范围**:
  - 登录流程
  - 快照列表浏览
  - 快照详情查看
  - Webhook 生成与管理
  - 设置页操作

### Husky Git Hooks

| Hook | 执行内容 |
|------|---------|
| pre-commit | L1 (UT + 覆盖率门禁 ≥90%) + L2 (Lint) |
| pre-push | L3 (API E2E) |

### E2E 测试约定

- 独立 Dev Server，端口隔离
- `E2E_SKIP_AUTH=1` 环境变量绕开登录
- 启动前检查端口占用，已占用则先清理
- Snapshot detail 需展示 collector `version` 与 `meta`（如 pinned、editor、current）

## 分阶段实施计划

### 阶段一：静态 Dashboard + 登录 ← 当前目标

> 目标：完成所有页面的静态骨架和登录逻辑，纯占位数据，不对接 Cloudflare。

| # | Commit | 内容 | 测试 |
|---|--------|------|------|
| 1 | `feat: scaffold packages/web with Next.js 16 + Bun` | 初始化项目骨架，package.json, tsconfig, next.config.ts, Dockerfile | 构建通过 |
| 2 | `feat: add Basalt design system with Teal/Cyan theme` | globals.css (三层亮度 + Teal 品牌色 + 24 色图表), palette.ts, fonts, cn() util | L2 通过 |
| 3 | `feat: add shadcn/ui primitives` | button, card, input, dialog, sheet, table, badge, separator, tooltip, dropdown-menu, avatar, scroll-area, skeleton | L2 通过 |
| 4 | `feat: add AppShell layout with sidebar` | DashboardLayout, AppSidebar, ThemeToggle, PageIntro, 侧边栏导航配置 | L1 + L2 |
| 5 | `feat: add BadgeLogin page` | 登录页 UI (Otter logo + badge 卡片 + Google 按钮), 纯静态无 auth | L1 + L2 |
| 6 | `feat: add Google OAuth with NextAuth v5` | auth.ts, proxy.ts, AuthProvider, API route, 邮箱白名单, 安全 cookie 配置 | L1 + L2 |
| 7 | `feat: add dashboard home page with static cards` | 概览页 (备份数量、最近备份时间、机器数量等占位统计卡片) | L1 + L2 |
| 8 | `feat: add snapshots list page with static data` | 快照列表表格 (占位数据: ID、机器名、采集器数、文件数、时间、大小) | L1 + L2 |
| 9 | `feat: add snapshot detail page with JSON viewer` | 快照详情页 (采集器分组 → 文件列表 → JSON 内容查看器), 占位数据 | L1 + L2 |
| 10 | `feat: add settings page with webhook management` | 设置页 (Webhook 卡片: 生成/删除/复制 CLI 命令 + 账户信息), 占位数据 | L1 + L2 |
| 11 | `feat: add Dockerfile and Railway deployment config` | 多阶段 Docker 构建, standalone output, 端口 7030 | 构建通过 |
| 12 | `feat: add loading screen and 404 page` | 轨道加载动画 + NotFound 页面 | L1 + L2 |
| 13 | `chore: add Husky hooks for packages/web` | pre-commit (UT + Lint), pre-push 准备 (占位) | Hook 运行正常 |

### 阶段二：Cloudflare 对接 + 真实数据

| # | Commit 方向 | 内容 |
|---|------------|------|
| 1 | D1 客户端封装 | REST API 封装 + 指数退避重试 + 类型安全 |
| 2 | R2 客户端封装 | @aws-sdk/client-s3 + upload/download/presigned URL |
| 3 | D1 Schema 迁移 | 建表 SQL (users, webhooks, snapshots, settings) |
| 4 | Webhook 接收 API | token 鉴权 + gzip 解压 + R2 存储 + D1 写入 |
| 5 | 快照列表/详情 API | 分页查询 D1 + R2 读取 JSON |
| 6 | Webhook 管理 API | CRUD + token 生成 |
| 7 | 页面对接真实数据 | 替换占位数据为 API 调用 |
| 8 | L3 API E2E | 全部 API route 覆盖 |
| 9 | L4 BDD E2E | 核心主干流程 Playwright 测试 |

### 阶段三：增强功能

- 快照 Diff 对比 (两次备份之间的变化)
- 机器管理 (按 hostname 分组)
- 备份过期提醒通知
- CLI 改造: 对接新 Webhook URL 格式

## 端口约定

| 用途 | 端口 |
|------|------|
| Dev Server | 7030 |
| API E2E (L3) | 17030 |
| BDD E2E (L4) | 27030 |

## 环境变量

| 变量 | 用途 | 必填 |
|------|------|------|
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | 是 |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Secret | 是 |
| `NEXTAUTH_SECRET` | NextAuth 加密密钥 | 是 |
| `NEXTAUTH_URL` | NextAuth 回调 URL | 生产环境是 |
| `ALLOWED_EMAILS` | 邮箱白名单 (逗号分隔) | 是 |
| `CF_ACCOUNT_ID` | Cloudflare Account ID | 阶段二 |
| `CF_D1_DATABASE_ID` | D1 数据库 ID | 阶段二 |
| `CF_D1_API_TOKEN` | D1 API Token | 阶段二 |
| `CF_R2_BUCKET` | R2 Bucket 名称 | 阶段二 |
| `CF_R2_ACCESS_KEY_ID` | R2 Access Key | 阶段二 |
| `CF_R2_SECRET_ACCESS_KEY` | R2 Secret Key | 阶段二 |
| `CF_R2_ENDPOINT` | R2 S3-compatible endpoint | 阶段二 |
| `E2E_SKIP_AUTH` | E2E 测试跳过登录 | 测试环境 |
| `NODE_ENV` | 环境标识 | — |

## 项目目录结构 (目标)

```
packages/web/
├── public/
│   ├── logo-24.png              # 侧边栏 logo
│   ├── logo-80.png              # 登录页 logo
│   └── favicon.ico
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   ├── live/route.ts
│   │   │   ├── webhooks/route.ts
│   │   │   ├── webhooks/[id]/route.ts
│   │   │   ├── webhook/[token]/route.ts    # CLI 上传入口
│   │   │   ├── snapshots/route.ts
│   │   │   ├── snapshots/[id]/route.ts
│   │   │   └── settings/route.ts
│   │   ├── login/page.tsx
│   │   ├── snapshots/page.tsx
│   │   ├── snapshots/[id]/page.tsx
│   │   ├── settings/page.tsx
│   │   ├── page.tsx                        # Dashboard 首页
│   │   ├── layout.tsx                      # Root layout
│   │   ├── not-found.tsx
│   │   └── globals.css                     # 设计 tokens
│   ├── auth.ts                             # NextAuth v5 config
│   ├── proxy.ts                            # Next.js 16 proxy (替代 middleware)
│   ├── components/
│   │   ├── ui/                             # shadcn/ui primitives
│   │   ├── layout/                         # AppShell, Sidebar, Breadcrumbs
│   │   ├── auth-provider.tsx
│   │   └── loading-screen.tsx
│   ├── lib/
│   │   ├── utils.ts                        # cn() helper
│   │   ├── palette.ts                      # 图表调色板
│   │   └── cf/                             # Cloudflare 客户端 (阶段二)
│   │       ├── d1.ts
│   │       └── r2.ts
│   └── hooks/
│       └── use-mobile.tsx
├── e2e/                                    # Playwright E2E (阶段二)
├── Dockerfile
├── next.config.ts
├── tsconfig.json
├── components.json                         # shadcn/ui config
└── package.json
```

---

## 进度追踪

### 阶段一进度

- [ ] #1 项目骨架初始化
- [ ] #2 Basalt 设计系统 + Teal 主题
- [ ] #3 shadcn/ui 组件
- [ ] #4 AppShell 布局 + 侧边栏
- [ ] #5 BadgeLogin 登录页
- [ ] #6 Google OAuth 认证
- [ ] #7 Dashboard 首页
- [ ] #8 快照列表页
- [ ] #9 快照详情页
- [ ] #10 设置页
- [ ] #11 Dockerfile + 部署配置
- [ ] #12 加载动画 + 404 页面
- [ ] #13 Husky Hooks 配置
