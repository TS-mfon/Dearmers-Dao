import { useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";

export function useSessionHeaders() {
  const { getAccessToken } = usePrivy();
  return useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);
}

export async function jsonRequest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed with HTTP ${response.status}.`);
  return body;
}
