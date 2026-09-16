// Design-only text input and review sheets. No production file operations.
import AppKit
import SwiftUI

struct NativeEditor: NSViewRepresentable {
    let model: PreviewWorkspace

    func makeCoordinator() -> Coordinator { Coordinator(model: model, key: model.activeKey) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = model.editorViews[model.activeKey] ?? makeEditor()
        let text = scroll.documentView as! NSTextView
        text.delegate = context.coordinator
        model.editorViews[model.activeKey] = scroll
        model.editor = text
        return scroll
    }

    private func makeEditor() -> NSScrollView {
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = true
        scroll.autohidesScrollers = true
        scroll.borderType = .noBorder
        let text = NSTextView(frame: .zero)
        text.isRichText = false
        text.isAutomaticQuoteSubstitutionEnabled = false
        text.isAutomaticDashSubstitutionEnabled = false
        text.isAutomaticTextReplacementEnabled = false
        text.isAutomaticSpellingCorrectionEnabled = false
        text.isContinuousSpellCheckingEnabled = false
        text.allowsUndo = true
        text.isVerticallyResizable = true
        text.isHorizontallyResizable = true
        text.autoresizingMask = [.width]
        text.minSize = .zero
        text.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        text.textContainer?.containerSize = text.maxSize
        text.textContainer?.widthTracksTextView = false
        text.textContainerInset = NSSize(width: 16, height: 18)
        text.font = .monospacedSystemFont(ofSize: CGFloat(model.editorFontSize), weight: .regular)
        text.string = model.activeText
        text.setAccessibilityLabel("技能源文件编辑器")
        text.setAccessibilityIdentifier("skill-source-editor")
        scroll.documentView = text
        let ruler = LineRuler(scrollView: scroll, orientation: .verticalRuler)
        ruler.clientView = text
        ruler.ruleThickness = 42
        scroll.verticalRulerView = ruler
        scroll.hasVerticalRuler = true
        scroll.rulersVisible = true
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let text = scroll.documentView as? NSTextView else { return }
        context.coordinator.model = model
        text.delegate = context.coordinator
        model.editor = text
        text.backgroundColor = model.dark ? NSColor(srgbRed: 0.13, green: 0.16, blue: 0.18, alpha: 1) : .white
        scroll.backgroundColor = text.backgroundColor
        text.textColor = .labelColor
        text.insertionPointColor = .labelColor
        guard !text.hasMarkedText() else { return }
        if text.string != model.activeText {
            let selection = text.selectedRange()
            text.string = model.activeText
            text.setSelectedRange(NSRange(location: min(selection.location, (text.string as NSString).length), length: 0))
        }
        text.font = .monospacedSystemFont(ofSize: CGFloat(model.editorFontSize), weight: .regular)
        scroll.verticalRulerView?.needsDisplay = true
    }

    @MainActor final class Coordinator: NSObject, NSTextViewDelegate {
        var model: PreviewWorkspace
        let key: String
        init(model: PreviewWorkspace, key: String) { self.model = model; self.key = key }
        func textDidChange(_ notification: Notification) {
            guard let text = notification.object as? NSTextView else { return }
            model.buffers[key] = text.string
            model.hint = "示例草稿已保留"
            text.enclosingScrollView?.verticalRulerView?.needsDisplay = true
        }
    }
}

@MainActor final class LineRuler: NSRulerView {
    override func drawHashMarksAndLabels(in rect: NSRect) {
        NSColor.windowBackgroundColor.setFill()
        bounds.fill()
        guard let text = clientView as? NSTextView, let layout = text.layoutManager,
              let container = text.textContainer else { return }
        layout.ensureLayout(for: container)
        let source = text.string as NSString
        let visible = text.visibleRect
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 10, weight: .regular),
            .foregroundColor: NSColor.secondaryLabelColor
        ]
        var index = 0
        var line = 1
        while index < source.length {
            let glyph = layout.glyphIndexForCharacter(at: index)
            let frame = layout.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
            let y = frame.minY + text.textContainerInset.height - visible.minY
            if y > bounds.maxY { break }
            if y >= -frame.height {
                let label = String(line) as NSString
                let size = label.size(withAttributes: attributes)
                label.draw(at: NSPoint(x: ruleThickness - size.width - 10, y: y + 2), withAttributes: attributes)
            }
            index = NSMaxRange(source.lineRange(for: NSRange(location: index, length: 0)))
            line += 1
        }
    }
}

struct PreviewSheetView: View {
    @Bindable var model: PreviewWorkspace
    let sheet: PreviewSheet
    @State private var updateCopy = true
    @State private var establishEntry = true
    @State private var shareWithClaude = true
    @State private var shareWithCodex = true

    private var changeCount: Int { (updateCopy ? 1 : 0) + (establishEntry ? 1 : 0) }
    private var title: String {
        switch sheet {
        case .change: "审阅 Codex 指令变更"
        case .fix: "补齐 Skill 的使用说明"
        case .upload: "上传前检查快照"
        case .search: "搜索工作区"
        case .conflict: "磁盘内容与草稿有冲突"
        case .distribute: "分发 \(model.packageID)"
        }
    }
    private var primaryTitle: String {
        switch sheet {
        case .change: "应用 \(changeCount) 项示例变更"
        case .fix: "应用到示例草稿"
        case .upload: "演示上传此快照"
        case .conflict: "保留草稿并返回"
        case .distribute: "演示分发到 \((shareWithClaude ? 1 : 0) + (shareWithCodex ? 1 : 0)) 个入口"
        case .search: "关闭"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(.system(size: 21, weight: .semibold))
                Text(sheet == .search ? "按名称和类型定位资源，保留来源与 scope。" : "设计预览 · 以下操作仅改变示例状态。")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }.padding(24)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) { content }.padding(24)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }.frame(maxHeight: .infinity)
            Divider()
            HStack {
                if sheet != .search {
                    Label("未连接本机配置", systemImage: "circle.dotted").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Button(sheet == .search ? "关闭" : "取消") { model.sheet = nil }
                    .keyboardShortcut(.cancelAction).buttonStyle(OtterButtonStyle())
                if sheet != .search {
                    Button(primaryTitle) {
                        model.applySheet()
                        if sheet == .change { model.hint = "\(changeCount) 项示例变更已演示 · 运行时仍待验证" }
                    }
                    .keyboardShortcut(.defaultAction).buttonStyle(OtterButtonStyle(treatment: .accent))
                    .disabled((sheet == .change && changeCount == 0) || (sheet == .distribute && !shareWithClaude && !shareWithCodex))
                    .background(PreviewAnchor(id: "sheet-apply", model: model))
                }
            }.padding(20)
        }.frame(width: sheet == .search ? 560 : 760, height: sheet == .search ? 430 : 560)
            .background(OtterTheme.canvas).preferredColorScheme(model.dark ? .dark : .light)
    }

    @ViewBuilder private var content: some View {
        switch sheet {
        case .change:
            OtterCard {
                HStack(alignment: .top, spacing: 20) {
                    MetaRow(title: "来源", value: "Workflow / agents / AGENTS.md")
                    Image(systemName: "arrow.right").foregroundStyle(.secondary).padding(.top, 22)
                    MetaRow(title: "目标", value: "~/.codex/instructions.md")
                }
            }
            Toggle("更新已选择内容的副本", isOn: $updateCopy).font(.system(size: 13, weight: .medium))
            diff(before: "Keep changes reviewable.\nPreserve local configuration.", after: "Keep changes reviewable.\nPreserve configuration and local drafts.")
            Toggle("创建经当前版本核对的 AGENTS.md 入口", isOn: $establishEntry).font(.system(size: 13, weight: .medium))
            PathLabel(path: "~/.codex/AGENTS.md → Workflow / agents / AGENTS.md")
            Text("这两项变更不证明已有会话重新加载。应用后分别检查文件关系与新进程发现结果。没有同步基线时，仅比较两个当前版本。")
                .font(.system(size: 12)).foregroundStyle(.secondary).lineSpacing(4)
        case .fix:
            MetaRow(title: "修改范围", value: model.packageID + " / SKILL.md · 第 3 行")
            diff(before: "description:", after: "description: 整理项目笔记、补齐引用，并检查笔记与源文件的关系。")
            Text("只改这一个示例字段。正文、其他 metadata 与附属文件保持原样。应用后继续编辑，再保存示例。")
                .font(.system(size: 13)).foregroundStyle(.secondary).lineSpacing(5)
        case .upload:
            OtterCard {
                VStack(alignment: .leading, spacing: 16) {
                    MetaRow(title: "固定快照", value: model.snapshotID)
                    MetaRow(title: "API host", value: "https://backup.example.invalid")
                    MetaRow(title: "覆盖结果", value: "13 个采集器 · 2 项缺失已标注 · 已完成遮盖检查")
                }
            }
            Text("清单：应用、Homebrew、字体与工具链。\n正文：已纳入范围的配置文件。\n本地编辑检查点不自动加入上传。")
                .font(.system(size: 13)).lineSpacing(8)
            StatusBadge(title: "上传此对象，不重新扫描", symbol: "archivebox")
        case .conflict:
            StatusBadge(title: "自己的编辑尚未写入源", symbol: "exclamationmark.triangle", warning: true)
            diff(before: "## 磁盘上的新内容\n保留最近一次外部修改。", after: "## 我的草稿\n继续保留尚未保存的编辑。")
            Text("先比较并选择内容。有同步基线时再提供三方合并；返回编辑不会把当前冲突当作已解决。")
                .font(.system(size: 13)).foregroundStyle(.secondary).lineSpacing(5)
        case .distribute:
            MetaRow(title: "完整技能包", value: model.sourcePath + " · 4 个示例文件")
            OtterCard {
                VStack(alignment: .leading, spacing: 18) {
                    Toggle("Claude · 专用 skills 目录", isOn: $shareWithClaude)
                    Toggle("Codex · 共享 skills 目录", isOn: $shareWithCodex)
                    Text("按包目录建立示例链接，保留汇集目录中的其他来源。实际发现仍需运行时验证。")
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                }.font(.system(size: 13))
            }
            StatusBadge(title: "保存源文件后，入口共享相同内容", symbol: "link")
        case .search:
            SearchField(title: "搜索示例技能", text: $model.globalSearch)
            ForEach(ExampleSkill.all.filter { model.globalSearch.isEmpty || $0.id.localizedCaseInsensitiveContains(model.globalSearch) }) { skill in
                Button {
                    model.selectedSkills = [skill.id]
                    model.openPackage()
                    model.sheet = nil
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "doc.text")
                        VStack(alignment: .leading, spacing: 6) {
                            Text(skill.id).font(.system(size: 13, weight: .medium))
                            Text("Skill · " + skill.source + " · " + skill.relationship).font(.system(size: 11)).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "return").foregroundStyle(.tertiary)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8).contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
        }
    }

    private func diff(before: String, after: String) -> some View {
        HStack(alignment: .top, spacing: 0) {
            diffSide(title: sheet == .conflict ? "磁盘版本" : "当前内容", text: before, added: false)
            Divider()
            diffSide(title: sheet == .conflict ? "自己的草稿" : "选定内容", text: after, added: true)
        }
        .fixedSize(horizontal: false, vertical: true)
        .background(OtterTheme.surface, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(OtterTheme.separator))
    }

    private func diffSide(title: String, text: String, added: Bool) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
            Text((added ? "+ " : "− ") + text).font(.system(size: 12, design: .monospaced)).lineSpacing(5)
                .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading).padding(10)
                .background((added ? OtterTheme.accent : OtterTheme.warning).opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
        }.frame(maxWidth: .infinity, alignment: .topLeading).padding(16)
    }
}
