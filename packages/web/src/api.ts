import useSwr, { type SWRConfiguration } from "swr";

export interface ApiError extends Error {
  status: number;
}

async function rawFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, {
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
  const res = await rawFetch(path, init);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as ApiError;
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export function useApi<T>(path: string | null, config?: SWRConfiguration<T>) {
  return useSwr<T>(path, (key: string) => apiFetch<T>(key), config);
}
