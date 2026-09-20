<p align="center">
  <img src="assets/brand/icon-rounded.png" alt="Otter" width="128" height="128" />
</p>

<h1 align="center">Otter</h1>

<p align="center">管理 Agent 配置来源，保护本机配置，并在需要时取回完整内容。</p>

<p align="center">
  <a href="https://otter.hexly.ai">站点</a> ·
  <a href="docs/README.en.md">English</a>
</p>

## 这是什么

Otter 3.0 在 macOS 上管理多个配置来源目录，发现各个 Agent 使用的指令、rules、commands 和完整 skill 包，并与软件、工具清单一起保存为本地和云端快照。未纳入 Workflow 的本机配置、未提交文件和符号链接目标也会在扫描范围内采集。原机器或 Git repo 不可访问时，可以从快照导出保存的内容。

CLI 负责统一采集和备份；Mac App 展示本机的配置来源、Git 状态、Agent 入口和备份情况，保留指令与 Skill 编辑器；Web 按机器浏览历史、比较版本和下载恢复包。文件回填与软件重装仍需手动执行。

云端由一个 Cloudflare Worker 同时提供 API 和 Web 页面。D1 保存用户、Token 与快照索引，R2 保存快照正文和应用图标。快照列表与详情按登录邮箱区分。

## 功能

- 多来源登记与 Mac/CLI 共享：Git repo 和普通文件夹均可加入，显示分支、工作区变更、冲突、upstream 和远端检查时间。
- 统一采集 Claude Code、Codex、Grok、Pi、Hermes、OpenCode、Gemini CLI 的已知配置入口；Hermes default、命名 profile 和配置声明的外部 skills 分别保留。
- 保存完整 skill 包、脚本、引用和小型二进制资源，记录目录、权限、链接链及目标字节；独立资源不必先纳入 Workflow。
- 14 个默认采集器保留 Shell、Homebrew、应用、扩展、Docker、字体、工具链、Cloud CLI、macOS 偏好和 LaunchAgent plist；应用清单补充 ID、路径、版本与可识别的安装来源。
- 先保存不可变本地快照，再上传同一份内容；持久回执、合并时间线、远端核对和下载支持失败后继续处理。
- 按内容、权限、链接和清单版本比较变化；Web 提供机器历史、来源与 Agent/profile 视图、搜索、覆盖报告、单文件和完整恢复 ZIP。

v2 快照会明确记录排除、脱敏、仅清单、读取失败和容量限制。“完整”指记录策略内的采集完整。`--slim` 只排除 Claude 的提示历史和会话摘要，Hermes 记忆和用户资料仍会采集；上传前可检查本地快照。旧 v1 快照仍可查看，其名称清单无法补回过去未保存的 skill 正文。具体范围见[采集与运行说明](docs/10-development.md#采集与快照边界)。

## 使用

### 安装与本地快照

v3.0.0 的 Mac 安装包与升级说明见 [GitHub Release](https://github.com/nocoo/otter/releases/tag/v3.0.0)。自行部署时，请先升级 API，再使用新客户端上传完整快照。

需要 macOS 和 Node.js；仓库声明的 Node.js 范围为 `^22.12.0 || ^24.0.0 || >=26.0.0`。

```bash
npm install -g @nocoo/otter
otter --help
otter source add /absolute/path/to/workflow
otter source add /absolute/path/to/another-source
otter workspace inspect --json
otter scan --slim --save
otter snapshot list
```

本地快照位于 `~/.config/otter/snapshots/`。用列表中的完整 ID 或前八位 ID 查看、比较快照，将示例中的 ID 替换为实际值：

```bash
otter snapshot show SNAPSHOT_ID
otter snapshot diff OLD_ID NEW_ID
otter snapshot export SNAPSHOT_ID --destination /absolute/path/to/new-recovery-folder
```

导出目录必须尚不存在。产物包含保存的文件、目录结构、权限、原始链接映射、覆盖报告和软件清单，不依赖原 repo。CLI 来源登记位于 `~/.config/otter/workspace.json`；首次打开新版 Mac App 会合并旧的来源设置。

### 云端备份

[站点](https://otter.hexly.ai) 使用 Cloudflare Access，需要获准的身份。登录命令打开浏览器连接页，通过本机回调保存 Token：

```bash
otter login
otter backup --slim
otter snapshot timeline
otter snapshot verify SNAPSHOT_ID
otter snapshot download REMOTE_FULL_ID
```

`backup` 重新扫描并先本地保存，通过 Bearer Token 上传到 `https://otter.worker.hexly.ai/api/snapshots`，随后上传图标。未登录或上传失败时本地快照仍保留，可用 `otter backup --snapshot SNAPSHOT_ID` 重试原产物。无需先创建 Webhook。登录配置位于 `~/.config/otter/config.json`。

`login --dev` 与 `backup --dev` 使用开发配置 `config.dev.json`；登录页切换到 `otter.dev.hexly.ai`，上传目标仍由 `OTTER_API_URL` 决定，未设置时仍是生产 Worker。本地快照和图标目录在两种模式下共用。连接其他部署的说明见[开发指南](docs/10-development.md#地址与登录配置)。

## 开发

使用 Bun 安装依赖，Node.js 版本遵循上述范围。完整构建包含 CLI、API 库和 Web：

```bash
git clone https://github.com/nocoo/otter.git
cd otter
bun install --frozen-lockfile
bun run --cwd packages/core build
bun run --cwd apps/cli build
bun run --cwd packages/api build
bun run build
```

根目录的 `build` 只构建 Web SPA。编译后的 CLI 可用 `node apps/cli/dist/bin.js --help` 查看帮助。

`bun run dev` 在端口 7019 启动 Vite，默认把 `/api` 代理到生产服务 `https://otter.worker.hexly.ai`。启动前在 `apps/web/.env` 中设置目标 `OTTER_API_URL` 和所需的 `OTTER_DEV_API_TOKEN`；接口操作作用于该目标。根目录 `.env` 不作为这份 Vite 配置的环境文件。使用本地 D1/R2 联调的步骤见[本地联调](docs/10-development.md#本地联调)。

```text
apps/web/          Vite / React 页面
apps/api/          单 Worker 入口、D1 迁移与 R2 绑定
apps/cli/          macOS 采集器、CLI 与本地快照
apps/macos/        SwiftUI / AppKit Agent Workspace（XcodeGen）
packages/core/     共享类型
packages/api/      Hono 应用工厂、鉴权与数据访问库
```

先运行 `bunx tsc -p packages/core`，再用 `bun run typecheck` 检查类型；`bun run lint:biome` 检查代码风格。生产 Worker 在 main 的 CI 成功后由 Release 部署；该流程不执行 D1 迁移，也不发布 npm CLI。3.0 上线前须先应用 `0005_snapshot_v2.sql`，再部署兼容 v1/v2 的 API/Web，最后分发 CLI/Mac，详见[升级与部署说明](docs/10-development.md#部署)。

`bun run deploy:check` 构建 Web 并执行 Wrangler 部署预演。构建产物位于 `apps/web/dist`，由 `apps/api/wrangler.toml` 的 `../web/dist` 托管；页面和 API 仍随一个 Worker 发布。

安装完整 Xcode、XcodeGen 和 Bun 后，运行 `bun run macos:build`，再打开 `build/macos/Build/Products/Release/Otter.app`。App 内置 CLI，使用时无需 Node / Bun；当前构建未做发行签名与公证。开发、自动化、打包及已知边界见 [macOS 开发说明](apps/macos/README.md)与[实现记录](docs/features/03-macos-agent-workspace-implementation.md)。

## 测试

从仓库根目录运行：

| 范围 | 命令 |
| --- | --- |
| 单元测试 | `bun run test` |
| 单元测试与覆盖率报告 | `bun run test:coverage` |
| Worker 单元测试（Cloudflare runtime） | `bun run test:worker` |
| 本地 HTTP API 与 CLI 集成 | `bun run test:l2` |
| 本地 Worker 的浏览器测试 | `bun run test:e2e` |
| Vite 首页标题 smoke | `bun run test:e2e:bdd` |
| Web 构建与 Worker 部署预演 | `bun run deploy:check` |
| 已运行站点的版本、静态资源与 SPA 路由 | `bun run verify:web <URL>` |
| macOS 应用构建 | `bun run macos:build` |
| macOS 核心与实际 App 集成 | `bun run macos:test` |
| macOS Universal 包与搬移校验 | `bun run macos:package` |

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
| macOS Agent Workspace | SwiftUI、AppKit、TextKit、OtterCore、XcodeGen |
| 认证 | Cloudflare Access、jose、D1 中的 Bearer Token 校验 |
| 验证 | XCTest、AppKit 原生输入、Vitest、Playwright、Biome |

## 文档

- [文档索引](docs/README.md)
- [当前开发、采集范围与部署说明](docs/10-development.md)
- [3.0 配置备份改版与验收记录](docs/features/04-configuration-backup-redesign.md)
- [采集器设计](docs/02-collectors.md)
- [Hermes 采集器](docs/features/01-hermes-collector.md)
- [快照详情页设计](docs/features/02-snapshot-detail-redesign.md)

## 许可证

[MIT](LICENSE) © 2026 Zheng Li
