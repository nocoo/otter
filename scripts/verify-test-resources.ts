/**
 * Verify test resources before E2E execution.
 *
 * Queries the test D1 database's _test_marker table via CF REST API
 * to confirm it's actually a test database. This is the last line of
 * defence — even if all env overrides fail due to bugs, the marker
 * table prevents accidental operations on production data.
 */

interface D1ApiResponse {
  result: Array<{
    results: Array<Record<string, unknown>>;
    success: boolean;
  }>;
  success: boolean;
  errors: Array<{ code: number; message: string }>;
}

export async function verifyTestDatabase(): Promise<void> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const testDbId = process.env.CF_D1_TEST_DATABASE_ID;
  const token = process.env.CF_D1_API_TOKEN;

  if (!accountId || !testDbId || !token) {
    throw new Error(
      "Cannot verify test database: CF_ACCOUNT_ID, CF_D1_TEST_DATABASE_ID, or CF_D1_API_TOKEN missing.",
    );
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${testDbId}/query`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sql: "SELECT value FROM _test_marker WHERE key = 'env'",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to query test database (${res.status}): ${text}`);
  }

  const data: D1ApiResponse = await res.json();
  if (!data.success || !data.result?.[0]) {
    throw new Error(
      `D1 query failed: ${data.errors?.map((e) => e.message).join(", ") || "unknown error"}`,
    );
  }

  const marker = data.result[0].results?.[0] as { value?: string } | undefined;
  if (marker?.value !== "test") {
    throw new Error(
      `FATAL: _test_marker missing or wrong in otter-db-test. Expected "test", got: ${JSON.stringify(marker?.value)}`,
    );
  }

  console.log("✅ Test database verified (_test_marker = test)");
}

if (import.meta.main) {
  await verifyTestDatabase();
}
