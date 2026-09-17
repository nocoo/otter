import Foundation
import XCTest
@testable import OtterCore

final class RecoveryTests: XCTestCase {
    func testJournalRecoversUnfinishedTasksWithoutRetryingUploads() throws {
        let task = CLIJobRecord(id: "one", title: "Upload", arguments: ["backup", "--snapshot", "saved-id"], command: "otter backup --snapshot saved-id", started: Date(), finished: nil, phase: "uploading", error: nil, snapshotID: "saved-id")
        let restored = try JSONDecoder().decode(CLIJobRecord.self, from: JSONEncoder().encode(task)).recovered()
        XCTAssertEqual(restored.phase, "interrupted")
        XCTAssertEqual(restored.snapshotID, "saved-id")
        XCTAssertNotNil(restored.finished)
        XCTAssertTrue(restored.error?.contains("核对远端") == true)
        XCTAssertEqual(restored.recovered().phase, "interrupted")
        var scan = task; scan.arguments = ["scan", "--save"]
        XCTAssertTrue(scan.recovered().error?.contains("本地快照") == true)
    }

    func testSnapshotPreviewMaterializesOnlyReferencesContainedInTheSnapshot() throws {
        let source: JSONValue = .object(["path": .string("/gone/SKILL.md"), "sha256": .string("hash"), "sizeBytes": .number(5), "encoding": .string("utf8"), "content": .string("saved")])
        let reference: JSONValue = .object(["path": .string("/gone/link/SKILL.md"), "sha256": .string("hash"), "sizeBytes": .number(5), "encoding": .string("utf8"), "content": .string(""), "contentRef": .string("hash")])
        let snapshot: JSONValue = .object(["collectors": .array([.object(["files": .array([source, reference])])])])
        XCTAssertEqual(try SnapshotContent.preview(reference, in: snapshot), "saved")
        XCTAssertThrowsError(try SnapshotContent.preview(reference, in: .object(["collectors": .array([])])))
        let binary: JSONValue = .object(["encoding": .string("base64"), "content": .string("AA=="), "sizeBytes": .number(1)])
        XCTAssertTrue(try SnapshotContent.preview(binary, in: snapshot).contains("二进制资源"))
    }

    func testCLIManifestCarriesProfilesDiscoveryAndBindingBaselinesIntoTheNativeIndex() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("otter-bridge-" + UUID().uuidString).path
        try FileSystem.privateDirectory(root)
        defer { try? FileManager.default.removeItem(atPath: root) }
        let document = FileSystem.join(root, "AGENTS.md")
        try Data("Global instruction\n".utf8).write(to: URL(fileURLWithPath: document))
        let data: [String: Any] = ["workspace": [
            "schemaVersion": 2, "observedAt": "2026-09-17T00:00:00Z", "coverage": ["complete": true, "issues": []],
            "roots": [["id": "shared", "path": root, "role": "shared", "include": ["AGENTS.md", "skills"]]],
            "agents": [["id": "codex:default", "kind": "codex", "profile": "default", "configPath": root], ["id": "hermes:cherry", "kind": "hermes", "profile": "cherry", "configPath": root]],
            "resources": [["id": "entry", "rootId": "shared", "path": document, "kind": "instruction", "name": "AGENTS.md", "relationship": "independent", "agentIds": ["codex:default", "hermes:cherry"], "discovery": [["agentId": "codex:default", "state": "disabled"], ["agentId": "hermes:cherry", "state": "on-disk"]]]]
        ]]
        let value = try JSONDecoder().decode(JSONValue.self, from: JSONSerialization.data(withJSONObject: data))
        let index = try CLIWorkspaceIndex.decode(value, configuration: WorkspaceConfiguration(home: root))
        let entry = try XCTUnwrap(index.entries.first)
        XCTAssertEqual(entry.consumers.first { $0.harness == .codex }?.discovery, .disabled)
        XCTAssertEqual(entry.consumers.first { $0.harness == .hermes }?.profile, "cherry")
        XCTAssertEqual(entry.consumers.first { $0.harness == .hermes }?.discovery, .unverified)
        XCTAssertFalse(index.watchedPaths.contains(root))
        XCTAssertTrue(index.watchedPaths.contains(document))
        XCTAssertTrue(index.watchedPaths.contains(FileSystem.join(root, "skills")))
        XCTAssertThrowsError(try CLIWorkspaceIndex.decode(.object([:]), configuration: WorkspaceConfiguration(home: root)))
        let registry: JSONValue = .object(["version": .number(1), "sources": .array([.object(["path": .string(root)])]), "projects": .array([]), "bindings": .array([.object(["id": .string("binding"), "source": .string(document), "target": .string(document), "mode": .string("copy"), "baseSource": .string("baseline"), "createdAt": .number(0)])])])
        let merged = try CLIWorkspaceIndex.configuration(registry, merging: WorkspaceConfiguration(home: root))
        XCTAssertEqual(merged.sources, [root])
        XCTAssertEqual(merged.bindings.first?.baseSource, "baseline")
        XCTAssertEqual(merged.bindings.first?.id, "binding")
    }
}
