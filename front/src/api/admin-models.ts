import type { DetectionModel } from "@/types"
import { apiFetch } from "./client"

export function getDetectionModels() {
  return apiFetch<DetectionModel[]>("/api/detection-models")
}

export async function uploadDetectionModel(formData: FormData) {
  const token = localStorage.getItem("auth_token")
  const headers: Record<string, string> = {}
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch("/api/detection-models", {
    method: "POST",
    headers,
    body: formData,
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

  return res.json() as Promise<DetectionModel>
}

export function activateModel(uuid: string) {
  return apiFetch<DetectionModel>(`/api/detection-models/${uuid}/activate`, {
    method: "PUT",
  })
}

export function deleteModel(uuid: string) {
  return apiFetch<void>(`/api/detection-models/${uuid}`, {
    method: "DELETE",
  })
}
