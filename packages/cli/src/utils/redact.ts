/**
 * Credential redaction utilities.
 *
 * Strips sensitive values from file content before including
 * them in snapshots. Works on both structured (JSON) and
 * line-oriented (ini-like) config formats.
 */

const REDACTED = "[REDACTED]";

// ---------------------------------------------------------------------------
// JSON env-block redaction (for settings.json, etc.)
// ---------------------------------------------------------------------------

/** Keys whose values should always be redacted in JSON objects */
const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /api.?key/i,
  /password/i,
  /credential/i,
  /auth/i,
];

function isSensitiveKey(key: string): boolean {
  // Normalize hyphens to underscores so kebab-case keys
  // (e.g. "api-key", "auth-token") match the same patterns.
  const normalized = key.replace(/-/g, "_");
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(normalized));
}

/**
 * Deep-walk a parsed JSON value and redact any string values
 * whose keys match sensitive patterns.
 *
 * Returns [redactedValue, didRedact] tuple.
 */
function redactObject(obj: unknown): [unknown, boolean] {
  if (obj === null || obj === undefined) return [obj, false];
  if (typeof obj !== "object") return [obj, false];

  if (Array.isArray(obj)) {
    let anyRedacted = false;
    const mapped = obj.map((item) => {
      const [val, redacted] = redactObject(item);
      if (redacted) anyRedacted = true;
      return val;
    });
    return [mapped, anyRedacted];
  }

  let anyRedacted = false;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof value === "string" && isSensitiveKey(key)) {
      result[key] = REDACTED;
      anyRedacted = true;
    } else if (typeof value === "object" && value !== null) {
      const [val, redacted] = redactObject(value);
      result[key] = val;
      if (redacted) anyRedacted = true;
    } else {
      result[key] = value;
    }
  }
  return [result, anyRedacted];
}

/**
 * Redact sensitive values in a JSON string.
 * Returns the original string if no redaction was needed or parsing fails.
 */
export function redactJsonSecrets(jsonContent: string): string {
  try {
    const parsed = JSON.parse(jsonContent);
    const [redacted, didRedact] = redactObject(parsed);
    if (!didRedact) return jsonContent;
    // Re-serialize with 2-space indent
    return JSON.stringify(redacted, null, 2);
  } catch {
    // If not valid JSON, return as-is
    return jsonContent;
  }
}

// ---------------------------------------------------------------------------
// YAML redaction (for config.yaml, etc.)
// ---------------------------------------------------------------------------

/** Match a YAML key: value line, optionally preceded by a list marker.
 *  Group 1 = everything up to (and including) the colon + whitespace
 *  Group 2 = the key name itself
 *  The `.+$` tail ensures we only match lines that have an inline value.  */
const YAML_KV_RE = /^(\s*(?:-\s+)?([\w-]+)\s*:\s*).+$/;

/**
 * Match YAML block-scalar indicators (`|`, `>`, `|+`, `>-`, etc.)
 * optionally followed by an explicit indent width digit.
 * When a sensitive key's value starts with one of these, every
 * continuation line (indented deeper) must also be redacted.
 */
const BLOCK_SCALAR_RE = /^[|>]([+-]?\d?|\d[+-]?)(\s+#.*|\s*)$/;

/**
 * Skip YAML block-scalar continuation lines starting from index `start`.
 * Continuation lines are either empty or indented deeper than `keyIndent`.
 * Returns the index of the first non-continuation line.
 */
function skipBlockScalarLines(lines: string[], start: number, keyIndent: number): number {
  let i = start;
  while (i < lines.length) {
    const next = lines[i] as string;
    // Continuation: empty line or indented deeper than the key line
    if (next.trim() === "" || next.length - next.trimStart().length > keyIndent) {
      i++;
    } else {
      break;
    }
  }
  return i;
}

/**
 * Redact sensitive values in YAML content.
 *
 * Handles three value forms:
 *  1. Inline scalars  — `key: secret`   → `key: [REDACTED]`
 *  2. Block scalars   — `key: >\n  ...` → `key: [REDACTED]` (continuation lines removed)
 *  3. List items      — `- token: abc`  → `- token: [REDACTED]`
 *
 * Reuses the same key-sensitivity heuristic as JSON redaction.
 */
export function redactYamlSecrets(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;

    // Skip comments
    if (line.trimStart().startsWith("#")) {
      result.push(line);
      i++;
      continue;
    }

    const match = line.match(YAML_KV_RE);
    if (match?.[1] && match[2] && isSensitiveKey(match[2])) {
      const prefix = match[1];
      const valueStr = line.slice(prefix.length).trim();
      result.push(`${prefix}${REDACTED}`);
      i++;

      // Block scalar: also skip continuation lines
      if (BLOCK_SCALAR_RE.test(valueStr)) {
        const keyIndent = line.length - line.trimStart().length;
        i = skipBlockScalarLines(lines, i, keyIndent);
      }
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join("\n");
}

// ---------------------------------------------------------------------------
// Line-oriented redaction (for .npmrc, .gitconfig, etc.)
// ---------------------------------------------------------------------------

/** Patterns that match credential lines in ini-style config files */
const LINE_REDACTION_PATTERNS = [
  // .npmrc: //registry.npmjs.org/:_authToken=xxx
  /^(\s*\/\/[^:]+\/:_authToken\s*=\s*).+$/,
  // .npmrc: _auth=xxx
  /^(\s*_auth\s*=\s*).+$/,
  // .gitconfig: helper = store / credential block values
  /^(\s*helper\s*=\s*store).*$/,
  // Generic key=value where key contains token/secret/password/key
  /^(\s*(?:.*(?:token|secret|password|api.?key|credential|auth)\w*)\s*=\s*).+$/i,
];

// ---------------------------------------------------------------------------
// Shell script redaction (for .zshrc, .bashrc, .profile, etc.)
// ---------------------------------------------------------------------------

/**
 * Patterns that match sensitive variable assignments in shell scripts.
 * Captures the prefix (everything before the secret value) so we can
 * replace just the value portion with [REDACTED].
 */
const SHELL_REDACTION_PATTERNS = [
  // export KEY="value" or export KEY='value' or export KEY=value
  // where KEY contains: TOKEN, SECRET, KEY, PASSWORD, CREDENTIAL, AUTH
  /^(\s*export\s+\w*(?:TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|AUTH)\w*=).*$/i,
  // Plain assignment (no export): KEY="value"
  /^(\s*\w*(?:TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|AUTH)\w*=).*$/i,
];

/** Shell config filenames that should receive shell-script redaction */
const SHELL_CONFIG_NAMES = new Set([
  ".zshrc",
  ".zprofile",
  ".zshenv",
  ".zlogin",
  ".bashrc",
  ".bash_profile",
  ".profile",
  ".tmux.conf",
  ".wgetrc",
  ".curlrc",
]);

/**
 * Redact sensitive lines in ini-style / line-oriented config files.
 * Each matching line has its value portion replaced with [REDACTED].
 */
export function redactLineSecrets(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      for (const pattern of LINE_REDACTION_PATTERNS) {
        const match = line.match(pattern);
        if (match) {
          return `${match[1]}${REDACTED}`;
        }
      }
      return line;
    })
    .join("\n");
}

/**
 * Redact sensitive variable assignments in shell scripts.
 * Catches patterns like:
 *   export MY_API_KEY="sk-..."
 *   GITHUB_TOKEN=ghp_xxx
 *   export Z_AI_API_KEY="..."
 */
export function redactShellSecrets(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      // Skip comments
      const trimmed = line.trimStart();
      if (trimmed.startsWith("#")) return line;

      for (const pattern of SHELL_REDACTION_PATTERNS) {
        const match = line.match(pattern);
        if (match) {
          return `${match[1]}${REDACTED}`;
        }
      }
      return line;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Value-pattern redaction (for history.jsonl and other freeform content)
// ---------------------------------------------------------------------------

/**
 * Patterns that match credential-like values embedded in freeform text.
 * These catch secrets that users may have pasted into CLI prompts.
 * Each pattern replaces the matched portion with [REDACTED].
 */
const VALUE_CREDENTIAL_PATTERNS: RegExp[] = [
  // JWT tokens (three base64 segments separated by dots)
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  // Bearer / token auth headers
  /(?:Bearer|Token)\s+[A-Za-z0-9_\-.~+/]{20,}/gi,
  // AWS access keys (AKIA...)
  /AKIA[0-9A-Z]{16}/g,
  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
  /gh[pousr]_[A-Za-z0-9_]{36,}/g,
  // Anthropic API keys
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  // OpenAI API keys
  /sk-(?:proj-)?[A-Za-z0-9]{20,}/g,
  // Slack tokens (xoxb-, xoxp-, xoxs-, xoxa-)
  /xox[bpsa]-[A-Za-z0-9-]{20,}/g,
  // Generic long hex secrets (e.g. 40+ hex chars, common for API keys/tokens)
  /(?:(?:token|key|secret|password|auth|credential|cookie)\s*[=:]\s*)['"]*([A-Za-z0-9_\-+/.]{32,})['"]*$/gim,
  // Cookie session values (session=xxx, sid=xxx, _session_id=xxx)
  /(?:session|sid|_session_id|connect\.sid)\s*=\s*[A-Za-z0-9%_\-+/.]{16,}/gi,
  // npm tokens
  /npm_[A-Za-z0-9]{36,}/g,
  // Private key content (if someone pasted it)
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
];

/**
 * Scan a string value and replace any credential-like patterns with [REDACTED].
 * Returns [redactedString, didRedact].
 */
function redactValuePatterns(value: string): [string, boolean] {
  let result = value;
  let didRedact = false;

  for (const pattern of VALUE_CREDENTIAL_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    if (pattern.test(result)) {
      didRedact = true;
      pattern.lastIndex = 0;
      result = result.replace(pattern, REDACTED);
    }
  }

  return [result, didRedact];
}

/**
 * Deep-walk a parsed value and apply value-pattern redaction to all strings.
 * Unlike redactObject (key-based), this inspects the VALUE content itself.
 */
function redactDeepValues(obj: unknown): [unknown, boolean] {
  if (obj === null || obj === undefined) return [obj, false];

  if (typeof obj === "string") {
    return redactValuePatterns(obj);
  }

  if (Array.isArray(obj)) {
    let anyRedacted = false;
    const mapped = obj.map((item) => {
      const [val, redacted] = redactDeepValues(item);
      if (redacted) anyRedacted = true;
      return val;
    });
    return [mapped, anyRedacted];
  }

  if (typeof obj === "object") {
    let anyRedacted = false;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const [val, redacted] = redactDeepValues(value);
      result[key] = val;
      if (redacted) anyRedacted = true;
    }
    return [result, anyRedacted];
  }

  return [obj, false];
}

/**
 * Redact credential-like values in JSONL content (one JSON object per line).
 * Applies both key-based (sensitive key names) and value-based (credential
 * patterns like JWTs, API keys, bearer tokens) redaction.
 */
export function redactJsonlSecrets(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      try {
        const parsed = JSON.parse(trimmed);

        // Apply key-based redaction first
        const [keyRedacted] = redactObject(parsed);
        // Then apply value-pattern redaction
        const [valueRedacted, didRedact] = redactDeepValues(keyRedacted);

        // Also check if key-based redaction changed anything
        const keyChanged = JSON.stringify(keyRedacted) !== JSON.stringify(parsed);

        if (!didRedact && !keyChanged) return line;
        return JSON.stringify(valueRedacted);
      } catch {
        // Not valid JSON line — apply value-pattern redaction as plain text
        const [result, didRedact] = redactValuePatterns(trimmed);
        return didRedact ? result : line;
      }
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Public API: auto-detect format and redact
// ---------------------------------------------------------------------------

/**
 * Redact credentials from file content.
 * Auto-detects format based on file path extension or filename.
 *
 * @param content  Raw file content
 * @param filePath File path (used to determine format)
 * @returns Content with sensitive values replaced by [REDACTED]
 */
export function redactSecrets(content: string, filePath: string): string {
  const lower = filePath.toLowerCase();

  if (lower.endsWith(".json")) {
    return redactJsonSecrets(content);
  }

  // YAML files: key-based line redaction
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return redactYamlSecrets(content);
  }

  // JSONL files (e.g. history.jsonl): value-pattern + key-based redaction
  if (lower.endsWith(".jsonl")) {
    return redactJsonlSecrets(content);
  }

  // Line-oriented configs: .npmrc, .gitconfig, .env, etc.
  if (
    lower.endsWith(".npmrc") ||
    lower.endsWith(".gitconfig") ||
    lower.endsWith(".env") ||
    lower.endsWith(".env.local") ||
    lower.endsWith(".netrc")
  ) {
    return redactLineSecrets(content);
  }

  // Shell config files: .zshrc, .bashrc, .profile, etc.
  const fileName = lower.split("/").pop() ?? "";
  if (SHELL_CONFIG_NAMES.has(fileName)) {
    return redactShellSecrets(content);
  }

  return content;
}
