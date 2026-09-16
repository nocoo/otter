import CoreServices
import Foundation
import OtterCore

final class WorkspaceWatcher: @unchecked Sendable {
    private var stream: FSEventStreamRef?
    private let paths: [String]
    private let handler: @Sendable () -> Void
    init(paths: [String], handler: @escaping @Sendable () -> Void) {
        self.paths = paths; self.handler = handler
        var watch = Set<String>()
        for path in paths {
            var existing = path
            while !FileManager.default.fileExists(atPath: existing) && existing != "/" { existing = (existing as NSString).deletingLastPathComponent }
            if existing != "/" { watch.insert(existing) }
        }
        guard !watch.isEmpty else { return }
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
        stream = FSEventStreamCreate(nil, { _, info, count, eventPaths, _, _ in
            guard let info else { return }
            let owner = Unmanaged<WorkspaceWatcher>.fromOpaque(info).takeUnretainedValue()
            let changed = unsafeBitCast(eventPaths, to: NSArray.self) as? [String] ?? []
            if changed.prefix(count).contains(where: { event in
                if ["/sessions/", "/cache/", "/.cache/", "/debug/", "/telemetry/", "/checkpoints/", "/drafts/"].contains(where: event.contains) { return false }
                return owner.paths.contains { FileSystem.isWithin(event, $0) || FileSystem.isWithin($0, event) }
            }) { owner.handler() }
        }, &context, watch.sorted() as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.3,
        FSEventStreamCreateFlags(kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagWatchRoot))
        if let stream { FSEventStreamSetDispatchQueue(stream, DispatchQueue(label: "ai.hexly.otter.file-events")); FSEventStreamStart(stream) }
    }
    func stop() { if let stream { FSEventStreamStop(stream); FSEventStreamInvalidate(stream); FSEventStreamRelease(stream); self.stream = nil } }
    deinit { stop() }
}
