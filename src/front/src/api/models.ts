import { apiFetch } from "./client"

export type EngineStatus =
  | "pytorch"
  | "pending"
  | "converting"
  | "ready"
  | "error"

export type LocalModel = {
  uuid: string
  filename: string
  tensorrt_enabled: boolean
  engine_status: EngineStatus
  engine_error: string | null
}

export function getLocalModels(): Promise<LocalModel[]> {
  return apiFetch("/api/models")
}

export function setTensorRT(
  uuid: string,
  enabled: boolean,
): Promise<{ engine_status: EngineStatus }> {
  return apiFetch(`/api/models/${uuid}/tensorrt`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  })
}
