import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../lib/app-env";
import profile from "../../routes/profile";

afterEach(() => vi.unstubAllGlobals());
function app(email?: string) {
  const hono = new Hono<AppEnv>();
  hono.use("*", async (c, next) => {
    if (email) c.set("accessEmail", email);
    await next();
  });
  hono.route("/api/profile", profile);
  return hono;
}
describe("authenticated public avatar route", () => {
  it("requires verified identity and ignores browser-selected emails", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await app().request("/api/profile?email=owner@example.com");
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not call an external provider for local fixture accounts", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await app("demo@otter.test").request("/api/profile");
    expect(await response.json()).toEqual({ avatar: null });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns only a public avatar for the verified identity", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        name: "Other display name",
        avatar: "https://image.example.test/avatar.jpg",
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const response = await app("fixture@example.com").request(
      "/api/profile?email=other@example.com",
    );
    expect(await response.json()).toEqual({ avatar: "https://image.example.test/avatar.jpg" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
