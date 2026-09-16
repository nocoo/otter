import AppKit
import SwiftUI

@main struct OtterApp: App {
    @NSApplicationDelegateAdaptor(OtterAppDelegate.self) private var delegate
    @State private var store = WorkspaceStore()
    var body: some Scene {
        Window("Otter", id: "workspace") {
            WorkspaceView(store: store)
                .background(WindowReader { window in
                    guard store.window == nil else { return }
                    store.window = window; delegate.store = store; window.delegate = delegate
                    window.setFrameAutosaveName("Otter.Workspace")
                    if let screen = window.screen?.visibleFrame {
                        var frame = window.frame
                        frame.size.width = min(frame.width, screen.width); frame.size.height = min(frame.height, screen.height)
                        if !screen.contains(frame) { frame.origin = NSPoint(x: screen.midX - frame.width / 2, y: screen.midY - frame.height / 2) }
                        window.setFrame(frame, display: true)
                    }
                    #if DEBUG
                    if store.isolated { let automation = NativeAutomation(store: store); store.automation = automation; automation.attach(window) }
                    #endif
                })
                .task { await store.start() }
        }
        .defaultLaunchBehavior(.presented)
        .defaultSize(width: 1280, height: 800)
        .windowToolbarStyle(.unified(showsTitle: false))
        .commands {
            SidebarCommands()
            CommandGroup(replacing: .newItem) { Button("新建 Skill…") { store.sheet = .create }.keyboardShortcut("n") }
            CommandGroup(replacing: .saveItem) {
                Button("保存源文件") { store.save() }.keyboardShortcut("s").disabled(store.activeDocument?.isDirty != true)
                Button("保存全部") { store.save(all: true) }.keyboardShortcut("s", modifiers: [.command, .option])
            }
            CommandGroup(replacing: .appSettings) { Button("设置…") { store.page = .settings }.keyboardShortcut(",") }
            CommandMenu("工作区") {
                Button("搜索资源…") { store.sheet = .search }.keyboardShortcut("k")
                Button("重新扫描") { store.rescan() }.keyboardShortcut("r", modifiers: [.command, .shift])
                Button("查找当前文档…") { store.find() }.keyboardShortcut("f")
                Button("替换当前文档…") { store.find(replace: true) }.keyboardShortcut("f", modifiers: [.command, .option])
                Button("查找与替换技能包…") { store.sheet = .replace }.keyboardShortcut("f", modifiers: [.command, .shift]).disabled(store.editorRoot == nil)
                Divider()
                Button("显示或隐藏资源详情") { store.toggleInspector() }
                    .keyboardShortcut("i", modifiers: [.command, .option]).disabled(!store.hasInspector)
            }
        }
        WindowGroup("Otter · 文档", for: String.self) { $key in
            if let key, let document = store.documents[key] {
                VStack(spacing: 0) {
                    HStack {
                        Text(store.shortPath(document.original.target)).font(OtterTypography.code).lineLimit(1).truncationMode(.middle)
                        Spacer()
                        Button("保存") { store.activeDocumentID = key; store.save() }.buttonStyle(OtterButtonStyle(treatment: .accent)).keyboardShortcut("s").disabled(!document.isDirty)
                    }.padding(OtterTheme.cardInset)
                    Divider()
                    NativeEditor(document: document, store: store, standalone: true).clipped()
                }.frame(minWidth: 600, minHeight: 400)
            }
        }.defaultLaunchBehavior(.suppressed).defaultSize(width: 840, height: 680)
    }
}

@MainActor final class OtterAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    weak var store: WorkspaceStore?
    private var terminating = false
    private var preparing = false
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        if let url = Bundle.main.url(forResource: "Otter", withExtension: "icns"), let icon = NSImage(contentsOf: url) {
            // Like Showtime, refresh the Dock after local rebuilds using the inset bundle icon.
            NSApp.applicationIconImage = icon
        }
        #if DEBUG
        if CommandLine.arguments.contains("--automation-root") { NSApp.activate(ignoringOtherApps: true) }
        #endif
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminating, let store else { return .terminateNow }
        guard !preparing else { return .terminateCancel }
        if store.saving { store.error = "正在提交文件变更，请完成后再退出。"; return .terminateCancel }
        if store.jobs.contains(where: \.isRunning) {
            let alert = NSAlert(); alert.messageText = "Otter 任务仍在运行"; alert.informativeText = "可以等待任务完成，或取消任务并退出。上传是否已被服务端接收需要单独核对。"
            alert.addButton(withTitle: "等待任务"); alert.addButton(withTitle: "取消任务并退出")
            guard alert.runModal() == .alertSecondButtonReturn else { return .terminateCancel }
            store.cancelJob()
        }
        preparing = true; store.quitting = true
        Task {
            do {
                try await store.flushDrafts()
                let deadline = Date().addingTimeInterval(4)
                while store.jobs.contains(where: \.isRunning) && Date() < deadline { try await Task.sleep(for: .milliseconds(100)) }
                terminating = true
                sender.terminate(nil)
            } catch { preparing = false; store.quitting = false; store.error = "无法保留草稿：\(error.localizedDescription)" }
        }
        // Keep the normal event loop alive while Swift concurrency flushes local drafts.
        // terminateLater enters Cocoa's termination loop, which can stall MainActor tasks.
        return .terminateCancel
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if terminating { return true }
        guard sender === store?.window else { return true }
        NSApp.terminate(nil); return false
    }
}

struct WindowReader: NSViewRepresentable {
    let attach: (NSWindow) -> Void
    func makeNSView(context: Context) -> WindowProbe { let view = WindowProbe(); view.attach = attach; return view }
    func updateNSView(_ view: WindowProbe, context: Context) { view.attach = attach }
}
@MainActor final class WindowProbe: NSView {
    var attach: ((NSWindow) -> Void)?
    override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); if let window { DispatchQueue.main.async { [weak self, weak window] in if let window { self?.attach?(window) } } } }
}
