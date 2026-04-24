# 架构概览

> 返回 [README](../README.md)

## 设计理念

Otter 采用**采集-快照-存储/上传**三层流水线架构，将 macOS 开发环境的配置文件、dotfiles、已安装应用和包列表汇总为一个 JSON 快照，可本地保存和/或上传至 Webhook 端点。

设计核心原则：

- **插件式采集器**：每个数据源由独立的 Collector 类负责，易于新增和测试
- **安全优先**：自动过滤二进制文件、大文件，敏感凭据在采集时即被脱敏
- **轻量快照**：只采集文本配置，不采集二进制内容；应用和包列表只记录名称

## Monorepo 结构

```
otter/
├── packages/
│   ├── core/          # @otter/core — 类型定义（零运行时依赖）
│   │   └── src/
│   │       ├── types.ts      # 全部接口定义
│   │       └── index.ts      # 统一导出
│   ├── cli/           # @otter/cli — CLI 实现
│   │   └── src/
│   │       ├── bin.ts         # 入口（#!/usr/bin/env node）
│   │       ├── cli.ts         # 命令注册（citty 框架）
│   │       ├── collectors/    # 5 个采集器
│   │       ├── commands/      # scan / config / backup / snapshot 命令逻辑
│   │       ├── config/        # ConfigManager（~/.config/otter/）
│   │       ├── storage/       # SnapshotStore（~/.config/otter/snapshots/）
│   │       ├── snapshot/      # 快照构建器
│   │       ├── uploader/      # Webhook 上传
│   │       └── utils/         # 工具函数（凭据脱敏等）
│   ├── api/           # @otter/api — 纯逻辑包（无独立进程）
│   │   └── src/
│   │       ├── index.ts            # 入口（导出 createApp / 中间件 / lib）
│   │       ├── app.ts              # Hono app 装配（vitest 直测）
│   │       ├── routes/             # /v1/snapshots, /v1/webhooks, /v1/live, /me, /auth/cli
│   │       ├── middleware/         # access-auth (CF Access JWT) + api-key-auth (Bearer)
│   │       └── lib/                # db/{driver,d1-binding,d1-http} + snapshot-repo + webhook-repo + api-token-repo
│   ├── web/           # @otter/web — Vite 6 SPA (端口 7019)
│   │   └── src/                    # React 19 + react-router 7 + SWR + Tailwind v4
│   └── worker/        # @otter/worker — Cloudflare Worker (单进程托管 /api/* + SPA 静态资源)
│       └── src/                    # Hono dual-stack: /api/* 走 D1 binding + CF Access; /v1/* 兼容老 HTTP-D1 调用方
├── docs/              # 项目文档
├── vitest.config.ts   # 统一测试配置
├── tsconfig.json      # 基础 TypeScript 配置
└── package.json       # Monorepo 根（Bun workspaces）
```

## 三层数据流

```
┌─────────────────────────────────────────────┐
│               Layer 1: 采集                  │
│                                             │
│  ClaudeConfig  OpenCode  Shell  Brew  Apps  │
│       │           │        │      │     │   │
│       └───────────┴────────┴──────┴─────┘   │
│                      ↓                      │
│           CollectorResult[]                 │
├─────────────────────────────────────────────┤
│               Layer 2: 快照                  │
│                                             │
│  buildSnapshot() → Snapshot (JSON)          │
│  ├── version: 1                             │
│  ├── machine: MachineInfo                   │
│  └── collectors: CollectorResult[]          │
├─────────────────────────────────────────────┤
│               Layer 3: 存储 & 上传            │
│                                             │
│  SnapshotStore.save() → local JSON file     │
│  uploadSnapshot() → gzip → POST Webhook     │
└─────────────────────────────────────────────┘
```

## 核心类型

所有类型定义在 `packages/core/src/types.ts`：

| 类型 | 用途 |
|------|------|
| `CollectedFile` | 一个被采集的文件（路径 + 内容 + 大小） |
| `CollectedListItem` | 列表项（名称 + 可选版本 + 可选元数据） |
| `CollectorResult` | 单个采集器的输出（文件 + 列表 + 错误 + 耗时） |
| `Collector` | 采集器接口 |
| `Snapshot` | 完整快照（机器信息 + 所有采集结果） |
| `MachineInfo` | 机器元数据（主机名、平台、架构等） |
| `UploaderConfig` | Webhook 上传配置 |
| `UploadResult` | 上传结果 |
| `OtterConfig` | CLI 持久化配置 |

CLI 包内还定义了以下类型（`packages/cli/src/storage/local.ts`）：

| 类型 | 用途 |
|------|------|
| `SnapshotMeta` | 本地快照元数据（id、时间戳、大小、机器名） |

## 技术栈

| 组件 | 选型 |
|------|------|
| 运行时 | Node.js (ES2022) |
| 包管理 | Bun (workspaces) |
| 语言 | TypeScript 5.7+ (strict) |
| 模块系统 | ESM (Node16 resolution) |
| CLI 框架 | citty |
| 日志 | consola + picocolors |
| 测试 | Vitest |
| 覆盖率 | @vitest/coverage-v8 |
| Git hooks | Husky |

## Web ↔ API 通信

`packages/web`（Vite SPA）和 `packages/worker`（Cloudflare Worker）部署到**同一个 Worker**：`web/dist` 通过 wrangler 的 `[assets]` binding 由 Worker 直接托管，`/api/*` 由同一 Worker 处理。SPA 和 API 同源，浏览器 `fetch("/api/...")` 不跨域、不需要 cookie 转发。

业务逻辑全部封装在 `@otter/api` 的 `createApp({ basePath, driver, bucket, auth })` 工厂里。Worker 入口只做 binding 适配：把 `c.env.DB`（D1 binding）包成 `DbDriver`，把 `c.env.SNAPSHOTS`（R2 binding）传进去，然后 `apiApp.fetch(c.req.raw, c.env, c.executionCtx)`。本地开发时 vite + wrangler 各自起进程，vite dev server 把 `/api/*` 反代到 `:7020`。

鉴权 dual-stack：
- 浏览器：Cloudflare Access SSO 注入 `Cf-Access-Jwt-Assertion`，`accessAuth` 中间件用 `jose` + `createRemoteJWKSet` 验签后写入 `accessEmail`
- CLI：`api_tokens` 表里的 Bearer token，`apiKeyAuth` 中间件验证
- 两者都不命中时，路由内 `requireUser(c)` 返回 401
- 本地 `wrangler dev --local` 时 Host=localhost 的请求自动 stamp 为 `dev@localhost`，方便 E2E 不伪造 JWT

## 相关文档

- [采集器详解](./02-collectors.md)
- [开发指南](./03-development.md)
- [测试规范](./04-testing.md)
- [安全机制](./05-security.md)
