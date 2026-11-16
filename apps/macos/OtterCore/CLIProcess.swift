import Darwin
import Foundation

public struct ProcessResult: Sendable {
    public var status: Int32
    public var stdout: Data
    public var stderr: String
    public var cancelled: Bool
    public var timedOut: Bool
    public var truncatedStderrBytes: Int
}
public enum ProcessReply: Sendable { case send(Data), finish, none }

/// Serialized writer for a child process' standard input.
///
/// Bytes reach the pipe through write(2) instead of the buffered file APIs, and every
/// payload leaves in the order it was queued: the handshake first, then the replies it
/// triggers. A failed write is reported. Aborting closes the pipe, which releases a write
/// that waits for a child that stopped reading, so a cancelled run never stalls.
final class StandardInputWriter: @unchecked Sendable {
    /// Payloads up to this size fit the pipe buffer, so writing them never blocks.
    private static let inlineLimit = 8 * 1024
    private let handle: FileHandle
    /// Captured once: asking a closed handle for its descriptor raises.
    private let descriptor: Int32
    private let queue = DispatchQueue(label: "ai.hexly.otter.core.stdin")
    private let lock = NSLock()
    private let onFailure: @Sendable () -> Void
    private var closed = false
    private var aborted = false
    private var failure: String?

    init(handle: FileHandle, onFailure: @escaping @Sendable () -> Void) {
        self.handle = handle
        self.descriptor = handle.fileDescriptor
        self.onFailure = onFailure
    }

    /// Writes the handshake payload. Small payloads are written inline so the child never
    /// waits on a background queue; larger ones are queued ahead of every later reply.
    func write(_ data: Data) throws {
        guard !data.isEmpty else { return }
        if data.count <= Self.inlineLimit {
            do { try writeAll(data) }
            catch { record(error.localizedDescription); throw error }
            return
        }
        queue.async { [self] in attempt { try writeAll(data) } }
    }

    /// Writes a conversation reply, after the handshake payload reached the pipe.
    func send(_ data: Data) {
        queue.async { [self] in attempt { try writeAll(data) } }
    }

    /// Closes the pipe after every queued payload, so the child observes EOF.
    func close() {
        queue.async { [self] in closeNow() }
    }

    /// Waits for the queued payloads to reach the pipe. The caller stays cancellable:
    /// the wait suspends instead of blocking, so a timeout or a cancellation still runs.
    func flush() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            queue.async { continuation.resume() }
        }
    }

    /// Releases a write that is blocked on a child that stopped reading. Closing the pipe
    /// ends the blocked write with a broken pipe error and gives the child EOF.
    func abort() {
        lock.lock()
        if aborted { lock.unlock(); return }
        aborted = true
        let already = closed
        closed = true
        lock.unlock()
        if !already { try? handle.close() }
    }

    var error: String? {
        lock.lock(); defer { lock.unlock() }
        return failure
    }

    private func attempt(_ work: () throws -> Void) {
        lock.lock()
        let isClosed = closed
        lock.unlock()
        guard !isClosed else { return }
        do { try work() }
        catch {
            lock.lock()
            let wasAborted = aborted
            lock.unlock()
            // An aborted write was never delivered on purpose, so it is not a failure.
            if !wasAborted { record(error.localizedDescription) }
        }
    }

    private func writeAll(_ data: Data) throws {
        try data.withUnsafeBytes { buffer in
            guard let base = buffer.baseAddress, buffer.count > 0 else { return }
            var offset = 0
            while offset < buffer.count {
                let written = Darwin.write(descriptor, base.advanced(by: offset), buffer.count - offset)
                if written > 0 { offset += written; continue }
                if written == 0 { throw WorkspaceError.message("写入 CLI 标准输入失败：管道已关闭") }
                if errno == EINTR { continue }
                throw WorkspaceError.message("写入 CLI 标准输入失败：\(String(cString: strerror(errno)))")
            }
        }
    }

    private func closeNow() {
        lock.lock()
        if closed { lock.unlock(); return }
        closed = true
        lock.unlock()
        try? handle.close()
    }

    private func record(_ text: String) {
        lock.lock()
        let first = failure == nil
        failure = text
        lock.unlock()
        if first { onFailure() }
    }
}

/// One owned subprocess at a time; streams are drained concurrently on blocking I/O queues.
public actor ProcessRunner {
    private var process: Process?
    private var standardInput: StandardInputWriter?
    private var cancelled = false
    private var timedOut = false
    public init() {}

    public func cancel() {
        cancelled = true
        // Releasing the pipe unblocks a write that waits for a child that stopped reading.
        standardInput?.abort()
        guard let process, process.isRunning else { return }
        let pid = process.processIdentifier
        let ownGroup = getpgid(pid) == pid
        if ownGroup { kill(-pid, SIGTERM) } else { process.terminate() }
        Task {
            try? await Task.sleep(for: .milliseconds(700))
            if ownGroup { kill(-pid, SIGKILL) }
            else if self.process?.processIdentifier == pid && self.process?.isRunning == true { kill(pid, SIGKILL) }
        }
    }

    public func run(executable: String, arguments: [String], directory: String? = nil,
                    environment: [String: String]? = nil, input: Data? = nil,
                    timeout: TimeInterval = 120, outputLimit: Int = 64 * 1024 * 1024,
                    onLine: (@Sendable (Data) -> Void)? = nil,
                    conversation: (@Sendable (Data) -> ProcessReply)? = nil) async throws -> ProcessResult {
        guard process == nil else { throw WorkspaceError.message("已有 CLI 任务正在运行") }
        guard executable.hasPrefix("/"), FileManager.default.isExecutableFile(atPath: executable) else { throw WorkspaceError.message("CLI 不存在或不可执行：\(executable)") }
        try Task.checkCancellation()
        let child = Process()
        child.executableURL = URL(fileURLWithPath: executable)
        child.arguments = arguments
        if let directory { child.currentDirectoryURL = URL(fileURLWithPath: directory) }
        if let environment { child.environment = environment }
        let output = Pipe(), errors = Pipe(), stdin = Pipe()
        child.standardOutput = output; child.standardError = errors; child.standardInput = stdin
        // Register before launch so a fast child can exit before its pipes finish draining.
        // A detached waiter survives caller cancellation until our owned child actually exits.
        let termination = AsyncStream<Int32>.makeStream(bufferingPolicy: .bufferingNewest(1))
        child.terminationHandler = { child in
            termination.continuation.yield(child.terminationStatus); termination.continuation.finish()
        }
        let exitStatus = Task.detached(priority: .utility) {
            for await status in termination.stream { return status }
            return Int32(-1)
        }
        cancelled = false; timedOut = false; process = child
        do { try child.run() }
        catch { termination.continuation.finish(); process = nil; throw WorkspaceError.message("启动 CLI 失败：\(error.localizedDescription)") }
        // A CLI exiting during an RPC reply must not deliver SIGPIPE to the application.
        _ = fcntl(stdin.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1)
        let writer = StandardInputWriter(handle: stdin.fileHandleForWriting) { Task { await self.cancel() } }
        standardInput = writer
        let timeoutTask = Task {
            do { try await Task.sleep(for: .seconds(timeout)); self.timedOut = true; self.cancel() } catch { /* completed */ }
        }
        defer {
            timeoutTask.cancel(); termination.continuation.finish(); child.terminationHandler = nil
            process = nil; standardInput = nil; writer.close()
        }
        // The handshake payload has to reach the pipe before the child answers, so it is
        // written before the first output byte is read and before any reply can be queued.
        do { try writer.write(input ?? Data()) }
        catch { cancel(); _ = await exitStatus.value; throw error }
        // Without a conversation the child only reads the payload, so it waits for EOF.
        if conversation == nil { writer.close() }
        let receive: @Sendable (Data) -> Void = { line in
            onLine?(line)
            switch conversation?(line) ?? .none {
            case .send(let data): writer.send(data)
            case .finish: writer.close()
            case .none: break
            }
        }
        return try await withTaskCancellationHandler {
            async let stdout = Self.drain(output.fileHandleForReading, limit: outputLimit, keepTail: false, onLine: receive) { Task { await self.cancel() } }
            async let stderr = Self.drain(errors.fileHandleForReading, limit: 256 * 1024, keepTail: true, onLine: nil, overflow: {})
            do {
                let (out, err) = try await (stdout, stderr)
                // A reply that was queued while the child answered still has to reach the
                // pipe. The wait suspends, so a timeout or a cancellation still runs.
                await writer.flush()
                let status = await exitStatus.value
                if let failure = writer.error { throw WorkspaceError.message(failure) }
                return ProcessResult(status: status, stdout: out.data,
                    stderr: String(decoding: err.data, as: UTF8.self), cancelled: cancelled,
                    timedOut: timedOut, truncatedStderrBytes: err.dropped)
            } catch {
                cancel(); _ = await exitStatus.value; throw error
            }
        } onCancel: { Task { await self.cancel() } }
    }
    private struct Drained: Sendable { var data: Data; var dropped: Int }
    private static func drain(_ handle: FileHandle, limit: Int, keepTail: Bool, onLine: (@Sendable (Data) -> Void)?, overflow: @escaping @Sendable () -> Void) async throws -> Drained {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                var result = Data(), line = Data(), dropped = 0
                do {
                    defer { try? handle.close() }
                    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
                    while true {
                        // FileHandle.read(upToCount:) may fill the requested size on macOS pipes.
                        // read(2) returns currently available bytes so interactive RPC can reply.
                        let count = Darwin.read(handle.fileDescriptor, &buffer, buffer.count)
                        if count < 0 && errno == EINTR { continue }
                        guard count >= 0 else { throw WorkspaceError.message("读取 CLI 输出失败") }
                        if count == 0 { break }
                        let chunk = Data(buffer.prefix(count))
                        result.append(chunk)
                        if result.count > limit {
                            if keepTail { dropped += result.count - limit; result.removeFirst(result.count - limit) }
                            else { overflow(); throw WorkspaceError.message("CLI 输出超过 \(limit / 1024) KB 限制") }
                        }
                        if let onLine {
                            line.append(chunk)
                            while let newline = line.firstIndex(of: 10) { onLine(Data(line[..<newline])); line.removeSubrange(...newline) }
                            guard line.count <= limit else { overflow(); throw WorkspaceError.message("CLI 事件行过长") }
                        }
                    }
                    if !line.isEmpty { onLine?(line) }
                    continuation.resume(returning: Drained(data: result, dropped: dropped))
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
}

public enum JSONValue: Codable, Sendable, Equatable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null
    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let object = try? value.decode([String: JSONValue].self) { self = .object(object) }
        else if let array = try? value.decode([JSONValue].self) { self = .array(array) }
        else if let string = try? value.decode(String.self) { self = .string(string) }
        else if let bool = try? value.decode(Bool.self) { self = .bool(bool) }
        else { self = .number(try value.decode(Double.self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .object(let object): try value.encode(object)
        case .array(let array): try value.encode(array)
        case .string(let string): try value.encode(string)
        case .number(let number): try value.encode(number)
        case .bool(let bool): try value.encode(bool)
        case .null: try value.encodeNil()
        }
    }
    public subscript(_ key: String) -> JSONValue { if case .object(let object) = self { return object[key] ?? .null }; return .null }
    public var string: String? { if case .string(let string) = self { return string }; return nil }
    public var number: Double? { if case .number(let number) = self { return number }; return nil }
    public var bool: Bool? { if case .bool(let bool) = self { return bool }; return nil }
    public var array: [JSONValue] { if case .array(let array) = self { return array }; return [] }
    public var pretty: String { let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]; return (try? encoder.encode(self)).map { String(decoding: $0, as: UTF8.self) } ?? "" }
}

public struct CLIEvent: Decodable, Sendable {
    public var protocolVersion: Int
    public var jobId: String
    public var sequence: Int
    public var type: String
    public var data: JSONValue
}

public struct CLIClient: Sendable {
    public var executable: String
    public var configuration: WorkspaceConfiguration
    public var isolated: Bool
    public init(executable: String, configuration: WorkspaceConfiguration, isolated: Bool = false) {
        self.executable = executable; self.configuration = configuration; self.isolated = isolated
    }
    public var commonArguments: [String] {
        ["--config-dir", configuration.cliConfigDirectory, "--output-dir", configuration.cliOutputDirectory,
         "--api-url", configuration.apiURL] + (configuration.development ? ["--dev"] : [])
    }
    public var environment: [String: String] {
        var env = ProcessInfo.processInfo.environment
        // Finder need not know where Node/npm live. The helper includes its runtime.
        env["PATH"] = WorkspaceScanner.defaultSearchPath(home: configuration.home).joined(separator: ":")
        env["NO_COLOR"] = "1"
        return env
    }
    public func json(_ arguments: [String], runner: ProcessRunner = ProcessRunner()) async throws -> JSONValue {
        var args = arguments + ["--json"] + commonArguments
        if isolated && ["scan", "workspace", "backup"].contains(arguments.first ?? "") { args += ["--scan-root", configuration.home, "--collectors", "agent-workspace,claude-config,opencode-config,shell-config,hermes"] }
        let result = try await runner.run(executable: executable, arguments: args, environment: environment, timeout: arguments.first == "workspace" ? 300 : 40)
        guard !result.cancelled else { throw CancellationError() }
        let value: JSONValue
        do { value = try JSONDecoder().decode(JSONValue.self, from: result.stdout) }
        catch { throw WorkspaceError.message("CLI 没有返回有效的 JSON；检查版本与协议兼容性") }
        guard result.status == 0 else { throw WorkspaceError.message(value["error"]["message"].string ?? "CLI 退出：\(result.status)") }
        if arguments.first == "capabilities" {
            guard value["protocolVersion"].number == 1, value["workspaceSchemaVersion"].number == 2, value["operations"].array.contains(.string("workspace.inspect")) else { throw WorkspaceError.message("CLI 协议不兼容，需要 Otter 3.0 完整配置采集能力；请使用内置版本或升级外部 CLI") }
        }
        return value
    }
    public func job(_ arguments: [String], id: String, runner: ProcessRunner, onLine: @escaping @Sendable (Data) -> Void) async throws -> ProcessResult {
        var args = arguments + ["--format", "ndjson", "--job-id", id] + commonArguments
        if isolated && arguments.first == "scan" { args += ["--scan-root", configuration.home, "--collectors", "agent-workspace,claude-config,opencode-config,shell-config,hermes"] }
        return try await runner.run(executable: executable, arguments: args, environment: environment,
                                    timeout: arguments.first == "scan" ? 300 : 90, onLine: onLine)
    }
    public static func decodeEvents(_ data: Data, jobID: String) throws -> [CLIEvent] {
        let lines = data.split(separator: 10)
        let events = try lines.map { try JSONDecoder().decode(CLIEvent.self, from: Data($0)) }
        guard events.first?.type == "started", events.last?.type == "result" || events.last?.type == "error",
              events.enumerated().allSatisfy({ $0.element.sequence == $0.offset && $0.element.jobId == jobID && $0.element.protocolVersion == 1 }) else { throw WorkspaceError.message("CLI 事件流不完整或协议不兼容") }
        return events
    }
}
