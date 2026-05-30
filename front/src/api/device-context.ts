import type { DeviceContext } from "@/types"
import { apiFetch } from "./client"

export function getDeviceContext() {
  return apiFetch<DeviceContext>("/api/device-context/")
}

export function setActiveContext(params: {
  empresa_uuid: string
  empresa_name: string
  fundo_uuid: string
  fundo_name: string
  fundo_region?: string | null
}) {
  return apiFetch<DeviceContext>("/api/device-context/active", {
    method: "POST",
    body: JSON.stringify(params),
  })
}
