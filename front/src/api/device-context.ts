import type { DeviceContext } from "@/types"
import { apiFetch } from "./client"

export function getDeviceContext() {
  return apiFetch<DeviceContext>("/api/device-context/")
}
