# Otter for macOS

原生 SwiftUI / AppKit Agent Workspace，采用 Lyre 的单窗口布局与 Showtime 的原生控件、输入测试方式。扫描本机 Agent 配置、追踪 Workflow 来源、编辑完整 Skill 包，并通过内置 Otter CLI 完成扫描、快照和上传。

支持 Claude Code、Codex、Grok、Pi、Hermes（含命名 profile）、OpenCode 和 Gemini CLI 的已知配置入口。文件关系和运行时发现各自记录证据：可以区分链接链、配置引用、硬链接、独立资源、受管理副本的漂移和主动分叉。添加 Workflow / 项目来源后重扫，不依赖固定的工作区路径。

编辑器提供文件树与多标签、独立文档窗口、行号/语法着色、标题大纲、自动换行、缩进、括号配对、系统查找与撤销、中文组合输入、Markdown 阅读与分栏、Quick Look 资源预览。YAML、JSON、TOML 与 Markdown 使用真实解析器；结构化表单只修改能无损定位的四个标量字段，复杂 metadata 和 harness 扩展继续在源码编辑。

新建、导入、资源拖入、导出、分叉、重命名、跨文件替换、包同步和分发通过逐文件审阅执行。源文件保存保留符号链接和执行权限；外部改写进入冲突处理，变更有检查点和条件撤销。退出或关闭标签会保留尚未保存的草稿。

构建需要 macOS 15+、支持 Swift 6 的完整 Xcode、XcodeGen（`brew install xcodegen`）及仓库使用的 Bun。`bun install --frozen-lockfile` 后从仓库根目录运行：

```bash
bun run macos:generate
open apps/macos/Otter.xcodeproj
```

命令行构建：

```bash
bun run macos:build
open build/macos/Build/Products/Release/Otter.app

# 原生核心测试 + 实际 App 输入、磁盘操作与打包 CLI 集成
bun run macos:test

# 仅重跑已有 Debug App 的原生 UI 测试
bun run macos:test:ui

# Universal Release 构建、搬移校验和 DMG / ZIP
bun run macos:package

# Y+1 发布，并将经过验证的 DMG / ZIP 上传 GitHub Release
bun run release -- minor --macos
```

Release App 和 OtterCore 为 arm64 / x86_64 Universal Mach-O。内置 CLI 是两个分别由 Bun 编译的独立可执行文件，按宿主架构选择，运行时无需安装 Node、npm 或 Bun。不要用 `lipo` 合并 Bun 的打包载荷。`macos:package` 会把 App 复制到带空格的新路径，在最小 PATH 下验证本机架构的 CLI，并生成 `build/macos-release/Otter-<version>-macOS-unsigned.dmg`、ZIP、`SHA256SUMS.txt` 与校验报告。DMG 包含 Applications 安装入口，生成后会实际挂载、比对包内文件并运行内置 CLI。

当前产物未做发行签名与公证。已编译两种架构，运行检查仅针对当前宿主；macOS 15、Intel 实机、完整 VoiceOver 与性能门槛仍需单独验收。详见[实现与验证记录](../../docs/features/03-macos-agent-workspace-implementation.md)。

自动化使用 `apps/macos/Fixtures/create.py` 生成的专用扫描根、配置目录与回环 HTTP API；不替换 HOME / CODEX_HOME。鼠标和快捷键通过本进程 AppKit responder 链，中文输入通过 NSTextInputClient。截图只取本进程窗口，无需系统辅助功能或录屏授权。结果位于 `build/macos-native/latest/results/index.html`；完整测试会验证退出后重新启动的草稿恢复。Release 不包含 fixture 启动入口。

工作区设置、草稿、事务历史保存在 `~/Library/Application Support/Otter/`。CLI 认证由 CLI 自己管理，界面只读取遮盖状态。首次启动无需登录；上传在查看具体快照、目标 host 和内容 hash 后单独执行。

`project.yml` 是项目配置来源，`Package.resolved` 固定 Swift 依赖；生成的 `.xcodeproj` 和构建产物不提交。版本号随根目录 `bun run release` 更新。独立 `macOS` workflow 先跑核心/原生 UI，再构建和验证 Universal 包；Web 的 `CI` → `Release` 仍单独部署 `apps/api` 与 `apps/web/dist`。
