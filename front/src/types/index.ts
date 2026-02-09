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
