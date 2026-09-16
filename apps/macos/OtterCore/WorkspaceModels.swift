import Foundation

public enum ResourceKind: String, Codable, Sendable, CaseIterable {
    case skill, instruction, command, rule, hook, configuration
    public var title: String {
        switch self {
        case .skill: "Skill"
        case .instruction: "指令"
        case .command: "Command"
        case .rule: "规则"
        case .hook: "Hook"
        case .configuration: "配置"
        }
    }
}

public enum Harness: String, Codable, Sendable, CaseIterable, Identifiable {
    case claude, codex, grok, pi, hermes, opencode, gemini
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .claude: "Claude Code"
        case .codex: "Codex"
        case .grok: "Grok"
        case .pi: "Pi"
        case .hermes: "Hermes"
        case .opencode: "OpenCode"
        case .gemini: "Gemini CLI"
        }
    }
    public var refreshAdvice: String { self == .pi ? "在 Pi 中执行 /reload；已有会话状态需单独核对。" : "启动新会话后核对发现结果；Otter 不重启正在运行的任务。" }
}

public enum DiscoveryState: String, Codable, Sendable {
    case unverified, discovered, disabled, overridden, unsupported, projectOnly
    public var title: String {
        switch self {
        case .unverified: "待验证"
        case .discovered: "新进程已发现"
        case .disabled: "已禁用"
        case .overridden: "被覆盖"
        case .unsupported: "接口未验证"
        case .projectOnly: "项目内 · 待验证"
        }
    }
}

public struct Consumer: Codable, Hashable, Sendable, Identifiable {
    public var harness: Harness
    public var scope: String
    public var profile: String
    public var cwd: String?
    public var discovery: DiscoveryState = .unverified
    public var evidence: String = "仅确认磁盘入口，尚未查询运行时。"
    public var observedAt: Date?
    public var id: String { "\(harness.rawValue):\(profile):\(scope):\(cwd ?? "")" }
    public var title: String { "\(harness.title) · \(profile == "default" ? scope : profile)" }
    public init(_ harness: Harness, scope: String = "用户", profile: String = "default", cwd: String? = nil) {
        self.harness = harness; self.scope = scope; self.profile = profile; self.cwd = cwd
        if cwd != nil { discovery = .projectOnly }
    }
}

public struct HarnessInstallation: Identifiable, Sendable {
    public var id: Harness
    public var executable: String?
    public var configPaths: [String]
    public var version: String?
    public var resourceCount: Int = 0
}

public enum Severity: String, Codable, Sendable { case error, warning, information }
public struct WorkspaceProblem: Codable, Hashable, Sendable, Identifiable {
    public var id: String { "\(rule):\(path):\(line):\(message)" }
    public var rule: String
    public var severity: Severity
    public var message: String
    public var path: String
    public var line: Int
    public var column: Int
    public var detail: String
    public init(_ rule: String, _ message: String, path: String, severity: Severity = .error, line: Int = 1, column: Int = 1, detail: String = "") {
        self.rule = rule; self.message = message; self.path = path; self.severity = severity
        self.line = line; self.column = column; self.detail = detail
    }
}

public enum Relationship: String, Codable, Sendable {
    case source, independent, symlink, hardlink, configurationReference, managedCopy, sourceChanged, localChanged, bothChanged, fork, equalContent, unknownLineage, broken
    public var title: String {
        switch self {
        case .source: "源文件"
        case .independent: "本机独立资源"
        case .symlink: "实时共享 · 链接"
        case .hardlink: "硬链接 · 共享文件身份"
        case .configurationReference: "实时共享 · 配置引用"
        case .managedCopy: "受管理副本 · 一致"
        case .sourceChanged: "源已更新"
        case .localChanged: "本地已修改"
        case .bothChanged: "两边已修改"
        case .fork: "已分叉"
        case .equalContent: "独立副本 · 内容一致"
        case .unknownLineage: "同名不同内容 · 来源待确认"
        case .broken: "入口不可读取"
        }
    }
}

public struct ResourceEntry: Sendable, Identifiable {
    public var id: String { path }
    public var path: String
    public var kind: ResourceKind
    public var name: String
    public var summary: String = ""
    public var resolution: PathResolution
    public var package: PackageManifest?
    public var sourceRoot: String?
    public var relationship: Relationship
    public var counterpart: String?
    public var consumers: [Consumer]
    public var problems: [WorkspaceProblem] = []
    public var digest: String? { package?.digest ?? resolution.contentHash }
    public var documentPath: String { kind == .skill ? FileSystem.join(path, "SKILL.md") : path }
    public var sourcePath: String { resolution.finalPath ?? path }
}

public struct ManagedBinding: Codable, Sendable, Identifiable {
    public enum Mode: String, Codable, Sendable { case link, copy, fork }
    public var id: String
    public var source: String
    public var target: String
    public var mode: Mode
    public var baseSource: String?
    public var baseTarget: String?
    public var createdAt: Date
    public init(source: String, target: String, mode: Mode, baseSource: String? = nil, baseTarget: String? = nil) {
        id = UUID().uuidString; self.source = source; self.target = target; self.mode = mode
        self.baseSource = baseSource; self.baseTarget = baseTarget; createdAt = Date()
    }
}

public struct WorkspaceConfiguration: Codable, Sendable {
    public var version = 1
    public var home: String
    public var sources: [String]
    public var projects: [String]
    public var bindings: [ManagedBinding] = []
    public var externalCLI: String?
    public var apiURL = "https://otter.worker.hexly.ai"
    public var cliConfigDirectory: String
    public var cliOutputDirectory: String
    public var development = false
    public var appearance = "system"
    public var editorFontSize = 13.0
    public var selectedProject: String?
    public init(home: String = FileManager.default.homeDirectoryForCurrentUser.path, sources: [String] = [], projects: [String] = []) {
        self.home = home; self.sources = sources; self.projects = projects
        cliConfigDirectory = FileSystem.join(home, ".config/otter")
        cliOutputDirectory = FileSystem.join(cliConfigDirectory, "snapshots")
    }
}

public struct WorkspaceIndex: Sendable {
    public var entries: [ResourceEntry] = []
    public var harnesses: [HarnessInstallation] = []
    public var problems: [WorkspaceProblem] = []
    public var watchedPaths: [String] = []
    public var scannedAt = Date()
    public var duration: TimeInterval = 0
    public var isComplete = true
    public init() {}
    public var skills: [ResourceEntry] { entries.filter { $0.kind == .skill } }
    public func consumers(of path: String) -> [Consumer] {
        let canonical = FileSystem.resolve(path).finalPath
        return Array(Set(entries.filter { $0.path == path || (canonical != nil && $0.resolution.finalPath == canonical) }
            .flatMap(\.consumers))).sorted { $0.id < $1.id }
    }
}

public enum WorkspaceError: LocalizedError, Sendable, Equatable {
    case message(String)
    public var errorDescription: String? { switch self { case .message(let text): text } }
}
