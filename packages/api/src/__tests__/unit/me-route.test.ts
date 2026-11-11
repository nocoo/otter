import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../lib/app-env";
import { AUTHOR_PROFILE_URL, hashEmail } from "../../lib/public-avatar";
import meRoute, { decodeJwtPayload } from "../../routes/me";

const fetchMock = vi.fn();

function makeApp(setup?: (c: import("hono").Context<AppEnv>) => void) {
  const app = new Hono<AppEnv>();
  if (setup) {
    app.use("*", async (c, next) => {
      setup(c);
      await next();
    });
  }
  app.route("/api/me", meRoute);
  return app;
}

function b64url(s: string) {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ name: null, avatar: null }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decodeJwtPayload", () => {
  it("returns null for malformed JWT", () => {
    expect(decodeJwtPayload("nope")).toBeNull();
    expect(decodeJwtPayload("a.b")).toBeNull();
  });

  it("decodes valid JWT payload", () => {
    const payload = b64url(JSON.stringify({ email: "u@x", name: "U" }));
    const jwt = `header.${payload}.sig`;
    expect(decodeJwtPayload(jwt)).toEqual({ email: "u@x", name: "U" });
  });

  it("returns null for non-base64 payload", () => {
    expect(decodeJwtPayload("h.!!!!.s")).toBeNull();
  });
});

describe("/api/me", () => {
  it("returns ctx email when set", async () => {
    const app = makeApp((c) => {
      c.set("accessEmail", "u@example.com");
    });
    const r = await app.fetch(new Request("https://x/api/me"));
    expect(await r.json()).toEqual({
      email: "u@example.com",
      name: "u",
      avatar: null,
      authenticated: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${AUTHOR_PROFILE_URL}?hash=${await hashEmail("u@example.com")}`);
  });

  it("returns unauthenticated when no email and no JWT", async () => {
    const app = makeApp();
    const r = await app.fetch(new Request("https://x/api/me"));
    expect(await r.json()).toEqual({
      email: null,
      name: null,
      avatar: null,
      authenticated: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("decodes JWT header when ctx not set", async () => {
    const app = makeApp();
    const payload = b64url(JSON.stringify({ email: "h@x" }));
    const r = await app.fetch(
      new Request("https://x/api/me", {
        headers: { "Cf-Access-Jwt-Assertion": `h.${payload}.s` },
      }),
    );
    expect(await r.json()).toEqual({
      email: "h@x",
      name: "h",
      avatar: null,
      authenticated: true,
    });
  });

  it("returns unauthenticated when JWT undecodable", async () => {
    const app = makeApp();
    const r = await app.fetch(
      new Request("https://x/api/me", {
        headers: { "Cf-Access-Jwt-Assertion": "junk" },
      }),
    );
    expect(await r.json()).toEqual({
      email: null,
      name: null,
      avatar: null,
      authenticated: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses explicit JWT payload.name when profile misses", async () => {
    const app = makeApp();
    const payload = b64url(JSON.stringify({ email: "e@x", name: "Explicit Name" }));
    const r = await app.fetch(
      new Request("https://x/api/me", {
        headers: { "Cf-Access-Jwt-Assertion": `h.${payload}.s` },
      }),
    );
    expect(await r.json()).toEqual({
      email: "e@x",
      name: "Explicit Name",
      avatar: null,
      authenticated: true,
    });
  });

  it("returns null name and email when JWT payload empty", async () => {
    const app = makeApp();
    const payload = b64url(JSON.stringify({}));
    const r = await app.fetch(
      new Request("https://x/api/me", {
        headers: { "Cf-Access-Jwt-Assertion": `h.${payload}.s` },
      }),
    );
    expect(await r.json()).toEqual({
      email: null,
      name: null,
      avatar: null,
      authenticated: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefers author profile name and avatar on a hit", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "Zheng Li",
          avatar: "https://cdn.example/avatar-80.jpg",
        }),
        { status: 200 },
      ),
    );
    const app = makeApp();
    const payload = b64url(JSON.stringify({ email: "architie@gmail.com", name: "architie" }));
    const r = await app.fetch(
      new Request("https://x/api/me", {
        headers: { "Cf-Access-Jwt-Assertion": `h.${payload}.s` },
      }),
    );
    expect(await r.json()).toEqual({
      email: "architie@gmail.com",
      name: "Zheng Li",
      avatar: "https://cdn.example/avatar-80.jpg",
      authenticated: true,
    });
  });

  it("keeps JWT name when author profile returns 429", async () => {
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));
    const app = makeApp();
    const payload = b64url(JSON.stringify({ email: "alice@example.com", name: "Alice" }));
    const r = await app.fetch(
      new Request("https://x/api/me", {
        headers: { "Cf-Access-Jwt-Assertion": `h.${payload}.s` },
      }),
    );
    expect(await r.json()).toEqual({
      email: "alice@example.com",
      name: "Alice",
      avatar: null,
      authenticated: true,
    });
  });
});
