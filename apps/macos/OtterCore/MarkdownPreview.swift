import Foundation
import Markdown

/// Renders the parsed Markdown AST. Raw HTML is shown as text, and images stay inside the package.
public enum MarkdownPreview {
    public static func html(_ text: String, path: String, packageRoot: String?) -> String {
        func escaped(_ value: String) -> String { value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;").replacingOccurrences(of: "'", with: "&#39;") }
        func children(_ node: any Markup) -> String { node.children.map(render).joined() }
        func render(_ node: any Markup) -> String {
            switch node {
            case let heading as Heading: return "<h\(heading.level)>\(children(node))</h\(heading.level)>"
            case let text as Markdown.Text: return escaped(text.string)
            case let code as InlineCode: return "<code>\(escaped(code.code))</code>"
            case let code as CodeBlock: return "<pre><code>\(escaped(code.code))</code></pre>"
            case is Paragraph: return "<p>\(children(node))</p>"
            case is Strong: return "<strong>\(children(node))</strong>"
            case is Emphasis: return "<em>\(children(node))</em>"
            case is Strikethrough: return "<del>\(children(node))</del>"
            case is SoftBreak: return "\n"
            case is LineBreak: return "<br>"
            case is ThematicBreak: return "<hr>"
            case is UnorderedList: return "<ul>\(children(node))</ul>"
            case let list as OrderedList: return "<ol start='\(list.startIndex)'>\(children(node))</ol>"
            case let item as ListItem: return "<li>\(item.checkbox.map { $0 == .checked ? "☑ " : "☐ " } ?? "")\(children(node))</li>"
            case is BlockQuote: return "<blockquote>\(children(node))</blockquote>"
            case let link as Link:
                let destination = link.destination ?? ""
                let href: String
                if let local = SkillValidator.localReference(destination, from: path) {
                    var parts = URLComponents(); parts.scheme = "otter-file"; parts.host = "open"; parts.queryItems = [URLQueryItem(name: "path", value: local)]; href = parts.string ?? ""
                } else if ["http", "https", "mailto"].contains(URL(string: destination)?.scheme ?? "") || destination.hasPrefix("#") { href = destination }
                else { return children(node) }
                return "<a href='\(escaped(href))'>\(children(node))</a>"
            case let image as Markdown.Image:
                if let source = image.source, let local = SkillValidator.localReference(source, from: path), let packageRoot,
                   let root = FileSystem.resolve(packageRoot).finalPath, let final = FileSystem.resolve(local).finalPath,
                   FileSystem.isWithin(final, root), let data = try? FileSystem.read(final, limit: 5 * 1024 * 1024) {
                    let mime = ["png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"][(final as NSString).pathExtension.lowercased()]
                    if let mime { return "<img alt='\(escaped(image.plainText))' src='data:\(mime);base64,\(data.base64EncodedString())'>" }
                }
                return "<span class='muted'>[图片：\(escaped(image.plainText)) · 使用本地包内图片]</span>"
            case let raw as HTMLBlock: return "<pre>\(escaped(raw.rawHTML))</pre>"
            case let raw as InlineHTML: return "<code>\(escaped(raw.rawHTML))</code>"
            case is Table: return "<table>\(children(node))</table>"
            case is Table.Head: return "<thead><tr>\(children(node))</tr></thead>"
            case is Table.Body: return "<tbody>\(children(node))</tbody>"
            case is Table.Row: return "<tr>\(children(node))</tr>"
            case is Table.Cell: return "<td>\(children(node))</td>"
            default: return children(node)
            }
        }
        let body = SkillValidator.inspect(text, path: path, requireSkill: false).body
        return """
        <!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
        <style>body{font:14px/1.7 -apple-system,BlinkMacSystemFont,sans-serif;margin:28px;color:CanvasText;background:Canvas;overflow-wrap:anywhere}h1,h2,h3{line-height:1.35;margin:1.6em 0 .7em}h1{font-size:26px}h2{font-size:20px}p{margin:.8em 0}pre{padding:16px;overflow:auto;border-radius:8px;background:light-dark(#f0f4f3,#252e31)}code{font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap}a{color:light-dark(#216c76,#91ccd1)}blockquote{border-left:3px solid #7b9d9a;padding-left:16px;margin-left:0;opacity:.8}img{max-width:100%;height:auto;border-radius:8px}table{border-collapse:collapse;width:100%}td{padding:8px;border:1px solid #8885}thead{font-weight:600}.muted{opacity:.6}hr{border:0;border-top:1px solid #8885;margin:24px 0}</style>
        </head><body>\(render(Document(parsing: body)))</body></html>
        """
    }
}
