import AppKit
import OtterCore
import UniformTypeIdentifiers

extension WorkspaceStore {
    func jumpToLine(_ line: Int) {
        guard let editor else { return }
        let lines = editor.string.components(separatedBy: "\n")
        let offset = lines.prefix(max(0, line - 1)).reduce(0) { $0 + ($1 as NSString).length + 1 }
        let range = NSRange(location: min(offset, (editor.string as NSString).length), length: 0)
        editor.window?.makeFirstResponder(editor); editor.setSelectedRange(range); editor.scrollRangeToVisible(range)
    }
    func find(replace: Bool = false) {
        let item = NSMenuItem(); item.tag = replace ? NSTextFinder.Action.showReplaceInterface.rawValue : NSTextFinder.Action.showFindInterface.rawValue
        editor?.performFindPanelAction(item)
    }
    func newFile(relativePath: String, contents: String) {
        guard let root = editorRoot else { return }
        do {
            guard PackageOperations.validRelativePath(relativePath) else { throw WorkspaceError.message("使用包内相对路径，不包含 .. 或绝对路径") }
            let path = FileSystem.join(root, relativePath), before = try FileVersion.capture(path, followTarget: false)
            guard before.payload.kind == nil else { throw WorkspaceError.message("文件已存在，请从文件树打开") }
            let mode: UInt16 = relativePath.hasSuffix(".sh") ? 0o755 : 0o644
            let set = try FileTransactions.includingParents(ChangeSet(title: "新建 \(relativePath)", changes: [FileChange(before: before, after: .file(Data(contents.utf8), mode: mode))]))
            review(set, openAfter: path)
        } catch { self.error = error.localizedDescription }
    }
    func createSkill(name: String, description: String, source: String) {
        do {
            let target = FileSystem.join(source, FileManager.default.fileExists(atPath: FileSystem.join(source, "agents")) ? "agents/skills/\(name)" : "skills/\(name)")
            review(try PackageOperations.newSkill(at: target, name: name, description: description), openAfter: FileSystem.join(target, "SKILL.md"))
        } catch { self.error = error.localizedDescription }
    }
    func distribute(to selected: Set<String>) {
        guard let root = editorRoot else { return }
        do {
            guard !documents.values.contains(where: { FileSystem.isWithin($0.original.target, root) && $0.isDirty }) else { throw WorkspaceError.message("请先保存此技能包的全部文档，分发磁盘上的确定版本") }
            let choices = distributionTargets
            let paths = selected.sorted().compactMap { key in choices.first { $0.id == key }?.path }
            guard !paths.isEmpty else { return }
            let set = try PackageOperations.distribute(root, targets: paths, consumers: selected.sorted())
            let digest = FileSystem.manifest(root).digest
            let bindings = configuration.bindings.filter { !paths.contains($0.target) } + paths.map { ManagedBinding(source: root, target: $0, mode: .link, baseSource: digest, baseTarget: digest) }
            review(try withConfiguration(set, bindings: bindings))
        } catch { self.error = error.localizedDescription }
    }
    struct DistributionTarget: Identifiable { var id: String; var title: String; var path: String }
    var distributionTargets: [DistributionTarget] {
        let name = ((editorRoot ?? "skill") as NSString).lastPathComponent
        let home = configuration.home
        var targets = [
            DistributionTarget(id: "shared", title: "共享目录 · Codex / Grok / Pi / OpenCode", path: FileSystem.join(home, ".agents/skills/\(name)")),
            DistributionTarget(id: "claude", title: "Claude · 用户 Skills", path: FileSystem.join(home, ".claude/skills/\(name)")),
            DistributionTarget(id: "codex", title: "Codex · 专用目录", path: FileSystem.join(home, ".codex/skills/\(name)")),
            DistributionTarget(id: "hermes:default", title: "Hermes · default", path: FileSystem.join(home, ".hermes/skills/\(name)")),
        ]
        if let profiles = try? FileSystem.children(FileSystem.join(home, ".hermes/profiles")) {
            targets += profiles.filter { FileSystem.resolve(FileSystem.join(home, ".hermes/profiles/\($0)")).kind == .directory }.map {
                DistributionTarget(id: "hermes:\($0)", title: "Hermes · \($0)", path: FileSystem.join(home, ".hermes/profiles/\($0)/skills/\(name)"))
            }
        }
        return targets
    }
    func exportPackage() {
        guard let root = editorRoot else { return }
        let panel = NSSavePanel(); panel.nameFieldStringValue = (root as NSString).lastPathComponent + ".otterskill"
        panel.title = "导出完整技能包（含二进制资源与执行权限）"; panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task {
            do {
                let archive = try await Task.detached { try PackageOperations.archive(root) }.value
                let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
                let before = try FileVersion.capture(url.path, followTarget: false)
                review(ChangeSet(title: "导出 \((root as NSString).lastPathComponent)", changes: [FileChange(before: before, after: .file(try encoder.encode(archive), mode: 0o600))]))
            } catch { self.error = error.localizedDescription }
        }
    }
    func importPackage() {
        let panel = NSOpenPanel(); panel.canChooseFiles = false; panel.canChooseDirectories = true; panel.prompt = "选择技能包"
        guard panel.runModal() == .OK, let source = panel.url?.path else { return }
        let targetPanel = NSSavePanel(); targetPanel.title = "将技能包复制到新目录"; targetPanel.nameFieldStringValue = (source as NSString).lastPathComponent; targetPanel.canCreateDirectories = true
        guard targetPanel.runModal() == .OK, let target = targetPanel.url?.path else { return }
        do { review(try withConfiguration(PackageOperations.copy(source, to: target), bindings: configuration.bindings, addingSource: target), openAfter: FileSystem.join(target, "SKILL.md")) }
        catch { self.error = error.localizedDescription }
    }
    func importArchive() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.allowedContentTypes = [UTType(filenameExtension: "otterskill") ?? .data]
        guard panel.runModal() == .OK, let archivePath = panel.url?.path else { return }
        do {
            let archive = try JSONDecoder().decode(SkillArchive.self, from: FileSystem.read(archivePath, limit: 180 * 1024 * 1024))
            let target = NSSavePanel(); target.nameFieldStringValue = archive.name; target.title = "导入到新目录"; target.canCreateDirectories = true
            guard target.runModal() == .OK, let path = target.url?.path else { return }
            review(try withConfiguration(PackageOperations.importArchive(archive, to: path), bindings: configuration.bindings, addingSource: path), openAfter: FileSystem.join(path, "SKILL.md"))
        } catch { self.error = error.localizedDescription }
    }
    func forkPackage() {
        guard let root = editorRoot else { return }
        let panel = NSSavePanel(); panel.title = "复制为独立技能分叉"; panel.nameFieldStringValue = (root as NSString).lastPathComponent + "-local"; panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let target = panel.url?.path else { return }
        do {
            let set = try PackageOperations.copy(root, to: target, forkName: (target as NSString).lastPathComponent)
            let binding = ManagedBinding(source: root, target: target, mode: .fork, baseSource: FileSystem.manifest(root).digest)
            review(try withConfiguration(set, bindings: configuration.bindings + [binding], addingSource: target), openAfter: FileSystem.join(target, "SKILL.md"))
        } catch { self.error = error.localizedDescription }
    }
    func renamePackage(name: String) {
        guard let root = editorRoot else { return }
        do {
            guard !documents.values.contains(where: { FileSystem.isWithin($0.original.target, root) && $0.isDirty }) else { throw WorkspaceError.message("重命名前请保存此包的草稿") }
            let target = FileSystem.join((root as NSString).deletingLastPathComponent, name)
            let set = try PackageOperations.renamePackage(root, to: target, entries: index.entries)
            let bindings = configuration.bindings.map { original -> ManagedBinding in var copy = original; if original.source == root { copy.source = target }; return copy }
            review(try withConfiguration(set, bindings: bindings), openAfter: FileSystem.join(target, "SKILL.md"))
        } catch { self.error = error.localizedDescription }
    }
    func importResource() {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = true; panel.canChooseDirectories = false; panel.prompt = "加入 assets"
        guard panel.runModal() == .OK else { return }
        importResources(panel.urls)
    }
    func importResources(_ urls: [URL]) {
        guard let root = editorRoot, !urls.isEmpty else { return }
        do {
            var destinations = Set<String>()
            let changes = try urls.map { url -> FileChange in
                guard url.isFileURL else { throw WorkspaceError.message("请选择本机资源文件") }
                let destination = FileSystem.join(root, "assets/" + url.lastPathComponent)
                guard destinations.insert(destination).inserted else { throw WorkspaceError.message("所选资源中有同名文件，请先重命名") }
                let before = try FileVersion.capture(destination, followTarget: false)
                guard before.payload.kind == nil else { throw WorkspaceError.message("资源已存在：\(destination)") }
                let source = try FileVersion.capture(url.path)
                guard source.payload.kind == .file, let data = source.payload.data, data.count <= 32 * 1024 * 1024 else { throw WorkspaceError.message("资源需要是 32 MB 以内的普通文件") }
                return FileChange(before: before, after: source.payload)
            }
            review(try FileTransactions.includingParents(ChangeSet(title: "导入 \(changes.count) 个资源文件", changes: changes)))
        } catch { self.error = error.localizedDescription }
    }
    func renameFile(_ file: PackageFile) {
        guard let root = editorRoot else { return }
        let panel = NSSavePanel(); panel.directoryURL = URL(fileURLWithPath: (FileSystem.join(root, file.relativePath) as NSString).deletingLastPathComponent)
        panel.nameFieldStringValue = (file.relativePath as NSString).lastPathComponent; panel.title = "重命名包内文件并审阅引用"
        guard panel.runModal() == .OK, let target = panel.url?.path else { return }
        do { review(try PackageOperations.renameFile(FileSystem.join(root, file.relativePath), to: target, packageRoot: root), openAfter: target) }
        catch { self.error = error.localizedDescription }
    }
    func removeFile(_ file: PackageFile) {
        guard let root = editorRoot else { return }
        do {
            guard file.relativePath != "SKILL.md" else { throw WorkspaceError.message("SKILL.md 是包入口，不能单独移除。可编辑内容或将整个包移至独立来源。") }
            review(ChangeSet(title: "移除 \(file.relativePath)", changes: try PackageOperations.removeTree(FileSystem.join(root, file.relativePath))))
        } catch { self.error = error.localizedDescription }
    }
    func gitDiff() {
        guard let path = editorRoot ?? activeDocument?.original.target else { return }
        Task {
            do {
                let result = try await ProcessRunner().run(executable: "/usr/bin/git", arguments: ["--no-pager", "diff", "--no-ext-diff", "--no-textconv", "HEAD", "--", path], directory: editorRoot ?? (path as NSString).deletingLastPathComponent, timeout: 10, outputLimit: 2 * 1024 * 1024)
                guard result.status == 0 else { throw WorkspaceError.message("此路径不在可读取的 Git 仓库中") }
                comparisonTitle = "Git · HEAD 与工作区"
                comparisonBefore = path; comparisonAfter = result.stdout.isEmpty ? "已跟踪文件与 HEAD 没有差异；未跟踪文件请在 Finder / Git 工具查看。" : String(decoding: result.stdout, as: UTF8.self)
                comparisonBase = nil; conflictDocumentID = nil; sheet = .comparison
            } catch { self.error = error.localizedDescription }
        }
    }
    func chooseCLI() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.prompt = "使用此 Otter CLI"
        guard panel.runModal() == .OK, let path = panel.url?.path else { return }
        configuration.externalCLI = path; saveConfiguration(); Task { await refreshCLI() }
    }
    func installCLI() {
        guard let cli else { return }
        do {
            let target = FileSystem.join(dataDirectory, "bin/otter")
            let before = try FileVersion.capture(target, followTarget: false)
            guard before.payload.kind == nil else { throw WorkspaceError.message("命令行入口已存在：\(target)。保留现有版本；可直接使用内置 CLI，或在 Finder 中移走旧入口后重新安装。") }
            let data = try FileSystem.read(FileSystem.resolve(cli.executable).finalPath ?? cli.executable, limit: 128 * 1024 * 1024)
            review(try FileTransactions.includingParents(ChangeSet(title: "安装独立 Otter 命令行入口", changes: [FileChange(before: before, after: .file(data, mode: 0o755))])))
        } catch { self.error = error.localizedDescription }
    }
    func verifyRuntime(_ agent: HarnessInstallation) {
        guard let path = agent.executable, !isolated else { return }
        let cwd = configuration.selectedProject ?? configuration.home
        Task {
            do {
                let observation = try await RuntimeDiscovery.probe(agent.id, executable: path, cwd: cwd)
                if let index = index.harnesses.firstIndex(where: { $0.id == agent.id }) { self.index.harnesses[index].version = observation.version }
                for position in index.entries.indices where index.entries[position].kind == .skill {
                    for consumer in index.entries[position].consumers.indices where index.entries[position].consumers[consumer].harness == agent.id {
                        guard index.entries[position].consumers[consumer].cwd == nil || index.entries[position].consumers[consumer].cwd == cwd else { continue }
                        let entry = index.entries[position]
                        let match = observation.paths.contains { FileSystem.resolve($0).finalPath == FileSystem.resolve(entry.documentPath).finalPath || FileSystem.resolve($0).finalPath == entry.resolution.finalPath }
                        let disabled = observation.disabledPaths.contains { FileSystem.resolve($0).finalPath == FileSystem.resolve(entry.documentPath).finalPath || FileSystem.resolve($0).finalPath == entry.resolution.finalPath }
                        index.entries[position].consumers[consumer].discovery = disabled ? .disabled : match ? .discovered : observation.supported ? .unverified : .unsupported
                        index.entries[position].consumers[consumer].evidence = disabled ? "\(observation.version) · skills/list 报告此路径已禁用 · cwd: \(cwd)" : match ? "\(observation.version) · \(observation.command) · cwd: \(cwd) · \(observation.date.formatted())。仅代表这次新进程发现。" : observation.detail
                        index.entries[position].consumers[consumer].observedAt = observation.date
                    }
                }
                status = observation.supported ? "已取得 \(agent.id.title) 的只读发现结果" : observation.detail
            } catch { self.error = error.localizedDescription }
        }
    }
}
