// Isolated host and own-window capture adapted from Lyre's native preview.
// Native input follows Showtime's StudioWindow event path. See SOURCES.md (MIT).
import AppKit
import ScreenCaptureKit
import SwiftUI

enum StudyScene: String, CaseIterable, Identifiable {
    case overview, agents, instructions, skills, editor, workflow, backups, settings
    case changes, compact, conflict, empty
    var id: String { rawValue }
    var size: NSSize {
        self == .compact ? NSSize(width: 1000, height: 680) : NSSize(width: 1280, height: 800)
    }
}

@MainActor final class WeakView {
    weak var view: NSView?
    init(_ view: NSView) { self.view = view }
}

struct PreviewAnchor: NSViewRepresentable {
    let id: String
    let model: PreviewWorkspace
    func makeNSView(context: Context) -> NSView {
        let view = PassthroughView()
        model.anchors[id] = WeakView(view)
        return view
    }
    func updateNSView(_ view: NSView, context: Context) { model.anchors[id] = WeakView(view) }
}

@MainActor final class PassthroughView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

enum StudyError: Error, CustomStringConvertible {
    case failed(String)
    var description: String { switch self { case .failed(let message): message } }
}

@MainActor @Observable final class PreviewRunner {
    let model = PreviewWorkspace()
    private var started = false
    private var checks: [String] = []
    private var captures: [[String: Any]] = []
    private var previousApplication: NSRunningApplication?

    init() {
        if let url = Bundle.main.url(forResource: "OtterIcon", withExtension: "png"), let image = NSImage(contentsOf: url) {
            image.setName("OtterIcon")
        }
    }

    func attach(_ window: NSWindow) {
        model.window = window
        guard !started else { return }
        started = true
        previousApplication = NSWorkspace.shared.frontmostApplication
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        let args = CommandLine.arguments
        if let index = args.firstIndex(of: "--render"), args.indices.contains(index + 1) {
            let directory = URL(fileURLWithPath: args[index + 1], isDirectory: true)
            Task { await render(into: directory) }
        }
    }

    func show(_ scene: StudyScene) async {
        model.sheet = nil
        model.compactInspector = false
        model.hasConflict = false
        model.inspectorRequested = true
        model.editorOpen = [.editor, .compact, .conflict].contains(scene)
        model.packageID = "workspace-notes"
        model.file = "SKILL.md"
        model.openFiles = ["SKILL.md", "references/conventions.md"]
        model.editorMode = "源码"
        model.inspectorTab = "元数据"
        model.context = scene == .instructions || scene == .changes ? "Codex · 用户" : "全部 Agents"
        model.skillSearch = scene == .empty ? "no-such-skill" : ""
        model.sourceFilter = "所有来源"
        model.bindingSource = "AGENTS.md"
        model.selectedSkills = ["workspace-notes"]
        model.buffers = [:]
        model.saved = [:]
        model.job = scene == .backups ? "scanning" : "idle"
        model.snapshotID = "demo-20260915-0932"
        model.settingsTab = "通用"
        model.instructionKind = "指令"
        model.hint = "索引已就绪 · 09:41"
        switch scene {
        case .overview: model.page = .overview
        case .agents: model.page = .agents
        case .instructions, .changes: model.page = .instructions
        case .skills, .editor, .compact, .conflict, .empty: model.page = .skills
        case .workflow: model.page = .workflow
        case .backups: model.page = .backups
        case .settings: model.page = .settings
        }
        if scene == .conflict {
            model.descriptionText = "整理项目笔记与引用。"
            model.hasConflict = true
        }
        try? await Task.sleep(for: .milliseconds(160))
        if let window = model.window {
            let screen = window.screen?.visibleFrame ?? NSRect(origin: .zero, size: scene.size)
            let chromeHeight = window.frame.height - window.contentLayoutRect.height
            window.setFrame(NSRect(origin: window.frame.origin,
                size: NSSize(width: min(scene.size.width, screen.width),
                             height: min(scene.size.height + chromeHeight, screen.height))), display: true)
            window.center()
        }
        try? await Task.sleep(for: .milliseconds(200))
        if scene == .changes { model.sheet = .change }
    }

    private func render(into directory: URL) async {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await verifyNativeInput()
            let requested = ProcessInfo.processInfo.environment["OTTER_PREVIEW_SCENES"]?.split(separator: ",").map(String.init)
            let scenes = StudyScene.allCases.filter { requested?.contains($0.rawValue) ?? true }
            guard !scenes.isEmpty else { throw StudyError.failed("No matching preview scenes") }
            for dark in [false, true] {
                model.dark = dark
                model.window?.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                for scene in scenes {
                    await show(scene)
                    try await Task.sleep(for: .milliseconds(650))
                    if let window = model.window, window.attachedSheet == nil {
                        NSApp.activate(ignoringOtherApps: true)
                        window.makeKeyAndOrderFront(nil)
                    }
                    model.window?.makeFirstResponder(nil)
                    model.window?.contentView?.layoutSubtreeIfNeeded()
                    try await Task.sleep(for: .milliseconds(100))
                    let name = scene.rawValue + (dark ? "-dark" : "-light") + ".png"
                    try await capture(to: directory.appendingPathComponent(name))
                    if [.editor, .compact, .conflict].contains(scene), let text = model.editor {
                        try require(text.visibleRect.width >= 470, "\(name): editor preserves readable width")
                        try require((model.anchors["editor-mode"]?.view?.frame.height ?? 999) <= 40, "\(name): editor mode control stays compact")
                    }
                    if scene == .compact { try require(!model.showsInspector, "\(name): compact inspector collapsed") }
                }
            }
            let report: [String: Any] = [
                "kind": "isolated-native-design-preview",
                "status": "passed",
                "bundleID": Bundle.main.bundleIdentifier ?? "",
                "os": ProcessInfo.processInfo.operatingSystemVersionString,
                "processID": ProcessInfo.processInfo.processIdentifier,
                "checks": checks,
                "captures": captures,
                "limits": ["Synthetic data only", "No scanner, YAML parser, real save, CLI or uploads", "No full VoiceOver, IME, macOS 15 runtime or release validation"]
            ]
            try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
                .write(to: directory.appendingPathComponent("verification.json"))
            print("Rendered \(captures.count) native previews; \(checks.count) checks passed.")
            finish()
        } catch {
            FileHandle.standardError.write(Data("Preview failed: \(error)\n".utf8))
            if let identifier = Bundle.main.bundleIdentifier { UserDefaults.standard.removePersistentDomain(forName: identifier) }
            previousApplication?.activate(options: [])
            exit(1)
        }
    }

    private func capture(to url: URL) async throws {
        // currentProcess excludes other applications and requires no global recording consent.
        let content = try await SCShareableContent.currentProcess
        guard let window = model.window, let own = content.windows.first(where: {
            $0.windowID == CGWindowID(window.windowNumber)
                && $0.owningApplication?.processID == ProcessInfo.processInfo.processIdentifier
        }) else { throw StudyError.failed("Own preview window was not available for capture") }
        let filter = SCContentFilter(desktopIndependentWindow: own)
        let options = SCStreamConfiguration()
        options.includeChildWindows = true
        options.width = Int(filter.contentRect.width * 2)
        options.height = Int(filter.contentRect.height * 2)
        options.showsCursor = false
        options.capturesAudio = false
        options.ignoreShadowsSingleWindow = true
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: options)
        guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
        else { throw StudyError.failed("PNG encoding failed") }
        try png.write(to: url)
        captures.append(["file": url.lastPathComponent, "pixels": [image.width, image.height],
                         "windowPoints": [window.frame.width, window.frame.height],
                         "contentLayoutPoints": [window.contentLayoutRect.width, window.contentLayoutRect.height],
                         "workspaceWidth": model.availableWidth, "inspectorVisible": model.showsInspector])
    }

    private func verifyNativeInput() async throws {
        await show(.overview)
        try await Task.sleep(for: .milliseconds(350))
        guard let window = model.window else { throw StudyError.failed("Window missing") }
        for type in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            try require(window.standardWindowButton(type)?.isHiddenOrHasHiddenAncestor == false, "Native window button \(type.rawValue) visible")
        }
        if let context = model.anchors["context"]?.view {
            let frame = context.convert(context.bounds, to: nil)
            try require(context.window === window && frame.width >= 170 && frame.height >= 30
                && frame.minX >= 0 && frame.maxX <= window.frame.width,
                "Context menu occupies a visible toolbar position (frame \(frame), window \(context.window?.windowNumber ?? -1) / \(window.windowNumber))")
        } else { throw StudyError.failed("Toolbar context menu was missing") }
        try await click("navigation.skills")
        try await until("Native sidebar opens Skills") { self.model.page == .skills }
        try await click("open-skill")
        try await until("Native button opens editor") { self.model.editorOpen && self.model.editor?.window != nil }
        guard let editor = model.editor else { throw StudyError.failed("Native editor missing") }
        let original = model.activeText
        let rect = editor.convert(editor.visibleRect, to: nil)
        try mouse(at: NSPoint(x: rect.midX, y: rect.midY), in: window)
        try await until("Mouse focuses NSTextView") { window.firstResponder === editor }
        try key("a", code: 0, modifiers: .command, in: window)
        try await until("Cmd-A selects source") { editor.selectedRange().length == (original as NSString).length }
        try key("x", code: 7, in: window)
        try await until("Native typing updates buffer") { self.model.activeText == "x" }
        try key("z", code: 6, modifiers: .command, in: window)
        try await until("Cmd-Z restores source") { self.model.activeText == original }
        try await click("file.scripts/check-links.sh")
        try await until("Native file selection changes document") { self.model.file == "scripts/check-links.sh" }
        try await click("navigation.settings")
        try await until("Native navigation opens Settings") { self.model.page == .settings }
        try await click("navigation.skills")
        try await until("Editor session survives navigation") { self.model.page == .skills && self.model.editorOpen && self.model.file == "scripts/check-links.sh" }
        try await click("fix")
        try await until("Quick Fix opens native sheet") { self.model.sheet == .fix && window.attachedSheet != nil }
        try await click("sheet-apply")
        try await until("Review action updates only example metadata") { self.model.sheet == nil && !self.model.hasProblem }
        try await click("save")
        try await until("Save is explicitly an in-memory example") { self.model.hint.hasPrefix("已保存示例") }
        let draft = model.skillText
        window.setContentSize(NSSize(width: 1000, height: 680))
        try await until("Resize collapses inline inspector") { !self.model.showsInspector }
        try require(model.skillText == draft, "Resize preserves draft")
        try await click("inspector")
        try await until("Compact inspector remains accessible") { self.model.compactInspector }
        model.compactInspector = false
        await show(.backups)
        try await click("cancel-job")
        try await until("Cancel keeps partial example results") { self.model.job == "cancelled" }
        try await click("snapshot.demo-20260914-1820")
        try await until("Snapshot review preserves selected object identity") {
            self.model.sheet == .upload && self.model.snapshotID == "demo-20260914-1820"
        }
        await show(.empty)
        try await click("clear-search")
        try await until("Clear search restores library") { self.model.visibleSkills.count == ExampleSkill.all.count }
    }

    private func require(_ success: Bool, _ message: String) throws {
        guard success else { throw StudyError.failed(message) }
        checks.append(message)
    }

    private func until(_ message: String, condition: () -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(4)
        while !condition() && ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(25)) }
        try require(condition(), message)
    }

    private func click(_ id: String) async throws {
        try await Task.sleep(for: .milliseconds(180))
        guard let view = model.anchors[id]?.view, let window = view.window,
              window === model.window || window.sheetParent === model.window else {
            throw StudyError.failed("Preview control not ready: \(id)")
        }
        let frame = view.convert(view.bounds, to: nil)
        guard frame.width > 0, frame.height > 0 else { throw StudyError.failed("Empty control: \(id)") }
        try mouse(at: NSPoint(x: frame.midX, y: frame.midY), in: window)
    }

    // Copied in small form from Showtime StudioWindow: real AppKit events in our window.
    private func mouse(at point: NSPoint, in window: NSWindow) throws {
        let time = ProcessInfo.processInfo.systemUptime
        for (index, type) in [NSEvent.EventType.leftMouseDown, .leftMouseUp].enumerated() {
            guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
                timestamp: time + Double(index) * 0.02, windowNumber: window.windowNumber,
                context: nil, eventNumber: index, clickCount: 1, pressure: index == 0 ? 1 : 0)
            else { throw StudyError.failed("Could not create mouse event") }
            NSApp.postEvent(event, atStart: false)
        }
    }

    private func key(_ characters: String, code: UInt16, modifiers: NSEvent.ModifierFlags = [], in window: NSWindow) throws {
        guard let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: modifiers,
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil,
            characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code)
        else { throw StudyError.failed("Could not create key event") }
        NSApp.postEvent(event, atStart: false)
    }

    private func finish() {
        if let identifier = Bundle.main.bundleIdentifier { UserDefaults.standard.removePersistentDomain(forName: identifier) }
        previousApplication?.activate(options: [])
        NSApp.terminate(nil)
    }
}

@main struct OtterDesignStudy: App {
    @State private var runner = PreviewRunner()
    var body: some Scene {
        Window("Otter Design Study", id: "workspace") {
            WorkspaceView(model: runner.model).background(WindowReader(onWindow: runner.attach))
        }
        .defaultSize(width: 1280, height: 800)
        .windowToolbarStyle(.unified)
        .commands {
            SidebarCommands()
            CommandMenu("工作区") {
                Button("搜索资源…") { runner.model.sheet = .search }.keyboardShortcut("k")
                Button("设置") { runner.model.page = .settings }.keyboardShortcut(",")
                Button("显示或隐藏检查器") {
                    if runner.model.availableWidth < 980 { runner.model.compactInspector.toggle() }
                    else { runner.model.inspectorRequested.toggle() }
                }.keyboardShortcut("i", modifiers: [.command, .option])
            }
            CommandMenu("Design Preview") {
                ForEach(StudyScene.allCases) { scene in
                    Button(scene.rawValue) { Task { await runner.show(scene) } }
                }
                Divider()
                Toggle("Dark appearance", isOn: Binding(get: { runner.model.dark }, set: { runner.model.dark = $0 }))
                    .keyboardShortcut("d", modifiers: [.command, .shift])
                Button("Complete example collection") { runner.model.job = "ready" }
            }
        }
    }
}

struct WindowReader: NSViewRepresentable {
    let onWindow: (NSWindow) -> Void
    func makeNSView(context: Context) -> WindowProbe {
        let view = WindowProbe()
        view.onWindow = onWindow
        return view
    }
    func updateNSView(_ view: WindowProbe, context: Context) {}
}

@MainActor final class WindowProbe: NSView {
    var onWindow: ((NSWindow) -> Void)?
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if let window { onWindow?(window) }
    }
}
