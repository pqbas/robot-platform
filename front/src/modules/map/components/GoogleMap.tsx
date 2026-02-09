import { useEffect, useRef } from "react"
import { setOptions, importLibrary } from "@googlemaps/js-api-loader"
import type { CamellonGeoSummary } from "@/types"

const LOW_THRESHOLD = 10
const HIGH_THRESHOLD = 50

function markerColor(total: number): string {
  if (total < LOW_THRESHOLD) return "#ef4444"   // red
  if (total < HIGH_THRESHOLD) return "#eab308"  // yellow
  return "#22c55e"                               // green
}

type GoogleMapProps = {
  camellones: CamellonGeoSummary[]
  locatingId: number | null
  onMarkerClick: (c: CamellonGeoSummary) => void
  onMapClick: (lat: number, lng: number) => void
}

const DEFAULT_CENTER = { lat: 28.63, lng: -106.09 }
const DEFAULT_ZOOM = 15

// Call once at module level to avoid StrictMode double-call warning
const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string
if (apiKey) {
  setOptions({ key: apiKey, v: "weekly" })
}
const mapsReady = apiKey
  ? Promise.all([importLibrary("maps"), importLibrary("marker")])
  : null

export default function GoogleMap({
  camellones,
  locatingId,
  onMarkerClick,
  onMapClick,
}: GoogleMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])
  const listenerRef = useRef<google.maps.MapsEventListener | null>(null)

  // Keep callbacks in refs to avoid stale closures
  const onMarkerClickRef = useRef(onMarkerClick)
  onMarkerClickRef.current = onMarkerClick
  const onMapClickRef = useRef(onMapClick)
  onMapClickRef.current = onMapClick

  // Initialize map
  useEffect(() => {
    if (!mapsReady || !containerRef.current) return
    let cancelled = false

    mapsReady.then(() => {
      if (cancelled || !containerRef.current) return
      const map = new google.maps.Map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        mapTypeId: "satellite",
        mapId: "robot-platform-map",
      })
      mapRef.current = map

      // Center on device location if available
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (!cancelled) {
              map.setCenter({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
              })
              map.setZoom(DEFAULT_ZOOM)
            }
          },
          (err) => {
            console.warn("Geolocation error:", err.code, err.message)
          },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
        )
      }
    })

    return () => {
      cancelled = true
      markersRef.current.forEach((m) => (m.map = null))
      markersRef.current = []
      mapRef.current = null
    }
  }, [])

  // Sync markers with camellones data
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clear old markers
    markersRef.current.forEach((m) => (m.map = null))
    markersRef.current = []

    const located = camellones.filter((c) => c.lat != null && c.lng != null)

    located.forEach((c) => {
      const pin = document.createElement("div")
      pin.style.width = "16px"
      pin.style.height = "16px"
      pin.style.borderRadius = "50%"
      pin.style.background = markerColor(c.total_count)
      pin.style.border = "2px solid white"
      pin.style.cursor = "pointer"

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: c.lat!, lng: c.lng! },
        content: pin,
        title: c.nombre,
      })

      marker.addListener("click", () => onMarkerClickRef.current(c))
      markersRef.current.push(marker)
    })

    // Fit bounds if there are markers
    if (located.length > 0) {
      const bounds = new google.maps.LatLngBounds()
      located.forEach((c) => bounds.extend({ lat: c.lat!, lng: c.lng! }))
      map.fitBounds(bounds, 60)
    }
  }, [camellones])

  // Handle map click for locating mode
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (listenerRef.current) {
      listenerRef.current.remove()
      listenerRef.current = null
    }

    if (locatingId != null) {
      map.setOptions({ draggableCursor: "crosshair" })
      listenerRef.current = map.addListener(
        "click",
        (e: google.maps.MapMouseEvent) => {
          if (e.latLng) {
            onMapClickRef.current(e.latLng.lat(), e.latLng.lng())
          }
        },
      )
    } else {
      map.setOptions({ draggableCursor: null })
    }

    return () => {
      if (listenerRef.current) {
        listenerRef.current.remove()
        listenerRef.current = null
      }
    }
  }, [locatingId])

  return (
    <div ref={containerRef} className="absolute inset-0">
      {!apiKey && (
        <div className="flex h-full items-center justify-center bg-muted">
          <p className="text-muted-foreground">
            Configura VITE_GOOGLE_MAPS_API_KEY en .env
          </p>
        </div>
      )}
    </div>
  )
}
