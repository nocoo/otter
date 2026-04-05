import { ConfigManager as BaseConfigManager } from "@nocoo/cli-base";

const PROD_CONFIG = "config.json";
const DEV_CONFIG = "config.dev.json";

/** Config type with index signature for cli-base compatibility */
interface OtterConfigInternal {
  token?: string;
  [key: string]: unknown;
}

/**
 * Manages the CLI configuration file.
 * - Production: ~/.config/otter/config.json
 * - Dev:        ~/.config/otter/config.dev.json
 *
 * Extends cli-base ConfigManager with Otter-specific methods.
 */
export class ConfigManager extends BaseConfigManager<OtterConfigInternal> {
  constructor(configDir: string, dev = false) {
    super(configDir, dev, {
      prodFilename: PROD_CONFIG,
      devFilename: DEV_CONFIG,
    });
  }

  /** Get the authentication token. */
  getToken(): string | undefined {
    return this.get("token") as string | undefined;
  }

  /** Check if user is logged in. */
  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  /** Save the token (async wrapper for login flow). */
  async saveToken(token: string): Promise<void> {
    await this.writeAsync({ token });
  }

  /**
   * Load config from disk (async).
   * @deprecated Use read() or readAsync() instead.
   */
  load(): Promise<OtterConfigInternal> {
    return this.readAsync();
  }

  /**
   * Save config to disk.
   * @deprecated Use write() or writeAsync() instead.
   */
  save(config: OtterConfigInternal): Promise<void> {
    return this.writeAsync(config);
  }
}
