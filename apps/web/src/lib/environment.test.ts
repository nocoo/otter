import { beforeEach, describe, expect, it, vi } from "vitest";

const base = {
  local: true,
  mode: "demo",
  automated: false,
  locked: false,
  instanceId: "fixture-instance",
  csrfToken: "csrf",
  ingestBase: "/__local/instances/fixture-instance",
};
let fetchMock: ReturnType<typeof vi.fn>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn().mockResolvedValue(Response.json(base));
  storage = { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() };
  assign = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { __OTTER_LOCAL__: true, location: { assign } });
});

async function moduleWith(value = base) {
  fetchMock.mockResolvedValue(Response.json(value));
  const module = await import("./environment");
  await module.initializeEnvironment();
  return module;
}

describe("local environment client", () => {
  it("ignores hostname and stored preferences without launcher capability", async () => {
    vi.stubGlobal("window", { location: { hostname: "localhost" } });
    const module = await import("./environment");
    await module.initializeEnvironment();
    expect(module.getEnvironment()).toBeNull();
    expect(module.apiPath("/api/me")).toBe("/api/me");
    expect(module.ingestBase()).toBe("https://otter.worker.hexly.ai");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await module.selectEnvironment("e2e", () => true)).toBe(false);
  });

  it("requires successful initialization and fixes every API URL to the original instance", async () => {
    const module = await import("./environment");
    expect(() => module.apiPath("/api/me")).toThrow("not initialized");
    const initialization = module.initializeEnvironment();
    expect(module.initializeEnvironment()).toBe(initialization);
    await initialization;
    expect(module.apiPath("/api/me")).toBe("/__local/instances/fixture-instance/api/me");
    expect(module.ingestBase()).toBe(base.ingestBase);
    storage.getItem.mockReturnValue("prod");
    expect(module.getEnvironment()?.mode).toBe("demo");
  });

  it.each(["demo", "e2e", "prod", "invalid", null])(
    "selects startup preference %s, defaulting only invalid input to Demo",
    async (stored) => {
      storage.getItem.mockReturnValue(stored);
      const mode = stored === "e2e" || stored === "prod" ? stored : "demo";
      fetchMock
        .mockResolvedValueOnce(
          Response.json({ ...base, mode: null, instanceId: null, ingestBase: null }),
        )
        .mockResolvedValueOnce(Response.json({ ...base, mode }));
      const module = await import("./environment");
      await module.initializeEnvironment();
      expect(module.getEnvironment()?.mode).toBe(mode);
      expect(storage.setItem).toHaveBeenCalledWith("otter:environment-mode", mode);
      expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body).mode).toBe(mode);
    },
  );

  it("keeps explicit and automated selection ahead of stored preferences", async () => {
    storage.getItem.mockReturnValue("prod");
    const module = await moduleWith({ ...base, mode: "e2e", automated: true, locked: true });
    expect(module.getEnvironment()?.mode).toBe("e2e");
    expect(await module.selectEnvironment("prod", () => true)).toBe(false);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("handles unavailable read and write storage", async () => {
    storage.getItem.mockImplementation(() => {
      throw new Error("denied");
    });
    storage.setItem.mockImplementation(() => {
      throw new Error("denied");
    });
    fetchMock
      .mockResolvedValueOnce(Response.json({ ...base, mode: null, instanceId: null }))
      .mockResolvedValueOnce(Response.json(base));
    const module = await import("./environment");
    await module.initializeEnvironment();
    expect(module.getEnvironment()?.mode).toBe("demo");
  });

  it.each([
    null,
    { ...base, local: "yes" },
    { ...base, automated: "yes" },
    { ...base, locked: "yes" },
    { ...base, csrfToken: "" },
    { ...base, mode: "other" },
    { ...base, locked: true },
    { ...base, locked: true, automated: true },
    { ...base, instanceId: null },
    { ...base, instanceId: "../prod" },
    { ...base, ingestBase: "" },
  ])("rejects malformed descriptors: %j", async (value) => {
    fetchMock.mockResolvedValueOnce(Response.json(value));
    const module = await import("./environment");
    await expect(module.initializeEnvironment()).rejects.toThrow("Invalid local");
  });

  it.each([{}, { error: "fixture unavailable" }])(
    "fails visibly on startup errors",
    async (body) => {
      fetchMock.mockResolvedValueOnce(Response.json(body, { status: 503 }));
      const module = await import("./environment");
      await expect(module.initializeEnvironment()).rejects.toThrow(body.error ?? "503");
      expect(module.getEnvironment()).toBeNull();
    },
  );

  it("does not accept a different mode returned by a failing selection", async () => {
    const module = await moduleWith();
    fetchMock.mockResolvedValueOnce(Response.json({ ...base, mode: "prod" }));
    await expect(module.selectEnvironment("e2e", () => true)).rejects.toThrow("not accepted");
    expect(assign).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("guards drafts, pending writes, duplicate selections and invalid modes", async () => {
    const module = await moduleWith();
    module.setEnvironmentDraft(true);
    expect(await module.selectEnvironment("e2e", () => false)).toBe(false);
    module.setEnvironmentDraft(false);
    const finish = module.beginEnvironmentWrite();
    expect(await module.selectEnvironment("e2e", () => false)).toBe(false);
    finish();
    expect(await module.selectEnvironment("invalid", () => true)).toBe(false);
    expect(await module.selectEnvironment("demo", () => true)).toBe(false);
    let resolve: (value: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const switchPromise = module.selectEnvironment("e2e", () => true);
    expect(await module.selectEnvironment("prod", () => true)).toBe(false);
    resolve(Response.json({ ...base, mode: "e2e", instanceId: "fresh" }));
    expect(await switchPromise).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith("otter:environment-mode", "e2e");
    expect(assign).toHaveBeenCalledWith("/");
    expect(module.apiPath("/api/me")).toContain("fixture-instance");
  });

  it("waits for asynchronous discard confirmation without changing selection on cancel", async () => {
    const module = await moduleWith();
    module.setEnvironmentDraft(true);
    let confirm: (value: boolean) => void = () => undefined;
    const choice = module.selectEnvironment(
      "e2e",
      () =>
        new Promise<boolean>((done) => {
          confirm = done;
        }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await module.selectEnvironment("prod", () => true)).toBe(false);
    confirm(false);
    expect(await choice).toBe(false);
    expect(module.getEnvironment()?.mode).toBe("demo");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("never remembers hosted or automated preferences", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ ...base, local: false, mode: null, instanceId: null }))
      .mockResolvedValueOnce(Response.json({ ...base, local: false }));
    const module = await import("./environment");
    await module.initializeEnvironment();
    expect(await module.selectEnvironment("prod", () => true)).toBe(false);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
