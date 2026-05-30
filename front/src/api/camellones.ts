import type { Camellon, CamellonGeoSummary } from "@/types"
import { ApiError, apiFetch } from "./client"

export function getCamellones(fundoUuid?: string): Promise<Camellon[]> {
  const qs = fundoUuid ? `?fundo_uuid=${encodeURIComponent(fundoUuid)}` : ""
  return apiFetch(`/api/camellones${qs}`)
}

export function createCamellon(nombre: string, fundoUuid?: string): Promise<Camellon> {
  return apiFetch("/api/camellones", {
    method: "POST",
    body: JSON.stringify({ nombre, fundo_uuid: fundoUuid ?? null }),
  })
}

export function renameCamellon(id: number, nombre: string): Promise<Camellon> {
  return apiFetch(`/api/camellones/${id}`, {
    method: "PATCH",
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

export async function findOrCreateCamellon(
  nombre: string,
  fundoUuid?: string,
): Promise<Camellon> {
  try {
    return await createCamellon(nombre, fundoUuid)
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      // Scope the lookup to the same fundo so we don't resolve the wrong one
      // under composite (fundo_uuid, nombre) uniqueness.
      const all = await getCamellones(fundoUuid)
      const found = all.find(
        (c) => c.nombre.toLowerCase() === nombre.toLowerCase(),
      )
      if (found) return found
    }
    throw e
  }
}
