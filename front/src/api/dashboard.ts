import type { DashboardStats } from "@/types"
import { apiFetch } from "./client"

export type DashboardFilters = {
  from?: string
  to?: string
  target_class?: string
  camellon_id?: number
}

export function getDashboardStats(filters?: DashboardFilters): Promise<DashboardStats> {
  const qs = new URLSearchParams()
  if (filters?.from) qs.set("from", filters.from)
  if (filters?.to) qs.set("to", filters.to)
  if (filters?.target_class) qs.set("target_class", filters.target_class)
  if (filters?.camellon_id) qs.set("camellon_id", String(filters.camellon_id))
  const query = qs.toString()
  return apiFetch(`/api/dashboard/stats${query ? `?${query}` : ""}`)
}
