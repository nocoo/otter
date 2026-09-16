# Otter macOS 的代码来源与许可

记录时间：2026-09-15。Lyre 的 HEAD 为 `47d8807`，其中本次使用的 UI 改版仍在未提交工作区；Showtime 的 HEAD 为 `25a7d6e`，工作区干净。以下 SHA-256 标识实际读取的文件，不能只用 HEAD 重建 Lyre 的界面。

| 仓库内路径 | SHA-256 |
| --- | --- |
| Lyre `apps/macos/Lyre/Views/LyreTheme.swift` | `5c87c2c467a324d970acefbf819f5e898ab28914cd91610a00589d0a3e460d03` |
| Lyre `apps/macos/Lyre/Views/MainWindowView.swift` | `b4e2769d25edced3f8fd66cf372a8d0f5741ac4c9ec9a0361082975a59b7aa02` |
| Lyre `apps/macos/Lyre/Views/RecordingsView.swift` | `0cc235962cc3f55dad0117e2dc1effafffd31ab6eeb32dd8f3676c6c3693c57a` |
| Lyre `apps/macos/Lyre/Views/RecordingLibraryState.swift` | `333f9548e2e137414de013867cfc76742f13dcc91c63fbdd02b94c8877a7f839` |
| Lyre `docs/design/macos-2026-09-15/Preview.swift` | `f9ff7d5046fad70b101d070e0d2f7fe9f9661c3de66636baa20270f2c30e2bde` |
| Showtime `Sources/Showtime/App/StudioTheme.swift` | `501a81b83565933d3b70bd6c7e607c35888dafa5239133e237bb836491d1a9c4` |
| Showtime `Sources/Showtime/App/StudioToast.swift` | `fd8fda0b72253a3e6de1712e080d8700e48e5583451bc5e6c57cbdea68db5eeb` |
| Showtime `Sources/Showtime/App/StudioWindow.swift` | `c82eae6fcf151fad5710fda3222ddf67e4a06ac3c3b0320915cb62acab5b386c` |

`Otter/Controls.swift` 从设计预览移入实际 App，复制适配了 Lyre 的按钮、Card、Section、PageHeading、toolbar 兼容方法，以及 Showtime 的 InspectorSection、NSMenu 锚点/目标和动态颜色。修改包括 Otter 命名和青蓝色、独立的强调色前景、统一 32 pt 控件与 8/12 pt 圆角、Swift 6 MainActor 标注。分段选择器参考 Showtime 的控件布局，使用系统大号 `Picker(.segmented)`。来源、资源和 profile 使用稳定路径/ID。2026-09-16 再次核对的 Showtime `StudioTheme.swift` SHA-256 与上表一致。

`Otter/WorkspaceView.swift` 沿用 Lyre 的单个 NavigationSplitView、List 与 HStack 详情组织，模型、扫描器、文档编辑与事务为 Otter 实现。`Otter/NativeAutomation.swift` 参考 Showtime `StudioWindow` 的 NSEvent 输入路径和 Lyre 的本进程截图方式，扩展为实际编辑、磁盘变更、CLI 与重启验证。原来的 `docs/design` 预览继续单独保留，不进入 App 或 Worker。构建无需相邻仓库。

Showtime 的 Toast 与完整自动化服务用于交互/测试设计，未复制进 App。录音、播放器、上传服务、视频画布、ShowtimeCore 均未引入。来源背景见[复用与迁移规格](../../docs/features/03-macos-agent-workspace-ui.md)。

## 解析器与内置 CLI

`Package.resolved` 固定 Yams 6.2.2（MIT）、TOMLKit 0.6.0（MIT）、swift-markdown 0.6.0（Apache 2.0 / Swift 例外）与 swift-cmark 0.8.0（BSD 及其附带许可）。这些依赖的上游 LICENSE / NOTICE 全文与 CLI npm 依赖许可保存在 `Otter/Resources/ThirdPartyNotices.txt`，随 App 分发。

CLI 复用本项目的 MIT 代码与 `@nocoo/base-cli`，由 Bun 编译为独立 arm64 / x64 可执行文件。Bun runtime 的许可和第三方清单以 [Bun LICENSE](https://github.com/oven-sh/bun/blob/main/LICENSE.md) 和 [Bun LICENSES](https://github.com/oven-sh/bun/tree/main/LICENSES) 为准；升级 Bun 时需同步分发清单。

## 许可

引用及衍生部分遵循两个源仓库的 MIT 许可，保留原版权。Otter 的其余代码遵循项目根目录 [LICENSE](../../LICENSE)。

```text
MIT License

Copyright (c) 2026 Zheng Li
Copyright (c) 2026 nocoo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
