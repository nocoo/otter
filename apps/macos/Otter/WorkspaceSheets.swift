import AppKit
import OtterCore
import SwiftUI

struct WorkspaceSheetView: View {
    @Bindable var store: WorkspaceStore
    let sheet: WorkspaceSheet
    @State private var name = ""
    @State private var description = ""
    @State private var source = ""
    @State private var query = ""
    @State private var selectedTargets: Set<String> = ["shared"]
    @State private var filePath = "references/notes.md"
    @State private var content = "# Notes\n"
    @State private var find = ""
    @State private var replacement = ""
    @State private var selectedChange: String?
    @State private var mergedText = ""
    @State private var snapshotRaw = false
    private var historical: Bool { store.pendingChanges.map { set in store.history.contains { $0.id == set.id } } ?? false }
    private var title: String {
        switch sheet {
        case .changes: store.pendingChanges?.title ?? "审阅变更"
        case .search: "搜索工作区"
        case .create: "创建 Skill"
        case .distribute: "分发完整技能包"
        case .rename: "重命名技能包"
        case .newFile: "新建包内文件"
        case .replace: "包内查找与替换"
        case .comparison: store.comparisonTitle
        case .snapshot: "查看并审阅本地快照"
        }
    }
    private var primaryTitle: String {
        switch sheet {
        case .changes: "应用 \(store.pendingChanges?.changes.count ?? 0) 项变更"
        case .create: "预览创建"
        case .distribute: "预览分发"
        case .rename: "预览重命名"
        case .newFile: "预览新建"
        case .replace: "预览替换"
        case .comparison: "保留合并稿，继续编辑"
        case .snapshot: "上传这份快照"
        case .search: "关闭"
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                OtterPageHeading(title: title, subtitle: subtitle)
                if let error = store.error { Text(error).font(OtterTypography.caption).foregroundStyle(OtterTheme.warning).textSelection(.enabled) }
            }.padding(OtterTheme.pageInset)
            Divider()
            contents.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            Divider()
            HStack {
                if store.saving { ProgressView().controlSize(.small); Text("正在应用并校验…").font(OtterTypography.caption).foregroundStyle(.secondary) }
                Spacer()
                Button(sheet == .search || historical ? "关闭" : "取消") { store.sheet = nil; store.error = nil }
                    .buttonStyle(OtterButtonStyle()).keyboardShortcut(.cancelAction).disabled(store.saving).nativeAnchor("sheet-cancel", store: store)
                if sheet != .search && !historical && (sheet != .comparison || store.conflictDocumentID != nil) {
                    Button(primaryTitle, action: perform).buttonStyle(OtterButtonStyle(treatment: .accent)).keyboardShortcut(.defaultAction)
                        .disabled(primaryDisabled).nativeAnchor("sheet-apply", store: store)
                }
            }.padding(OtterTheme.pageInset)
        }
        .font(OtterTypography.body)
        .frame(width: sheet == .search ? 640 : 820, height: sheet == .search ? 480 : 610)
        .background(OtterTheme.canvas)
        .onAppear {
            source = store.configuration.sources.first ?? ""
            if sheet == .rename { name = (store.editorRoot ?? "" as String).components(separatedBy: "/").last ?? "" }
            mergedText = store.comparisonAfter
            selectedChange = store.pendingChanges?.changes.first(where: { $0.after.kind == .file })?.id ?? store.pendingChanges?.changes.first?.id
        }
    }
    private var subtitle: String {
        switch sheet {
        case .changes: historical ? "已经记录的操作。撤销会重新检查当前磁盘，避免覆盖后来修改。" : "检查完整路径、前后内容和受影响入口；写入前再次验证磁盘。"
        case .search: "搜索 skill、command、配置文件、harness 与诊断。"
        case .create: "创建完整技能目录；可随时添加 scripts、references、assets 与 agents/openai.yaml。"
        case .distribute: "按包目录建立链接，保留汇集目录中的其他来源。当前会话仍需刷新。"
        case .rename: "同时审阅包内内容和已知消费链接。不会替换任何来源的汇集目录。"
        case .newFile: "使用包内相对路径。支持 Markdown、YAML、JSON、TOML、脚本与文本。"
        case .replace: "每个受影响文件都会进入变更预览，不改未确认的脏缓冲区。"
        case .comparison: store.conflictDocumentID == nil ? "比较两个当前版本；相同内容不会自动建立来源关系。" : "磁盘、原始版本与自己的草稿都被保留。完成合并后再按 ⌘S。"
        case .snapshot: "实际上传对象由快照 ID 和 SHA-256 固定；确认上传不会重新采集或额外上传图标。"
        }
    }
    @ViewBuilder private var contents: some View {
        switch sheet {
        case .changes: changeReview
        case .search: searchResults
        case .comparison: comparison
        case .snapshot: snapshot
        default: ScrollView { form.padding(OtterTheme.pageInset) }
        }
    }
    @ViewBuilder private var form: some View {
        VStack(alignment: .leading, spacing: 20) {
            switch sheet {
            case .create:
                Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 16) {
                    GridRow {
                        Text("来源").frame(width: 104, alignment: .leading)
                        OtterMenu(title: "创建到来源", selection: store.shortPath(source), options: store.configuration.sources.map { path in
                            (title: store.shortPath(path), action: { source = path })
                        })
                    }
                    GridRow(alignment: .firstTextBaseline) {
                        Text("name")
                        TextField("例如 workspace-notes", text: $name).otterTextField()
                            .accessibilityLabel("Skill name").nativeAnchor("new-skill-name", store: store)
                    }
                    GridRow(alignment: .firstTextBaseline) {
                        Text("description")
                        TextField("什么情况下使用这个技能？", text: $description, axis: .vertical).lineLimit(3...5).otterTextField()
                            .accessibilityLabel("Skill description").nativeAnchor("new-skill-description", store: store)
                    }
                }
                if store.configuration.sources.isEmpty { Button("先添加来源目录…") { store.selectSource(); source = store.configuration.sources.first ?? "" } }
                Text("名称采用 1–64 位小写字母、数字与连字符。未分发的草稿可继续完善。").font(OtterTypography.caption).foregroundStyle(.secondary)
            case .distribute:
                MetaRow(title: "完整技能包", value: store.editorRoot ?? "")
                ForEach(store.distributionTargets) { target in
                    VStack(alignment: .leading, spacing: 6) {
                        Toggle(target.title, isOn: Binding(get: { selectedTargets.contains(target.id) }, set: { if $0 { selectedTargets.insert(target.id) } else { selectedTargets.remove(target.id) } }))
                            .nativeAnchor("distribute." + target.id, store: store)
                        Text(store.shortPath(target.path)).font(OtterTypography.code).foregroundStyle(.secondary).padding(.leading, 20)
                    }
                }
                StatusBadge(title: "已有独立内容的入口会阻止覆盖", symbol: "doc.on.doc", warning: true)
            case .rename:
                MetaRow(title: "当前包", value: store.editorRoot ?? "")
                TextField("新名称", text: $name).otterTextField()
                Text("SKILL.md 的 name 字段、已知包目录链接和管理记录会一并列出；提交后仍可撤销。").foregroundStyle(.secondary)
            case .newFile:
                TextField("包内路径", text: $filePath).otterTextField().nativeAnchor("new-file-path", store: store)
                HStack {
                    Button("Reference") { filePath = "references/notes.md"; content = "# Notes\n" }
                    Button("Shell script") { filePath = "scripts/check.sh"; content = "#!/bin/sh\nset -eu\n\n" }
                    Button("OpenAI metadata") { filePath = "agents/openai.yaml"; content = "interface:\n  display_name: \"\(((store.editorRoot ?? "Skill") as NSString).lastPathComponent)\"\n  short_description: \"Describe this skill\"\n  default_prompt: \"Use this skill to complete the task.\"\npolicy:\n  allow_implicit_invocation: true\n" }
                }.buttonStyle(OtterButtonStyle())
                TextEditor(text: $content).font(OtterTypography.code).frame(height: 240).border(OtterTheme.line)
            case .replace:
                MetaRow(title: "当前包", value: store.editorRoot ?? "")
                Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 12) {
                    GridRow {
                        Text("查找").frame(width: 104, alignment: .leading)
                        TextField("字面文本", text: $find).otterTextField().accessibilityLabel("查找文本")
                    }
                    GridRow {
                        Text("替换为")
                        TextField("替换文本", text: $replacement).otterTextField().accessibilityLabel("替换文本")
                    }
                }
                Text("只处理包内的 UTF-8 实体文件，保留执行权限。提交前逐文件检查差异。").foregroundStyle(.secondary)
            default: EmptyView()
            }
        }.font(OtterTypography.body).frame(maxWidth: .infinity, alignment: .leading)
    }
    private var changeReview: some View {
        HStack(spacing: 0) {
            List(selection: $selectedChange) {
                ForEach(store.pendingChanges?.changes ?? []) { change in
                    VStack(alignment: .leading, spacing: 5) {
                        Text((change.before.path as NSString).lastPathComponent).font(OtterTypography.label)
                        Text(change.after.kind == nil ? "移除" : change.before.payload.kind == nil ? "新增" : "修改").font(OtterTypography.detail).foregroundStyle(.secondary)
                    }.padding(.vertical, 5).tag(change.id)
                }
            }.listStyle(.plain).frame(width: 180)
            Divider()
            if let change = store.pendingChanges?.changes.first(where: { $0.id == selectedChange }) ?? store.pendingChanges?.changes.first {
                VStack(alignment: .leading, spacing: 12) {
                    MetaRow(title: "实际目标", value: change.before.target)
                    if change.before.path != change.before.target { MetaRow(title: "保留此入口链接", value: change.before.path) }
                    if !change.affectedConsumers.isEmpty { Text("影响：" + change.affectedConsumers.joined(separator: "、")).font(OtterTypography.caption).foregroundStyle(OtterTheme.warning) }
                    HStack(spacing: 12) {
                        textPane("当前", text: payloadText(change.before.payload))
                        textPane("修改后", text: payloadText(change.after))
                    }.frame(maxHeight: .infinity)
                }.padding(OtterTheme.cardInset)
            }
        }
    }
    private func payloadText(_ payload: FilePayload) -> String {
        switch payload.kind {
        case nil: return "（不存在）"
        case .directory: return "目录 · 权限 \(String(payload.mode, radix: 8))"
        case .symlink: return "链接 → \(payload.link ?? "")"
        case .file:
            if let data = payload.data, let text = String(data: data, encoding: .utf8), !data.prefix(1024).contains(0) {
                return text.count > 250_000 ? String(text.prefix(250_000)) + "\n\n[内容较大，预览显示前 250,000 字符；变更包含完整文件。]" : text
            }
            return "二进制资源 · \(payload.data?.count ?? 0) 字节\nSHA-256：\(payload.data.map(FileSystem.hash) ?? "")\n权限 \(String(payload.mode, radix: 8))"
        case .other: return "不支持的文件类型"
        }
    }
    private func textPane(_ title: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) { Text(title).font(OtterTypography.captionLabel).foregroundStyle(.secondary); ReadOnlyText(text: text).frame(maxWidth: .infinity, maxHeight: .infinity).overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(OtterTheme.line)) }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    private var searchResults: some View {
        VStack(alignment: .leading, spacing: 12) {
            SearchField(title: "搜索全部名称、描述和路径", text: $query).nativeAnchor("global-search-field", store: store)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    ForEach(store.index.entries.filter { query.isEmpty || [$0.name, $0.path, $0.summary, $0.kind.title, $0.consumers.map(\.title).joined()].contains { $0.localizedCaseInsensitiveContains(query) } }.prefix(80)) { entry in
                        Button { store.sheet = nil; store.open(entry) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: entry.kind == .skill ? "sparkles" : "doc.text").foregroundStyle(OtterTheme.accent)
                                VStack(alignment: .leading, spacing: 5) { Text(entry.name).font(OtterTypography.label); Text(store.shortPath(entry.path)).font(OtterTypography.detail).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle) }
                                Spacer(); Text(entry.kind.title).font(OtterTypography.detail).foregroundStyle(.secondary)
                            }.padding(8).contentShape(Rectangle())
                        }.buttonStyle(.plain).nativeAnchor("search-result." + entry.path, store: store)
                    }
                    ForEach(store.index.problems.filter { !$0.message.isEmpty && !query.isEmpty && $0.message.localizedCaseInsensitiveContains(query) }.prefix(15)) { problem in
                        Button { store.sheet = nil; store.page = .overview } label: { ProblemRow(problem: problem, shortPath: store.shortPath(problem.path)) }.buttonStyle(.plain)
                    }
                }
            }
        }.padding(OtterTheme.pageInset)
    }
    private var comparison: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 16) { textPane("磁盘 / 当前入口", text: store.comparisonBefore); textPane(store.conflictDocumentID == nil ? "源 / 比较结果" : "自己的草稿", text: store.comparisonAfter) }.frame(maxHeight: .infinity)
            if let base = store.comparisonBase {
                DisclosureGroup("查看原始基线") { ReadOnlyText(text: base).frame(height: 85) }.font(OtterTypography.caption)
                Text("合并稿（可编辑）").font(OtterTypography.captionLabel)
                TextEditor(text: $mergedText).font(OtterTypography.code).frame(height: 120).border(OtterTheme.line)
            }
        }.padding(OtterTheme.pageInset)
    }
    private var snapshot: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let value = store.selectedSnapshot {
                HStack(alignment: .top, spacing: 24) {
                    MetaRow(title: "固定快照", value: value["snapshot"]["id"].string ?? "")
                    MetaRow(title: "实际上传到", value: store.reviewedClient?.configuration.apiURL ?? "")
                }
                Text("SHA-256 · " + (value["sha256"].string ?? "")).font(OtterTypography.code).foregroundStyle(.secondary).textSelection(.enabled)
                Toggle("查看完整 JSON 正文", isOn: $snapshotRaw).toggleStyle(.checkbox).font(OtterTypography.caption)
                if snapshotRaw { ReadOnlyText(text: value["snapshot"].pretty).frame(maxHeight: .infinity) }
                else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            ForEach(Array(value["snapshot"]["collectors"].array.enumerated()), id: \.offset) { _, collector in
                                DisclosureGroup {
                                    ForEach(Array(collector["files"].array.enumerated()), id: \.offset) { _, file in
                                        DisclosureGroup(file["path"].string ?? "文件") { ReadOnlyText(text: snapshotPreview(file, snapshot: value["snapshot"])).frame(height: 160) }.font(OtterTypography.caption)
                                    }
                                    if !collector["lists"].array.isEmpty { Text(collector["lists"].array.compactMap { $0["name"].string }.joined(separator: "、")).font(OtterTypography.caption).textSelection(.enabled) }
                                    ForEach(collector["errors"].array.compactMap(\.string), id: \.self) { Text($0).font(OtterTypography.caption).foregroundStyle(OtterTheme.warning) }
                                } label: { HStack { Text(collector["label"].string ?? "采集器"); Spacer(); Text("\(collector["files"].array.count) 文件 · \(collector["lists"].array.count) 清单项").foregroundStyle(.secondary) }.font(OtterTypography.caption) }
                            }
                        }
                    }
                }
            }
        }.padding(OtterTheme.pageInset)
    }
    private func snapshotPreview(_ file: JSONValue, snapshot: JSONValue) -> String {
        do { return try SnapshotContent.preview(file, in: snapshot) }
        catch { return error.localizedDescription }
    }
    private var primaryDisabled: Bool {
        if store.saving { return true }
        switch sheet {
        case .create: return !PackageOperations.validName(name) || description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || source.isEmpty
        case .rename: return !PackageOperations.validName(name)
        case .distribute: return selectedTargets.isEmpty
        case .newFile: return !PackageOperations.validRelativePath(filePath)
        case .replace: return find.isEmpty
        case .snapshot: return store.jobs.contains(where: \.isRunning) || store.selectedSnapshot == nil
        default: return false
        }
    }
    private func perform() {
        store.error = nil
        switch sheet {
        case .changes: if let set = store.pendingChanges { store.apply(set) }
        case .create: store.createSkill(name: name, description: description, source: source)
        case .distribute: store.distribute(to: selectedTargets)
        case .rename: store.renamePackage(name: name)
        case .newFile: store.newFile(relativePath: filePath, contents: content)
        case .comparison: store.resolveConflict(text: mergedText)
        case .snapshot: store.uploadReviewedSnapshot()
        case .replace:
            guard let root = store.editorRoot else { return }
            do {
                guard !store.documents.values.contains(where: { FileSystem.isWithin($0.original.target, root) && $0.isDirty }) else { throw WorkspaceError.message("请先保存当前包的草稿，再替换磁盘文件") }
                let set = try PackageOperations.replaceInPackage(root, find: find, replacement: replacement)
                guard !set.changes.isEmpty else { throw WorkspaceError.message("没有匹配的文件") }
                store.review(set)
            } catch { store.error = error.localizedDescription }
        case .search: store.sheet = nil
        }
    }
}

struct ReadOnlyText: NSViewRepresentable {
    let text: String
    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView(); scroll.hasVerticalScroller = true; scroll.hasHorizontalScroller = true; scroll.autohidesScrollers = true
        let view = NSTextView(); view.isEditable = false; view.isRichText = false; view.isSelectable = true
        view.font = .monospacedSystemFont(ofSize: 11, weight: .regular); view.textContainerInset = NSSize(width: 10, height: 10)
        view.isVerticallyResizable = true; view.autoresizingMask = [.width]; view.textContainer?.widthTracksTextView = true
        scroll.documentView = view; return scroll
    }
    func updateNSView(_ scroll: NSScrollView, context: Context) { if let view = scroll.documentView as? NSTextView { if view.string != text { view.string = text }; view.textColor = .labelColor; view.backgroundColor = .textBackgroundColor } }
}
