import Darwin
import Foundation
import XCTest
@testable import OtterCore

private final class Fixture {
    let root: String
    var home: String { FileSystem.join(root, "home") }
    var source: String { FileSystem.join(root, "workflow") }
    var package: String { FileSystem.join(source, "agents/skills/workspace-notes") }
    var configuration: WorkspaceConfiguration { WorkspaceConfiguration(home: home, sources: [source]) }
    init() throws {
        root = FileSystem.join(FileManager.default.temporaryDirectory.path, "otter-core-" + UUID().uuidString)
        try FileSystem.privateDirectory(root)
        try write("workflow/agents/skills/workspace-notes/SKILL.md", "---\nname: workspace-notes\ndescription: Organize notes and check references.\n---\n\n# Notes\n\n[Guide](references/guide.md)\n")
        try write("workflow/agents/skills/workspace-notes/references/guide.md", "# Guide\nOriginal text.\n")
        try write("workflow/agents/skills/workspace-notes/scripts/check.sh", "#!/bin/sh\nprintf 'ok'\n")
        try write("workflow/agents/AGENTS.md", "Canonical instructions.\n")
        try write("home/.codex/instructions.md", "Different instructions.\n")
        try link("home/.agents/skills/workspace-notes", target: package)
        try link("home/.claude/skills/workspace-notes", target: "../../.agents/skills/workspace-notes")
        try link("home/.claude/CLAUDE.md", target: FileSystem.join(source, "agents/AGENTS.md"))
        try write("home/.hermes/profiles/cherry/skills/category/nested/SKILL.md", "---\nname: nested\ndescription: Nested profile skill.\n---\n")
    }
    deinit { try? FileManager.default.removeItem(atPath: root) }
    func write(_ path: String, _ text: String) throws {
        let absolute = FileSystem.join(root, path)
        try FileManager.default.createDirectory(atPath: (absolute as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        try Data(text.utf8).write(to: URL(fileURLWithPath: absolute))
    }
    func link(_ path: String, target: String) throws {
        let absolute = FileSystem.join(root, path)
        try FileManager.default.createDirectory(atPath: (absolute as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(atPath: absolute, withDestinationPath: target)
    }
}

final class WorkspaceTests: XCTestCase {
    func testSystemDirectoryAliasesDoNotCreatePhantomMissingResources() throws {
        let fixture = try Fixture()
        let home = FileSystem.join(fixture.root, "empty-home")
        try FileSystem.privateDirectory(home)
        let index = try WorkspaceScanner().scan(WorkspaceConfiguration(home: home), searchPath: [])
        XCTAssertTrue(index.entries.isEmpty)
        XCTAssertTrue(index.problems.isEmpty)
    }

    func testScannerPreservesEntriesChainsProfilesAndUnverifiedRuntime() throws {
        let fixture = try Fixture()
        let index = try WorkspaceScanner().scan(fixture.configuration, searchPath: [])
        let claude = try XCTUnwrap(index.entries.first { $0.path.contains("/.claude/skills/") })
        XCTAssertEqual(claude.relationship, .symlink)
        XCTAssertTrue(claude.resolution.links.contains { $0.destination == "../../.agents/skills/workspace-notes" })
        XCTAssertEqual(claude.sourceRoot, FileSystem.resolve(fixture.source).finalPath)
        XCTAssertEqual(claude.package?.files.filter { $0.kind == .file }.count, 3)
        let shared = try XCTUnwrap(index.entries.first { $0.path.contains("/.agents/skills/") })
        XCTAssertTrue(shared.consumers.contains { $0.harness == .codex })
        XCTAssertTrue(shared.consumers.allSatisfy { $0.discovery == .unverified })
        XCTAssertTrue(index.skills.contains { $0.name == "nested" && $0.consumers.contains { $0.profile == "cherry" } })
        XCTAssertTrue(index.problems.contains { $0.rule == "codex.legacy-instructions" })
        XCTAssertEqual(index.entries.first { $0.path.hasSuffix("/.codex/instructions.md") }?.counterpart, FileSystem.join(fixture.source, "agents/AGENTS.md"))
        XCTAssertTrue(index.harnesses.allSatisfy { $0.executable == nil })
    }

    func testResolutionHandlesBrokenCyclesAncestorLinksUnicodeAndDotDot() throws {
        let fixture = try Fixture()
        try fixture.link("home/broken", target: "missing")
        try fixture.link("home/cycle-a", target: "cycle-b")
        try fixture.link("home/cycle-b", target: "cycle-a")
        try fixture.write("workflow/中文/hello.md", "你好")
        try fixture.link("home/alias", target: FileSystem.join(fixture.source, "中文"))
        XCTAssertEqual(FileSystem.resolve(FileSystem.join(fixture.home, "broken")).status, .missing)
        XCTAssertFalse(FileSystem.resolve(FileSystem.join(fixture.home, "broken")).links.isEmpty)
        XCTAssertEqual(FileSystem.resolve(FileSystem.join(fixture.home, "cycle-a")).status, .cycle)
        XCTAssertEqual(try FileSystem.text(FileSystem.join(fixture.home, "alias/hello.md")), "你好")
        XCTAssertEqual(FileSystem.resolve(FileSystem.join(fixture.home, "alias/../agents/AGENTS.md")).finalPath,
                       FileSystem.resolve(FileSystem.join(fixture.source, "agents/AGENTS.md")).finalPath)
    }

    func testWholePackageDigestIncludesEqualLengthEditsAndExecuteBits() throws {
        let fixture = try Fixture()
        let first = try XCTUnwrap(FileSystem.manifest(fixture.package).digest)
        try fixture.write("workflow/agents/skills/workspace-notes/scripts/check.sh", "#!/bin/sh\nprintf 'no'\n")
        let second = try XCTUnwrap(FileSystem.manifest(fixture.package).digest)
        XCTAssertNotEqual(first, second)
        chmod(FileSystem.join(fixture.package, "scripts/check.sh"), 0o755)
        XCTAssertNotEqual(second, FileSystem.manifest(fixture.package).digest)
    }

    func testEqualNameOrContentDoesNotClaimManagedProvenance() throws {
        let fixture = try Fixture()
        let destination = FileSystem.join(fixture.home, ".codex/skills/workspace-notes")
        try FileManager.default.createDirectory(atPath: (destination as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        try FileManager.default.copyItem(atPath: fixture.package, toPath: destination)
        var index = try WorkspaceScanner().scan(fixture.configuration, searchPath: [])
        XCTAssertEqual(index.entries.first { $0.path == destination }?.relationship, .equalContent)
        try Data("different script\n".utf8).write(to: URL(fileURLWithPath: FileSystem.join(destination, "scripts/check.sh")))
        index = try WorkspaceScanner().scan(fixture.configuration, searchPath: [])
        XCTAssertEqual(index.entries.first { $0.path == destination }?.relationship, .unknownLineage)
    }

    func testManagedCopyTracksThreeWayDriftAndIntentionalFork() throws {
        let fixture = try Fixture()
        let source = FileSystem.join(fixture.source, "agents/AGENTS.md")
        let target = FileSystem.join(fixture.home, ".codex/instructions.md")
        var configuration = fixture.configuration
        configuration.bindings = [ManagedBinding(source: source, target: target, mode: .copy,
            baseSource: FileSystem.resolve(source, hashContent: true).contentHash, baseTarget: FileSystem.resolve(target, hashContent: true).contentHash)]
        try fixture.write("workflow/agents/AGENTS.md", "Changed upstream\n")
        var index = try WorkspaceScanner().scan(configuration, searchPath: [])
        XCTAssertEqual(index.entries.first { $0.path == target }?.relationship, .sourceChanged)
        try fixture.write("home/.codex/instructions.md", "Changed downstream\n")
        index = try WorkspaceScanner().scan(configuration, searchPath: [])
        XCTAssertEqual(index.entries.first { $0.path == target }?.relationship, .bothChanged)
        configuration.bindings[0].mode = .fork
        index = try WorkspaceScanner().scan(configuration, searchPath: [])
        XCTAssertEqual(index.entries.first { $0.path == target }?.relationship, .fork)
    }

    func testValidationAndLosslessFieldsWithCRLFCommentsAndBlockScalars() throws {
        let source = "---\r\n# keep this\r\nname: example\r\ndescription: >- # explanation\r\n  A longer\r\n  description.\r\nmetadata:\r\n  unknown: 'quoted value'\r\nx-host: [one, two]\r\n---\r\n\r\n正文保持原样。\r\n"
        let metadata = SkillValidator.inspect(source, path: "SKILL.md")
        XCTAssertEqual(metadata.fields["description"], "A longer description.")
        XCTAssertTrue(metadata.problems.isEmpty)
        XCTAssertEqual(try SkillValidator.setField("description", value: "A longer description.", in: source), source)
        let updated = try SkillValidator.setField("description", value: "新的描述。", in: source)
        XCTAssertTrue(updated.contains("metadata:\r\n  unknown: 'quoted value'\r\nx-host: [one, two]"))
        XCTAssertTrue(updated.contains("# keep this\r\n")); XCTAssertTrue(updated.contains("# explanation\r\n"))
        XCTAssertTrue(updated.hasSuffix("正文保持原样。\r\n"))
        XCTAssertEqual(SkillValidator.inspect(updated, path: "SKILL.md").fields["description"], "新的描述。")
    }

    func testDuplicateYAMLKeysSyntaxHostFieldsAndMissingReferences() throws {
        let duplicate = "---\nname: okay\ndescription: Test\nname: second\n---\n"
        XCTAssertTrue(SkillValidator.inspect(duplicate, path: "SKILL.md").problems.contains { $0.rule == "yaml.duplicate-key" && $0.line == 2 })
        XCTAssertThrowsError(try SkillValidator.setField("name", value: "other", in: duplicate))
        XCTAssertTrue(SkillValidator.inspect("---\nname: [\n---\n", path: "SKILL.md").problems.contains { $0.rule == "yaml.syntax" })
        XCTAssertTrue(SkillValidator.validateDocument("policy:\n  allow_implicit_invocation: sometimes", path: "/tmp/agents/openai.yaml").contains { $0.rule == "codex.invocation-policy" })
        XCTAssertTrue(SkillValidator.validateDocument("broken = [", path: "/tmp/config.toml").contains { $0.rule == "toml.syntax" })
        let fixture = try Fixture()
        let text = "---\nname: workspace-notes\ndescription: Uses references.\n---\n[Missing](references/missing.md)\n`[code](absent)`\n"
        let problems = SkillValidator.validateDocument(text, path: FileSystem.join(fixture.package, "SKILL.md"), packageRoot: fixture.package)
        XCTAssertEqual(problems.filter { $0.rule == "package.missing-reference" }.count, 1)
    }

    func testHeadingOutlineExcludesYAMLAndFencedExamplesAndKeepsSourceLines() {
        let source = "---\r\nname: notes\r\ndescription: |\r\n  # Not a heading\r\n---\r\n\r\n# 配置 **指南**\r\n\r\n```md\r\n# Example\r\n```\r\n\r\nNext steps\r\n----------\r\n"
        let headings = SkillValidator.headings(in: source)
        XCTAssertEqual(headings.map(\.title), ["配置 指南", "Next steps"])
        XCTAssertEqual(headings.map(\.level), [1, 2])
        XCTAssertEqual(headings.map(\.line), [7, 13])
    }

    func testSymlinkSavePreservesChainPermissionsAndSupportsUndo() async throws {
        let fixture = try Fixture()
        let path = FileSystem.join(fixture.home, ".claude/skills/workspace-notes/scripts/check.sh")
        chmod(FileSystem.join(fixture.package, "scripts/check.sh"), 0o755)
        let before = try FileVersion.capture(path)
        let transactions = FileTransactions(directory: FileSystem.join(fixture.root, "journal"))
        let receipt = try await transactions.apply(ChangeSet(title: "Edit script", changes: [FileChange(before: before, after: .file(Data("updated\n".utf8), mode: before.payload.mode))]))
        XCTAssertTrue(receipt.completed)
        XCTAssertEqual(FileSystem.resolve(path).links, before.links)
        XCTAssertEqual(FileSystem.resolve(path).mode, 0o755)
        XCTAssertEqual(try FileSystem.text(path), "updated\n")
        _ = try await transactions.undo(receipt.id)
        XCTAssertEqual(try FileVersion.capture(path).payload, before.payload)
        XCTAssertEqual(FileSystem.resolve(FileSystem.join(fixture.root, "journal")).mode, 0o700)
        XCTAssertEqual(FileSystem.resolve(FileSystem.join(fixture.root, "journal/\(receipt.id).json")).mode, 0o600)
    }

    func testExternalEditAndRedirectedLinkRefuseWrites() async throws {
        let fixture = try Fixture()
        let path = FileSystem.join(fixture.home, ".claude/CLAUDE.md")
        let before = try FileVersion.capture(path)
        let transactions = FileTransactions(directory: FileSystem.join(fixture.root, "journal"))
        let set = ChangeSet(title: "Edit", changes: [FileChange(before: before, after: .file(Data("mine".utf8)))])
        try fixture.write("workflow/agents/AGENTS.md", "External change")
        do { _ = try await transactions.apply(set); XCTFail("Overwrote external content") } catch { /* expected */ }
        XCTAssertEqual(try FileSystem.text(path), "External change")
        let fresh = try FileVersion.capture(path)
        try FileManager.default.removeItem(atPath: path)
        try fixture.link("home/.claude/CLAUDE.md", target: FileSystem.join(fixture.home, ".codex/instructions.md"))
        do { _ = try await transactions.apply(ChangeSet(title: "Redirect", changes: [FileChange(before: fresh, after: .file(Data("mine".utf8)))])); XCTFail("Followed new link") } catch { /* expected */ }
        XCTAssertEqual(try FileSystem.text(path), "Different instructions.\n")
    }

    func testUndoConflictAndHardlinksAreNotOverwritten() async throws {
        let fixture = try Fixture()
        let path = FileSystem.join(fixture.source, "agents/AGENTS.md")
        let transactions = FileTransactions(directory: FileSystem.join(fixture.root, "journal"))
        let receipt = try await transactions.apply(ChangeSet(title: "Edit", changes: [FileChange(before: try .capture(path), after: .file(Data("saved".utf8)))]))
        try fixture.write("workflow/agents/AGENTS.md", "external")
        do { _ = try await transactions.undo(receipt.id); XCTFail("Undo overwrote external content") } catch { /* expected */ }
        let other = FileSystem.join(fixture.home, "hardlink")
        let beforeLink = try FileVersion.capture(path)
        XCTAssertEqual(link(path, other), 0)
        XCTAssertFalse(beforeLink.matchesCurrent(), "A newly created hardlink invalidates an earlier write preview")
        do { _ = try await transactions.apply(ChangeSet(title: "Hardlink", changes: [FileChange(before: try .capture(path), after: .file(Data("changed".utf8)))])); XCTFail("Silently broke hardlink") } catch { /* expected */ }
        XCTAssertEqual(try FileSystem.text(other), "external")
    }

    func testInterruptedTransactionRecoveryChecksPostconditions() async throws {
        let fixture = try Fixture()
        let path = FileSystem.join(fixture.source, "agents/AGENTS.md")
        let before = try FileVersion.capture(path)
        let set = ChangeSet(title: "Interrupted", changes: [FileChange(before: before, after: .file(Data("after".utf8)))])
        try fixture.write("workflow/agents/AGENTS.md", "after")
        let receipt = TransactionReceipt(changeSet: set, states: [.applying], appliedVersions: [nil])
        let journal = FileSystem.join(fixture.root, "journal")
        try FileSystem.writePrivate(receipt, to: FileSystem.join(journal, receipt.id + ".json"))
        let result = try await FileTransactions(directory: journal).recoverInterrupted()
        XCTAssertTrue(result[0].undone)
        XCTAssertEqual(try FileSystem.text(path), String(decoding: before.payload.data!, as: UTF8.self))
    }

    func testPackageCreateImportDistributeRenameAndUndo() async throws {
        let fixture = try Fixture()
        let transactions = FileTransactions(directory: FileSystem.join(fixture.root, "journal"))
        let created = FileSystem.join(fixture.source, "agents/skills/new-skill")
        _ = try await transactions.apply(PackageOperations.newSkill(at: created, name: "new-skill", description: "Created skill"))
        let archive = try PackageOperations.archive(fixture.package)
        let imported = FileSystem.join(fixture.root, "imported/workspace-notes")
        _ = try await transactions.apply(PackageOperations.importArchive(archive, to: imported))
        XCTAssertEqual(FileSystem.manifest(fixture.package).digest, FileSystem.manifest(imported).digest)
        let target = FileSystem.join(fixture.home, ".hermes/skills/new-skill")
        _ = try await transactions.apply(PackageOperations.distribute(created, targets: [target]))
        XCTAssertEqual(FileSystem.resolve(target).finalPath, FileSystem.resolve(created).finalPath)
        let index = try WorkspaceScanner().scan(fixture.configuration, searchPath: [])
        let renamed = FileSystem.join(fixture.source, "agents/skills/renamed")
        let receipt = try await transactions.apply(PackageOperations.renamePackage(created, to: renamed, entries: index.entries))
        XCTAssertEqual(FileSystem.resolve(target).finalPath, FileSystem.resolve(renamed).finalPath)
        XCTAssertEqual(SkillValidator.inspect(try FileSystem.text(FileSystem.join(renamed, "SKILL.md")), path: "SKILL.md").fields["name"], "renamed")
        _ = try await transactions.undo(receipt.id)
        XCTAssertEqual(FileSystem.resolve(target).finalPath, FileSystem.resolve(created).finalPath)
    }

    func testMaliciousArchiveAndExternalLinksCannotEscapePackage() throws {
        let fixture = try Fixture()
        var archive = try PackageOperations.archive(fixture.package)
        archive.items.append(.init(path: "../escape", payload: .file(Data())))
        XCTAssertThrowsError(try PackageOperations.importArchive(archive, to: FileSystem.join(fixture.root, "untrusted")))
        try fixture.link("workflow/agents/skills/workspace-notes/secret", target: "/etc/hosts")
        XCTAssertThrowsError(try PackageOperations.archive(fixture.package))
    }

    func testFileRenameUpdatesMarkdownReferencesAndPreservesCode() async throws {
        let fixture = try Fixture()
        let before = FileSystem.join(fixture.package, "references/guide.md")
        let after = FileSystem.join(fixture.package, "references/guide-new.md")
        let document = FileSystem.join(fixture.package, "SKILL.md")
        let tick = String(UnicodeScalar(96)), fence = String(repeating: String(UnicodeScalar(96)), count: 3)
        let original = try FileSystem.text(document) + "\n中文 [说明](references/guide.md#topic)\n\n\(tick)[Guide](references/guide.md)\(tick)\n\n\(fence)md\n[Guide](references/guide.md)\n\(fence)\n"
        try Data(original.utf8).write(to: URL(fileURLWithPath: document))
        let transactions = FileTransactions(directory: FileSystem.join(fixture.root, "journal"))
        _ = try await transactions.apply(PackageOperations.renameFile(before, to: after, packageRoot: fixture.package))
        XCTAssertTrue(try FileSystem.text(FileSystem.join(fixture.package, "SKILL.md")).contains("[Guide](references/guide-new.md)"))
        let updated = try FileSystem.text(document)
        XCTAssertTrue(updated.contains("中文 [说明](references/guide-new.md#topic)"))
        XCTAssertTrue(updated.contains("\(tick)[Guide](references/guide.md)\(tick)"))
        XCTAssertTrue(updated.contains("\(fence)md\n[Guide](references/guide.md)\n\(fence)"))
        XCTAssertEqual(FileSystem.resolve(before).status, .missing)
    }

    func testRenameRefusesUnlocatedReferenceBeforeAnyWrite() throws {
        let fixture = try Fixture()
        try fixture.write("workflow/agents/skills/workspace-notes/SKILL.md", "# Notes\n\n[Guide][manual]\n\n[manual]: references/guide.md\n")
        XCTAssertThrowsError(try PackageOperations.renameFile(FileSystem.join(fixture.package, "references/guide.md"),
            to: FileSystem.join(fixture.package, "references/new.md"), packageRoot: fixture.package))
        XCTAssertEqual(FileSystem.resolve(FileSystem.join(fixture.package, "references/guide.md")).status, .readable)
    }

    func testCompletePackageSyncReviewsExtraFilesPreservesModesAndUndoes() async throws {
        let fixture = try Fixture()
        let target = FileSystem.join(fixture.home, ".codex/skills/workspace-notes")
        let transactions = FileTransactions(directory: FileSystem.join(fixture.root, "journal"))
        _ = try await transactions.apply(PackageOperations.copy(fixture.package, to: target))
        try fixture.write("home/.codex/skills/workspace-notes/local-only.md", "Keep this until a reviewed deletion.")
        try fixture.write("workflow/agents/skills/workspace-notes/scripts/check.sh", "#!/bin/sh\nprintf 'new'\n")
        chmod(FileSystem.join(fixture.package, "scripts/check.sh"), 0o755)
        let before = FileSystem.manifest(target)
        let plan = try PackageOperations.synchronize(fixture.package, to: target)
        XCTAssertTrue(plan.changes.contains { $0.before.path.hasSuffix("local-only.md") && $0.after.kind == nil })
        XCTAssertEqual(FileSystem.manifest(target).digest, before.digest, "Preview must not write")
        let receipt = try await transactions.apply(plan)
        XCTAssertEqual(FileSystem.manifest(target).digest, FileSystem.manifest(fixture.package).digest)
        _ = try await transactions.undo(receipt.id)
        XCTAssertEqual(FileSystem.manifest(target).digest, before.digest)
    }

    func testMarkdownReaderEscapesActiveContentAndScopesImages() throws {
        let fixture = try Fixture()
        try fixture.write("secret.png", "outside package")
        try fixture.link("workflow/agents/skills/workspace-notes/escape.png", target: FileSystem.join(fixture.root, "secret.png"))
        try fixture.write("workflow/agents/skills/workspace-notes/local.png", "local")
        let text = "# Preview\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n![remote](https://example.test/pixel.png)\n![outside](escape.png)\n![local](local.png)\n\n[Guide](references/guide.md)\n"
        let html = MarkdownPreview.html(text, path: FileSystem.join(fixture.package, "SKILL.md"), packageRoot: fixture.package)
        XCTAssertTrue(html.contains("default-src 'none'"))
        XCTAssertTrue(html.contains("&lt;script&gt;"))
        XCTAssertFalse(html.contains("<script>"))
        XCTAssertFalse(html.contains("javascript:"))
        XCTAssertFalse(html.contains("https://example.test"))
        XCTAssertFalse(html.contains(Data("outside package".utf8).base64EncodedString()))
        XCTAssertTrue(html.contains("data:image/png;base64," + Data("local".utf8).base64EncodedString()))
        XCTAssertTrue(html.contains("otter-file://open?path="))
    }

    func testFlatPackageRespectsEntryLimit() throws {
        let fixture = try Fixture()
        let folder = FileSystem.join(fixture.root, "large")
        try FileSystem.privateDirectory(folder)
        for number in 0..<10_001 { FileManager.default.createFile(atPath: FileSystem.join(folder, String(number)), contents: Data()) }
        let manifest = FileSystem.manifest(folder)
        XCTAssertNil(manifest.digest)
        XCTAssertEqual(manifest.files.count, 10_000)
        XCTAssertTrue(manifest.problems.contains { $0.rule == "package.incomplete" })
    }
    func testDraftRoundTripKeepsOriginalForConflictCheck() async throws {
        let fixture = try Fixture()
        let path = FileSystem.join(fixture.package, "SKILL.md")
        let drafts = DraftStore(directory: FileSystem.join(fixture.root, "drafts"))
        try await drafts.save(EditorDraft(original: try .capture(path), text: "unfinished"))
        try fixture.write("workflow/agents/skills/workspace-notes/SKILL.md", "external")
        let stored = await drafts.load(path)
        let loaded = try XCTUnwrap(stored)
        XCTAssertEqual(loaded.text, "unfinished"); XCTAssertFalse(loaded.original.matchesCurrent())
        let alias = FileSystem.join(fixture.home, ".claude/skills/workspace-notes/SKILL.md")
        let fromAlias = await drafts.load(alias)
        XCTAssertEqual(fromAlias?.text, "unfinished", "Reopening through another harness restores the same source draft")
        try await drafts.remove(alias)
        let removed = await drafts.load(path)
        XCTAssertNil(removed)
    }
}

final class RuntimeDiscoveryTests: XCTestCase {
    func testCodexHandshakeDistinguishesDiscoveredDisabledAndFailedExit() async throws {
        let fixture = try Fixture(), executable = FileSystem.join(fixture.root, "codex-fixture")
        let script = """
        #!/usr/bin/python3
        import json,os,sys
        if sys.argv[1:] == ['--version']:
            print('codex-cli 0.154.0'); sys.exit(0)
        assert sys.argv[1:] == ['app-server']
        initialize = json.loads(sys.stdin.readline())
        assert initialize['method'] == 'initialize'
        print(json.dumps({'id': initialize['id'], 'result': {}}), flush=True)
        assert json.loads(sys.stdin.readline())['method'] == 'initialized'
        request = json.loads(sys.stdin.readline())
        assert request['method'] == 'skills/list'
        cwd = request['params']['cwds'][0]
        assert os.path.realpath(cwd) == os.getcwd()
        print(json.dumps({'id': request['id'], 'result': {'data': [{'cwd': cwd, 'skills': [
            {'path': cwd + '/enabled/SKILL.md', 'enabled': True},
            {'path': cwd + '/disabled/SKILL.md', 'enabled': False}], 'errors': []}]}}), flush=True)
        assert sys.stdin.read() == ''
        sys.exit(0)
        """
        try fixture.write("codex-fixture", script); XCTAssertEqual(chmod(executable, 0o755), 0)
        let result = try await RuntimeDiscovery.probe(.codex, executable: executable, cwd: fixture.home)
        XCTAssertTrue(result.supported)
        XCTAssertEqual(result.paths, [FileSystem.join(fixture.home, "enabled/SKILL.md")])
        XCTAssertEqual(result.disabledPaths, [FileSystem.join(fixture.home, "disabled/SKILL.md")])
        try fixture.write("codex-fixture", script.replacingOccurrences(of: "\nsys.exit(0)", with: "\nsys.exit(2)"))
        do { _ = try await RuntimeDiscovery.probe(.codex, executable: executable, cwd: fixture.home); XCTFail("A failed child must not verify discovery") }
        catch { /* a partial response is not a successful runtime observation */ }
    }

    func testGrokInspectIsVersionGatedAndUnsupportedVersionsDoNotProbe() async throws {
        let fixture = try Fixture(), executable = FileSystem.join(fixture.root, "grok-fixture")
        let script = """
        #!/usr/bin/python3
        import json,os,sys
        if sys.argv[1:] == ['--version']:
            print('grok 1.0.30'); sys.exit(0)
        assert sys.argv[1:] == ['inspect', '--json']
        open('inspect-called', 'w').close()
        print(json.dumps({'skills': [{'source': {'path': os.getcwd() + '/skill/SKILL.md'}}]}))
        """
        try fixture.write("grok-fixture", script); XCTAssertEqual(chmod(executable, 0o755), 0)
        let result = try await RuntimeDiscovery.probe(.grok, executable: executable, cwd: fixture.home)
        XCTAssertTrue(result.supported); XCTAssertEqual(result.paths.count, 1)
        let marker = FileSystem.join(fixture.home, "inspect-called")
        XCTAssertTrue(FileManager.default.fileExists(atPath: marker))
        try FileManager.default.removeItem(atPath: marker)
        try fixture.write("grok-fixture", script.replacingOccurrences(of: "1.0.30", with: "1.0.300"))
        let unknown = try await RuntimeDiscovery.probe(.grok, executable: executable, cwd: fixture.home)
        XCTAssertFalse(unknown.supported); XCTAssertTrue(unknown.paths.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: marker), "An unverified version must not run a guessed discovery command")
    }
}

final class ProcessTests: XCTestCase {
    func testFastExitIsObservedEvenWhenPipesDrainAfterTermination() async throws {
        let runner = ProcessRunner()
        for _ in 0..<16 {
            let result = try await runner.run(executable: "/bin/echo", arguments: ["ready"], timeout: 3)
            XCTAssertEqual(result.status, 0)
            XCTAssertEqual(String(decoding: result.stdout, as: UTF8.self), "ready\n")
            XCTAssertFalse(result.timedOut)
        }
    }
    func testConversationKeepsStdinOpenForHandshakeAndFinalResponse() async throws {
        let script = """
        import json,sys
        assert json.loads(sys.stdin.readline())['id']==1
        print('{"id":1,"result":{}}',flush=True)
        assert json.loads(sys.stdin.readline())['id']==2
        print('{"id":2,"result":{"skills":[]}}',flush=True)
        assert sys.stdin.read()==''
        """
        let result = try await ProcessRunner().run(executable: "/usr/bin/python3", arguments: ["-c", script],
            input: Data("{\"id\":1}\n".utf8), timeout: 5, conversation: { line in
                guard let value = try? JSONDecoder().decode(JSONValue.self, from: line) else { return .none }
                return value["id"].number == 1 ? .send(Data("{\"id\":2}\n".utf8)) : .finish
            })
        XCTAssertEqual(result.status, 0)
        XCTAssertFalse(result.cancelled)
        XCTAssertTrue(String(decoding: result.stdout, as: UTF8.self).contains("\"skills\":[]"))
    }

    func testCancellationClosesDescendantPipes() async throws {
        let runner = ProcessRunner(), start = Date()
        let cancel = Task { try await Task.sleep(for: .milliseconds(350)); await runner.cancel() }
        defer { cancel.cancel() }
        let result = try await runner.run(executable: "/usr/bin/python3",
            arguments: ["-c", "import subprocess,time; subprocess.Popen(['/bin/sleep','5']); time.sleep(5)"], timeout: 8)
        XCTAssertTrue(result.cancelled)
        XCTAssertLessThan(Date().timeIntervalSince(start), 3)
    }
    func testStreamsDrainConcurrentlyAndStderrIsBounded() async throws {
        let runner = ProcessRunner()
        let script = "import os; os.write(2,b'e'*400000); os.write(1,b'{\"ok\":true}\\n')"
        let result = try await runner.run(executable: "/usr/bin/python3", arguments: ["-c", script], timeout: 15)
        XCTAssertEqual(result.status, 0)
        XCTAssertEqual(String(decoding: result.stdout, as: UTF8.self), "{\"ok\":true}\n")
        XCTAssertEqual(result.stderr.utf8.count, 256 * 1024)
        XCTAssertEqual(result.truncatedStderrBytes, 400000 - 256 * 1024)
    }
    func testTimeoutTerminatesOwnedProcess() async throws {
        let start = Date()
        let result = try await ProcessRunner().run(executable: "/bin/sleep", arguments: ["30"], timeout: 0.15)
        XCTAssertTrue(result.timedOut); XCTAssertTrue(result.cancelled)
        XCTAssertLessThan(Date().timeIntervalSince(start), 3)
    }
    func testOutputLimitAndProtocolValidation() async throws {
        do { _ = try await ProcessRunner().run(executable: "/usr/bin/python3", arguments: ["-c", "print('x'*100000)"], outputLimit: 1000); XCTFail("Unbounded stdout") } catch { /* expected */ }
        let wrong = Data("{\"protocolVersion\":1,\"jobId\":\"x\",\"sequence\":2,\"type\":\"result\",\"data\":{}}\n".utf8)
        XCTAssertThrowsError(try CLIClient.decodeEvents(wrong, jobID: "x"))
    }
}
