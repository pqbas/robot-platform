export type CountingState = "IDLE" | "COUNTING" | "SAVING"

export type DetectionClass = string

export type Detection = {
  class_name: string
  bbox: [number, number, number, number]
  confidence: number
  track_id: number | null
}

export type FrameData = {
  count: number
  target_class: string
  detections: Detection[]
  session_active: boolean
  error?: string | null
}

export type CountStatus = "none" | "pending" | "counting" | "done" | "error"

export type Session = {
  id: number
  // Null when saved without a location; assignable later via edit.
  camellon_id: number | null
  device_id: string
  start_time: string
  end_time: string | null
  target_class: string
  total_count: number
  recording_uuid: string | null
  // Offline counting status/number, derived from the linked recording.
  count_status: CountStatus
  count: number | null
  // Linked recording's duration/size/upload state (null when no recording).
  duration_seconds: number | null
  file_size_bytes: number | null
  uploaded_at: string | null
}

export type DetectionFrame = {
  // Video frame index (0-based), one line per frame.
  frame: number
  // The frame's own presentation timestamp (seconds, 0-based). Used to match
  // the player's mediaTime to the exact frame — robust to variable frame rate.
  pts: number
  // Running accumulated count up to this frame. Optional: sidecars written
  // before this field lack it (re-count to populate them).
  count?: number
  dets: { cls: string; conf: number; bbox: [number, number, number, number]; track_id: number | null }[]
}

// The counting config actually used for a recording's count, so the replay can
// overlay the line/ROI/direction. Null for recordings counted before this was
// snapshotted (re-count to populate).
export type ReplayCountConfig = {
  count_mode: string | null
  threshold: number | null
  direction: string | null
  roi_mode: string | null
  // "single" (line-crossing) | "tiled" (2 stacked H/2 tiles). Old counts → single.
  method?: "single" | "tiled" | null
  target_class: string | null
  // El label del modelo con el que el worker contó (== `cls` del sidecar). El
  // overlay filtra las cajas por este; target_class es solo para mostrar.
  target_model_label: string | null
}

export type RecordingDetections = {
  fps: number | null
  frames: DetectionFrame[]
  count_config: ReplayCountConfig | null
}

export type Camellon = {
  id: number
  nombre: string
  lat: number | null
  lng: number | null
  fundo_uuid: string | null
  fundo_nombre: string | null
  empresa_nombre: string | null
}

export type CamellonGeoSummary = Camellon & {
  total_count: number
}

export type PolygonPoint = { lat: number; lng: number }

export type MapLocation = {
  id: number
  label: string
  lat: number
  lng: number
  zoom: number
  polygon: PolygonPoint[] | null
}

// --- Dashboard ---

export type DashboardKPIs = {
  total_count: number
  session_count: number
  camellon_count: number
  avg_per_session: number
}

export type DailyTrendItem = {
  date: string
  count: number
}

export type CamellonBreakdownItem = {
  camellon_id: number
  nombre: string
  count: number
}

export type ClassBreakdownItem = {
  target_class: string
  count: number
}

export type DashboardStats = {
  kpis: DashboardKPIs
  daily_trend: DailyTrendItem[]
  by_camellon: CamellonBreakdownItem[]
  by_class: ClassBreakdownItem[]
}

// --- Auth ---

export type AppMode = "robot" | "server"

export type UserInfo = {
  id: number
  username: string
  role: string
  empresa_uuid: string | null
}

// --- Admin entities ---

export type User = {
  id: number
  username: string
  role: string
  empresa_uuid: string | null
  is_active: boolean
  created_at: string | null
}

export type Empresa = {
  uuid: string
  name: string
  is_active: boolean
  created_at: string | null
}

export type Fundo = {
  uuid: string
  empresa_uuid: string
  name: string
  region: string | null
  is_active: boolean
  created_at: string | null
}

export type Device = {
  id: string
  label: string
  last_sync_at: string | null
  is_active: boolean
  fundo_uuid: string | null
}

export type DeviceContext = {
  empresa: { uuid: string; name: string } | null
  fundo: { uuid: string; name: string; region: string | null } | null
}

export type Recording = {
  uuid: string
  device_id: string
  session_uuid: string | null
  camellon_id: number | null
  camellon_nombre: string | null
  fundo_uuid: string | null
  fundo_nombre: string | null
  empresa_nombre: string | null
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  file_path: string
  file_size_bytes: number | null
  width: number | null
  height: number | null
  fps: number | null
  uploaded_at: string | null
  count_status: CountStatus
  count: number | null
  count_error: string | null
}

export type ClassMappingItem = string | { model_label: string; system_label: string }

export type DetectionModel = {
  uuid: string
  version: string
  filename: string
  file_hash: string | null
  source: "uploaded" | "library"
  class_mapping: ClassMappingItem[]
  epochs: number | null
  map50: number | null
  map50_95: number | null
  precision: number | null
  recall: number | null
  dataset_size: number | null
  notes: string | null
  uploaded_by: string
  is_active: boolean
  created_at: string | null
}
