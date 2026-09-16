import Darwin
import Foundation

public struct FilePayload: Codable, Equatable, Sendable {
    public var kind: FileKind?
    public var data: Data?
    public var link: String?
    public var mode: UInt16
    public static var absent: Self { Self(mode: 0) }
    public static func file(_ data: Data, mode: UInt16 = 0o644) -> Self { Self(kind: .file, data: data, mode: mode) }
    public static func symlink(_ target: String) -> Self { Self(kind: .symlink, link: target, mode: 0o777) }
    public static func directory(mode: UInt16 = 0o755) -> Self { Self(kind: .directory, mode: mode) }
}

public struct FileVersion: Codable, Sendable {
    public var path: String
    public var target: String
    public var followTarget: Bool
    public var links: [LinkHop]
    public var identity: String?
    public var linkCount: UInt64
    public var payload: FilePayload
    public var anchor: String
    public var anchorIdentity: String?

    public static func capture(_ path: String, followTarget: Bool = true) throws -> Self {
        guard path.hasPrefix("/"), path != "/", !(path as NSString).lastPathComponent.isEmpty else { throw WorkspaceError.message("无效的文件目标") }
        let resolved = FileSystem.resolve(path)
        let parent = (path as NSString).deletingLastPathComponent
        var anchor = parent
        var anchorResolution = FileSystem.resolve(anchor)
        var missing: [String] = []
        while anchorResolution.status == .missing && anchor != "/" {
            missing.insert((anchor as NSString).lastPathComponent, at: 0)
            anchor = (anchor as NSString).deletingLastPathComponent
            anchorResolution = FileSystem.resolve(anchor)
        }
        guard anchorResolution.status == .readable, anchorResolution.kind == .directory, let canonicalAnchor = anchorResolution.finalPath else { throw WorkspaceError.message(anchorResolution.error ?? "目标父目录不可读取") }
        let entryTarget = (missing + [(path as NSString).lastPathComponent]).reduce(canonicalAnchor, FileSystem.join)
        var info = stat()
        let entryExists = lstat(entryTarget, &info) == 0
        let isEntryLink = entryExists && FileSystem.kind(info) == .symlink
        if followTarget && resolved.status != .readable && (isEntryLink || resolved.status != .missing) {
            throw WorkspaceError.message(resolved.error ?? "链接目标不可读取")
        }
        let target = followTarget ? resolved.finalPath ?? entryTarget : entryTarget
        let links = followTarget ? resolved.links : anchorResolution.links
        var payload = FilePayload.absent
        var identity: String?
        var linkCount: UInt64 = 0
        if lstat(target, &info) == 0 {
            identity = "\(info.st_dev):\(info.st_ino)"; linkCount = UInt64(info.st_nlink)
            let mode = UInt16(info.st_mode & 0o7777)
            switch FileSystem.kind(info) {
            case .file: payload = .file(try FileSystem.read(target, limit: 128 * 1024 * 1024), mode: mode)
            case .symlink: payload = .symlink(try FileManager.default.destinationOfSymbolicLink(atPath: target))
            case .directory: payload = .directory(mode: mode)
            case .other: throw WorkspaceError.message("不编辑设备、管道或 socket：\(path)")
            }
        } else if errno != ENOENT && errno != ENOTDIR { throw WorkspaceError.message("无法检查目标：\(path)") }
        return Self(path: path, target: target, followTarget: followTarget, links: links, identity: identity, linkCount: linkCount,
                    payload: payload, anchor: anchor, anchorIdentity: anchorResolution.identity)
    }

    public func matchesCurrent(requireIdentity: Bool = true) -> Bool {
        guard FileSystem.resolve(anchor).identity == anchorIdentity, let current = try? Self.capture(path, followTarget: followTarget) else { return false }
        return target == current.target && links == current.links && payload == current.payload
            && (payload.kind != .file || linkCount == current.linkCount)
            && (!requireIdentity || identity == current.identity)
    }
}

public struct FileChange: Codable, Sendable, Identifiable {
    public var id: String { before.path }
    public var before: FileVersion
    public var after: FilePayload
    public var affectedConsumers: [String]
    public init(before: FileVersion, after: FilePayload, affectedConsumers: [String] = []) {
        self.before = before; self.after = after; self.affectedConsumers = affectedConsumers
    }
}
public struct ChangeSet: Codable, Sendable, Identifiable {
    public var id = UUID().uuidString
    public var title: String
    public var changes: [FileChange]
    public var createdAt = Date()
    public init(title: String, changes: [FileChange]) { self.title = title; self.changes = changes }
}

public struct TransactionReceipt: Codable, Sendable, Identifiable {
    public enum State: String, Codable, Sendable { case prepared, applying, applied, rolledBack, conflict }
    public var id: String { changeSet.id }
    public var changeSet: ChangeSet
    public var states: [State]
    public var appliedVersions: [FileVersion?]
    public var completed = false
    public var undone = false
    public var message: String?
}

/// Each file is journaled and replaced separately; rollback and undo are conditional on disk state.
public actor FileTransactions {
    public let directory: String
    public init(directory: String) { self.directory = directory }

    public func history() throws -> [TransactionReceipt] {
        guard FileManager.default.fileExists(atPath: directory) else { return [] }
        return try FileSystem.children(directory).filter { $0.hasSuffix(".json") }.compactMap { name in
            try? JSONDecoder().decode(TransactionReceipt.self, from: FileSystem.read(FileSystem.join(directory, name), limit: 256 * 1024 * 1024))
        }.sorted { $0.changeSet.createdAt > $1.changeSet.createdAt }
    }
    private func persist(_ receipt: TransactionReceipt) throws { try FileSystem.writePrivate(receipt, to: FileSystem.join(directory, receipt.id + ".json")) }

    public static func includingParents(_ set: ChangeSet) throws -> ChangeSet {
        var directories: [FileChange] = []
        var known = Set(set.changes.map { $0.before.target })
        for change in set.changes where change.after.kind != nil {
            var path = (change.before.target as NSString).deletingLastPathComponent
            var missing: [String] = []
            while FileSystem.resolve(path).status == .missing && path != "/" { missing.insert(path, at: 0); path = (path as NSString).deletingLastPathComponent }
            for path in missing where known.insert(path).inserted { directories.append(FileChange(before: try .capture(path, followTarget: false), after: .directory())) }
        }
        var result = set; result.changes = directories + set.changes; return result
    }

    public func apply(_ set: ChangeSet) throws -> TransactionReceipt {
        guard !set.changes.isEmpty else { throw WorkspaceError.message("没有需要应用的变更") }
        guard Set(set.changes.map { $0.before.target }).count == set.changes.count else { throw WorkspaceError.message("变更包含重复的最终目标；请合并后重试") }
        for change in set.changes {
            guard change.before.matchesCurrent() else { throw WorkspaceError.message("预览后文件或链接已改变：\(change.before.path)") }
            if change.before.payload.kind == .file && change.before.linkCount > 1 { throw WorkspaceError.message("硬链接需要先另存为独立分叉，避免静默改变共享语义：\(change.before.path)") }
            if change.before.payload.kind == .directory && change.after.kind != .directory {
                let children = try FileSystem.children(change.before.target)
                let removals = Set(set.changes.filter { $0.after.kind == nil }.map { $0.before.target })
                guard children.allSatisfy({ removals.contains(FileSystem.join(change.before.target, $0)) }) else { throw WorkspaceError.message("目录仍有未纳入审阅的内容：\(change.before.path)") }
            }
        }
        var receipt = TransactionReceipt(changeSet: set, states: Array(repeating: .prepared, count: set.changes.count), appliedVersions: Array(repeating: nil, count: set.changes.count))
        try persist(receipt)
        do {
            for position in set.changes.indices {
                try Task.checkCancellation()
                let change = set.changes[position]
                guard change.before.matchesCurrent() else { throw WorkspaceError.message("应用前文件已改变：\(change.before.path)") }
                receipt.states[position] = .applying; try persist(receipt)
                try Self.install(change.after, at: change.before.target, previous: change.before.payload)
                receipt.appliedVersions[position] = try .capture(change.before.path, followTarget: change.before.followTarget)
                guard receipt.appliedVersions[position]?.payload == change.after else { throw WorkspaceError.message("写入后校验失败：\(change.before.path)") }
                receipt.states[position] = .applied; try persist(receipt)
            }
            for position in set.changes.indices {
                let change = set.changes[position]
                let current = try FileVersion.capture(change.before.path, followTarget: change.before.followTarget)
                guard current.payload == change.after, current.target == change.before.target else {
                    throw WorkspaceError.message("提交期间文件又被修改：\(change.before.path)")
                }
                receipt.appliedVersions[position] = current
            }
            receipt.completed = true; try persist(receipt); return receipt
        } catch {
            receipt.message = error.localizedDescription
            try rollback(&receipt)
            throw WorkspaceError.message("\(error.localizedDescription)\n\(receipt.states.contains(.conflict) ? "部分文件需要人工恢复，详见变更历史。" : "已回退此次写入。")")
        }
    }

    public func undo(_ id: String) throws -> TransactionReceipt {
        guard var receipt = try history().first(where: { $0.id == id }), receipt.completed, !receipt.undone else { throw WorkspaceError.message("没有可撤销的操作") }
        // Refuse the entire undo before writing if any item was modified externally.
        for position in receipt.states.indices where receipt.states[position] == .applied {
            guard receipt.appliedVersions[position]?.matchesCurrent() == true else { throw WorkspaceError.message("撤销冲突：\(receipt.changeSet.changes[position].before.path) 已被其他程序修改") }
        }
        try rollback(&receipt); receipt.undone = !receipt.states.contains(.conflict); try persist(receipt); return receipt
    }

    public func recoverInterrupted() throws -> [TransactionReceipt] {
        var recovered: [TransactionReceipt] = []
        for var receipt in try history() where !receipt.completed && !receipt.undone {
            try rollback(&receipt); receipt.undone = !receipt.states.contains(.conflict); try persist(receipt); recovered.append(receipt)
        }
        return recovered
    }

    private func rollback(_ receipt: inout TransactionReceipt) throws {
        var restoredDirectories: [String: String] = [:]
        for position in receipt.states.indices.reversed() where [.applied, .applying, .conflict].contains(receipt.states[position]) {
            let change = receipt.changeSet.changes[position]
            do {
                if change.before.matchesCurrent() { receipt.states[position] = .rolledBack; continue }
                let current = try FileVersion.capture(change.before.path, followTarget: change.before.followTarget)
                let post = receipt.appliedVersions[position]
                guard current.target == change.before.target, current.links == change.before.links,
                      current.payload == change.after, post?.matchesCurrent() ?? true,
                      FileSystem.resolve(change.before.anchor).identity == (restoredDirectories[change.before.anchor] ?? change.before.anchorIdentity) else {
                    receipt.states[position] = .conflict; continue
                }
                if current.payload.kind == .directory {
                    if !(try FileSystem.children(current.target)).isEmpty { receipt.states[position] = .conflict; continue }
                }
                try Self.install(change.before.payload, at: current.target, previous: current.payload)
                if change.before.payload.kind == .directory {
                    restoredDirectories[change.before.path] = FileSystem.resolve(current.target).identity
                    restoredDirectories[change.before.target] = FileSystem.resolve(current.target).identity
                }
                receipt.states[position] = .rolledBack
            } catch { receipt.states[position] = .conflict; receipt.message = error.localizedDescription }
            try persist(receipt)
        }
        try persist(receipt)
    }

    /// Open every canonical parent without following symlinks, then mutate relative to that descriptor.
    private static func openDirectory(_ path: String) throws -> Int32 {
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard descriptor >= 0 else { throw WorkspaceError.message("无法打开文件系统根目录") }
        for component in path.split(separator: "/").map(String.init) {
            let next = openat(descriptor, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            close(descriptor)
            guard next >= 0 else { throw WorkspaceError.message("父目录已改变或不可写：\(path)") }
            descriptor = next
        }
        return descriptor
    }

    private static func install(_ payload: FilePayload, at path: String, previous: FilePayload) throws {
        let parentPath = (path as NSString).deletingLastPathComponent
        let parent = try openDirectory(parentPath); defer { close(parent) }
        let name = (path as NSString).lastPathComponent
        let temporary = ".otter-" + UUID().uuidString
        defer { unlinkat(parent, temporary, 0) }
        if payload.kind == nil {
            guard unlinkat(parent, name, previous.kind == .directory ? AT_REMOVEDIR : 0) == 0 else { throw WorkspaceError.message("删除失败：\(path)") }
        } else if payload.kind == .directory {
            if previous.kind == .directory { return }
            guard mkdirat(parent, name, mode_t(payload.mode)) == 0 else { throw WorkspaceError.message("创建目录失败：\(path)") }
        } else {
            if payload.kind == .symlink {
                guard let link = payload.link, symlinkat(link, parent, temporary) == 0 else { throw WorkspaceError.message("创建链接失败：\(path)") }
            } else {
                guard let data = payload.data else { throw WorkspaceError.message("文件内容缺失") }
                let file = openat(parent, temporary, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW | O_CLOEXEC, mode_t(payload.mode))
                guard file >= 0 else { throw WorkspaceError.message("无法创建临时文件：\(path)") }
                defer { close(file) }
                try data.withUnsafeBytes { bytes in
                    var written = 0
                    while written < bytes.count {
                        let count = Darwin.write(file, bytes.baseAddress!.advanced(by: written), bytes.count - written)
                        if count < 0 && errno == EINTR { continue }
                        guard count > 0 else { throw WorkspaceError.message("磁盘写入失败：\(path)") }
                        written += count
                    }
                }
                if previous.kind == .file {
                    let temporaryPath = FileSystem.join(parentPath, temporary)
                    guard copyfile(path, temporaryPath, nil, copyfile_flags_t(COPYFILE_METADATA)) == 0 else { throw WorkspaceError.message("无法保留文件元数据：\(path)") }
                }
                guard fchmod(file, mode_t(payload.mode)) == 0, fsync(file) == 0 else { throw WorkspaceError.message("无法提交文件：\(path)") }
            }
            guard renameat(parent, temporary, parent, name) == 0 else { throw WorkspaceError.message("替换失败：\(path)") }
        }
        _ = fsync(parent)
    }
}

public struct EditorDraft: Codable, Sendable {
    public var version = 1
    public var original: FileVersion
    public var text: String
    public var updatedAt: Date
    public init(original: FileVersion, text: String) { self.original = original; self.text = text; updatedAt = Date() }
}

public actor DraftStore {
    public let directory: String
    public init(directory: String) { self.directory = directory }
    public func save(_ draft: EditorDraft) throws {
        try FileSystem.writePrivate(draft, to: draftPath(draft.original.target))
    }
    public func load(_ path: String) -> EditorDraft? {
        guard let data = try? FileSystem.read(draftPath(FileSystem.resolve(path).finalPath ?? path), limit: 64 * 1024 * 1024) else { return nil }
        return try? JSONDecoder().decode(EditorDraft.self, from: data)
    }
    public func remove(_ path: String) throws {
        let path = draftPath(FileSystem.resolve(path).finalPath ?? path)
        if FileManager.default.fileExists(atPath: path) { try FileManager.default.removeItem(atPath: path) }
    }
    private func draftPath(_ target: String) -> String { FileSystem.join(directory, FileSystem.hash(Data(target.utf8)) + ".json") }
}
