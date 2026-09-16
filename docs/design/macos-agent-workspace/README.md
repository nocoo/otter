# Otter macOS 原生设计预览

[打开画廊](index.html) · [产品设计](../../features/03-macos-agent-workspace.md) · [窗口与控件规格](../../features/03-macos-agent-workspace-ui.md) · [代码来源与许可](SOURCES.md)

这是独立的 SwiftUI + AppKit 设计宿主。控件由 Lyre / Showtime 复制适配，页面使用 Otter 的合成资源和关系数据。`apps/macos` 的生产 App 仍是壳子；预览不连接真实 harness、Workflow 配置、Otter CLI 或服务器。

## 查看与复现

在 Otter 仓库根目录，需要完整 Xcode 和 macOS 图形会话：

```bash
# 编译临时 App，执行原生输入检查并渲染浅 / 深色截图
bash docs/design/macos-agent-workspace/render.sh

# 交互查看；退出 App 后删除临时构建
bash docs/design/macos-agent-workspace/render.sh --interactive

# 渲染到其他目录，避免覆盖文档截图
bash docs/design/macos-agent-workspace/render.sh /tmp/otter-native-preview

# 只渲染选定场景，原生输入检查仍执行
OTTER_PREVIEW_SCENES=editor,compact,changes \
  bash docs/design/macos-agent-workspace/render.sh /tmp/otter-editor-preview
```

通过 **Design Preview** 菜单切换 fixture 场景；`⌘⇧D` 切换深浅色，`⌘K` 打开示例技能搜索，`⌘,` 进入设置。示例采集通过该菜单的 **Complete example collection** 推进，不连接任何真实采集器。产品设计中的跨类型搜索、上下文重新扫描和设置持久化仍待接入。

脚本不新增 App 工程、运行时依赖或 CI 工作流，也不依赖相邻 Lyre/Showtime checkout。每次构建使用随机 bundle ID 和独立临时目录；场景数据、草稿与偏好留在内存，截图和验证结果写到指定输出目录。截图调用 `SCShareableContent.currentProcess`，再按窗口 ID 和进程 ID 限定本预览及其 sheet，关闭音频和鼠标捕获。

## 预览包含什么

- 原生 NavigationSplitView / List / Table、toolbar、NSMenu、segmented Picker、sheet 与紧凑窗口 Inspector popover。
- Skills 示例包的四个文件、持有在应用会话中的文本 buffer、NSTextView 输入/撤销、行号、简单阅读视图、一个必填字段示例检查、元数据修改和示例保存。
- 来源与入口的解释布局、变更预览、外部冲突提示、备份阶段与取消、搜索无结果和同窗设置。
- 12 个场景的浅 / 深色截图，画廊支持场景深链接、键盘切换、窄屏和查看原图。

完整 YAML/Markdown parser、语法高亮、多文件事务/合并、拖动分栏、持久化草稿、真实扫描/发现/CLI/上传均属于产品实施范围。预览的“阅读”仅为简单正文展示；必填项检查只认 fixture 的单行 description，不能作为格式校验器。普通页的占位正文与关系数据用于布局评审，不等于已完成适配所有 harness。

## 验证口径

`render.sh` 先发送当前进程内的真实 AppKit 鼠标/键盘事件，再生成截图。检查覆盖系统窗口按钮、toolbar 上下文位置、sidebar 导航、进入编辑、NSTextView 聚焦/输入/Cmd-A/Cmd-Z、换文件、跨页会话保留、Quick Fix sheet、示例保存、缩窗、紧凑 Inspector、取消任务、选定快照身份和清除筛选。fixture 设置仅用于准备场景，输入路径不直接调用按钮 action。

每轮生成 [verification.json](screenshots/verification.json)，其中包含实际通过的检查、OS、独立 App 身份、截图像素与窗口尺寸。它记录**设计预览**的验证，不代表产品 App 的磁盘/CLI 测试通过。

2026-09-15 本轮在 Apple Silicon / macOS 26.6.2 上，以 Swift 6、macOS 15 deployment target 编译通过；**36 项原生输入/窗口/布局检查通过，生成 24 张截图**。标准窗口实际外框为 1280 × 852 pt，内容布局高 800 pt；紧凑窗口外框为 1000 × 732 pt，内容布局高 680 pt。系统侧栏安全区会使实际工作区宽度与简单减去理想栏宽的结果不同，检查使用布局后的真实尺寸。

画廊的 **31 项浏览器检查通过**：24 张图片、场景与外观选择、原图链接、深链接、手机选择器、键盘切换、1536 / 390 px 布局，以及旧流程草图在 1040 px 下的入口；没有浏览器脚本错误。[画廊检查记录](screenshots/gallery-verification.json)保留检查项目。脚本语法、文档本地链接和空白检查通过；没有重复运行未改变的 Web / Worker 测试。

完整 VoiceOver、中文 IME、全屏/缩放偏好、macOS 15 设备运行、真实性能指标、签名/公证和产品发布验收仍需在生产 App 实现后完成。
