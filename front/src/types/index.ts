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
  session_total: number
  error?: string | null
}

export type Session = {
  id: number
  camellon_id: number
  start_time: string
  end_time: string | null
  target_class: string
  total_count: number
}

export type Camellon = {
  id: number
  nombre: string
  lat: number | null
  lng: number | null
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
}

export type ClassMappingItem = string | { model_label: string; system_label: string }

export type DetectionModel = {
  uuid: string
  version: string
  filename: string
  file_hash: string
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
