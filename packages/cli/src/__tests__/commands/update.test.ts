import { describe, expect, it, vi } from "vitest";

const createUpdateCommandMock = vi.fn(() => ({ name: "update" }));

vi.mock("@nocoo/cli-base", () => ({
  createUpdateCommand: (opts: unknown) => createUpdateCommandMock(opts),
}));

describe("update command", () => {
  it("registers via createUpdateCommand with otter package metadata", async () => {
    const mod = await import("../../commands/update.js");
    expect(mod.default).toEqual({ name: "update" });
    expect(createUpdateCommandMock).toHaveBeenCalledTimes(1);
    const arg = createUpdateCommandMock.mock.calls[0][0] as {
      packageName: string;
      currentVersion: string;
      cliName: string;
    };
    expect(arg.packageName).toBe("@nocoo/otter");
    expect(arg.cliName).toBe("otter");
    expect(typeof arg.currentVersion).toBe("string");
    expect(arg.currentVersion.length).toBeGreaterThan(0);
  });
});
