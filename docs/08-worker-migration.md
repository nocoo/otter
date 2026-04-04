# Otter Worker 迁移方案

> 返回 [README](../README.md) · 上一篇 [Collector Enhancement Plan](./07-collector-enhancement-plan.md)

## 概述

将 Otter Dashboard 的数据访问层从「Next.js 直连 Cloudflare D1/R2 REST API」迁移到「Cloudflare Worker 原生绑定 + Next.js 调用 Worker」架构。同时新增聚合 API 支持丰富的 Dashboard 可视化。

## 迁移动机

| 问题 | 影响 | Worker 方案优势 |
|------|------|----------------|
| D1 REST API 延迟高 | 每次查询 200-500ms | 原生绑定 <10ms |
| R2 S3 API 需认证开销 | 每次请求携带签名 | 原生绑定零开销 |
| 无法批量查询 | batch() 实际串行执行 | 原生 D1 支持真正批量 |
| 缺少聚合 API | Dashboard 只能展示基础统计 | Worker 可预计算分析数据 |
| Ingest 路径冗长 | CLI → Railway → CF API | CLI → Worker (边缘直连) |

## 目标架构

```
┌──────────────┐                              ┌─────────────────────────┐
│  Otter CLI   │──POST─────────────────────▶│  Cloudflare Worker      │
│  (用户机器)   │  /ingest/{token}            │  api.otter.hexly.ai     │
└──────────────┘                              │                         │
                                              │  Hono Framework         │
┌──────────────┐   fetch + API Key            │  ├── /ingest/{token}   │
│  Next.js     │──────────────────────────────│  ├── /v1/snapshots     │
│  (Railway)   │                              │  ├── /v1/webhooks      │
│              │◀─────────────────────────────│  ├── /v1/analytics     │
│  NextAuth    │   JSON responses             │  └── /health           │
│  React Pages │                              │                         │
└──────────────┘                              │  Native Bindings:       │
                                              │  ├── D1 (otter-db)     │
                                              │  └── R2 (otter-snaps)  │
                                              └─────────────────────────┘
```

## 新增 `packages/worker`

### 目录结构

```
packages/worker/
├── src/
│   ├── index.ts              # Hono app 入口
│   ├── routes/
│   │   ├── ingest.ts         # POST /ingest/{token} (CLI 上传)
│   │   ├── icons.ts          # POST /ingest/{token}/icons
│   │   ├── snapshots.ts      # GET /v1/snapshots, /v1/snapshots/{id}
│   │   ├── webhooks.ts       # CRUD /v1/webhooks
│   │   ├── analytics.ts      # GET /v1/analytics/*
│   │   └── health.ts         # GET /health
│   ├── middleware/
│   │   ├── api-key.ts        # X-API-Key 验证 (Next.js → Worker)
│   │   └── user-context.ts   # X-User-ID 头提取
│   ├── services/
│   │   ├── snapshot.ts       # D1 + R2 快照操作
│   │   ├── webhook.ts        # D1 webhook 操作
│   │   └── analytics.ts      # 聚合计算逻辑
│   └── types.ts              # Env bindings 类型
├── wrangler.toml
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### wrangler.toml

```toml
name = "otter-api"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[[d1_databases]]
binding = "DB"
database_name = "otter-db"
database_id = "xxx"  # 从 CF Dashboard 获取

[[r2_buckets]]
binding = "SNAPSHOTS"
bucket_name = "otter-snapshots"

[[r2_buckets]]
binding = "ICONS"
bucket_name = "zhe"  # 共享 icon bucket

[vars]
ICON_PREFIX = "apps/otter"

# 生产环境 secrets (通过 wrangler secret put)
# API_KEY = "xxx"  # Next.js 调用 Worker 的密钥
```

### Hono App 入口

```typescript
// src/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ingestRoutes } from "./routes/ingest";
import { snapshotRoutes } from "./routes/snapshots";
import { webhookRoutes } from "./routes/webhooks";
import { analyticsRoutes } from "./routes/analytics";
import { healthRoutes } from "./routes/health";
import { apiKeyMiddleware } from "./middleware/api-key";

type Bindings = {
  DB: D1Database;
  SNAPSHOTS: R2Bucket;
  ICONS: R2Bucket;
  API_KEY: string;
  ICON_PREFIX: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Global middleware
app.use("*", logger());
app.use("*", cors({ origin: "*" }));  // Worker 端跨域

// Public routes (token-based auth in route)
app.route("/ingest", ingestRoutes);
app.route("/health", healthRoutes);

// Protected routes (API key required)
app.use("/v1/*", apiKeyMiddleware);
app.route("/v1/snapshots", snapshotRoutes);
app.route("/v1/webhooks", webhookRoutes);
app.route("/v1/analytics", analyticsRoutes);

export default app;
```

## Worker API 路由设计

### 1. Ingest 路由 (Token 鉴权)

| 路由 | 方法 | 说明 |
|------|------|------|
| `/ingest/{token}` | POST | CLI 快照上传 (gzip JSON) |
| `/ingest/{token}/icons` | POST | CLI 图标上传 (base64 PNG) |

#### Ingest 行为规格 (迁移验收标准)

以下行为必须与现有实现完全一致，否则视为行为回归：

**快照上传 `/ingest/{token}`**:

| 行为 | 规格 | 现有实现参考 |
|------|------|--------------|
| gzip 自动解压 | 检查 `Content-Encoding: gzip`，自动 gunzip | `gunzipSync(Buffer.from(rawBody))` |
| 非 gzip 支持 | 无 Content-Encoding 时直接解析 | `new TextDecoder().decode(rawBody)` |
| 格式验证 | 验证 `version=1`, `id`, `createdAt`, `machine`, `collectors` | `isValidSnapshot()` 结构校验 |
| R2 存储路径 | `{userId}/{snapshotId}.json` | `snapshotKey(userId, snapshotId)` |
| 存储顺序 | **R2 先写，D1 后入库** (确保 R2 成功才写元数据) | 先 `putSnapshot`，后 `batch([INSERT, UPDATE])` |
| D1 元数据 | 提取 hostname, platform, arch, username, counts, sizeBytes | `extractMetadata(snapshot)` |
| Webhook 更新 | 同时更新 `webhooks.last_used_at` | batch 内 UPDATE |
| 成功响应 | `201 { success: true, snapshotId }` | — |
| Token 无效 | `401 { error: "Invalid webhook token" }` | — |
| Webhook 禁用 | `403 { error: "Webhook is disabled" }` | `is_active !== 1` |
| 解压失败 | `400 { error: "Failed to decompress request body" }` | — |
| JSON 无效 | `400 { error: "Invalid JSON body" }` | — |
| 格式无效 | `400 { error: "Invalid snapshot format" }` | — |
| R2 失败 | `500 { error: "Failed to store snapshot" }` | — |
| D1 失败 | `500 { error: "Failed to index snapshot" }` | — |

**图标上传 `/ingest/{token}/icons`**:

| 行为 | 规格 | 现有实现参考 |
|------|------|--------------|
| 批量上传 | `{ icons: [{ hash, data }] }` | 数组批量处理 |
| Hash 格式 | 12 位 hex (`/^[a-f0-9]{12}$/`) | `ICON_HASH_PATTERN` |
| 数量限制 | 最多 500 个/请求 | `MAX_ICONS_PER_REQUEST = 500` |
| 大小限制 | 单个 base64 最大 150KB | `MAX_ICON_BASE64_SIZE = 150_000` |
| R2 存储路径 | `{prefix}/{hash}.png` (prefix 默认 `apps/otter`) | `iconKey(hash, prefix)` |
| Cache-Control | `public, max-age=31536000, immutable` | `putIcon()` |
| 并发上传 | `Promise.all()` 并行写入 | — |
| 部分失败 | `207 { stored: N, errors: [...] }` | 有失败时返回 207 |
| 全部成功 | `200 { stored: N }` | — |
| 空数组 | `200 { stored: 0 }` | — |
| 超量 | `400 { error: "Too many icons (max 500)" }` | — |
| 超大 | `400 { error: "Icon {hash} exceeds size limit" }` | — |

### 2. Snapshots 路由 (API Key 鉴权)

| 路由 | 方法 | 说明 |
|------|------|------|
| `/v1/snapshots` | GET | 列表 (分页, 排序) |
| `/v1/snapshots/{id}` | GET | 详情 (D1 元数据 + R2 全量) |
| `/v1/snapshots/{id}` | DELETE | 删除 (D1 + R2) |

### 3. Webhooks 路由 (API Key 鉴权)

| 路由 | 方法 | 说明 |
|------|------|------|
| `/v1/webhooks` | GET | 列表 |
| `/v1/webhooks` | POST | 创建 |
| `/v1/webhooks/{id}` | PATCH | 更新 |
| `/v1/webhooks/{id}` | DELETE | 删除 |

### 4. Analytics 路由 (API Key 鉴权) — **新增**

| 路由 | 方法 | 说明 | 数据源 |
|------|------|------|--------|
| `/v1/analytics/overview` | GET | 聚合概览 | D1 |
| `/v1/analytics/platform-distribution` | GET | 平台分布 | D1 |
| `/v1/analytics/arch-distribution` | GET | 架构分布 | D1 |
| `/v1/analytics/host-distribution` | GET | 主机分布 | D1 |
| `/v1/analytics/size-trend` | GET | 大小趋势 (近30条) | D1 |
| `/v1/analytics/count-trend` | GET | 文件/列表数趋势 | D1 |
| `/v1/analytics/latest-breakdown` | GET | 最新快照详细分析 | D1 + R2 |

**共 7 个聚合端点。**

#### Analytics Overview 响应示例

```json
{
  "totalSnapshots": 156,
  "totalSize": 52428800,
  "uniqueHosts": 3,
  "lastBackupAt": 1712345678000,
  "platformDistribution": [
    { "name": "darwin", "value": 150 },
    { "name": "linux", "value": 6 }
  ],
  "archDistribution": [
    { "name": "arm64", "value": 140 },
    { "name": "x64", "value": 16 }
  ]
}
```

#### Latest Breakdown 响应示例

```json
{
  "snapshotId": "abc-123",
  "snapshotAt": 1712345678000,
  "collectors": [
    { "id": "homebrew", "label": "Homebrew", "fileCount": 0, "listCount": 280 },
    { "id": "applications", "label": "Applications", "fileCount": 0, "listCount": 156 },
    { "id": "vscode", "label": "VS Code", "fileCount": 3, "listCount": 85 },
    { "id": "fonts", "label": "Fonts", "fileCount": 0, "listCount": 120 }
  ],
  "topBrewPackages": [
    { "name": "node", "value": 1 },
    { "name": "git", "value": 1 }
  ],
  "topVscodeExtensions": [
    { "name": "GitHub.copilot", "value": 1 },
    { "name": "esbenp.prettier-vscode", "value": 1 }
  ],
  "devToolchain": {
    "nodeVersions": ["v22.0.0", "v20.12.0"],
    "npmGlobals": ["pnpm", "typescript", "eslint"],
    "cargoGlobals": ["cargo-watch", "sccache"]
  }
}
```

### 5. Health 路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 (ping D1) |

## 鉴权策略

### 安全边界 (强制约束)

> ⚠️ **核心原则**: Worker 只接受服务端调用，浏览器永远不直连 Worker。

```
┌─────────────────────────────────────────────────────────────────────┐
│                        安全边界                                      │
├─────────────────────────────────────────────────────────────────────┤
│  ✅ 允许的调用路径:                                                  │
│     • Next.js API Routes (服务端) → Worker                          │
│     • Otter CLI (本地命令行) → Worker /ingest/{token}               │
│                                                                      │
│  ❌ 禁止的调用路径:                                                  │
│     • 浏览器 → Worker (任何路由)                                     │
│     • 前端 JavaScript → Worker                                       │
│                                                                      │
│  🔑 密钥持有:                                                        │
│     • WORKER_API_KEY 只存在于 Next.js 服务端环境变量                 │
│     • 浏览器/前端代码永远不持有 WORKER_API_KEY                       │
│     • CLI 使用 webhook token (用户独立), 不使用 API Key              │
└─────────────────────────────────────────────────────────────────────┘
```

### 方案: API Key + User ID Header

```
Next.js (服务端) → Worker 请求:
  Headers:
    X-API-Key: {WORKER_API_KEY}      # 共享密钥, 验证请求来源 (仅服务端持有)
    X-User-ID: {session.user.id}     # 当前登录用户 ID
```

**优点**:
- 简单可靠, 无需 JWT 验证逻辑
- Next.js 已有 session, 只需传递 user ID
- Worker 无状态, 不需要验证 session
- API Key 永远不暴露给浏览器

**实现**:

```typescript
// packages/worker/src/middleware/api-key.ts
import { Context, Next } from "hono";

export async function apiKeyMiddleware(c: Context, next: Next) {
  const apiKey = c.req.header("X-API-Key");
  if (apiKey !== c.env.API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  
  const userId = c.req.header("X-User-ID");
  if (!userId) {
    return c.json({ error: "Missing X-User-ID" }, 400);
  }
  
  c.set("userId", userId);
  await next();
}
```

```typescript
// packages/web/src/lib/worker-client.ts
const WORKER_URL = process.env.WORKER_API_URL!;
const WORKER_API_KEY = process.env.WORKER_API_KEY!;

export async function workerFetch<T>(
  path: string,
  userId: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      "X-API-Key": WORKER_API_KEY,
      "X-User-ID": userId,
      "Content-Type": "application/json",
    },
  });
  
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Worker API error: ${res.status}`);
  }
  
  return res.json();
}
```

### CLI Ingest 鉴权

CLI 上传继续使用 URL 中的 webhook token，无需改变：

```
POST https://api.otter.hexly.ai/ingest/{token}
```

## 分阶段迁移计划

### Phase 1: Worker 基础设施 (1-2 天)

| # | 任务 | 产出 |
|---|------|------|
| 1.1 | 创建 `packages/worker` 骨架 | package.json, tsconfig.json, wrangler.toml |
| 1.2 | 配置 Hono + TypeScript | src/index.ts, 类型定义 |
| 1.3 | 实现 /health 路由 | D1 ping 测试 |
| 1.4 | 本地开发环境 | `wrangler dev` 可用 |
| 1.5 | 部署到 Cloudflare | api.otter.hexly.ai 可访问 |

### Phase 2: Ingest 迁移 (2-3 天)

| # | 任务 | 产出 |
|---|------|------|
| 2.1 | 实现 /ingest/{token} | 快照上传 (D1 + R2) |
| 2.2 | 实现 /ingest/{token}/icons | 图标上传 |
| 2.3 | CLI 兼容: 支持新旧 URL | 环境变量切换 |
| 2.4 | E2E 测试 Ingest | Worker 侧测试 |
| 2.5 | 切换生产流量 | CLI 默认使用 Worker URL |

**CLI 改动**:

```typescript
// packages/cli/src/config.ts
export function getWebhookUrl(token: string): string {
  // 新增环境变量，允许覆盖
  const baseUrl = process.env.OTTER_API_URL ?? "https://api.otter.hexly.ai";
  return `${baseUrl}/ingest/${token}`;
}
```

### Phase 3: Read API 迁移 (2-3 天)

| # | 任务 | 产出 |
|---|------|------|
| 3.1 | 实现 /v1/snapshots | 列表 + 详情 |
| 3.2 | 实现 /v1/webhooks | CRUD |
| 3.3 | Worker client 封装 | packages/web/src/lib/worker-client.ts |
| 3.4 | Next.js 路由改造 | 保留为 BFF，转发到 Worker (见下方路由迁移表) |
| 3.5 | 验证所有页面功能 | E2E 测试通过 |

#### 路由迁移策略

| 现有路由 | 迁移后 | 说明 |
|----------|--------|------|
| `/api/webhook/{token}` | **废弃** | CLI 直连 Worker `/ingest/{token}` |
| `/api/webhook/{token}/icons` | **废弃** | CLI 直连 Worker `/ingest/{token}/icons` |
| `/api/snapshots` | **保留为 BFF** | 转发到 Worker `/v1/snapshots` |
| `/api/snapshots/{id}` | **保留为 BFF** | 转发到 Worker `/v1/snapshots/{id}` |
| `/api/webhooks` | **保留为 BFF** | 转发到 Worker `/v1/webhooks` |
| `/api/webhooks/{id}` | **保留为 BFF** | 转发到 Worker `/v1/webhooks/{id}` |
| `/api/live` | **保留** | 内部调用 Worker `/health`，兼容现有监控 |

**BFF 模式说明**: Next.js API routes 作为 Backend-for-Frontend，负责：
1. NextAuth session 验证
2. 提取 `session.user.id`
3. 添加 `X-API-Key` + `X-User-ID` headers
4. 转发请求到 Worker
5. 返回 Worker 响应

**Dashboard 改造范围**: 前端调用链不变（仍调 `/api/*`），无需改动 React 组件。

### Phase 4: Analytics API + Dashboard 可视化 (3-4 天)

| # | 任务 | 产出 |
|---|------|------|
| 4.1 | 实现 /v1/analytics/* | 7 个聚合端点 |
| 4.2 | Dashboard 布局重构 | 图表在上, 列表在下 |
| 4.3 | 新增 Platform/Arch 分布图 | 2 个 DonutChart |
| 4.4 | 新增 Host 分布图 | BarChart |
| 4.5 | 新增 Size/Count 趋势图 | 2 个 AreaChart |
| 4.6 | 新增 Collector Breakdown | BarChart |
| 4.7 | 新增 Top Packages/Extensions | 2 个 BarChart |

### Phase 5: 清理 + 文档 (1 天)

| # | 任务 | 产出 |
|---|------|------|
| 5.1 | 移除 Next.js 中的 D1/R2 直连代码 | 删除 packages/web/src/lib/cf/ |
| 5.2 | 更新环境变量文档 | CLAUDE.md, README |
| 5.3 | 更新 06-dashboard.md | 新架构图 |
| 5.4 | npm 发布新版 CLI | 包含 Worker URL |

## Dashboard 可视化计划

### 新布局 (图表在上, 列表在下)

```
┌─────────────────────────────────────────────────────────────────┐
│ Dashboard                                                       │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                │
│ │ Total   │ │ Active  │ │ Config  │ │ Last    │  ← Stat Cards  │
│ │ Snaps   │ │ Webhooks│ │ Files   │ │ Backup  │                │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘                │
├─────────────────────────────────────────────────────────────────┤
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ │
│ │ Platform Distrib │ │ Arch Distribution│ │ Host Distribution│ │
│ │   [DonutChart]   │ │   [DonutChart]   │ │    [BarChart]    │ │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────┐ ┌────────────────────────────┐  │
│ │ Backup Trend (7d)          │ │ Size Trend (30 snaps)      │  │
│ │       [AreaChart]          │ │       [AreaChart]          │  │
│ └────────────────────────────┘ └────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│ Latest Snapshot Analysis                                        │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ │
│ │ Collector Items  │ │ Top Brew Pkgs    │ │ Top VS Code Ext  │ │
│ │   [BarChart]     │ │   [BarChart]     │ │   [BarChart]     │ │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│ Recent Snapshots                                                │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ Host     │ Platform │ Files │ Lists │ Size  │ When         ││
│ │ ──────── │ ──────── │ ───── │ ───── │ ───── │ ──────────── ││
│ │ macbook  │ darwin   │   42  │  680  │ 1.2MB │ 2h ago       ││
│ │ ...      │ ...      │  ...  │  ...  │  ...  │ ...          ││
│ └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 新增图表组件使用

| 图表 | 组件 | 数据端点 | 数据字段 |
|------|------|----------|----------|
| Platform Distribution | DonutChart | /v1/analytics/overview | platformDistribution |
| Arch Distribution | DonutChart | /v1/analytics/overview | archDistribution |
| Host Distribution | BarChart | /v1/analytics/host-distribution | hosts[] |
| Backup Trend | AreaChart | 现有 (client 聚合) | 不变 |
| Size Trend | AreaChart | /v1/analytics/size-trend | points[] |
| Collector Items | BarChart | /v1/analytics/latest-breakdown | collectors[] |
| Top Brew Packages | BarChart | /v1/analytics/latest-breakdown | topBrewPackages[] |
| Top VS Code Ext | BarChart | /v1/analytics/latest-breakdown | topVscodeExtensions[] |

## 环境变量变更

### 新增 (Worker)

| 变量 | 用途 | 设置位置 |
|------|------|----------|
| `API_KEY` | Next.js → Worker 鉴权 | wrangler secret |

### 新增 (Next.js / Railway)

| 变量 | 用途 |
|------|------|
| `WORKER_API_URL` | Worker 地址 (e.g., https://api.otter.hexly.ai) |
| `WORKER_API_KEY` | 与 Worker 的共享密钥 |

### 废弃 (迁移完成后移除)

| 变量 | 原用途 |
|------|--------|
| `CF_ACCOUNT_ID` | D1 REST API |
| `CF_D1_DATABASE_ID` | D1 REST API |
| `CF_D1_API_TOKEN` | D1 REST API |
| `CF_R2_ENDPOINT` | R2 S3 API |
| `CF_R2_ACCESS_KEY_ID` | R2 S3 API |
| `CF_R2_SECRET_ACCESS_KEY` | R2 S3 API |
| `CF_R2_BUCKET` | R2 S3 API |

## 测试策略

### 现有测试体系 (必须保留的能力)

当前仓库的测试体系包含以下关键机制，Worker 迁移必须提供等价方案：

| 机制 | 现有实现 | 用途 |
|------|----------|------|
| `E2E_SKIP_AUTH=true` | `session.ts` 返回 `e2e-test-user` | L3/L4 E2E 测试绕过 OAuth |
| 测试用户注入 | `seedE2eUser()` 自动写入 D1 | 满足 FK 约束 |
| D1 测试隔离 | `CF_D1_TEST_DATABASE_ID` 校验 | 防止 E2E 写入生产库 |
| R2 测试隔离 | `CF_R2_TEST_BUCKET` 校验 | 防止 E2E 污染生产桶 |
| Marker 检查 | `d1.ts:22-33`, `r2.ts:65-76` | 运行时拒绝连接非测试资源 |

### Worker 测试等价方案

#### 1. 本地开发测试 (Miniflare)

```typescript
// packages/worker/vitest.config.ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            API_KEY: "test-api-key",
          },
          d1Databases: ["DB"],
          r2Buckets: ["SNAPSHOTS", "ICONS"],
        },
      },
    },
  },
});
```

#### 2. E2E 测试模式 (`X-Test-Mode` header)

Worker 需要支持测试模式，等价于 Next.js 的 `E2E_SKIP_AUTH`：

```typescript
// packages/worker/src/middleware/test-mode.ts
import { Context, Next } from "hono";

export async function testModeMiddleware(c: Context, next: Next) {
  // 仅在测试环境启用
  if (c.env.ENVIRONMENT !== "test" && c.env.ENVIRONMENT !== "staging") {
    return next();
  }
  
  const testMode = c.req.header("X-Test-Mode");
  if (testMode === "true") {
    // 设置测试用户上下文
    c.set("userId", "e2e-test-user");
    c.set("isTestMode", true);
  }
  
  await next();
}
```

#### 3. 测试资源隔离策略

| 环境 | D1 Database | R2 Bucket | 隔离机制 |
|------|-------------|-----------|----------|
| Production | `otter-db` | `otter-snapshots` | 无测试流量 |
| Staging | `otter-db-staging` | `otter-snapshots-staging` | 独立资源 |
| E2E Test | `otter-db-test` | `otter-snapshots-test` | Marker 校验 |
| Local Dev | Miniflare 内存 | Miniflare 内存 | 完全隔离 |

**wrangler.toml 多环境配置**:

```toml
# 生产环境 (默认)
[env.production]
d1_databases = [{ binding = "DB", database_name = "otter-db", database_id = "xxx" }]
r2_buckets = [{ binding = "SNAPSHOTS", bucket_name = "otter-snapshots" }]

# Staging 环境
[env.staging]
d1_databases = [{ binding = "DB", database_name = "otter-db-staging", database_id = "yyy" }]
r2_buckets = [{ binding = "SNAPSHOTS", bucket_name = "otter-snapshots-staging" }]

# 测试环境 (CI/E2E)
[env.test]
vars = { ENVIRONMENT = "test" }
d1_databases = [{ binding = "DB", database_name = "otter-db-test", database_id = "zzz" }]
r2_buckets = [{ binding = "SNAPSHOTS", bucket_name = "otter-snapshots-test" }]
```

#### 4. E2E 测试执行方式

```bash
# 方式 A: 使用 staging Worker (推荐)
WORKER_API_URL=https://api-staging.otter.hexly.ai \
E2E_SKIP_AUTH=true \
bun run test:e2e

# 方式 B: 本地 Worker (wrangler dev)
wrangler dev --env test &
WORKER_API_URL=http://localhost:8787 \
E2E_SKIP_AUTH=true \
bun run test:e2e
```

### Worker 单元测试 (Vitest + Miniflare)

```typescript
// packages/worker/src/__tests__/ingest.test.ts
import { unstable_dev } from "wrangler";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

describe("Ingest API", () => {
  let worker: Awaited<ReturnType<typeof unstable_dev>>;

  beforeAll(async () => {
    worker = await unstable_dev("src/index.ts", {
      experimental: { disableExperimentalWarning: true },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it("POST /ingest/{token} with valid token", async () => {
    const res = await worker.fetch("/ingest/valid-token", {
      method: "POST",
      body: gzipSync(JSON.stringify(mockSnapshot)),
      headers: { "Content-Encoding": "gzip" },
    });
    expect(res.status).toBe(201);
  });
});
```

### E2E 测试 (Next.js + Worker)

在 E2E 模式下:
- 使用 `otter-db-test` D1 数据库
- 使用 `otter-snapshots-test` R2 bucket
- Worker 部署到 staging 环境或使用 `wrangler dev`

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| Worker 冷启动延迟 | Hono 轻量, D1/R2 绑定快速, 预期 <50ms |
| CLI 老版本不兼容 | 保留旧 URL 代理 1 个月 |
| D1 查询语法差异 | 迁移时测试覆盖所有 SQL |
| R2 绑定 API 差异 | 参考 R2 binding 文档, 单元测试覆盖 |

## 时间线估算

| 阶段 | 工作量 | 累计 |
|------|--------|------|
| Phase 1: Worker 基础 | 1-2 天 | 2 天 |
| Phase 2: Ingest 迁移 | 2-3 天 | 5 天 |
| Phase 3: Read API 迁移 | 2-3 天 | 8 天 |
| Phase 4: Analytics + 可视化 | 3-4 天 | 12 天 |
| Phase 5: 清理 + 文档 | 1 天 | 13 天 |

**总计: 约 2 周**

---

## 进度追踪

### Phase 1: Worker 基础设施

- [ ] 1.1 创建 packages/worker 骨架
- [ ] 1.2 配置 Hono + TypeScript
- [ ] 1.3 实现 /health 路由
- [ ] 1.4 本地开发环境
- [ ] 1.5 部署到 Cloudflare

### Phase 2: Ingest 迁移

- [ ] 2.1 实现 /ingest/{token}
- [ ] 2.2 实现 /ingest/{token}/icons
- [ ] 2.3 CLI 兼容性
- [ ] 2.4 E2E 测试
- [ ] 2.5 切换生产流量

### Phase 3: Read API 迁移

- [ ] 3.1 实现 /v1/snapshots
- [ ] 3.2 实现 /v1/webhooks
- [ ] 3.3 Worker client 封装
- [ ] 3.4 Next.js 路由改造
- [ ] 3.5 E2E 验证

### Phase 4: Analytics + 可视化

- [ ] 4.1 实现 /v1/analytics/* (7 个端点)
- [ ] 4.2 Dashboard 布局重构
- [ ] 4.3 Platform/Arch 分布图
- [ ] 4.4 Host 分布图
- [ ] 4.5 Size/Count 趋势图
- [ ] 4.6 Collector Breakdown
- [ ] 4.7 Top Packages/Extensions

### Phase 5: 清理 + 文档

- [ ] 5.1 移除旧代码
- [ ] 5.2 更新环境变量文档
- [ ] 5.3 更新架构文档
- [ ] 5.4 发布新版 CLI
