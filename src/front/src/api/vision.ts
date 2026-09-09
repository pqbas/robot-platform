import { apiFetch } from "./client"

export type AvailableLabelItem = {
  label: string
  model_filename: string
  // "local" = uploaded on this robot; "uploaded"/"library" come from the server.
  source: "local" | "uploaded" | "library"
}

export function getAvailableLabels(): Promise<AvailableLabelItem[]> {
  return apiFetch("/api/config/available-labels")
}

export function selectLabel(label: string, model_filename: string): Promise<void> {
  return apiFetch("/api/config/select-label", {
    method: "POST",
    body: JSON.stringify({ label, model_filename }),
  })
}
