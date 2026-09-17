import AppKit
import Observation
import OtterCore

enum WorkspacePage: String, CaseIterable, Identifiable {
    case overview, workflow, agents, backups, environment, instructions, skills, settings
    var id: String { rawValue }
    var title: String {
        switch self { case .overview: "概览"; case .agents: "Agents"; case .instructions: "指令与配置"; case .skills: "Skills"; case .workflow: "配置来源"; case .backups: "备份"; case .environment: "软件与环境"; case .settings: "设置" }
    }
    var symbol: String {
        switch self { case .overview: "square.grid.2x2"; case .agents: "terminal"; case .instructions: "text.alignleft"; case .skills: "square.stack.3d.up"; case .workflow: "point.3.connected.trianglepath.dotted"; case .backups: "externaldrive"; case .environment: "app.badge"; case .settings: "gearshape" }
    }
}
enum WorkspaceSheet: String, Identifiable { case changes, search, create, distribute, rename, newFile, replace, comparison, snapshot; var id: String { rawValue } }

@MainActor @Observable final class EditorDocument: Identifiable {
    nonisolated let id: String
    let path: String
    let packageRoot: String?
    var original: FileVersion
    var text: String
    var problems: [WorkspaceProblem] = []
    var headings: [DocumentHeading] = []
    var requestedLine: Int?
    var conflict = false
    var savedDraft = false
    var isDirty: Bool { Data(text.utf8) != original.payload.data }
    init(path: String, original: FileVersion, text: String, packageRoot: String? = nil) { id = original.target; self.path = path; self.original = original; self.text = text; self.packageRoot = packageRoot }
}

@MainActor @Observable final class CLIJob: Identifiable {
    let id: String
    let title: String
    let arguments: [String]
    let client: CLIClient
    let started: Date
    let command: String
    var phase = "queued"
    var lines: [String] = []
    var completedCollectors: [String] = []
    var result: JSONValue?
    var error: String?
    var finished: Date?
    var snapshotID: String?
    var isRunning: Bool { finished == nil }
    var isUpload: Bool { arguments.first == "backup" }
    init(title: String, arguments: [String], client: CLIClient) {
        id = UUID().uuidString; started = Date(); self.title = title; self.arguments = arguments; self.client = client
        command = client.executable + "\n" + (arguments + client.commonArguments).joined(separator: " ")
    }
    init(record: CLIJobRecord, client: CLIClient) {
        id = record.id; title = record.title; arguments = record.arguments; command = record.command; started = record.started
        finished = record.finished; phase = record.phase; error = record.error; snapshotID = record.snapshotID; self.client = client
    }
    var record: CLIJobRecord { CLIJobRecord(id: id, title: title, arguments: arguments, command: command, started: started, finished: finished, phase: phase, error: error, snapshotID: snapshotID) }
}

@MainActor @Observable final class WorkspaceStore {
    var configuration: WorkspaceConfiguration
    let dataDirectory: String
    let isolated: Bool
    var index = WorkspaceIndex()
    var page: WorkspacePage = .overview
    var selectedEntryID: String?
    var selectedHarness: Harness?
    var search = ""
    var sourceFilter = ""
    var problemFilter = false
    var scanning = false
    var saving = false
    var quitting = false
    var status = "正在准备本机工作区…"
    var error: String?
    var sheet: WorkspaceSheet?
    var pendingChanges: ChangeSet?
    var editorRoot: String?
    var activeDocumentID: String?
    var documents: [String: EditorDocument] = [:]
    var openDocumentIDs: [String] = []
    var fileList: [PackageFile] = []
    var binaryURL: URL?
    var editorMode = "源码"
    var wrapLines = true
    var inspectorTab = "来源"
    var inspectorRequested = true
    var compactInspector = false
    var availableWidth: CGFloat = 0
    var showProblems = true
    var capabilities: JSONValue?
    var cliStatus: JSONValue?
    var cliError: String?
    var snapshots: [JSONValue] = []
    var workspaceCapture: JSONValue?
    var backupStatus: JSONValue?
    var remoteTimeline: JSONValue?
    var environmentSnapshot: JSONValue?
    var selectedProfile = ""
    var jobs: [CLIJob] = []
    var selectedSnapshot: JSONValue?
    var reviewedClient: CLIClient?
    var comparisonTitle = "比较内容"
    var comparisonBefore = ""
    var comparisonAfter = ""
    var comparisonBase: String?
    var conflictDocumentID: String?
    var history: [TransactionReceipt] = []
    var packageSearch = ""
    var pendingOpenPath: String?
    @ObservationIgnored var editorViews: [String: NSScrollView] = [:]
    @ObservationIgnored weak var editor: NSTextView?
    @ObservationIgnored weak var window: NSWindow?
    @ObservationIgnored let transactions: FileTransactions
    @ObservationIgnored let drafts: DraftStore
    @ObservationIgnored private var scanTask: Task<Void, Never>?
    @ObservationIgnored private var scanGeneration = 0
    @ObservationIgnored private var registryTask: Task<Void, Never>?
    @ObservationIgnored private var draftTasks: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var watchTask: Task<Void, Never>?
    @ObservationIgnored private var watcher: WorkspaceWatcher?
    @ObservationIgnored private var runner: ProcessRunner?
    @ObservationIgnored private var jobTask: Task<Void, Never>?
    @ObservationIgnored var automation: NativeAutomation?
    @ObservationIgnored var anchors: [String: WeakNativeView] = [:]

    init() {
        var automationRoot: String?
        #if DEBUG
        if let index = CommandLine.arguments.firstIndex(of: "--automation-root"), CommandLine.arguments.indices.contains(index + 1) {
            automationRoot = CommandLine.arguments[index + 1]
        }
        #endif
        isolated = automationRoot != nil
        let userHome = FileManager.default.homeDirectoryForCurrentUser.path
        dataDirectory = automationRoot.map { FileSystem.join($0, "data") } ?? FileSystem.join(userHome, "Library/Application Support/Otter")
        let configPath = FileSystem.join(dataDirectory, "workspace.json")
        let defaultHome = automationRoot.map { FileSystem.join($0, "home") } ?? userHome
        let workflow = automationRoot.map { FileSystem.join($0, "workflow") } ?? FileSystem.join(defaultHome, "workspace/personal/workflow")
        let initial = WorkspaceConfiguration(home: defaultHome, sources: FileManager.default.fileExists(atPath: workflow) ? [workflow] : [])
        if let data = try? FileSystem.read(configPath), let saved = try? JSONDecoder().decode(WorkspaceConfiguration.self, from: data), saved.version == 1 {
            configuration = saved
        } else { configuration = initial }
        transactions = FileTransactions(directory: FileSystem.join(dataDirectory, "checkpoints"))
        drafts = DraftStore(directory: FileSystem.join(dataDirectory, "drafts"))
        #if DEBUG
        if let root = automationRoot {
            let marker = (try? FileSystem.read(FileSystem.join(root, "fixture.json"))).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }
            let paths = configuration.sources + configuration.projects + configuration.bindings.flatMap { [$0.source, $0.target] }
                + [configuration.cliConfigDirectory, configuration.cliOutputDirectory]
            precondition(root.hasPrefix("/") && !FileSystem.isWithin(userHome, root)
                && marker?["kind"].string == "otter-native-fixture"
                && configuration.home == FileSystem.join(root, "home")
                && paths.allSatisfy { FileSystem.isWithin($0, root) }
                && configuration.externalCLI == nil && URL(string: configuration.apiURL)?.host == "127.0.0.1",
                "Native automation requires an explicit isolated fixture and a loopback API")
        }
        #endif
    }

    var selectedEntry: ResourceEntry? {
        index.entries.first { $0.id == selectedEntryID && (page != .skills || $0.kind == .skill) && (page != .instructions || $0.kind != .skill) }
    }
    var activeDocument: EditorDocument? { activeDocumentID.flatMap { documents[$0] } }
    var hasInspector: Bool { [.skills, .instructions, .workflow].contains(page) && selectedEntry != nil }
    var showsInspector: Bool { hasInspector && inspectorRequested && availableWidth >= 980 }
    func toggleInspector() {
        guard hasInspector else { return }
        if availableWidth < 980 { compactInspector.toggle() } else { inspectorRequested.toggle() }
    }
    var editorIsOpen: Bool {
        editorRoot != nil ? page == .skills : page == .instructions && (activeDocument != nil || binaryURL != nil)
    }
    var currentConsumers: [Consumer] { index.consumers(of: editorRoot ?? activeDocument?.path ?? selectedEntry?.path ?? "") }
    var filteredEntries: [ResourceEntry] {
        index.entries.filter { entry in
            (page != .skills || entry.kind == .skill) && (page != .instructions || entry.kind != .skill)
            && (selectedHarness == nil || entry.consumers.contains { $0.harness == selectedHarness && (selectedProfile.isEmpty || $0.profile == selectedProfile) })
            && (configuration.selectedProject == nil || entry.consumers.isEmpty || entry.consumers.contains { $0.cwd == nil || $0.cwd == configuration.selectedProject })
            && (sourceFilter.isEmpty || entry.sourceRoot == sourceFilter)
            && (!problemFilter || !entry.problems.isEmpty)
            && (search.isEmpty || [entry.name, entry.path, entry.summary, entry.kind.title].contains { $0.localizedCaseInsensitiveContains(search) })
        }
    }
    var visibleProblems: [WorkspaceProblem] { activeDocument?.problems ?? selectedEntry?.problems ?? index.problems }
    var cli: CLIClient? {
        #if arch(arm64)
        let architecture = "arm64"
        #else
        let architecture = "x64"
        #endif
        let binary = configuration.externalCLI ?? Bundle.main.url(forResource: "otter-\(architecture)", withExtension: nil, subdirectory: "CLI")?.path
        return binary.map { CLIClient(executable: $0, configuration: configuration, isolated: isolated) }
    }
    func shortPath(_ path: String) -> String { FileSystem.isWithin(path, configuration.home) ? "~" + path.dropFirst(configuration.home.count) : path }

    func start() async {
        do {
            try FileSystem.privateDirectory(dataDirectory)
            if !FileManager.default.fileExists(atPath: configPath) { try FileSystem.writePrivate(configuration, to: configPath) }
            let recovery = try await transactions.recoverInterrupted()
            if recovery.contains(where: { $0.states.contains(.conflict) }) { error = "发现未完成变更与外部修改冲突，请在 Workflow 的变更历史中查看。" }
            history = try await transactions.history()
            if let client = cli, let data = try? FileSystem.read(FileSystem.join(dataDirectory, "jobs.json")) {
                jobs = try JSONDecoder().decode([CLIJobRecord].self, from: data).map { CLIJob(record: $0.recovered(), client: client) }
                try persistJobs()
            }
        } catch { self.error = error.localizedDescription }
        await refreshCLI()
        if let client = cli, capabilities != nil {
            do {
                if !FileManager.default.fileExists(atPath: FileSystem.join(configuration.cliConfigDirectory, "workspace.macos-import.json")) { _ = try await client.json(["source", "import", "--workspace-file", configPath]) }
                _ = try await client.json(["source", "apply", "--workspace-file", configPath])
            } catch { self.error = error.localizedDescription }
        }
        rescan()
    }
    var configPath: String { FileSystem.join(dataDirectory, "workspace.json") }
    func saveConfiguration() {
        do {
            try FileSystem.writePrivate(configuration, to: configPath)
            synchronizeRegistry()
        }
        catch { self.error = error.localizedDescription }
    }
    private func synchronizeRegistry() {
        guard let client = cli else { return }
        let previous = registryTask, path = FileSystem.join(dataDirectory, "workspace-sync-\(UUID().uuidString).json")
        do { try FileSystem.writePrivate(configuration, to: path) }
        catch { self.error = error.localizedDescription; return }
        registryTask = Task {
            defer { try? FileManager.default.removeItem(atPath: path) }
            await previous?.value
            do { _ = try await client.json(["source", "apply", "--workspace-file", path]) }
            catch { self.error = error.localizedDescription }
        }
    }
    func rescan() {
        scanTask?.cancel(); scanGeneration += 1
        let generation = scanGeneration, configuration = configuration
        scanning = true
        scanTask = Task {
            await registryTask?.value
            do {
                guard let client = cli else { throw WorkspaceError.message("应用包中缺少 CLI") }
                let value = try await client.json(["workspace", "inspect"])
                let merged = try CLIWorkspaceIndex.configuration(value["workspace"]["registry"], merging: configuration)
                let work = Task.detached(priority: .userInitiated) { try CLIWorkspaceIndex.decode(value, configuration: merged) }
                let newIndex = try await withTaskCancellationHandler { try await work.value } onCancel: { work.cancel() }
                guard generation == scanGeneration, !Task.isCancelled else { return }
                workspaceCapture = value["workspace"]; backupStatus = value["backup"]
                if self.configuration.sources != merged.sources || self.configuration.projects != merged.projects || self.configuration.bindings != merged.bindings {
                    self.configuration.sources = merged.sources
                    self.configuration.projects = merged.projects
                    self.configuration.bindings = merged.bindings
                    try FileSystem.writePrivate(self.configuration, to: configPath)
                }
                index = newIndex; scanning = false
                status = "\(newIndex.entries.count) 个入口 · \(newIndex.problems.filter { $0.severity != .information }.count) 项待检查 · CLI 采集于 \(newIndex.scannedAt.formatted(date: .omitted, time: .shortened))"
                refreshFileList()
                await refreshOpenDocuments()
                installWatcher()
            } catch is CancellationError { if generation == scanGeneration { scanning = false } }
            catch { if generation == scanGeneration { scanning = false; self.error = error.localizedDescription; status = "扫描未完成，保留上次结果" } }
        }
    }
    func cancelScan() { scanTask?.cancel(); scanning = false; status = "扫描已取消，保留上次结果" }
    private func installWatcher() {
        watcher?.stop()
        watcher = WorkspaceWatcher(paths: index.watchedPaths) { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.watchTask?.cancel()
                self.watchTask = Task {
                    do { try await Task.sleep(for: .milliseconds(450)); self.rescan() } catch { /* coalesced */ }
                }
            }
        }
    }

    func open(_ entry: ResourceEntry) {
        selectedEntryID = entry.id
        if entry.kind == .skill {
            editorRoot = entry.sourcePath; page = .skills; refreshFileList()
            openDocument(FileSystem.join(entry.path, "SKILL.md"))
        } else { editorRoot = nil; page = .instructions; fileList = []; openDocument(entry.path) }
        inspectorTab = "来源"
    }
    func openDocument(_ path: String) {
        Task {
            do {
                let original = try await Task.detached { try FileVersion.capture(path) }.value
                guard original.payload.kind == .file else { throw WorkspaceError.message("此入口不是可编辑文件") }
                guard let data = original.payload.data, let text = String(data: data, encoding: .utf8), !data.prefix(1024).contains(0) else {
                    binaryURL = URL(fileURLWithPath: original.target); activeDocumentID = nil; return
                }
                binaryURL = nil
                let key = original.target
                if documents[key] == nil {
                    let saved = await drafts.load(path)
                    let root = editorRoot.flatMap { FileSystem.isWithin(original.target, $0) ? $0 : nil }
                    let document = EditorDocument(path: path, original: saved?.original ?? original, text: saved?.text ?? text, packageRoot: root)
                    document.conflict = saved != nil && !document.original.matchesCurrent()
                    document.savedDraft = saved != nil
                    documents[key] = document
                }
                activeDocumentID = key
                if !openDocumentIDs.contains(key) { openDocumentIDs.append(key) }
                if let document = documents[key] { validate(document) }
            } catch { self.error = error.localizedDescription }
        }
    }
    func closeEditor() { editorRoot = nil; activeDocumentID = nil; binaryURL = nil }
    func closeDocument(_ key: String) {
        guard let document = documents[key] else { return }
        Task {
            do {
                if document.isDirty { try await drafts.save(EditorDraft(original: document.original, text: document.text)) }
                openDocumentIDs.removeAll { $0 == key }
                editorViews.removeValue(forKey: key)
                if activeDocumentID == key {
                    activeDocumentID = openDocumentIDs.last { editorRoot == nil || FileSystem.isWithin($0, editorRoot!) }
                }
                if document.isDirty { status = "已关闭标签；草稿保留在本机，重新打开可继续编辑" }
            } catch { self.error = error.localizedDescription }
        }
    }
    func refreshFileList() {
        if let root = editorRoot { fileList = index.entries.first(where: { $0.sourcePath == root && $0.kind == .skill })?.package?.files ?? FileSystem.manifest(root).files }
    }
    func changed(_ document: EditorDocument) {
        document.savedDraft = false
        let key = document.id
        draftTasks[key]?.cancel()
        let draft = EditorDraft(original: document.original, text: document.text)
        draftTasks[key] = Task {
            do {
                try await Task.sleep(for: .milliseconds(280))
                try await drafts.save(draft)
                guard !Task.isCancelled, document.text == draft.text else { return }
                document.savedDraft = true
                validate(document)
            } catch is CancellationError { /* more typing */ }
            catch { self.error = "无法保存草稿：\(error.localizedDescription)" }
        }
    }
    func validate(_ document: EditorDocument) {
        let text = document.text, path = document.path, root = document.packageRoot
        Task {
            let (problems, headings) = await Task.detached {
                (SkillValidator.validateDocument(text, path: path, packageRoot: root),
                 path.lowercased().hasSuffix(".md") ? SkillValidator.headings(in: text) : [])
            }.value
            if document.text == text { document.problems = problems; document.headings = headings }
        }
    }
    func setMetadata(_ field: String, _ value: String) {
        guard let document = activeDocument else { return }
        do { document.text = try SkillValidator.setField(field, value: value, in: document.text); changed(document) }
        catch { self.error = error.localizedDescription }
    }
    func save(all: Bool = false) {
        let docs = all ? openDocumentIDs.compactMap { documents[$0] }.filter(\.isDirty) : [activeDocument].compactMap { $0 }.filter(\.isDirty)
        guard !docs.isEmpty, !saving else { return }
        if let conflict = docs.first(where: { $0.conflict || !$0.original.matchesCurrent() }) { showConflict(conflict); return }
        for document in docs {
            let problems = SkillValidator.validateDocument(document.text, path: document.path, packageRoot: document.packageRoot)
            document.problems = problems
            if !index.consumers(of: document.packageRoot ?? document.path).isEmpty && problems.contains(where: { $0.severity == .error }) {
                error = "请先修复必需格式错误。草稿已保留，尚未写入共享配置。"; return
            }
        }
        let set = ChangeSet(title: docs.count == 1 ? "保存 \((docs[0].path as NSString).lastPathComponent)" : "保存全部文档",
            changes: docs.map { FileChange(before: $0.original, after: .file(Data($0.text.utf8), mode: $0.original.payload.mode), affectedConsumers: index.consumers(of: $0.packageRoot ?? $0.path).map(\.title)) })
        apply(set)
    }
    func review(_ set: ChangeSet, openAfter: String? = nil) { pendingChanges = set; pendingOpenPath = openAfter; sheet = .changes }
    func apply(_ set: ChangeSet) {
        guard !saving else { return }
        let affected = documents.values.filter { document in set.changes.contains { $0.before.target == document.original.target } }
        if let dirty = affected.first(where: { document in
            document.isDirty && !set.changes.contains { $0.before.target == document.original.target && $0.after.data == Data(document.text.utf8) }
        }) {
            error = "变更涉及未保存草稿，请先保存或合并：\((dirty.path as NSString).lastPathComponent)"; return
        }
        let submitted = Dictionary(uniqueKeysWithValues: affected.map { ($0.id, $0.text) })
        saving = true
        Task {
            do {
                let receipt = try await transactions.apply(set)
                history.insert(receipt, at: 0)
                for document in affected {
                    draftTasks[document.id]?.cancel()
                    if let position = set.changes.firstIndex(where: { $0.before.target == document.original.target }),
                       let applied = receipt.appliedVersions[position], let data = applied.payload.data,
                       let text = String(data: data, encoding: .utf8) {
                        // Preserve input typed while the actor was writing the submitted snapshot.
                        if document.text == submitted[document.id] { document.text = text }
                        document.original = applied; document.conflict = !applied.matchesCurrent(); document.savedDraft = false
                        if document.isDirty { try await drafts.save(EditorDraft(original: applied, text: document.text)); document.savedDraft = true }
                        else { try await drafts.remove(document.original.target) }
                    } else if document.text == submitted[document.id] {
                        openDocumentIDs.removeAll { $0 == document.id }
                        documents.removeValue(forKey: document.id); editorViews.removeValue(forKey: document.id)
                        try await drafts.remove(document.original.target)
                    } else {
                        document.conflict = true
                        try await drafts.save(EditorDraft(original: document.original, text: document.text))
                    }
                }
                if let data = try? FileSystem.read(configPath), let saved = try? JSONDecoder().decode(WorkspaceConfiguration.self, from: data) { configuration = saved; synchronizeRegistry() }
                status = "已应用 \(set.changes.count) 项变更 · 可在 Workflow 撤销"
                saving = false; sheet = nil; pendingChanges = nil
                let openPath = pendingOpenPath; pendingOpenPath = nil
                rescan()
                if let openPath {
                    if (openPath as NSString).lastPathComponent == "SKILL.md" {
                        editorRoot = (openPath as NSString).deletingLastPathComponent
                        selectedEntryID = editorRoot; page = .skills
                    }
                    openDocument(openPath)
                }
            } catch { saving = false; self.error = error.localizedDescription; await refreshOpenDocuments() }
        }
    }
    func undo(_ receipt: TransactionReceipt) {
        Task {
            do {
                _ = try await transactions.undo(receipt.id)
                history = try await transactions.history()
                if let data = try? FileSystem.read(configPath), let saved = try? JSONDecoder().decode(WorkspaceConfiguration.self, from: data) { configuration = saved; synchronizeRegistry() }
                rescan()
            } catch { self.error = error.localizedDescription }
        }
    }
    private func refreshOpenDocuments() async {
        guard !saving else { return }
        for document in documents.values {
            let path = document.path
            let current = try? await Task.detached { try FileVersion.capture(path) }.value
            guard let current, let data = current.payload.data, let text = String(data: data, encoding: .utf8) else { document.conflict = true; continue }
            if current.payload != document.original.payload || current.links != document.original.links || current.identity != document.original.identity {
                if document.isDirty { document.conflict = true }
                else { document.original = current; document.text = text; document.conflict = false; validate(document) }
            }
        }
    }
    func showConflict(_ document: EditorDocument) {
        document.conflict = true; conflictDocumentID = document.original.target
        comparisonTitle = "磁盘内容与草稿有冲突"
        comparisonBase = document.original.payload.data.map { String(decoding: $0, as: UTF8.self) }
        comparisonBefore = (try? FileSystem.text(document.path)) ?? "文件无法读取或已被移走"
        comparisonAfter = document.text; sheet = .comparison
    }
    func resolveConflict(text: String) {
        guard let id = conflictDocumentID, let document = documents[id] else { return }
        do {
            document.original = try .capture(document.path); document.text = text; document.conflict = false
            changed(document); sheet = nil; conflictDocumentID = nil
            status = "合并稿已保留；⌘S 审核并写入当前源文件"
        } catch { self.error = error.localizedDescription }
    }
    func compare(_ entry: ResourceEntry) {
        guard let source = entry.counterpart else { return }
        comparisonTitle = "\(entry.name) · 当前内容比较"
        comparisonBefore = (try? FileSystem.text(entry.documentPath)) ?? entry.package.map { $0.files.map { "\($0.relativePath)  \($0.hash ?? $0.link ?? "目录")" }.joined(separator: "\n") } ?? "不可读取"
        comparisonAfter = (try? FileSystem.text(entry.kind == .skill ? FileSystem.join(source, "SKILL.md") : source)) ?? "不可读取"
        comparisonBase = nil; conflictDocumentID = nil; sheet = .comparison
    }
    func selectSource(project: Bool = false) {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = true
        panel.prompt = project ? "添加项目" : "添加来源"
        guard panel.runModal() == .OK else { return }
        for url in panel.urls {
            if project { if !configuration.projects.contains(url.path) { configuration.projects.append(url.path) } }
            else if !configuration.sources.contains(url.path) { configuration.sources.append(url.path) }
        }
        saveConfiguration(); rescan()
    }
    func reveal(_ path: String) { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)]) }
    func withConfiguration(_ set: ChangeSet, bindings: [ManagedBinding], addingSource: String? = nil) throws -> ChangeSet {
        var config = configuration; config.bindings = bindings
        if let addingSource, !config.sources.contains(where: { FileSystem.isWithin(addingSource, $0) }) { config.sources.append(addingSource) }
        var set = set
        set.changes.append(FileChange(before: try .capture(configPath), after: .file(try JSONEncoder().encode(config), mode: 0o600)))
        return set
    }
    func linkInstruction(_ entry: ResourceEntry) {
        guard let source = entry.counterpart else { error = "请先添加可比较的 Workflow 来源，明确选择 AGENTS.md。"; return }
        let target = FileSystem.join(configuration.home, ".codex/AGENTS.md")
        do {
            let sourceVersion = try FileVersion.capture(source)
            guard sourceVersion.payload.kind == .file, sourceVersion.payload.data != nil else { throw WorkspaceError.message("所选 AGENTS.md 来源不可读取") }
            let change = FileChange(before: try .capture(target, followTarget: false), after: .symlink(source), affectedConsumers: ["Codex · 新会话"])
            let set = try FileTransactions.includingParents(ChangeSet(title: "建立 Codex 的 AGENTS.md 入口", changes: [change]))
            let bindings = configuration.bindings.filter { $0.target != target } + [ManagedBinding(source: source, target: target, mode: .link)]
            review(try withConfiguration(set, bindings: bindings))
        } catch { self.error = error.localizedDescription }
    }
    func synchronize(_ entry: ResourceEntry) {
        guard let source = entry.counterpart else { return }
        do {
            let set: ChangeSet
            if entry.kind == .skill {
                set = try PackageOperations.synchronize(source, to: entry.path)
                let digest = FileSystem.manifest(source).digest
                let binding = ManagedBinding(source: source, target: entry.path, mode: .copy, baseSource: digest, baseTarget: digest)
                review(try withConfiguration(set, bindings: configuration.bindings.filter { $0.target != entry.path } + [binding]))
            } else {
                let before = try FileVersion.capture(entry.path)
                let data = try FileVersion.capture(source).payload.data ?? Data()
                set = ChangeSet(title: "采用已比较的源内容", changes: [FileChange(before: before, after: .file(data, mode: before.payload.mode), affectedConsumers: entry.consumers.map(\.title))])
                let digest = FileSystem.hash(data)
                let binding = ManagedBinding(source: source, target: entry.path, mode: .copy, baseSource: digest, baseTarget: digest)
                review(try withConfiguration(set, bindings: configuration.bindings.filter { $0.target != entry.path } + [binding]))
            }
        } catch { self.error = error.localizedDescription }
    }

    func refreshCLI() async {
        guard let client = cli else { cliError = "应用包中缺少 CLI，请重新构建或选择已有 CLI。"; return }
        do {
            capabilities = try await client.json(["capabilities"])
            async let status = client.json(["config", "status"])
            async let list = client.json(["snapshot", "list"])
            let (current, saved) = try await (status, list)
            cliStatus = current; snapshots = saved.array; cliError = nil
            remoteTimeline = try await client.json(["snapshot", "timeline"])
            if let id = saved.array.first?["id"].string { environmentSnapshot = try await client.json(["snapshot", "show", id])["snapshot"] }
        } catch is CancellationError { /* Keep the last confirmed CLI status. */ }
        catch { cliError = error.localizedDescription }
    }
    func startJob(_ title: String, arguments: [String], client: CLIClient? = nil) {
        guard !jobs.contains(where: \.isRunning), let client = client ?? cli else { return }
        let job = CLIJob(title: title, arguments: arguments, client: client)
        let runner = ProcessRunner(); self.runner = runner; jobs.insert(job, at: 0)
        do { try persistJobs() }
        catch { job.finished = Date(); job.phase = "failed"; job.error = "无法保存任务记录：" + error.localizedDescription; return }
        jobTask = Task { [self] in
            await registryTask?.value
            do {
                _ = try await client.json(["capabilities"], runner: runner)
                try Task.checkCancellation()
                let result = try await client.job(arguments, id: job.id, runner: runner) { [weak self] line in
                    guard let event = try? JSONDecoder().decode(CLIEvent.self, from: line) else { return }
                    Task { @MainActor in self?.record(event, job: job) }
                }
                if result.cancelled {
                    job.phase = result.timedOut ? "timedOut" : "cancelled"
                    job.error = job.isUpload ? "上传状态待确认。保留快照 ID；取消本机任务不能撤销服务端可能已接收的数据。" : result.timedOut ? "任务超时，已停止 CLI。" : nil
                } else {
                    let events = try CLIClient.decodeEvents(result.stdout, jobID: job.id)
                    guard let last = events.last else { throw WorkspaceError.message("CLI 没有完成事件") }
                    if result.status != 0 || last.type == "error" { throw WorkspaceError.message(last.data["message"].string ?? "CLI 退出：\(result.status)") }
                    job.result = last.data
                    job.snapshotID = last.data["snapshotId"].string ?? last.data["snapshot"]["id"].string
                    let hasErrors = last.data["snapshot"]["collectors"].array.contains { !$0["errors"].array.isEmpty }
                    job.phase = hasErrors ? "partial" : "complete"
                }
                if !result.stderr.isEmpty { job.lines.append(String(result.stderr.suffix(12_000))) }
            } catch is CancellationError { job.phase = "cancelled"; job.error = job.isUpload ? "上传状态待确认；请核对快照 ID。" : nil }
            catch { job.phase = "failed"; job.error = error.localizedDescription }
            job.finished = Date(); self.runner = nil
            do { try persistJobs() } catch { self.error = "任务已结束，但记录保存失败：" + error.localizedDescription }
            if !Task.isCancelled { await refreshCLI(); rescan() }
        }
    }
    private func persistJobs() throws {
        try FileSystem.writePrivate(Array(jobs.prefix(100)).map(\.record), to: FileSystem.join(dataDirectory, "jobs.json"))
    }
    private func record(_ event: CLIEvent, job: CLIJob) {
        guard event.jobId == job.id, event.protocolVersion == 1, job.isRunning else { return }
        if event.type == "progress" {
            job.phase = event.data["phase"].string ?? "running"
            if let collector = event.data["collectorId"].string {
                if event.data["phase"].string == "completed" { job.completedCollectors.append(collector) }
                job.lines.append("\(collector) · \(event.data["phase"].string ?? "") · \(Int(event.data["files"].number ?? 0)) files")
            }
            job.lines = Array(job.lines.suffix(150))
        } else if event.type == "started" { job.phase = "running" }
        if let id = event.data["snapshotId"].string { job.snapshotID = id }
        do { try persistJobs() } catch { self.error = "任务进度保存失败：" + error.localizedDescription }
    }
    func cancelJob() { jobTask?.cancel(); Task { await runner?.cancel() } }
    func inspectSnapshot(_ snapshot: JSONValue) {
        guard let id = snapshot["id"].string, let client = cli else { return }
        Task {
            do { selectedSnapshot = try await client.json(["snapshot", "show", id]); reviewedClient = client; sheet = .snapshot }
            catch { self.error = error.localizedDescription }
        }
    }
    func uploadReviewedSnapshot() {
        guard let snapshot = selectedSnapshot, let id = snapshot["snapshot"]["id"].string, let digest = snapshot["sha256"].string, let client = reviewedClient else { return }
        sheet = nil; startJob("上传已审阅快照", arguments: ["backup", "--snapshot", id, "--snapshot-sha256", digest], client: client)
    }
    func compareSnapshots(_ older: JSONValue, _ newer: JSONValue) {
        guard let old = older["id"].string, let new = newer["id"].string, let client = cli else { return }
        Task {
            do {
                let diff = try await client.json(["snapshot", "diff", old, new])
                comparisonTitle = "快照内容差异 · \(old.prefix(8)) → \(new.prefix(8))"
                comparisonBefore = "比较文件实际内容、软件版本与元数据。\n\n\(diff["coverageWarning"].string ?? "")\n新增采集器：\(diff["addedCollectors"].pretty)\n移除采集器：\(diff["removedCollectors"].pretty)"
                comparisonAfter = diff["collectors"].pretty; comparisonBase = nil; conflictDocumentID = nil; sheet = .comparison
            } catch { self.error = error.localizedDescription }
        }
    }
    func flushDrafts() async throws {
        for document in documents.values where document.isDirty { try await drafts.save(EditorDraft(original: document.original, text: document.text)) }
    }
}
