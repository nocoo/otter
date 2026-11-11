import { describe, expect, it } from "vitest";
import { getDisplayName } from "./display-name";

describe("getDisplayName", () => {
  it("prefers profile name and avatar", () => {
    expect(
      getDisplayName({
        email: "alice@example.com",
        name: "Alice Li",
        avatar: "https://cdn.example/a.jpg",
      }),
    ).toEqual({
      name: "Alice Li",
      initial: "A",
      email: "alice@example.com",
      avatar: "https://cdn.example/a.jpg",
    });
  });

  it("falls back to email local-part and initial when name missing", () => {
    expect(getDisplayName({ email: "bob@example.com", name: null, avatar: null })).toEqual({
      name: "bob",
      initial: "B",
      email: "bob@example.com",
      avatar: null,
    });
  });

  it("uses User when unauthenticated", () => {
    expect(getDisplayName(null)).toEqual({
      name: "User",
      initial: "U",
      email: null,
      avatar: null,
    });
  });
});
