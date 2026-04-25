/**
 * Vitest globalSetup for L2 — boots the wrangler dev server once
 * (CF remote, env=test) and exposes the base URL via OTTER_L2_BASE_URL
 * for individual e2e tests.
 */

import { startApiE2eServer } from "./scripts/run-api-e2e";

export default async function setup(): Promise<() => Promise<void>> {
  const { baseUrl, stop } = await startApiE2eServer();
  process.env.OTTER_L2_BASE_URL = baseUrl;
  return async () => {
    await stop();
  };
}
