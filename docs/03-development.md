# 开发指南

> 返回 [README](../README.md) · 上一篇 [采集器详解](./02-collectors.md)

## 环境准备

| 依赖 | 最低版本 |
|------|----------|
| Node.js | 20+ |
| Bun | 1.0+ |
| Wrangler | 4.x（已 `wrangler login`，账号能访问 `otter` worker / D1 / R2） |
| Caddy | 任意（可选，仅本地 TLS 调试 `*.dev.hexly.ai` 时） |

```bash
# 克隆仓库
git clone https://github.com/<owner>/otter.git
cd otter

# 安装依赖
bun install

# 构建 SPA（生成 packages/web/dist）
bun run build

# 跑全部测试
bun run test
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `bun run dev` | 启动 Vite SPA dev server（`:7019`，`/api/*` 反代到生产 worker） |
| `bun run dev:worker` | （可选）`wrangler dev --local`（`:8787`），本地 D1 / R2 模拟，挂 `/api/*` + 老 `/v1/*` |
| `bun run build` | 构建 web SPA（vite，输出到 `packages/web/dist`） |
| `bun run deploy` | build + `wrangler deploy`（推到生产 worker） |
| `bun run test` | 运行全部单元测试（Vitest，502+ tests） |
| `bun run test:watch` | 监听模式 |
| `bun run test:coverage` | 覆盖率报告 |
| `bun run test:e2e` | Playwright BDD E2E（`scripts/run-e2e-spa.ts` 启 wrangler dev `--local`） |
| `bun run lint` | TypeScript 类型检查（4 个 tsconfig：core → cli → web → api） |
| `bun run lint:biome` / `lint:biome:fix` | Biome 检查 / 自动修 |

CLI 命令请直接看 `node packages/cli/dist/bin.js --help` 或 [README 命令一览](../README.md#命令一览)。

## 项目结构

```
packages/
├── core/                          # @otter/core — 共享类型定义（零运行时）
├── cli/                           # @nocoo/otter — npm 发布的 CLI
├── api/                           # @otter/api — Hono createApp 工厂 + middleware/lib
├── web/                           # @otter/web — Vite 7 SPA
│   ├── src/                       #   React 19 + react-router 7 + SWR + Tailwind v4
│   ├── e2e/                       #   Playwright specs
│   ├── vite.config.ts             #   端口 7019，proxy /api → OTTER_API_URL
│   └── .env                       #   本地 dev 用（gitignore，复制 .env.example）
└── worker/                        # @otter/worker — 单一 Cloudflare Worker
    ├── src/index.ts               #   Hono dispatcher: /api/* → createApp; 其余 → legacy
    └── wrangler.toml              #   routes = otter.hexly.ai；workers_dev = true；D1/R2 binding
```

## 启动 Web SPA — 两种模式

### Surety 模式：vite 本地 + 线上 worker（默认 / 推荐）

适合调 UI、复用生产数据。

1. 复制 env 模板（vite 从 `packages/web/` 读 .env）：
   ```bash
   cp .env.example packages/web/.env
   ```
2. 浏览器打开下面这条 URL（先过 Cloudflare Access SSO，redirect URL 里会带回 `?token=otk_...`）：
   ```
   https://otter.hexly.ai/api/auth/cli?callback=http://127.0.0.1:65535/cb&state=mint
   ```
3. 把 token 粘进 `packages/web/.env` 的 `OTTER_DEV_API_TOKEN`。
4. `bun run dev` 启 vite，然后访问 `http://localhost:7019` 或 `https://otter.dev.hexly.ai`（caddy 反代到 7019）。

vite proxy 行为：每个 `/api/*` 请求自动注入 `Authorization: Bearer <OTTER_DEV_API_TOKEN>`，命中 `apiKeyAuth`，绕开 CF Access SSO。

### Bat 模式：vite 本地 + wrangler 本地（完全离线）

适合调后端逻辑、改 D1 schema、避免触碰生产数据。

1. 把 `packages/web/.env` 的 `OTTER_API_URL` 改成 `http://localhost:8787`，把 `OTTER_DEV_API_TOKEN` 留空。
2. 终端 A：`bun run dev:worker`（启动 `wrangler dev --local`，端口 8787，本地 D1 / R2 模拟）
3. 终端 B：`bun run dev`（启动 vite，端口 7019）

`accessAuth` 中间件检测到 `Host: localhost` 时自动 stamp `accessEmail = "dev@localhost"`，所以本地 dev 不需要 Bearer。

### Caddy（可选，TLS 本地调试）

如果想用 `https://otter.dev.hexly.ai`（避开 Service Worker / Cookie 同源限制），在本地 Caddyfile 加：

```caddy
otter.dev.hexly.ai {
  tls /path/to/cert.pem /path/to/key.pem
  reverse_proxy localhost:7019
}
```

vite 已在 `server.allowedHosts` 里放行 `*.dev.hexly.ai`。

## 部署

```bash
bun run deploy        # 生产 worker（custom domain otter.hexly.ai + workers.dev fallback）
bun run deploy:test   # test 环境
```

`wrangler deploy` 一次性把 SPA（来自 `packages/web/dist`）和 worker 代码都推上去——`[assets]` binding 直接托管 dist 目录。

## Git Hooks

项目使用 Husky 管理 Git hooks：

| Hook | 内容 |
|---|---|
| pre-commit | 并行执行：lint-staged（Biome） + `bun run test:coverage`（L1） + `bun run lint`（tsc） + `gitleaks protect --staged` |
| pre-push | 并行执行：`osv-scanner`（lockfile vuln） + `gitleaks git`（全历史 secret 扫描） |

所有 gates 通过才允许 commit / push。

## Commit 规范

遵循 **Conventional Commits**：`<type>: <description>`，祈使句小写，50 字符以内。

| 类型 | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 |
| `refactor` | 重构（不改变行为） |
| `test` | 测试相关 |
| `docs` | 文档 |
| `chore` | 构建、依赖等杂务 |

**要求**：原子化提交（每个 commit 一个逻辑变更，能独立通过测试和构建）；严禁混合功能与修复。

## 文档同步要求

**更新代码时必须同步更新相关文档**：

- 新增采集器 → 更新 [02-collectors.md](./02-collectors.md) 和 [README.md](../README.md)
- 修改安全机制 → 更新 [05-security.md](./05-security.md)
- 修改测试配置 → 更新 [04-testing.md](./04-testing.md)
- 修改架构 / API 路由 → 更新 [01-architecture.md](./01-architecture.md) 和 [06-dashboard.md](./06-dashboard.md)
- 新增 CLI 命令 → 更新 [README.md](../README.md) 的命令表格

## 相关文档

- [架构概览](./01-architecture.md)
- [测试规范](./04-testing.md)
- [安全机制](./05-security.md)
- [Dashboard](./06-dashboard.md)
