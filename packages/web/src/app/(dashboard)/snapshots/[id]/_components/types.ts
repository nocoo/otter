import type { SnapshotCollector } from "@/lib/snapshot-collectors";

export type FileData = SnapshotCollector["files"][number];
export type ListItem = SnapshotCollector["lists"][number];
export type Collector = SnapshotCollector;

export interface SnapshotMeta {
  id: string;
  hostname: string;
  platform: string;
  arch: string;
  username: string;
  collectorCount: number;
  fileCount: number;
  listCount: number;
  sizeBytes: number;
  snapshotAt: number;
  uploadedAt: number;
}

export interface SnapshotData {
  version: number;
  id: string;
  createdAt: string;
  machine: {
    hostname: string;
    platform: string;
    arch: string;
    username: string;
  };
  collectors: Collector[];
}
