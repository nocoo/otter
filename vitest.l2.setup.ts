/**
 * Vitest globalSetup for L2 — boots the wrangler dev server once
 * (--local, env=test) and exposes the base URL via OTTER_L2_BASE_URL
 * for individual e2e tests.
 */

import { startApiE2eServer } from "./scripts/run-api-e2e";

export default async function setup(): Promise<() => Promise<void>> {
  const { baseUrl, email, stop } = await startApiE2eServer();
  process.env.OTTER_L2_BASE_URL = baseUrl;
  process.env.OTTER_L2_EMAIL = email;
  return async () => {
    await stop();
  };
}
