import Foundation
import Markdown

public struct SkillArchive: Codable, Sendable {
    public struct Item: Codable, Sendable { public var path: String; public var payload: FilePayload }
    public var version = 1
    public var name: String
    public var items: [Item]
}

public enum PackageOperations {
    public static func validRelativePath(_ path: String) -> Bool {
        !path.isEmpty && !path.hasPrefix("/") && !path.contains("\0") && !path.contains("\\")
        && path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." && $0 != ".git" }
    }
    public static func validName(_ name: String) -> Bool {
        name.count <= 64 && name.range(of: "^[a-z0-9]+(?:-[a-z0-9]+)*$", options: .regularExpression) != nil
    }
    public static func newSkill(at path: String, name: String, description: String) throws -> ChangeSet {
        guard validName(name) else { throw WorkspaceError.message("使用 1–64 位小写字母、数字与单个连字符命名") }
        guard FileSystem.resolve(path).status == .missing else { throw WorkspaceError.message("目标已存在：\(path)") }
        let description = String(decoding: try JSONEncoder().encode(description), as: UTF8.self)
        let text = "---\nname: \(name)\ndescription: \(description)\n---\n\n# \(name)\n\n## 使用方法\n\n在此编写步骤与约束。\n"
        return try FileTransactions.includingParents(ChangeSet(title: "创建 \(name)", changes: [FileChange(before: try .capture(FileSystem.join(path, "SKILL.md")), after: .file(Data(text.utf8)))]))
    }
    public static func archive(_ root: String) throws -> SkillArchive {
        let manifest = FileSystem.manifest(root)
        guard manifest.digest != nil else { throw WorkspaceError.message("技能包不完整，无法导出：\(root)") }
        guard !manifest.files.contains(where: \.isExternal) else { throw WorkspaceError.message("包中存在外部链接；先将所需资源加入包，再导出或复制") }
        let items = try manifest.files.map { item -> SkillArchive.Item in
            let version = try FileVersion.capture(FileSystem.join(manifest.root, item.relativePath), followTarget: false)
            return SkillArchive.Item(path: item.relativePath, payload: version.payload)
        }
        return SkillArchive(name: (root as NSString).lastPathComponent, items: items)
    }
    public static func importArchive(_ archive: SkillArchive, to target: String) throws -> ChangeSet {
        guard archive.version == 1, archive.items.count <= 10_000,
              archive.items.reduce(0, { $0 + ($1.payload.data?.count ?? 0) }) <= 128 * 1024 * 1024,
              Set(archive.items.map(\.path)).count == archive.items.count,
              archive.items.contains(where: { $0.path == "SKILL.md" && $0.payload.kind == .file }) else { throw WorkspaceError.message("技能归档格式无效或超过上限") }
        guard FileSystem.resolve(target).status == .missing else { throw WorkspaceError.message("导入目标已存在：\(target)") }
        var changes: [FileChange] = []
        let symlinks = archive.items.filter { $0.payload.kind == .symlink }.map(\.path)
        for item in archive.items.sorted(by: { $0.path < $1.path }) {
            guard validRelativePath(item.path), item.payload.kind != nil, item.payload.kind != .other,
                  !symlinks.contains(where: { item.path.hasPrefix($0 + "/") }) else { throw WorkspaceError.message("归档包含无效路径或链接下的文件：\(item.path)") }
            if let link = item.payload.link {
                let absolute = URL(fileURLWithPath: FileSystem.join((FileSystem.join(target, item.path) as NSString).deletingLastPathComponent, link)).standardizedFileURL.path
                guard !link.hasPrefix("/"), FileSystem.isWithin(absolute, target) else { throw WorkspaceError.message("归档链接指向包外：\(item.path)") }
            }
            var payload = item.payload
            // Imported packages never gain setuid/setgid/sticky bits.
            payload.mode &= 0o777
            changes.append(FileChange(before: try .capture(FileSystem.join(target, item.path), followTarget: false), after: payload))
        }
        return try FileTransactions.includingParents(ChangeSet(title: "导入 \(archive.name)", changes: changes))
    }
    public static func copy(_ root: String, to target: String, forkName: String? = nil) throws -> ChangeSet {
        var package = try archive(root)
        if let forkName {
            guard validName(forkName) else { throw WorkspaceError.message("分叉名称格式无效") }
            for index in package.items.indices where package.items[index].path == "SKILL.md" {
                guard let data = package.items[index].payload.data, let text = String(data: data, encoding: .utf8) else { throw WorkspaceError.message("SKILL.md 不是 UTF-8") }
                package.items[index].payload.data = Data(try SkillValidator.setField("name", value: forkName, in: text).utf8)
            }
            package.name = forkName
        }
        return try importArchive(package, to: target)
    }
    public static func distribute(_ root: String, targets: [String], consumers: [String] = []) throws -> ChangeSet {
        guard FileSystem.resolve(FileSystem.join(root, "SKILL.md")).status == .readable else { throw WorkspaceError.message("缺少 SKILL.md") }
        let manifest = FileSystem.manifest(root)
        guard manifest.digest != nil else { throw WorkspaceError.message("技能包不完整，不能分发") }
        for file in manifest.files where file.kind == .file && ["md", "yaml", "yml", "json", "toml"].contains((file.relativePath as NSString).pathExtension) {
            let path = FileSystem.join(root, file.relativePath)
            if let text = try? FileSystem.text(path), SkillValidator.validateDocument(text, path: path, packageRoot: root).contains(where: { $0.severity == .error }) {
                throw WorkspaceError.message("请先修复格式错误：\(file.relativePath)")
            }
        }
        let changes = try targets.map { path -> FileChange in
            let before = try FileVersion.capture(path, followTarget: false)
            guard before.payload.kind == nil || before.payload.kind == .symlink else { throw WorkspaceError.message("分发目标已有独立内容，请先比较：\(path)") }
            return FileChange(before: before, after: .symlink(FileSystem.resolve(root).finalPath ?? root), affectedConsumers: consumers)
        }
        return try FileTransactions.includingParents(ChangeSet(title: "分发 \((root as NSString).lastPathComponent)", changes: changes))
    }
    public static func removeTree(_ root: String) throws -> [FileChange] {
        let entry = try FileVersion.capture(root, followTarget: false)
        if entry.payload.kind != .directory { return [FileChange(before: entry, after: .absent)] }
        let manifest = FileSystem.manifest(root)
        guard manifest.digest != nil else { throw WorkspaceError.message("无法完整读取删除范围") }
        var changes = try manifest.files.sorted { $0.relativePath.count > $1.relativePath.count }.map {
            FileChange(before: try .capture(FileSystem.join(root, $0.relativePath), followTarget: false), after: .absent)
        }
        changes.append(FileChange(before: entry, after: .absent)); return changes
    }
    public static func renamePackage(_ root: String, to target: String, entries: [ResourceEntry]) throws -> ChangeSet {
        var set = try copy(root, to: target, forkName: (target as NSString).lastPathComponent)
        set.title = "重命名 \((root as NSString).lastPathComponent)"
        let canonical = FileSystem.resolve(root).finalPath ?? root
        var linkPaths = Set<String>()
        for entry in entries where entry.resolution.finalPath == canonical {
            guard let hop = entry.resolution.links.last(where: { FileSystem.resolve($0.path).finalPath == canonical }),
                  !FileSystem.isWithin(hop.path, canonical), linkPaths.insert(hop.path).inserted else { continue }
            set.changes.append(FileChange(before: try .capture(hop.path, followTarget: false), after: .symlink(target), affectedConsumers: entry.consumers.map(\.title)))
        }
        set.changes += try removeTree(canonical)
        return set
    }
    public static func renameFile(_ path: String, to target: String, packageRoot: String) throws -> ChangeSet {
        guard FileSystem.isWithin(target, packageRoot), FileSystem.resolve(target).status == .missing else { throw WorkspaceError.message("文件目标必须是包内尚不存在的路径") }
        let original = try FileVersion.capture(path, followTarget: false)
        guard original.payload.kind != .directory else { throw WorkspaceError.message("请逐个重命名目录中的文件") }
        var changes = [FileChange(before: try .capture(target, followTarget: false), after: original.payload), FileChange(before: original, after: .absent)]
        for item in FileSystem.manifest(packageRoot).files where item.kind == .file && item.relativePath.hasSuffix(".md") {
            let document = FileSystem.join(packageRoot, item.relativePath)
            guard document != path else { continue }
            let before = try FileVersion.capture(document)
            guard let bytes = before.payload.data, let text = String(data: bytes, encoding: .utf8) else { continue }
            let updated = try rewriteReferences(text, document: document, oldPath: path, newPath: target)
            if text != updated { changes.append(FileChange(before: before, after: .file(Data(updated.utf8), mode: before.payload.mode))) }
        }
        return try FileTransactions.includingParents(ChangeSet(title: "重命名文件并更新包内引用", changes: changes))
    }

    private static func rewriteReferences(_ text: String, document: String, oldPath: String, newPath: String) throws -> String {
        let references = SkillValidator.references(in: text).filter { reference in
            guard let path = SkillValidator.localReference(reference.destination, from: document),
                  FileSystem.resolve(path).finalPath == FileSystem.resolve(oldPath).finalPath else { return false }
            return true
        }
        var result = Data(text.utf8)
        var edits: [(Range<Int>, Data)] = []
        let base = (document as NSString).deletingLastPathComponent
        let components = base.split(separator: "/"), destination = newPath.split(separator: "/")
        let common = zip(components, destination).prefix { $0 == $1 }.count
        let relative = (Array(repeating: "..", count: components.count - common) + destination.dropFirst(common).map(String.init)).joined(separator: "/")
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "?#"))
        let encoded = relative.addingPercentEncoding(withAllowedCharacters: allowed) ?? relative
        for reference in references {
            guard let range = reference.utf8Range else { throw WorkspaceError.message("无法定位引用，请先在源码中更新：\(document):\(reference.line)") }
            let inline = String(decoding: result[range], as: UTF8.self)
            let old = reference.destination
            let suffix = old.firstIndex(where: { $0 == "?" || $0 == "#" }).map { String(old[$0...]) } ?? ""
            // Anchor to the AST node's final destination, never identical text in code or labels.
            let pattern = "\\]\\(<?(" + NSRegularExpression.escapedPattern(for: old) + ")(?=>?(?:\\s+[\"'][\\s\\S]*[\"'])?\\)$)"
            let regex = try NSRegularExpression(pattern: pattern)
            guard let match = regex.firstMatch(in: inline, range: NSRange(inline.startIndex..., in: inline)),
                  let destinationRange = Range(match.range(at: 1), in: inline) else {
                throw WorkspaceError.message("此引用使用定义或转义写法，请先更新源码再重命名：\(document):\(reference.line)")
            }
            let lower = range.lowerBound + inline[..<destinationRange.lowerBound].utf8.count
            let upper = lower + inline[destinationRange].utf8.count
            edits.append((lower..<upper, Data((encoded + suffix).utf8)))
        }
        for (range, replacement) in edits.sorted(by: { $0.0.lowerBound > $1.0.lowerBound }) { result.replaceSubrange(range, with: replacement) }
        return String(decoding: result, as: UTF8.self)
    }

    /// A complete, reviewable source snapshot; all target deletions are individually journaled.
    public static func synchronize(_ source: String, to target: String) throws -> ChangeSet {
        let targetVersion = try FileVersion.capture(target, followTarget: false)
        guard targetVersion.payload.kind == .directory,
              FileSystem.resolve(source).finalPath != targetVersion.target,
              !FileSystem.isWithin(targetVersion.target, FileSystem.resolve(source).finalPath ?? source),
              !FileSystem.isWithin(FileSystem.resolve(source).finalPath ?? source, targetVersion.target) else {
            throw WorkspaceError.message("同步需要两个独立、不互相包含的技能包目录")
        }
        let upstream = try archive(source), local = try archive(target)
        let desired = Dictionary(uniqueKeysWithValues: upstream.items.map { ($0.path, $0.payload) })
        let current = Dictionary(uniqueKeysWithValues: local.items.map { ($0.path, $0.payload) })
        var changes: [FileChange] = []
        for item in local.items.sorted(by: { $0.path.count > $1.path.count }) where desired[item.path] == nil {
            changes.append(FileChange(before: try .capture(FileSystem.join(target, item.path), followTarget: false), after: .absent))
        }
        for item in upstream.items.sorted(by: { $0.path < $1.path }) {
            if let previous = current[item.path] {
                guard (previous.kind == .directory) == (item.payload.kind == .directory) else {
                    throw WorkspaceError.message("文件与目录类型冲突，请先分叉或整理：\(item.path)")
                }
                if previous == item.payload { continue }
            }
            changes.append(FileChange(before: try .capture(FileSystem.join(target, item.path), followTarget: false), after: item.payload))
        }
        return try FileTransactions.includingParents(ChangeSet(title: "同步完整技能包 \((target as NSString).lastPathComponent)", changes: changes))
    }

    public static func replaceInPackage(_ root: String, find: String, replacement: String) throws -> ChangeSet {
        guard !find.isEmpty else { throw WorkspaceError.message("查找文本不能为空") }
        var changes: [FileChange] = []
        for item in FileSystem.manifest(root).files where item.kind == .file {
            let path = FileSystem.join(root, item.relativePath)
            guard let text = try? FileSystem.text(path), text.contains(find) else { continue }
            let before = try FileVersion.capture(path)
            let after = text.replacingOccurrences(of: find, with: replacement)
            changes.append(FileChange(before: before, after: .file(Data(after.utf8), mode: before.payload.mode)))
        }
        return ChangeSet(title: "替换包内 \(changes.count) 个文件", changes: changes)
    }
}
