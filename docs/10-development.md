# 当前开发与运行说明

[中文 README](../README.md) · [English README](README.en.md) · [文档索引](README.md)

## 当前架构

`apps/api/src/index.ts` 是唯一 Worker 入口：`/api/*` 交给 `packages/api` 的 `createApp()`，注入原生 D1 / R2 绑定；`/health` 和 `/ingest/*` 保留旧接入处理。`packages/api` 是库，不需要另起 Node 服务。Vite 构建结果由同一 Worker 的静态资源绑定提供。

| 资源 | 用途 |
| --- | --- |
| D1 `DB` | 用户、API Token、Webhook、按账号/设备索引的快照摘要与文件名搜索分块 |
| R2 `SNAPSHOTS` | 完整 JSON 快照 |
| R2 `ICONS` | 应用图标，默认前缀 `apps/otter` |
| `apps/web/dist` | React SPA 静态资源 |

Wrangler 的 `run_worker_first` 虽然列出 `/v1/*`，实际顶层 dispatcher 没有把它转交给 `createApp()`。当前客户端使用 `/api/*`；不要依赖旧文档中的 `/v1/*` 兼容接口。当前健康检查入口为 `/api/live`，它会查询 D1。Release 校验其版本号，并检查 Web 首页、JS/CSS 资源及 `/settings` 的 SPA 回退。

应用放在 `apps/`：Web、Worker、CLI 和 macOS 原生应用。`packages/core` 与 `packages/api` 分别保存共享类型和运行时无关的 API 逻辑。Bun workspace 名称、CLI npm 包名、Worker 名称、域名与 D1/R2 绑定沿用原配置。

## 采集与快照边界

3.0 默认启用 14 个采集器。新增 `agent-workspace` 统一发现登记来源、项目、七类 Agent 的已知配置入口、共享 skills、Hermes 命名 profile 和声明的外部目录，生成快照 schema v2。Mac 消费同一份 CLI 清单。CLI IPC/NDJSON 协议仍为 1，`capabilities` 单独声明支持的快照格式和操作。

已知 Agent 包括 Claude Code、Codex、Grok、Pi、Hermes、OpenCode、Gemini CLI。来源目录即使没有被 Agent 使用也会采集；Agent 目录里的独立 skill 不要求先加入来源。完整包包含脚本、references、assets、小型二进制、空目录与权限，保存符号链接链及可读取目标。配置引用、受管理副本和主动 fork 单独记录；磁盘存在不代表当前 Agent 会话已经加载。

采集仍保留 Claude 配置、插件、统计缓存、提示历史及会话索引摘要。`--slim` 仅跳过提示历史与会话摘要。Hermes default 和命名 profile 包括 config、SOUL、记忆、用户资料、cron 和完整 skills；不读取会话数据库、`.env` 或 `auth.json`。SSH 私钥只记存在情况。v2 对所保存的配置文本统一应用凭据字段和内容模式遮盖，包括 Markdown、脚本、JSONC、TOML、YAML；被遮盖的正文无法恢复原凭据，上传前可检查本地产物。

Agent 内容策略为单文件 4 MiB、单份快照内唯一内容 32 MiB、20,000 个条目、深度 32。依赖目录、生成缓存、凭据文件及数据库按策略排除；服务端限制解压后请求为 64 MiB。超过限制、断链、权限不足、采集期间变化都有明确覆盖记录，不会显示为全部已保护。内容摘要在脱敏后计算，同份快照内按摘要去重，导出时还原引用。完整度是记录范围与策略内的结论，不是系统镜像或全盘原子快照。

`scan --save` 离线保存 JSON。`backup` 先本地保存，再 gzip 上传同一份不可变内容；未登录、断网或响应丢失均保留本地快照。图标在普通备份后单独上传。`scan --json` 的 stdout 是单份 JSON；进度写入 stderr，App 使用版本化 NDJSON 事件。

### 来源与备份命令

| 命令 | 用途 |
| --- | --- |
| `otter source add /absolute/folder` | 登记 repo、普通目录或补充资源路径；不修改来源文件 |
| `otter source list` / `otter source remove SOURCE_ID` | 查看或移除登记；移除不删除目录 |
| `otter source fetch SOURCE_ID` | 显式检查 Git 远端；保留上次成功时间和本次失败信息 |
| `otter workspace inspect --json` | 配置来源、Agent 资源、Git 观测、配置与最近本地快照的差异状态 |
| `otter scan --slim --save` | 无需登录生成完整本地快照，包含默认环境采集器 |
| `otter backup --snapshot SNAPSHOT_ID` | 重传已有产物；可用 `--snapshot-sha256 HASH` 固定审阅内容 |
| `otter snapshot list` / `show SNAPSHOT_ID` | 本地列表与内容；完整 ID 或唯一的前八位 ID |
| `otter snapshot timeline` | 当前 API/账号的本地、远端合并时间线，标明待上传、待核对和远端缺失 |
| `otter snapshot verify SNAPSHOT_ID` | 读取远端正文与回执，和本地摘要核对 |
| `otter snapshot download REMOTE_FULL_ID` | 下载远端快照，核对 v2 回执后保存本地 |
| `otter snapshot diff OLD_ID NEW_ID` | 比较已保存的内容、执行位、链接与清单版本；部分扫描或范围变化不推断删除 |
| `otter snapshot export SNAPSHOT_ID --destination /absolute/new-folder` | 在新目录中展开配置，生成 `snapshot.json`、`links.json`、`environment.json` 和 `RESTORE.md` |

`source`、`workspace` 和新增 snapshot 命令默认输出 JSON，也支持 `--format ndjson`。`--config-dir` / `OTTER_CONFIG_DIR` 选择独立配置目录，`--output-dir` 选择快照目录。隔离测试使用 `--scan-root`，必须同时指定文件采集器；默认日常采集使用真实用户目录。`--collectors` 自定义列表时要保留 `agent-workspace` 才能获得 v2 的配置覆盖模型。

### 状态与取回

`~/.config/otter/workspace.json` 保存来源、项目和绑定；`device.json` 保存稳定安装身份，机器改名不改变 ID。Mac 首次迁移备份旧设置为 `workspace.macos-import.json`，之后只同步自身更改，保留 CLI 的独立登记和并发冲突。App 的外观、草稿、事务与持久任务仍在 Application Support。认证、安装身份与上传回执不混入可恢复的配置正文。

`snapshots/` 在生产与开发模式间共用；`receipts/` 按 API origin、凭据指纹与快照 ID 分隔。回执不保存 Token。相同 ID/相同内容可重试，相同 ID/不同内容拒绝覆盖。时间线区分采集、上传、最近核对时间；曾成功上传但现在远端缺失时提示重新上传。Git 领先/落后来自本地 upstream，只有显式 fetch 才更新 Otter 的远端检查时间。

配置变化和完整环境变化分别计算稳定摘要，忽略采集时间和耗时。同长度内容、执行位、链接目标及软件版本变化可被识别。Web 显示机器最近采集、最近完整版本、来源与 Agent/profile 历史，支持文件名/资源名搜索、分页和比较；它显示的是采集时状态，不判断原机器此刻在线与否。

CLI 导出与 Web ZIP 会展开保存的链接目标，保留原始路径和链接关系作为恢复说明，不要求原 repo 可用。导出只允许新目录，核对摘要并限制相对路径，保留空目录与执行权限。旧 v1 正文仍可取回，名称清单无法生成缺失的包内容；v1 机器按历史主机名分组，不自动认定为同名 v2 设备。

当前不自动覆盖实际 Agent 配置、不安装软件、不执行恢复脚本，也不后台上传。自定义 Agent home 尚无持久化覆盖设置，可把额外配置目录登记为来源以备份，但不会自动成为一个新的 Agent 实例。来源登记的独占锁在进程被强制终止后可能残留；确认没有 Otter/CLI 写入任务后才能手动移除 `workspace.lock`。这些边界保留在 [3.0 验收记录](features/04-configuration-backup-redesign.md)中。

## 地址与登录配置

| 入口 | 默认值与配置 |
| --- | --- |
| 浏览器站点 | `https://otter.hexly.ai`，Cloudflare Access |
| 开发登录页 | `https://otter.dev.hexly.ai`，由 `login --dev` 选择 |
| CLI 上传 API | `https://otter.worker.hexly.ai`，由进程环境变量 `OTTER_API_URL` 覆盖 |
| Vite 代理 | `https://otter.worker.hexly.ai`，由 Vite 环境中的 `OTTER_API_URL` 覆盖 |
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
bun run --cwd apps/cli build
bun run --cwd packages/api build
bun run build
node apps/cli/dist/bin.js --help
```

根目录 `build` 只构建 Web。`typecheck` 与 `lint` 都调用类型检查脚本；共享类型变更后先 `bunx tsc -p packages/core` 生成声明，再检查下游。代码风格使用 `bun run lint:biome`。源代码 CLI 构建后使用 Node 执行，Bun 不是已发布 CLI 的必需运行时。

## 本地联调

`bun run dev` 启动 Vite，默认端口 7019。其 `loadEnv()` 从 `apps/web` 工作目录读取环境文件，因此首次配置应在 `apps/web/.env` 中设置 `OTTER_API_URL`、`OTTER_DEV_API_TOKEN`，根目录 `.env.example` 可作字段参考。默认代理连接生产 Worker，目标服务的 Token 由代理放进 `Authorization` 请求头。

需要本地 D1 / R2 时，可复用仓库的隔离 API runner。在完成构建后，先确认端口 17020 空闲，再于终端一运行：

```bash
bun scripts/run-api-e2e.ts
```

它每次启动都会清空 `apps/api/.wrangler/e2e`，按顺序应用迁移，并启动 `--local --persist-to` Worker，使用测试邮箱 `dev@localhost`。该目录只保存可丢弃的联调数据。终端二显式连接它，并清空代理 Token，让本地测试身份生效：

```bash
OTTER_API_URL=http://127.0.0.1:17020 OTTER_DEV_API_TOKEN= bun run dev
```

runner 的鉴权旁路要求显式 `E2E_SKIP_AUTH=true` 且 `ENVIRONMENT` 不是 production。普通 `bun run dev:worker` 是 Wrangler 的独立开发入口，默认端口 8787；它不会自动更改 Vite 的代理目标，也不会自动应用迁移。不要把本地测试身份变量部署到生产。

## 测试入口

| 命令 | 前置条件与运行方式 |
| --- | --- |
| `bun run test` | 依赖已安装；Vitest 单元测试 |
| `bun run test:coverage` | 单元测试与覆盖率报告；门槛保持 statements/lines 95%、branches/functions 94% |
| `bun run test:worker` | Web 已构建；独立 Vitest 配置，在 Cloudflare runtime 中测试 Worker |
| `bun run test:l2` | core / cli / api / Web 已构建；端口 17020；本地 D1/R2 与临时目录中的 CLI 配置 |
| `bun run test:e2e` | Chromium；端口 27019；runner 构建 SPA，重建 `.wrangler/state-e2e-spa` 并应用本地迁移 |
| `bun run test:e2e:bdd` | Chromium；端口 27019；Vite 首页标题 smoke，后端取决于 Vite 代理 |
| `bun run deploy:check` | 构建 Web 后在 `apps/api` 执行 Wrangler `deploy --dry-run` |
| `bun run verify:web <URL>` | 对已运行的 Worker 校验 API 版本、Web 资源和 SPA 路由 |
| `bun run macos:build` | macOS 15+、完整 Xcode、XcodeGen、Bun；编译 Universal App 和双架构 CLI |
| `bun run macos:test` | XCTest 与实际 AppKit 输入；隔离来源、真实内置 CLI、回环 HTTP、取消、撤销和重启恢复 |
| `bun run macos:package` | Release 构建、最小 PATH、带空格搬移目录及 DMG/ZIP 挂载验证 |

`bunx playwright install chromium` 安装浏览器。L2 的 CLI 测试使用临时用户目录，采集流程集成注入模拟采集器；它们不执行真实 `backup`。L2 runner 不覆盖 `.dev.vars`，测试身份通过命令行变量注入。

两套 Playwright 配置都可能在非 CI 模式复用已有服务，且都使用端口 27019。执行前需释放端口。运行 `test:l2` 前也需停止手动启动的同端口 runner。

若要让 BDD smoke 使用本地 API，保持上节终端一的 runner 运行，在另一终端执行：

```bash
OTTER_API_URL=http://127.0.0.1:17020 OTTER_DEV_API_TOKEN= bun run test:e2e:bdd
```

## 部署

CI 在 main 推送后检查代码、类型与覆盖率，运行 Worker 单元测试、本地 API / CLI 集成、基于生产构建的浏览器测试、Vite BDD smoke，以及 Worker 部署预演。浏览器 runner 和发布后的检查复用 `scripts/verify-web.ts`，确保缺失 JS 被 SPA 回退成 HTTP 200 时也能发现问题。

Release 等待 CI 成功，检出对应提交，在仓库根目录安装依赖和构建 Web，然后从 `apps/api` 部署单个 Worker。`apps/api/wrangler.toml` 的静态目录为 `../web/dist`。发布后通过同一个 Worker 的 `https://otter.worker.hexly.ai` 地址校验 API 版本、JS/CSS 资源和 SPA 路由，无需给 CI 配置 Cloudflare Access 登录凭据。

生产环境继续使用 `CF_API_TOKEN`、`CF_ACCOUNT_ID` secrets 和 `deploy-otter-production` 并发锁。Release 不执行 D1 迁移。自行部署时需配置自己的 D1、两个 R2 绑定、Access team domain / audience、域名与生产环境的 Cloudflare 凭据，并在需要新 schema 的代码部署前完成迁移。

3.0 的升级顺序：

1. 按现有 D1 变更流程保留数据库备份，应用 `apps/api/migrations/0005_snapshot_v2.sql`。迁移保留旧记录，建立账号内快照主键、设备/摘要列与分块搜索表。
2. 部署同时读取 v1/v2 的 API 和 Web。R2 条件创建保证对象不可变，D1 索引失败可按原 ID 重试；两端成功后才返回上传确认。
3. 分发 3.0 CLI/Mac。新客户端上传 v2 需要新版 API；旧 v1 客户端仍可对新版 API 使用原接口。Mac 首次启动合并旧来源登记。
4. 重新执行一次完整本地采集，审阅并上传，核对远端回执和恢复导出，建立新的设备与内容基线。旧快照不回写成 v2。

`deploy:check` 仅执行部署预演；正式发行需按上述顺序完成生产迁移、API/Web 部署和客户端分发。

macOS 使用独立的 `macOS` workflow，原生目录、构建脚本或该 workflow 改动时触发。它编译应用壳，Web 发布继续只依赖 `CI`。构建命令和产物位置见 [macOS 开发说明](../apps/macos/README.md)。

版本发布脚本 `bun run release` 同步各 TypeScript workspace 和 macOS `project.yml` 的版本，更新变更记录、创建 Git 提交和 tag；它不执行 `npm publish`。npm CLI 发布由维护者在 `apps/cli` 另行处理。普通文档更新无需版本发布或手动 Worker 部署。

如果开发阶段已同步好版本号并写好 `Unreleased` 变更记录，使用 `bun run release -- 3.0.0 --prepared --macos` 完成发行。该模式要求显式版本与根 `package.json` 一致，保留已有升级说明并填入发行日期；已存在的本地或远端 tag 会阻止发布。
