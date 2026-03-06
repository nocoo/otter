import { describe, it, expect } from "vitest";
import {
  redactSecrets,
  redactJsonSecrets,
  redactLineSecrets,
} from "../../utils/redact.js";

describe("redactJsonSecrets", () => {
  it("should redact token values in JSON", () => {
    const input = JSON.stringify({
      enabledPlugins: ["foo"],
      env: {
        ANTHROPIC_AUTH_TOKEN: "sk-ant-secret-123",
        SOME_API_KEY: "key-456",
        NORMAL_VALUE: "keep-this",
      },
    });

    const result = JSON.parse(redactJsonSecrets(input));

    expect(result.env.ANTHROPIC_AUTH_TOKEN).toBe("[REDACTED]");
    expect(result.env.SOME_API_KEY).toBe("[REDACTED]");
    expect(result.env.NORMAL_VALUE).toBe("keep-this");
    expect(result.enabledPlugins).toEqual(["foo"]);
  });

  it("should redact nested credential keys", () => {
    const input = JSON.stringify({
      config: {
        database: {
          password: "hunter2",
          host: "localhost",
        },
        auth_secret: "my-secret",
      },
    });

    const result = JSON.parse(redactJsonSecrets(input));

    expect(result.config.database.password).toBe("[REDACTED]");
    expect(result.config.database.host).toBe("localhost");
    expect(result.config.auth_secret).toBe("[REDACTED]");
  });

  it("should handle arrays with objects containing secrets", () => {
    const input = JSON.stringify({
      accounts: [
        { name: "prod", token: "abc123" },
        { name: "dev", token: "def456" },
      ],
    });

    const result = JSON.parse(redactJsonSecrets(input));

    expect(result.accounts[0].name).toBe("prod");
    expect(result.accounts[0].token).toBe("[REDACTED]");
    expect(result.accounts[1].token).toBe("[REDACTED]");
  });

  it("should return original content for invalid JSON", () => {
    const input = "not valid json { broken";
    expect(redactJsonSecrets(input)).toBe(input);
  });

  it("should handle empty objects", () => {
    expect(redactJsonSecrets("{}")).toBe("{}");
  });

  it("should not redact non-string values even if key matches", () => {
    const input = JSON.stringify({ tokenCount: 42, hasAuth: true });
    const result = JSON.parse(redactJsonSecrets(input));

    // tokenCount matches /token/i but value is number, not string
    expect(result.tokenCount).toBe(42);
    expect(result.hasAuth).toBe(true);
  });
});

describe("redactLineSecrets", () => {
  it("should redact npm auth tokens", () => {
    const input = [
      "registry=https://registry.npmjs.org/",
      "//registry.npmjs.org/:_authToken=npm_abc123secret",
      "save-exact=true",
    ].join("\n");

    const result = redactLineSecrets(input);

    expect(result).toContain("registry=https://registry.npmjs.org/");
    expect(result).toContain(
      "//registry.npmjs.org/:_authToken=[REDACTED]"
    );
    expect(result).toContain("save-exact=true");
    expect(result).not.toContain("npm_abc123secret");
  });

  it("should redact _auth values", () => {
    const input = "_auth=base64encodedcreds";
    const result = redactLineSecrets(input);
    expect(result).toBe("_auth=[REDACTED]");
  });

  it("should redact generic token/secret/password lines", () => {
    const input = [
      "my_api_token=secret-value",
      "github_secret=gh_12345",
      "db_password=hunter2",
      "normal_config=keep-me",
    ].join("\n");

    const result = redactLineSecrets(input);

    expect(result).not.toContain("secret-value");
    expect(result).not.toContain("gh_12345");
    expect(result).not.toContain("hunter2");
    expect(result).toContain("normal_config=keep-me");
  });

  it("should handle empty content", () => {
    expect(redactLineSecrets("")).toBe("");
  });

  it("should handle content with no sensitive lines", () => {
    const input = "color = auto\n[user]\n  name = Test User";
    expect(redactLineSecrets(input)).toBe(input);
  });
});

describe("redactSecrets (auto-detect)", () => {
  it("should use JSON redaction for .json files", () => {
    const input = JSON.stringify({ api_key: "secret" });
    const result = redactSecrets(input, "/path/to/settings.json");
    const parsed = JSON.parse(result);
    expect(parsed.api_key).toBe("[REDACTED]");
  });

  it("should use line redaction for .npmrc files", () => {
    const input = "//registry.npmjs.org/:_authToken=npm_secret";
    const result = redactSecrets(input, "/home/user/.npmrc");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("npm_secret");
  });

  it("should use line redaction for .gitconfig files", () => {
    const input = "my_token=secret123";
    const result = redactSecrets(input, "/home/user/.gitconfig");
    expect(result).not.toContain("secret123");
  });

  it("should use line redaction for .env files", () => {
    const input = "API_SECRET=my-secret-value";
    const result = redactSecrets(input, "/app/.env");
    expect(result).not.toContain("my-secret-value");
  });

  it("should return content unchanged for unknown file types", () => {
    const input = "some random content with api_key=secret";
    const result = redactSecrets(input, "/path/to/file.txt");
    expect(result).toBe(input);
  });
});
