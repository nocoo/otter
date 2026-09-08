<p align="center">
  <img src="assets/brand/icon-rounded.png" alt="Otter" width="128" height="128" />
</p>

<h1 align="center">Otter</h1>

<p align="center">保存 macOS 开发环境的配置与清单，查看不同时间的快照。</p>

<p align="center">
  <a href="https://otter.hexly.ai">站点</a> ·
  <a href="docs/README.en.md">English</a>
</p>

## 这是什么

Otter 在 macOS 上采集开发工具配置、应用与环境清单，保存为本地或云端 JSON 快照，方便迁移电脑和核对环境变化。Web 界面提供快照总览、文件查看和 JSON 导出；恢复文件与重新安装软件需要手动完成。

云端由一个 Cloudflare Worker 同时提供 API 和 Web 页面。D1 保存用户、Token 与快照索引，R2 保存快照正文和应用图标。快照列表与详情按登录邮箱区分。

## 功能

- 采集 Claude Code、OpenCode、Shell 配置，以及 Homebrew、应用、VS Code 扩展、Docker、字体、开发工具、Cloud CLI、macOS 偏好和 LaunchAgents 清单。
- 采集 Hermes 主配置与命名 Profile 的配置、记忆、用户资料、定时任务和技能名称。
- 在本地保存快照，或登录后压缩上传；成功上传快照后保存本地副本，再尝试导出和上传应用图标。
- 在 CLI 中列出、查看和比较本地快照。比较依据是文件增删与大小、清单名称变化，无法识别同大小文件的内容变化。
- 在 Web 中分页查看快照、检查采集器结果与文件内容、导出 JSON，并管理兼容旧接入方式的 Webhook。

`--slim` 只排除 Claude 的提示历史和会话摘要。其他配置、Hermes 记忆和用户资料仍会采集。凭据遮盖按文件类型和匹配规则处理；首次使用可先保存本地 JSON 并检查内容，再决定是否上传。具体范围见[采集与运行说明](docs/10-development.md#采集与快照边界)。

## 使用

### 安装与本地快照

需要 macOS 和 Node.js；仓库声明的 Node.js 范围为 `^22.12.0 || ^24.0.0 || >=26.0.0`。

```bash
npm install -g @nocoo/otter
otter --help
otter scan --slim --save
otter snapshot list
```

本地快照位于 `~/.config/otter/snapshots/`。用列表中的完整 ID 或前八位 ID 查看、比较快照，将示例中的 ID 替换为实际值：

```bash
otter snapshot show SNAPSHOT_ID
otter snapshot diff OLD_ID NEW_ID
```

### 云端备份

[站点](https://otter.hexly.ai) 使用 Cloudflare Access，需要获准的身份。登录命令打开浏览器连接页，通过本机回调保存 Token：

```bash
otter login
otter backup --slim
```

`backup` 会重新扫描，通过 Bearer Token 上传到 `https://otter.worker.hexly.ai/api/snapshots`，随后上传图标；当前流程无需先创建 Webhook。登录配置位于 `~/.config/otter/config.json`。

`login --dev` 与 `backup --dev` 使用开发配置 `config.dev.json`；登录页切换到 `otter.dev.hexly.ai`，上传目标仍由 `OTTER_API_URL` 决定，未设置时仍是生产 Worker。本地快照和图标目录在两种模式下共用。连接其他部署的说明见[开发指南](docs/10-development.md#地址与登录配置)。

## 开发

使用 Bun 安装依赖，Node.js 版本遵循上述范围。完整构建包含 CLI、API 库和 Web：

```bash
git clone https://github.com/nocoo/otter.git
cd otter
bun install --frozen-lockfile
bun run --cwd packages/core build
bun run --cwd packages/cli build
bun run --cwd packages/api build
bun run build
```

根目录的 `build` 只构建 Web SPA。编译后的 CLI 可用 `node packages/cli/dist/bin.js --help` 查看帮助。

`bun run dev` 在端口 7019 启动 Vite，默认把 `/api` 代理到生产服务 `https://otter.nocoo.workers.dev`。启动前在 `packages/web/.env` 中设置目标 `OTTER_API_URL` 和所需的 `OTTER_DEV_API_TOKEN`；接口操作作用于该目标。根目录 `.env` 不作为这份 Vite 配置的环境文件。使用本地 D1/R2 联调的步骤见[本地联调](docs/10-development.md#本地联调)。

```text
packages/cli/       macOS 采集器、CLI 与本地快照
packages/core/      共享类型
packages/api/       Hono 应用工厂、鉴权与数据访问库
packages/web/       Vite / React 页面
packages/worker/    单 Worker 入口、D1 迁移与 R2 绑定
```

`bun run typecheck` 检查类型，`bun run lint:biome` 检查代码风格。生产 Worker 在 main 的 CI 成功后由 Release 部署；该流程不执行 D1 迁移，也不发布 npm CLI，详见[部署说明](docs/10-development.md#部署)。

## 测试

从仓库根目录运行：

| 范围 | 命令 |
| --- | --- |
| 单元测试 | `bun run test` |
| 单元测试与覆盖率报告 | `bun run test:coverage` |
| 本地 HTTP API 与 CLI 集成 | `bun run test:l2` |
| 本地 Worker 的浏览器测试 | `bun run test:e2e` |
| Vite 首页标题 smoke | `bun run test:e2e:bdd` |

HTTP 与 CLI 集成需要先完成上面的 core、cli、api 和 Web 构建。runner 在端口 17020 启动本地 Wrangler，清空独立的 `.wrangler/e2e` 状态并应用迁移。

浏览器测试需要 Chromium，可先运行 `bunx playwright install chromium`。`test:e2e` 构建 SPA，使用端口 27019 与独立的 `.wrangler/state-e2e-spa`；`test:e2e:bdd` 启动 Vite，后端仍受 Vite 代理配置影响。两套浏览器命令共用端口，非 CI 模式可能复用已有服务，运行前需释放端口；本地后端配置见[测试说明](docs/10-development.md#测试入口)。

## 技术栈

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-14151A?logo=bun&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflareworkers&logoColor=white)

| 部分 | 实现 |
| --- | --- |
| CLI 与采集 | TypeScript、Node.js、@nocoo/base-cli |
| 依赖与构建 | Bun workspaces、TypeScript、Vite |
| Web | React、React Router、SWR、Tailwind CSS、Radix UI、Shiki |
| API 与存储 | Hono、Cloudflare Workers、D1、R2 |
| 认证 | Cloudflare Access、jose、D1 中的 Bearer Token 校验 |
| 验证 | Vitest、Playwright、Biome |

## 文档

- [文档索引](docs/README.md)
- [当前开发、采集范围与部署说明](docs/10-development.md)
- [采集器设计](docs/02-collectors.md)
- [Hermes 采集器](docs/features/01-hermes-collector.md)
- [快照详情页设计](docs/features/02-snapshot-detail-redesign.md)

## 许可证

[MIT](LICENSE) © 2026 Zheng Li
