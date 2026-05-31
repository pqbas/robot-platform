import type { Device } from "@/types"
import { apiFetch } from "./client"

export function getDevices() {
  return apiFetch<Device[]>("/api/devices/")
}

export function createDevice(data: { id: string; label: string }) {
  return apiFetch<{ id: string; label: string; api_key: string }>(
    "/api/devices/",
    {
      method: "POST",
      body: JSON.stringify(data),
    },
  )
}

export function updateDevice(
  id: string,
  data: { label?: string; is_active?: boolean; fundo_uuid?: string | null },
) {
  return apiFetch<Device>(`/api/devices/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function rotateApiKey(id: string) {
  return apiFetch<{ id: string; label: string; api_key: string }>(
    `/api/devices/${id}/rotate-api-key`,
    { method: "POST" },
  )
}

export function getDeviceModels(deviceId: string) {
  return apiFetch<import("@/types").DetectionModel[]>(`/api/devices/${deviceId}/models`)
}

export function setDeviceModels(deviceId: string, modelUuids: string[]) {
  return apiFetch<void>(`/api/devices/${deviceId}/models`, {
    method: "PUT",
    body: JSON.stringify({ model_uuids: modelUuids }),
  })
}
