import AppKit
import OtterCore
import QuickLookUI
import SwiftUI
import WebKit

struct SkillEditorView: View {
    @Bindable var store: WorkspaceStore
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button { store.closeEditor() } label: { Image(systemName: "chevron.left") }.buttonStyle(OtterButtonStyle(iconOnly: true)).help("返回资源库").accessibilityLabel("返回资源库").nativeAnchor("back-to-library", store: store)
                VStack(alignment: .leading, spacing: 4) {
                    Text(store.editorRoot.map { ($0 as NSString).lastPathComponent } ?? store.selectedEntry?.name ?? "文件编辑器").font(OtterTypography.sectionTitle).lineLimit(1)
                    Text(store.shortPath(store.activeDocument?.original.target ?? store.editorRoot ?? "")).font(OtterTypography.code).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                }.frame(maxWidth: .infinity, alignment: .leading)
                if store.editorRoot != nil {
                    Menu {
                        Button("分发到 Agent…") { store.sheet = .distribute }
                        Button("导出完整技能包…") { store.exportPackage() }
                        Button("复制为独立分叉…") { store.forkPackage() }
                        Button("重命名技能包…") { store.sheet = .rename }
                        Button("查找与替换整个包…") { store.sheet = .replace }
                        Button("查看 Git 差异") { store.gitDiff() }
                        Divider()
                        Toggle("自动换行", isOn: $store.wrapLines)
                    } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).menuIndicator(.hidden)
                        .frame(width: OtterTheme.controlHeight, height: OtterTheme.controlHeight).accessibilityLabel("技能包操作")
                    Button("分发…") { store.sheet = .distribute }.buttonStyle(OtterButtonStyle()).nativeAnchor("distribute", store: store)
                }
                Button { store.save() } label: { Label("保存", systemImage: "square.and.arrow.down") }
                    .buttonStyle(OtterButtonStyle(treatment: .accent)).disabled(store.activeDocument?.isDirty != true || store.saving)
                    .nativeAnchor("save", store: store)
            }.padding(.horizontal, OtterTheme.pageInset).padding(.vertical, 16)
            Divider()
            HStack(spacing: 0) {
                if store.editorRoot != nil { fileTree.frame(width: 200); Divider() }
                VStack(spacing: 0) {
                    if let document = store.activeDocument {
                        tabs
                        Divider()
                        HStack(spacing: 10) {
                            OtterSegmentedPicker(title: "编辑视图", choices: [("源码", "源码"), ("阅读", "阅读"), ("分栏", "分栏")], selection: $store.editorMode)
                                .frame(width: 175).nativeAnchor("editor-mode", store: store)
                            WorkspaceInspectorButton(store: store)
                            if !document.headings.isEmpty {
                                Menu {
                                    ForEach(document.headings) { heading in
                                        Button(String(repeating: "  ", count: heading.level - 1) + heading.title) {
                                            store.editorMode = "源码"; document.requestedLine = heading.line
                                        }
                                    }
                                } label: { Image(systemName: "list.bullet.indent") }
                                .menuStyle(.borderlessButton).menuIndicator(.hidden)
                                .frame(width: OtterTheme.controlHeight, height: OtterTheme.controlHeight).help("标题大纲").accessibilityLabel("标题大纲").nativeAnchor("heading-outline", store: store)
                            }
                            Spacer(minLength: 0)
                            if document.conflict {
                                Button("处理磁盘冲突") { store.showConflict(document) }.font(OtterTypography.caption).foregroundStyle(OtterTheme.warning).nativeAnchor("conflict", store: store)
                            }
                            Button { openWindow(value: store.activeDocumentID ?? document.path) } label: { Image(systemName: "macwindow.on.rectangle") }.buttonStyle(OtterButtonStyle(treatment: .plain, iconOnly: true)).help("在独立窗口编辑").accessibilityLabel("在独立窗口编辑").nativeAnchor("detach-document", store: store)
                            Button { store.showProblems.toggle() } label: { Label("\(document.problems.count)", systemImage: "exclamationmark.bubble") }.buttonStyle(OtterButtonStyle(treatment: .plain)).help("显示或隐藏问题")
                        }.padding(.horizontal, OtterTheme.cardInset).frame(height: 48)
                        Divider()
                        HStack(spacing: 0) {
                            if store.editorMode != "阅读" || !document.path.hasSuffix(".md") {
                                NativeEditor(document: document, store: store).id(document.id).clipped().frame(maxWidth: .infinity, maxHeight: .infinity)
                            }
                            if store.editorMode != "源码" && document.path.hasSuffix(".md") {
                                if store.editorMode == "分栏" { Divider() }
                                MarkdownReader(document: document, store: store).frame(maxWidth: .infinity, maxHeight: .infinity)
                            }
                        }
                        if store.showProblems && !document.problems.isEmpty {
                            Divider()
                            VStack(alignment: .leading, spacing: 0) {
                                HStack { Text("问题").font(OtterTypography.captionLabel); Spacer(); Text("规范 / 兼容 / 包完整性").font(OtterTypography.detail).foregroundStyle(.secondary) }.padding(.horizontal, OtterTheme.cardInset).padding(.vertical, 8)
                                ScrollView {
                                    VStack(spacing: 9) {
                                        ForEach(document.problems) { problem in
                                            Button { store.jumpToLine(problem.line) } label: { ProblemRow(problem: problem, shortPath: "L\(problem.line) · \(problem.rule)") }.buttonStyle(.plain)
                                        }
                                    }.padding(.horizontal, OtterTheme.cardInset).padding(.bottom, 12)
                                }
                            }.frame(maxHeight: 150).background(OtterTheme.surface)
                        }
                        Divider()
                        HStack(spacing: 10) {
                            Text(document.text.contains("\r\n") ? "UTF-8 · CRLF" : "UTF-8 · LF")
                            Text("\(document.text.count) 字符")
                            Spacer()
                            Text(document.conflict ? "草稿与磁盘不同" : document.isDirty ? "尚未写入源" : "已保存")
                        }.font(OtterTypography.detail).foregroundStyle(.secondary).padding(.horizontal, OtterTheme.cardInset).frame(height: 28)
                    } else if let url = store.binaryURL {
                        BinaryPreview(url: url).frame(maxWidth: .infinity, maxHeight: .infinity)
                        HStack { Text(url.lastPathComponent).font(OtterTypography.caption); Spacer(); Button("使用默认应用编辑") { NSWorkspace.shared.open(url) }; Button("在 Finder 显示") { store.reveal(url.path) } }.padding(14)
                    } else {
                        OtterEmptyState(title: "选择文件", symbol: "doc.text", description: "正文、脚本、参考资料和资源文件都在这个包中。")
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            if !store.currentConsumers.isEmpty {
                Divider()
                HStack(spacing: 8) {
                    Image(systemName: "link").foregroundStyle(OtterTheme.accent)
                    Text("保存源会影响：" + store.currentConsumers.map(\.title).joined(separator: "、")).lineLimit(1).truncationMode(.tail)
                    Spacer(minLength: 0)
                }.font(OtterTypography.detail).foregroundStyle(.secondary).padding(.horizontal, OtterTheme.pageInset).frame(height: 28).background(OtterTheme.accent.opacity(0.04))
            }
        }
    }
    private var fileTree: some View {
        VStack(spacing: 0) {
            HStack {
                Text("文件").font(OtterTypography.captionLabel).foregroundStyle(.secondary); Spacer()
                Button { store.sheet = .newFile } label: { Image(systemName: "plus") }.buttonStyle(.plain).help("新建包内文件").accessibilityLabel("新建包内文件").nativeAnchor("new-file", store: store)
                Button { store.importResource() } label: { Image(systemName: "square.and.arrow.down") }.buttonStyle(.plain).help("导入资源文件").accessibilityLabel("导入资源文件")
            }.padding(.horizontal, OtterTheme.cardInset).frame(height: 36)
            SearchField(title: "筛选文件", text: $store.packageSearch).padding(.horizontal, 8).padding(.top, 8).padding(.bottom, 8)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(store.fileList.filter { store.packageSearch.isEmpty || $0.relativePath.localizedCaseInsensitiveContains(store.packageSearch) }) { file in
                        Button {
                            if file.kind != .directory, let root = store.editorRoot { store.openDocument(FileSystem.join(root, file.relativePath)) }
                        } label: {
                            HStack(spacing: 7) {
                                Image(systemName: file.kind == .directory ? "folder" : file.kind == .symlink ? "link" : "doc.text").frame(width: 15).foregroundStyle(file.kind == .directory ? .secondary : OtterTheme.accent)
                                Text((file.relativePath as NSString).lastPathComponent).lineLimit(1).truncationMode(.middle)
                                Spacer(minLength: 0)
                                if store.documents[FileSystem.join(store.editorRoot ?? "", file.relativePath)]?.isDirty == true { Circle().fill(OtterTheme.accent).frame(width: 5, height: 5) }
                            }.font(OtterTypography.caption).padding(.leading, CGFloat(min(3, file.relativePath.split(separator: "/").count - 1)) * 12 + 10).padding(.trailing, 8).frame(height: 30)
                                .background(store.activeDocument?.original.target == FileSystem.join(store.editorRoot ?? "", file.relativePath) ? OtterTheme.accent.opacity(0.1) : Color.clear, in: RoundedRectangle(cornerRadius: 6)).contentShape(Rectangle())
                        }.buttonStyle(.plain).help(file.relativePath).nativeAnchor("file." + file.relativePath, store: store)
                        .contextMenu {
                            Button("在 Finder 中显示") { store.reveal(FileSystem.join(store.editorRoot ?? "", file.relativePath)) }
                            if file.kind != .directory { Button("重命名…") { store.renameFile(file) } }
                            Button("删除并保留检查点…", role: .destructive) { store.removeFile(file) }
                        }
                    }
                }.padding(.horizontal, 6).padding(.bottom, 12)
            }
            Divider()
            Text("\(store.fileList.filter { $0.kind != .directory }.count) 个文件 · 完整技能包").font(OtterTypography.detail).foregroundStyle(.secondary).padding(12)
        }.background(OtterTheme.surface.opacity(0.55))
        .dropDestination(for: URL.self) { urls, _ in
            guard !urls.isEmpty, urls.allSatisfy(\.isFileURL) else { return false }
            store.importResources(urls); return true
        }
    }
    private var tabs: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 0) {
                ForEach(store.openDocumentIDs.filter { store.editorRoot == nil ? $0 == store.activeDocumentID : FileSystem.isWithin($0, store.editorRoot!) }, id: \.self) { key in
                    HStack(spacing: 7) {
                        Button { store.activeDocumentID = key; store.binaryURL = nil } label: {
                            HStack(spacing: 6) { Image(systemName: "doc.text").font(OtterTypography.detail); Text((key as NSString).lastPathComponent).font(OtterTypography.caption); if store.documents[key]?.isDirty == true { Circle().fill(OtterTheme.accent).frame(width: 5, height: 5) } }
                        }.buttonStyle(.plain).nativeAnchor("tab." + key, store: store)
                        Button { store.closeDocument(key) } label: { Image(systemName: "xmark").font(.system(size: 8)) }
                            .buttonStyle(.plain).help("关闭标签，保留草稿").accessibilityLabel("关闭 \((key as NSString).lastPathComponent)")
                    }.padding(.horizontal, OtterTheme.cardInset).frame(height: 36).background(store.activeDocumentID == key ? OtterTheme.surface : Color.clear)
                        .overlay(alignment: .bottom) { if store.activeDocumentID == key { Rectangle().fill(OtterTheme.accent).frame(height: 2) } }
                    Divider().frame(height: 16)
                }
            }
        }.scrollIndicators(.hidden).frame(height: 36).background(OtterTheme.control.opacity(0.5))
    }
}

struct NativeEditor: NSViewRepresentable {
    let document: EditorDocument
    let store: WorkspaceStore
    var standalone = false
    func makeCoordinator() -> Coordinator { Coordinator(document: document, store: store) }
    func makeNSView(context: Context) -> NSScrollView {
        let scroll = (!standalone ? store.editorViews[document.id] : nil) ?? makeEditor()
        let text = scroll.documentView as! CodeTextView
        text.delegate = context.coordinator
        if !standalone { store.editorViews[document.id] = scroll }
        if store.editor?.window == nil || (!standalone && store.window?.isKeyWindow == true && store.activeDocumentID == document.id) { store.editor = text }
        return scroll
    }
    private func makeEditor() -> NSScrollView {
        let scroll = NSScrollView(); scroll.hasVerticalScroller = true; scroll.hasHorizontalScroller = true; scroll.autohidesScrollers = true
        let text = CodeTextView(frame: .zero)
        text.isRichText = false; text.allowsUndo = true; text.isAutomaticQuoteSubstitutionEnabled = false
        text.isAutomaticDashSubstitutionEnabled = false; text.isAutomaticTextReplacementEnabled = false
        text.isAutomaticSpellingCorrectionEnabled = false; text.isContinuousSpellCheckingEnabled = false
        text.usesFindBar = true; text.isIncrementalSearchingEnabled = true
        text.isVerticallyResizable = true; text.isHorizontallyResizable = !store.wrapLines; text.autoresizingMask = [.width]
        text.minSize = .zero; text.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        text.textContainer?.containerSize = NSSize(width: max(1, scroll.contentSize.width), height: CGFloat.greatestFiniteMagnitude)
        text.textContainer?.widthTracksTextView = store.wrapLines
        text.textContainerInset = NSSize(width: 16, height: 18)
        text.font = .monospacedSystemFont(ofSize: store.configuration.editorFontSize, weight: .regular)
        text.string = document.text
        text.setAccessibilityLabel("源文件编辑器"); text.setAccessibilityIdentifier("source-editor")
        let documentID = document.id
        text.onFocus = { [weak store, weak text] in store?.editor = text; store?.activeDocumentID = documentID }
        text.onSave = { [weak store] all in store?.activeDocumentID = documentID; store?.save(all: all) }
        scroll.documentView = text
        let ruler = EditorLineRuler(scrollView: scroll, orientation: .verticalRuler); ruler.clientView = text; ruler.ruleThickness = 42
        scroll.verticalRulerView = ruler; scroll.hasVerticalRuler = true; scroll.rulersVisible = true
        return scroll
    }
    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let text = scroll.documentView as? CodeTextView else { return }
        text.delegate = context.coordinator
        if store.editor?.window == nil || (store.activeDocumentID == document.id &&
            (text.window?.isKeyWindow == true || (!standalone && store.window?.isKeyWindow == true))) { store.editor = text }
        text.isEditable = !store.quitting
        scroll.hasHorizontalScroller = !store.wrapLines
        text.isHorizontallyResizable = !store.wrapLines
        text.textContainer?.widthTracksTextView = store.wrapLines
        if store.wrapLines {
            text.setFrameSize(NSSize(width: max(1, scroll.contentSize.width), height: max(text.frame.height, scroll.contentSize.height)))
        } else { text.textContainer?.containerSize.width = CGFloat.greatestFiniteMagnitude }
        text.backgroundColor = .textBackgroundColor; scroll.backgroundColor = .textBackgroundColor
        text.textColor = .labelColor; text.insertionPointColor = .labelColor
        guard !text.hasMarkedText() else { return }
        if text.string != document.text {
            let selection = text.selectedRange()
            text.string = document.text
            text.setSelectedRange(NSRange(location: min(selection.location, (text.string as NSString).length), length: 0))
        }
        if let line = document.requestedLine {
            let offset = text.string.components(separatedBy: "\n").prefix(max(0, line - 1)).reduce(0) { $0 + ($1 as NSString).length + 1 }
            let range = NSRange(location: min(offset, (text.string as NSString).length), length: 0)
            text.setSelectedRange(range); text.scrollRangeToVisible(range)
            DispatchQueue.main.async {
                guard document.requestedLine == line else { return }
                document.requestedLine = nil; text.window?.makeFirstResponder(text)
            }
        }
        text.font = .monospacedSystemFont(ofSize: store.configuration.editorFontSize, weight: .regular)
        scroll.verticalRulerView?.needsDisplay = true
        context.coordinator.highlight(text)
    }
    @MainActor final class Coordinator: NSObject, NSTextViewDelegate {
        let document: EditorDocument
        let store: WorkspaceStore
        private var highlighted = ""
        init(document: EditorDocument, store: WorkspaceStore) { self.document = document; self.store = store }
        func textDidChange(_ notification: Notification) {
            guard let text = notification.object as? NSTextView else { return }
            document.text = text.string; store.changed(document)
            text.enclosingScrollView?.verticalRulerView?.needsDisplay = true
        }
        func highlight(_ text: NSTextView) {
            guard !text.hasMarkedText(), text.string != highlighted else { return }
            highlighted = text.string
            let range = NSRange(location: 0, length: (text.string as NSString).length)
            text.layoutManager?.removeTemporaryAttribute(.foregroundColor, forCharacterRange: range)
            // Keep large documents responsive; full syntax colouring resumes below 200k UTF-16 units.
            guard range.length <= 200_000 else { return }
            for (pattern, color) in [("(?m)^#{1,6} .*$", NSColor.systemTeal), ("(?m)^\\s*#(?!#| ).*$", NSColor.secondaryLabelColor), ("(?m)^[A-Za-z_][\\w-]*(?=\\s*:)", NSColor.systemPurple), ("`[^`\\n]+`", NSColor.systemOrange), ("\"(?:[^\"\\\\]|\\\\.)*\"|'[^'\\n]*'", NSColor.systemBrown)] {
                if let regex = try? NSRegularExpression(pattern: pattern) {
                    for match in regex.matches(in: text.string, range: range) { text.layoutManager?.addTemporaryAttribute(.foregroundColor, value: color, forCharacterRange: match.range) }
                }
            }
        }
    }
}

@MainActor final class CodeTextView: NSTextView {
    var onFocus: (() -> Void)?
    var onSave: ((Bool) -> Void)?
    private let pairs = ["(": ")", "[": "]", "{": "}"]
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.modifierFlags.contains(.command), !event.modifierFlags.contains(.control),
           event.charactersIgnoringModifiers?.lowercased() == "s" {
            onSave?(event.modifierFlags.contains(.option)); return true
        }
        return super.performKeyEquivalent(with: event)
    }
    override func becomeFirstResponder() -> Bool { let accepted = super.becomeFirstResponder(); if accepted { onFocus?() }; return accepted }
    override func insertText(_ insertString: Any, replacementRange: NSRange) {
        let value = (insertString as? String) ?? (insertString as? NSAttributedString)?.string
        let selection = replacementRange.location == NSNotFound ? selectedRange() : replacementRange
        let source = string as NSString
        guard isEditable, !hasMarkedText(), let value, value.count == 1,
              selection.location != NSNotFound, NSMaxRange(selection) <= source.length else {
            super.insertText(insertString, replacementRange: replacementRange); return
        }
        if let closing = pairs[value] {
            super.insertText(value + source.substring(with: selection) + closing, replacementRange: selection)
            setSelectedRange(NSRange(location: selection.location + 1, length: selection.length))
        } else if selection.length == 0, pairs.values.contains(value), selection.location < source.length,
                  source.substring(with: NSRange(location: selection.location, length: 1)) == value {
            setSelectedRange(NSRange(location: selection.location + 1, length: 0))
        } else { super.insertText(insertString, replacementRange: replacementRange) }
    }
    override func deleteBackward(_ sender: Any?) {
        let selection = selectedRange(), source = string as NSString
        if !hasMarkedText(), selection.length == 0, selection.location > 0, selection.location < source.length,
           pairs[source.substring(with: NSRange(location: selection.location - 1, length: 1))] == source.substring(with: NSRange(location: selection.location, length: 1)) {
            super.insertText("", replacementRange: NSRange(location: selection.location - 1, length: 2))
        } else { super.deleteBackward(sender) }
    }
    override func insertNewline(_ sender: Any?) {
        let range = (string as NSString).lineRange(for: NSRange(location: selectedRange().location, length: 0))
        let currentLine = (string as NSString).substring(with: range)
        let indentation = String(currentLine.prefix { $0 == " " || $0 == "\t" })
        if string.contains("\r\n") { insertText("\r\n", replacementRange: selectedRange()) }
        else { super.insertNewline(sender) }
        if !indentation.isEmpty { insertText(indentation, replacementRange: selectedRange()) }
    }
    override func insertTab(_ sender: Any?) {
        if hasMarkedText() { super.insertTab(sender) }
        else if selectedRange().length == 0 { insertText("    ", replacementRange: selectedRange()) }
        else { indentSelection(removing: false) }
    }
    override func insertBacktab(_ sender: Any?) {
        if hasMarkedText() { super.insertBacktab(sender) } else { indentSelection(removing: true) }
    }
    private func indentSelection(removing: Bool) {
        guard isEditable else { return }
        let source = string as NSString, selection = selectedRange()
        guard selection.location != NSNotFound, NSMaxRange(selection) <= source.length else { return }
        var selectedLines = selection
        if selectedLines.length > 0, source.character(at: NSMaxRange(selectedLines) - 1) == 10 { selectedLines.length -= 1 }
        let range = source.lineRange(for: selectedLines), original = source.substring(with: range)
        var lines = original.components(separatedBy: "\n")
        for index in lines.indices {
            if index == lines.count - 1, index > 0, lines[index].isEmpty { continue }
            if removing {
                let count = lines[index].hasPrefix("\t") ? 1 : lines[index].prefix(4).prefix(while: { $0 == " " }).count
                lines[index].removeFirst(count)
            } else { lines[index] = "    " + lines[index] }
        }
        let replacement = lines.joined(separator: "\n")
        guard replacement != original else { return }
        super.insertText(replacement, replacementRange: range)
        if selection.length > 0 { setSelectedRange(NSRange(location: range.location, length: (replacement as NSString).length)) }
        else { setSelectedRange(NSRange(location: max(range.location, selection.location + (replacement as NSString).length - range.length), length: 0)) }
    }
}
@MainActor final class EditorLineRuler: NSRulerView {
    override func drawHashMarksAndLabels(in rect: NSRect) {
        NSColor.windowBackgroundColor.setFill(); bounds.fill()
        guard let text = clientView as? NSTextView, let layout = text.layoutManager, let container = text.textContainer else { return }
        let source = text.string as NSString
        guard source.length > 0 else { return }
        let glyphs = layout.glyphRange(forBoundingRect: text.visibleRect, in: container)
        let characters = layout.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)
        var index = source.lineRange(for: NSRange(location: min(characters.location, source.length - 1), length: 0)).location
        var line = source.substring(to: index).reduce(1) { $1 == "\n" ? $0 + 1 : $0 }
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.monospacedSystemFont(ofSize: 10, weight: .regular), .foregroundColor: NSColor.secondaryLabelColor]
        while index < source.length {
            let glyph = layout.glyphIndexForCharacter(at: index)
            let frame = layout.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
            let y = frame.minY + text.textContainerInset.height - text.visibleRect.minY
            if y > bounds.maxY { break }
            if y >= -frame.height {
                let label = String(line) as NSString
                label.draw(at: NSPoint(x: ruleThickness - label.size(withAttributes: attributes).width - 10, y: y + 2), withAttributes: attributes)
            }
            index = NSMaxRange(source.lineRange(for: NSRange(location: index, length: 0))); line += 1
        }
    }
}

struct MarkdownReader: View {
    let document: EditorDocument
    let store: WorkspaceStore
    @State private var html = ""
    var body: some View {
        MarkdownWebView(html: html, store: store)
            .task(id: document.text) {
                let text = document.text, path = document.path, root = store.editorRoot
                do { try await Task.sleep(for: .milliseconds(180)); let content = await Task.detached { MarkdownPreview.html(text, path: path, packageRoot: root) }.value; if !Task.isCancelled { html = content } } catch { /* newer content */ }
            }
    }
}
private struct MarkdownWebView: NSViewRepresentable {
    let html: String
    let store: WorkspaceStore
    func makeCoordinator() -> Coordinator { Coordinator(store: store) }
    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration(); configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration); view.navigationDelegate = context.coordinator
        view.setAccessibilityLabel("Markdown 阅读视图"); return view
    }
    func updateNSView(_ view: WKWebView, context: Context) { if context.coordinator.html != html { context.coordinator.html = html; view.loadHTMLString(html, baseURL: nil) } }
    @MainActor final class Coordinator: NSObject, WKNavigationDelegate {
        let store: WorkspaceStore; var html = ""
        init(store: WorkspaceStore) { self.store = store }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard action.navigationType == .linkActivated, let url = action.request.url else { return action.request.url?.scheme == "about" ? .allow : .cancel }
            if url.scheme == "otter-file", let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "path" })?.value {
                guard let root = store.editorRoot, let canonical = FileSystem.resolve(path).finalPath, FileSystem.isWithin(canonical, root) else { store.error = "此引用在当前技能包之外；请通过 Finder 明确打开。"; return .cancel }
                store.openDocument(path)
            } else if ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
            return .cancel
        }
    }
}
struct BinaryPreview: NSViewRepresentable {
    let url: URL
    func makeNSView(context: Context) -> QLPreviewView { QLPreviewView(frame: .zero, style: .normal)! }
    func updateNSView(_ view: QLPreviewView, context: Context) { view.previewItem = url as NSURL }
}
