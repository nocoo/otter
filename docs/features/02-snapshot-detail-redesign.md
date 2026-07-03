# Snapshot Detail 页面重设计 — 类型化 Tab + 规范化控件

> 返回 [features](./README.md) · 相关 [Dashboard](../06-dashboard.md) · [采集器详解](../02-collectors.md) · [采集器增强计划](../07-collector-enhancement-plan.md)

## 状态

- 阶段：设计（Draft v0）
- 作者：MBP-SDE-A
- 审查：MBP-Reviewer-A
- 决策人：@zheng-li
- 关联文件：
  - `packages/web/src/pages/SnapshotDetailPage.tsx`
  - `packages/web/src/components/snapshot/collectors-tab.tsx`
  - `packages/web/src/components/snapshot/collector-card.tsx`
  - `packages/web/src/components/snapshot/list-item-row.tsx`
  - `packages/web/src/components/snapshot/file-row.tsx`
  - `packages/web/src/components/snapshot/overview-tab.tsx`

## 背景与问题

当前 Snapshot 详情页由三个 tab 组成：**Overview** / **Config** / **Environment**。Overview 通过 `DashboardSegment` + `StatCard` + 饼图 + 条形图搭建，视觉与信息层次基本合理。剩下两个 tab 把「所有 config 类采集器」和「所有 environment 类采集器」分别塞进同一个页面，每个采集器直接以 `CollectorCard` 大卡形态平铺，卡内再按 Files / Items / Errors / **Skipped** 顺序线性堆叠。

### 主要问题（对照代码定位）

1. **单 tab 内密度过高，滚动成本大**
   - `Config` 目前会同时展示 5 个采集器（`claude-config`、`opencode-config`、`vscode`、`cloud-cli`、`hermes`），`Environment` 会展示 8 个（`shell-config`、`homebrew`、`applications`、`docker`、`fonts`、`dev-toolchain`、`macos-defaults`、`launch-agents`）——见 `packages/cli/src/collectors/index.ts:53`。用户诉求的「细分 tab，每个 tab 一个类型的东西，不要很长」就是要求把这 13 个混在两个 tab 里的采集器拆开。
2. **CSS 大小节奏混乱**（哥举例：`SKIPPED` 上面）
   - `CollectorCard` 内部对 Files / Items / Errors / Skipped 用一个 `divide-y` 容器承载（`collector-card.tsx:76-155`），四个 section 的排版看似统一，但：
     - Files 的每一行走 `file-row.tsx`，字号 `text-xs` + `text-2xs`；
     - Items 的每一行走 `list-item-row.tsx`，字号 `text-sm`（比 Files 大一号），metadata 用 `text-2xs` Badge；
     - Errors / Skipped 用手写 `<ul>` + `border-l-2` 分隔（`collector-card.tsx:129-153`），行高、左内边距、`py-1.5` 都是重新拍的。
   - 结果就是同一张卡内，Files 行、Items 行、Skipped 段落的行高与字号互不对齐——用户看到的「有的大有的小」正是这里。
3. **信息类型被"物理位置"而非"语义类型"分组**
   - dev-toolchain 里同时装了 `node-version` / `python-version` / `ruby-version` / `go-version` / `rust-toolchain` / `npm-global` / `bun-global` / `cargo-global`（`packages/cli/src/collectors/dev-toolchain.ts`），全部塞在 Environment tab 的一张卡里。语言运行时、包管理器与全局包混成一列，用户没法快速定位某类信息。
   - `claude-config` / `opencode-config` / `hermes` 都属于「AI/Assistant Agent 配置」，但当前被分到 Config tab 与其他配置混排，缺少一个聚合入口。
4. **无外链能力**（哥追加的第 1 条需求）
   - Items 只展示 name + version + 少量 badge。Homebrew formula、npm 全局包、cargo crate 等条目本可映射到官方或注册中心 URL，但 `ListItemRow` 内没有链接组件。
5. **Installed Applications 缺少突出**（哥追加的第 2 条需求）
   - Applications 采集器已经带 R2 图标 URL（`packages/cli/src/collectors/applications.ts:80-82`），但目前只作为 Environment tab 中 8 个采集器之一，被同页面稀释；这块是本产品最直观的亮点，应独立 Tab、专属排版。

## 设计目标

1. **一 Tab 一类型**：Tab 数量 ≤ 8，每个 Tab 只承载一个语义类型的内容。
2. **信息节奏规范化**：所有 Tab 内的信息载体（卡片 / 行 / 徽标）走同一套 CSS token（间距、字号、边框），杜绝手写 `border-l-2` / 手拍 `py-1.5`。
3. **可跳转**：条目能通过 `meta.type` 精确识别包管理器归属时，行尾展示外链按钮，指向 Homebrew formula / npm 包 / cargo crate 官方页。
4. **Applications 独立 Tab**：作为图标格子墙 + 版本徽标展示，视觉上和其他 Tab 明显不同。
5. **不改数据结构**：仅调整前端布局与 CSS。`SnapshotCollector` schema、`meta.type` 值、API 响应保持不变，服务端零改动。

## 新 Tab 结构

以采集器 `id`（`packages/cli/src/collectors/index.ts`）为一次映射对象，划为 8 个 tab。每个 tab 只挂 1 个采集器数据，或按明确规则聚合多个同语义采集器的数据。

| # | Tab | 图标 | 采集器来源 | 承载数据 |
|---|-----|------|-----------|----------|
| 0 | **Overview** | `LayoutDashboard` | 所有 | 保留现状：Machine Info、Breakdown、Issues |
| 1 | **Applications** | `AppWindow` | `applications` | 已安装应用图标网格 + 版本 |
| 2 | **Coding Agents** | `Terminal` | `claude-config`、`opencode-config`、`vscode` | 每个 agent 一个 sub-section |
| 3 | **Assistant Agents** | `Bot` | `hermes` | Hermes profile 列表 + 每个 profile 的 config / SOUL / memory 文件 |
| 4 | **Toolchain & Packages** | `Wrench` | `homebrew`、`dev-toolchain` | 按 `meta.type` 二级分组（formula / cask / tap / node-version / npm-global / cargo-global / ...） |
| 5 | **Shell & System** | `TerminalSquare` | `shell-config`、`macos-defaults`、`launch-agents` | dotfiles、macOS defaults、Launch Agents 各一 sub-section |
| 6 | **Infrastructure** | `Cloud` | `docker`、`cloud-cli` | Docker 配置 + Cloud CLI 凭据 |
| 7 | **Fonts** | `Type` | `fonts` | 字体单列（按需分组扩展名） |

> **兼容**：如果快照缺少某个采集器数据（例如 Hermes 未安装 → collector 触发 `skipped`），对应 Tab 直接展示"未采集/未安装"空态，不隐藏 Tab；这样和 Overview 的 Issues 计数一致，也保证 URL / 用户肌肉记忆稳定。

### 每个 Tab 的内容与排版

统一原则：**每个 Tab = 一个可选 Header Meta 行 + 一到多个 Section**，Section 内再决定是 Grid、List 还是 Table。Section 之间用 `space-y-4`（与 Overview 保持一致），不再嵌 `divide-y`。

#### 1. Applications（亮点 Tab）

- **布局**：`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3`
- **格子内容**：
  - 40 × 40 图标（`iconUrl` 或 SHA256 回退），失败降级为 `AppWindow` 灰底
  - 应用名 `text-sm font-medium truncate`
  - 版本 `text-2xs text-muted-foreground tabular-nums`
- **交互**：hover 显示 tooltip（完整名 + 版本）；右上角外链按钮打开 `https://apps.apple.com/search?term=<name>`（可选，先做占位，后续接 Apple Search API 时再启用）
- **搜索**：Tab 顶部一个 `Input`（复用现有 `Search collectors...` 样式），实时过滤 name。
- **头部计数**：`text-xs text-muted-foreground` 一行显示 `{visible}/{total} apps`。

#### 2. Coding Agents

- 内部 sub-tab（`Tabs` 二级）或垂直折叠面板，二选一由 Reviewer 决定；本 draft 提议 **二级 Tabs**：
  - `Claude Code`（`claude-config`）
  - `OpenCode`（`opencode-config`）
  - `VS Code / Cursor`（`vscode`）
- 每个 sub-tab 内：
  - Files section：复用规范化后的 `FileRow`
  - Items section（如 OpenCode 的 skills、Claude 的 plugins）：改走「行密度更紧凑的 List」而非 grid，因为条目普遍 < 20 项
- **删除**：不再展示单张 `CollectorCard` 的重复 header，Tab 本身即 header。

#### 3. Assistant Agents

- 顶部一行 profile 选择器：`{profile}` chips（default、tomato、babaco 等，命名来自 `hermes` collector 的虚拟路径前缀）
- 选中 profile 后：
  - Persona section — SOUL.md 缩略（前 6 行 + `View` 按钮打开 FileViewerDialog）
  - Memory section — MEMORY.md / USER.md 双卡
  - Config & Cron section — config.yaml、cron/jobs.json（redacted 标识）
  - Skills section — 列表 + description
- 空态：Hermes 未安装时展示 `Hermes profile 未采集` + `raft` 帮助链接（内部文档路径）

#### 4. Toolchain & Packages

- 按 `meta.type` 二级分组的横向 Tabs：
  - `Homebrew Formulae`（`meta.type=formula`）
  - `Homebrew Casks`（`meta.type=cask`）
  - `Taps`（`meta.type=tap`）
  - `Language Runtimes`（`meta.type` ∈ {node-version, python-version, ruby-version, go-version, rust-toolchain}）
  - `Global Packages`（`meta.type` ∈ {npm-global, bun-global, cargo-global}）
- 单条渲染：`ListItemRow`（规范化后）—— name、version、meta chips、右侧外链按钮（见「外链规范」）。

#### 5. Shell & System

- Section 1：Shell dotfiles（Files 列表）
- Section 2：macOS Defaults（domains × keys，二级折叠）
- Section 3：Launch Agents（`~/Library/LaunchAgents/*.plist` 文件列表 + label）

#### 6. Infrastructure

- Section 1：Docker（`~/.docker/config.json` 摘要、当前 context、registry endpoints）
- Section 2：Cloud CLI（gcloud、aws、azure 三个 sub-list，走 chips）

#### 7. Fonts

- 顶部 chip 组：按扩展名分组（`otf` / `ttf` / `woff2` / `unknown`）
- 单列 List（比 grid 更适合字体名），行 = 字体名 + 格式徽标 + 预览占位（后续可注册 CSS `@font-face`）

## CSS 规范化（Design Tokens）

新增 `packages/web/src/components/snapshot/design-tokens.ts`（或直接在 `globals.css` 补 utility class），把 Snapshot 页面内所有卡片 / 行 / 徽标的度量集中到一份。

| Token | 值 | 应用位置 |
|-------|----|---------|
| `--otter-section-gap` | `1rem`（`space-y-4`） | Tab 内 Section 之间 |
| `--otter-row-py` | `0.5rem`（`py-2`） | 所有列表行统一垂直 padding |
| `--otter-row-px` | `0.75rem`（`px-3`） | 所有列表行统一水平 padding |
| `--otter-row-radius` | `var(--radius-md)`（`rounded-lg`） | 行容器圆角 |
| `--otter-row-border` | `border border-border/50 bg-secondary` | 行容器背景 + 边框 |
| `--otter-row-icon` | `h-4 w-4 shrink-0` | 行首图标基线 |
| `--otter-row-title` | `text-sm truncate` | 主标题字号（行/卡通用） |
| `--otter-row-meta` | `text-2xs text-muted-foreground tabular-nums` | 版本 / size / 时间 |
| `--otter-badge` | `text-2xs font-normal px-1.5 py-0` | 所有 `Badge` |
| `--otter-section-header` | `text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5` | Section 标题（如现在的 FILES / ITEMS / ERRORS / SKIPPED） |

### 具体统一动作

1. **合并三种 section 头写法**（`FILES` / `ITEMS` 用 `<h4>`，Errors / Skipped 用相同 `<h4>` 但颜色变体）→ 抽 `<SectionHeader tone="default | destructive">` 组件；`SKIPPED` 上方字号将与 `FILES` 完全一致，解决"上下字号不一致"的直接问题。
2. **把 Errors / Skipped 的手写 `<li border-l-2 border-destructive/40 pl-3 py-1.5>` 换成 `<ListItemRow variant="error" | "skipped">`**，让所有 list 走同一容器，`py` / `px` / `radius` 由 token 决定。
3. **`FileRow` 与 `ListItemRow` 字号对齐**：主字体统一 `text-sm`，次要信息统一 `text-2xs`（当前 FileRow 主字体为 `text-xs`，会显得比 ListItemRow 小一号）。
4. **`Tabs` 高度对齐**：一级 `TabsTrigger` 保持 `h-9`，二级用 `h-8` 变体；不再出现 `TabsTrigger + Badge` 计数徽标手写 padding（当前 `SnapshotDetailPage.tsx:117-127` 硬编码了 `text-2xs font-normal ml-0.5 px-1.5 py-0`），统一到 `Badge` 组件默认。

## 外链规范

在 `packages/web/src/components/snapshot/helpers.ts` 新增 `resolveExternalUrl(item)`：根据 `meta.type` 生成对应包管理器/注册中心的规范链接，只有确定能生成正确链接时才返回，否则 `undefined`。行组件按存在性渲染右侧 `<a target="_blank" rel="noopener">` 外链按钮（`lucide-react` 的 `ExternalLink` 图标）。

| `meta.type` | 生成规则 | 例子 |
|-------------|---------|------|
| `formula` | `https://formulae.brew.sh/formula/<encodedName>` | `https://formulae.brew.sh/formula/ripgrep` |
| `cask` | `https://formulae.brew.sh/cask/<encodedName>` | `https://formulae.brew.sh/cask/visual-studio-code` |
| `tap` | `https://github.com/<owner>/homebrew-<repo>`（`name` = `owner/repo` 拆分；无 `/` 则不生成） | `https://github.com/hashicorp/homebrew-tap` |
| `npm-global` | `https://www.npmjs.com/package/<encodedName>`（scoped 名称保留 `@` 与 `/`） | `https://www.npmjs.com/package/@biomejs/biome` |
| `bun-global` | 同 `npm-global`（复用 npm 页面） | 同上 |
| `cargo-global` | `https://crates.io/crates/<encodedName>` | `https://crates.io/crates/tokio` |
| `node-version` / `python-version` / `ruby-version` / `go-version` / `rust-toolchain` | 无稳定外链，返回 `undefined` | — |
| `pinned` / `default` / `active` / 其余 meta | 不作为外链主键 | — |

**约束**：
- URL 一律走 `encodeURIComponent` 处理 name，防止空格 / `@` / `/` 注入。
- Tap 若 `owner/repo` 解析失败 → 不生成链接，不抛错。
- 生成规则集中在 helper，Reviewer 认为规则错时改一处即可。
- 后续要加平台（PyPI、RubyGems、Docker Hub）时，在同一 helper 追加分支。

## 交付切分（原子化提交）

按 CLAUDE.md 「原子化 commit」要求分片提交，每片可独立通过 `bun run test` + `bun run typecheck`。

| 序号 | Commit | 内容 |
|------|--------|------|
| C1 | `docs(design): draft snapshot detail redesign plan` | 本文档（v0） |
| C2 | `docs(design): incorporate reviewer feedback for snapshot redesign` | 根据审查落定 v1 |
| C3 | `refactor(web): extract snapshot section header + list row primitives` | 抽 `SectionHeader` / 统一 `ListItemRow` 变体，纯重构，不动 Tab 结构 |
| C4 | `feat(web): add external link resolver for list items` | `resolveExternalUrl` + `ListItemRow` 尾部外链按钮 + 单测 |
| C5 | `feat(web): split snapshot detail into typed tabs` | 新 Tab 结构落地（1–7 号 Tab） |
| C6 | `feat(web): applications tab with icon grid` | Applications 独立 Tab（图标网格） |
| C7 | `feat(web): coding & assistant agent tabs` | Coding / Assistant sub-tabs |
| C8 | `feat(web): toolchain, shell-system, infra, fonts tabs` | 剩余 4 个 tab |
| C9 | `test(web): e2e coverage for redesigned snapshot detail tabs` | Playwright 用 rich fixture 验证 |
| C10 | `docs(architecture): sync 06-dashboard.md snapshot detail section` | 把 `docs/06-dashboard.md` 的 SPA 路由 + 组件描述更新 |

> C1–C2 是文档；C3–C10 是代码。每次 push 前跑 `bun run test`、`bun run test:l2`、`bun run typecheck`。

## 验证策略（对齐 6DQ / 4-tier 测试）

- **L1 单元测试**：新增 `helpers.external-url.test.ts` 覆盖每种 `meta.type` 分支 + 边界（scoped npm、空 tap、encode 特殊字符）。
- **L2 集成**：现有 `test:l2` 保持绿；不动 API。
- **L3 组件测试**（如引入）：`ListItemRow` 变体渲染快照。
- **L4 Playwright BDD**：新增 scenario：
  - "查看 Applications tab → 显示图标网格"
  - "查看 Toolchain & Packages tab → 切到 Homebrew Formulae → 首个条目有 formulae.brew.sh 外链"
  - "查看 Fonts tab → 按 ttf 过滤后计数正确"
- **视觉回归**：先不做，等 Tab 结构稳定后再引入 Playwright screenshot 对比。

## 影响面 & 风险

| 面 | 影响 | 处理 |
|----|------|------|
| API / D1 / R2 | 无 | — |
| SPA 路由 | 无（仍是 `/snapshots/:id`） | — |
| 现有 rich fixture | 需扩展一个包含 hermes profile 与更多 dev-toolchain meta 的 fixture | 与 C9 同步 |
| 用户直达 URL | 现在 `?tab=config` 之类如果有硬编码的 anchor / 深链，会失效 | 目前无深链证据（`SnapshotDetailPage` 只用 `defaultValue="overview"`），验证 archive 归档文档无引用即可 |
| 无采集数据的 Tab | 需要空态设计 | 每个 Tab 各自实现「未采集」空态，复用一个 `<EmptyState>` 组件 |

## 待 Reviewer 明确的开放问题

1. **Coding Agents 内部形态**：二级 Tabs vs. 折叠面板？draft 提议二级 Tabs，但如果 Reviewer 认为三块（Claude / OpenCode / VS Code）里两块常常为空，改折叠更佳。
2. **Tab 数量 8 个是否偏多**？draft 已经把 13 collector 压到 7 个内容 tab（+ Overview）；再减需要把 Coding Agents 合到 Assistant Agents，但语义会模糊。
3. **Applications 图标失败率**：R2 `apps/otter/{hash}.png` 未必对所有 app 都有；先按当前 `iconError` 灰底 fallback；是否要加 tooltip 提示"未收录图标"？
4. **外链是否要"用户可选关闭"**？出于隐私考虑，用户可能不希望 dashboard 主动向外部注册中心跳转（不算请求，只是渲染链接）。draft 默认开启；如需 toggle，加到 Settings 页面。

---

审查完成后 v0 → v1，v1 敲定后按 C3 起进入实现阶段。
