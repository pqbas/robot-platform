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

export type SyncPushResult = {
  ok: boolean
  reason?: string
  // "ok": the row reached the server. "pending": server unreachable.
  metadata?: "ok" | "pending"
  // Outcome of the MP4 upload for the linked recording.
  mp4?: "uploaded" | "already" | "pending" | "missing" | "none"
}

// Force-sync a single session now: metadata push + its MP4 upload (robot only).
export function pushSessionNow(sessionId: number) {
  return apiFetch<SyncPushResult>(`/api/sync/sessions/${sessionId}/push`, {
    method: "POST",
  })
}

// Force-sync a single recording now: metadata push + MP4 upload (robot only).
export function pushRecordingNow(uuid: string) {
  return apiFetch<SyncPushResult>(`/api/sync/recordings/${uuid}/push`, {
    method: "POST",
  })
}
