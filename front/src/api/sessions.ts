import type { Session } from "@/types"
import { apiFetch } from "./client"

type SessionStopResult = {
  id: number
  total_count: number
  end_time: string
}

export function getSessions(): Promise<Session[]> {
  return apiFetch("/api/sessions")
}

export function getSession(id: number): Promise<Session> {
  return apiFetch(`/api/sessions/${id}`)
}

export function startSession(
  camellonId: number,
  targetClass: string,
): Promise<Session> {
  return apiFetch("/api/sessions/start", {
    method: "POST",
    body: JSON.stringify({ camellon_id: camellonId, target_class: targetClass }),
  })
}

export function stopSession(): Promise<SessionStopResult> {
  return apiFetch("/api/sessions/stop", { method: "POST" })
}

export function exportSession(id: number): void {
  window.open(`/api/sessions/${id}/export`, "_blank")
}
