# Vite SPA + 单 Worker 迁移计划（CF Access 鉴权）

> 返回 [README](../README.md) · 上一篇 [Otter Worker 迁移方案](./08-worker-migration.md)

把 `packages/web` 从 Next.js 16 + next-auth 重写为 Vite 6 SPA，并把原独立的 `otter-test.nocoo.workers.dev` 业务逻辑回迁到新 `packages/worker`，鉴权切 Cloudflare Access。本文档既是执行计划，也是进度看板。

## 执行进度（2026-04-23 更新）

| 步骤 | 状态 | 提交 / 备注 |
|---|---|---|
| 02. DbDriver 抽象 | ✅ done | `4e958b3 feat(api): introduce DbDriver abstraction + snapshot/webhook repos` |
| 03. 平移旧 worker SQL | ✅ done | 同上提交（snapshot-repo / webhook-repo） |
| 04. access-auth | ✅ done | `16ac757 feat(api): cf access middleware + api_tokens bearer auth + cli mint route` |
| 05. api_tokens + apiKeyAuth + /auth/cli | ✅ done | 同上 |
| 09. worker 包脚手架 | ✅ done | `673eadd feat(worker): mount /api/* with cf access + d1 binding driver, keep /v1/* legacy` |
| 10. 路由前缀对齐 | ✅ done | dual-stack: 新 `/api/*` + 老 `/v1/*` 共存 |
| 01. 重命名 web → web_legacy | ✅ done | `e4da9c8 refactor: rename packages/web → packages/web_legacy` |
| 06. Vite SPA 脚手架 | ✅ done | `18fded0 feat(web): scaffold vite spa skeleton at packages/web`（占位页骨架） |
| 07. 平移 UI 组件 | ⏳ 推迟 | 当前只有占位页；shadcn/charts/dashboard 全套留给下一轮 |
| 08. 平移页面 | ⏳ 推迟 | 同上，先过 build/lint，业务复刻另开一轮 |
| 11. worker 单测 | ✅ done | `22df574 test(worker): unit tests for /api/snapshots and /api/webhooks routes`（15 个用例，in-memory driver） |
| 12. 平移 web 单测 + Playwright | ⏳ 推迟 | web_legacy 测试原地保留；新 web 仅占位骨架，等业务复刻后再补 |
| 13. E2E runner 重写 | ⏳ 推迟 | 当前 `scripts/run-e2e*.ts` 仍指 web_legacy；新 worker 的 E2E 留待业务复刻 |
| 14. 根 scripts 调整 | ✅ done | `1ff61d4 chore(scripts): add dev:worker / build / deploy targets for new worker` |
| 15. 删 web_legacy | ⏭️ 跳过 | 计划本身约定本轮不删 |
| 16. 文档 | ✅ done | `e41d3d8 docs: capture vite spa + single worker + cf access migration` |

**遗留事项**（待哥确认后开下一轮）：
- D1 实跑 `0002_api_tokens.sql` migration
- `wrangler.toml` 写真实 `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`
- 复刻 web_legacy 的 dashboard / charts / shadcn 组件到新 web
- CLI 切 Bearer token + 跑 `/auth/cli/{start,callback}` 流程
- 删除 `packages/api/src/lib/worker-client.ts`（仅 web_legacy 仍依赖）

---

## Context

`packages/web` 当前是 Next.js 16 应用（next-auth + Google OAuth + 反代到独立 cf worker 拿 D1）。哥的目标：
1. **冻结现状**：把现 web 重命名为 `packages/web_legacy`（保留所有代码、测试、Playwright spec），不再积极开发；
2. **完全照搬 surety 选型**重写新 `packages/web`：Vite 6 + React 19 + React Router 7 + SWR + Tailwind v4 + shadcn 风格组件；
3. **新增 `packages/worker`**：Hono on Cloudflare Workers，单一 Worker 同时托管 `/api/*` 和 SPA 静态资源；业务直连 D1 binding（不再走 HTTP 代理），R2 同理；
4. **鉴权切 Cloudflare Access**：浏览器侧由 CF Access SSO 注入 `Cf-Access-Jwt-Assertion`，Worker 用 `jose` + `createRemoteJWKSet` 验签；CLI 走 Bearer token（`api_tokens` 表）；删除 next-auth、Google OAuth、ALLOWED_EMAILS、`@auth/core` 依赖；
5. 功能完全复刻：dashboard 概览、snapshots 列表/详情/删除、CLI connect 页、settings 页（用户信息 + webhook token 管理）；
6. 部署：`bun run build` 把 web 产物写入 `packages/worker/static`，`wrangler deploy` 推一个 Worker 完事；本地 `wrangler dev --local` 跑 D1/R2 binding。

旧 worker（`otter-test.nocoo.workers.dev`）的 SQL 逻辑要平移到 `packages/api`，使其同时支持「HTTP D1（旧 web_legacy 用）」与「D1 binding（新 worker 用）」两套驱动 —— 用一个 `DbDriver` 接口包装，运行时按需注入。这样 web_legacy 仍然能跑（兼容期），新 worker 走 binding 零网络开销。

---

## 目标架构

```
otter/
├── packages/
│   ├── core/                    # 类型，不变
│   ├── cli/                     # CLI，不变（后续切 Bearer token，本轮不动）
│   ├── api/                     # @otter/api：纯逻辑，新增 DbDriver 抽象
│   │   └── src/
│   │       ├── app.ts           # createApp(driver) → Hono app，driver 决定 D1 来源
│   │       ├── routes/          # snapshots / webhooks / live（已有）
│   │       ├── middleware/
│   │       │   ├── auth.ts      # 老版 next-auth JWT（web_legacy 兼容期保留）
│   │       │   └── access-auth.ts  # 新增：CF Access JWT 验签（jose）
│   │       └── lib/
│   │           ├── db/
│   │           │   ├── driver.ts        # interface { query/queryFirst/execute/batch }
│   │           │   ├── d1-binding.ts    # 新增：D1Database binding 实现
│   │           │   └── d1-http.ts       # 现 cf/d1.ts 改名/迁入
│   │           ├── snapshot-repo.ts     # 新增：把 SQL 从旧 worker 平移过来
│   │           └── webhook-repo.ts      # 新增：同上
│   ├── web_legacy/              # ← 现 packages/web 整体重命名
│   │   └── (内容不动，package.json 改 name 为 @otter/web-legacy)
│   ├── web/                     # NEW：Vite + React SPA
│   │   ├── index.html
│   │   ├── vite.config.ts       # 7019 dev port，proxy /api → 本地 wrangler:7020
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── public/              # logo / favicon
│   │   └── src/
│   │       ├── main.tsx         # React 19 + BrowserRouter
│   │       ├── App.tsx          # Routes（lazy 加载页面）
│   │       ├── globals.css      # Tailwind v4 + 复制 web_legacy 主题 token
│   │       ├── api.ts           # fetch wrapper + SWR fetcher
│   │       ├── app/
│   │       │   ├── dashboard/page.tsx
│   │       │   ├── snapshots/page.tsx
│   │       │   ├── snapshots/[id]/page.tsx + _components/*
│   │       │   ├── settings/page.tsx
│   │       │   └── cli/connect/page.tsx
│   │       ├── components/      # 从 web_legacy 平移：layout/, ui/, charts/, dashboard/
│   │       ├── hooks/
│   │       └── lib/
│   └── worker/                  # NEW：Hono on Cloudflare Workers
│       ├── package.json         # deps: hono, jose, @otter/api workspace, @cloudflare/workers-types
│       ├── tsconfig.json
│       ├── wrangler.toml        # routes / D1 binding / R2 binding / assets
│       ├── static/              # ← Vite build 产物（.gitignore）
│       └── src/
│           ├── index.ts         # createApp(d1BindingDriver) + app.use access-auth
│           └── lib/types.ts     # AppEnv（Bindings + Variables）
└── (cli/core 不变)
```

**单一 Worker** 同时承载 `/api/*` 路由与 SPA 静态资源（`run_worker_first = ["/api/*"]` + `not_found_handling = "single-page-application"`）。无独立的"otter-worker"了 —— 这一步同时把 `otter-test.nocoo.workers.dev` 的逻辑回迁。

---

## 鉴权方案（照搬 surety）

### 浏览器
1. CF Access SSO（Google IdP）拦在 Worker 前面，认证后注入 `Cf-Access-Jwt-Assertion` 头；
2. `middleware/access-auth.ts` 用 `jose.createRemoteJWKSet(https://${TEAM_DOMAIN}/cdn-cgi/access/certs)` + `jwtVerify(token, jwks, { issuer, audience: AUD })` 验签；
3. 验签通过 → `c.set("user", { email: payload.email, sub: payload.sub })`；失败 → 401。
4. 本地开发 / wrangler dev：`isLocalhost(c)` 命中时直接放行（沿用 surety 的 cf-edge 检测策略，避免 Host 伪造）。

### CLI（本轮做完，不留尾巴）
- 新增 `api_tokens` 表（id / token_hash / email / label / created_at / last_used_at）；
- 新增 `apiKeyAuth` 中间件：`Authorization: Bearer <token>` → `apiTokens.verify(token)` → `c.set("user", ...)`；
- 新增 `/api/auth-cli/start|callback` 路由（沿用现有 webhook URL token 配对流程的形态，但改为发短期 Bearer token）。

环境变量：`CF_ACCESS_TEAM_DOMAIN`、`CF_ACCESS_AUD`（worker 端，wrangler vars）；移除 `AUTH_SECRET` / `GOOGLE_CLIENT_*` / `ALLOWED_EMAILS`。

---

## 实现步骤（编号，原子化提交）

### 01. 重命名 `packages/web` → `packages/web_legacy`
- `git mv packages/web packages/web_legacy`
- `package.json`：`"name": "@otter/web-legacy"`
- 根 `package.json` 的 `dev` 脚本暂时仍指向 `web_legacy`（保留可跑，方便对照）
- 修复 `packages/web_legacy/next.config.ts` 的 `path.join(__dirname, "../..")` 仍 OK
- vitest 配置 / Playwright config 路径同步
- 验证 `bun run lint && bun run test` 全绿

### 02. 在 `@otter/api` 抽象 DB driver
- 新增 `src/lib/db/driver.ts`：`interface DbDriver { query/queryFirst/execute/batch }`
- 把现 `src/lib/cf/d1.ts` → `src/lib/db/d1-http.ts`，导出 `createHttpDriver()`
- 新增 `src/lib/db/d1-binding.ts`：包装 `D1Database` binding（`db.prepare().bind().all()/.first()/.run()` + `db.batch()`）
- `createApp()` 签名改为 `createApp({ driver, auth })`，driver 通过 AsyncLocalStorage 或 Hono `c.set("driver", ...)` 注入；现 `queryFirst()` 等改成读 `c.get("driver")`
- 同步修改 routes/middleware 用注入的 driver
- 旧 web_legacy 的 catch-all route 改为：`createApp({ driver: createHttpDriver(), auth: jwtAuth })`
- 单测：bind 一个内存 mock driver 验证路由仍通

### 03. 平移旧 otter-worker 的 SQL 到 `@otter/api`
- 当前 `worker-client.ts` 的 8 个方法（`listSnapshots`/`getSnapshot`/`deleteSnapshot`/`listWebhooks`/...）实际是 HTTP 代理 → 远端 worker 内部的 SQL
- 检索 `otter-test.nocoo.workers.dev` 部署的源码（多半是另一个 repo；如果没在本仓库，需要哥给入口）
- 复制其 SQL 实现为 `src/lib/snapshot-repo.ts` / `webhook-repo.ts`，函数签名沿用 `(driver, userId, ...)` 形式
- 删除 `worker-client.ts`（worker 不再代理 worker）
- routes/snapshots.ts 等改为 `import { listSnapshots } from "../lib/snapshot-repo"`，用 `c.get("driver")`
- 单测：注入内存 driver，端到端跑通（替换现有 `vi.mock("../../lib/worker-client")` 为 driver mock）
- **如果 otter-worker 源码不在本机**：本步骤拆为 02b 让哥提供，否则只能做到接口预留

### 04. 新增 `middleware/access-auth.ts`
- 完全照搬 `surety/apps/worker/src/middleware/access-auth.ts`
- 单测：mock `jose.createRemoteJWKSet` + `jwtVerify`，验证 happy path + 无 token + 验签失败三场景
- 本步骤暂不删 `auth.ts`（next-auth 老中间件留作 web_legacy 兼容）

### 05. 新增 `api_tokens` 表 + `apiKeyAuth` + `/api/auth-cli/*`
- D1 migration 文件（手工 SQL，记录在 `docs/migrations/`）
- repo + 中间件 + 路由 + 单测

### 06. 脚手架 `packages/web`
- `bun create vite packages/web --template react-ts` 之后改造，或直接照 surety 的 `apps/web` 复制基线
- `package.json`：deps 严格对齐 surety（`react@^19.2.4`、`react-router@^7.6.3`、`swr@^2.3.3`、`@tailwindcss/vite@^4.2.1`、`vite@^6.3.5`、`lucide-react`、`clsx`、`tailwind-merge`、`class-variance-authority`、`radix-ui`、`recharts`、`tw-animate-css`）
- `vite.config.ts`：端口 7019（沿用旧 web 端口避免文档大改）；`build.outDir = "../worker/static"`；`server.proxy["/api"] → http://localhost:7020`（wrangler dev 端口）
- `tsconfig.json` 继承根配置，`paths: { "@/*": ["./src/*"] }`
- `globals.css`：复制 web_legacy/src/app/globals.css 全部 Tailwind token + theme 变量

### 07. 平移 UI 组件（无功能改动）
- `components/ui/*`：button / input / dialog / dropdown-menu / sheet / switch / tabs / tooltip / table / card / badge / avatar / label / separator / skeleton — 全都来自 shadcn/radix-ui，与 Next 无关，整体复制
- `components/charts/*`：area-chart / bar-chart / donut-chart（recharts，无 Next 依赖）
- `components/dashboard/*`：stat-card / dashboard-segment
- `components/layout/*`：app-shell（去掉 `usePathname` → 用 `useLocation`）；sidebar / sidebar-context / theme-toggle / breadcrumbs（同样替换 next/navigation）
- `components/file-viewer-dialog.tsx`：去掉 `next/dynamic`，改 `React.lazy`
- `hooks/use-mobile.tsx` / `lib/utils.ts` / `lib/palette.ts` / `lib/version.ts`：直接复制
- 不引入 `next/image` —— 用普通 `<img>`，logo 走 `public/`
- 不引入 `next/font` —— `globals.css` 里 `@import url(...)` Inter / DM Sans

### 08. 平移页面
| Next 路径 | Vite 路径 | 改造 |
|---|---|---|
| `app/(dashboard)/page.tsx` | `app/dashboard/page.tsx` | `next/link` → `react-router Link`；`useRouter` → `useNavigate`；`fetch("/api/...")` 改 SWR |
| `app/(dashboard)/snapshots/page.tsx` | `app/snapshots/page.tsx` | 同上 |
| `app/(dashboard)/snapshots/[id]/page.tsx` | `app/snapshots/$id/page.tsx`（实际路由 `/snapshots/:id`） | `useParams` 改 react-router 版本 |
| `app/(dashboard)/snapshots/[id]/_components/*` | `app/snapshots/_components/*` | 直接复制 |
| `app/(dashboard)/settings/page.tsx` | `app/settings/page.tsx` | 删 `useSession`，用 `useSWR("/api/me")` 拉用户信息 |
| `app/(dashboard)/cli/connect/page.tsx` | `app/cli/connect/page.tsx` | `useSearchParams` → react-router 版本 |
| `app/login/page.tsx` | **删** | CF Access 接管登录，无需自建登录页 |
| `app/not-found.tsx` | `app/not-found.tsx` | 直接复制 |

新增 `/api/me` 路由（worker 侧）：返回 `{ email, sub }`，用于 settings/header 显示。

### 09. 脚手架 `packages/worker`
- 照搬 surety/apps/worker 结构
- `wrangler.toml`：
  - `name = "otter"` / `compatibility_date = "2026-04-01"` / `compatibility_flags = ["nodejs_compat"]`
  - `main = "src/index.ts"`
  - `[[d1_databases]]` 复用现有 `otter-db` 的 binding 配置（database_id 待哥提供，或参考现 `WORKER_API_URL` 关联）
  - `[[r2_buckets]]` 同理
  - `[assets] directory = "./static"` + `run_worker_first = ["/api/*"]` + `not_found_handling = "single-page-application"`
  - `[env.test]` 镜像生产 + `E2E_SKIP_AUTH = "true"`，bind 测试 D1/R2
  - `[vars] CF_ACCESS_TEAM_DOMAIN = "..."` / `CF_ACCESS_AUD = "..."`（哥提供）
- `src/index.ts`：
  ```ts
  const app = new Hono<AppEnv>();
  app.use("*", secureHeaders());
  app.use("*", dbBindingMiddleware);   // c.set("driver", new D1BindingDriver(c.env.DB))
  app.use("/api/*", accessAuth);
  app.use("/api/*", apiKeyAuth);
  const otterApp = createApp();         // 复用 @otter/api 的路由
  app.route("/api", otterApp);          // catch-all 内部走 /v1 还是 /api 由 createApp 决定（统一改 /api 前缀）
  export default app;
  ```
- `src/lib/types.ts`：照抄 surety 的 `AppEnv`

### 10. 路由前缀对齐
- 旧 web_legacy 是 `/api/*` → catch-all rewrite 到 `/v1/*` → Hono；现新 worker 直接挂 `/api/*`
- 在 `createApp({ basePath })` 里加参数：legacy 传 `/v1`，新 worker 传 `/api`
- 不变：业务 handler 内部仍是 `app.get("/snapshots", ...)`，basePath 由 `app.basePath()` 一次性挂

### 11. 平移 worker 单测
- `packages/worker/__tests__/`：access-auth / api-key-auth / index 路由装配 / live
- 用 `app.request()` + 内存 driver；coverage 阈值同根配置

### 12. 平移 web 单测 + Playwright
- web_legacy 已有的 unit test（helpers / utils / api-catch-all）保留在原包不动；新 web 复刻：
  - `lib/utils.test.ts` / `lib/version.test.ts` 直接复制
  - 页面级 unit test（如有）按需平移
- Playwright spec：从 `packages/web_legacy/e2e/` 复制到 `packages/web/e2e/`
  - 改 baseURL → `http://localhost:27019`
  - 测试启动改用 wrangler dev `--local --port=27020` + vite preview `:27019`
- 覆盖率门槛：90%/89% 对新 web + worker（web_legacy 维持）

### 13. E2E runner 重写
- `scripts/run-e2e.ts`：起 wrangler dev `--local --port=17020` + 直接 `bun test` API E2E（不需要起 web）
- `scripts/run-e2e-ui.ts`：起 wrangler dev `:27020` + vite preview `:27019`，Playwright 跑
- 删除 `buildE2eEnv` 里残留的 next-build 流程（改成 vite build）

### 14. 根 scripts 调整
- `dev`：`concurrently -n web,worker` 跑 vite + wrangler dev（重新引入 concurrently，仅 dev 用）
- `build`：`bun run --cwd packages/web build && bun run --cwd packages/worker build`（worker 的 build 实际是 vite 产物已经在 static/，所以是 no-op，留作 placeholder）
- `deploy`：`bun run build && bun run --cwd packages/worker deploy`
- `lint`：加 `tsc --noEmit -p packages/worker/tsconfig.json` 和 `packages/web/tsconfig.json`

### 15. 删除 web_legacy 的 next-auth/Google 配置（可选，可以缓一轮）
- 哥可以在 vite 版稳定后再删 `web_legacy`，本轮先保留

### 16. 文档
- `CLAUDE.md`：技术栈表格更新（Vite 6 + Hono Worker + CF Access）；Retrospective 加 CF Access JWT salt、wrangler --local D1 隔离的坑
- `docs/01-architecture.md`：架构图重画
- `docs/03-development.md`：启动改 `bun run dev`（vite + wrangler 并行）
- `docs/08-worker-migration.md`：本次迁移手记

---

## 关键复用

| 来源 | 复用对象 |
|---|---|
| `packages/web_legacy/src/components/{ui,charts,dashboard,layout}/**` | 全部 |
| `packages/web_legacy/src/{lib,hooks}/**` | 全部 |
| `packages/web_legacy/src/app/(dashboard)/**` 页面骨架 | 改造 router/导航后复用 |
| `packages/api/src/lib/cf/d1.ts` | 改名为 `d1-http.ts` 留给 web_legacy |
| `surety/apps/worker/src/middleware/{access-auth,api-key-auth,is-localhost,db}.ts` | 整体复制并改 import |
| `surety/apps/web/src/{main,App,api}.tsx` | 作为新 web 入口骨架 |
| `surety/apps/worker/wrangler.toml` | 作为 worker 配置模板 |

---

## 不做的事

- 不改 `packages/cli`、`packages/core`（CLI 切 Bearer token 留作下一轮）
- 不删 `packages/web_legacy`（保留至少 1 个版本周期作回滚）
- 不动 `otter-test.nocoo.workers.dev` 的部署（直到新 worker 验证完毕；web_legacy 仍指向旧 worker URL）
- 不引入 Drizzle ORM（仓库当前直接写 SQL，本轮保留）
- 不做生产部署（哥 review 完 dev/test 通过后另起一轮）

---

## 待哥确认 / 提供的信息

1. **现 `otter-test.nocoo.workers.dev` 的源码位置**：步骤 03 需要把它的 SQL 平移过来；如果不在本仓库，哥告诉我 repo 路径或贴接口实现
2. **CF Access 配置**：`CF_ACCESS_TEAM_DOMAIN`（如 `nocoo.cloudflareaccess.com`）+ `CF_ACCESS_AUD`（步骤 09 要写进 wrangler vars）
3. **D1/R2 binding ID**：步骤 09 wrangler.toml 需要 `database_id` / `bucket_name`
4. **生产域名规划**：`otter.nocoo.workers.dev` 还是自定义域？（影响 wrangler routes 段）

---

## 验证

### 本地
1. `bun install`
2. `bun run dev`（并行起 vite:7019 + wrangler dev:7020）
3. 浏览器开 `http://localhost:7019`，本机 isLocalhost 直通，dashboard 正常显示 snapshots 列表
4. 用伪造 `Cf-Access-Jwt-Assertion` 头 curl `/api/snapshots` → 401（验证非 localhost 路径）
5. CLI: `otter login` 走新 `/api/auth-cli/start` 拿 Bearer token；`otter backup` 用 token 上传成功

### 测试
- `bun run test`：≥ 460 + 新增 web/worker 单测全 pass，覆盖率 ≥ 90% line / 89% branch
- `bun run test:e2e`：4 个 API E2E（wrangler --local + 真 D1 binding）
- `bun run test:e2e:ui`：6 个 Playwright spec（vite preview + wrangler）
- `bun run lint`：tsc 4 个包全过；biome 0 error

### 部署预演
- `bun run build` → `packages/worker/static/index.html` 存在
- `wrangler deploy --env test` 推 `otter-test`，curl `/api/live` 200
