import { afterEach, describe, expect, it, vi } from "vitest";
import { publicAvatar } from "../../lib/public-avatar";

afterEach(() => vi.unstubAllGlobals());

describe("public avatar lookup", () => {
  it.each(["", "invalid", "demo@otter.test"])(
    "does not send fixture or invalid identity %s",
    async (email) => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      expect(await publicAvatar(email)).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("uses only normalized email hash and omits credentials", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ avatar: "https://images.example.test/avatar.jpg" }));
    vi.stubGlobal("fetch", fetcher);
    expect(await publicAvatar(" Alice@Example.com ")).toBe(
      "https://images.example.test/avatar.jpg",
    );
    const [url, init] = fetcher.mock.calls[0] ?? [];
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode("alice@example.com")),
      ),
      (value) => value.toString(16).padStart(2, "0"),
    ).join("");
    expect(url).toBe(`https://lizheng.blog/api/authors/profile?hash=${hash}`);
    expect(url).not.toContain("alice");
    expect(init.headers).toBeUndefined();
    expect(init.redirect).toBe("error");
  });
  it.each([
    null,
    "http://images.example.test/avatar.jpg",
    "https://user:pass@images.example.test/avatar.jpg",
    "https://images.example.test/avatar.jpg",
    "not-url",
  ])("validates public avatar %s", async (avatar) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ avatar })));
    expect(await publicAvatar("fixture@example.test")).toBeNull();
    expect(await publicAvatar("fixture@example.com")).toBe(
      avatar === "https://images.example.test/avatar.jpg" ? avatar : null,
    );
  });
  it("falls back on non-success, malformed response or network failure", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 429 }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("not-json"));
    vi.stubGlobal("fetch", fetcher);
    expect(await publicAvatar("fixture@example.com")).toBeNull();
    expect(await publicAvatar("fixture@example.com")).toBeNull();
    expect(await publicAvatar("fixture@example.com")).toBeNull();
  });
  it("rejects credentials in either URL field", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ avatar: "https://:pass@images.example.test/avatar.jpg" }),
        ),
    );
    expect(await publicAvatar("fixture@example.com")).toBeNull();
  });
});
