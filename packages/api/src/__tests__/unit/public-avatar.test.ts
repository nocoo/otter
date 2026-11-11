import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTHOR_PROFILE_URL,
  fetchAuthorProfile,
  hashEmail,
  normalizeEmail,
  parseAuthorProfile,
  publicAvatar,
} from "../../lib/public-avatar";

const KNOWN_EMAIL = "architie@gmail.com";
const KNOWN_HASH = "7ba563171c26fb9b82e9f7750840c0455602eb35025192027230bcb40aae1217";

afterEach(() => vi.unstubAllGlobals());

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Architie@Gmail.com  ")).toBe(KNOWN_EMAIL);
  });
});

describe("hashEmail", () => {
  it("matches the published SHA-256 vector", async () => {
    expect(await hashEmail(KNOWN_EMAIL)).toBe(KNOWN_HASH);
  });
});

describe("parseAuthorProfile", () => {
  it("reads a hit", () => {
    expect(parseAuthorProfile({ name: "Zheng Li", avatar: "https://cdn.example/a.jpg" })).toEqual({
      name: "Zheng Li",
      avatar: "https://cdn.example/a.jpg",
    });
  });

  it("treats miss and empty strings as nulls", () => {
    expect(parseAuthorProfile({ name: "", avatar: "" })).toEqual({ name: null, avatar: null });
    expect(parseAuthorProfile(null)).toEqual({ name: null, avatar: null });
  });
});

describe("fetchAuthorProfile", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("GETs the public profile URL with the email hash", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ name: "Zheng Li", avatar: "https://cdn.example/a.jpg" }), {
        status: 200,
      }),
    );
    await expect(fetchAuthorProfile(KNOWN_EMAIL)).resolves.toEqual({
      name: "Zheng Li",
      avatar: "https://cdn.example/a.jpg",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${AUTHOR_PROFILE_URL}?hash=${KNOWN_HASH}`);
    expect(init.headers).toBeUndefined();
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns nulls on 429", async () => {
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(fetchAuthorProfile(KNOWN_EMAIL)).resolves.toEqual({ name: null, avatar: null });
  });

  it("does not call the provider for local fixture accounts", async () => {
    await expect(fetchAuthorProfile("demo@otter.test")).resolves.toEqual({
      name: null,
      avatar: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

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
    const hash = await hashEmail("alice@example.com");
    expect(url).toBe(`${AUTHOR_PROFILE_URL}?hash=${hash}`);
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
