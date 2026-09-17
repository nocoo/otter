import AppKit
import OtterCore
import SwiftUI

struct ProtectionSummary: View {
    @Bindable var store: WorkspaceStore
    private var state: String {
        switch store.backupStatus?["state"].string {
        case "unchanged": "配置与上次本地快照一致"
        case "needed": "配置需要备份"
        case "scope-changed": "采集范围已改变，需要建立新快照"
        default: "覆盖状态待检查"
        }
    }
    var body: some View {
        OtterSection(title: "配置保护", subtitle: store.workspaceCapture?["observedAt"].string ?? "尚未完成 CLI 检查") {
            HStack {
                StatusBadge(title: state, symbol: "externaldrive", warning: store.backupStatus?["state"].string != "unchanged")
                Spacer()
                Button("创建本地快照") { store.startJob("创建并保存完整快照", arguments: ["scan", "--save", "--slim"]); store.page = .backups }.buttonStyle(OtterButtonStyle(treatment: .accent))
            }
            let independent = store.workspaceCapture?["resources"].array.filter { $0["relationship"].string == "independent" } ?? []
            Text("\(independent.count) 个本机独立资源会与来源目录一起采集。\(store.workspaceCapture?["coverage"]["complete"].bool == true ? "当前配置扫描在既定策略内完成。" : "当前扫描有覆盖缺口；请查看具体问题。")")
                .font(OtterTypography.caption).foregroundStyle(.secondary)
            if let latest = store.backupStatus?["latestCompleteId"].string { Text("最近完整本地快照：\(latest.prefix(8))").font(OtterTypography.caption).foregroundStyle(.secondary) }
        }
    }
}

struct SourceGitStatus: View {
    let source: JSONValue
    let store: WorkspaceStore
    private var git: JSONValue { source["git"] }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                StatusBadge(title: source["status"].string == "complete" ? "扫描完成" : "覆盖不完整", symbol: "doc.text", warning: source["status"].string != "complete")
                if git["repository"].bool == true {
                    StatusBadge(title: git["detached"].bool == true ? "Detached HEAD" : git["unborn"].bool == true ? "尚无提交" : git["branch"].string ?? "分支未知", symbol: "arrow.triangle.branch")
                    Spacer()
                    Button("检查远端") { if let id = source["id"].string { store.startJob("检查 Git 远端", arguments: ["source", "fetch", id]) } }.buttonStyle(OtterButtonStyle()).disabled(store.jobs.contains(where: \.isRunning))
                } else { Text(git["error"].string ?? "普通文件夹 · 未使用 Git").foregroundStyle(.secondary) }
            }
            if git["repository"].bool == true {
                HStack(spacing: 16) {
                    ForEach([("staged", "暂存"), ("unstaged", "未暂存"), ("untracked", "未跟踪"), ("conflicts", "冲突")], id: \.0) { key, label in
                        Text("\(label) \(Int(git[key].number ?? 0))").foregroundStyle((git[key].number ?? 0) > 0 ? OtterTheme.warning : .secondary)
                    }
                }.font(OtterTypography.caption)
                if let upstream = git["upstream"].string {
                    Text("\(upstream) · 领先 \(Int(git["ahead"].number ?? 0)) · 落后 \(Int(git["behind"].number ?? 0))").font(OtterTypography.caption)
                } else { Text("未设置 upstream").font(OtterTypography.caption).foregroundStyle(.secondary) }
                Text(git["remoteCheckedAt"].string.map { "远端检查：\($0)" } ?? "远端尚未检查；领先/落后基于本地跟踪记录。")
                    .font(OtterTypography.caption).foregroundStyle(.secondary)
                if let error = git["fetchError"].string ?? git["error"].string { Text(error).font(OtterTypography.caption).foregroundStyle(OtterTheme.warning) }
            }
        }.font(OtterTypography.body)
    }
}

struct EnvironmentView: View {
    @Bindable var store: WorkspaceStore
    @State private var search = ""
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                OtterPageHeading(title: "软件与环境", subtitle: "最近本地快照的安装清单。App 与工具需要重新安装；配置正文可从备份导出。")
                    .nativeAnchor("page-heading", store: store)
                SearchField(title: "搜索 App、工具或版本", text: $search)
                if let snapshot = store.environmentSnapshot {
                    Text("采集于 \(snapshot["createdAt"].string ?? "")").font(OtterTypography.caption).foregroundStyle(.secondary)
                    Button("导出配置与重装清单…") { store.exportSnapshot(id: snapshot["id"].string) }.buttonStyle(OtterButtonStyle())
                    ForEach(Array(snapshot["collectors"].array.filter { $0["category"].string == "environment" }.enumerated()), id: \.offset) { _, collector in
                        OtterSection(title: collector["label"].string ?? "环境") {
                            ForEach(Array(collector["lists"].array.filter { search.isEmpty || $0.pretty.localizedCaseInsensitiveContains(search) }.enumerated()), id: \.offset) { _, item in
                                HStack(alignment: .top) {
                                    VStack(alignment: .leading, spacing: 4) { Text(item["name"].string ?? ""); if let path = item["meta"]["path"].string { Text(path).font(OtterTypography.caption).foregroundStyle(.secondary) } }
                                    Spacer(); Text(item["version"].string ?? "版本未知").foregroundStyle(.secondary)
                                }.font(OtterTypography.body).padding(.vertical, 4)
                            }
                        }
                    }
                } else {
                    OtterEmptyState(title: "先创建本地快照", symbol: "app.badge", description: "备份页的完整采集会更新已安装软件与工具清单。")
                }
            }.padding(OtterTheme.pageInset)
        }
    }
}

extension WorkspaceStore {
    func exportSnapshot(id: String?) {
        guard let id else { return }
        let panel = NSSavePanel(); panel.title = "导出到新的独立文件夹"; panel.nameFieldStringValue = "Otter-\(id.prefix(8))"
        guard panel.runModal() == .OK, let path = panel.url?.path else { return }
        startJob("导出配置与环境清单", arguments: ["snapshot", "export", id, "--destination", path])
    }
}
