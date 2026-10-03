import useSwr, { type SWRConfiguration } from "swr";
import { apiPath, beginEnvironmentWrite } from "./lib/environment";

export interface ApiError extends Error {
  status: number;
}

async function rawFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(apiPath(input), {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const finish =
    init?.method && !["GET", "HEAD"].includes(init.method)
      ? beginEnvironmentWrite()
      : () => undefined;
  try {
    const res = await rawFetch(path, init);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const err = new Error(`HTTP ${res.status}${body.error ? `: ${body.error}` : ""}`) as ApiError;
      err.status = res.status;
      throw err;
    }
    return (await res.json()) as T;
  } finally {
    finish();
  }
}

export function useApi<T>(path: string | null, config?: SWRConfiguration<T>) {
  return useSwr<T>(path, (key: string) => apiFetch<T>(key), config);
}
