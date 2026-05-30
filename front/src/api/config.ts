import { apiFetch } from "./client"

// --- Camera ---

export type CameraDevice = {
  index: number
  name: string
  available: boolean
}

export type CameraConfig = {
  index: number
  frame_width: number
  frame_height: number
  crop_width: number
}

export function listCameras(): Promise<CameraDevice[]> {
  return apiFetch("/api/config/cameras")
}

export function getCameraConfig(): Promise<CameraConfig> {
  return apiFetch("/api/config/camera")
}

export function updateCameraConfig(
  data: Partial<CameraConfig>,
): Promise<CameraConfig> {
  return apiFetch("/api/config/camera", {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

// --- Camera resolution preset (Phase 11) ---

export type CameraPreset = "1080p" | "720p"

export type CameraResolution = {
  preset: CameraPreset
}

export function getCameraResolution(): Promise<CameraResolution> {
  return apiFetch("/api/config/camera/resolution")
}

export function setCameraResolution(
  preset: CameraPreset,
): Promise<CameraResolution> {
  return apiFetch("/api/config/camera/resolution", {
    method: "PUT",
    body: JSON.stringify({ preset }),
  })
}

// --- Camera source (RTSP URL) ---

export type CameraSource = { rtsp_url: string }

export function getCameraSource(): Promise<CameraSource> {
  return apiFetch("/api/config/camera/source")
}

export function setCameraSource(rtsp_url: string): Promise<CameraSource> {
  return apiFetch("/api/config/camera/source", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rtsp_url }),
  })
}

// --- Counting ---

export type RoiMode = "square" | "full"

export type CountingConfig = {
  count_mode: string
  threshold: number
  direction: string
  confidence_threshold: number
  roi_mode: RoiMode
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
