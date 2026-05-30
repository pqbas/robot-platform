import type { Recording } from "@/types"
import { apiFetch } from "./client"

export function startRecording(): Promise<Recording> {
  return apiFetch("/api/recordings/start", { method: "POST" })
}

export function stopRecording(): Promise<Recording> {
  return apiFetch("/api/recordings/stop", { method: "POST" })
}

type RecordingFilters = {
  camellon_id?: number
  fundo_uuid?: string
  device_id?: string
  from?: string
  to?: string
}

export function getRecordings(params?: RecordingFilters): Promise<Recording[]> {
  const qs = params
    ? "?" + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : ""
  return apiFetch(`/api/recordings/${qs}`)
}

export function setRecordingPlace(
  uuid: string,
  camellonId: number | null,
): Promise<Recording> {
  return apiFetch(`/api/recordings/${uuid}/place`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ camellon_id: camellonId }),
  })
}

export function deleteRecording(uuid: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/recordings/${uuid}`, { method: "DELETE" })
}

export function getRecordingFileUrl(uuid: string): string {
  return `/api/recordings/${uuid}/file`
}
