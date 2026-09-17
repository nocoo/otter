# Otter for macOS

Otter 3.0 原生 SwiftUI / AppKit 工作台，采用 Lyre 的单窗口布局与 Showtime 的原生控件、输入测试方式。CLI 统一发现配置来源与 Agent 入口，Mac 展示本机状态、编辑完整 Skill 包，并协调快照、上传、核对和导出。

主导航为“概览 / 配置来源 / Agents / 备份 / 软件与环境”，保留指令与 Skills 编辑入口。配置来源支持多个 repo 或普通文件夹，显示 Git 工作区、冲突、upstream 和远端检查时间。备份页合并本地与远端版本，区分覆盖缺口和上传状态；软件页展示最近本地快照的安装清单。

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

# 后续版本通过发行验收后，升 patch 并上传经过验证的 DMG / ZIP
bun run release -- patch --macos
```

Release App 和 OtterCore 为 arm64 / x86_64 Universal Mach-O。内置 CLI 是两个分别由 Bun 编译的独立可执行文件，按宿主架构选择，运行时无需安装 Node、npm 或 Bun。不要用 `lipo` 合并 Bun 的打包载荷。构建脚本对新 helper 临时产物执行 ad-hoc 签名、校验和原子替换，也校验缓存签名。`macos:package` 会把 App 复制到带空格的新路径，在最小 PATH 下验证本机架构的 CLI，并生成 `build/macos-release/Otter-<version>-macOS-unsigned.dmg`、ZIP、`SHA256SUMS.txt` 与校验报告。DMG 包含 Applications 安装入口，生成后会实际挂载、比对包内文件并运行内置 CLI。

当前产物未做发行签名与公证。已编译两种架构，运行检查仅针对当前宿主；macOS 15、Intel 实机、完整 VoiceOver 与性能门槛仍需单独验收。详见[实现与验证记录](../../docs/features/03-macos-agent-workspace-implementation.md)。

自动化使用 `apps/macos/Fixtures/create.py` 生成的专用扫描根、配置目录与回环 HTTP API；不替换 HOME / CODEX_HOME。鼠标和快捷键通过本进程 AppKit responder 链，中文输入通过 NSTextInputClient。截图只取本进程窗口，无需系统辅助功能或录屏授权。结果位于 `build/macos-native/latest/results/index.html`；完整测试会验证退出后重新启动的草稿恢复。Release 不包含 fixture 启动入口。

来源、项目和绑定由 CLI 的 `~/.config/otter/workspace.json` 统一管理。首次启动保留旧 Mac 设置备份并合并到 CLI 登记；之后 App 只提交自己的设置变化，保留 CLI 独立登记。外观、窗口、草稿、事务历史和 `jobs.json` 保存在 `~/Library/Application Support/Otter/`。重启时未完成任务标记为中断，可继续处理已经落盘的快照。

CLI 认证由 CLI 自己管理，界面只读取遮盖状态。首次启动无需登录；先创建本地快照，在查看具体内容、目标 host 和摘要后单独上传。上传失败、取消或远端记录消失不会删除本地快照。导出目标须是新目录，内容包含链接目标与软件重装清单；App 不自动执行覆盖式恢复。

新 App 的云端 v2 操作需要新版 API；先应用 `0005_snapshot_v2.sql` 并部署兼容 API/Web，再分发 3.0 客户端。来源目录与 Agent 的完整包采集、容量限制、自定义配置根与历史 v1 的边界见 [3.0 实施记录](../../docs/features/04-configuration-backup-redesign.md)和[运行指南](../../docs/10-development.md)。

`project.yml` 是项目配置来源，`Package.resolved` 固定 Swift 依赖；生成的 `.xcodeproj` 和构建产物不提交。版本号随根目录 `bun run release` 更新。独立 `macOS` workflow 先跑核心/原生 UI，再构建和验证 Universal 包；Web 的 `CI` → `Release` 仍单独部署 `apps/api` 与 `apps/web/dist`。
