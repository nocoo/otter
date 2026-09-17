import AppKit
import OtterCore
import SwiftUI

struct BackupView: View {
    @Bindable var store: WorkspaceStore
    @State private var slim = true
    private var busy: Bool { store.jobs.contains(where: \.isRunning) }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                OtterPageHeading(title: "备份与任务", subtitle: "使用本机 Otter CLI 采集环境，先检查本地快照，再上传确定的对象。")
                    .nativeAnchor("page-heading", store: store)
                OtterCard {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack {
                            Label(store.capabilities.map { "Otter CLI " + ($0["cliVersion"].string ?? "") } ?? "检查 CLI…", systemImage: "terminal").font(OtterTypography.sectionTitle)
                            Spacer()
                            StatusBadge(title: store.cliStatus?["authenticated"].bool == true ? "已连接" : "本地模式", symbol: "person.crop.circle")
                        }
                        HStack(alignment: .top, spacing: 24) {
                            MetaRow(title: "实际 API 地址", value: store.cliStatus?["apiUrl"].string ?? store.configuration.apiURL)
                            MetaRow(title: "CLI 配置文件", value: store.cliStatus?["configPath"].string ?? store.configuration.cliConfigDirectory)
                        }
                        if let error = store.cliError { Text(error).font(OtterTypography.caption).foregroundStyle(OtterTheme.warning) }
                        HStack(spacing: 12) {
                            Button { store.startJob("采集本地快照", arguments: ["scan", "--save"] + (slim ? ["--slim"] : [])) } label: { Label("采集并保存", systemImage: "externaldrive.badge.plus") }
                                .buttonStyle(OtterButtonStyle(treatment: .accent)).disabled(busy || store.capabilities == nil).nativeAnchor("cli-scan", store: store)
                            Button("连接账号…") { store.startJob("连接账号", arguments: ["login"]) }.buttonStyle(OtterButtonStyle()).disabled(busy)
                            Button("刷新") { Task { await store.refreshCLI() } }.buttonStyle(OtterButtonStyle()).disabled(busy)
                            Spacer()
                            Toggle("排除 Claude 历史与会话摘要", isOn: $slim).font(OtterTypography.body).toggleStyle(.checkbox)
                        }
                        Text("保存完整 skills 包、指令、rules、commands 与链接目标，包括独立资源及 Hermes profiles。凭据脱敏与未采集项会列入覆盖报告。")
                            .font(OtterTypography.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                if !store.jobs.isEmpty {
                    OtterSection(title: "任务", subtitle: "进度来自 CLI 事件；取消上传后的服务端接收情况可能需要核对。") {
                        ForEach(store.jobs) { job in JobRow(job: job, store: store) }
                    }
                }
                if let timeline = store.remoteTimeline {
                    OtterSection(title: "本地与远端版本", subtitle: timeline["remoteCheckedAt"].string.map { "远端核对于 " + $0 } ?? "远端状态尚未确认") {
                        if let error = timeline["remoteError"].string { Text(error).font(OtterTypography.caption).foregroundStyle(OtterTheme.warning) }
                        ForEach(Array(timeline["snapshots"].array.enumerated()), id: \.offset) { _, snapshot in
                            HStack {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text("\((snapshot["id"].string ?? "").prefix(8)) · \(snapshot["hostname"].string ?? "本机")").font(OtterTypography.label)
                                    Text("\(locationLabel(snapshot["location"].string)) · \(uploadLabel(snapshot["uploadState"].string)) · \(snapshot["complete"].bool == true ? "范围内覆盖完整" : snapshot["complete"].bool == false ? "部分采集" : "旧格式，覆盖未知")").font(OtterTypography.caption).foregroundStyle(.secondary)
                                }; Spacer()
                                if let id = snapshot["id"].string {
                                    if snapshot["location"].string == "remote" { Button("取回本地") { store.startJob("取回云端快照", arguments: ["snapshot", "download", id]) }.buttonStyle(OtterButtonStyle()) }
                                    else {
                                        Button("核对远端") { store.startJob("核对远端内容", arguments: ["snapshot", "verify", id]) }.buttonStyle(OtterButtonStyle(treatment: .plain))
                                        Button("导出…") { store.exportSnapshot(id: id) }.buttonStyle(OtterButtonStyle())
                                    }
                                }
                            }.padding(.vertical, 8)
                        }
                    }
                }
                OtterSection(title: "本地快照", subtitle: store.shortPath(store.configuration.cliOutputDirectory)) {
                    if store.snapshots.isEmpty {
                        OtterEmptyState(title: "还没有本地快照", symbol: "externaldrive", description: "采集并保存后，可以查看正文、比较变化和上传。")
                            .nativeAnchor("snapshots-empty", store: store)
                    }
                    ForEach(Array(store.snapshots.enumerated()), id: \.offset) { position, snapshot in
                        HStack(spacing: 14) {
                            Image(systemName: "archivebox").font(.system(size: 18)).frame(width: 22).foregroundStyle(OtterTheme.accent)
                            VStack(alignment: .leading, spacing: 6) {
                                Text(snapshot["createdAt"].string ?? "快照").font(OtterTypography.label)
                                Text("\(snapshot["shortId"].string ?? "") · \(Int(snapshot["fileCount"].number ?? 0)) 个文件 · \(Int(snapshot["listCount"].number ?? 0)) 个清单项").font(OtterTypography.caption).foregroundStyle(.secondary)
                            }; Spacer()
                            if position + 1 < store.snapshots.count { Button("比较上一份") { store.compareSnapshots(store.snapshots[position + 1], snapshot) }.buttonStyle(OtterButtonStyle(treatment: .plain)).font(OtterTypography.caption) }
                            Button("查看并审阅") { store.inspectSnapshot(snapshot) }.buttonStyle(OtterButtonStyle()).nativeAnchor("snapshot." + String(position), store: store)
                        }.padding(.vertical, 10)
                    }
                }.nativeAnchor("snapshots-section", store: store)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(OtterTheme.pageInset)
        }
    }
    private func locationLabel(_ state: String?) -> String {
        switch state { case "remote": "仅远端"; case "local-and-remote": "本地与远端"; default: "仅本地" }
    }
    private func uploadLabel(_ state: String?) -> String {
        switch state { case "confirmed": "远端内容已核对"; case "not-authenticated": "未连接账号"; case "not-uploaded": "待上传"; case "remote-only": "可取回"; case "missing-remote": "远端已缺失，需重新上传"; default: "远端待核对" }
    }
}
private struct JobRow: View {
    @Bindable var job: CLIJob
    let store: WorkspaceStore
    private var phase: String {
        switch job.phase { case "complete": "完成"; case "partial": "已保存 · 部分采集器有错误"; case "failed": "失败"; case "cancelled": "已取消"; case "interrupted": "上次任务待核对"; case "timedOut": "已超时"; case "awaitingBrowser": "等待浏览器登录"; case "uploading": "正在上传"; default: "正在执行" }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                if job.isRunning { ProgressView().controlSize(.small) } else { Image(systemName: job.phase == "complete" ? "checkmark.circle" : "exclamationmark.circle").foregroundStyle(job.phase == "complete" ? OtterTheme.accent : OtterTheme.warning) }
                Text(job.title).font(OtterTypography.label); Spacer()
                Text(phase).font(OtterTypography.caption).foregroundStyle(.secondary)
                if job.isRunning { Button("取消") { store.cancelJob() }.buttonStyle(OtterButtonStyle()).nativeAnchor("cancel-job", store: store) }
            }
            if !job.completedCollectors.isEmpty { Text("已完成：" + job.completedCollectors.joined(separator: "、")).font(OtterTypography.detail).foregroundStyle(.secondary) }
            if let error = job.error { Text(error).font(OtterTypography.caption).foregroundStyle(OtterTheme.warning).textSelection(.enabled) }
            DisclosureGroup("命令与诊断") {
                VStack(alignment: .leading, spacing: 10) {
                    Text(job.command).font(OtterTypography.code).textSelection(.enabled)
                    Text(job.lines.joined(separator: "\n")).font(OtterTypography.code).foregroundStyle(.secondary).textSelection(.enabled)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
            }.font(OtterTypography.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 8)
    }
}

struct WorkspaceSettingsView: View {
    @Bindable var store: WorkspaceStore
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                OtterPageHeading(title: "设置", subtitle: "本机扫描与编辑可离线使用。来源、CLI 和上传地址在这里配置。")
                    .nativeAnchor("page-heading", store: store)
                OtterSection(title: "外观与编辑") {
                    Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 16) {
                        GridRow {
                            Text("外观").frame(width: 104, alignment: .leading)
                            OtterSegmentedPicker(title: "外观", choices: [("system", "跟随系统"), ("light", "浅色"), ("dark", "深色")], selection: $store.configuration.appearance)
                                .frame(width: 280).nativeAnchor("settings-appearance", store: store)
                                .onChange(of: store.configuration.appearance) { _, _ in store.saveConfiguration() }
                        }
                        GridRow {
                            Text("编辑器字号")
                            HStack(spacing: 12) {
                                Slider(value: $store.configuration.editorFontSize, in: 11...20, step: 1)
                                    .onChange(of: store.configuration.editorFontSize) { _, _ in store.saveConfiguration() }
                                    .accessibilityLabel("编辑器字号")
                                Text("\(Int(store.configuration.editorFontSize)) pt").font(OtterTypography.caption).monospacedDigit().frame(width: 40, alignment: .trailing)
                            }.frame(width: 280, height: OtterTheme.controlHeight).nativeAnchor("settings-font-size", store: store)
                        }
                    }
                    .font(OtterTypography.body).frame(maxWidth: .infinity, alignment: .leading)
                }
                OtterSection(title: "扫描与来源", subtitle: "只扫描已知 Agent 入口、这些来源和选定项目，不递归扫描整块磁盘。") {
                    VStack(alignment: .leading, spacing: 16) {
                        MetaRow(title: "本机用户目录", value: store.configuration.home)
                        ForEach(store.configuration.sources, id: \.self) { source in
                            HStack { Text(store.shortPath(source)).font(OtterTypography.body).textSelection(.enabled).lineLimit(2).truncationMode(.middle); Spacer(); Button("移出扫描范围") { store.configuration.sources.removeAll { $0 == source }; store.saveConfiguration(); store.rescan() }.buttonStyle(OtterButtonStyle(treatment: .plain)) }
                        }
                        HStack { Button("添加来源…") { store.selectSource() }; Button("添加项目…") { store.selectSource(project: true) } }.buttonStyle(OtterButtonStyle())
                        ForEach(store.configuration.projects, id: \.self) { project in
                            HStack { Label(store.shortPath(project), systemImage: "folder").font(OtterTypography.caption); Spacer(); Button("移出") { store.configuration.projects.removeAll { $0 == project }; if store.configuration.selectedProject == project { store.configuration.selectedProject = nil }; store.saveConfiguration(); store.rescan() }.buttonStyle(OtterButtonStyle(treatment: .plain)) }
                        }
                    }
                }
                OtterSection(title: "Otter CLI", subtitle: "应用内置独立 CLI，也可以选择已安装的兼容版本。") {
                    VStack(alignment: .leading, spacing: 16) {
                        MetaRow(title: "当前可执行路径", value: store.cli?.executable ?? "未找到")
                        HStack {
                            Button("选择已有 CLI…") { store.chooseCLI() }
                            Button("使用内置 CLI") { store.configuration.externalCLI = nil; store.saveConfiguration(); Task { await store.refreshCLI() } }
                            Button("安装命令行入口…") { store.installCLI() }
                        }.buttonStyle(OtterButtonStyle())
                        Text("显式安装到 ~/Library/Application Support/Otter/bin/otter；不会修改 PATH 或覆盖其他全局安装。")
                            .font(OtterTypography.caption).foregroundStyle(.secondary)
                    }
                }
                OtterSection(title: "备份连接", subtitle: "API 地址与 CLI 配置文件共同决定上传目标。开发配置不会自动改变 API 地址。") {
                    VStack(alignment: .leading, spacing: 16) {
                        Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 12) {
                            GridRow {
                                Text("API 地址").frame(width: 104, alignment: .leading)
                                TextField("https://…", text: $store.configuration.apiURL).otterTextField()
                                    .accessibilityLabel("API 地址").nativeAnchor("settings-api", store: store)
                            }
                            GridRow {
                                Text("配置目录")
                                TextField("绝对路径", text: $store.configuration.cliConfigDirectory).otterTextField()
                                    .accessibilityLabel("CLI 配置目录").nativeAnchor("settings-config", store: store)
                            }
                            GridRow {
                                Text("快照目录")
                                TextField("绝对路径", text: $store.configuration.cliOutputDirectory).otterTextField()
                                    .accessibilityLabel("快照目录").nativeAnchor("settings-output", store: store)
                            }
                        }
                        Toggle("使用 config.dev.json", isOn: $store.configuration.development)
                        HStack {
                            Button("保存并检查连接") { store.saveConfiguration(); Task { await store.refreshCLI() } }.buttonStyle(OtterButtonStyle(treatment: .accent))
                            if let error = store.cliError { Text(error).foregroundStyle(OtterTheme.warning) }
                            else if store.capabilities != nil { Label("CLI 协议 1 可用", systemImage: "checkmark.circle").foregroundStyle(OtterTheme.accent) }
                        }
                    }.font(OtterTypography.body).disabled(store.jobs.contains(where: \.isRunning))
                }.nativeAnchor("settings-connection-section", store: store)
                OtterSection(title: "关于 Otter") {
                    HStack(alignment: .top, spacing: 18) {
                        Image(nsImage: NSImage(named: "OtterIcon") ?? NSImage()).resizable().frame(width: 56, height: 56)
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Otter \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")").font(OtterTypography.sectionTitle)
                            Text("Agent Workspace · macOS 15+").font(OtterTypography.caption).foregroundStyle(.secondary)
                            Link("打开 Otter Web", destination: URL(string: "https://otter.hexly.ai")!).font(OtterTypography.caption)
                        }; Spacer()
                        Button("查看本地数据") { store.reveal(store.dataDirectory) }.buttonStyle(OtterButtonStyle())
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(OtterTheme.pageInset)
        }.frame(maxWidth: .infinity)
    }
}
