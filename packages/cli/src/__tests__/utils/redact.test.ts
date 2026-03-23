import { describe, it, expect } from "vitest";
import {
  redactSecrets,
  redactJsonSecrets,
  redactLineSecrets,
  redactShellSecrets,
  redactJsonlSecrets,
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

describe("redactShellSecrets", () => {
  it("should redact export KEY=value patterns", () => {
    const input = [
      "# Load environment",
      'export Z_AI_API_KEY="sk-ant-secret-123"',
      "export PATH=/usr/local/bin:$PATH",
      "export GITHUB_TOKEN=ghp_abc123def456",
    ].join("\n");

    const result = redactShellSecrets(input);

    expect(result).toContain("# Load environment");
    expect(result).toContain("export Z_AI_API_KEY=[REDACTED]");
    expect(result).toContain("export PATH=/usr/local/bin:$PATH");
    expect(result).toContain("export GITHUB_TOKEN=[REDACTED]");
    expect(result).not.toContain("sk-ant-secret-123");
    expect(result).not.toContain("ghp_abc123def456");
  });

  it("should redact plain assignments (no export)", () => {
    const input = [
      'MY_SECRET="super-secret-value"',
      "NORMAL_VAR=hello",
      "API_KEY=key-123-abc",
    ].join("\n");

    const result = redactShellSecrets(input);

    expect(result).toContain("MY_SECRET=[REDACTED]");
    expect(result).toContain("NORMAL_VAR=hello");
    expect(result).toContain("API_KEY=[REDACTED]");
    expect(result).not.toContain("super-secret-value");
    expect(result).not.toContain("key-123-abc");
  });

  it("should skip comment lines even with sensitive keywords", () => {
    const input = [
      "# export MY_TOKEN=old-value",
      "  # GITHUB_SECRET=should-stay",
    ].join("\n");

    const result = redactShellSecrets(input);

    expect(result).toContain("# export MY_TOKEN=old-value");
    expect(result).toContain("# GITHUB_SECRET=should-stay");
  });

  it("should handle indented export statements", () => {
    const input = '  export AUTH_TOKEN="bearer-xyz"';
    const result = redactShellSecrets(input);
    expect(result).toBe("  export AUTH_TOKEN=[REDACTED]");
  });

  it("should not redact non-sensitive variables", () => {
    const input = [
      "export EDITOR=nvim",
      "export LANG=en_US.UTF-8",
      "HISTSIZE=10000",
    ].join("\n");

    const result = redactShellSecrets(input);
    expect(result).toBe(input);
  });

  it("should handle empty content", () => {
    expect(redactShellSecrets("")).toBe("");
  });

  it("should handle single-quoted values", () => {
    const input = "export OPENAI_API_KEY='sk-proj-abc123'";
    const result = redactShellSecrets(input);
    expect(result).toBe("export OPENAI_API_KEY=[REDACTED]");
    expect(result).not.toContain("sk-proj-abc123");
  });

  it("should catch PASSWORD patterns", () => {
    const input = "export DB_PASSWORD=hunter2";
    const result = redactShellSecrets(input);
    expect(result).toBe("export DB_PASSWORD=[REDACTED]");
  });
});

describe("redactJsonlSecrets", () => {
  it("should redact JWT tokens in pasted content", () => {
    const entry = {
      display: "fix auth",
      pastedContents: {
        "1": {
          content:
            "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
        },
      },
    };
    const input = JSON.stringify(entry);
    const result = redactJsonlSecrets(input);
    const parsed = JSON.parse(result);

    expect(parsed.display).toBe("fix auth");
    expect(parsed.pastedContents["1"].content).not.toContain("eyJ");
    expect(parsed.pastedContents["1"].content).toContain("[REDACTED]");
  });

  it("should redact GitHub tokens", () => {
    const entry = {
      display: "Use this token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
    };
    const input = JSON.stringify(entry);
    const result = redactJsonlSecrets(input);
    const parsed = JSON.parse(result);

    expect(parsed.display).not.toContain("ghp_");
    expect(parsed.display).toContain("[REDACTED]");
  });

  it("should redact Anthropic API keys", () => {
    const entry = {
      display: "My key is sk-ant-api03-aBcDeFgHiJkLmNoPqRsTuV",
    };
    const input = JSON.stringify(entry);
    const result = redactJsonlSecrets(input);
    const parsed = JSON.parse(result);

    expect(parsed.display).not.toContain("sk-ant-");
    expect(parsed.display).toContain("[REDACTED]");
  });

  it("should redact OpenAI API keys", () => {
    const entry = {
      display: "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234",
    };
    const input = JSON.stringify(entry);
    const result = redactJsonlSecrets(input);
    const parsed = JSON.parse(result);

    expect(parsed.display).not.toContain("sk-proj-");
    expect(parsed.display).toContain("[REDACTED]");
  });

  it("should redact AWS access keys", () => {
    const entry = {
      display: "AWS key: AKIAIOSFODNN7EXAMPLE",
    };
    const input = JSON.stringify(entry);
    const result = redactJsonlSecrets(input);
    const parsed = JSON.parse(result);

    expect(parsed.display).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(parsed.display).toContain("[REDACTED]");
  });

  it("should redact npm tokens", () => {
    const entry = {
      display:
        "token: npm_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcd",
    };
    const input = JSON.stringify(entry);
    const result = redactJsonlSecrets(input);
    const parsed = JSON.parse(result);

    expect(parsed.display).not.toContain("npm_");
    expect(parsed.display).toContain("[REDACTED]");
  });

  it("should handle multi-line JSONL", () => {
    const lines = [
      JSON.stringify({ display: "normal prompt", timestamp: 1234 }),
      JSON.stringify({
        display: "Use ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij as token",
      }),
      JSON.stringify({ display: "another normal one" }),
    ].join("\n");

    const result = redactJsonlSecrets(lines);
    const outputLines = result.split("\n");

    // First line unchanged
    expect(outputLines[0]).toBe(lines.split("\n")[0]);
    // Second line redacted
    expect(outputLines[1]).not.toContain("ghp_");
    expect(outputLines[1]).toContain("[REDACTED]");
    // Third line unchanged
    expect(outputLines[2]).toBe(lines.split("\n")[2]);
  });

  it("should handle empty lines gracefully", () => {
    const input = `${JSON.stringify({ display: "hello" })}\n\n`;
    const result = redactJsonlSecrets(input);
    expect(result).toContain('"hello"');
  });

  it("should not modify entries without credentials", () => {
    const entry = JSON.stringify({
      display: "How do I use React hooks?",
      timestamp: 1234567890,
      project: "/Users/test/my-app",
    });
    const result = redactJsonlSecrets(entry);
    expect(result).toBe(entry);
  });

  it("should redact private key content pasted in prompts", () => {
    const entry = {
      display: "Here is my key",
      pastedContents: {
        "1": {
          content:
            "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
        },
      },
    };
    const input = JSON.stringify(entry);
    const result = redactJsonlSecrets(input);
    const parsed = JSON.parse(result);

    expect(parsed.pastedContents["1"].content).not.toContain(
      "BEGIN RSA PRIVATE KEY"
    );
    expect(parsed.pastedContents["1"].content).toContain("[REDACTED]");
  });

  it("should also apply key-based redaction in JSONL", () => {
    const entry = { auth_token: "my-secret-token", display: "normal" };
    const input = JSON.stringify(entry);
    const result = redactJsonlSecrets(input);
    const parsed = JSON.parse(result);

    expect(parsed.auth_token).toBe("[REDACTED]");
    expect(parsed.display).toBe("normal");
  });

  it("should redact credentials inside arrays in JSONL", () => {
    const entry = {
      tokens: [
        "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
        "safe-value",
        "sk-ant-api03-secret1234567890123456789012345678901234567890",
      ],
    };
    const input = JSON.stringify(entry);
    const result = redactJsonlSecrets(input);
    const parsed = JSON.parse(result);

    expect(parsed.tokens[0]).toContain("[REDACTED]");
    expect(parsed.tokens[1]).toBe("safe-value");
    expect(parsed.tokens[2]).toContain("[REDACTED]");
  });

  it("should redact credential patterns in non-JSON lines", () => {
    const lines = [
      JSON.stringify({ display: "normal" }),
      "not-valid-json but has ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij inside",
      JSON.stringify({ display: "also normal" }),
    ].join("\n");

    const result = redactJsonlSecrets(lines);
    const outputLines = result.split("\n");

    // First line unchanged
    expect(outputLines[0]).toBe(lines.split("\n")[0]);
    // Second line: non-JSON but credential pattern should be redacted
    expect(outputLines[1]).toContain("[REDACTED]");
    expect(outputLines[1]).not.toContain("ghp_");
    // Third line unchanged
    expect(outputLines[2]).toBe(lines.split("\n")[2]);
  });

  it("should preserve non-JSON lines without credentials", () => {
    const input = "this is not json but has no secrets";
    const result = redactJsonlSecrets(input);
    expect(result).toBe(input);
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

  it("should use shell redaction for .zshrc files", () => {
    const input = 'export MY_API_KEY="secret-value"';
    const result = redactSecrets(input, "/Users/test/.zshrc");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("secret-value");
  });

  it("should use shell redaction for .bashrc files", () => {
    const input = "export GITHUB_TOKEN=ghp_secret123";
    const result = redactSecrets(input, "/home/user/.bashrc");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("ghp_secret123");
  });

  it("should use shell redaction for .profile files", () => {
    const input = 'export AUTH_SECRET="my-secret"';
    const result = redactSecrets(input, "/home/user/.profile");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("my-secret");
  });

  it("should use JSONL redaction for .jsonl files", () => {
    const input = JSON.stringify({
      display: "token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
    });
    const result = redactSecrets(input, "/home/user/.claude/history.jsonl");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("ghp_");
  });
});
