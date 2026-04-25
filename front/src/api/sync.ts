import { apiFetch } from "./client"

export function forceSyncPush() {
  return apiFetch<{ ok: boolean; reason?: string }>("/api/sync/push", {
    method: "POST",
  })
}

export function forceSyncPull() {
  return apiFetch<{ ok: boolean; reason?: string }>("/api/sync/pull", {
    method: "POST",
  })
}
