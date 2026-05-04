// Shared Hono app env type. Variables are populated by middleware
// (access-auth / api-key-auth / driver injection) and read by route handlers.
import type { DbDriver } from "../lib/db/driver";

export interface AppVariables {
  driver?: DbDriver;
  accessAuthenticated?: boolean;
  accessEmail?: string;
}

export interface AppBindings {
  // biome-ignore lint/style/useNamingConvention: env var name
  CF_ACCESS_TEAM_DOMAIN?: string;
  // biome-ignore lint/style/useNamingConvention: env var name
  CF_ACCESS_AUD?: string;
  // biome-ignore lint/style/useNamingConvention: env var name
  ENVIRONMENT?: string;
  // biome-ignore lint/style/useNamingConvention: env var name
  E2E_SKIP_AUTH?: string;
  // biome-ignore lint/style/useNamingConvention: env var name
  DEV_USER_EMAIL?: string;
}

export interface AppEnv {
  // biome-ignore lint/style/useNamingConvention: Hono key
  Variables: AppVariables;
  // biome-ignore lint/style/useNamingConvention: Hono key
  Bindings: AppBindings;
}
