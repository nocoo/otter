import { describe, expect, it } from "vitest";
import {
  badgeClassName,
  computeIconUrl,
  formatDateTime,
  formatMetaLabel,
  listItemKey,
  metaEntries,
  resolveIconUrl,
} from "@/components/snapshot/helpers";

describe("snapshot helpers", () => {
  describe("formatDateTime", () => {
    it("formats a timestamp to a human-readable date string", () => {
      const ts = new Date("2026-01-15T10:30:00Z").getTime();
      const result = formatDateTime(ts);
      expect(result).toContain("2026");
      expect(result).toContain("Jan");
      expect(result).toContain("15");
    });
  });

  describe("computeIconUrl", () => {
    it("returns a deterministic URL based on app name hash", async () => {
      const url = await computeIconUrl("Safari");
      expect(url).toMatch(/^https:\/\/s\.zhe\.to\/apps\/otter\/[a-f0-9]{12}\.png$/);
    });

    it("returns the same URL for the same name", async () => {
      const url1 = await computeIconUrl("Firefox");
      const url2 = await computeIconUrl("Firefox");
      expect(url1).toBe(url2);
    });

    it("returns different URLs for different names", async () => {
      const url1 = await computeIconUrl("Chrome");
      const url2 = await computeIconUrl("Safari");
      expect(url1).not.toBe(url2);
    });
  });

  describe("resolveIconUrl", () => {
    it("returns iconUrl from meta", () => {
      const item = { name: "App", meta: { iconUrl: "https://example.com/icon.png" } };
      expect(resolveIconUrl(item)).toBe("https://example.com/icon.png");
    });

    it("returns undefined when no meta", () => {
      const item = { name: "App" };
      expect(resolveIconUrl(item)).toBeUndefined();
    });

    it("returns undefined when meta has no iconUrl", () => {
      const item = { name: "App", meta: { version: "1.0" } };
      expect(resolveIconUrl(item)).toBeUndefined();
    });
  });

  describe("metaEntries", () => {
    it("returns entries excluding iconUrl", () => {
      const meta = { version: "1.0", type: "formula", iconUrl: "https://x.com/i.png" };
      const entries = metaEntries(meta);
      expect(entries).toEqual([
        ["version", "1.0"],
        ["type", "formula"],
      ]);
    });

    it("returns empty array when meta is undefined", () => {
      expect(metaEntries(undefined)).toEqual([]);
    });

    it("returns all entries when no iconUrl", () => {
      const meta = { version: "2.0", arch: "arm64" };
      expect(metaEntries(meta)).toEqual([
        ["version", "2.0"],
        ["arch", "arm64"],
      ]);
    });
  });

  describe("formatMetaLabel", () => {
    it("replaces dashes with spaces", () => {
      expect(formatMetaLabel("installed-at")).toBe("installed at");
    });

    it("replaces underscores with spaces", () => {
      expect(formatMetaLabel("last_used")).toBe("last used");
    });

    it("handles mixed separators", () => {
      expect(formatMetaLabel("my-key_name")).toBe("my key name");
    });

    it("returns plain keys as-is", () => {
      expect(formatMetaLabel("version")).toBe("version");
    });
  });

  describe("badgeClassName", () => {
    it("returns success classes for pinned", () => {
      expect(badgeClassName("pinned")).toContain("text-success");
    });

    it("returns success classes for default", () => {
      expect(badgeClassName("default")).toContain("text-success");
    });

    it("returns success classes for current", () => {
      expect(badgeClassName("current")).toContain("text-success");
    });

    it("returns info classes for type", () => {
      expect(badgeClassName("type")).toContain("text-info");
    });

    it("returns empty string for unknown keys", () => {
      expect(badgeClassName("version")).toBe("");
    });
  });

  describe("listItemKey", () => {
    it("generates a key from name, version, meta, and index", () => {
      const item = { name: "App", version: "1.0", meta: { type: "formula" } };
      const key = listItemKey(item, 0);
      expect(key).toBe("App::1.0::type:formula::0");
    });

    it("handles missing version", () => {
      const item = { name: "App" };
      const key = listItemKey(item, 3);
      expect(key).toBe("App::::::3");
    });

    it("handles missing meta", () => {
      const item = { name: "App", version: "2.0" };
      const key = listItemKey(item, 1);
      expect(key).toBe("App::2.0::::1");
    });

    it("sorts meta keys for deterministic output", () => {
      const item = { name: "X", meta: { z: "1", a: "2" } };
      const key = listItemKey(item, 0);
      expect(key).toBe("X::::a:2|z:1::0");
    });
  });
});
