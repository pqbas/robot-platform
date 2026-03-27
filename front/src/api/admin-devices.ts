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
  data: { label?: string; is_active?: boolean },
) {
  return apiFetch<Device>(`/api/devices/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}
