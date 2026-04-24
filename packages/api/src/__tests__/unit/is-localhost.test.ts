import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { isLocalhost } from "../../middleware/is-localhost";

async function probe(url: string, headers: Record<string, string> = {}, cf?: unknown) {
  const app = new Hono();
  let result = false;
  app.all("*", (c) => {
    if (cf !== undefined) {
      (c.req.raw as unknown as { cf: unknown }).cf = cf;
    }
    result = isLocalhost(c);
    return c.text("ok");
  });
  await app.fetch(new Request(url, { headers }));
  return result;
}

describe("isLocalhost", () => {
  it("true for host=localhost without cf", async () => {
    expect(await probe("http://localhost/x", { host: "localhost" })).toBe(true);
  });

  it("true for host=127.0.0.1 without cf", async () => {
    expect(await probe("http://127.0.0.1/x", { host: "127.0.0.1:7020" })).toBe(true);
  });

  it("true for localhost host even when cf is populated (miniflare --local)", async () => {
    expect(await probe("http://localhost/x", { host: "localhost" }, { country: "US" })).toBe(true);
  });

  it("false on cf edge with non-localhost host", async () => {
    expect(await probe("https://x/x", { host: "otter.example.com" }, { country: "US" })).toBe(
      false,
    );
  });

  it("false for arbitrary public host without cf", async () => {
    expect(await probe("https://example.com/x", { host: "example.com" })).toBe(false);
  });
});
