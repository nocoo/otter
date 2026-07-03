import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readMaybeGzip } from "../../lib/gzip";

describe("readMaybeGzip", () => {
  it("passes through a plain JSON body", async () => {
    const req = new Request("http://x/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"hello":"world"}',
    });
    const result = await readMaybeGzip(req);
    expect(result.error).toBeUndefined();
    expect(result.json).toBe('{"hello":"world"}');
  });

  it("decompresses a gzip-encoded body", async () => {
    const payload = JSON.stringify({ hello: "gzipped" });
    const compressed = gzipSync(payload);
    const req = new Request("http://x/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
      body: compressed,
    });
    const result = await readMaybeGzip(req);
    expect(result.error).toBeUndefined();
    expect(result.json).toBe(payload);
  });

  it("returns an error when the body claims gzip but is not gzip", async () => {
    const req = new Request("http://x/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
      body: "this is definitely not gzip",
    });
    const result = await readMaybeGzip(req);
    expect(result.json).toBe("");
    expect(result.error).toBe("Failed to decompress request body");
  });
});
