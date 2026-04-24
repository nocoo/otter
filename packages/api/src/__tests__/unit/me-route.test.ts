import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../../lib/app-env";
import meRoute, { decodeJwtPayload } from "../../routes/me";

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
      authenticated: true,
    });
  });

  it("returns unauthenticated when no email and no JWT", async () => {
    const app = makeApp();
    const r = await app.fetch(new Request("https://x/api/me"));
    expect(await r.json()).toEqual({ email: null, name: null, authenticated: false });
  });

  it("decodes JWT header when ctx not set", async () => {
    const app = makeApp();
    const payload = b64url(JSON.stringify({ email: "h@x" }));
    const r = await app.fetch(
      new Request("https://x/api/me", {
        headers: { "Cf-Access-Jwt-Assertion": `h.${payload}.s` },
      }),
    );
    expect(await r.json()).toEqual({ email: "h@x", name: "h", authenticated: true });
  });

  it("returns unauthenticated when JWT undecodable", async () => {
    const app = makeApp();
    const r = await app.fetch(
      new Request("https://x/api/me", {
        headers: { "Cf-Access-Jwt-Assertion": "junk" },
      }),
    );
    expect(await r.json()).toEqual({ email: null, name: null, authenticated: false });
  });

  it("uses explicit JWT payload.name when present", async () => {
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
    expect(await r.json()).toEqual({ email: null, name: null, authenticated: true });
  });
});
