import type {
  Recording,
  RecordingClassifications,
  RecordingDetections,
} from "@/types"
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

export function recountRecording(
  uuid: string,
  useActiveModel = false,
): Promise<Recording> {
  const qs = useActiveModel ? "?use_active_model=true" : ""
  return apiFetch(`/api/recordings/${uuid}/recount${qs}`, { method: "POST" })
}

// Per-video counting params reviewed in the re-process dialog. The chosen class
// fixes the model (model_uuid) and the operator picks the runtime of that model.
export type RecountConfig = {
  count_mode: string
  threshold: number
  direction: string
  roi_mode: "square" | "full"
  confidence: number
  target_class: string | null
  model_uuid: string | null
  runtime: "pytorch" | "tensorrt" | null
  // single = line-crossing; tiled = central-strip 2-tile crossing (blueberries).
  method: "single" | "tiled"
}

// Prefill for the re-process dialog: this video's last-used params, or the
// current global defaults if it was never counted.
export function getRecountConfig(uuid: string): Promise<RecountConfig> {
  return apiFetch(`/api/recordings/${uuid}/count-config`)
}

// Run the count with the reviewed/edited per-video params (only this video's
// count_config changes; the global default is untouched).
export function recountWithConfig(
  uuid: string,
  params: RecountConfig,
): Promise<Recording> {
  return apiFetch(`/api/recordings/${uuid}/recount`, {
    method: "POST",
    body: JSON.stringify(params),
  })
}

// Attach a manually-produced count to an uncounted recording, bypassing the
// robot's counting-worker (e.g. detections computed locally/in the cloud
// with a tweaked algorithm). totalCount omitted -> server derives it from
// distinct track_ids in the uploaded JSONL.
export async function uploadRecordingCount(
  uuid: string,
  file: File,
  totalCount?: number,
): Promise<Recording> {
  const token = localStorage.getItem("auth_token")
  const headers: Record<string, string> = {}
  if (token) headers["Authorization"] = `Bearer ${token}`

  const fd = new FormData()
  fd.append("file", file)
  if (totalCount != null) fd.append("total_count", String(totalCount))

  const res = await fetch(`/api/recordings/${uuid}/upload-count`, {
    method: "POST",
    headers,
    body: fd,
  })

  if (res.status === 401) {
    localStorage.removeItem("auth_token")
    if (window.location.pathname !== "/login") {
      window.location.replace("/login")
    }
    throw new Error("Unauthorized")
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text)
  }

  return res.json() as Promise<Recording>
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

export function getUploadingUuids(): Promise<{ uuids: string[] }> {
  return apiFetch("/api/recordings/uploading")
}

export function getRecordingDetections(uuid: string): Promise<RecordingDetections> {
  return apiFetch(`/api/recordings/${uuid}/detections`)
}

// Ripeness classification results for a recording (distribution + crop gallery).
export function getRecordingClassifications(
  uuid: string,
): Promise<RecordingClassifications> {
  return apiFetch(`/api/recordings/${uuid}/classifications`)
}

// Re-run the offline ripeness classification with the pinned classifier (robot
// only). 409 when the category has no classifier / the recording wasn't counted.
export function reclassifyRecording(uuid: string): Promise<Recording> {
  return apiFetch(`/api/recordings/${uuid}/reclassify`, { method: "POST" })
}

// URL of a single crop JPG. The filename is the bare basename from a
// RipenessCrop.crop; the backend rejects any path separator.
export function getCropImageUrl(uuid: string, filename: string): string {
  return `/api/recordings/${uuid}/crops/${encodeURIComponent(filename)}`
}
