import AppKit
import OtterCore
import SwiftUI

struct WorkspaceView: View {
    @Bindable var store: WorkspaceStore
    var body: some View {
        NavigationSplitView {
            sidebar.navigationSplitViewColumnWidth(min: 188, ideal: 212, max: 260)
        } detail: {
            VStack(spacing: 0) {
                if let error = store.error {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "exclamationmark.triangle").foregroundStyle(OtterTheme.warning)
                        Text(error).font(OtterTypography.caption).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                        Button { store.error = nil } label: { Image(systemName: "xmark") }.buttonStyle(.plain).accessibilityLabel("关闭提示")
                    }.padding(12).background(OtterTheme.warning.opacity(0.1))
                    Divider()
                }
                HStack(spacing: 0) {
                    workspace.frame(maxWidth: .infinity, maxHeight: .infinity)
                    if store.showsInspector {
                        Divider()
                        WorkspaceInspector(store: store).frame(width: 280)
                    }
                }
                Divider()
                HStack(spacing: 8) {
                    if store.scanning { ProgressView().controlSize(.small) }
                    else { Image(systemName: "circle.fill").font(.system(size: 6)).foregroundStyle(OtterTheme.accent) }
                    Text(store.status).lineLimit(1)
                    Spacer()
                    if store.activeDocument?.isDirty == true { Text(store.activeDocument?.savedDraft == true ? "草稿已保留 · 尚未写入源" : "正在保留草稿…") }
                    else { Text("本机工作区") }
                }.font(OtterTypography.detail).foregroundStyle(.secondary).padding(.horizontal, OtterTheme.pageInset).frame(height: 28)
            }
            .background(OtterTheme.canvas)
            .background(GeometryReader { geometry in Color.clear.onAppear { store.availableWidth = geometry.size.width }.onChange(of: geometry.size.width) { _, width in store.availableWidth = width } })
        }
        .navigationSplitViewStyle(.balanced)
        .font(OtterTypography.body)
        .tint(OtterTheme.accent)
        .preferredColorScheme(store.configuration.appearance == "dark" ? .dark : store.configuration.appearance == "light" ? .light : nil)
        .frame(minWidth: 1000, minHeight: 680)
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Menu {
                    Button("全部 Agents") { store.selectedHarness = nil }
                    ForEach(Harness.allCases) { harness in Button(harness.title) { store.selectedHarness = harness } }
                    Divider()
                    Button("所有项目上下文") { store.configuration.selectedProject = nil; store.saveConfiguration() }
                    ForEach(store.configuration.projects, id: \.self) { project in
                        Button((project as NSString).lastPathComponent) { store.configuration.selectedProject = project; store.saveConfiguration() }
                    }
                    Button("添加项目…") { store.selectSource(project: true) }
                } label: { Label(store.selectedHarness?.title ?? "全部 Agents", systemImage: "terminal") }
                .menuStyle(.borderlessButton).labelStyle(.titleAndIcon).font(OtterTypography.label)
                .padding(.horizontal, 12).frame(width: 178, height: OtterTheme.controlHeight)
                .background(OtterTheme.control, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(OtterTheme.separator, lineWidth: 1))
                .fixedSize()
                .accessibilityLabel("工作区上下文").nativeAnchor("context", store: store)
            }.otterToolbarControl()
            ToolbarItem(placement: .principal) { Spacer(minLength: 0) }.otterToolbarControl()
            ToolbarItemGroup(placement: .primaryAction) {
                Button { store.sheet = .search } label: { Image(systemName: "magnifyingglass") }
                    .buttonStyle(OtterButtonStyle(iconOnly: true)).help("搜索所有资源 · ⌘K").accessibilityLabel("搜索所有资源")
                    .nativeAnchor("search", store: store)
                Button { store.scanning ? store.cancelScan() : store.rescan() } label: {
                    HStack(spacing: 8) { Image(systemName: store.scanning ? "stop" : "arrow.clockwise"); Text(store.scanning ? "停止扫描" : "重新扫描") }.frame(width: 98)
                }.buttonStyle(OtterButtonStyle(treatment: .accent)).nativeAnchor("scan", store: store)
            }.otterToolbarControl()
        }
        .sheet(item: $store.sheet) { sheet in WorkspaceSheetView(store: store, sheet: sheet) }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 11) {
                Image(nsImage: NSImage(named: "OtterIcon") ?? NSImage()).resizable().frame(width: 38, height: 38).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Otter").font(.system(size: 19, weight: .semibold))
                    Text("本机 Agent 工作台").font(OtterTypography.caption).foregroundStyle(.secondary)
                }; Spacer(minLength: 0)
            }.nativeAnchor("sidebar-brand", store: store)
                .padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 12)
            List(selection: Binding<WorkspacePage?>(get: { store.page }, set: { if let page = $0 { store.page = page } })) {
                Section { ForEach(WorkspacePage.allCases.filter { $0 != .settings }) { navigation($0) } } header: {
                    Text("工作区").font(OtterTypography.captionLabel)
                }
                Section { navigation(.settings) } header: {
                    Text("应用").font(OtterTypography.captionLabel)
                }
            }.listStyle(.sidebar)
            if let job = store.jobs.first(where: \.isRunning) {
                Button { store.page = .backups } label: {
                    HStack(spacing: 8) { ProgressView().controlSize(.small); Text(job.title).font(OtterTypography.caption) }.padding(12)
                }.buttonStyle(.plain)
            }
            Divider().padding(.horizontal, 18)
            Button { store.page = .workflow } label: {
                HStack(spacing: 9) {
                    Image(systemName: "folder").font(.system(size: 17))
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(store.configuration.sources.count) 个来源").font(OtterTypography.label)
                        Text(store.configuration.sources.first.map(store.shortPath) ?? "添加 Workflow 来源")
                            .font(OtterTypography.detail).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                    }; Spacer(minLength: 0)
                }.padding(18).contentShape(Rectangle())
            }.buttonStyle(.plain)
        }.nativeAnchor("sidebar", store: store)
    }
    private func navigation(_ page: WorkspacePage) -> some View {
        HStack(spacing: 10) {
            Image(systemName: page.symbol).frame(width: 18)
            Text(page.title).lineLimit(1).nativeAnchor("navigation-label." + page.rawValue, store: store)
            Spacer(minLength: 0)
            if page == .overview && !store.index.problems.isEmpty {
                Text("\(store.index.problems.filter { $0.severity != .information }.count)").font(OtterTypography.caption).foregroundStyle(.secondary)
            }
        }.font(OtterTypography.body).frame(height: 30)
            .tag(page).accessibilityIdentifier("navigation." + page.rawValue).nativeAnchor("navigation." + page.rawValue, store: store)
    }
    @ViewBuilder private var workspace: some View {
        switch store.page {
        case .overview: overview
        case .agents: agents
        case .instructions, .skills:
            if store.editorIsOpen { SkillEditorView(store: store) } else { library }
        case .workflow: workflow
        case .backups: BackupView(store: store)
        case .settings: WorkspaceSettingsView(store: store)
        }
    }
    private var overview: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                OtterPageHeading(title: "本机概览", subtitle: store.scanning ? "正在扫描已知入口，已有内容可以继续浏览。" : "查看来源、使用方与问题证据，维护自己的 Agent 环境。")
                    .nativeAnchor("page-heading", store: store)
                OtterCard {
                    HStack(spacing: 16) {
                        metric("\(store.index.harnesses.filter { $0.executable != nil || !$0.configPaths.isEmpty }.count)", "Agent 配置", "terminal")
                        Divider().frame(height: 42)
                        metric("\(store.index.skills.count)", "Skill 安装入口", "sparkles")
                        Divider().frame(height: 42)
                        metric("\(store.configuration.sources.count)", "配置来源", "folder")
                    }
                }
                OtterSection(title: "需要检查", subtitle: "问题来自当前磁盘证据；运行时发现单独验证。") {
                    if store.index.problems.isEmpty {
                        Label(store.scanning ? "正在检查…" : "已扫描入口没有确定的格式或链接错误", systemImage: "checkmark.circle").foregroundStyle(OtterTheme.accent)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(store.index.problems.filter { $0.severity != .information }.prefix(12))) { problem in
                                Button {
                                    if let entry = store.index.entries.first(where: { $0.path == problem.path || FileSystem.isWithin(problem.path, $0.path) }) { store.open(entry) }
                                    else { store.page = .workflow }
                                } label: { ProblemRow(problem: problem, shortPath: store.shortPath(problem.path)) }.buttonStyle(.plain)
                                if problem.id != store.index.problems.last?.id { Divider().padding(.vertical, 10) }
                            }
                        }
                    }
                }
                OtterCard {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "link").font(.system(size: 18)).frame(width: 22).foregroundStyle(OtterTheme.accent)
                        VStack(alignment: .leading, spacing: 6) {
                            Text("来源关系与运行时发现分别呈现").font(OtterTypography.sectionTitle)
                            Text("共享目录也是有效入口。同名或同文的副本不会自动被认领为 Workflow 的同步副本。")
                                .font(OtterTypography.caption).foregroundStyle(.secondary)
                        }; Spacer(minLength: 0)
                    }
                }
                if !store.history.isEmpty {
                    OtterSection(title: "最近变更") {
                        ForEach(Array(store.history.prefix(3))) { receipt in
                            HStack { Text(receipt.changeSet.title); Spacer(); Text(receipt.undone ? "已撤销" : "已应用").foregroundStyle(.secondary) }.font(OtterTypography.caption)
                        }
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(OtterTheme.pageInset)
        }
    }
    private func metric(_ value: String, _ title: String, _ symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: symbol).font(OtterTypography.caption).foregroundStyle(.secondary)
            Text(value).font(.system(size: 23, weight: .medium)).monospacedDigit()
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private var agents: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                OtterPageHeading(title: "Agents", subtitle: "已知配置、可执行程序与使用上下文。未定位 CLI 的配置仍可浏览和编辑。")
                    .nativeAnchor("page-heading", store: store)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 235), spacing: 16)], spacing: 16) {
                    ForEach(store.index.harnesses) { agent in
                        OtterCard {
                            VStack(alignment: .leading, spacing: 12) {
                                HStack(spacing: 8) {
                                    Image(systemName: "terminal").font(.system(size: 18)).frame(width: 22).foregroundStyle(OtterTheme.accent)
                                    Text(agent.id.title).font(OtterTypography.sectionTitle); Spacer()
                                }
                                StatusBadge(title: agent.executable == nil ? "CLI 未定位" : agent.version ?? "CLI 已定位", symbol: "terminal", warning: agent.executable == nil)
                                Text("\(agent.resourceCount) 个配置 / Skill 入口").font(OtterTypography.body)
                                Text(agent.executable.map(store.shortPath) ?? "可在设置中检查搜索路径")
                                    .font(OtterTypography.caption).foregroundStyle(.secondary).lineLimit(2, reservesSpace: true).truncationMode(.middle)
                                HStack(spacing: 8) {
                                    Button("查看配置") { store.selectedHarness = agent.id; store.closeEditor(); store.page = .instructions }
                                        .buttonStyle(OtterButtonStyle())
                                    Button("查看 Skills") { store.selectedHarness = agent.id; store.closeEditor(); store.page = .skills }
                                        .buttonStyle(OtterButtonStyle())
                                }
                                Button("验证新进程发现") { store.verifyRuntime(agent) }.buttonStyle(OtterButtonStyle(treatment: .plain)).font(OtterTypography.caption)
                                    .disabled(agent.executable == nil || store.isolated)
                            }
                        }
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(OtterTheme.pageInset)
        }
    }
    private var library: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                OtterPageHeading(title: store.page.title, subtitle: store.page == .skills ? "完整技能包，保留每个安装入口和真实来源。" : "全局与项目指令、commands、rules、hooks 和配置文件。")
                    .nativeAnchor("page-heading", store: store)
                if store.page == .skills {
                    Button { store.sheet = .create } label: { Label("新建 Skill", systemImage: "plus") }.buttonStyle(OtterButtonStyle(treatment: .accent)).nativeAnchor("new-skill", store: store)
                    Menu { Button("导入技能包目录…") { store.importPackage() }; Button("导入 .otterskill 归档…") { store.importArchive() } } label: { Image(systemName: "square.and.arrow.down") }
                        .menuStyle(.borderlessButton).menuIndicator(.hidden).font(OtterTypography.label)
                        .frame(width: OtterTheme.controlHeight, height: OtterTheme.controlHeight)
                        .background(OtterTheme.control, in: RoundedRectangle(cornerRadius: OtterTheme.controlRadius))
                        .accessibilityLabel("导入技能包")
                }
                if store.hasInspector { WorkspaceInspectorButton(store: store) }
            }.padding(OtterTheme.pageInset)
            HStack(spacing: 12) {
                SearchField(title: "搜索名称、描述或路径", text: $store.search).nativeAnchor("library-search", store: store)
                OtterMenu(title: "筛选来源", selection: store.sourceFilter.isEmpty ? "所有来源" : (store.sourceFilter as NSString).lastPathComponent,
                          options: [(title: "所有来源", action: { store.sourceFilter = "" })] + store.configuration.sources.map { source in
                              (title: (source as NSString).lastPathComponent, action: { store.sourceFilter = FileSystem.resolve(source).finalPath ?? source })
                          }).frame(width: 140).nativeAnchor("library-source", store: store)
                Toggle("有问题", isOn: $store.problemFilter).toggleStyle(.checkbox).font(OtterTypography.body)
                    .fixedSize().frame(height: OtterTheme.controlHeight)
                Button("打开") { if let entry = store.selectedEntry { store.open(entry) } }.buttonStyle(OtterButtonStyle()).disabled(store.selectedEntry == nil).nativeAnchor("open-resource", store: store)
            }.padding(.horizontal, OtterTheme.pageInset).padding(.bottom, 16)
            Table(store.filteredEntries, selection: $store.selectedEntryID) {
                TableColumn("名称") { entry in
                    HStack(spacing: 10) {
                        Image(systemName: entry.kind == .skill ? "sparkles" : "doc.text").frame(width: 18).foregroundStyle(OtterTheme.accent)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(entry.name).font(OtterTypography.label).lineLimit(1)
                            Text(entry.summary.isEmpty ? store.shortPath(entry.path) : entry.summary).font(OtterTypography.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        if !entry.problems.isEmpty { Image(systemName: "exclamationmark.circle").foregroundStyle(OtterTheme.warning) }
                    }.padding(.vertical, 8).nativeAnchor("resource." + entry.path, store: store)
                }.width(min: 240, ideal: 320)
                TableColumn("使用方") { entry in Text(entry.consumers.map { $0.harness.title + ($0.profile == "default" ? "" : " / " + $0.profile) }.joined(separator: " · ")).font(OtterTypography.caption).foregroundStyle(.secondary).lineLimit(2) }.width(min: 110, ideal: 150)
                TableColumn("关系") { entry in Text(entry.relationship.title).font(OtterTypography.caption).lineLimit(2) }.width(min: 130, ideal: 155)
            }
            .contextMenu(forSelectionType: String.self) { selection in
                if let entry = store.index.entries.first(where: { selection.contains($0.id) }) {
                    Button("打开") { store.open(entry) }; Button("在 Finder 中显示") { store.reveal(entry.path) }
                    if entry.counterpart != nil { Button("比较来源") { store.compare(entry) } }
                }
            } primaryAction: { selection in if let entry = store.index.entries.first(where: { selection.contains($0.id) }) { store.open(entry) } }
            .overlay {
                if store.filteredEntries.isEmpty {
                    OtterEmptyState(title: "没有匹配的资源", symbol: "magnifyingglass", description: "尝试其他关键词，或调整 Agent 与来源筛选。")
                }
            }
            .background(OtterTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(OtterTheme.line, lineWidth: 0.75))
            .nativeAnchor("library-table", store: store)
            .padding(.horizontal, OtterTheme.pageInset).padding(.bottom, OtterTheme.pageInset)
        }
    }
    private var workflow: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(alignment: .top) {
                    OtterPageHeading(title: "Workflow", subtitle: "源 → 安装入口 → 使用方。每个来源只管理明确登记的条目。")
                        .nativeAnchor("page-heading", store: store)
                    Button("添加来源…") { store.selectSource() }.buttonStyle(OtterButtonStyle(treatment: .accent))
                    if store.hasInspector { WorkspaceInspectorButton(store: store) }
                }
                ForEach(store.configuration.sources, id: \.self) { source in
                    OtterSection(title: (source as NSString).lastPathComponent, subtitle: store.shortPath(source)) {
                        let canonical = FileSystem.resolve(source).finalPath ?? source
                        let shared = store.index.entries.filter { $0.sourceRoot == canonical && !$0.consumers.isEmpty }
                        HStack { StatusBadge(title: "\(shared.count) 个共享入口", symbol: "link"); Spacer(); Button("在 Finder 查看") { store.reveal(source) }.buttonStyle(OtterButtonStyle(treatment: .plain)) }
                        ForEach(Array(shared.prefix(18))) { entry in
                            Button { store.selectedEntryID = entry.id } label: {
                                HStack(alignment: .firstTextBaseline, spacing: 12) {
                                    Image(systemName: "doc.text").frame(width: 18).foregroundStyle(OtterTheme.accent)
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(entry.name).font(OtterTypography.label)
                                        Text(store.shortPath(entry.path)).font(OtterTypography.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                                    }.frame(maxWidth: .infinity, alignment: .leading)
                                    Image(systemName: "arrow.right").foregroundStyle(.tertiary)
                                    Text(entry.consumers.map(\.title).joined(separator: "\n")).font(OtterTypography.caption).frame(width: 145, alignment: .leading)
                                }.contentShape(Rectangle()).padding(.vertical, 8)
                            }.buttonStyle(.plain)
                        }
                        if shared.isEmpty { Text("尚未观察到指向此来源的安装入口。可从 Skills 分发单个包。").font(OtterTypography.caption).foregroundStyle(.secondary) }
                    }
                }
                OtterSection(title: "变更历史", subtitle: "检查点只保留在本机；撤销前再次核对文件，没有跨文件原子事务。") {
                    if store.history.isEmpty { Text("还没有通过 Otter 修改文件。").font(OtterTypography.caption).foregroundStyle(.secondary) }
                    ForEach(store.history) { receipt in
                        HStack(spacing: 14) {
                            Image(systemName: receipt.undone ? "arrow.uturn.backward" : "checkmark.circle").foregroundStyle(OtterTheme.accent)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(receipt.changeSet.title).font(OtterTypography.label)
                                Text("\(receipt.changeSet.changes.count) 项 · \(receipt.changeSet.createdAt.formatted()) · \(receipt.undone ? "已撤销" : receipt.completed ? "已应用" : "需恢复")").font(OtterTypography.caption).foregroundStyle(.secondary)
                                if let message = receipt.message { Text(message).font(OtterTypography.caption).foregroundStyle(OtterTheme.warning) }
                            }; Spacer()
                            Button("查看") { store.review(receipt.changeSet) }.buttonStyle(OtterButtonStyle(treatment: .plain))
                            Button("撤销") { store.undo(receipt) }.buttonStyle(OtterButtonStyle()).disabled(receipt.undone || !receipt.completed || store.saving)
                                .nativeAnchor("undo." + receipt.id, store: store)
                        }.padding(.vertical, 6)
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(OtterTheme.pageInset)
        }
    }
}

struct WorkspaceInspectorButton: View {
    @Bindable var store: WorkspaceStore
    var body: some View {
        Button { store.toggleInspector() } label: { Image(systemName: "info.circle") }
            .buttonStyle(OtterButtonStyle(iconOnly: true))
            .help("资源详情 · ⌥⌘I").accessibilityLabel("显示或隐藏资源详情")
            .nativeAnchor("inspector", store: store)
            .popover(isPresented: $store.compactInspector) { WorkspaceInspector(store: store).frame(width: 300, height: 600) }
    }
}

struct WorkspaceInspector: View {
    @Bindable var store: WorkspaceStore
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack { Text("检查器").font(OtterTypography.sectionTitle); Spacer(); Text(store.selectedEntry?.kind.title ?? "工作区").font(OtterTypography.caption).foregroundStyle(.secondary) }
                if let entry = store.selectedEntry {
                    if store.activeDocument?.path.hasSuffix("SKILL.md") == true {
                        OtterSegmentedPicker(title: "检查器内容", choices: [("来源", "来源"), ("元数据", "元数据")], selection: $store.inspectorTab)
                    }
                    if store.inspectorTab == "元数据", let document = store.activeDocument, document.path.hasSuffix("SKILL.md") {
                        let metadata = SkillValidator.inspect(document.text, path: document.path)
                        OtterInspectorSection(title: "Skill 元数据", symbol: "slider.horizontal.3") {
                            ForEach(["name", "description", "license", "compatibility"], id: \.self) { key in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(key).font(OtterTypography.captionLabel).foregroundStyle(.secondary)
                                    TextField(key, text: Binding(get: { metadata.fields[key] ?? "" }, set: { store.setMetadata(key, $0) }), axis: key == "description" ? .vertical : .horizontal)
                                        .lineLimit(key == "description" ? 3...6 : 1...2).otterTextField()
                                        .nativeAnchor("metadata." + key, store: store)
                                }
                            }
                            Text("表单只改对应字段。未知字段、注释和正文保留在源码中。").font(OtterTypography.detail).foregroundStyle(.secondary)
                        }
                    }
                    OtterInspectorSection(title: "文件关系", symbol: "link") {
                        StatusBadge(title: entry.relationship.title, symbol: "link", warning: [.broken, .bothChanged, .unknownLineage].contains(entry.relationship))
                        MetaRow(title: "安装入口", value: store.shortPath(entry.path))
                        ForEach(Array(entry.resolution.links.enumerated()), id: \.offset) { _, hop in
                            VStack(alignment: .leading, spacing: 4) { Text(store.shortPath(hop.path)); Text("→ " + hop.destination).foregroundStyle(.secondary) }.font(OtterTypography.code).textSelection(.enabled)
                        }
                        MetaRow(title: "实际保存位置", value: store.shortPath(store.activeDocument?.original.target ?? entry.sourcePath))
                        if let digest = entry.digest { MetaRow(title: entry.kind == .skill ? "完整包 SHA-256" : "内容 SHA-256", value: String(digest.prefix(20)) + "…") }
                        Button("在 Finder 中显示") { store.reveal(entry.path) }.buttonStyle(OtterButtonStyle(treatment: .plain)).font(OtterTypography.caption)
                    }
                    OtterInspectorSection(title: "使用与发现", symbol: "person.2") {
                        let consumers = store.currentConsumers.isEmpty ? entry.consumers : store.currentConsumers
                        if consumers.isEmpty { Text("未观察到使用方。可继续创作，再选择分发入口。").font(OtterTypography.caption).foregroundStyle(.secondary) }
                        ForEach(consumers) { consumer in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(consumer.title).font(OtterTypography.label)
                                StatusBadge(title: consumer.discovery.title, symbol: consumer.discovery == .discovered ? "checkmark.circle" : "circle.dotted")
                                Text(consumer.evidence).font(OtterTypography.detail).foregroundStyle(.secondary)
                            }
                        }
                    }
                    if entry.counterpart != nil {
                        OtterInspectorSection(title: "比较与管理", symbol: "arrow.left.arrow.right") {
                            MetaRow(title: "可比较来源", value: store.shortPath(entry.counterpart!))
                            Button("比较当前内容") { store.compare(entry) }.buttonStyle(OtterButtonStyle()).nativeAnchor("compare-source", store: store)
                            if entry.relationship != .symlink && entry.relationship != .configurationReference && entry.relationship != .source {
                                Button(entry.kind == .skill ? "审阅完整包同步…" : "采用源内容…") { store.synchronize(entry) }.buttonStyle(OtterButtonStyle())
                            }
                        }
                    }
                    if entry.problems.contains(where: { $0.rule == "codex.legacy-instructions" }) {
                        Button("审阅 AGENTS.md 入口…") { store.linkInstruction(entry) }.buttonStyle(OtterButtonStyle(treatment: .accent)).nativeAnchor("fix-instructions", store: store)
                    }
                } else {
                    OtterInspectorSection(title: "选择资源查看证据", symbol: "cursorarrow") {
                        Text("文件路径、完整链接链、使用方和运行时发现记录会显示在这里。").font(OtterTypography.caption).foregroundStyle(.secondary)
                    }
                    MetaRow(title: "扫描范围", value: store.shortPath(store.configuration.home))
                    MetaRow(title: "上次扫描", value: store.index.scannedAt.formatted())
                }
            }.padding(OtterTheme.cardInset)
        }.background(OtterTheme.canvas)
    }
}

struct StatusBadge: View {
    let title: String
    var symbol = "circle.dotted"
    var warning = false
    var body: some View { Label(title, systemImage: symbol).font(OtterTypography.captionLabel).foregroundStyle(warning ? OtterTheme.warning : OtterTheme.accent).padding(.horizontal, 8).padding(.vertical, 5).background((warning ? OtterTheme.warning : OtterTheme.accent).opacity(0.09), in: Capsule()).fixedSize(horizontal: false, vertical: true) }
}
struct MetaRow: View {
    let title: String
    let value: String
    var body: some View { VStack(alignment: .leading, spacing: 6) { Text(title).font(OtterTypography.captionLabel).foregroundStyle(.secondary); Text(value).font(OtterTypography.body).textSelection(.enabled).fixedSize(horizontal: false, vertical: true) }.frame(maxWidth: .infinity, alignment: .leading) }
}
struct SearchField: View {
    let title: String
    @Binding var text: String
    var body: some View { HStack(spacing: 7) { Image(systemName: "magnifyingglass").foregroundStyle(.secondary); TextField(title, text: $text).textFieldStyle(.plain); if !text.isEmpty { Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }.buttonStyle(.plain).accessibilityLabel("清除搜索") } }.font(OtterTypography.body).padding(.horizontal, 10).frame(height: OtterTheme.controlHeight).background(OtterTheme.surface, in: RoundedRectangle(cornerRadius: OtterTheme.controlRadius)).overlay(RoundedRectangle(cornerRadius: OtterTheme.controlRadius).strokeBorder(OtterTheme.line, lineWidth: 0.75)) }
}
struct ProblemRow: View {
    let problem: WorkspaceProblem
    let shortPath: String
    var body: some View { HStack(alignment: .firstTextBaseline, spacing: 10) { Image(systemName: problem.severity == .error ? "xmark.octagon" : "exclamationmark.triangle").font(OtterTypography.body).frame(width: 18).foregroundStyle(problem.severity == .error ? OtterTheme.danger : OtterTheme.warning); VStack(alignment: .leading, spacing: 6) { Text(problem.message).font(OtterTypography.label).fixedSize(horizontal: false, vertical: true); Text("\(shortPath):\(problem.line)").font(OtterTypography.code).foregroundStyle(.secondary).lineLimit(2).truncationMode(.middle) }; Spacer(minLength: 0) }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle()) }
}
