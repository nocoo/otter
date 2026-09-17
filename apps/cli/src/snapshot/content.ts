import type { CollectedFile, Snapshot } from "@otter/core";
/** All references resolve to inline bytes inside this snapshot, never another snapshot or a live path. */
export function snapshotFiles(snapshot: Snapshot): CollectedFile[] {
  const files = snapshot.collectors.flatMap((c) => c.files);
  const inline = new Map(files.filter((f) => f.sha256 && !f.contentRef).map((f) => [f.sha256, f]));
  return files.map((file) => {
    if (!file.contentRef) return file;
    const source = inline.get(file.contentRef);
    if (
      !source ||
      source.sha256 !== file.sha256 ||
      source.encoding !== file.encoding ||
      source.sizeBytes !== file.sizeBytes
    )
      throw new Error(`Invalid snapshot content reference: ${file.path}`);
    return { ...file, content: source.content };
  });
}
