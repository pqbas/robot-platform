import { ApiError, apiFetch } from "./client"

export type EngineStatus =
  | "pytorch"
  | "pending"
  | "converting"
  | "ready"
  | "error"

export type LocalModel = {
  uuid: string
  filename: string
  // "local" = uploaded on this robot (survives sync); anything else comes
  // from the server and is governed by the sync pull.
  source: string
  tensorrt_enabled: boolean
  engine_status: EngineStatus
  engine_error: string | null
}

export function getLocalModels(): Promise<LocalModel[]> {
  return apiFetch("/api/models")
}

export async function uploadLocalModel(
  formData: FormData,
): Promise<LocalModel> {
  const token = localStorage.getItem("auth_token")
  const headers: Record<string, string> = {}
  if (token) headers["Authorization"] = `Bearer ${token}`

  // Not apiFetch: multipart must not carry a JSON Content-Type (the browser
  // sets the multipart boundary itself).
  const res = await fetch("/api/models/upload", {
    method: "POST",
    headers,
    body: formData,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new ApiError(res.status, text)
  }
  return res.json()
}

export function deleteLocalModel(uuid: string): Promise<void> {
  return apiFetch(`/api/models/${uuid}`, { method: "DELETE" })
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
