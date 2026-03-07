import { beforeEach, describe, expect, it } from "vitest";

describe("R2 icon config separation", () => {
  beforeEach(() => {
    process.env.CF_R2_ENDPOINT = "https://snapshots.example.com";
    process.env.CF_R2_ACCESS_KEY_ID = "snapshots-key";
    process.env.CF_R2_SECRET_ACCESS_KEY = "snapshots-secret";
    process.env.CF_R2_BUCKET = "otter-snapshots";
    delete process.env.CF_ICON_R2_ENDPOINT;
    delete process.env.CF_ICON_R2_ACCESS_KEY_ID;
    delete process.env.CF_ICON_R2_SECRET_ACCESS_KEY;
    delete process.env.CF_ICON_R2_BUCKET;
    delete process.env.CF_ICON_R2_PREFIX;
  });

  it("uses dedicated icon bucket when CF_ICON_R2_BUCKET is set", async () => {
    process.env.CF_ICON_R2_BUCKET = "zhe";
    const r2 = await import("@/lib/cf/r2");

    expect(r2.resolveIconStorageConfigForTests(process.env)).toEqual({
      bucket: "zhe",
      prefix: "apps/otter",
    });
  });

  it("uses configured icon prefix when CF_ICON_R2_PREFIX is set", async () => {
    process.env.CF_ICON_R2_BUCKET = "zhe";
    process.env.CF_ICON_R2_PREFIX = "/apps/otter/";
    const r2 = await import("@/lib/cf/r2");

    expect(r2.resolveIconStorageConfigForTests(process.env)).toEqual({
      bucket: "zhe",
      prefix: "apps/otter",
    });
    expect(r2.iconKey("abcdef012345", "apps/otter")).toBe(
      "apps/otter/abcdef012345.png"
    );
  });

  it("falls back to snapshot bucket when icon bucket is unset", async () => {
    const r2 = await import("@/lib/cf/r2");

    expect(r2.resolveIconStorageConfigForTests(process.env)).toEqual({
      bucket: "otter-snapshots",
      prefix: "apps/otter",
    });
  });
});
