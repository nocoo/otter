import Foundation

public struct RuntimeObservation: Sendable {
    public var version: String
    public var command: String
    public var supported: Bool
    public var paths: [String]
    public var disabledPaths: [String] = []
    public var date = Date()
    public var detail: String
}

public enum RuntimeDiscovery {
    public static func probe(_ harness: Harness, executable: String, cwd: String) async throws -> RuntimeObservation {
        let runner = ProcessRunner()
        let versionResult = try await runner.run(executable: executable, arguments: ["--version"], directory: cwd, timeout: 8, outputLimit: 64 * 1024)
        guard versionResult.status == 0, !versionResult.cancelled else { throw WorkspaceError.message("无法读取 \(harness.title) 版本") }
        let version = String(String(decoding: versionResult.stdout, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines).prefix(140))
        let semanticVersion = version.range(of: #"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?"#, options: .regularExpression).map { String(version[$0]) }
        if harness == .grok && semanticVersion == "1.0.30" {
            let result = try await runner.run(executable: executable, arguments: ["inspect", "--json"], directory: cwd, timeout: 15, outputLimit: 8 * 1024 * 1024)
            guard result.status == 0, !result.cancelled else { throw WorkspaceError.message("Grok 发现查询失败；没有修改运行时状态") }
            let json = try JSONDecoder().decode(JSONValue.self, from: result.stdout)
            guard case .array = json["skills"] else { throw WorkspaceError.message("Grok 返回了未知的发现格式") }
            return RuntimeObservation(version: version, command: "grok inspect --json", supported: true,
                paths: json["skills"].array.compactMap { $0["source"]["path"].string }, detail: "此路径未出现在本次 Grok 的 skills 列表中；保留待验证状态。")
        }
        if harness == .codex && semanticVersion == "0.154.0" {
            let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "development"
            let initialize = try jsonLine(["id": 1, "method": "initialize", "params": ["clientInfo": ["name": "otter-workspace", "version": appVersion], "capabilities": [:]]])
            let request = try jsonLine(["method": "initialized", "params": [:]]) + jsonLine(["id": 2, "method": "skills/list", "params": ["cwds": [cwd]]])
            let result = try await runner.run(executable: executable, arguments: ["app-server"], directory: cwd, input: initialize, timeout: 15, outputLimit: 8 * 1024 * 1024, conversation: { line in
                guard let message = try? JSONDecoder().decode(JSONValue.self, from: line) else { return .none }
                if message["id"].number == 1 { return message["error"] == .null ? .send(request) : .finish }
                return message["id"].number == 2 ? .finish : .none
            })
            guard result.status == 0, !result.cancelled, !result.timedOut else { throw WorkspaceError.message("Codex 发现查询未正常完成；保留待验证状态") }
            let messages = result.stdout.split(separator: 10).compactMap { try? JSONDecoder().decode(JSONValue.self, from: Data($0)) }
            guard let response = messages.first(where: { $0["id"].number == 2 }), response["error"] == .null,
                  case .array = response["result"]["data"] else { throw WorkspaceError.message("Codex 没有返回可验证的 skills/list 结果") }
            let skills = response["result"]["data"].array.flatMap { $0["skills"].array }
            return RuntimeObservation(version: version, command: "codex app-server · skills/list", supported: true,
                paths: skills.filter { $0["enabled"].bool != false }.compactMap { $0["path"].string },
                disabledPaths: skills.filter { $0["enabled"].bool == false }.compactMap { $0["path"].string },
                detail: "此路径未出现在本次 cwd 的 skills/list 中；不会推断已有会话的加载状态。")
        }
        return RuntimeObservation(version: version, command: "\(harness.rawValue) --version", supported: false, paths: [],
            detail: "\(harness.title) \(version)：当前 adapter 没有经过验证的只读发现接口，文件仍可编辑。")
    }
    private static func jsonLine(_ object: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: object) + Data([10]) }
}
