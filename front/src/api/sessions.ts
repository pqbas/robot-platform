import type { Session } from "@/types"
import { apiFetch } from "./client"

// --- Live counting (in-memory) ---

type CountingStopResult = {
  total_count: number
  target_class: string
}

export function startCounting(targetClass: string): Promise<{ active: boolean }> {
  return apiFetch("/api/counting/start", {
    method: "POST",
    body: JSON.stringify({ target_class: targetClass }),
  })
}

export function stopCounting(): Promise<CountingStopResult> {
  return apiFetch("/api/counting/stop", { method: "POST" })
}

// --- Sessions (DB persistence) ---

export function getSessions(params?: { from?: string; to?: string }): Promise<Session[]> {
  const qs = new URLSearchParams()
  if (params?.from) qs.set("from", params.from)
  if (params?.to) qs.set("to", params.to)
  const query = qs.toString()
  return apiFetch(`/api/sessions${query ? `?${query}` : ""}`)
}

export function getSession(id: number): Promise<Session> {
  return apiFetch(`/api/sessions/${id}`)
}

export function saveSession(
  camellonId: number,
  targetClass: string,
  totalCount: number,
): Promise<Session> {
  return apiFetch("/api/sessions/save", {
    method: "POST",
    body: JSON.stringify({
      camellon_id: camellonId,
      target_class: targetClass,
      total_count: totalCount,
    }),
  })
}

export function exportSession(id: number): void {
  window.open(`/api/sessions/${id}/export`, "_blank")
}
