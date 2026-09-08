# 当前开发与运行说明

[中文 README](../README.md) · [English README](README.en.md) · [文档索引](README.md)

## 当前架构

`packages/worker/src/index.ts` 是唯一 Worker 入口：`/api/*` 交给 `packages/api` 的 `createApp()`，注入原生 D1 / R2 绑定；`/health` 和 `/ingest/*` 保留旧接入处理。`packages/api` 是库，不需要另起 Node 服务。Vite 构建结果由同一 Worker 的静态资源绑定提供。

| 资源 | 用途 |
| --- | --- |
| D1 `DB` | 用户、API Token、Webhook 与快照索引 |
| R2 `SNAPSHOTS` | 完整 JSON 快照 |
| R2 `ICONS` | 应用图标，默认前缀 `apps/otter` |
| `packages/web/dist` | React SPA 静态资源 |

Wrangler 的 `run_worker_first` 虽然列出 `/v1/*`，实际顶层 dispatcher 没有把它转交给 `createApp()`。当前客户端使用 `/api/*`；不要依赖旧文档中的 `/v1/*` 兼容接口。当前健康检查入口为 `/api/live`，它会查询 D1；Release 只以 HTTP 200 或 401 判断站点可达。

## 采集与快照边界

采集器使用本机命令和文件路径，主要面向 macOS。未安装的工具、缺少权限或不可读文件会造成跳过或错误项；快照不是完整系统镜像。当前没有自动恢复命令。

Claude 采集包括配置、插件清单、统计缓存、提示历史，以及会话索引摘要中的首条提示、项目路径等字段。`--slim` 仅跳过提示历史与会话摘要。Hermes 采集主 Profile 和命名 Profile 的 `config.yaml`、`SOUL.md`、记忆、用户资料、`cron/jobs.json` 与技能名称；不读取 Hermes 的会话数据库、`.env` 或 `auth.json`。SSH 私钥只记录存在情况，不收集私钥正文。

凭据遮盖由 `packages/cli/src/utils/redact.ts` 按格式与字段规则执行，并非所有文件都启用遮盖。Markdown 与 Hermes 记忆正文保留原文，Claude 会话索引的首条提示也不会经过该遮盖函数。上传前应检查实际快照内容。

`scan --save` 保存本地 JSON。`backup` 则重新扫描、gzip 上传快照，成功后才保存本地副本；随后尝试应用图标导出与上传，图标失败不会撤回已上传的快照。`scan --json` 当前还会向 stdout 写入 `Scanning environment...`，需要纯 JSON 时使用保存的快照文件或 Web 的 JSON 导出。

`~/.config/otter/snapshots/` 在生产与开发配置间共用，`snapshot list/show/diff` 都只操作本地快照。`diff` 比较文件路径、文件大小和清单名称，不比较文件正文或清单版本字段。Web 支持分页与 JSON 导出，主机名搜索框当前禁用。

## 地址与登录配置

| 入口 | 默认值与配置 |
| --- | --- |
| 浏览器站点 | `https://otter.hexly.ai`，Cloudflare Access |
| 开发登录页 | `https://otter.dev.hexly.ai`，由 `login --dev` 选择 |
| CLI 上传 API | `https://otter.worker.hexly.ai`，由进程环境变量 `OTTER_API_URL` 覆盖 |
| Vite 代理 | `https://otter.nocoo.workers.dev`，由 Vite 环境中的 `OTTER_API_URL` 覆盖 |
| CLI 登录配置 | `~/.config/otter/config.json` 或 `config.dev.json` |
| 本地图标 | `~/.config/otter/icons/`，两种配置共用 |

登录会打开 `/cli/connect`，随后请求 `/api/auth/cli`，通过 loopback HTTP 回调的 `token` 参数保存 Bearer Token。服务器验证 Access JWT 或已有 Bearer Token 后获得邮箱身份；Token 不是旧 `/ingest/:token` 的 Webhook Token。

`backup --dev` 只选择开发配置。上传地址独立解析，不会自动变成开发站点。`OTTER_API_URL` 也不会改变硬编码的浏览器登录地址；自行部署时需要适配登录域名或为 CLI 配置该部署颁发的 Token。

当前 `backup` 使用 `/api/snapshots` 与 `/api/icons`。Settings 中的 Webhook 仍用于 `/ingest/*` 兼容接入。快照 API 的列表、详情与删除会核对邮箱归属；删除先移除 R2 正文，再删除 D1 索引。

## 安装与构建

Bun 用于工作区安装与脚本；Node.js 范围遵循根 `package.json` 的 `^22.12.0 || ^24.0.0 || >=26.0.0`。构建顺序与 CI 的 HTTP / CLI 集成任务一致：

```bash
bun install --frozen-lockfile
bun run --cwd packages/core build
bun run --cwd packages/cli build
bun run --cwd packages/api build
bun run build
node packages/cli/dist/bin.js --help
```

根目录 `build` 只构建 Web。`typecheck` 与 `lint` 都调用类型检查脚本，代码风格使用 `bun run lint:biome`。源代码 CLI 构建后使用 Node 执行，Bun 不是已发布 CLI 的必需运行时。

## 本地联调

`bun run dev` 启动 Vite，默认端口 7019。其 `loadEnv()` 从 `packages/web` 工作目录读取环境文件，因此首次配置应在 `packages/web/.env` 中设置 `OTTER_API_URL`、`OTTER_DEV_API_TOKEN`，根目录 `.env.example` 可作字段参考。默认代理连接生产 Worker，目标服务的 Token 由代理放进 `Authorization` 请求头。

需要本地 D1 / R2 时，可复用仓库的隔离 API runner。在完成构建后，先确认端口 17020 空闲，再于终端一运行：

```bash
bun scripts/run-api-e2e.ts
```

它每次启动都会清空 `packages/worker/.wrangler/e2e`，按顺序应用迁移，并启动 `--local --persist-to` Worker，使用测试邮箱 `dev@localhost`。该目录只保存可丢弃的联调数据。终端二显式连接它，并清空代理 Token，让本地测试身份生效：

```bash
OTTER_API_URL=http://127.0.0.1:17020 OTTER_DEV_API_TOKEN= bun run dev
```

runner 的鉴权旁路要求显式 `E2E_SKIP_AUTH=true` 且 `ENVIRONMENT` 不是 production。普通 `bun run dev:worker` 是 Wrangler 的独立开发入口，默认端口 8787；它不会自动更改 Vite 的代理目标，也不会自动应用迁移。不要把本地测试身份变量部署到生产。

## 测试入口

| 命令 | 前置条件与运行方式 |
| --- | --- |
| `bun run test` | 依赖已安装；Vitest 单元测试 |
| `bun run test:coverage` | 单元测试与覆盖率报告 |
| `bun run test:l2` | core / cli / api / Web 已构建；端口 17020；本地 D1/R2 与临时目录中的 CLI 配置 |
| `bun run test:e2e` | Chromium；端口 27019；runner 构建 SPA，重建 `.wrangler/state-e2e-spa` 并应用本地迁移 |
| `bun run test:e2e:bdd` | Chromium；端口 27019；Vite 首页标题 smoke，后端取决于 Vite 代理 |

`bunx playwright install chromium` 安装浏览器。L2 的 CLI 测试使用临时用户目录，采集流程集成注入模拟采集器；它们不执行真实 `backup`。L2 runner 不覆盖 `.dev.vars`，测试身份通过命令行变量注入。

两套 Playwright 配置都可能在非 CI 模式复用已有服务，且都使用端口 27019。执行前需释放端口。运行 `test:l2` 前也需停止手动启动的同端口 runner。

若要让 BDD smoke 使用本地 API，保持上节终端一的 runner 运行，在另一终端执行：

```bash
OTTER_API_URL=http://127.0.0.1:17020 OTTER_DEV_API_TOKEN= bun run test:e2e:bdd
```

## 部署

CI 在 main 推送后检查代码，并运行本地 API / CLI 集成与 Vite BDD smoke。Release 等待 CI 成功，检出对应提交，构建 Web 并部署单个 Worker；它不执行 D1 迁移。自行部署时需配置自己的 D1、两个 R2 绑定、Access team domain / audience、域名与生产环境的 Cloudflare 凭据，并在需要新 schema 的代码部署前完成迁移。

版本发布脚本 `bun run release` 更新版本与变更记录、创建 Git 提交和 tag；它不执行 `npm publish`。npm CLI 发布由维护者另外处理。普通文档更新无需版本发布或手动 Worker 部署。
