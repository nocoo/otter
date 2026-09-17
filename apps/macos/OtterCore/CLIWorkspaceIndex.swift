import Foundation

/// CLI owns discovery and provenance. Native checks only inspect the already discovered files for editing.
public enum CLIWorkspaceIndex {
    public static func configuration(_ registry: JSONValue, merging current: WorkspaceConfiguration) throws -> WorkspaceConfiguration {
        guard registry["version"].number == 1 else { throw WorkspaceError.message("无法读取 CLI 的来源登记。") }
        var result = current
        result.sources = registry["sources"].array.compactMap { $0["path"].string }
        result.projects = registry["projects"].array.compactMap(\.string)
        result.bindings = try registry["bindings"].array.map { value in
            guard let id = value["id"].string, let source = value["source"].string, let target = value["target"].string,
                  let mode = ManagedBinding.Mode(rawValue: value["mode"].string ?? "") else { throw WorkspaceError.message("CLI 的入口绑定记录不完整。") }
            var binding = ManagedBinding(source: source, target: target, mode: mode, baseSource: value["baseSource"].string, baseTarget: value["baseTarget"].string)
            binding.id = id
            if let date = value["createdAt"].number { binding.createdAt = Date(timeIntervalSinceReferenceDate: date) }
            else if let text = value["createdAt"].string, let date = ISO8601DateFormatter().date(from: text) { binding.createdAt = date }
            else { binding.createdAt = current.bindings.first { $0.id == id }?.createdAt ?? Date(timeIntervalSinceReferenceDate: 0) }
            return binding
        }
        return result
    }
    public static func decode(_ value: JSONValue, configuration: WorkspaceConfiguration) throws -> WorkspaceIndex {
        let workspace = value["workspace"]
        guard workspace["schemaVersion"].number == 2 else { throw WorkspaceError.message("需要支持完整配置快照的 Otter 3.0 CLI；请升级外部 CLI 或切换内置版本。") }
        var index = WorkspaceIndex()
        index.isComplete = workspace["coverage"]["complete"].bool == true
        index.watchedPaths = workspace["roots"].array.flatMap { root -> [String] in
            guard let path = root["path"].string else { return [] }
            if case .array(let include) = root["include"] {
                return include.compactMap { $0.string.map { FileSystem.join(path, $0) } }
            }
            return [path]
        }
        index.scannedAt = ISO8601DateFormatter().date(from: workspace["observedAt"].string ?? "") ?? Date()
        let agents = workspace["agents"].array
        let roots = workspace["roots"].array
        var entries: [String: ResourceEntry] = [:]
        var manifests: [String: PackageManifest] = [:]
        for item in workspace["resources"].array {
            try Task.checkCancellation()
            guard let path = item["path"].string, let kind = ResourceKind(rawValue: item["kind"].string ?? "") else { continue }
            let resolution = FileSystem.resolve(path, hashContent: kind != .skill)
            let consumers = item["agentIds"].array.compactMap { id -> Consumer? in
                guard let agent = agents.first(where: { $0["id"] == id }), let harness = Harness(rawValue: agent["kind"].string ?? "") else { return nil }
                let evidence = item["discovery"].array.first { $0["agentId"] == id }
                let project = evidence?["cwd"].string ?? roots.first { $0["id"] == item["rootId"] && $0["role"].string == "project" }?["cwd"].string
                var consumer = Consumer(harness, scope: project == nil ? "用户" : "项目", profile: agent["profile"].string ?? "default", cwd: project)
                if evidence?["state"].string == "disabled" { consumer.discovery = .disabled; consumer.evidence = "配置中明确禁用此入口；内容仍纳入备份。" }
                if evidence?["state"].string == "unsupported" { consumer.discovery = .unsupported; consumer.evidence = "旧入口不证明当前 Agent 会加载；内容仍纳入备份。" }
                return consumer
            }
            var entry = ResourceEntry(path: path, kind: kind, name: item["name"].string ?? (path as NSString).lastPathComponent,
                resolution: resolution, relationship: Relationship(rawValue: item["relationship"].string ?? "") ?? .independent,
                counterpart: item["counterpart"].string, consumers: consumers)
            if path.hasSuffix("/instructions.md"), consumers.contains(where: { $0.harness == .codex && $0.discovery == .unsupported }),
               !roots.contains(where: { $0["id"].string == "codex:default:instructions" }) {
                entry.problems.append(WorkspaceProblem("codex.legacy-instructions", "instructions.md 没有已知的默认加载入口", path: path, severity: .warning,
                    detail: "可比较内容并审阅 AGENTS.md 入口；原有文件会保留。"))
            }
            if let source = roots.first(where: { $0["id"] == item["sourceId"] })?["path"].string { entry.sourceRoot = FileSystem.resolve(source).finalPath ?? source }
            if resolution.status != .readable { entry.relationship = .broken; entry.problems.append(WorkspaceProblem("link.unreadable", resolution.error ?? "入口不可读取", path: path)) }
            if let final = resolution.finalPath {
                index.watchedPaths.append(final)
                if kind == .skill {
                    let manifest = manifests[final] ?? FileSystem.manifest(path); manifests[final] = manifest
                    entry.package = manifest; entry.problems += manifest.problems
                    if let text = try? FileSystem.text(entry.documentPath) {
                        let metadata = SkillValidator.inspect(text, path: entry.documentPath, directoryName: (final as NSString).lastPathComponent)
                        entry.name = metadata.fields["name"] ?? entry.name; entry.summary = metadata.fields["description"] ?? ""; entry.problems += metadata.problems
                    } else { entry.problems.append(WorkspaceProblem("skill.unreadable", "无法读取 SKILL.md，已按普通文件包纳入备份范围", path: path)) }
                } else if let text = try? FileSystem.text(path) { entry.problems += SkillValidator.validateDocument(text, path: path) }
                if kind != .skill && (resolution.linkCount ?? 0) > 1 && entry.relationship == .independent { entry.relationship = .hardlink }
            }
            // Old editing checkpoints use native package manifests. Preserve their established baselines.
            if let binding = configuration.bindings.first(where: { $0.target == path }) {
                entry.counterpart = binding.source
                if binding.mode == .fork { entry.relationship = .fork }
                if binding.mode == .copy {
                    let sourceHash = kind == .skill ? FileSystem.manifest(binding.source).digest : FileSystem.resolve(binding.source, hashContent: true).contentHash
                    if let sourceHash, let local = entry.digest { entry.relationship = sourceHash == local ? .managedCopy : sourceHash == binding.baseSource ? .localChanged : local == binding.baseTarget ? .sourceChanged : .bothChanged }
                }
            }
            if var existing = entries[path] { existing.consumers = Array(Set(existing.consumers + entry.consumers)); entries[path] = existing }
            else { entries[path] = entry }
        }
        index.entries = entries.values.sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
        index.problems = index.entries.flatMap(\.problems)
        for issue in workspace["coverage"]["issues"].array where ["error", "limit", "unstable"].contains(issue["status"].string ?? "") {
            index.problems.append(WorkspaceProblem("capture.\(issue["status"].string ?? "error")", issue["reason"].string ?? "采集不完整", path: issue["path"].string ?? ""))
        }
        index.harnesses = Harness.allCases.map { harness in
            let matching = agents.filter { $0["kind"].string == harness.rawValue }
            return HarnessInstallation(id: harness, executable: matching.first?["executable"].string,
                configPaths: matching.compactMap { $0["configPath"].string }, version: matching.first?["version"].string,
                resourceCount: index.entries.filter { $0.consumers.contains { $0.harness == harness } }.count)
        }
        index.watchedPaths = Array(Set(index.watchedPaths)).sorted()
        return index
    }
}
