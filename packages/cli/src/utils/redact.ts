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
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(key));
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
