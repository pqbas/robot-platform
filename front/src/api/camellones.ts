import type { Camellon, CamellonGeoSummary } from "@/types"
import { ApiError, apiFetch } from "./client"

export function getCamellones(): Promise<Camellon[]> {
  return apiFetch("/api/camellones")
}

export function createCamellon(nombre: string): Promise<Camellon> {
  return apiFetch("/api/camellones", {
    method: "POST",
    body: JSON.stringify({ nombre }),
  })
}

export function updateLocation(
  id: number,
  lat: number,
  lng: number,
): Promise<Camellon> {
  return apiFetch(`/api/camellones/${id}/location`, {
    method: "PUT",
    body: JSON.stringify({ lat, lng }),
  })
}

export function getGeoSummary(): Promise<CamellonGeoSummary[]> {
  return apiFetch("/api/camellones/geo-summary")
}

export async function findOrCreateCamellon(nombre: string): Promise<Camellon> {
  try {
    return await createCamellon(nombre)
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      const all = await getCamellones()
      const found = all.find(
        (c) => c.nombre.toLowerCase() === nombre.toLowerCase(),
      )
      if (found) return found
    }
    throw e
  }
}
