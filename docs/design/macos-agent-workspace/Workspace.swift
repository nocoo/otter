// Isolated design fixture. All resources, relationships, validation and jobs are examples.
// No agent discovery, filesystem writes, subprocesses, authentication or uploads.
import AppKit
import SwiftUI

enum WorkspacePage: String, CaseIterable, Identifiable {
    case overview, agents, instructions, skills, workflow, backups, settings
    var id: String { rawValue }
    var title: String {
        switch self {
        case .overview: "概览"
        case .agents: "Agents"
        case .instructions: "指令与命令"
        case .skills: "Skills"
        case .workflow: "Workflow"
        case .backups: "备份与任务"
        case .settings: "设置"
        }
    }
    var symbol: String {
        switch self {
        case .overview: "square.grid.2x2"
        case .agents: "terminal"
        case .instructions: "text.alignleft"
        case .skills: "sparkles.rectangle.stack"
        case .workflow: "point.3.connected.trianglepath.dotted"
        case .backups: "externaldrive"
        case .settings: "slider.horizontal.3"
        }
    }
}

enum PreviewSheet: String, Identifiable {
    case change, fix, upload, search, conflict, distribute
    var id: String { rawValue }
}

struct ExampleSkill: Identifiable {
    let id: String
    let summary: String
    let source: String
    let relationship: String
    let discovery: String
    static let all: [Self] = [
        .init(id: "workspace-notes", summary: "整理项目笔记与引用", source: "Workflow", relationship: "实时共享", discovery: "待验证"),
        .init(id: "review-notes", summary: "保存审阅结论与后续事项", source: "Workflow", relationship: "实时共享", discovery: "待验证"),
        .init(id: "deploy-checks", summary: "检查部署前置条件", source: "Workflow", relationship: "受管理副本", discovery: "待验证"),
        .init(id: "herdr-control", summary: "协调本地工作会话", source: "Hermes / cherry", relationship: "关系待确认", discovery: "待验证")
    ]
}

@MainActor @Observable final class PreviewWorkspace {
    var page = WorkspacePage.overview
    var dark = false
    var context = "全部 Agents"
    var inspectorRequested = true
    var compactInspector = false
    var availableWidth: CGFloat = 1068
    var editorOpen = false
    var packageID = "workspace-notes"
    var file = "SKILL.md"
    var openFiles = ["SKILL.md", "references/conventions.md"]
    var selectedSkills: Set<String> = ["workspace-notes"]
    var selectedAgent: String? = "Codex"
    var instructionKind = "指令"
    var editorMode = "源码"
    var inspectorTab = "元数据"
    var settingsTab = "通用"
    var skillSearch = ""
    var sourceFilter = "所有来源"
    var bindingSource = "AGENTS.md"
    var globalSearch = ""
    var watchChanges = true
    var draftAutosave = true
    var editorFontSize = 13
    var sheet: PreviewSheet?
    var job = "idle"
    var snapshotID = "demo-20260915-0932"
    var hasConflict = false
    var receipt = false
    var hint = "索引已就绪"
    var buffers: [String: String] = [:]
    var saved: [String: String] = [:]
    @ObservationIgnored weak var window: NSWindow?
    @ObservationIgnored weak var editor: NSTextView?
    @ObservationIgnored var editorViews: [String: NSScrollView] = [:]
    @ObservationIgnored var anchors: [String: WeakView] = [:]

    var showsInspector: Bool {
        inspectorRequested && availableWidth >= 980 && page != .settings
    }
    var activeKey: String { packageID + "/" + file }
    var skillText: String { buffers[packageID + "/SKILL.md"] ?? initialFiles["SKILL.md"]! }
    var activeText: String {
        get { buffers[activeKey] ?? initialFiles[file] ?? "" }
        set { buffers[activeKey] = newValue; hint = "示例草稿已保留" }
    }
    var isDirty: Bool { activeText != (saved[activeKey] ?? initialFiles[file] ?? "") }
    // Deliberately limited to this fixture's single-line field, not a YAML validator.
    var descriptionText: String {
        get {
            String(skillText.split(separator: "\n", omittingEmptySubsequences: false)
                .first(where: { $0.hasPrefix("description:") })?.dropFirst(12) ?? "")
                .trimmingCharacters(in: .whitespaces)
        }
        set {
            var lines = skillText.components(separatedBy: "\n")
            if let index = lines.firstIndex(where: { $0.hasPrefix("description:") }) {
                lines[index] = "description: " + newValue
                buffers[packageID + "/SKILL.md"] = lines.joined(separator: "\n")
            }
        }
    }
    var hasProblem: Bool { descriptionText.isEmpty }
    var visibleSkills: [ExampleSkill] {
        ExampleSkill.all.filter {
            (skillSearch.isEmpty || $0.id.localizedCaseInsensitiveContains(skillSearch)
             || $0.summary.localizedCaseInsensitiveContains(skillSearch))
                && (sourceFilter == "所有来源" || $0.source == sourceFilter)
        }
    }
    var sourcePath: String {
        if packageID == "herdr-control" { return "~/.hermes/profiles/cherry/skills/herdr-control" }
        if packageID == "deploy-checks" { return "~/.codex/skills/deploy-checks" }
        return "~/Developer/workflow/agents/skills/" + packageID
    }
    var sourceTitle: String {
        packageID == "herdr-control" ? "Hermes / cherry 本地包" : packageID == "deploy-checks" ? "Codex 受管理副本" : "Workflow 源文件"
    }
    var packageRelationship: String { ExampleSkill.all.first { $0.id == packageID }!.relationship }
    var shared: Bool { packageRelationship == "实时共享" }
    var consumers: [String] {
        switch packageID {
        case "herdr-control": ["Hermes · cherry"]
        case "deploy-checks": ["Codex · 专用目录"]
        case "review-notes": ["Claude · 专用目录", "Codex · 共享目录"]
        default: ["Claude · 专用目录", "Codex · 共享目录", "Pi · 共享目录"]
        }
    }
    var initialFiles: [String: String] {
        [
            "SKILL.md": """
            ---
            name: \(packageID)
            description:
            license: MIT
            metadata:
              owner: personal
            ---

            # \(packageID)

            整理项目笔记，并保留它们与源文件的关系。

            ## 使用时机

            当用户需要整理项目笔记、补齐引用或检查来源时使用。

            ## 工作步骤

            1. 阅读当前项目的笔记目录。
            2. 按主题组织内容，保留原始引用。
            3. 列出无法解析的链接，交由用户确认。

            ## 支持文件

            - [引用约定](references/conventions.md)
            - [链接检查](scripts/check-links.sh)

            """,
            "references/conventions.md": "# 引用约定\n\n保留来源路径，用相对路径引用包内文件。\n\n## 外部来源\n\n标明原始作者与文件位置，不根据相同名称推断归属。\n",
            "scripts/check-links.sh": "#!/bin/sh\n# Example script; the design preview never executes it.\nset -eu\nprintf '%s\\n' 'Review local references before publishing.'\n",
            "agents/openai.yaml": "interface:\n  display_name: Workspace notes\n  short_description: 整理项目笔记与引用\n  default_prompt: 帮我整理当前项目的笔记。\npolicy:\n  allow_implicit_invocation: true\n"
        ]
    }

    func openPackage() {
        guard selectedSkills.count == 1 else { return }
        packageID = selectedSkills.sorted().first ?? "workspace-notes"
        page = .skills
        editorOpen = true
    }

    func openFile(_ path: String) {
        if !openFiles.contains(path) { openFiles.append(path) }
        file = path
    }

    func saveExample() {
        guard !hasProblem, !hasConflict else { return }
        saved[activeKey] = activeText
        hint = "已保存示例 · 未写入本机文件"
    }

    func applySheet() {
        switch sheet {
        case .fix:
            descriptionText = "整理项目笔记、补齐引用，并检查笔记与源文件的关系。"
            hint = "示例修复已应用 · 尚未保存"
        case .change: receipt = true; hint = "2 项示例变更已演示 · 运行时发现仍待验证"
        case .upload: job = "done"; hint = "示例上传已完成 · 未发送网络请求"
        case .conflict: hint = "已保留示例草稿 · 冲突仍待处理"
        case .distribute: hint = "已演示分发 · 未创建本机链接"
        default: break
        }
        sheet = nil
    }
}

struct WorkspaceView: View {
    @Bindable var model: PreviewWorkspace
    @State private var sidebarVisibility: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $sidebarVisibility) {
            sidebar.navigationSplitViewColumnWidth(min: 192, ideal: 212, max: 248)
        } detail: {
            VStack(spacing: 0) {
                GeometryReader { geometry in
                    HStack(spacing: 0) {
                        workspace.frame(maxWidth: .infinity, maxHeight: .infinity)
                        if model.showsInspector {
                            Divider()
                            inspector.frame(width: 280)
                        }
                    }
                    .onAppear { model.availableWidth = geometry.size.width }
                    .onChange(of: geometry.size.width) { _, width in model.availableWidth = width }
                }
                Divider()
                HStack(spacing: 8) {
                    Image(systemName: "circle.dotted").foregroundStyle(OtterTheme.accent)
                    Text("设计预览 · 示例数据")
                    Spacer(minLength: 8)
                    Text(model.hint).lineLimit(1).truncationMode(.middle)
                }
                .font(.system(size: 11)).foregroundStyle(.secondary)
                .padding(.horizontal, 18).frame(height: 28)
            }
            .background(OtterTheme.canvas)
        }
        .navigationSplitViewStyle(.balanced)
        .navigationTitle(model.page.title)
        .tint(OtterTheme.accent)
        .preferredColorScheme(model.dark ? .dark : .light)
        .frame(minWidth: 1000, minHeight: 680)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Menu {
                    ForEach(["全部 Agents", "Claude · 用户", "Codex · 用户", "Hermes · default", "Hermes · cherry"], id: \.self) { name in
                        Button {
                            model.context = name
                            model.hint = "示例上下文已切换 · 运行时待验证"
                        } label: {
                            if model.context == name { Label(name, systemImage: "checkmark") }
                            else { Text(name) }
                        }
                    }
                } label: { Label(model.context, systemImage: "folder") }
                    .menuStyle(.borderlessButton).labelStyle(.titleAndIcon)
                    .frame(width: 174, height: 32).fixedSize()
                    .accessibilityLabel("工作区上下文：" + model.context)
                    .background(PreviewAnchor(id: "context", model: model))
            }.otterToolbarControl()
            ToolbarItemGroup(placement: .primaryAction) {
                Button { model.sheet = .search } label: { Image(systemName: "magnifyingglass") }
                    .buttonStyle(OtterButtonStyle(iconOnly: true))
                    .help("搜索所有资源 · ⌘K").accessibilityLabel("搜索所有资源")
                Button { model.hint = "已刷新示例索引 · 没有扫描本机" } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.clockwise")
                        Text("重新扫描")
                    }.frame(width: 98)
                }
                .buttonStyle(OtterButtonStyle(treatment: .accent))
                .help("重新扫描当前工作区")
                Button {
                    if model.availableWidth < 980 { model.compactInspector.toggle() }
                    else { model.inspectorRequested.toggle() }
                } label: { Image(systemName: "sidebar.right") }
                .buttonStyle(OtterButtonStyle(iconOnly: true))
                .accessibilityLabel("显示或隐藏检查器").help("检查器 · ⌥⌘I")
                .background(PreviewAnchor(id: "inspector", model: model))
                .popover(isPresented: $model.compactInspector, arrowEdge: .bottom) {
                    inspector.frame(width: 300, height: 560)
                }
            }.otterToolbarControl()
        }
        .sheet(item: $model.sheet) { sheet in PreviewSheetView(model: model, sheet: sheet) }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                if let image = NSImage(named: "OtterIcon") {
                    Image(nsImage: image).resizable().frame(width: 38, height: 38).accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Otter").font(.system(size: 19, weight: .semibold))
                    Text("本机 Agent 工作台").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 20)
            List(selection: Binding<WorkspacePage?>(get: { model.page }, set: { if let page = $0 { model.page = page } })) {
                Section("工作区") {
                    ForEach(WorkspacePage.allCases.filter { $0 != .settings }) { page in navigationRow(page) }
                }
                Section("应用") { navigationRow(.settings) }
            }
            .listStyle(.sidebar).scrollDisabled(true)
            if model.job == "scanning" {
                Button { model.page = .backups } label: {
                    Label("采集完成 8 / 13", systemImage: "arrow.trianglehead.2.clockwise")
                        .font(.system(size: 11)).padding(12)
                }.buttonStyle(.plain)
            }
            Divider().padding(.horizontal, 18)
            Button { model.page = .workflow } label: {
                HStack(spacing: 9) {
                    Image(systemName: "folder").font(.system(size: 17))
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Workflow").font(.system(size: 12, weight: .medium))
                        Text("~/Developer/workflow").font(.system(size: 10)).foregroundStyle(.secondary)
                            .lineLimit(1).truncationMode(.middle)
                    }
                    Spacer(minLength: 0)
                }.padding(18).contentShape(Rectangle())
            }.buttonStyle(.plain).help("查看来源与绑定")
        }
    }

    private func navigationRow(_ page: WorkspacePage) -> some View {
        HStack(spacing: 10) {
            Image(systemName: page.symbol).frame(width: 18)
            Text(page.title)
            Spacer(minLength: 0)
            if page == .overview { Text("2").font(.system(size: 11)).foregroundStyle(.secondary) }
        }
        .font(.system(size: 13, weight: model.page == page ? .semibold : .regular))
        .padding(.vertical, 7).tag(page)
        .accessibilityIdentifier("navigation." + page.rawValue)
        .background(PreviewAnchor(id: "navigation." + page.rawValue, model: model))
    }

    @ViewBuilder private var workspace: some View {
        switch model.page {
        case .overview: overview
        case .agents: agents
        case .instructions: instructions
        case .skills:
            if model.editorOpen { SkillEditorView(model: model) }
            else { skillLibrary }
        case .workflow: workflow
        case .backups: backups
        case .settings: settings
        }
    }

    private var overview: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                OtterPageHeading(title: "本机概览", subtitle: "2 项需要检查。查看证据，再决定如何处理。")
                OtterCard {
                    HStack(spacing: 0) {
                        metric("7", "Agent 配置", "terminal")
                        Divider().frame(height: 42)
                        metric("4", "示例 Skills", "sparkles")
                        Divider().frame(height: 42)
                        metric("3", "配置来源", "folder")
                    }
                }
                VStack(alignment: .leading, spacing: 12) {
                    sectionTitle("需要检查", trailing: "最近扫描 09:41")
                    OtterCard(padding: 0) {
                        VStack(spacing: 0) {
                            issue("Codex 的指令副本与源不同", detail: "内容差异与加载入口需要分别检查。", status: "内容不同") {
                                model.page = .instructions
                            }
                            Divider()
                            issue("Hermes / cherry 的来源待确认", detail: "同名 skill 内容不同，目前没有同步基线。", status: "关系待确认") {
                                model.bindingSource = "herdr-control"
                                model.page = .workflow
                            }
                        }
                    }
                }
                OtterCard {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "checkmark.circle").font(.system(size: 21)).foregroundStyle(OtterTheme.accent)
                        VStack(alignment: .leading, spacing: 6) {
                            Text("共享目录也是有效入口").font(.system(size: 14, weight: .semibold))
                            Text("专用目录缺少链接时，先检查共享目录的发现结果。")
                                .font(.system(size: 12)).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                }
                VStack(alignment: .leading, spacing: 12) {
                    sectionTitle("最近操作", trailing: "保留来源与影响范围")
                    detailRow("09:41", "文件索引已更新", "运行时发现单独验证")
                    Divider()
                    detailRow("09:32", "本地快照已保存", "尚未上传")
                }
            }.padding(28)
        }
    }

    private func metric(_ value: String, _ title: String, _ symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: symbol).font(.system(size: 11)).foregroundStyle(.secondary)
            Text(value).font(.system(size: 25, weight: .medium)).monospacedDigit()
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 10)
    }

    private func issue(_ title: String, detail: String, status: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "exclamationmark.triangle").font(.system(size: 18)).foregroundStyle(OtterTheme.warning)
                    .frame(width: 32, height: 32).background(OtterTheme.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 7) {
                    Text(title).font(.system(size: 13, weight: .semibold))
                    Text(detail).font(.system(size: 12)).foregroundStyle(.secondary)
                    StatusBadge(title: status, symbol: "exclamationmark.circle", warning: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 10)).foregroundStyle(.tertiary)
            }.padding(18).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    private var skillLibrary: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 20) {
                OtterPageHeading(title: "Skills", subtitle: "按来源管理完整的技能包，保留每一个安装入口。")
                HStack(spacing: 12) {
                    SearchField(title: "搜索技能名称或描述", text: $model.skillSearch)
                        .background(PreviewAnchor(id: "skill-search", model: model))
                    OtterMenu(title: "来源", selection: model.sourceFilter, options:
                        ["所有来源", "Workflow", "Hermes / cherry"].map { name in (name, { model.sourceFilter = name }) })
                        .frame(width: 155)
                }
            }.padding(28)
            Divider()
            if model.visibleSkills.isEmpty {
                ContentUnavailableView {
                    Label("没有匹配的 Skills", systemImage: "magnifyingglass")
                } description: { Text("试试其他名称，或清除筛选条件。") } actions: {
                    Button("清除筛选") { model.skillSearch = ""; model.sourceFilter = "所有来源" }
                        .buttonStyle(OtterButtonStyle()).background(PreviewAnchor(id: "clear-search", model: model))
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Table(model.visibleSkills, selection: $model.selectedSkills) {
                    TableColumn("技能") { skill in
                        VStack(alignment: .leading, spacing: 5) {
                            Label(skill.id, systemImage: "doc.text").font(.system(size: 12, weight: .medium))
                            Text(skill.summary).font(.system(size: 11)).foregroundStyle(.secondary)
                        }.padding(.vertical, 9)
                    }.width(min: 180, ideal: 242)
                    TableColumn("来源", value: \.source).width(min: 85, ideal: 110)
                    TableColumn("关系", value: \.relationship).width(92)
                    TableColumn("运行时", value: \.discovery).width(76)
                }
                .contextMenu(forSelectionType: String.self) { selection in
                    Button("编辑技能包") { model.selectedSkills = selection; model.openPackage() }.disabled(selection.count != 1)
                } primaryAction: { selection in model.selectedSkills = selection; model.openPackage() }
            }
            Divider()
            HStack {
                Text("\(model.visibleSkills.count) 个示例包 · 来源与发现分别检查").font(.system(size: 11)).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Button("编辑技能包", action: model.openPackage)
                    .buttonStyle(OtterButtonStyle(treatment: .accent))
                    .disabled(model.selectedSkills.count != 1 || !model.visibleSkills.contains { model.selectedSkills.contains($0.id) })
                    .background(PreviewAnchor(id: "open-skill", model: model))
            }.padding(18)
        }
        .onAppear { model.selectedSkills.formIntersection(Set(model.visibleSkills.map(\.id))) }
        .onChange(of: model.visibleSkills.map(\.id)) { _, ids in model.selectedSkills.formIntersection(Set(ids)) }
    }

    private var agents: some View {
        VStack(alignment: .leading, spacing: 0) {
            OtterPageHeading(title: "Agents", subtitle: "CLI、配置与发现能力分别记录。上下文：\(model.context)。").padding(28)
            Divider()
            List(selection: $model.selectedAgent) {
                ForEach(["Claude Code", "Codex", "Grok", "Pi", "Hermes", "OpenCode", "Gemini"], id: \.self) { name in
                    HStack(spacing: 14) {
                        Image(systemName: name == "Hermes" ? "person.2" : "terminal").font(.system(size: 18))
                            .frame(width: 36, height: 36).background(OtterTheme.control, in: RoundedRectangle(cornerRadius: 8))
                        VStack(alignment: .leading, spacing: 5) {
                            Text(name).font(.system(size: 13, weight: .semibold))
                            Text(name == "Hermes" ? "default · cherry · 独立配置" : "用户配置 · 项目配置")
                                .font(.system(size: 11)).foregroundStyle(.secondary)
                        }
                        Spacer()
                        StatusBadge(title: ["OpenCode", "Gemini"].contains(name) ? "CLI 未定位" : "已定位", symbol: "terminal")
                    }.padding(.vertical, 8).tag(name)
                }
            }.listStyle(.inset).scrollContentBackground(.hidden)
        }
    }

    private var instructionExample: (String, String, String, String, String) {
        switch model.instructionKind {
        case "Commands": (
            "command-skill 的多个入口", "workflow/agents/command-skills/example-command/SKILL.md",
            "一个正文，多种调用方式",
            "Command 文件与 Skill 包可以引用同一个源；注册方式与参数展开由各个 harness 决定。",
            "# Example command\n\nClaude / Grok / Pi\n  /example-command <task>\n\nCodex\n  $example-command <task>\n\nHermes\n  /example-command <task>\n\n源正文只是示例，不执行这些命令。"
        )
        case "Rules": (
            "规则格式与作用范围", "~/.claude/rules/example.md · ~/.codex/rules/default.rules",
            "Markdown 规则与权限 DSL 分开",
            "作用于文档/路径的 Markdown 规则，与 Codex 的权限规则不是同一种格式，也不能互相拷贝后宣称生效。",
            "# Workspace rules\n\nScope: project documentation\nSource: Workflow / agents / rules\n\nKeep original references and local edits.\n\nPermission rules\n  Separate parser and host-specific semantics."
        )
        case "Hooks": (
            "原生 Hook 注册", "~/.claude/settings.json · ~/.grok/settings.json",
            "脚本存在与 Hook 已注册分别检查",
            "Claude 与 Grok 使用各自的事件字段与参数格式。先核对配置和程序路径，再检查当前版本的注册结果。",
            "Claude\n  PreToolUse → Bash → native hook script\n\nGrok\n  run_terminal_command → native hook script\n\n检查范围\n  事件名称、匹配器、脚本路径与执行权限。\n\n此预览不调用 Hook。"
        )
        default: (
            "instructions.md", "~/.codex/instructions.md",
            "内容有差异，默认入口尚未确认",
            "先比较并选择内容，再检查当前版本支持的 AGENTS 入口。更新副本本身不能证明新会话已经加载。",
            "# Agent instructions\n\n## Working with the user\n\nKeep changes reviewable.\nPreserve existing configuration and local drafts.\n\n## Sources\n\nWorkflow owns shared instructions.\nCopies keep an explicit synchronization baseline."
        )
        }
    }

    private var instructions: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 18) {
                OtterPageHeading(title: "指令与命令", subtitle: "文件内容、来源关系和加载入口各自可见。")
                Picker("配置类型", selection: $model.instructionKind) {
                    ForEach(["指令", "Commands", "Rules", "Hooks"], id: \.self) { Text($0) }
                }.pickerStyle(.segmented).labelsHidden().fixedSize()
            }.padding(28)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack {
                        Label(instructionExample.0, systemImage: "doc.text")
                            .font(.system(size: 20, weight: .semibold))
                        Spacer()
                        StatusBadge(title: "关系与加载分开", symbol: "link")
                    }
                    PathLabel(path: instructionExample.1)
                    OtterCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(instructionExample.2).font(.system(size: 14, weight: .semibold))
                            Text(instructionExample.3)
                                .font(.system(size: 13)).foregroundStyle(.secondary).lineSpacing(4)
                        }
                    }
                    Text(instructionExample.4)
                        .font(.system(size: 13, design: .monospaced)).lineSpacing(8).textSelection(.enabled)
                }.padding(28)
            }
            Divider()
            HStack {
                Text("示例内容 · 尚未修改任何入口").font(.system(size: 11)).foregroundStyle(.secondary)
                Spacer()
                if model.instructionKind == "指令" {
                    Button("查看变更预览…") { model.sheet = .change }
                        .buttonStyle(OtterButtonStyle(treatment: .accent))
                }
            }.padding(18)
        }
    }

    private var workflow: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                OtterPageHeading(title: "来源与绑定", subtitle: "选中一份源，解释它如何到达各个 Agent。")
                Picker("查看来源关系", selection: $model.bindingSource) {
                    Text("AGENTS.md").tag("AGENTS.md")
                    Text("herdr-control").tag("herdr-control")
                }.pickerStyle(.segmented).labelsHidden().fixedSize()
                if model.bindingSource == "herdr-control" {
                    OtterCard {
                        VStack(alignment: .leading, spacing: 16) {
                            Label("Hermes / cherry · herdr-control", systemImage: "doc.on.doc").font(.system(size: 16, weight: .semibold))
                            StatusBadge(title: "关系待确认 · 没有同步基线", symbol: "questionmark.circle", warning: true)
                            PathLabel(path: "~/.hermes/profiles/cherry/skills/herdr-control")
                            Divider()
                            MetaRow(title: "同名来源", value: "Workflow / hermes / skills / herdr-control")
                            Text("两个当前版本内容不同。可先比较并保留本地包，不能据此认定为过期分叉。")
                                .font(.system(size: 13)).foregroundStyle(.secondary).lineSpacing(4)
                            Button("打开本地示例包") { model.selectedSkills = ["herdr-control"]; model.openPackage() }
                                .buttonStyle(OtterButtonStyle())
                        }
                    }
                } else {
                OtterCard {
                    VStack(alignment: .leading, spacing: 14) {
                        Label("Workflow / agents / AGENTS.md", systemImage: "folder").font(.system(size: 15, weight: .semibold))
                        PathLabel(path: "~/Developer/workflow/agents/AGENTS.md")
                        HStack {
                            StatusBadge(title: "共享源", symbol: "link")
                            Text("3 个实时入口 · 1 个副本示例").font(.system(size: 12)).foregroundStyle(.secondary)
                        }
                    }
                }
                sectionTitle("从源到使用方", trailing: "箭头方向：源 → 入口 → Agent")
                ForEach([("~/.claude/CLAUDE.md", "Claude", "实时共享"),
                         ("~/.config/opencode/AGENTS.md", "OpenCode", "实时共享"),
                         ("~/.gemini/GEMINI.md", "Gemini", "实时共享"),
                         ("~/.codex/instructions.md", "Codex", "副本待审阅")], id: \.0) { path, consumer, relation in
                    HStack(spacing: 12) {
                        Image(systemName: relation == "实时共享" ? "arrow.turn.down.right" : "arrow.right.dashed")
                            .foregroundStyle(OtterTheme.accent).frame(width: 24)
                        VStack(alignment: .leading, spacing: 7) {
                            PathLabel(path: path)
                            StatusBadge(title: relation, symbol: relation == "实时共享" ? "link" : "doc.on.doc", warning: relation != "实时共享")
                        }
                        Spacer(minLength: 4)
                        Image(systemName: "arrow.right").foregroundStyle(.tertiary)
                        Text(consumer).font(.system(size: 13, weight: .medium)).frame(width: 78, alignment: .leading)
                    }.padding(16).background(OtterTheme.surface, in: RoundedRectangle(cornerRadius: 10))
                }
                Text("同名、同内容的独立安装仍保留独立身份；没有来源记录时，不自动认领同步关系。")
                    .font(.system(size: 12)).foregroundStyle(.secondary).lineSpacing(4)
                }
            }.padding(28)
        }
    }

    private var backups: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                OtterPageHeading(title: "备份与任务", subtitle: "先查看采集范围，再上传已确认的快照。")
                OtterCard {
                    VStack(alignment: .leading, spacing: 20) {
                        HStack(spacing: 12) {
                            Image(systemName: "externaldrive").font(.system(size: 25)).foregroundStyle(OtterTheme.accent)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(model.job == "scanning" ? "正在采集本机配置" : model.job == "cancelled" ? "采集已取消" : model.job == "done" ? "示例上传完成" : "本机环境快照")
                                    .font(.system(size: 18, weight: .semibold))
                                Text("通过 Otter CLI · 当前配置与目标地址分开核对")
                                    .font(.system(size: 12)).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                        }
                        if model.job == "scanning" {
                            ProgressView(value: 8, total: 13).tint(OtterTheme.accent)
                            HStack {
                                Text("已收到 8 / 13 个采集器结果").font(.system(size: 12))
                                Spacer()
                                Button("取消") { model.job = "cancelled"; model.hint = "示例采集已取消 · 保留已完成结果" }
                                    .buttonStyle(OtterButtonStyle()).background(PreviewAnchor(id: "cancel-job", model: model))
                            }
                        } else {
                            HStack {
                                StatusBadge(title: model.job == "cancelled" ? "部分结果保留" : "本地可用", symbol: "internaldrive")
                                Spacer()
                                Button("扫描并预览…") { model.job = "scanning" }
                                    .buttonStyle(OtterButtonStyle(treatment: .accent))
                            }
                        }
                    }
                }
                VStack(alignment: .leading, spacing: 12) {
                    sectionTitle("最近快照", trailing: "本地保存与云端上传分别记录")
                    OtterCard(padding: 0) {
                        VStack(spacing: 0) {
                            snapshotRow("今天 09:32", id: "demo-20260915-0932", detail: "13 个采集器 · 2 项缺失已标注", state: "仅本地")
                            Divider()
                            snapshotRow("昨天 18:20", id: "demo-20260914-1820", detail: "13 个采集器 · 已上传到示例服务器", state: "已上传")
                        }
                    }
                }
                OtterSection(title: "覆盖范围") {
                    VStack(spacing: 14) {
                        detailRow("清单", "应用、Homebrew、字体与工具链", "用于核对已安装环境")
                        Divider()
                        detailRow("正文", "已纳入采集范围的配置文件", "新发现的 Skills 不自动扩大云端备份范围")
                    }
                }
            }.padding(28)
        }
    }

    private func snapshotRow(_ title: String, id: String, detail: String, state: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "archivebox").font(.system(size: 18)).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.system(size: 13, weight: .semibold))
                Text(detail).font(.system(size: 11)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            Text(state).font(.system(size: 11)).foregroundStyle(.secondary)
            Button("查看…") { model.snapshotID = id; model.sheet = .upload }.buttonStyle(OtterButtonStyle())
                .background(PreviewAnchor(id: "snapshot." + id, model: model))
        }.padding(18)
    }

    private var settings: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                OtterPageHeading(title: "设置", subtitle: "管理工作区来源、编辑偏好与命令行入口。")
                Picker("设置分区", selection: $model.settingsTab) {
                    ForEach(["通用", "来源与扫描", "编辑器", "CLI 与备份"], id: \.self) { Text($0) }
                }.pickerStyle(.segmented).labelsHidden().fixedSize()
                if model.settingsTab == "通用" {
                    OtterSection(title: "外观") {
                        HStack {
                            Label("窗口外观", systemImage: "circle.lefthalf.filled")
                            Spacer()
                            Picker("窗口外观", selection: $model.dark) {
                                Text("浅色").tag(false)
                                Text("深色").tag(true)
                            }.pickerStyle(.segmented).frame(width: 180).labelsHidden()
                        }.font(.system(size: 13))
                    }
                    OtterSection(title: "工作区") {
                        VStack(alignment: .leading, spacing: 16) {
                            HStack {
                                Text("文件变化时更新索引")
                                Spacer()
                                Toggle("文件变化时更新索引", isOn: $model.watchChanges).labelsHidden().toggleStyle(.switch)
                            }
                            Divider()
                            HStack {
                                Text("保留未保存的本地草稿")
                                Spacer()
                                Toggle("保留未保存的本地草稿", isOn: $model.draftAutosave).labelsHidden().toggleStyle(.switch)
                            }
                            Text("草稿保留与写入源文件是两个动作。保存源文件会显示受影响的入口。")
                                .font(.system(size: 12)).foregroundStyle(.secondary)
                        }.font(.system(size: 13))
                    }
                } else if model.settingsTab == "来源与扫描" {
                    OtterSection(title: "已登记来源") {
                        VStack(alignment: .leading, spacing: 14) {
                            Label("Workflow", systemImage: "folder").font(.system(size: 14, weight: .semibold))
                            PathLabel(path: "~/Developer/workflow")
                            Text("按已登记入口扫描；来源目录可以移动，绑定需要重新验证。")
                                .font(.system(size: 12)).foregroundStyle(.secondary)
                        }
                    }
                } else if model.settingsTab == "编辑器" {
                    OtterSection(title: "文本编辑") {
                        VStack(spacing: 16) {
                            Stepper("编辑字号：\(model.editorFontSize) pt", value: $model.editorFontSize, in: 11...22)
                            Divider()
                            Toggle("保留未保存的本地草稿", isOn: $model.draftAutosave).toggleStyle(.switch)
                        }.font(.system(size: 13))
                    }
                } else {
                    OtterSection(title: "命令行工具") {
                        VStack(alignment: .leading, spacing: 16) {
                            detailRow("执行方式", "随 App 提供的兼容 CLI", "原生产品的分发目标；预览不执行 CLI")
                            Divider()
                            PathLabel(path: "~/Library/Application Support/Otter/bin/otter")
                            Text("稳定入口由用户显式安装或更新；已有全局命令保持独立。")
                                .font(.system(size: 12)).foregroundStyle(.secondary)
                        }
                    }
                    OtterSection(title: "上传目标") {
                        detailRow("示例服务器", "https://backup.example.invalid", "实际 API host 与配置文件共同显示")
                    }
                }
            }.frame(maxWidth: 760, alignment: .leading).padding(28)
                .frame(maxWidth: .infinity, alignment: .topLeading)
        }
    }

    private var inspector: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text(model.page == .skills ? "技能检查器" : "检查器").font(.system(size: 14, weight: .semibold))
                    Spacer()
                    Image(systemName: "info.circle").foregroundStyle(.secondary)
                }.padding(.vertical, 5)
                if model.page == .skills {
                    skillInspector
                } else if model.page == .backups {
                    OtterInspectorSection(title: "执行与目标", symbol: "terminal") {
                        MetaRow(title: "执行工具", value: "Otter CLI · 示例")
                        MetaRow(title: "当前阶段", value: model.job == "scanning" ? "采集本地数据" : "查看快照")
                        MetaRow(title: "上传目标", value: "backup.example.invalid")
                    }
                    OtterInspectorSection(title: "上传前检查", symbol: "checklist") {
                        Text("查看实际采集内容、缺失项和遮盖结果，再上传这个固定快照。")
                            .font(.system(size: 12)).foregroundStyle(.secondary).lineSpacing(4)
                    }
                } else if model.page == .agents {
                    OtterInspectorSection(title: model.selectedAgent ?? "Agent", symbol: "terminal") {
                        MetaRow(title: "配置上下文", value: model.context)
                        MetaRow(title: "发现状态", value: "待验证 · 示例安装")
                        MetaRow(title: "配置入口", value: "指令、Skills、Commands、Hooks")
                        Button("查看指令与命令") { model.page = .instructions }
                            .buttonStyle(OtterButtonStyle())
                    }
                } else if model.page == .workflow && model.bindingSource == "herdr-control" {
                    OtterInspectorSection(title: "独立 Profile", symbol: "person.crop.circle") {
                        MetaRow(title: "文件关系", value: "实体包 · 来源待确认")
                        MetaRow(title: "消费者", value: "Hermes / cherry")
                        MetaRow(title: "同步基线", value: "无 · 只可比较当前版本")
                        Text("Profile 的身份、记忆与技能可以有独立预期。")
                            .font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                } else if model.page == .instructions && model.instructionKind != "指令" {
                    OtterInspectorSection(title: model.instructionKind, symbol: "text.badge.checkmark") {
                        MetaRow(title: "入口类型", value: instructionExample.0)
                        MetaRow(title: "观察范围", value: "配置文件与静态路径")
                        MetaRow(title: "运行时发现", value: "需要针对版本单独验证")
                        PathLabel(path: instructionExample.1)
                    }
                } else {
                    OtterInspectorSection(title: "Codex 指令", symbol: "doc.text") {
                        StatusBadge(title: "内容不同", symbol: "doc.on.doc", warning: true)
                        MetaRow(title: "文件关系", value: "独立副本 · 需要确认基线")
                        MetaRow(title: "运行时发现", value: "默认入口待确认")
                        MetaRow(title: "观测范围", value: "用户配置 · 示例上下文")
                    }
                    OtterInspectorSection(title: "来源与目标", symbol: "point.topleft.down.curvedto.point.bottomright.up") {
                        Text("Workflow 源").font(.system(size: 11)).foregroundStyle(.secondary)
                        PathLabel(path: "workflow/agents/AGENTS.md")
                        Divider()
                        Text("本机副本").font(.system(size: 11)).foregroundStyle(.secondary)
                        PathLabel(path: "~/.codex/instructions.md")
                    }
                    OtterInspectorSection(title: "建议下一步", symbol: "arrow.right.circle") {
                        Text("比较正文，再为当前版本检查正确的加载入口。两个动作分别审阅。")
                            .font(.system(size: 12)).foregroundStyle(.secondary).lineSpacing(4)
                        Button("查看变更预览…") { model.sheet = .change }
                            .buttonStyle(OtterButtonStyle(treatment: .accent))
                    }
                }
            }.padding(16)
        }.background(OtterTheme.canvas)
    }

    @ViewBuilder private var skillInspector: some View {
        if !model.editorOpen {
            if model.selectedSkills.count == 1, let skill = ExampleSkill.all.first(where: { model.selectedSkills.contains($0.id) }) {
                OtterInspectorSection(title: "选中技能包", symbol: "shippingbox") {
                    MetaRow(title: "名称", value: skill.id)
                    MetaRow(title: "来源", value: skill.source)
                    MetaRow(title: "文件关系", value: skill.relationship)
                    MetaRow(title: "发现结果", value: skill.discovery)
                    Button("编辑技能包", action: model.openPackage).buttonStyle(OtterButtonStyle())
                }
            } else {
                OtterInspectorSection(title: "技能选择", symbol: "square.stack") {
                    Text("已选中 \(model.selectedSkills.count) 个包").font(.system(size: 13))
                    Text("选择一个包查看详情；批量操作需逐项检查支持的目标。")
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                }
            }
        } else {
        Picker("技能检查器分区", selection: $model.inspectorTab) {
            Text("元数据").tag("元数据")
            Text("使用方").tag("使用方")
        }.pickerStyle(.segmented).labelsHidden()
        if model.inspectorTab == "元数据" {
            OtterInspectorSection(title: "技能信息", symbol: "doc.badge.gearshape") {
                MetaRow(title: "名称", value: model.packageID)
                VStack(alignment: .leading, spacing: 7) {
                    Text("Description").font(.system(size: 11)).foregroundStyle(.secondary)
                    TextField("说明何时使用这个 Skill", text: Binding(get: { model.descriptionText }, set: { model.descriptionText = $0 }), axis: .vertical)
                        .textFieldStyle(.plain).font(.system(size: 12)).lineLimit(3...6)
                        .padding(10).background(OtterTheme.control, in: RoundedRectangle(cornerRadius: 8))
                        .accessibilityLabel("Skill description")
                }
                MetaRow(title: "License", value: "MIT")
            }
            OtterInspectorSection(title: "格式与兼容", symbol: "checkmark.shield") {
                StatusBadge(title: model.hasProblem ? "Description 必填" : "示例说明已补齐", symbol: model.hasProblem ? "exclamationmark.triangle" : "checkmark.circle", warning: model.hasProblem)
                Text("格式通过与 Agent 实际发现分别检查。")
                    .font(.system(size: 12)).foregroundStyle(.secondary).lineSpacing(3)
                MetaRow(title: model.consumers.joined(separator: " / "), value: "运行时发现待验证")
            }
        } else {
            OtterInspectorSection(title: "保存的影响", symbol: "link") {
                ForEach(model.consumers, id: \.self) { consumer in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(consumer).font(.system(size: 12, weight: .medium))
                        StatusBadge(title: model.packageRelationship, symbol: model.shared ? "link" : "doc.on.doc")
                    }
                }
                Text(model.shared ? "示例绑定：保存源文件后共享内容立即变化；运行中的旧会话是否重载需另行确认。" : "当前包独立保存；来源和同步关系需要额外证据。")
                    .font(.system(size: 12)).foregroundStyle(.secondary).lineSpacing(4)
            }
        }
        OtterInspectorSection(title: "保存位置", symbol: "folder") {
            PathLabel(path: model.sourcePath)
            StatusBadge(title: model.sourceTitle, symbol: model.shared ? "link" : "doc.on.doc")
        }
        }
    }
}

struct SkillEditorView: View {
    @Bindable var model: PreviewWorkspace

    var body: some View {
        HStack(spacing: 0) {
            fileNavigator.frame(width: 200)
            Divider()
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 9) {
                    HStack {
                        Text(model.packageID).font(.system(size: 20, weight: .semibold)).lineLimit(1)
                        Spacer(minLength: 0)
                        StatusBadge(title: model.packageRelationship, symbol: model.shared ? "link" : "doc.on.doc")
                    }
                    PathLabel(path: model.sourcePath)
                }.padding(22).frame(maxWidth: .infinity, alignment: .leading)
                Divider()
                HStack(spacing: 0) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 0) {
                            ForEach(model.openFiles, id: \.self) { file in
                                Button { model.file = file } label: {
                                    HStack(spacing: 6) {
                                        Image(systemName: "doc.text").font(.system(size: 11))
                                        Text(file.components(separatedBy: "/").last!).font(.system(size: 12))
                                        if file == model.file && model.isDirty {
                                            Circle().frame(width: 5, height: 5).accessibilityLabel("未保存")
                                        }
                                    }.padding(.horizontal, 14).frame(height: 38)
                                        .background(model.file == file ? OtterTheme.surface : .clear)
                                        .overlay(alignment: .bottom) {
                                            if model.file == file { Rectangle().fill(OtterTheme.accent).frame(height: 2) }
                                        }
                                }.buttonStyle(.plain).accessibilityAddTraits(model.file == file ? .isSelected : [])
                            }
                        }
                    }
                    Picker("文档显示方式", selection: $model.editorMode) {
                        Text("源码").tag("源码")
                        Text("阅读").tag("阅读")
                    }.pickerStyle(.segmented).labelsHidden().frame(width: 118).padding(.horizontal, 10)
                        .background(PreviewAnchor(id: "editor-mode", model: model))
                }
                Divider()
                if model.hasConflict {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.arrow.trianglehead.2.clockwise.rotate.90")
                        Text("磁盘内容已变化。你的草稿仍被保留。").font(.system(size: 12))
                        Spacer(minLength: 0)
                        Button("比较…") { model.sheet = .conflict }.buttonStyle(OtterButtonStyle())
                    }.foregroundStyle(OtterTheme.warning).padding(12).background(OtterTheme.warning.opacity(0.08))
                }
                if model.editorMode == "源码" {
                    NativeEditor(model: model).id(model.activeKey).frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 18) {
                            Text(model.packageID).font(.system(size: 26, weight: .semibold))
                            Text(model.file.hasSuffix(".md") ? model.activeText.components(separatedBy: "---\n").last ?? model.activeText : model.activeText)
                                .font(.system(size: 14)).lineSpacing(6).textSelection(.enabled)
                        }.padding(26).frame(maxWidth: .infinity, alignment: .leading)
                    }.frame(maxHeight: .infinity).background(OtterTheme.surface)
                }
                Divider()
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label(model.hasProblem ? "问题  1" : "示例检查", systemImage: "exclamationmark.bubble")
                            .font(.system(size: 11, weight: .semibold))
                        Spacer()
                        Text("仅检查 description").font(.system(size: 10)).foregroundStyle(.secondary)
                    }
                    HStack(spacing: 8) {
                        Image(systemName: model.hasProblem ? "exclamationmark.triangle.fill" : "checkmark.circle")
                            .foregroundStyle(model.hasProblem ? OtterTheme.warning : OtterTheme.accent)
                        Text(model.hasProblem ? "description 不能为空" : "示例说明已补齐").font(.system(size: 12))
                        Spacer(minLength: 4)
                        Text("SKILL.md:3").font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
                        if model.hasProblem {
                            Button("预览修复…") { model.sheet = .fix }
                                .buttonStyle(OtterButtonStyle()).background(PreviewAnchor(id: "fix", model: model))
                        }
                    }
                }.padding(16)
                Divider()
                HStack(spacing: 10) {
                    Image(systemName: "link").foregroundStyle(OtterTheme.accent)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("写入 " + model.sourceTitle).font(.system(size: 11, weight: .medium))
                        Text((model.shared ? "\(model.consumers.count) 个入口共享" : "当前副本独立保存") + " · UTF-8 · LF")
                            .font(.system(size: 10)).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    Button("保存示例", action: model.saveExample).keyboardShortcut("s")
                        .buttonStyle(OtterButtonStyle(treatment: .accent)).disabled(model.hasProblem || model.hasConflict)
                        .help(model.hasConflict ? "先处理外部冲突" : model.hasProblem ? "先补齐示例必填项，草稿已保留" : "仅保存到预览内存 · ⌘S")
                        .background(PreviewAnchor(id: "save", model: model))
                }.padding(16)
            }.frame(minWidth: 480)
        }
    }

    private var fileNavigator: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { model.editorOpen = false } label: { Label("返回 Skills", systemImage: "chevron.left") }
                .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(.secondary).padding(18)
            Divider()
            List(selection: Binding<String?>(get: { model.file }, set: { if let file = $0 { model.openFile(file) } })) {
                fileRow("SKILL.md")
                Section("references") { fileRow("references/conventions.md") }
                Section("scripts") { fileRow("scripts/check-links.sh") }
                Section("agents") { fileRow("agents/openai.yaml") }
            }.listStyle(.sidebar).scrollContentBackground(.hidden)
            VStack(alignment: .leading, spacing: 8) {
                Label("完整技能包", systemImage: "shippingbox").font(.system(size: 12, weight: .medium))
                Text("4 个文件 · " + model.packageRelationship).font(.system(size: 11)).foregroundStyle(.secondary)
                Button("预览分发…") { model.sheet = .distribute }
                    .buttonStyle(OtterButtonStyle()).disabled(model.hasProblem)
            }.padding(18)
        }.background(OtterTheme.surface.opacity(0.45))
    }

    private func fileRow(_ path: String) -> some View {
        Label(path.components(separatedBy: "/").last!, systemImage: path.hasSuffix(".sh") ? "terminal" : "doc.text")
            .font(.system(size: 11)).padding(.vertical, 4).tag(path)
            .background(PreviewAnchor(id: "file." + path, model: model))
    }
}

struct StatusBadge: View {
    let title: String
    let symbol: String
    var warning = false
    var body: some View {
        Label(title, systemImage: symbol).font(.system(size: 10, weight: .medium))
            .foregroundStyle(warning ? OtterTheme.warning : OtterTheme.accent)
            .padding(.horizontal, 7).padding(.vertical, 4)
            .background((warning ? OtterTheme.warning : OtterTheme.accent).opacity(0.09), in: RoundedRectangle(cornerRadius: 5))
            .accessibilityElement(children: .combine)
    }
}

struct MetaRow: View {
    let title: String
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 11)).foregroundStyle(.secondary)
            Text(value).font(.system(size: 12)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct PathLabel: View {
    let path: String
    var body: some View {
        Text(path).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
            .lineLimit(2).truncationMode(.middle).textSelection(.enabled).help(path)
            .accessibilityLabel(path)
    }
}

struct SearchField: View {
    let title: String
    @Binding var text: String
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField(title, text: $text).textFieldStyle(.plain).accessibilityLabel(title)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                    .buttonStyle(.plain).accessibilityLabel("清除搜索")
            }
        }.font(.system(size: 12)).padding(.horizontal, 11).frame(height: 32)
            .background(OtterTheme.surface, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(OtterTheme.separator))
    }
}

private func sectionTitle(_ title: String, trailing: String) -> some View {
    HStack {
        Text(title).font(.system(size: 14, weight: .semibold))
        Spacer(minLength: 4)
        Text(trailing).font(.system(size: 11)).foregroundStyle(.secondary)
    }
}

private func detailRow(_ label: String, _ title: String, _ subtitle: String) -> some View {
    HStack(alignment: .top, spacing: 16) {
        Text(label).font(.system(size: 11)).foregroundStyle(.secondary).frame(width: 54, alignment: .leading)
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 13, weight: .medium))
            Text(subtitle).font(.system(size: 11)).foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
    }
}
