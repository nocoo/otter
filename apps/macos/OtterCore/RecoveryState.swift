import Foundation

/// Only task metadata is journaled; configuration contents remain in the CLI snapshot store.
public struct CLIJobRecord: Codable, Sendable {
    public var id: String
    public var title: String
    public var arguments: [String]
    public var command: String
    public var started: Date
    public var finished: Date?
    public var phase: String
    public var error: String?
    public var snapshotID: String?
    public init(id: String, title: String, arguments: [String], command: String, started: Date, finished: Date?, phase: String, error: String?, snapshotID: String?) {
        self.id = id; self.title = title; self.arguments = arguments; self.command = command
        self.started = started; self.finished = finished; self.phase = phase; self.error = error; self.snapshotID = snapshotID
    }
    public func recovered() -> CLIJobRecord {
        guard finished == nil else { return self }
        var record = self
        record.finished = Date(); record.phase = "interrupted"
        record.error = arguments.first == "backup" ? "上次上传未记录完成；请核对远端，或继续上传同一份本地快照。" : "上次任务未记录完成；已保存的本地快照仍可查看。"
        return record
    }
}

public enum SnapshotContent {
    public static func preview(_ file: JSONValue, in snapshot: JSONValue) throws -> String {
        var content = file["content"].string ?? ""
        if let reference = file["contentRef"].string {
            guard let source = snapshot["collectors"].array.flatMap({ $0["files"].array }).first(where: {
                $0["sha256"].string == reference && $0["contentRef"].string == nil
            }), file["sha256"] == source["sha256"], file["encoding"] == source["encoding"], file["sizeBytes"] == source["sizeBytes"] else {
                throw WorkspaceError.message("快照缺少引用的内容，无法预览或恢复此文件。")
            }
            content = source["content"].string ?? ""
        }
        if file["encoding"].string == "base64" { return "二进制资源 · \(Int(file["sizeBytes"].number ?? 0)) 字节\nSHA-256：\(file["sha256"].string ?? "")\n导出快照后可查看原始资源。" }
        if file["kind"].string == "directory" { return "目录" }
        return content.count > 250_000 ? String(content.prefix(250_000)) + "\n\n[预览前 250,000 字符；导出包含完整内容。]" : content
    }
}
