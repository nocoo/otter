import type { SWRConfiguration } from "swr";
import { useApi } from "@/api";

export interface MeResponse {
  email: string | null;
  name: string | null;
  avatar: string | null;
  authenticated: boolean;
}

const STATIC: SWRConfiguration<MeResponse> = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
};

export function useMe() {
  return useApi<MeResponse>("/api/me", STATIC);
}
