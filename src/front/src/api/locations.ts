import type { MapLocation, PolygonPoint } from "@/types"
import { ApiError, apiFetch } from "./client"

export function getLocations(): Promise<MapLocation[]> {
  return apiFetch("/api/locations")
}

export function createLocation(data: {
  label: string
  lat: number
  lng: number
  zoom: number
  polygon?: PolygonPoint[] | null
}): Promise<MapLocation> {
  return apiFetch("/api/locations", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export function updateLocationPolygon(
  id: number,
  polygon: PolygonPoint[] | null,
): Promise<MapLocation> {
  return apiFetch(`/api/locations/${id}/polygon`, {
    method: "PUT",
    body: JSON.stringify({ polygon }),
  })
}

export async function deleteLocation(id: number): Promise<void> {
  const res = await fetch(`/api/locations/${id}`, { method: "DELETE" })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new ApiError(res.status, text)
  }
}
