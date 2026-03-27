import type { FruitType, DetectionModel } from "@/types"
import { apiFetch } from "./client"

export function getFruitTypes() {
  return apiFetch<FruitType[]>("/api/fruit-types")
}

export function createFruitType(data: { name: string }) {
  return apiFetch<FruitType>("/api/fruit-types", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

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
