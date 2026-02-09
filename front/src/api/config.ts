import { apiFetch } from "./client"

export type CountingConfig = {
  count_mode: string
  threshold: number
  direction: string
  confidence_threshold: number
}

export type CountingConfigUpdate = Partial<CountingConfig>

export function getCountingConfig(): Promise<CountingConfig> {
  return apiFetch("/api/config/counting")
}

export function updateCountingConfig(
  data: CountingConfigUpdate,
): Promise<CountingConfig> {
  return apiFetch("/api/config/counting", {
    method: "PUT",
    body: JSON.stringify(data),
  })
}
