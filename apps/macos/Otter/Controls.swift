// Native workspace controls derived from Lyre and Showtime (MIT).
// Copyright (c) 2026 Zheng Li; Copyright (c) 2026 nocoo.
// Exact sources, adaptations, and license: ../THIRD_PARTY_NOTICES.md.
import AppKit
import SwiftUI

enum OtterTheme {
    static let accent = adaptive("accent", light: 0x216C76, dark: 0x91CCD1)
    static let onAccent = adaptive("onAccent", light: 0xFFFFFF, dark: 0x12343B)
    static let canvas = adaptive("canvas", light: 0xF4F6F5, dark: 0x171D20)
    static let surface = adaptive("surface", light: 0xFFFFFF, dark: 0x222A2D)
    static let control = adaptive("control", light: 0xE9EFEE, dark: 0x303B3D)
    static let danger = Color(nsColor: .systemRed)
    static let warning = adaptive("warning", light: 0x93611E, dark: 0xE9BC75)
    static let ink = Color.primary
    static let muted = Color.secondary
    static let field = control
    static let panel = surface
    static let line = Color.primary.opacity(0.1)
    static let separator = line
    static let shadow = Color.black.opacity(0.12)
    static let controlHeight: CGFloat = 32
    static let pageInset: CGFloat = 24
    static let cardInset: CGFloat = 16
    static let controlRadius: CGFloat = 8

    // From Showtime Theme.adaptive, with Otter's palette and namespace.
    private static func adaptive(_ name: String, light: UInt32, dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: NSColor.Name("Otter.\(name)")) { appearance in
            let value = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
            return NSColor(srgbRed: Double((value >> 16) & 255) / 255,
                           green: Double((value >> 8) & 255) / 255,
                           blue: Double(value & 255) / 255, alpha: 1)
        })
    }
}

// Showtime's hierarchy, shared by every workspace, editor and sheet.
enum OtterTypography {
    static let pageTitle = Font.system(size: 23, weight: .semibold)
    static let sectionTitle = Font.system(size: 14, weight: .semibold)
    static let body = Font.system(size: 13)
    static let label = Font.system(size: 13, weight: .medium)
    static let caption = Font.system(size: 12)
    static let captionLabel = Font.system(size: 12, weight: .medium)
    static let detail = Font.system(size: 11)
    static let code = Font.system(size: 11, design: .monospaced)
}

struct OtterButtonStyle: ButtonStyle {
    enum Treatment { case standard, accent, destructive, plain }
    var treatment: Treatment = .standard
    var iconOnly = false

    func makeBody(configuration: Configuration) -> some View {
        OtterButtonBody(configuration: configuration, treatment: treatment, iconOnly: iconOnly)
    }
}

private struct OtterButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let treatment: OtterButtonStyle.Treatment
    let iconOnly: Bool
    @Environment(\.isEnabled) private var isEnabled
    @State private var hovered = false

    private var fill: Color {
        switch treatment {
        case .standard: OtterTheme.control
        case .accent: OtterTheme.accent
        case .destructive: OtterTheme.danger
        case .plain: .clear
        }
    }

    var body: some View {
        configuration.label
            .font(OtterTypography.label)
            .lineLimit(1)
            .padding(.horizontal, iconOnly || treatment == .plain ? 0 : 12)
            .frame(width: iconOnly ? OtterTheme.controlHeight : nil, height: OtterTheme.controlHeight)
            .foregroundStyle(treatment == .standard ? OtterTheme.ink : treatment == .plain ? OtterTheme.accent : treatment == .accent ? OtterTheme.onAccent : Color.white)
            .background(fill, in: RoundedRectangle(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.primary.opacity(configuration.isPressed ? 0.1 : hovered ? 0.045 : 0))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(OtterTheme.separator.opacity(treatment == .standard ? 1 : 0), lineWidth: 0.5)
            }
            .opacity(isEnabled ? 1 : 0.45)
            .onHover { hovered = $0 }
    }
}

struct OtterCard<Content: View>: View {
    var padding: CGFloat = OtterTheme.cardInset
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(OtterTheme.surface, in: RoundedRectangle(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12).strokeBorder(OtterTheme.separator, lineWidth: 1)
            }
    }
}

struct OtterSection<Content: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(OtterTypography.sectionTitle)
                if let subtitle {
                    Text(subtitle).font(OtterTypography.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            OtterCard { content }
        }
    }
}

struct OtterPageHeading: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(OtterTypography.pageTitle)
            Text(subtitle).font(OtterTypography.body).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct OtterInspectorSection<Content: View>: View {
    let title: String
    let symbol: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(title, systemImage: symbol)
                .font(OtterTypography.sectionTitle)
                .labelStyle(.titleAndIcon)
                .foregroundStyle(OtterTheme.ink)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(OtterTheme.cardInset)
        .background(OtterTheme.panel, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(OtterTheme.line, lineWidth: 0.75))
    }
}

struct OtterMenu: View {
    let title: String
    let selection: String
    let options: [(title: String, action: () -> Void)]
    @StateObject private var anchor = MenuAnchor()
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: openMenu) {
            HStack(spacing: 6) {
                Text(selection).lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .medium))
            }.font(OtterTypography.label).foregroundStyle(OtterTheme.ink)
                .padding(.horizontal, 11).frame(maxWidth: .infinity, alignment: .leading).frame(height: OtterTheme.controlHeight)
                .background(OtterTheme.field, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(hovering ? OtterTheme.ink.opacity(0.18) : OtterTheme.line, lineWidth: 0.75))
        }.buttonStyle(.plain).background(MenuAnchorView(anchor: anchor)).onHover { hovering = $0 }
            .opacity(isEnabled ? 1 : 0.5).accessibilityLabel(title).accessibilityValue(selection)
    }

    private func openMenu() {
        guard let view = anchor.view else { return }
        let menu = NSMenu()
        let target = MenuTarget(actions: options.map(\.action))
        for (index, option) in options.enumerated() {
            let item = NSMenuItem(title: option.title, action: #selector(MenuTarget.choose(_:)), keyEquivalent: "")
            item.tag = index; item.target = target
            item.state = option.title == selection ? .on : .off
            menu.addItem(item)
        }
        menu.minimumWidth = view.bounds.width
        // Keep a genuine macOS menu, anchored to the full-width Studio control.
        _ = withExtendedLifetime(target) { menu.popUp(positioning: nil, at: NSPoint(x: 0, y: -4), in: view) }
    }
}

// The large native control matches the shared height and keeps macOS keyboard semantics.
struct OtterSegmentedPicker<Value: Hashable>: View {
    let title: String
    let choices: [(Value, String)]
    @Binding var selection: Value

    var body: some View {
        Picker(title, selection: $selection) {
            ForEach(choices, id: \.0) { value, label in
                Text(label).tag(value)
            }
        }
        .pickerStyle(.segmented).labelsHidden().controlSize(.large)
        .font(OtterTypography.label).frame(height: OtterTheme.controlHeight)
        .accessibilityLabel(title)
    }
}

struct OtterEmptyState: View {
    let title: String
    let symbol: String
    let description: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: symbol).font(.system(size: 28, weight: .light)).foregroundStyle(.tertiary).accessibilityHidden(true)
            Text(title).font(OtterTypography.sectionTitle)
            Text(description).font(OtterTypography.caption).foregroundStyle(.secondary)
                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
        }
        .padding(24).frame(maxWidth: .infinity, minHeight: 180)
    }
}

extension View {
    func otterTextField() -> some View {
        modifier(OtterTextFieldAppearance())
    }
}

private struct OtterTextFieldAppearance: ViewModifier {
    @FocusState private var isFocused: Bool

    func body(content: Content) -> some View {
        content.textFieldStyle(.plain).font(OtterTypography.body).focused($isFocused)
            .padding(.horizontal, 10).padding(.vertical, 7)
            .frame(minHeight: OtterTheme.controlHeight)
            .background(OtterTheme.field, in: RoundedRectangle(cornerRadius: OtterTheme.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: OtterTheme.controlRadius)
                .strokeBorder(isFocused ? OtterTheme.accent : OtterTheme.line, lineWidth: isFocused ? 1.5 : 0.75))
    }
}

@MainActor private final class MenuAnchor: ObservableObject { weak var view: NSView? }
private struct MenuAnchorView: NSViewRepresentable {
    let anchor: MenuAnchor
    func makeNSView(context: Context) -> NSView {
        let view = NSView(); anchor.view = view; return view
    }
    func updateNSView(_ view: NSView, context: Context) { anchor.view = view }
}
@MainActor private final class MenuTarget: NSObject {
    let actions: [() -> Void]
    init(actions: [() -> Void]) { self.actions = actions }
    @objc func choose(_ item: NSMenuItem) { actions[item.tag]() }
}

extension ToolbarContent {
    /// These controls already have a surface; retain the native toolbar without double bezels.
    @ToolbarContentBuilder func otterToolbarControl() -> some ToolbarContent {
        #if compiler(>=6.2)
        if #available(macOS 26.0, *) {
            self.sharedBackgroundVisibility(.hidden)
        } else {
            self
        }
        #else
        self
        #endif
    }
}
