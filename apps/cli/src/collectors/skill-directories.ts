import { readdir, realpath, stat } from "node:fs/promises";
import { join, relative } from "node:path";

/** Follows directory aliases, retaining each logical entry; ancestry prevents cycles. */
export async function skillDirectories(
  root: string,
  errors: string[],
  recursive = false,
  requireSkill = true,
): Promise<string[]> {
  const found: string[] = [];
  let visited = 0;
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: bounded recursive traversal with per-entry error isolation
  async function visit(path: string, ancestry: Set<string>, depth: number): Promise<void> {
    if (++visited > 10_000 || depth > 32) throw new Error("Skill enumeration limit exceeded");
    const canonical = await realpath(path);
    if (ancestry.has(canonical)) throw new Error(`Skill directory cycle: ${path}`);
    const next = new Set([...ancestry, canonical]);
    const entries = await readdir(path, { withFileTypes: true });
    if (depth > 0) {
      try {
        if ((await stat(join(path, "SKILL.md"))).isFile()) {
          found.push(relative(root, path));
          return;
        }
      } catch {
        /* A category directory may contain nested skill packages. */
      }
      if (!requireSkill) {
        found.push(relative(root, path));
        return;
      }
    }
    if (depth > 0 && !recursive) return;
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const child = join(path, entry.name);
      try {
        // biome-ignore lint/performance/noAwaitInLoops: bounded traversal with per-entry error isolation
        if (entry.isDirectory() || (entry.isSymbolicLink() && (await stat(child)).isDirectory()))
          await visit(child, next, depth + 1);
      } catch (error) {
        errors.push(`Failed to enumerate ${child}: ${(error as Error).message}`);
      }
    }
  }
  try {
    await visit(root, new Set(), 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      errors.push(`Failed to read skills directory ${root}: ${(error as Error).message}`);
  }
  return found.sort();
}
