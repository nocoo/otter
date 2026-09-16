import Foundation
import TOMLKit
import Yams

/// A bounded scan of documented entry points. No project or skill code is executed.
public struct WorkspaceScanner: Sendable {
    public init() {}
    public func scan(_ configuration: WorkspaceConfiguration, searchPath: [String]? = nil) throws -> WorkspaceIndex {
        let start = Date()
        let home = configuration.home
        var index = WorkspaceIndex()
        var entries: [String: ResourceEntry] = [:]
        var roots = Set<String>()
        var enumerated = 0
        var manifests: [String: PackageManifest] = [:]
        let sources = configuration.sources.map { FileSystem.resolve($0).finalPath ?? $0 }
        let canonicalHome = FileSystem.resolve(home).finalPath ?? home

        func source(for path: String) -> String? { sources.sorted { $0.count > $1.count }.first { FileSystem.isWithin(path, $0) } }
        func resourceLinks(_ resolution: PathResolution) -> [LinkHop] {
            resolution.links.filter { hop in
                FileSystem.isWithin(hop.path, home) || FileSystem.isWithin(hop.path, canonicalHome)
                || configuration.sources.contains { FileSystem.isWithin(hop.path, $0) } || sources.contains { FileSystem.isWithin(hop.path, $0) }
            }
        }
        func add(_ path: String, kind: ResourceKind, consumers: [Consumer], reference: Bool = false) throws {
            try Task.checkCancellation()
            if var existing = entries[path] {
                existing.consumers = Array(Set(existing.consumers + consumers)).sorted { $0.id < $1.id }
                entries[path] = existing; return
            }
            var resolved = FileSystem.resolve(path, hashContent: kind != .skill)
            if resolved.status == .missing && resourceLinks(resolved).isEmpty { return }
            var entry = ResourceEntry(path: path, kind: kind, name: (path as NSString).lastPathComponent,
                resolution: resolved, relationship: .independent, consumers: consumers)
            if resolved.status != .readable {
                entry.relationship = .broken
                entry.problems = [WorkspaceProblem("link.\(resolved.status.rawValue)", resolved.error ?? "入口不可读取", path: path)]
            } else if let final = resolved.finalPath {
                entry.sourceRoot = source(for: final)
                // /var → /private/var is filesystem plumbing, not resource provenance.
                entry.relationship = reference ? .configurationReference : !resourceLinks(resolved).isEmpty ? .symlink : resolved.kind == .file && (resolved.linkCount ?? 0) > 1 ? .hardlink : entry.sourceRoot != nil ? .source : .independent
                roots.insert((path as NSString).deletingLastPathComponent)
                roots.insert((final as NSString).deletingLastPathComponent)
                if kind == .skill {
                    let manifest = manifests[final] ?? FileSystem.manifest(path)
                    manifests[final] = manifest
                    entry.package = manifest; entry.problems += manifest.problems
                    roots.insert(final)
                    if let text = try? FileSystem.text(FileSystem.join(path, "SKILL.md")) {
                        let metadata = SkillValidator.inspect(text, path: FileSystem.join(path, "SKILL.md"), directoryName: (final as NSString).lastPathComponent)
                        entry.name = metadata.fields["name"] ?? entry.name
                        entry.summary = metadata.fields["description"] ?? ""
                        entry.problems += metadata.problems
                    } else {
                        entry.problems.append(WorkspaceProblem("skill.unreadable", "无法读取 SKILL.md", path: path))
                    }
                } else if resolved.kind == .file {
                    do {
                        let text = try FileSystem.text(path)
                        // Index only metadata; configuration secrets are not copied into summaries.
                        if kind == .command { entry.summary = SkillValidator.inspect(text, path: path, requireSkill: false).fields["description"] ?? "" }
                        entry.problems += SkillValidator.validateDocument(text, path: path)
                    } catch {
                        resolved.status = .ioError; entry.resolution = resolved
                        entry.problems.append(WorkspaceProblem("file.unreadable", error.localizedDescription, path: path))
                    }
                }
            }
            entries[path] = entry
        }

        func skillRoot(_ root: String, consumers: [Consumer], reference: Bool = false) throws {
            roots.insert(root)
            func visit(_ path: String, ancestry: Set<String>, depth: Int) throws {
                try Task.checkCancellation()
                enumerated += 1
                guard enumerated <= 30_000, depth <= 24 else { throw WorkspaceError.message("扫描达到 30,000 项或 24 层限制：\(path)") }
                let resolution = FileSystem.resolve(path)
                if resolution.status != .readable {
                    if !resourceLinks(resolution).isEmpty { try add(path, kind: .skill, consumers: consumers) }
                    else if resolution.status != .missing { index.problems.append(WorkspaceProblem("scan.\(resolution.status.rawValue)", resolution.error ?? "目录不可读取", path: path)) }
                    return
                }
                guard resolution.kind == .directory, let final = resolution.finalPath else { return }
                guard !ancestry.contains(final) else {
                    index.problems.append(WorkspaceProblem("scan.cycle", "目录链接形成循环", path: path)); return
                }
                if FileSystem.resolve(FileSystem.join(path, "SKILL.md")).status != .missing {
                    try add(path, kind: .skill, consumers: consumers, reference: reference); return
                }
                let next = ancestry.union([final])
                do {
                    for name in try FileSystem.children(path) where ![".git", "node_modules", "cache", ".cache"].contains(name) {
                        try visit(FileSystem.join(path, name), ancestry: next, depth: depth + 1)
                    }
                } catch is CancellationError { throw CancellationError() }
                catch { index.isComplete = false; index.problems.append(WorkspaceProblem("scan.directory", error.localizedDescription, path: path)) }
            }
            try visit(root, ancestry: [], depth: 0)
        }

        func files(_ root: String, kind: ResourceKind, consumers: [Consumer], depth: Int = 0, ancestry: Set<String> = []) throws {
            roots.insert(root)
            guard depth <= 12 else { index.isComplete = false; return }
            let resolution = FileSystem.resolve(root)
            guard let final = resolution.finalPath, resolution.kind == .directory else {
                if !resolution.links.isEmpty { try add(root, kind: kind, consumers: consumers) }; return
            }
            guard !ancestry.contains(final) else { index.problems.append(WorkspaceProblem("scan.cycle", "目录链接形成循环", path: root)); return }
            do {
                for name in try FileSystem.children(root) where !name.hasPrefix(".") && name != "node_modules" {
                    enumerated += 1
                    guard enumerated <= 30_000 else { throw WorkspaceError.message("扫描达到项目数量限制") }
                    let path = FileSystem.join(root, name)
                    let item = FileSystem.resolve(path)
                    if item.kind == .directory { try files(path, kind: kind, consumers: consumers, depth: depth + 1, ancestry: ancestry.union([final])) }
                    else { try add(path, kind: kind, consumers: consumers) }
                }
            } catch is CancellationError { throw CancellationError() }
            catch { index.isComplete = false; index.problems.append(WorkspaceProblem("scan.directory", error.localizedDescription, path: root)) }
        }

        func homeFile(_ relative: String, _ kind: ResourceKind, _ harness: Harness) throws {
            try add(FileSystem.join(home, relative), kind: kind, consumers: [Consumer(harness)])
        }
        let configurations: [(Harness, String, [String])] = [
            (.claude, ".claude", ["settings.json", "settings.local.json"]),
            (.codex, ".codex", ["config.toml"]),
            (.grok, ".grok", ["config.toml"]),
            (.pi, ".pi/agent", ["settings.json"]),
            (.opencode, ".config/opencode", ["opencode.json", "opencode.jsonc"]),
            (.gemini, ".gemini", ["settings.json"]),
        ]
        for (harness, folder, names) in configurations {
            let root = FileSystem.join(home, folder)
            roots.insert(root)
            for name in names { try homeFile(FileSystem.join(folder, name), .configuration, harness) }
            try skillRoot(FileSystem.join(root, "skills"), consumers: [Consumer(harness)])
            try files(FileSystem.join(root, harness == .pi ? "prompts" : "commands"), kind: .command, consumers: [Consumer(harness)])
            try files(FileSystem.join(root, "rules"), kind: .rule, consumers: [Consumer(harness)])
            try files(FileSystem.join(root, "hooks"), kind: .hook, consumers: [Consumer(harness)])
        }
        for (harness, path) in [(Harness.claude, ".claude/CLAUDE.md"), (.codex, ".codex/AGENTS.md"), (.codex, ".codex/AGENTS.override.md"),
                                (.codex, ".codex/instructions.md"), (.grok, ".grok/AGENTS.md"), (.pi, ".pi/agent/AGENTS.md"),
                                (.opencode, ".config/opencode/AGENTS.md"), (.gemini, ".gemini/GEMINI.md")] {
            try homeFile(path, .instruction, harness)
        }
        try files(FileSystem.join(home, ".codex/prompts"), kind: .command, consumers: [Consumer(.codex)])

        let grok = Self.toml(at: FileSystem.join(home, ".grok/config.toml"))
        let compatibility = (grok?["compat"] as? [String: Any])?["claude"] as? [String: Any]
        let grokUsesClaude = compatibility?["skills"] as? Bool != false
        let shared = [Consumer(.codex), Consumer(.pi), Consumer(.opencode)] + (grokUsesClaude ? [Consumer(.grok)] : [])
        try skillRoot(FileSystem.join(home, ".agents/skills"), consumers: shared)
        if grokUsesClaude {
            try skillRoot(FileSystem.join(home, ".claude/skills"), consumers: [Consumer(.grok)])
            try files(FileSystem.join(home, ".claude/commands"), kind: .command, consumers: [Consumer(.grok)])
        }
        if compatibility?["agents"] as? Bool != false { try add(FileSystem.join(home, ".claude/CLAUDE.md"), kind: .instruction, consumers: [Consumer(.grok)]) }

        let hermesRoot = FileSystem.join(home, ".hermes")
        var profiles = [("default", hermesRoot)]
        if let names = try? FileSystem.children(FileSystem.join(hermesRoot, "profiles")) {
            profiles += names.map { ($0, FileSystem.join(hermesRoot, "profiles/\($0)")) }.filter { FileSystem.resolve($0.1).kind == .directory }
        }
        for (profile, root) in profiles {
            let consumer = Consumer(.hermes, profile: profile)
            for name in ["config.yaml", "SOUL.md", "memories/MEMORY.md", "memories/USER.md", "cron/jobs.json"] {
                try add(FileSystem.join(root, name), kind: name.hasSuffix(".md") ? .instruction : .configuration, consumers: [consumer])
            }
            try skillRoot(FileSystem.join(root, "skills"), consumers: [consumer])
            if let config = Self.yaml(at: FileSystem.join(root, "config.yaml")),
               let skills = config["skills"] as? [String: Any], let external = skills["external_dirs"] as? [String] {
                for path in external {
                    let expanded = Self.expand(path, home: home, relativeTo: root)
                    try skillRoot(expanded, consumers: [consumer], reference: true)
                }
            }
        }

        for root in configuration.sources {
            roots.insert(root)
            if FileSystem.resolve(root).status != .readable {
                index.problems.append(WorkspaceProblem("source.unavailable", "来源目录不可读取，未把其资源判断为已删除", path: root)); index.isComplete = false; continue
            }
            for path in ["agents/skills", "agents/command-skills", "hermes/skills", "skills"] { try skillRoot(FileSystem.join(root, path), consumers: []) }
            try add(FileSystem.join(root, "agents/AGENTS.md"), kind: .instruction, consumers: [])
            try files(FileSystem.join(root, "agents/commands"), kind: .command, consumers: [])
            try files(FileSystem.join(root, "agents/rules"), kind: .rule, consumers: [])
            if FileSystem.resolve(FileSystem.join(root, "SKILL.md")).status == .readable { try add(root, kind: .skill, consumers: []) }
        }

        // Only selected projects, their ancestors and known hidden entry points; never walk a repository.
        for project in configuration.projects {
            var directory = project
            var ancestors: [String] = []
            while directory != "/" && directory != home && ancestors.count < 24 {
                ancestors.append(directory); directory = (directory as NSString).deletingLastPathComponent
            }
            for ancestor in ancestors.reversed() {
                for (name, hosts) in [("CLAUDE.md", [Harness.claude, .grok]), ("AGENTS.md", [.codex, .pi, .grok, .opencode]), ("AGENTS.override.md", [.codex]), ("GEMINI.md", [.gemini])] {
                    try add(FileSystem.join(ancestor, name), kind: .instruction, consumers: hosts.map { Consumer($0, scope: "项目", cwd: project) })
                }
            }
            try skillRoot(FileSystem.join(project, ".agents/skills"), consumers: shared.map { Consumer($0.harness, scope: "项目", cwd: project) })
            for (host, folder) in [(Harness.claude, ".claude"), (.codex, ".codex"), (.grok, ".grok"), (.gemini, ".gemini")] {
                let consumers = [Consumer(host, scope: "项目", cwd: project)]
                try skillRoot(FileSystem.join(project, folder + "/skills"), consumers: consumers)
                try files(FileSystem.join(project, folder + "/commands"), kind: .command, consumers: consumers)
                try files(FileSystem.join(project, folder + "/rules"), kind: .rule, consumers: consumers)
            }
        }

        try Self.scanClaudePlugins(home: home, addSkills: skillRoot, addFiles: files)
        let codexConfig = Self.toml(at: FileSystem.join(home, ".codex/config.toml"))
        if let override = codexConfig?["model_instructions_file"] as? String {
            var consumer = Consumer(.codex, scope: "显式配置")
            consumer.evidence = "config.toml 的 model_instructions_file 指向此文件；它替换基础指令，不等同于 AGENTS.md。新会话加载仍待验证。"
            try add(Self.expand(override, home: home, relativeTo: FileSystem.join(home, ".codex")), kind: .instruction, consumers: [consumer], reference: true)
        }
        let skillsConfig = (codexConfig?["skills"] as? [String: Any])?["config"] as? [[String: Any]] ?? []
        for path in entries.keys.sorted() {
            guard var entry = entries[path] else { continue }
            for position in entry.consumers.indices {
                if entry.consumers[position].harness == .codex {
                    if path.contains("/.codex/prompts/") || path == FileSystem.join(home, ".codex/instructions.md") {
                        entry.consumers[position].discovery = .unsupported
                        entry.consumers[position].evidence = "旧入口不证明当前 Codex 会加载；核对 AGENTS.md 和显式配置。"
                        if path.hasSuffix("/instructions.md") && codexConfig?["model_instructions_file"] == nil {
                            entry.problems.append(WorkspaceProblem("codex.legacy-instructions", "instructions.md 没有已知的默认加载入口", path: path, severity: .warning,
                                detail: "分别比较内容与建立 AGENTS.md 入口；不要用 model_instructions_file 替换 Codex 内置指令。"))
                        }
                    }
                    if skillsConfig.contains(where: { item in
                        guard item["enabled"] as? Bool == false, let disabledPath = item["path"] as? String else { return false }
                        let target = FileSystem.resolve(Self.expand(disabledPath, home: home, relativeTo: home)).finalPath
                        return target != nil && (target == entry.resolution.finalPath || target == FileSystem.resolve(entry.documentPath).finalPath)
                    }) { entry.consumers[position].discovery = .disabled; entry.consumers[position].evidence = "config.toml 的 skills.config 明确禁用此路径。" }
                }
            }
            entries[path] = entry
        }

        for binding in configuration.bindings {
            if entries[binding.target] == nil {
                let kind = entries[binding.source]?.kind ?? (FileSystem.resolve(binding.source).kind == .directory ? .skill : .instruction)
                try add(binding.target, kind: kind, consumers: [])
                if entries[binding.target] == nil { index.problems.append(WorkspaceProblem("binding.missing", "已登记的入口缺失", path: binding.target, detail: binding.source)); continue }
            }
            guard var target = entries[binding.target] else { continue }
            let upstream = entries[binding.source]?.digest ?? (FileSystem.resolve(binding.source).kind == .directory ? FileSystem.manifest(binding.source).digest : FileSystem.resolve(binding.source, hashContent: true).contentHash)
            target.counterpart = binding.source
            if binding.mode == .fork { target.relationship = .fork }
            else if binding.mode == .copy {
                if let upstream, let local = target.digest {
                    target.relationship = upstream == local ? .managedCopy : upstream == binding.baseSource ? .localChanged : local == binding.baseTarget ? .sourceChanged : .bothChanged
                }
            } else if target.resolution.finalPath != FileSystem.resolve(binding.source).finalPath {
                target.problems.append(WorkspaceProblem("binding.redirected", "链接目标与登记来源不同", path: target.path, detail: binding.source))
            }
            entries[binding.target] = target
        }
        // Matching content describes the present, never an inferred copy history.
        let originals = entries.values.filter { $0.sourceRoot != nil && $0.consumers.isEmpty }.sorted { $0.path < $1.path }
        for path in entries.keys.sorted() {
            guard var entry = entries[path], entry.relationship == .independent else { continue }
            let candidates = originals.filter { $0.kind == entry.kind && $0.name == entry.name && $0.path != entry.path }
            guard candidates.count == 1, let candidate = candidates.first else {
                if candidates.count > 1 {
                    entry.problems.append(WorkspaceProblem("source.ambiguous", "有多个同名来源，请先确认对应关系", path: path, severity: .information))
                    entries[path] = entry
                }
                continue
            }
            entry.counterpart = candidate.path
            entry.relationship = entry.digest != nil && entry.digest == candidate.digest ? .equalContent : .unknownLineage
            entries[path] = entry
        }
        // Workflow's explicit recipe identifies a comparison candidate, not a copy history.
        let legacyPath = FileSystem.join(home, ".codex/instructions.md")
        let instructionSources = configuration.sources.map { FileSystem.join($0, "agents/AGENTS.md") }.filter { entries[$0] != nil }
        if var legacy = entries[legacyPath], legacy.counterpart == nil, instructionSources.count == 1 {
            legacy.counterpart = instructionSources[0]
            entries[legacyPath] = legacy
        }
        index.entries = entries.values.sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
        index.problems += index.entries.flatMap(\.problems)
        let search = searchPath ?? Self.defaultSearchPath(home: home)
        index.harnesses = Harness.allCases.map { harness in
            let paths = index.entries.filter { $0.consumers.contains(where: { $0.harness == harness }) }.map(\.path)
            return HarnessInstallation(id: harness, executable: Self.executable(harness.rawValue, search: search), configPaths: paths, resourceCount: paths.count)
        }
        index.watchedPaths = roots.sorted(); index.scannedAt = Date(); index.duration = Date().timeIntervalSince(start)
        return index
    }

    public static func defaultSearchPath(home: String) -> [String] {
        let inherited = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
        var seen = Set<String>()
        return (inherited + ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", FileSystem.join(home, ".local/bin"), FileSystem.join(home, ".bun/bin"), FileSystem.join(home, ".grok/bin"), FileSystem.join(home, ".hermes/bin"), FileSystem.join(home, ".hermes/venv/bin")]).filter { seen.insert($0).inserted }
    }
    public static func executable(_ name: String, search: [String]) -> String? {
        search.map { FileSystem.join($0, name) }.first { FileManager.default.isExecutableFile(atPath: $0) && FileSystem.resolve($0).kind == .file }
    }
    private static func expand(_ path: String, home: String, relativeTo: String) -> String {
        if path.hasPrefix("~/") { return FileSystem.join(home, String(path.dropFirst(2))) }
        return path.hasPrefix("/") ? path : FileSystem.join(relativeTo, path)
    }
    private static func toml(at path: String) -> [String: Any]? {
        guard let text = try? FileSystem.text(path), let table = try? TOMLTable(string: text),
              let data = table.convert(to: .json).data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
    private static func yaml(at path: String) -> [String: Any]? { (try? FileSystem.text(path)).flatMap { (try? Yams.load(yaml: $0)) as? [String: Any] } }

    private static func scanClaudePlugins(home: String,
        addSkills: (String, [Consumer], Bool) throws -> Void,
        addFiles: (String, ResourceKind, [Consumer], Int, Set<String>) throws -> Void) throws {
        let inventory = FileSystem.join(home, ".claude/plugins/installed_plugins.json")
        guard let text = try? FileSystem.text(inventory), let data = text.data(using: .utf8),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let plugins = object["plugins"] as? [String: [[String: Any]]] else { return }
        for (name, installations) in plugins.sorted(by: { $0.key < $1.key }) {
            for installed in installations {
                guard let path = installed["installPath"] as? String, path.hasPrefix("/") else { continue }
                var consumer = Consumer(.claude, scope: "插件 \(name)")
                consumer.evidence = "installed_plugins.json 登记了此安装；当前 profile 的启用与会话加载待验证。"
                try addSkills(FileSystem.join(path, "skills"), [consumer], true)
                try addFiles(FileSystem.join(path, "commands"), .command, [consumer], 0, [])
            }
        }
    }
}
