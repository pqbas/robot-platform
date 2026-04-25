import type { Recording } from "@/types"
import { apiFetch } from "./client"

export function startRecording(): Promise<Recording> {
  return apiFetch("/api/recordings/start", { method: "POST" })
}

export function stopRecording(): Promise<Recording> {
  return apiFetch("/api/recordings/stop", { method: "POST" })
}

export function getRecordings(): Promise<Recording[]> {
  return apiFetch("/api/recordings/")
}

export function deleteRecording(uuid: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/recordings/${uuid}`, { method: "DELETE" })
}

export function getRecordingFileUrl(uuid: string): string {
  return `/api/recordings/${uuid}/file`
}
