import Foundation
import Markdown
import TOMLKit
import Yams

public struct SkillMetadata: Sendable {
    public var fields: [String: String] = [:]
    public var problems: [WorkspaceProblem] = []
    public var body: String = ""
    public var bodyLine: Int = 1
}

public struct DocumentReference: Sendable {
    public var destination: String
    public var line: Int
    public var column: Int
    public var isImage: Bool
    /// swift-markdown source columns count UTF-8 bytes, with an exclusive upper bound.
    public var utf8Range: Range<Int>?
}

public struct DocumentHeading: Sendable, Identifiable {
    public var title: String
    public var level: Int
    public var line: Int
    public var id: Int { line }
}

public enum SkillValidator {
    public static let specification = "Agent Skills · name/description + package integrity"
    private static let namePattern = try! NSRegularExpression(pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$")

    private static func frontmatter(_ text: String) -> (yaml: String, lines: [String], end: Int)? {
        let lines = text.components(separatedBy: "\n")
        guard lines.first?.trimmingCharacters(in: .whitespacesAndNewlines) == "---",
              let end = lines.dropFirst().firstIndex(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines) == "---" }) else { return nil }
        return (lines[1..<end].joined(separator: "\n"), lines, end)
    }

    public static func inspect(_ text: String, path: String, directoryName: String? = nil, requireSkill: Bool = true) -> SkillMetadata {
        var result = SkillMetadata(body: text)
        guard text.utf8.count <= FileSystem.maximumTextBytes else {
            result.problems = [WorkspaceProblem("text.size", "文本超过编辑校验上限", path: path)]; return result
        }
        guard let front = frontmatter(text) else {
            if requireSkill { result.problems = [WorkspaceProblem("yaml.frontmatter", "SKILL.md 需要由 --- 包围的 YAML 元数据", path: path)] }
            return result
        }
        result.body = front.lines.dropFirst(front.end + 1).joined(separator: "\n")
        result.bodyLine = front.end + 2
        do {
            guard let node = try Yams.compose(yaml: front.yaml), let mapping = node.mapping else {
                result.problems = [WorkspaceProblem("yaml.mapping", "Frontmatter 必须是 YAML mapping", path: path, line: 2)]; return result
            }
            duplicateKeys(node, path: path, offset: 1, into: &result.problems)
            for pair in mapping {
                if let key = pair.key.string, let value = pair.value.any as? String { result.fields[key] = value }
            }
            if requireSkill {
                for (field, maximum) in [("name", 64), ("description", 1024), ("compatibility", 500)] {
                    let valueNode = mapping.first { $0.key.string == field }?.value
                    if field == "compatibility" && valueNode == nil { continue }
                    let value = valueNode?.any as? String
                    let line = (valueNode?.mark?.line ?? 1) + 1
                    if value == nil || value!.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || value!.count > maximum {
                        result.problems.append(WorkspaceProblem("skill.\(field)", "\(field) 必须是 1–\(maximum) 字符的字符串", path: path, line: line))
                    }
                }
                if let name = result.fields["name"], !name.isEmpty {
                    if namePattern.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) == nil {
                        result.problems.append(WorkspaceProblem("skill.name-format", "name 仅使用小写字母、数字和单个连字符", path: path, line: 2))
                    }
                    if let directoryName, name != directoryName {
                        result.problems.append(WorkspaceProblem("skill.directory-name", "name 与包目录名 \(directoryName) 不一致", path: path, severity: .warning, line: 2))
                    }
                }
                if let metadata = mapping.first(where: { $0.key.string == "metadata" })?.value,
                   metadata.mapping == nil || metadata.mapping!.contains(where: { !($0.key.any is String) || !($0.value.any is String) }) {
                    result.problems.append(WorkspaceProblem("skill.metadata", "metadata 必须是字符串键和值的 mapping", path: path, line: (metadata.mark?.line ?? 1) + 1))
                }
            }
            for key in ["disable-model-invocation", "user-invocable"] {
                if let value = mapping.first(where: { $0.key.string == key })?.value, !(value.any is Bool) {
                    result.problems.append(WorkspaceProblem("claude.\(key)", "Claude 的 \(key) 字段需要布尔值", path: path, line: (value.mark?.line ?? 1) + 1))
                }
            }
            for key in ["tags", "related_skills"] {
                if let value = mapping.first(where: { $0.key.string == key })?.value,
                   value.sequence == nil || value.sequence!.contains(where: { !($0.any is String) }) {
                    result.problems.append(WorkspaceProblem("hermes.\(key)", "Hermes 的 \(key) 应是字符串列表", path: path, severity: .warning, line: (value.mark?.line ?? 1) + 1))
                }
            }
        } catch { result.problems.append(yamlProblem(error, path: path, offset: 1)) }
        return result
    }

    private static func duplicateKeys(_ node: Node, path: String, offset: Int, into problems: inout [WorkspaceProblem], depth: Int = 0) {
        guard depth < 64 else { problems.append(WorkspaceProblem("yaml.depth", "YAML 嵌套超过 64 层", path: path)); return }
        if let mapping = node.mapping {
            var keys = Set<String>()
            for pair in mapping {
                if let key = pair.key.string, !keys.insert(key).inserted {
                    problems.append(WorkspaceProblem("yaml.duplicate-key", "重复键：\(key)", path: path, line: (pair.key.mark?.line ?? 1) + offset, column: pair.key.mark?.column ?? 1))
                }
                duplicateKeys(pair.value, path: path, offset: offset, into: &problems, depth: depth + 1)
            }
        } else if let sequence = node.sequence {
            for value in sequence { duplicateKeys(value, path: path, offset: offset, into: &problems, depth: depth + 1) }
        }
    }

    private static func yamlProblem(_ error: Error, path: String, offset: Int = 0) -> WorkspaceProblem {
        if let yaml = error as? YamlError {
            switch yaml {
            case .duplicatedKeysInMapping(let keys, let context):
                return WorkspaceProblem("yaml.duplicate-key", "重复键：\(keys.joined(separator: "、"))（定位到首次定义）", path: path, line: context.mark.line + offset, column: context.mark.column)
            case .scanner(_, let message, let mark, _), .parser(_, let message, let mark, _), .composer(_, let message, let mark, _):
                return WorkspaceProblem(message.localizedCaseInsensitiveContains("duplicate") ? "yaml.duplicate-key" : "yaml.syntax", message, path: path, line: mark.line + offset, column: mark.column)
            default: break
            }
        }
        return WorkspaceProblem("yaml.syntax", "YAML 无法解析", path: path, detail: String(describing: error))
    }

    public static func validateDocument(_ text: String, path: String, packageRoot: String? = nil) -> [WorkspaceProblem] {
        let ext = (path as NSString).pathExtension.lowercased()
        let isSkill = (path as NSString).lastPathComponent == "SKILL.md"
        var problems: [WorkspaceProblem] = []
        if ext == "md" {
            let metadata = inspect(text, path: path, directoryName: packageRoot.map { ($0 as NSString).lastPathComponent }, requireSkill: isSkill)
            problems += metadata.problems
            if let packageRoot {
                for reference in references(in: metadata.body) {
                    guard let target = localReference(reference.destination, from: path) else { continue }
                    let resolution = FileSystem.resolve(target)
                    if resolution.status != .readable {
                        problems.append(WorkspaceProblem("package.missing-reference", "引用不可读取：\(reference.destination)", path: path, severity: .warning,
                            line: reference.line + metadata.bodyLine - 1, column: reference.column, detail: resolution.error ?? ""))
                    } else if let final = resolution.finalPath, !FileSystem.isWithin(final, FileSystem.resolve(packageRoot).finalPath ?? packageRoot) {
                        problems.append(WorkspaceProblem("package.external-reference", "引用位于包外：\(reference.destination)", path: path, severity: .information, line: reference.line + metadata.bodyLine - 1))
                    }
                }
            }
        } else if ["yaml", "yml"].contains(ext) {
            do {
                if let node = try Yams.compose(yaml: text) {
                    duplicateKeys(node, path: path, offset: 0, into: &problems)
                    if path.hasSuffix("/agents/openai.yaml") { problems += validateOpenAI(node, path: path) }
                }
            } catch { problems.append(yamlProblem(error, path: path)) }
        } else if ext == "json" {
            do { _ = try JSONSerialization.jsonObject(with: Data(text.utf8), options: [.fragmentsAllowed]) }
            catch { problems.append(WorkspaceProblem("json.syntax", error.localizedDescription, path: path)) }
        } else if ext == "toml" {
            do { _ = try TOMLTable(string: text) }
            catch let error as TOMLParseError { problems.append(WorkspaceProblem("toml.syntax", error.localizedDescription, path: path, line: Int(error.source.begin.line), column: Int(error.source.begin.column))) }
            catch { problems.append(WorkspaceProblem("toml.syntax", error.localizedDescription, path: path)) }
        }
        return problems
    }

    private static func validateOpenAI(_ node: Node, path: String) -> [WorkspaceProblem] {
        guard let map = node.mapping else { return [WorkspaceProblem("codex.metadata", "openai.yaml 必须是 mapping", path: path)] }
        var problems: [WorkspaceProblem] = []
        if let interface = map.first(where: { $0.key.string == "interface" })?.value {
            if interface.mapping == nil { problems.append(WorkspaceProblem("codex.interface", "interface 需要 mapping", path: path, line: interface.mark?.line ?? 1)) }
            for pair in interface.mapping ?? [:] where ["display_name", "short_description", "icon_small", "icon_large", "brand_color", "default_prompt"].contains(pair.key.string ?? "") {
                if !(pair.value.any is String) { problems.append(WorkspaceProblem("codex.interface-type", "\(pair.key.string ?? "字段") 需要字符串", path: path, line: pair.value.mark?.line ?? 1)) }
            }
        }
        if let policy = map.first(where: { $0.key.string == "policy" })?.value,
           let allow = policy.mapping?.first(where: { $0.key.string == "allow_implicit_invocation" })?.value, !(allow.any is Bool) {
            problems.append(WorkspaceProblem("codex.invocation-policy", "allow_implicit_invocation 需要布尔值", path: path, line: allow.mark?.line ?? 1))
        }
        if let dependencies = map.first(where: { $0.key.string == "dependencies" })?.value, dependencies.mapping == nil {
            problems.append(WorkspaceProblem("codex.dependencies", "dependencies 需要 mapping", path: path, line: dependencies.mark?.line ?? 1))
        }
        return problems
    }

    public static func headings(in text: String) -> [DocumentHeading] {
        let metadata = inspect(text, path: "", requireSkill: false)
        var result: [DocumentHeading] = []
        func walk(_ node: any Markup) {
            if let heading = node as? Heading {
                result.append(DocumentHeading(title: heading.plainText, level: heading.level,
                    line: (heading.range?.lowerBound.line ?? 1) + metadata.bodyLine - 1))
            }
            for child in node.children { walk(child) }
        }
        walk(Document(parsing: metadata.body)); return result
    }

    public static func references(in text: String) -> [DocumentReference] {
        var result: [DocumentReference] = []
        let bytes = Array(text.utf8)
        let starts = [0] + bytes.indices.filter { bytes[$0] == 10 }.map { $0 + 1 }
        func offsets(_ range: SourceRange?) -> Range<Int>? {
            guard let range, starts.indices.contains(range.lowerBound.line - 1),
                  starts.indices.contains(range.upperBound.line - 1) else { return nil }
            let lower = starts[range.lowerBound.line - 1] + range.lowerBound.column - 1
            let upper = starts[range.upperBound.line - 1] + range.upperBound.column - 1
            guard lower >= 0, upper >= lower, upper <= bytes.count else { return nil }
            return lower..<upper
        }
        func walk(_ node: any Markup) {
            if let link = node as? Link, let destination = link.destination {
                result.append(DocumentReference(destination: destination, line: link.range?.lowerBound.line ?? 1, column: link.range?.lowerBound.column ?? 1, isImage: false, utf8Range: offsets(link.range)))
            } else if let image = node as? Markdown.Image, let source = image.source {
                result.append(DocumentReference(destination: source, line: image.range?.lowerBound.line ?? 1, column: image.range?.lowerBound.column ?? 1, isImage: true, utf8Range: offsets(image.range)))
            }
            for child in node.children { walk(child) }
        }
        walk(Document(parsing: text)); return result
    }
    public static func localReference(_ destination: String, from path: String) -> String? {
        guard !destination.isEmpty, !destination.hasPrefix("#"), URL(string: destination)?.scheme == nil else { return nil }
        let bare = destination.components(separatedBy: "#")[0].components(separatedBy: "?")[0].removingPercentEncoding ?? destination
        if bare.hasPrefix("/") { return bare }
        return FileSystem.join((path as NSString).deletingLastPathComponent, bare)
    }

    /// Edits only a top-level scalar. Complex/aliased/flow YAML remains editable as source.
    public static func setField(_ key: String, value: String, in source: String) throws -> String {
        guard ["name", "description", "license", "compatibility"].contains(key) else { throw WorkspaceError.message("此字段请在源码中编辑") }
        guard let front = frontmatter(source), let map = try Yams.compose(yaml: front.yaml)?.mapping,
              map.style != .flow else { throw WorkspaceError.message("无法无损编辑；请在源码中修正 YAML") }
        var duplicates: [WorkspaceProblem] = []
        if let node = try Yams.compose(yaml: front.yaml) { duplicateKeys(node, path: "", offset: 1, into: &duplicates) }
        guard duplicates.isEmpty else { throw WorkspaceError.message("请先在源码中修复重复键") }
        let newline = source.contains("\r\n") ? "\r\n" : "\n"
        var lines = source.components(separatedBy: newline)
        let quoted = String(data: try JSONEncoder().encode(value), encoding: .utf8)!
        guard let pair = map.first(where: { $0.key.string == key }) else {
            lines.insert("\(key): \(quoted)", at: front.end); return lines.joined(separator: newline)
        }
        guard pair.key.mark?.column == 1, let scalar = pair.value.scalar,
              pair.value.anchor == nil, let mark = pair.key.mark else { throw WorkspaceError.message("此字段包含复杂 YAML，请在源码中编辑") }
        if (pair.value.any as? String) == value { return source }
        let index = mark.line
        guard lines.indices.contains(index), let colon = lines[index].firstIndex(of: ":") else { throw WorkspaceError.message("无法定位字段") }
        let tail = String(lines[index][lines[index].index(after: colon)...])
        if scalar.style == .literal || scalar.style == .folded {
            var end = index + 1
            while end < front.end && (lines[end].hasPrefix(" ") || lines[end].isEmpty) { end += 1 }
            let body = value.components(separatedBy: "\n").map { "  " + $0 }
            // Preserve comments on the field; a literal block preserves the edited value's newlines.
            let comment = tail.firstIndex(of: "#").map { " " + String(tail[$0...]) } ?? ""
            lines[index] = "\(key): |-\(comment)"
            lines.replaceSubrange((index + 1)..<end, with: body)
        } else {
            guard scalar.mark?.line == mark.line else { throw WorkspaceError.message("多行引号字符串请在源码中编辑") }
            // A one-line scalar must parse on this line independently before replacing it.
            guard let standalone = try? Yams.compose(yaml: lines[index]), standalone.mapping?.count == 1 else { throw WorkspaceError.message("多行 YAML 请在源码中编辑") }
            var quote: Character?; var escaped = false; var comment: String = ""
            for index in tail.indices {
                let character = tail[index]
                if escaped { escaped = false; continue }
                if character == "\\" && quote == "\"" { escaped = true; continue }
                if character == quote { quote = nil; continue }
                if quote == nil && (character == "\"" || character == "'") { quote = character; continue }
                if character == "#" && quote == nil && (index == tail.startIndex || tail[tail.index(before: index)].isWhitespace) { comment = " " + String(tail[index...]); break }
            }
            lines[index] = "\(key): \(quoted)\(comment)"
        }
        let edited = lines.joined(separator: newline)
        guard let after = frontmatter(edited), let checked = try Yams.compose(yaml: after.yaml)?.mapping,
              (checked.first { $0.key.string == key }?.value.any as? String) == value else { throw WorkspaceError.message("无法保真编辑此字段；请使用源码模式") }
        return edited
    }
}
