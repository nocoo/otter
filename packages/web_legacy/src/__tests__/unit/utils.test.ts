import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cn, formatDate, formatDateTime, formatSize, formatTimeAgo } from "@/lib/utils";

describe("utils", () => {
  // --- cn (class name merge) ---

  describe("cn", () => {
    it("merges class names", () => {
      expect(cn("foo", "bar")).toBe("foo bar");
    });

    it("handles conditional classes", () => {
      expect(cn("base", false && "hidden", true && "visible")).toBe("base visible");
    });

    it("merges Tailwind classes correctly", () => {
      expect(cn("px-2", "px-4")).toBe("px-4");
    });
  });

  // --- formatSize ---

  describe("formatSize", () => {
    it("formats bytes", () => {
      expect(formatSize(512)).toBe("512 B");
    });

    it("formats kilobytes", () => {
      expect(formatSize(1024)).toBe("1.0 KB");
      expect(formatSize(1536)).toBe("1.5 KB");
    });

    it("formats megabytes", () => {
      expect(formatSize(1024 * 1024)).toBe("1.00 MB");
      expect(formatSize(1024 * 1024 * 2.5)).toBe("2.50 MB");
    });

    it("formats gigabytes", () => {
      expect(formatSize(1024 * 1024 * 1024)).toBe("1.00 GB");
    });
  });

  // --- formatTimeAgo ---

  describe("formatTimeAgo", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-05T12:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "just now" for recent timestamps', () => {
      const ts = Date.now() - 30 * 1000; // 30 seconds ago
      expect(formatTimeAgo(ts)).toBe("just now");
    });

    it("returns minutes ago", () => {
      const ts = Date.now() - 5 * 60 * 1000; // 5 minutes ago
      expect(formatTimeAgo(ts)).toBe("5m ago");
    });

    it("returns hours ago", () => {
      const ts = Date.now() - 3 * 60 * 60 * 1000; // 3 hours ago
      expect(formatTimeAgo(ts)).toBe("3h ago");
    });

    it("returns days ago", () => {
      const ts = Date.now() - 2 * 24 * 60 * 60 * 1000; // 2 days ago
      expect(formatTimeAgo(ts)).toBe("2d ago");
    });

    it("returns weeks ago", () => {
      const ts = Date.now() - 14 * 24 * 60 * 60 * 1000; // 2 weeks ago
      expect(formatTimeAgo(ts)).toBe("2w ago");
    });

    it("returns months ago", () => {
      const ts = Date.now() - 60 * 24 * 60 * 60 * 1000; // ~2 months ago
      expect(formatTimeAgo(ts)).toBe("2mo ago");
    });

    it("returns years ago", () => {
      const ts = Date.now() - 400 * 24 * 60 * 60 * 1000; // ~1 year ago
      expect(formatTimeAgo(ts)).toBe("1y ago");
    });
  });

  // --- formatDate ---

  describe("formatDate", () => {
    it("formats timestamp to short date", () => {
      const ts = new Date("2026-01-15T10:30:00Z").getTime();
      const result = formatDate(ts);
      expect(result).toContain("2026");
      expect(result).toContain("Jan");
      expect(result).toContain("15");
    });
  });

  // --- formatDateTime ---

  describe("formatDateTime", () => {
    it("formats timestamp to date and time", () => {
      const ts = new Date("2026-01-15T10:30:00Z").getTime();
      const result = formatDateTime(ts);
      expect(result).toContain("2026");
      expect(result).toContain("01");
      expect(result).toContain("15");
    });
  });
});
