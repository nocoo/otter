import CryptoKit
import Darwin
import Foundation

public enum FileKind: String, Codable, Sendable { case file, directory, symlink, other }
public enum PathStatus: String, Codable, Sendable { case readable, missing, denied, cycle, invalid, ioError }
public struct LinkHop: Codable, Hashable, Sendable {
    public var path: String
    public var destination: String
}
public struct PathResolution: Codable, Equatable, Sendable {
    public var originalPath: String
    public var finalPath: String?
    public var links: [LinkHop]
    public var status: PathStatus
    public var kind: FileKind?
    public var device: Int64?
    public var inode: UInt64?
    public var linkCount: UInt64?
    public var mode: UInt16?
    public var size: Int64?
    public var contentHash: String?
    public var error: String?
    public var identity: String? {
        guard let device, let inode else { return nil }; return "\(device):\(inode)"
    }
}

public struct PackageFile: Codable, Sendable, Identifiable {
    public var id: String { relativePath }
    public var relativePath: String
    public var kind: FileKind
    public var size: Int64
    public var mode: UInt16
    public var hash: String?
    public var link: String?
    public var isExternal = false
}
public struct PackageManifest: Codable, Sendable {
    public var root: String
    public var files: [PackageFile]
    public var digest: String?
    public var problems: [WorkspaceProblem]
}

public enum FileSystem {
    public static let maximumTextBytes = 8 * 1024 * 1024
    public static func join(_ root: String, _ relative: String) -> String {
        (root as NSString).appendingPathComponent(relative)
    }
    public static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    public static func isWithin(_ path: String, _ root: String) -> Bool { path == root || path.hasPrefix(root.hasSuffix("/") ? root : root + "/") }
    public static func kind(_ info: stat) -> FileKind {
        switch info.st_mode & S_IFMT {
        case S_IFREG: .file
        case S_IFDIR: .directory
        case S_IFLNK: .symlink
        default: .other
        }
    }

    /// Resolve each component before processing '..'; preserve ancestor and chained link text.
    public static func resolve(_ path: String, hashContent: Bool = false) -> PathResolution {
        var result = PathResolution(originalPath: path, links: [], status: .readable)
        guard path.hasPrefix("/") else { result.status = .invalid; result.error = "需要绝对路径"; return result }
        var queue = path.split(separator: "/").map(String.init)
        var components: [String] = []
        var seen = Set<String>()
        var info = stat()
        while !queue.isEmpty {
            let component = queue.removeFirst()
            if component == "." { continue }
            if component == ".." { if !components.isEmpty { components.removeLast() }; continue }
            let candidate = "/" + (components + [component]).joined(separator: "/")
            guard lstat(candidate, &info) == 0 else {
                let code = errno
                result.status = code == ENOENT || code == ENOTDIR ? .missing : code == EACCES || code == EPERM ? .denied : code == ELOOP ? .cycle : .ioError
                result.error = "\(candidate): \(String(cString: strerror(code)))"
                return result
            }
            if kind(info) == .symlink {
                guard result.links.count < 40, seen.insert(candidate + "|" + queue.joined(separator: "/")).inserted else {
                    result.status = .cycle; result.error = "链接循环或超过 40 跳：\(candidate)"; return result
                }
                do {
                    let target = try FileManager.default.destinationOfSymbolicLink(atPath: candidate)
                    result.links.append(LinkHop(path: candidate, destination: target))
                    if target.hasPrefix("/") { components = [] }
                    queue = target.split(separator: "/").map(String.init) + queue
                } catch { result.status = .ioError; result.error = error.localizedDescription; return result }
            } else { components.append(component) }
        }
        let final = "/" + components.joined(separator: "/")
        guard lstat(final, &info) == 0 else { result.status = .ioError; result.error = "解析过程中路径已改变：\(final)"; return result }
        result.finalPath = final; result.kind = kind(info)
        result.device = Int64(info.st_dev); result.inode = UInt64(info.st_ino)
        result.mode = UInt16(info.st_mode & 0o7777); result.linkCount = UInt64(info.st_nlink); result.size = info.st_size
        if hashContent && result.kind == .file {
            do { result.contentHash = hash(try read(final)) }
            catch { result.status = .ioError; result.error = error.localizedDescription }
        }
        return result
    }

    /// No-follow open prevents a redirected final path or FIFO from blocking a read.
    public static func read(_ path: String, limit: Int = maximumTextBytes) throws -> Data {
        let descriptor = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard descriptor >= 0 else { throw WorkspaceError.message("无法读取 \(path)：\(String(cString: strerror(errno)))") }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0, kind(info) == .file, info.st_size <= limit else {
            throw WorkspaceError.message("文件类型不支持或超过 \(limit / 1024) KB：\(path)")
        }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let count = Darwin.read(descriptor, &buffer, buffer.count)
            if count < 0 { if errno == EINTR { continue }; throw WorkspaceError.message("读取失败：\(path)") }
            if count == 0 { break }
            guard data.count + count <= limit else { throw WorkspaceError.message("读取期间文件超过限制：\(path)") }
            data.append(contentsOf: buffer.prefix(count))
        }
        return data
    }
    public static func text(_ path: String) throws -> String {
        let resolution = resolve(path)
        guard resolution.status == .readable, let final = resolution.finalPath else { throw WorkspaceError.message(resolution.error ?? "文件不可读取") }
        guard let value = String(data: try read(final), encoding: .utf8) else { throw WorkspaceError.message("不是 UTF-8 文本：\(path)") }
        return value
    }
    public static func children(_ path: String) throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: path).sorted { $0.utf8.lexicographicallyPrecedes($1.utf8) }
    }

    public static func manifest(_ path: String) -> PackageManifest {
        let resolved = resolve(path)
        guard resolved.status == .readable, resolved.kind == .directory, let root = resolved.finalPath else {
            return PackageManifest(root: path, files: [], problems: [WorkspaceProblem("package.unreadable", resolved.error ?? "技能包不可读取", path: path)])
        }
        var result = PackageManifest(root: root, files: [], problems: [])
        var bytes: Int64 = 0
        func walk(_ relative: String, depth: Int) throws {
            guard depth <= 32, result.files.count < 10_000, bytes <= 128 * 1024 * 1024 else { throw WorkspaceError.message("技能包超过遍历限制（32 层、10,000 项或 128 MB）") }
            let current = relative.isEmpty ? root : join(root, relative)
            for name in try children(current) where ![".git", "node_modules", ".DS_Store"].contains(name) {
                try Task.checkCancellation()
                guard result.files.count < 10_000 else { throw WorkspaceError.message("技能包超过 10,000 项限制") }
                let childRelative = relative.isEmpty ? name : join(relative, name)
                let child = join(root, childRelative)
                var info = stat()
                guard lstat(child, &info) == 0 else { throw WorkspaceError.message("文件在扫描过程中消失：\(child)") }
                var item = PackageFile(relativePath: childRelative, kind: kind(info), size: info.st_size, mode: UInt16(info.st_mode & 0o7777))
                switch item.kind {
                case .file:
                    bytes += info.st_size
                    guard bytes <= 128 * 1024 * 1024 else { throw WorkspaceError.message("技能包超过 128 MB 限制") }
                    item.hash = hash(try read(child, limit: 32 * 1024 * 1024))
                case .symlink:
                    item.link = try FileManager.default.destinationOfSymbolicLink(atPath: child)
                    let link = resolve(child)
                    item.isExternal = link.finalPath.map { !isWithin($0, root) } ?? true
                    if link.status != .readable { result.problems.append(WorkspaceProblem("link.\(link.status.rawValue)", link.error ?? "链接无效", path: child)) }
                    else if item.isExternal { result.problems.append(WorkspaceProblem("package.external-link", "包内链接指向外部；导出和分发前请核对", path: child, severity: .warning)) }
                case .directory: break
                case .other: throw WorkspaceError.message("不支持设备、socket 或管道：\(child)")
                }
                result.files.append(item)
                if item.kind == .directory { try walk(childRelative, depth: depth + 1) }
            }
        }
        do {
            try walk("", depth: 0)
            result.files.sort { $0.relativePath.utf8.lexicographicallyPrecedes($1.relativePath.utf8) }
            let records = result.files.map { "\($0.relativePath)\0\($0.kind.rawValue)\0\($0.mode & 0o111)\0\($0.hash ?? $0.link ?? "")" }
            if !result.problems.contains(where: { $0.severity == .error }) { result.digest = hash(Data(records.joined(separator: "\0").utf8)) }
        } catch { result.problems.append(WorkspaceProblem("package.incomplete", error.localizedDescription, path: path)) }
        return result
    }

    public static func privateDirectory(_ path: String) throws {
        try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: path)
    }
    public static func writePrivate<T: Encodable>(_ value: T, to path: String) throws {
        try privateDirectory((path as NSString).deletingLastPathComponent)
        let data = try JSONEncoder().encode(value)
        try data.write(to: URL(fileURLWithPath: path), options: [.atomic, .completeFileProtectionUnlessOpen])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
    }
}
