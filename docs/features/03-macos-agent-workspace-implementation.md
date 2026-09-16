# Otter Agent Workspace：实现与验证

2026-09-15。`apps/macos` 已从应用壳进入可运行的原生工作区。本记录描述实际代码与验收范围；[产品设计](03-macos-agent-workspace.md)和[UI 规格](03-macos-agent-workspace-ui.md)继续保留完整产品目标，`docs/design` 中的合成预览保留为设计历史。

## 已实现的工作流

| 工作流 | 实际行为 |
| --- | --- |
| 本机诊断 | 扫描七类 harness 的已知入口、共享目录、Hermes 命名 profile、外部技能目录、Claude 插件和所选项目；显示断链、循环、不可读入口、格式问题、禁用配置和来源歧义 |
| 来源关系 | 保留安装入口与逐级符号链接，计算完整包的内容、资源和执行权限摘要；区分配置引用、独立资源、受管理副本的三方漂移与主动分叉 |
| 指令和 commands | 浏览并编辑真实文件，比较 Workflow 当前内容，审阅建立 Codex AGENTS.md 入口；保留旧 instructions.md；同步有基线、检查点和条件撤销 |
| Skill 编辑 | 包内文件树、多标签、独立窗口、行号、基础语法着色、自动换行、缩进、括号配对、标题大纲、系统查找/撤销、中文组合输入、Markdown 阅读/分栏、本地引用与 Quick Look |
| 包管理 | 新建、完整包导入/导出、拖入资源、分叉、重命名、包内替换、完整包同步、共享目录与 Hermes profile 分发；所有结构变更先显示具体文件审阅 |
| 变更恢复 | 保存通过当前链接写入真实源，保留执行位和适用元数据；外部改写保留草稿并进入比较；每次变更写 journal，应用失败和撤销只恢复后置状态仍匹配的文件 |
| CLI 备份 | 内置 CLI 的能力握手、遮盖认证状态、登录、本地扫描/保存、快照列表/查看/差异、固定快照上传、真实阶段日志、取消和 CLI 入口安装 |

扫描只证明当前文件系统事实。Codex / Grok 的显式运行时查询记录 CLI 版本、cwd、发现路径与禁用项；其他版本和 harness 保留“待验证 / 接口未验证”。不会因为在磁盘找到一个 skill，就显示已有 Agent 会话已经加载它。

当前运行时 adapter 限定为调查中核对过的 Codex 0.154.0 与 Grok 1.0.30。核心测试使用专用可执行 fixture 验证握手、禁用项、异常退出与版本限制；原生 UI 测试不启动真实 Agent 或向模型发送消息。

Yams、TOMLKit、swift-markdown 分别承担 YAML、TOML、Markdown 解析，JSON 使用 Foundation。元数据表单修改 `name`、`description`、`license`、`compatibility` 的源码范围，保留未知字段、注释、字段顺序、CRLF 和块标量。复杂 metadata、OpenAI 扩展和其他 harness 字段通过同一个源码 buffer 编辑并检查。表单不会重新序列化整个文档。

草稿按真实源路径保存，重新从另一个 harness 的链接打开时仍能找到同一草稿。关闭标签、切页和正常退出不隐式写入源文件。受消费配置的必需格式错误阻止提交，未完成的编辑仍可保留为草稿。

## 代码边界

| 路径 | 职责 |
| --- | --- |
| `apps/macos/Otter` | SwiftUI 工作区、AppKit 文本编辑、FSEvents、审阅表单和 CLI 任务界面 |
| `apps/macos/OtterCore` | Foundation 模型、链接解析、扫描、解析器、包操作、事务、草稿、进程通信和 Markdown 渲染 |
| `apps/macos/OtterCoreTests` | 独立文件系统 fixture 与真实子进程测试 |
| `apps/cli/src/commands/workspace.ts` | GUI 使用的 JSON / NDJSON 协议，继续复用 CLI 采集与上传逻辑 |
| `scripts/test-macos-ui.py` | 启动实际 Debug App、专用 fixture 与回环 API；验证输入、落盘、上传对象和重启恢复 |
| `scripts/verify-macos-package.py` | Universal 架构、资源、版本、搬移后运行、未签名 ZIP 与实际挂载 DMG 校验 |

CLI 的结构化接口已经实现：`capabilities --json`、`scan --json`、`scan/backup --format ndjson`、`snapshot list/show/diff --json`、`config status/show --json`。事件携带协议版本、任务 ID 和递增序号。`snapshot show` 返回快照与 SHA-256，上传使用指定的 `--snapshot` 和 `--snapshot-sha256`，不会在确认后重新扫描并替换上传内容。扫描对象和已保存快照被分别修改的场景都有验证。

GUI 与测试通过明确的配置目录、输出目录、扫描根和 API URL 传递隔离上下文。没有修改 HOME 或 CODEX_HOME 的流程；认证 token 不进入 UI 状态或日志。Markdown 预览不执行脚本，不载入远程图片，包外引用需要显式打开。

## 自动化与复现

从仓库根目录运行：

```sh
bun install --frozen-lockfile
bun run macos:test
bun run macos:package
```

`macos:test` 先执行 XCTest，再运行实际 App。输入经过 AppKit responder 链；中文测试使用 NSTextInputClient 的标记与提交过程。测试用私有 fixture 文件、独立 bundle ID、最小 PATH 和真实 gzip 回环上传；不需要系统辅助功能或全屏录制权限。

原生集成覆盖来源链、共享源保存、权限保留、系统撤销/查找、Tab / Shift-Tab、中文组合文本、独立窗口、FSEvents 冲突、检查点撤销、指令入口修复、创建/分发、全局搜索、快照 hash 拒绝、上传取消、浅深色、紧凑 Inspector 和退出后恢复草稿。

2026-09-15 的本机验证结果：

| 范围 | 结果 | 归档证据 |
| --- | --- | --- |
| 原生核心 XCTest | 29 项通过，0 失败、0 跳过 | [XCTest 摘要](assets/macos-agent-workspace-native/xctest-summary.json) |
| 实际 App 与协议 | 232 项断言通过：216 项工作区、9 项重启恢复、7 项 HTTP 协议检查 | [运行摘要](assets/macos-agent-workspace-native/native-summary.json)、[工作区断言](assets/macos-agent-workspace-native/native-verification.json)、[恢复断言](assets/macos-agent-workspace-native/native-recovery.json) |
| 真实 CLI 上传 | 2 次 gzip HTTP 请求；验证固定快照、摘要拒绝和第二次上传的主动取消 | [运行摘要](assets/macos-agent-workspace-native/native-summary.json) |
| 原生截图 | 25 张；仓库保留其中 7 张，全量画廊保存在本次构建目录 | [真实界面与截图索引](assets/macos-agent-workspace-native/README.md) |
| Release 打包 | Universal App / OtterCore、两种架构的独立 CLI、含空格路径搬移、最小 PATH、版本与资源检查通过 | [打包报告](assets/macos-agent-workspace-native/package-verification.json) |

这些截图来自运行中的 SwiftUI / AppKit 应用和隔离 fixture。原生核心结果取自 XCTest 的 xcresult，最终 UI 结果取自重建 Debug App 后独立执行的 `macos:test:ui`。

2026-09-16 对照 Showtime 校订排版：页面与弹窗标题统一为 23 pt，分组标题 14 pt，正文 13 pt，说明 12 pt，状态/代码说明 11 pt；页面/卡片内边距统一为 24/16 pt。设置与创建表单使用共享标签列，资源表格与筛选行两端对齐，分段选择器使用系统 large 控件。更新后的 Debug App 通过 334 项原生/协议检查，生成 28 张窗口截图；新增实测覆盖控件高度与基线、表单列、输入焦点以及原生分段的方向键与空格操作。完整证据位于 `build/macos-native/20260916-151143-a85cadd6/results/`。本轮未修改 Core、CLI、API 或 Web 逻辑。

每次运行保留独立证据：

- `build/macos/Logs/Test/*.xcresult`：原生核心 XCTest 结果。
- `build/macos-native/latest/results/index.html`：实际 App 的截图画廊。
- 同目录 `verification.json`、`recovery.json`、`summary.json`：断言、截图与上传验证结果。
- `build/macos-release/verification.json`：架构、搬移、无 Node / Bun PATH 和版本校验。
- `build/macos-release/Otter-<version>-macOS-unsigned.zip`：可搬移的本地构建。
- 同目录 `.dmg`：带 Applications 安装入口的磁盘映像；附带 `SHA256SUMS.txt`。

Web 回归仍独立运行。本次已通过 651 项 Vitest 测试、22 项 Worker 测试、15 项本地 HTTP / CLI 集成、27 项 SPA 浏览器测试和 1 项 BDD smoke；TypeScript、Biome、workflow actionlint、Web 构建与 Wrangler 部署预演通过。覆盖率为 statements 97.06%、branches 94.90%、functions 94.38%、lines 97.41%，未降低 `vitest.config.ts` 中的原有门槛。Biome 仍报告原有的 36 条信息级建议，无错误或警告。

## CI 和发行边界

独立 `macOS` workflow 先运行原生核心和实际 UI，上传 xcresult / 截图 / 日志，然后构建并验证 Universal App 与独立 CLI。Web 的 `CI` → `Release` 不依赖此 workflow，部署单元仍是 `apps/api`，静态目录仍是 `../web/dist`。本次只验证部署预演，没有发布到生产环境。

本机验证环境是 Apple Silicon、macOS 26.6.2、Xcode 26.6。部署目标为 macOS 15+。App 与 OtterCore 编译为 arm64 / x86_64，Bun helper 按两种架构分别打包；运行检查只执行当前宿主架构。产物尚未做 Apple 发行签名与公证。

完整 VoiceOver、高对比度、减少透明度、macOS 15 / Intel 实机，以及设计中的大规模性能指标仍需后续实测。当前标题导航、基础着色和解析诊断不等于语言服务器；OpenAI 复杂元数据仍用源码编辑。Markdown 改名只更新能可靠定位的解析引用，引用式链接等无法安全重写的场景会阻止操作并说明原因。不会把这些边界描述为已经完成的发行验收。
