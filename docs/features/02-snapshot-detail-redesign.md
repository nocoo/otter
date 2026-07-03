# Snapshot Detail 页面重设计 — 类型化 Tab + 规范化控件

> 返回 [features](./README.md) · 相关 [Dashboard](../06-dashboard.md) · [采集器详解](../02-collectors.md) · [采集器增强计划](../07-collector-enhancement-plan.md)

## 状态

- 阶段：设计（v1，已合并 Reviewer 意见）
- 作者：MBP-SDE-A
- 审查：MBP-Reviewer-A（v0 审查完成，见"审查记录"）
- 决策人：@zheng-li
- 关联文件：
  - `packages/web/src/pages/SnapshotDetailPage.tsx`
  - `packages/web/src/components/snapshot/collectors-tab.tsx`
  - `packages/web/src/components/snapshot/collector-card.tsx`
  - `packages/web/src/components/snapshot/list-item-row.tsx`
  - `packages/web/src/components/snapshot/file-row.tsx`
  - `packages/web/src/components/snapshot/overview-tab.tsx`
  - `packages/web/src/components/ui/tabs.tsx`（响应式改造点）
  - `packages/cli/src/collectors/*.ts`（数据来源，不改）

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
   - dev-toolchain 里同时装了 `node-version` / `python-version` / `ruby-version` / `go-version` / `rust-toolchain` / `npm-global` / `bun-global` / `cargo-global` / **`tool-version`（Volta 管的 node/npm/yarn/pnpm）**（`packages/cli/src/collectors/dev-toolchain.ts`），全部塞在 Environment tab 的一张卡里。语言运行时、包管理器与全局包混成一列，用户没法快速定位某类信息。
   - `claude-config` / `opencode-config` / `hermes` 都属于「AI/Assistant Agent 配置」，但当前被分到 Config tab 与其他配置混排，缺少一个聚合入口。
4. **无外链能力**（哥追加的第 1 条需求）
   - Items 只展示 name + version + 少量 badge。Homebrew formula、npm 全局包、cargo crate 等条目本可映射到官方或注册中心 URL，但 `ListItemRow` 内没有链接组件。
5. **Installed Applications 缺少突出**（哥追加的第 2 条需求）
   - Applications 采集器已经带 R2 图标 URL（`packages/cli/src/collectors/applications.ts:80-82`），但目前只作为 Environment tab 中 8 个采集器之一，被同页面稀释；这块是本产品最直观的亮点，应独立 Tab、专属排版。

## 设计目标

1. **一 Tab 一类型**：一级 Tab 数量 = 8（含 Overview），每个 Tab 只承载一个语义类型的内容。
2. **信息节奏规范化**：所有 Tab 内的信息载体（卡片 / 行 / 徽标）走同一套 class contract（间距、字号、边框），杜绝手写 `border-l-2` / 手拍 `py-1.5`。
3. **可跳转 & 只做准确链接**：条目能通过 `meta.type` 精确识别包管理器归属时，行尾展示外链按钮，指向 Homebrew formula / npm 包 / cargo crate 官方页；无法精确解析的一律不渲染按钮（不做 App Store 搜索、Google 搜索等猜测链接）。
4. **Applications 独立 Tab**：作为图标格子墙 + 版本徽标展示，视觉上和其他 Tab 明显不同；无外链。
5. **不改数据结构**：仅调整前端布局与 CSS。`SnapshotCollector` schema、`meta.type` 值、API 响应保持不变，服务端 / collector 零改动。
6. **响应式**：一级 Tabs 在窄屏必须能水平滚动、不撑破布局；二级 Tabs 同样处理。

## 新 Tab 结构

以采集器 `id`（`packages/cli/src/collectors/index.ts`）为一次映射对象，划为 8 个 tab。每个 tab 只挂 1 个采集器数据，或按明确规则聚合多个同语义采集器的数据。

| # | Tab | 图标 | 采集器来源 | 承载数据 |
|---|-----|------|-----------|----------|
| 0 | **Overview** | `LayoutDashboard` | 所有 | 保留现状：Machine Info、Breakdown、Issues |
| 1 | **Applications** | `AppWindow` | `applications` | 已安装应用图标网格 + 版本 |
| 2 | **Coding Agents** | `Terminal` | `claude-config`、`opencode-config`、`vscode` | 二级 Tabs：Claude / OpenCode / VS Code |
| 3 | **Assistant Agents** | `Bot` | `hermes` | Hermes profile 列表 + 每个 profile 的 config / SOUL / memory 文件 + skills |
| 4 | **Toolchain & Packages** | `Wrench` | `homebrew`、`dev-toolchain` | 按 `meta.type` 二级分组 |
| 5 | **Shell & System** | `TerminalSquare` | `shell-config`、`macos-defaults`、`launch-agents` | dotfiles、macOS defaults、Launch Agents 各一 sub-section |
| 6 | **Infrastructure** | `Cloud` | `docker`、`cloud-cli` | Docker 配置 + Cloud CLI 凭据 |
| 7 | **Fonts** | `Type` | `fonts` | 字体单列（按扩展名过滤） |

> **兼容**：如果快照缺少某个采集器数据（例如 Hermes 未安装 → collector 触发 `skipped`），对应 Tab 直接展示"未采集/未安装"空态，不隐藏 Tab；这样和 Overview 的 Issues 计数一致，也保证 URL / 用户肌肉记忆稳定。

### 响应式 Tab 导航（v1 新增，来自 Reviewer 反馈 #2）

**问题**：`packages/web/src/components/ui/tabs.tsx:26` 的 `TabsList` 是 `inline-flex w-fit`，`TabsTrigger:60` 是 `whitespace-nowrap`；8 个一级 Tab（每个包含图标 + 中文/英文名 + 可能的计数 Badge）在窄屏（< 640px，例如 iPhone 14 竖屏）会横向撑破整个内容区。

**方案**：不改动 `ui/tabs.tsx` 基础组件（其他页面共用），改在 SnapshotDetailPage 侧包一层滚动容器：

```tsx
// Snapshot 详情页专用 TabsList 容器
<div className="relative -mx-4 md:mx-0">
  <div className="overflow-x-auto scrollbar-none px-4 md:px-0
                  [mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-16px),transparent)]">
    <TabsList className="w-max">
      {/* ... 8 个 TabsTrigger ... */}
    </TabsList>
  </div>
</div>
```

要点：
- 外层 `-mx-4 md:mx-0` 让滚动区域延伸到容器边缘，视觉上暗示"可横滑"。
- `mask-image` 左右两侧 16px 渐隐，提示还有内容。
- `TabsList` 保留原生 `inline-flex w-fit`（Radix 依赖），但用 `w-max` 强制展开自然宽度。
- 二级 Tabs（Coding Agents 内部、Toolchain & Packages 内部）沿用同一模式包一层。
- 移动端不使用 Select/Combobox 替代方案 —— 会打散 Tab 语义，且 Radix Tabs 里换成 Select 需要额外维护 active state。横滑 + 渐隐已足够。

### 每个 Tab 的内容与排版

统一原则：**每个 Tab = 一个可选 Header Meta 行 + 一到多个 Section**，Section 内再决定是 Grid、List 还是 Table。Section 之间用 `space-y-4`（与 Overview 保持一致），不再嵌 `divide-y`。

#### 1. Applications（亮点 Tab）

- **布局**：`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3`
- **格子内容**：
  - 40 × 40 图标（`iconUrl` 或 SHA256 回退），失败降级为 `AppWindow` 灰底
  - 应用名 `text-sm font-medium truncate`
  - 版本 `text-2xs text-muted-foreground tabular-nums`
- **交互**：
  - **无外链**（v1 修订，来自 Reviewer 反馈 #1）：不再挂 App Store search 链接。搜索页不属于"能生成准确链接"的范畴。
  - **Tooltip**（v1 明确，来自 Reviewer 4.3）：hover 恒定显示完整 app 名 + version；如图标加载失败，追加一行 `Icon unavailable`（`text-2xs text-muted-foreground`，不使用 error 色），避免造成醒目的错误状态。
- **搜索**：Tab 顶部一个 `Input`（复用现有 `Search collectors...` 样式），实时过滤 name。
- **头部计数**：`text-xs text-muted-foreground` 一行显示 `{visible}/{total} apps`。

#### 2. Coding Agents（v1 定案：二级 Tabs）

- 内部使用 **二级 Tabs**（Reviewer 定案 #1）：三个子 Tab 属同一语义下的明确子类型，Tab 比折叠面板更短且不引入 open/close 状态；二级 TabsList 同样按上文"响应式 Tab 导航"包滚动容器。
  - `Claude Code`（`claude-config`）
  - `OpenCode`（`opencode-config`）
  - `VS Code / Cursor`（`vscode`）
- 每个 sub-tab 内：
  - Files section：复用规范化后的 `FileRow`
  - Items section（如 OpenCode 的 skills、Claude 的 plugins）：改走「行密度更紧凑的 List」而非 grid，因为条目普遍 < 20 项
- **删除**：不再展示单张 `CollectorCard` 的重复 header，Tab 本身即 header。

#### 3. Assistant Agents（v1 修订，来自 Reviewer 反馈 #3）

**数据形态明确**（对照 `packages/cli/src/collectors/hermes.ts:131-158`）：

- Profile 通过 `lists[]` 内 `name === "profile:<slug>"` 且 `meta.type ∈ {"main","named"}` 识别。`meta.skillsCount` 用于头部显示。
- Skill 通过 `lists[]` 内 `meta.type === "skill"` 识别，`meta.profile` 是所属 profile 名；显示名可用 `name.split("/")[1]`（即去掉 profile 前缀）。
- 每个 profile 的文件通过 `files[]` 内 `path.startsWith("~/.hermes/<profile>/")` 拆分：
  - `~/.hermes/<profile>/config.yaml`（redacted）
  - `~/.hermes/<profile>/SOUL.md`
  - `~/.hermes/<profile>/memories/MEMORY.md`
  - `~/.hermes/<profile>/memories/USER.md`
  - `~/.hermes/<profile>/cron/jobs.json`（redacted）

**UI**：
- 顶部 profile 选择器 chips（依 `lists` 中 `profile:*` 顺序，default 优先）
- 选中 profile 后：
  - Persona section — SOUL.md 前 6 行 + `View` 按钮打开 FileViewerDialog
  - Memory section — MEMORY.md / USER.md 双卡
  - Config & Cron section — config.yaml、cron/jobs.json（每个 FileRow 后附一个 `Redacted` badge）
  - **Skills section — 仅显示 skill name + profile chip**（v1 修订：不显示 description，因为 collector 未采集 description；如后续需要 description，将走独立的 collector 增强 PR，不在本 redesign 范围内）
- 空态：Hermes 未安装时展示 `Hermes profile 未采集`（对应 collector 的 `skipped` 消息 `Hermes not installed (~/.hermes/ not found)`）

#### 4. Toolchain & Packages（v1 修订，来自 Reviewer 反馈 #4）

- 按 `meta.type` 二级分组的横向 Tabs（同样走响应式包裹）：
  - `Homebrew Formulae`（`meta.type=formula`）
  - `Homebrew Casks`（`meta.type=cask`）
  - `Taps`（`meta.type=tap`）
  - `Language Runtimes`（`meta.type` ∈ {`node-version`, `python-version`, `ruby-version`, `go-version`, `rust-toolchain`}）
  - **`Tool Managers`（`meta.type=tool-version`）** — Volta 管的 node/npm/yarn/pnpm，保留 `manager: volta` chip（v1 补入）
  - `Global Packages`（`meta.type` ∈ {`npm-global`, `bun-global`, `cargo-global`}）
- 单条渲染：`ListItemRow`（规范化后）—— name、version、meta chips、右侧外链按钮（见「外链规范」）。
- 兜底：如未来出现新 `meta.type` 未落到任何 sub-tab，falls back to `Others` sub-tab（自动展开于末尾），并在开发日志中告警，防止数据"消失"。

#### 5. Shell & System

- Section 1：Shell dotfiles（`shell-config` 的 Files 列表）
- Section 2：macOS Defaults（`macos-defaults` 的 items，按 domain 分组折叠）
- Section 3：Launch Agents（`launch-agents` 的 items，label + plist 路径）

#### 6. Infrastructure

- Section 1：Docker（`docker` collector 的 files 摘要 + items）
- Section 2：Cloud CLI（`cloud-cli` 的 items 按 `meta.provider` 分组：gcloud / aws / azure）

#### 7. Fonts

- 顶部 chip 组：按扩展名分组（`otf` / `ttf` / `woff2` / `unknown`），依赖 collector 已经填进去的 `meta.format`（`packages/cli/src/collectors/fonts.ts:26`）
- 单列 List（比 grid 更适合字体名），行 = 字体名 + 格式徽标 + 预览占位（后续可注册 CSS `@font-face`）

## 规范化的行/头组件（v1 修订，来自 Reviewer 反馈 #5）

原 v0 把 padding/字号写成 CSS custom property（`--otter-row-border: border border-border/50 bg-secondary`），语义上 CSS var 承载不了 Tailwind class。v1 改为 **class map + 组件 variant**，可直接被组件消费：

**新增文件**：`packages/web/src/components/snapshot/primitives/styles.ts`

```ts
export const snapshotRow = {
  base: "flex items-center gap-2.5 rounded-lg border border-border/50 bg-secondary px-3 py-2",
  icon: "h-4 w-4 shrink-0 text-muted-foreground",
  title: "text-sm truncate flex-1",
  meta: "text-2xs text-muted-foreground tabular-nums shrink-0",
  destructive: "border-destructive/30 bg-destructive/5",
  muted: "border-border bg-card",
} as const;

export const snapshotBadge = {
  base: "text-2xs font-normal px-1.5 py-0",
  type: "border-info/30 bg-info/10 text-info",
  pinned: "border-success/30 bg-success/10 text-success",
  default: "border-success/30 bg-success/10 text-success",
} as const;
```

**新增组件**：
- `packages/web/src/components/snapshot/primitives/SectionHeader.tsx`
  - Props: `icon?: LucideIcon`, `tone?: "default" | "destructive"`, `children`
  - class 固定为 `text-xs font-medium uppercase tracking-wider flex items-center gap-1.5`，`tone` 决定 `text-muted-foreground` vs `text-destructive`
- `packages/web/src/components/snapshot/primitives/SnapshotRow.tsx`
  - Props: `variant?: "default" | "error" | "skipped"`, `icon?: LucideIcon`, `title`, `meta?`, `right?`
  - 用 `cn(snapshotRow.base, variant === "error" && snapshotRow.destructive, variant === "skipped" && snapshotRow.muted)` 组合
- 现有 `FileRow` / `ListItemRow` 内部改成套 `SnapshotRow` 的具体实例，字段字号自然对齐。

### 具体统一动作

1. **合并三种 section 头写法**（`FILES` / `ITEMS` 用 `<h4>`，Errors / Skipped 用相同 `<h4>` 但颜色变体）→ 统一到 `<SectionHeader>` 组件；`SKIPPED` 上方字号将与 `FILES` 完全一致，解决"上下字号不一致"的直接问题。
2. **把 Errors / Skipped 的手写 `<li border-l-2 border-destructive/40 pl-3 py-1.5>` 换成 `<SnapshotRow variant="error" | "skipped">`**，让所有 list 走同一容器，`py` / `px` / `radius` 由 `snapshotRow.base` 决定。
3. **`FileRow` 与 `ListItemRow` 字号对齐**：主字体统一 `text-sm`（`snapshotRow.title`），次要信息统一 `text-2xs`（`snapshotRow.meta`）。当前 FileRow 主字体为 `text-xs`，会显得比 ListItemRow 小一号——修复后消失。
4. **`Tabs` 高度对齐**：一级 `TabsTrigger` 保持 `h-9`，二级用 `h-8` 变体；不再出现 `TabsTrigger + Badge` 计数徽标手写 padding（当前 `SnapshotDetailPage.tsx:117-127` 硬编码了 `text-2xs font-normal ml-0.5 px-1.5 py-0`），统一到 `snapshotBadge.base` class。

## 外链规范

在 `packages/web/src/components/snapshot/helpers.ts` 新增 `resolveExternalUrl(item)`：根据 `meta.type` 生成对应包管理器/注册中心的规范链接，只有确定能生成正确链接时才返回，否则 `undefined`。行组件按存在性渲染右侧 `<a target="_blank" rel="noopener noreferrer">` 外链按钮（`lucide-react` 的 `ExternalLink` 图标）。

| `meta.type` | 生成规则 | 例子 |
|-------------|---------|------|
| `formula` | `https://formulae.brew.sh/formula/<encodedName>` | `https://formulae.brew.sh/formula/ripgrep` |
| `cask` | `https://formulae.brew.sh/cask/<encodedName>` | `https://formulae.brew.sh/cask/visual-studio-code` |
| `tap` | `https://github.com/<owner>/homebrew-<repo>`（`name` = `owner/repo` 拆分；无 `/` 则不生成） | `https://github.com/hashicorp/homebrew-tap` |
| `npm-global` | `https://www.npmjs.com/package/<encodedName>`（scoped 名称保留 `@` 与 `/`） | `https://www.npmjs.com/package/@biomejs/biome` |
| `bun-global` | 同 `npm-global`（复用 npm 页面） | 同上 |
| `cargo-global` | `https://crates.io/crates/<encodedName>` | `https://crates.io/crates/tokio` |
| `node-version` / `python-version` / `ruby-version` / `go-version` / `rust-toolchain` / `tool-version` | 无稳定注册中心 URL，返回 `undefined`，不渲染按钮 | — |
| `skill` / `profile:main` / `profile:named` / `font` | 内部条目，返回 `undefined` | — |
| Applications 条目 | **返回 `undefined`**（v1 修订：不做 App Store search 猜测链接） | — |

**约束**：
- URL 一律走 `encodeURIComponent` 处理 name，防止空格 / `@` / `/` 注入；scoped npm 例外处理 `@scope/name` → 分段 encode 保留 `/`。
- Tap 若 `owner/repo` 解析失败 → 不生成链接，不抛错。
- 生成规则集中在 helper，Reviewer 认为规则错时改一处即可。
- 后续要加平台（PyPI、RubyGems、Docker Hub）时，在同一 helper 追加分支。
- **默认开启，无 Settings 开关**（Reviewer 定案 #4）：链接仅在用户点击时才发起请求，渲染 anchor 本身不算发起对外请求，隐私成本可忽略。

## 交付切分（原子化提交，v1 修订：来自 Reviewer 反馈 #6）

按 CLAUDE.md 「原子化 commit」要求分片提交，每片可独立通过 `bun run test` + `bun run typecheck`，且每片都能落到"可交互、可测试的中间态"，不出现 UI 半成品。

| 序号 | Commit | 内容 | 落地后可测 |
|------|--------|------|-----------|
| C1 | `docs(design): draft snapshot detail redesign plan` | 本文档 v0 | 文档评审 |
| C2 | `docs(design): incorporate reviewer feedback for snapshot redesign` | 本文档 v1 | 文档评审 |
| C3 | `refactor(web): extract snapshot section header + row primitives` | 新增 `primitives/{SectionHeader,SnapshotRow,styles.ts}`，`FileRow`/`ListItemRow` 内部套用；不改任何 Tab 结构 | 单元测试 + 现有 Playwright 用例仍通过 |
| C4 | `feat(web): add external link resolver for list items` | `resolveExternalUrl` + `SnapshotRow` 尾部外链按钮 + 单元测试 | 单元测试覆盖每种 `meta.type` |
| C5 | `feat(web): scaffold typed snapshot tabs with responsive scroll` | 新的 8-Tab 骨架 + typed collector lookup + 响应式 TabsList 容器 + 每个 Tab 的空态；Tab 内容里仅接入现有旧渲染逻辑，未做拆分 | Playwright：8 个 Tab 可点击、窄屏可横滑、旧数据渲染仍正确 |
| C6 | `feat(web): applications tab with icon grid` | Applications Tab 落地：图标网格 + 搜索 + tooltip + fallback 文案 | Playwright：Applications Tab 渲染网格、搜索过滤生效 |
| C7 | `feat(web): toolchain & packages tab with sub-tabs and external links` | Toolchain & Packages Tab 落地：按 `meta.type` 二级分组（含 `tool-version`）、每条挂 C4 外链按钮 | Playwright：Homebrew Formulae 首条有 formulae.brew.sh 外链 |
| C8 | `feat(web): coding agents tab with sub-tabs` | Coding Agents 二级 Tabs（Claude / OpenCode / VS Code），空态就位 | Playwright：三个 sub-tab 可切换 |
| C9 | `feat(web): assistant agents tab (hermes)` | Assistant Agents Tab：profile chip + persona/memory/config/cron/skills sections，skill 只显示 name+profile chip（未新增 description） | Playwright：Hermes rich fixture 下 profile 切换 + skills 数正确 |
| C10 | `feat(web): shell-system, infrastructure, fonts tabs` | 剩余 3 个 Tab 一次落地（内容体量小，同类结构） | Playwright：Fonts 按 ttf 过滤计数正确 |
| C11 | `test(web): e2e coverage for redesigned snapshot detail tabs` | 用扩展后的 rich fixture 补齐 Playwright BDD 场景 | 所有新 tab 场景通过 |
| C12 | `docs(architecture): sync 06-dashboard.md snapshot detail section` | 更新 `docs/06-dashboard.md` 的 SPA 路由与组件描述 | 文档 review |

> C1–C2 是文档；C3–C12 是代码。每次 push 前跑 `bun run test`、`bun run test:l2`、`bun run typecheck`。
> 提交顺序遵循 Reviewer 建议：**先骨架 → Applications 亮点 → Toolchain 外链 → Coding/Assistant → Shell/Infra/Fonts**，每步落地后 UI 都是完整可用的中间态。

## 验证策略（对齐 6DQ / 4-tier 测试）

- **L1 单元测试**：
  - `helpers.external-url.test.ts` 覆盖每种 `meta.type` 分支 + 边界（scoped npm、空 tap、encode 特殊字符、Applications 一律返回 undefined）
  - `primitives/SnapshotRow.test.tsx` 三种 variant 快照
- **L2 集成**：现有 `test:l2` 保持绿；不动 API。
- **L3 组件测试**（如引入）：`Coding Agents` / `Assistant Agents` Tab 渲染快照。
- **L4 Playwright BDD**：新增 scenario：
  - "查看 Applications tab → 显示图标网格，无外链按钮"
  - "查看 Toolchain & Packages tab → 切到 Homebrew Formulae → 首个条目有 formulae.brew.sh 外链；Tool Managers sub-tab 存在且渲染 volta 条目"
  - "查看 Coding Agents tab → 三个 sub-tab 可切换；VS Code sub-tab 空态展示"
  - "查看 Assistant Agents tab → profile chip 切换 → skills 列表仅有 name + profile chip"
  - "查看 Fonts tab → 按 ttf 过滤后计数正确"
  - "移动端视口（375px）下一级 TabsList 可横滑，不撑破布局"
- **视觉回归**：先不做，等 Tab 结构稳定后再引入 Playwright screenshot 对比。

## 影响面 & 风险

| 面 | 影响 | 处理 |
|----|------|------|
| API / D1 / R2 | 无 | — |
| Collector（CLI）| 无（严格"不改数据结构"）| — |
| SPA 路由 | 无（仍是 `/snapshots/:id`） | — |
| 现有 rich fixture | 需扩展一个包含 hermes profile 与更多 dev-toolchain meta（含 `tool-version`）的 fixture | 与 C11 同步 |
| 用户直达 URL | 现在 `?tab=config` 之类如果有硬编码的 anchor / 深链，会失效 | 目前无深链证据（`SnapshotDetailPage` 只用 `defaultValue="overview"`），验证 archive 归档文档无引用即可 |
| 无采集数据的 Tab | 需要空态设计 | 每个 Tab 各自实现「未采集」空态，复用一个 `<EmptyState>` 组件 |
| `ui/tabs.tsx` 基础组件 | 不改（其他页面共用），只在 SnapshotDetailPage 侧包滚动容器 | — |

## 审查记录

### v0 → v1 修订项

来自 @MBP-Reviewer-A 2026-07-04 审查（本 features/02 线程 msg=b0ac42f7），全部合并：

1. **Applications 外链去除** — 删除 `apps.apple.com/search` 猜测链接；Applications Tab 无外链，仅保留 tooltip。（对应本文档 #1 Applications 段 + 外链表兜底行）
2. **响应式 Tab 导航** — 新增专用滚动容器方案（`overflow-x-auto` + `mask-image` 渐隐）；一级、二级 TabsList 同规则包裹。（新增章节"响应式 Tab 导航"）
3. **Hermes 数据形态** — 明确 profile / skill / files 的识别规则；Skills section 只显示 name + profile chip，不再承诺 description（保持 collector 零改动）。（对应 #3 Assistant Agents 段）
4. **Toolchain 补 `tool-version`** — Volta 管理的 node/npm/yarn/pnpm 补入新增的 `Tool Managers` sub-tab；未来未知 `meta.type` fallback 到 `Others`。（对应 #4 Toolchain 段）
5. **CSS token → class map + 组件 variant** — 撤销 CSS custom property 方案，改为 `primitives/styles.ts` + `SectionHeader` / `SnapshotRow` 组件。（对应"规范化的行/头组件"章节）
6. **提交顺序调整** — C5 只做骨架 + 响应式；C6 Applications 优先；C7 Toolchain 外链；C8 Coding；C9 Assistant；C10 剩余；C11 E2E；C12 文档同步。每步落地后 UI 皆可交互可测。（对应"交付切分"表）

### Reviewer 定案的开放问题

1. **Coding Agents 内部形态**：二级 Tabs（不是折叠面板）。
2. **Tab 数量 8 个是否偏多**：可接受，不合并 Coding / Assistant。
3. **Applications 图标 fallback**：Tooltip 恒定显示完整名 + version；图标失败时补 `Icon unavailable` 中性文案，不做醒目错误状态。
4. **外链关闭开关**：不加。渲染 anchor 不算对外请求。

---

v1 敲定后按 C3 起进入实现阶段。
