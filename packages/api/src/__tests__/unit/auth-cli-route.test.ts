import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../../lib/app-env";
import type { DbDriver } from "../../lib/db/driver";
import { createAuthCliRoute, isLocalhostUrl } from "../../routes/auth-cli";
import { createMockDriver } from "./_mock-driver";

function makeApp(driver: DbDriver, setup?: (c: import("hono").Context<AppEnv>) => void) {
  const app = new Hono<AppEnv>();
  if (setup) {
    app.use("*", async (c, next) => {
      setup(c);
      await next();
    });
  }
  app.route("/api/auth/cli", createAuthCliRoute({ getDriver: () => driver }));
  return app;
}

describe("isLocalhostUrl", () => {
  it("accepts http://127.0.0.1:PORT", () => {
    expect(isLocalhostUrl("http://127.0.0.1:9876/cb")).toBe(true);
  });
  it("accepts http://localhost", () => {
    expect(isLocalhostUrl("http://localhost:1234")).toBe(true);
  });
  it("rejects https", () => {
    expect(isLocalhostUrl("https://localhost/cb")).toBe(false);
  });
  it("rejects non-loopback host", () => {
    expect(isLocalhostUrl("http://example.com/cb")).toBe(false);
  });
  it("rejects garbage", () => {
    expect(isLocalhostUrl("not a url")).toBe(false);
  });
});

describe("/api/auth/cli", () => {
  it("400 without callback_url", async () => {
    const { driver } = createMockDriver();
    const app = makeApp(driver);
    const r = await app.fetch(new Request("https://x/api/auth/cli"));
    expect(r.status).toBe(400);
  });

  it("400 with non-localhost callback_url", async () => {
    const { driver } = createMockDriver();
    const app = makeApp(driver);
    const r = await app.fetch(
      new Request("https://x/api/auth/cli?callback_url=https://evil.com/cb"),
    );
    expect(r.status).toBe(400);
  });

  it("400 when no accessEmail in context", async () => {
    const { driver } = createMockDriver();
    const app = makeApp(driver);
    const r = await app.fetch(
      new Request("https://x/api/auth/cli?callback_url=http://127.0.0.1:9/cb"),
    );
    expect(r.status).toBe(400);
  });

  it("302 redirects with api_key + email + state when authed", async () => {
    const { driver, calls } = createMockDriver();
    const app = makeApp(driver, (c) => {
      c.set("accessEmail", "u@example.com");
    });
    const r = await app.fetch(
      new Request("https://x/api/auth/cli?callback_url=http://127.0.0.1:9876/cb&state=abc", {
        redirect: "manual",
      }),
    );
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get("Location") ?? "");
    expect(loc.hostname).toBe("127.0.0.1");
    expect(loc.searchParams.get("state")).toBe("abc");
    expect(loc.searchParams.get("email")).toBe("u@example.com");
    expect(loc.searchParams.get("api_key")?.startsWith("otk_")).toBe(true);
    expect(calls.some((c) => c.sql?.includes("INSERT INTO api_tokens"))).toBe(true);
  });

  it("accepts `callback` alias", async () => {
    const { driver } = createMockDriver();
    const app = makeApp(driver, (c) => {
      c.set("accessEmail", "u@example.com");
    });
    const r = await app.fetch(
      new Request("https://x/api/auth/cli?callback=http://localhost:1234/cb", {
        redirect: "manual",
      }),
    );
    expect(r.status).toBe(302);
  });
});
