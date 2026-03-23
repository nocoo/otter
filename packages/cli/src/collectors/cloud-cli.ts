import { join } from "node:path";
import type { CollectedListItem, CollectorCategory, CollectorResult } from "@otter/core";
import { BaseCollector } from "./base.js";

function parseAwsProfiles(content: string): CollectedListItem[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[") && line.endsWith("]"))
    .map((line) => line.slice(1, -1))
    .flatMap((section) => {
      const profile = section.startsWith("profile ")
        ? section.slice("profile ".length)
        : section === "default"
          ? "default"
          : null;
      return profile ? [{ name: profile, meta: { type: "aws-profile" } }] : [];
    });
}

export class CloudCLICollector extends BaseCollector {
  readonly id = "cloud-cli";
  readonly label = "Cloud CLI Configuration";
  readonly category: CollectorCategory = "config";

  async collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      const azureConfig = await this.safeReadFile(join(this.homeDir, ".azure", "config"), result, {
        redact: true,
      });
      if (azureConfig) result.files.push(azureConfig);

      const azureProfile = await this.safeReadFile(
        join(this.homeDir, ".azure", "azureProfile.json"),
        result,
        { redact: true },
      );
      if (azureProfile) result.files.push(azureProfile);

      const azureClouds = await this.safeReadFile(
        join(this.homeDir, ".azure", "clouds.config"),
        result,
      );
      if (azureClouds) result.files.push(azureClouds);

      const awsConfig = await this.safeReadFile(join(this.homeDir, ".aws", "config"), result, {
        redact: true,
      });
      if (awsConfig) {
        result.files.push(awsConfig);
        result.lists.push(...parseAwsProfiles(awsConfig.content));
      }

      const gcloudProperties = await this.safeReadFile(
        join(this.homeDir, ".config", "gcloud", "properties"),
        result,
        { redact: true },
      );
      if (gcloudProperties) result.files.push(gcloudProperties);

      const gcloudConfigurations = await this.collectDir(
        join(this.homeDir, ".config", "gcloud", "configurations"),
        result,
        {
          redact: true,
          filter: (filePath) => {
            const blocked = [
              "credentials.db",
              "access_tokens.db",
              "application_default_credentials.json",
            ];
            return !blocked.some((suffix) => filePath.endsWith(suffix));
          },
        },
      );
      result.files.push(...gcloudConfigurations);

      const railwayConfig = await this.safeReadFile(
        join(this.homeDir, ".config", "railway", "config.json"),
        result,
        { redact: true },
      );
      if (railwayConfig) result.files.push(railwayConfig);
    });
  }
}
