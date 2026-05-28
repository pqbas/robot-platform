import type { Session } from "@/types"
import { apiFetch } from "./client"

// --- Live counting (in-memory) ---

type CountingStopResult = {
  total_count: number
  target_class: string
}

export type CountingStatus = {
  active: boolean
  target_class: string | null
  start_time: string | null
  total_count: number
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

export function getCountingStatus(): Promise<CountingStatus> {
  return apiFetch("/api/counting/status")
}

// --- Sessions (DB persistence) ---

export function getSessions(params?: { from?: string; to?: string; device_id?: string }): Promise<Session[]> {
  const qs = new URLSearchParams()
  if (params?.from) qs.set("from", params.from)
  if (params?.to) qs.set("to", params.to)
  if (params?.device_id) qs.set("device_id", params.device_id)
  const query = qs.toString()
  return apiFetch(`/api/sessions${query ? `?${query}` : ""}`)
}

export function getSessionDevices(): Promise<string[]> {
  return apiFetch("/api/sessions/devices")
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

export function patchSession(id: number, camellonId: number): Promise<Session> {
  return apiFetch(`/api/sessions/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ camellon_id: camellonId }),
  })
}

export function exportSession(id: number): void {
  window.open(`/api/sessions/${id}/export`, "_blank")
}
