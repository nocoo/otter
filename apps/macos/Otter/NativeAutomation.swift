// The runner only operates on an explicit Debug fixture, using real AppKit input in this process.
import AppKit
import OtterCore
// The macOS 15 SDK predates ScreenCaptureKit's Sendable annotations.
@preconcurrency import ScreenCaptureKit
import SwiftUI

@MainActor final class WeakNativeView { weak var view: NSView?; init(_ view: NSView) { self.view = view } }
private struct NativeAnchor: NSViewRepresentable {
    let id: String
    let store: WorkspaceStore
    func makeNSView(context: Context) -> PassthroughView {
        let view = PassthroughView(); updateNSView(view, context: context); return view
    }
    func updateNSView(_ view: PassthroughView, context: Context) {
        view.attached = { [weak store] view in store?.anchors[id] = WeakNativeView(view) }
        if view.window != nil { view.attached?(view) }
    }
}
@MainActor private final class PassthroughView: NSView {
    var attached: ((NSView) -> Void)?
    override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); if window != nil { attached?(self) } }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
extension View {
    @ViewBuilder func nativeAnchor(_ id: String, store: WorkspaceStore) -> some View {
        #if DEBUG
        self.background(NativeAnchor(id: id, store: store))
        #else
        self
        #endif
    }
}
@MainActor final class NativeAutomation {
    let store: WorkspaceStore
    #if DEBUG
    private var started = false
    private var checks: [String] = []
    private var captures: [[String: Any]] = []
    private var previousApplication: NSRunningApplication?
    private var inputSequence = 0
    private var root: String { (store.dataDirectory as NSString).deletingLastPathComponent }
    private var output: String { FileSystem.join(root, "results") }
    private var resume: Bool { CommandLine.arguments.contains("--automation-resume") }
    #endif
    init(store: WorkspaceStore) { self.store = store }
    func attach(_ window: NSWindow) {
        #if DEBUG
        guard !started, store.isolated else { return }; started = true
        previousApplication = NSWorkspace.shared.frontmostApplication
        NSApp.setActivationPolicy(.regular); NSApp.activate(ignoringOtherApps: true); window.makeKeyAndOrderFront(nil)
        Task { await run(window) }
        #endif
    }

    #if DEBUG
    private func run(_ window: NSWindow) async {
        do {
            try FileSystem.privateDirectory(output)
            try await until("Scanner and packaged CLI become ready", timeout: 35) {
                !self.store.scanning && !self.store.index.entries.isEmpty && self.store.capabilities != nil
            }
            try require(store.cliError == nil, "Packaged CLI accepts the versioned JSON protocol")
            window.setContentSize(NSSize(width: 1280, height: 800)); window.center()
            if resume { try await verifyDraftRecovery(window) }
            else {
                try await verifyWorkspaceLayout(window)
                try await verifyEditor(window)
                try await verifyInstructions(window)
                try await verifyPackageOperations(window)
                try await verifyCLI(window)
                try await capturePages(window)
                try await preparePersistentDraft(window)
            }
            try await store.flushDrafts()
            try writeReport(status: "passed")
            log("PASSED \(checks.count) native checks; \(captures.count) own-window captures.")
            finish()
        } catch {
            let message = String(describing: error)
            log("FAILED: \(message)")
            log("CONTEXT: page=\(store.page.rawValue), selection=\(store.selectedEntryID ?? "none"), document=\(store.activeDocument?.path ?? "none"), active=\(NSApp.isActive), key=\(window.isKeyWindow)")
            try? await capture("failure")
            try? writeReport(status: "failed", error: message)
            if let identifier = Bundle.main.bundleIdentifier { UserDefaults.standard.removePersistentDomain(forName: identifier) }
            previousApplication?.activate(options: [])
            exit(1)
        }
    }

    private func verifyWorkspaceLayout(_ window: NSWindow) async throws {
        try require(Bundle.main.object(forInfoDictionaryKey: "CFBundleIconFile") as? String == "Otter",
                    "App bundle explicitly registers its native icon")
        guard let url = Bundle.main.url(forResource: "Otter", withExtension: "icns"),
              let expected = NSImage(contentsOf: url), let actual = NSApp.applicationIconImage else {
            throw WorkspaceError.message("Application icon is unavailable")
        }
        func renderedIcon(_ image: NSImage) throws -> Data {
            guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
                bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
                let context = NSGraphicsContext(bitmapImageRep: bitmap) else { throw WorkspaceError.message("Icon bitmap unavailable") }
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = context
            let rect = NSRect(x: 0, y: 0, width: 1024, height: 1024)
            context.cgContext.clear(rect); image.draw(in: rect)
            NSGraphicsContext.restoreGraphicsState()
            guard let png = bitmap.representation(using: .png, properties: [:]) else { throw WorkspaceError.message("Icon PNG unavailable") }
            return png
        }
        let actualPNG = try renderedIcon(actual)
        try actualPNG.write(to: URL(fileURLWithPath: FileSystem.join(output, "application-icon.png")))
        let expectedPNG = try renderedIcon(expected)
        try expectedPNG.write(to: URL(fileURLWithPath: FileSystem.join(output, "expected-application-icon.png")))
        guard let actualBitmap = NSBitmapImageRep(data: actualPNG), let expectedBitmap = NSBitmapImageRep(data: expectedPNG),
              actualBitmap.bytesPerRow == expectedBitmap.bytesPerRow,
              actualBitmap.samplesPerPixel == 4, actualBitmap.bitsPerSample == 8,
              actualBitmap.bitmapFormat == expectedBitmap.bitmapFormat,
              let actualBytes = actualBitmap.bitmapData, let expectedBytes = expectedBitmap.bitmapData else {
            throw WorkspaceError.message("Decoded application icon pixels are unavailable")
        }
        // On a 1x display the Dock returns a downsampled representation. Compare visible
        // color rather than requiring identical antialiasing or invisible RGB values.
        let alphaOffset = actualBitmap.bitmapFormat.contains(.alphaFirst) ? 0 : 3
        let unpremultiplied = actualBitmap.bitmapFormat.contains(.alphaNonpremultiplied)
        var difference = 0.0, bounds = CGRect.null
        for y in 0..<actualBitmap.pixelsHigh {
            for x in 0..<actualBitmap.pixelsWide {
                let offset = y * actualBitmap.bytesPerRow + x * 4
                let actualAlpha = Double(actualBytes[offset + alphaOffset]) / 255
                let expectedAlpha = Double(expectedBytes[offset + alphaOffset]) / 255
                difference += abs(actualAlpha - expectedAlpha) * 255
                for component in 0..<4 where component != alphaOffset {
                    difference += abs(Double(actualBytes[offset + component]) * (unpremultiplied ? actualAlpha : 1)
                        - Double(expectedBytes[offset + component]) * (unpremultiplied ? expectedAlpha : 1))
                }
                if actualAlpha >= 0.5 { bounds = bounds.union(CGRect(x: x, y: y, width: 1, height: 1)) }
            }
        }
        let meanDifference = difference / Double(actualBitmap.pixelsWide * actualBitmap.pixelsHigh * 4)
        try require(meanDifference <= 1, "Running Dock icon matches the artwork (mean visible channel error: \(meanDifference))")
        try require(abs(bounds.minX - 100) <= 4 && abs(bounds.minY - 100) <= 4
            && abs(bounds.maxX - 924) <= 4 && abs(bounds.maxY - 924) <= 4,
            "Running Dock icon retains the centered 100 px margin: \(bounds)")

        try await until("Workspace layout anchors are ready") { self.store.anchors["navigation-label.settings"]?.view?.window === window }
        try await Task.sleep(for: .milliseconds(250))
        let sidebar = try frame("sidebar", in: window), brand = try frame("sidebar-brand", in: window)
        let context = try frame("context", in: window), search = try frame("search", in: window)
        try require(window.titleVisibility == .hidden, "Toolbar omits the duplicate product title")
        try require(context.minX >= sidebar.maxX - 4 && context.minX <= sidebar.maxX + 40,
                    "Agent context starts at the leading edge of the workspace: \(context.minX), sidebar ends \(sidebar.maxX)")
        try require(context.maxX < search.minX && abs(context.midY - search.midY) <= 2,
                    "Context and action controls share one toolbar baseline")
        try require(abs(context.width - 178) <= 1 && context.height >= OtterTheme.controlHeight,
                    "Context menu retains its full bordered control bounds")
        let scan = try frame("scan", in: window)
        try require(window.frame.width - scan.maxX >= 0 && window.frame.width - scan.maxX <= 24,
                    "Search and scan remain at the trailing edge of the toolbar: \(window.frame.width - scan.maxX) pt")
        try require(sidebar.maxY - brand.maxY >= 0 && sidebar.maxY - brand.maxY <= 12,
                    "Sidebar branding uses a compact top inset: \(sidebar.maxY - brand.maxY) pt")
        let baseline = try Dictionary(uniqueKeysWithValues: WorkspacePage.allCases.map { page in
            (page, try frame("navigation-label." + page.rawValue, in: window))
        })
        let headingX = try frame("page-heading", in: window).minX
        for target in WorkspacePage.allCases {
            try await page(target)
            try await Task.sleep(for: .milliseconds(220))
            for page in WorkspacePage.allCases {
                let current = try frame("navigation-label." + page.rawValue, in: window), original = baseline[page]!
                try require(abs(current.minX - original.minX) <= 0.5 && abs(current.minY - original.minY) <= 0.5
                    && abs(current.width - original.width) <= 0.5 && abs(current.height - original.height) <= 0.5,
                    "Selecting \(target.rawValue) preserves \(page.rawValue) sidebar text geometry")
            }
            try require(abs(try frame("page-heading", in: window).minX - headingX) <= 1,
                        "\(target.rawValue) page heading shares the workspace leading inset")
            try require(!store.showsInspector && store.anchors["inspector"]?.view?.window == nil,
                        "\(target.rawValue) has no irrelevant inspector control without a resource selection")
            if target == .skills || target == .instructions {
                let search = try frame("library-search", in: window), source = try frame("library-source", in: window)
                let open = try frame("open-resource", in: window), table = try frame("library-table", in: window)
                try require(abs(search.midY - source.midY) <= 1 && abs(source.midY - open.midY) <= 1
                    && abs(search.height - source.height) <= 1 && abs(source.height - open.height) <= 1,
                    "\(target.rawValue) search, source menu and action share height and baseline")
                try require(abs(table.minX - search.minX) <= 1 && abs(table.maxX - open.maxX) <= 1,
                    "\(target.rawValue) table shares both edges with its filter row")
            }
            if target == .settings {
                let appearance = try frame("settings-appearance", in: window), size = try frame("settings-font-size", in: window)
                try require(abs(appearance.minX - size.minX) <= 1 && abs(appearance.maxX - size.maxX) <= 1,
                    "Appearance and font-size controls use one aligned form column")
                let fields = try ["settings-api", "settings-config", "settings-output"].map { try frame($0, in: window) }
                try require(fields.allSatisfy { abs($0.minX - fields[0].minX) <= 1 && abs($0.maxX - fields[0].maxX) <= 1 && abs($0.height - fields[0].height) <= 1 },
                    "Connection fields share label column, width and height")
                try await capture("settings-layout-light")
                if let section = store.anchors["settings-connection-section"]?.view { _ = section.scrollToVisible(section.bounds) }
                try await click("settings-api")
                try require(window.firstResponder is NSTextView, "Styled connection field retains native keyboard focus")
                try await capture("settings-connection-light")
            }
            if target == .backups {
                let section = try frame("snapshots-section", in: window), empty = try frame("snapshots-empty", in: window)
                try require(abs(empty.midX - section.midX) <= 1,
                            "Empty snapshot message is centered inside its full-width card")
                try require(abs(empty.width - (section.width - 2 * OtterTheme.cardInset)) <= 1,
                            "Empty snapshot content fills the card's shared horizontal insets")
                try await capture("backups-empty-light")
            }
        }
        try await page(.overview)
    }

    private func frame(_ id: String, in window: NSWindow) throws -> NSRect {
        window.contentView?.layoutSubtreeIfNeeded()
        guard let view = store.anchors[id]?.view, view.window === window, !view.bounds.isEmpty else {
            throw WorkspaceError.message("Layout anchor unavailable: \(id)")
        }
        return view.convert(view.bounds, to: nil)
    }

    private func verifyEditor(_ window: NSWindow) async throws {
        for type in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            try require(window.standardWindowButton(type)?.isHiddenOrHasHiddenAncestor == false, "Native window control \(type.rawValue) is visible")
        }
        try await capture("overview-light")
        let path = FileSystem.join(store.configuration.home, ".claude/skills/workspace-notes")
        let originalLink = try FileManager.default.destinationOfSymbolicLink(atPath: path)
        try await page(.skills)
        try await click("resource." + path)
        try await until("Native table selects the Claude entry") { self.store.selectedEntryID == path }
        try await click("open-resource")
        try await until("Open button mounts the real source editor") { self.store.activeDocument?.path == FileSystem.join(path, "SKILL.md") && self.store.editor?.window != nil }
        try require(store.currentConsumers.contains { $0.harness == .hermes } && store.currentConsumers.contains { $0.harness == .codex },
                    "Inspector connects the same package to Hermes and Codex")
        try require(store.selectedEntry?.resolution.links.contains { $0.destination == originalLink } == true,
                    "Inspector retains the actual relative link chain")
        if let editor = nativeEditor(in: window), let layout = editor.layoutManager, let container = editor.textContainer {
            layout.ensureLayout(for: container)
            let first = layout.boundingRect(forGlyphRange: NSRange(location: 0, length: 1), in: container)
                .offsetBy(dx: editor.textContainerOrigin.x, dy: editor.textContainerOrigin.y)
            try require(first.minX >= editor.visibleRect.minX && first.maxX <= editor.visibleRect.maxX,
                        "Line ruler never clips the first source character")
        } else { throw WorkspaceError.message("Source layout was not mounted") }
        try await until("Parsed Markdown headings are available for navigation") { self.store.activeDocument?.headings.isEmpty == false }
        let mode = try frame("editor-mode", in: window), inspector = try frame("inspector", in: window)
        try require(abs(mode.midY - inspector.midY) <= 1 && abs(mode.height - inspector.height) <= 1,
                    "Editor mode and inspector controls share height and baseline")
        try await capture("editor-light")
        try await click("editor-mode", fraction: 0.5)
        try await until("Segmented control opens Markdown reading mode") { self.store.editorMode == "阅读" }
        func modeControl(in view: NSView) -> NSSegmentedControl? {
            if let control = view as? NSSegmentedControl, mode.intersects(control.convert(control.bounds, to: nil)) { return control }
            for child in view.subviews { if let control = modeControl(in: child) { return control } }
            return nil
        }
        guard let control = window.contentView.flatMap(modeControl) else { throw WorkspaceError.message("Native segmented control is unavailable") }
        try require(window.makeFirstResponder(control), "Native mode picker accepts keyboard focus")
        // Native segments use arrows for keyboard navigation and Space to activate.
        try key("\u{F703}", code: 124, modifiers: [.function, .numericPad], in: window)
        try key(" ", code: 49, in: window)
        try await until("Right arrow advances the focused editor mode") { self.store.editorMode == "分栏" }
        try key("\u{F702}", code: 123, modifiers: [.function, .numericPad], in: window)
        try key(" ", code: 49, in: window)
        try await until("Left arrow returns to Markdown reading mode") { self.store.editorMode == "阅读" }
        try await capture("reader-light")
        try await click("editor-mode", fraction: 0.16)
        try await until("Source mode returns to the same document") { self.store.editorMode == "源码" && self.store.editor?.window != nil }
        try await click("file.scripts/check-links.sh")
        try await until("File tree opens the auxiliary script") { self.store.activeDocument?.path.hasSuffix("/scripts/check-links.sh") == true && self.store.editor?.window != nil }
        guard let document = store.activeDocument else { throw WorkspaceError.message("Missing script document") }
        let original = document.text
        let script = document.original.target
        try await verifyTextInput(document, in: window)
        try await replaceEditor("x", in: window)
        try key("z", code: 6, modifiers: .command, in: window)
        try await until("Native Cmd-Z restores the original script") { document.text == original }
        let edited = original + "# native save\n"
        try await replaceEditor(edited, in: window)
        try key("s", code: 1, modifiers: .command, in: window)
        try await until("Cmd-S writes through the link to the real source") { !self.store.saving && !document.isDirty && (try? FileSystem.text(script)) == edited }
        try require(try FileManager.default.destinationOfSymbolicLink(atPath: path) == originalLink, "Saving preserves the consumer's link")
        try require(try FileVersion.capture(script).payload.mode == 0o755, "Saving preserves the script's executable mode")
        try key("f", code: 3, modifiers: .command, in: window)
        try await until("Cmd-F displays the native find bar") { self.store.editor?.enclosingScrollView?.isFindBarVisible == true }
        if let editor = store.editor { editor.enclosingScrollView?.isFindBarVisible = false }
        let draft = edited + "# my unsaved draft\n"
        try await replaceEditor(draft, in: window)
        try await page(.settings)
        try await page(.skills)
        try await until("Navigation preserves the dirty editor and buffer") { self.store.activeDocument?.text == draft && self.store.editor?.window != nil }
        let external = original + "# external writer\n"
        try Data(external.utf8).write(to: URL(fileURLWithPath: script))
        try await until("FSEvents diagnoses an external write without dropping the draft", timeout: 8) { document.conflict }
        try await click("save")
        try await until("Save opens the real conflict sheet") { self.store.sheet == .comparison && window.attachedSheet != nil }
        try require(store.comparisonBefore == external && store.comparisonAfter == draft, "Conflict review retains both disk and draft")
        try require(try FileSystem.text(script) == external, "Conflict detection does not overwrite the external file")
        try await capture("conflict-light")
        try await click("sheet-apply")
        try await until("Accepting the merge keeps an editable draft") { self.store.sheet == nil && !document.conflict && document.isDirty }
        try await focusEditor(window)
        try key("s", code: 1, modifiers: .command, in: window)
        try await until("Merged draft saves only after an explicit Cmd-S") { !self.store.saving && !document.isDirty && (try? FileSystem.text(script)) == draft }
        guard let receipt = store.history.first else { throw WorkspaceError.message("Save checkpoint missing") }
        try await page(.workflow)
        try await click("undo." + receipt.id)
        try await until("Native Undo restores the external version from the checkpoint") { self.store.history.first { $0.id == receipt.id }?.undone == true && (try? FileSystem.text(script)) == external }
        try await page(.skills)
        try await until("Undo reloads the clean editor") { document.text == external && !document.isDirty }
        try await click("detach-document")
        try await until("Document opens in a second native window") { NSApp.windows.contains { $0 !== window && $0.isVisible && self.nativeEditor(in: $0) != nil } }
        guard let detached = NSApp.windows.first(where: { $0 !== window && $0.isVisible && nativeEditor(in: $0) != nil }) else { throw WorkspaceError.message("Detached editor missing") }
        let detachedText = external + "# saved from a document window\n"
        try await replaceEditor(detachedText, in: detached)
        try key("s", code: 1, modifiers: .command, in: detached)
        try await until("Cmd-S in a separate window saves its own document") { !self.store.saving && !document.isDirty && (try? FileSystem.text(script)) == detachedText }
        try await until("Both native editors share the committed source buffer") { self.nativeEditor(in: window)?.string == detachedText }
        try await capture("detached-editor-light", window: detached)
        try await prepareInput(detached)
        guard let close = detached.standardWindowButton(.closeButton) else { throw WorkspaceError.message("Document close button missing") }
        let button = close.convert(close.bounds, to: nil)
        try mouse(at: NSPoint(x: button.midX, y: button.midY), in: detached)
        try await until("Closing a document window leaves the workspace running") { !detached.isVisible && window.isVisible }
        try await focusEditor(window)
    }

    private func verifyTextInput(_ document: EditorDocument, in window: NSWindow) async throws {
        let original = document.text
        try await replaceEditor("alpha\nbeta\n", in: window)
        try key("a", code: 0, modifiers: .command, in: window)
        try await until("Indentation starts with both complete lines selected") { self.nativeEditor(in: window)?.selectedRange().length == 11 }
        try key("\t", code: 48, in: window)
        try await until("Tab indents selected lines without deleting them") { document.text == "    alpha\n    beta\n" }
        try key("\u{19}", code: 48, modifiers: .shift, in: window)
        try await until("Shift-Tab restores selected line indentation") { document.text == "alpha\nbeta\n" }
        try await replaceEditor("", in: window)
        guard let editor = nativeEditor(in: window) else { throw WorkspaceError.message("Input editor missing") }
        editor.insertText("(", replacementRange: editor.selectedRange())
        try await until("Native bracket insertion pairs and positions the caret") { document.text == "()" && editor.selectedRange().location == 1 }
        editor.insertText(")", replacementRange: editor.selectedRange())
        try require(document.text == "()" && editor.selectedRange().location == 2, "Typing the paired closing bracket advances the caret")
        try key("a", code: 0, modifiers: .command, in: window)
        try await until("Composition begins with the document selected") { editor.selectedRange().length == 2 }
        editor.setMarkedText("pei zhi", selectedRange: NSRange(location: 7, length: 0), replacementRange: editor.selectedRange())
        try require(editor.hasMarkedText(), "NSTextInputClient accepts an IME composition")
        store.showProblems.toggle()
        try await Task.sleep(for: .milliseconds(350))
        try require(editor.hasMarkedText(), "View updates and validation preserve marked text")
        editor.insertText("配置", replacementRange: editor.markedRange())
        try await until("Chinese IME commit updates the shared document buffer") { !editor.hasMarkedText() && document.text == "配置" }
        store.showProblems.toggle()
        try await replaceEditor(original, in: window)
        try require(!document.isDirty, "Input verification leaves the disk baseline unchanged")
    }

    private func verifyInstructions(_ window: NSWindow) async throws {
        let legacy = FileSystem.join(store.configuration.home, ".codex/instructions.md")
        let target = FileSystem.join(store.configuration.home, ".codex/AGENTS.md")
        let source = FileSystem.join(root, "workflow/agents/AGENTS.md")
        let original = try FileSystem.text(legacy)
        try await page(.instructions)
        try await until("Instruction navigation shows its own resource library") { !self.store.editorIsOpen }
        try await click("resource." + legacy)
        try await click("compare-source")
        try await until("Legacy instructions can be compared with their explicit Workflow source") { self.store.sheet == .comparison }
        try require(store.comparisonBefore == original && store.comparisonAfter == (try FileSystem.text(source)), "Instruction review uses the current bytes of both files")
        try await capture("instruction-comparison-light")
        try await click("sheet-cancel")
        try await click("fix-instructions")
        try await until("AGENTS entry creation is reviewed before changing disk") { self.store.sheet == .changes }
        try require(FileSystem.resolve(target).status == .missing && (try FileSystem.text(legacy)) == original, "Instruction preview preserves the existing entry")
        try require(store.pendingChanges?.changes.contains { $0.before.path == target && $0.after.link == source } == true,
                    "AGENTS review specifies the real source and target")
        try await click("sheet-apply")
        try await until("Reviewed AGENTS link resolves to Workflow") { self.store.sheet == nil && FileSystem.resolve(target).finalPath == source }
        try require(try FileSystem.text(legacy) == original, "AGENTS repair preserves legacy content for comparison")
        try await until("Scanner indexes the repaired Codex instruction entry") { self.store.index.entries.contains { $0.path == target && $0.relationship == .symlink } }
    }

    private func verifyPackageOperations(_ window: NSWindow) async throws {
        try key("n", code: 45, modifiers: .command, in: window)
        try await until("Cmd-N opens the native skill creation form") { self.store.sheet == .create && window.attachedSheet != nil }
        try await replaceField("new-skill-name", with: "native-check")
        try await replaceField("new-skill-description", with: "Check local workspace changes with an explicit review.")
        try await click("sheet-apply")
        try await until("Create shows a concrete change review") { self.store.sheet == .changes && self.store.pendingChanges != nil }
        let package = FileSystem.join(root, "workflow/agents/skills/native-check")
        try require(FileSystem.resolve(package).status == .missing, "Creation preview has no disk side effects")
        try await capture("changes-light")
        try await click("sheet-apply")
        try await until("Reviewed creation writes and opens SKILL.md") { self.store.sheet == nil && self.store.editorRoot == package && self.store.activeDocument?.path == FileSystem.join(package, "SKILL.md") }
        try require(SkillValidator.inspect(try FileSystem.text(FileSystem.join(package, "SKILL.md")), path: FileSystem.join(package, "SKILL.md")).problems.isEmpty,
                    "Created skill passes the real YAML and Agent Skills validator")
        try await click("new-file")
        try await until("File tree opens the new-file sheet") { self.store.sheet == .newFile }
        try await replaceField("new-file-path", with: "scripts/native-check.sh")
        try await click("sheet-apply")
        try await until("New auxiliary file is reviewable") { self.store.sheet == .changes }
        try await click("sheet-apply")
        try await until("New file opens from disk") { self.store.sheet == nil && self.store.activeDocument?.path.hasSuffix("/scripts/native-check.sh") == true }
        try require(try FileVersion.capture(FileSystem.join(package, "scripts/native-check.sh")).payload.mode == 0o755, "New shell resources retain executable mode")
        try await click("distribute")
        try await until("Distribute opens the target picker") { self.store.sheet == .distribute }
        try await click("distribute.hermes:cherry")
        try await click("sheet-apply")
        try await until("Distribution reviews complete package links") { self.store.sheet == .changes }
        let shared = FileSystem.join(store.configuration.home, ".agents/skills/native-check")
        let cherry = FileSystem.join(store.configuration.home, ".hermes/profiles/cherry/skills/native-check")
        try require(store.pendingChanges?.changes.contains { $0.before.path == cherry && $0.after.kind == .symlink } == true, "Named Hermes profile receives a package-directory link")
        try require(FileSystem.resolve(shared).status == .missing, "Distribution waits for review before changing entries")
        try await click("sheet-apply")
        try await until("Review applies shared and profile links") { self.store.sheet == nil && FileSystem.resolve(shared).finalPath == package && FileSystem.resolve(cherry).finalPath == package }
        try await until("Scanner reports the new shared consumers") { self.store.index.entries.contains { $0.path == shared && $0.relationship == .symlink } }
        guard let receipt = store.history.first else { throw WorkspaceError.message("Distribution checkpoint missing") }
        try await page(.workflow)
        try await click("undo." + receipt.id)
        try await until("Undo removes only the distributed links") { self.store.history.first { $0.id == receipt.id }?.undone == true && FileSystem.resolve(shared).status == .missing && FileSystem.resolve(cherry).status == .missing }
        try require(FileSystem.resolve(FileSystem.join(package, "scripts/native-check.sh")).status == .readable, "Distribution undo preserves the source package")
        try key("k", code: 40, modifiers: .command, in: window)
        try await until("Cmd-K opens global resource search") { self.store.sheet == .search }
        try await replaceField("global-search-field", with: "native-check")
        try await click("search-result." + package)
        try await until("Search opens the matching real skill") { self.store.sheet == nil && self.store.activeDocument?.path == FileSystem.join(package, "SKILL.md") }
    }

    private func verifyCLI(_ window: NSWindow) async throws {
        try await page(.backups)
        try await click("cli-scan")
        try await until("Packaged CLI scans and persists the isolated snapshot", timeout: 40) { self.store.jobs.first?.phase == "partial" && !self.store.snapshots.isEmpty }
        try require(store.jobs.first?.completedCollectors.count == 5, "Progress reports the workspace and all four isolated file collectors")
        try require(store.jobs.first?.result?["snapshot"]["workspace"]["coverage"]["issues"].array.contains { $0["path"].string?.hasSuffix("/skills/moved-skill") == true && $0["status"].string == "error" } == true,
                    "The known broken entry is explicitly reported as a coverage gap")
        try await click("snapshot.0")
        try await until("Snapshot review loads the actual saved object") { self.store.sheet == .snapshot && self.store.selectedSnapshot?["sha256"].string != nil }
        guard let reviewed = store.selectedSnapshot, let id = reviewed["snapshot"]["id"].string else { throw WorkspaceError.message("Missing reviewed snapshot") }
        try JSONEncoder().encode(reviewed).write(to: URL(fileURLWithPath: FileSystem.join(output, "reviewed-snapshot.json")))
        try await capture("snapshot-light")
        // Change a live input after review. Upload must use the saved object, with no rescan.
        try Data("export EDITOR=nano\n".utf8).write(to: URL(fileURLWithPath: FileSystem.join(store.configuration.home, ".zshrc")))
        try await click("sheet-apply")
        try await until("Real gzip upload completes against the loopback fixture server", timeout: 20) { self.store.jobs.first?.isUpload == true && self.store.jobs.first?.phase == "complete" }
        try require(store.jobs.first?.result?["snapshotId"].string == id && store.jobs.first?.result?["sha256"] == reviewed["sha256"], "Upload preserves the reviewed snapshot ID and SHA-256")
        try await capture("upload-complete-light")
        try await click("snapshot.0")
        try await until("The same snapshot can be reviewed again") { self.store.sheet == .snapshot }
        let savedPath = try FileSystem.children(store.configuration.cliOutputDirectory).map { FileSystem.join(store.configuration.cliOutputDirectory, $0) }.first { path in
            guard let data = try? FileSystem.read(path), let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return false }
            return value["id"].string == id
        }
        guard let savedPath else { throw WorkspaceError.message("Could not locate the isolated snapshot") }
        let savedBytes = try FileSystem.read(savedPath)
        var object = try JSONSerialization.jsonObject(with: savedBytes) as! [String: Any]
        var machine = object["machine"] as! [String: Any]; machine["hostname"] = "changed-after-review"; object["machine"] = machine
        try JSONSerialization.data(withJSONObject: object).write(to: URL(fileURLWithPath: savedPath))
        try await click("sheet-apply")
        try await until("Changed snapshot is rejected before a second upload") { self.store.jobs.first?.phase == "failed" && self.store.jobs.first?.error?.contains("changed since review") == true }
        try savedBytes.write(to: URL(fileURLWithPath: savedPath))
        try await click("snapshot.0")
        try await until("Restored snapshot can be reviewed for cancellation test") { self.store.sheet == .snapshot }
        try Data().write(to: URL(fileURLWithPath: FileSystem.join(root, "hold-upload")))
        try await click("sheet-apply")
        try await until("A second real upload reaches the loopback server") { FileManager.default.fileExists(atPath: FileSystem.join(self.root, "upload-held.json")) }
        try await click("cancel-job")
        try await until("Native Cancel terminates the owned CLI task", timeout: 8) { self.store.jobs.first?.phase == "cancelled" && self.store.jobs.first?.isRunning == false }
        try require(store.jobs.first?.error?.contains("待确认") == true, "Cancelled uploads explicitly preserve uncertain server acceptance")
        try FileManager.default.removeItem(atPath: FileSystem.join(root, "hold-upload"))
        try require(try FileSystem.read(savedPath) == savedBytes, "Failure and cancellation leave the local snapshot intact")
    }

    private func capturePages(_ window: NSWindow) async throws {
        for dark in [false, true] {
            store.configuration.appearance = dark ? "dark" : "light"
            window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
            for target in [WorkspacePage.overview, .agents, .instructions, .skills, .workflow, .backups, .environment, .settings] {
                if target == .instructions { store.closeEditor() }
                try await page(target)
                try await capture(target.rawValue + (dark ? "-dark" : "-light"))
            }
        }
        try await page(.skills)
        let package = FileSystem.join(root, "workflow/agents/skills/native-check")
        try await click("resource." + package); try await click("open-resource")
        try await until("Editor reopens for compact-window verification") { self.store.editor?.window != nil && self.store.activeDocument?.path.hasSuffix("/native-check/SKILL.md") == true }
        window.setContentSize(NSSize(width: 1000, height: 680))
        try await until("Minimum window width collapses the inline inspector") { !self.store.showsInspector }
        try require((store.editor?.enclosingScrollView?.contentSize.width ?? 0) >= 420, "Minimum-size editor preserves readable working width")
        try await capture("compact-dark")
        try await click("inspector")
        try await until("Inspector remains reachable in the compact window") { self.store.compactInspector }
        try await capture("compact-inspector-dark")
        store.compactInspector = false
        window.setContentSize(NSSize(width: 1280, height: 800))
        store.configuration.appearance = "light"; window.appearance = NSAppearance(named: .aqua)
        store.saveConfiguration()
    }

    private func preparePersistentDraft(_ window: NSWindow) async throws {
        guard let document = store.activeDocument else { throw WorkspaceError.message("Missing draft document") }
        let text = document.text + "\nDraft restored after application restart.\n"
        try await replaceEditor(text, in: window)
        try await until("Draft is persisted privately before quitting") { document.savedDraft && document.isDirty }
        try require(!(try FileSystem.text(document.path)).contains("Draft restored after application restart."), "Draft persistence never implicitly saves the source")
        try await capture("draft-light")
    }
    private func verifyDraftRecovery(_ window: NSWindow) async throws {
        try require(store.jobs.contains { $0.phase == "cancelled" && $0.snapshotID != nil }, "Restart preserves the cancelled upload and its snapshot ID")
        try require(store.jobs.contains { $0.phase == "complete" && $0.isUpload }, "Restart preserves the completed upload record")
        try require(!store.jobs.contains(where: \.isRunning), "Restart never automatically retries a journaled upload")
        let path = FileSystem.join(root, "workflow/agents/skills/native-check")
        try await page(.skills); try await click("resource." + path); try await click("open-resource")
        try await until("Restart restores the saved dirty draft", timeout: 10) { self.store.activeDocument?.text.contains("Draft restored after application restart.") == true && self.store.activeDocument?.isDirty == true }
        try require(store.activeDocument?.savedDraft == true && store.activeDocument?.conflict == false, "Recovered draft keeps its original disk baseline")
        try require(!(try FileSystem.text(FileSystem.join(path, "SKILL.md"))).contains("Draft restored after application restart."), "Restart leaves source bytes unchanged")
        try await capture("recovered-draft-light")
    }

    private func page(_ page: WorkspacePage) async throws {
        try await click("navigation." + page.rawValue)
        try await until("Sidebar opens \(page.rawValue)") { self.store.page == page }
    }
    private func nativeEditor(in window: NSWindow) -> CodeTextView? {
        func find(_ view: NSView) -> CodeTextView? {
            if let text = view as? CodeTextView { return text }
            for child in view.subviews { if let text = find(child) { return text } }
            return nil
        }
        return window.contentView.flatMap(find)
    }
    private func focusEditor(_ window: NSWindow) async throws {
        try await until("Editor is mounted") { self.nativeEditor(in: window) != nil }
        guard let editor = nativeEditor(in: window) else { throw WorkspaceError.message("Native editor missing") }
        try await prepareInput(window)
        let rect = editor.convert(editor.visibleRect, to: nil)
        try mouse(at: NSPoint(x: rect.midX, y: rect.midY), in: window)
        try await until("Mouse focuses NSTextView") { window.firstResponder === editor }
    }
    private func replaceEditor(_ text: String, in window: NSWindow) async throws {
        try await focusEditor(window)
        try key("a", code: 0, modifiers: .command, in: window)
        try await until("Cmd-A selects the full source buffer") { self.store.editor?.selectedRange().length == (self.store.activeDocument?.text as NSString?)?.length }
        // Commit through NSTextInputClient, as an IME/paste does. A synthetic keyCode cannot
        // represent an arbitrary Unicode string on the user's current keyboard layout.
        guard let editor = store.editor else { throw WorkspaceError.message("Editor missing during text input") }
        editor.inputContext?.discardMarkedText()
        editor.breakUndoCoalescing()
        editor.insertText(text, replacementRange: editor.selectedRange())
        editor.breakUndoCoalescing()
        try await until("NSTextInputClient commits text into the document") { self.store.activeDocument?.text == text }
    }
    private func replaceField(_ id: String, with text: String) async throws {
        try await click(id)
        guard let window = store.anchors[id]?.view?.window else { throw WorkspaceError.message("Field missing: \(id)") }
        try key("a", code: 0, modifiers: .command, in: window)
        try await Task.sleep(for: .milliseconds(80))
        guard let editor = window.firstResponder as? NSTextView else { throw WorkspaceError.message("Field editor not focused: \(id)") }
        editor.inputContext?.discardMarkedText()
        editor.insertText(text, replacementRange: editor.selectedRange())
        try await Task.sleep(for: .milliseconds(100))
    }
    private func click(_ id: String, fraction: CGFloat = 0.5) async throws {
        let deadline = Date().addingTimeInterval(5)
        while store.anchors[id]?.view?.window == nil && Date() < deadline { try await Task.sleep(for: .milliseconds(30)) }
        try await Task.sleep(for: .milliseconds(140))
        guard let view = store.anchors[id]?.view, let window = view.window,
              window === store.window || window.sheetParent === store.window else { throw WorkspaceError.message("Native control unavailable: \(id)") }
        _ = view.scrollToVisible(view.bounds)
        try await Task.sleep(for: .milliseconds(70))
        try await prepareInput(window)
        guard let current = store.anchors[id]?.view, current.window === window else { throw WorkspaceError.message("Native control changed windows: \(id)") }
        let rect = current.convert(current.bounds, to: nil)
        guard rect.width > 0, rect.height > 0, rect.intersects(window.contentView?.bounds ?? .zero) else { throw WorkspaceError.message("Native control outside window: \(id) \(rect)") }
        try mouse(at: NSPoint(x: rect.minX + rect.width * fraction, y: rect.midY), in: window)
    }
    private func prepareInput(_ window: NSWindow) async throws {
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        try await until("Own native window accepts input") { NSApp.isActive && window.isKeyWindow }
    }
    // Own-process NSEvents use the same responder path as Showtime's native automation.
    private func mouse(at point: NSPoint, in window: NSWindow) throws {
        let time = ProcessInfo.processInfo.systemUptime
        inputSequence += 2
        guard let down = NSEvent.mouseEvent(with: .leftMouseDown, location: point, modifierFlags: [],
            timestamp: time, windowNumber: window.windowNumber, context: nil, eventNumber: inputSequence, clickCount: 1, pressure: 1),
              let up = NSEvent.mouseEvent(with: .leftMouseUp, location: point, modifierFlags: [],
            timestamp: time + 0.02, windowNumber: window.windowNumber, context: nil, eventNumber: inputSequence + 1, clickCount: 1, pressure: 0) else { throw WorkspaceError.message("Could not create mouse event") }
        // Route to this owned window immediately; queued global activation events must
        // not consume a control click. Its tracking loop still receives the real mouse-up.
        NSApp.postEvent(up, atStart: true)
        window.sendEvent(down)
    }
    private func key(_ characters: String, code: UInt16, modifiers: NSEvent.ModifierFlags = [], in window: NSWindow) throws {
        NSApp.mainMenu?.update()
        guard let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: modifiers,
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil,
            characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code) else { throw WorkspaceError.message("Could not create key event") }
        NSApp.postEvent(event, atStart: false)
    }
    private func until(_ message: String, timeout: TimeInterval = 6, condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() && Date() < deadline { try await Task.sleep(for: .milliseconds(25)) }
        try require(condition(), message + (condition() ? "" : " · \(store.error ?? store.cliError ?? store.status)"))
    }
    private func require(_ condition: Bool, _ message: String) throws {
        guard condition else { throw WorkspaceError.message(message) }
        checks.append(message); log("PASS: " + message)
    }
    private func capture(_ name: String, window targetWindow: NSWindow? = nil) async throws {
        guard !CommandLine.arguments.contains("--automation-no-capture") else { return }
        try await Task.sleep(for: .milliseconds(500))
        guard let window = targetWindow ?? store.window else { throw WorkspaceError.message("No own window") }
        window.contentView?.layoutSubtreeIfNeeded()
        let content = try await SCShareableContent.currentProcess
        guard let own = content.windows.first(where: { $0.windowID == CGWindowID(window.windowNumber) && $0.owningApplication?.processID == ProcessInfo.processInfo.processIdentifier }) else { throw WorkspaceError.message("Own window unavailable for capture") }
        let filter = SCContentFilter(desktopIndependentWindow: own), options = SCStreamConfiguration()
        options.includeChildWindows = true; options.showsCursor = false; options.capturesAudio = false
        options.ignoreShadowsSingleWindow = true
        let pixelScale = CGFloat(filter.pointPixelScale)
        options.width = Int(filter.contentRect.width * pixelScale); options.height = Int(filter.contentRect.height * pixelScale)
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: options)
        guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { throw WorkspaceError.message("PNG encoding failed") }
        let file = name + ".png"
        try png.write(to: URL(fileURLWithPath: FileSystem.join(output, file)))
        captures.append(["file": file, "pixels": [image.width, image.height], "windowPoints": [window.frame.width, window.frame.height], "inspectorVisible": store.showsInspector])
    }
    private func writeReport(status: String, error: String? = nil) throws {
        var value: [String: Any] = ["kind": "production-native-fixture", "status": status, "bundleID": Bundle.main.bundleIdentifier ?? "",
            "os": ProcessInfo.processInfo.operatingSystemVersionString, "checks": checks, "captures": captures,
            "limits": ["Isolated fixture files and loopback uploads", "Own-process AppKit input; no system-wide Accessibility or recording permission", "No signed distribution, full VoiceOver or macOS 15 runtime validation"]]
        if let error { value["error"] = error }
        try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: FileSystem.join(output, resume ? "recovery.json" : "verification.json")))
    }
    private func log(_ text: String) { FileHandle.standardOutput.write(Data((text + "\n").utf8)) }
    private func finish() {
        if let identifier = Bundle.main.bundleIdentifier { UserDefaults.standard.removePersistentDomain(forName: identifier) }
        previousApplication?.activate(options: []); NSApp.terminate(nil)
    }
    #endif
}
