import { useEffect, useRef, useState, useCallback } from "react"
import { setOptions, importLibrary } from "@googlemaps/js-api-loader"
import type { MapLocation, PolygonPoint } from "@/types"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const POLYGON_STYLE = {
  fillColor: "#3b82f6",
  fillOpacity: 0.2,
  strokeColor: "#2563eb",
  strokeOpacity: 1,
  strokeWeight: 3,
}

type GoogleMapProps = {
  locations: MapLocation[]
  activeLocationId: number | null
  onSaveLocation: (label: string, lat: number, lng: number, zoom: number, polygon?: PolygonPoint[] | null) => void
  onDeleteLocation: (id: number) => void
  onUpdatePolygon: (id: number, polygon: PolygonPoint[] | null) => void
}

const FALLBACK_LOCATIONS: MapLocation[] = [
  { id: -1, label: "UPAO – Trujillo", lat: -8.1148, lng: -79.0384, zoom: 17, polygon: null },
  { id: -2, label: "Chihuahua", lat: 28.63, lng: -106.09, zoom: 15, polygon: null },
]

// Call once at module level to avoid StrictMode double-call warning
const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string
if (apiKey) {
  setOptions({ key: apiKey, v: "weekly" })
}
const mapsReady = apiKey
  ? Promise.all([
      importLibrary("maps"),
      importLibrary("drawing"),
    ])
  : null

function getPolygonPath(polygon: google.maps.Polygon): PolygonPoint[] {
  const path = polygon.getPath()
  const points: PolygonPoint[] = []
  for (let i = 0; i < path.getLength(); i++) {
    const ll = path.getAt(i)
    points.push({ lat: ll.lat(), lng: ll.lng() })
  }
  return points
}

export default function GoogleMap({
  locations,
  activeLocationId,
  onSaveLocation,
  onDeleteLocation,
  onUpdatePolygon,
}: GoogleMapProps) {
  const items = locations.length > 0 ? locations : FALLBACK_LOCATIONS
  const [selectedLocation, setSelectedLocation] = useState<string>(
    String(items[0].id),
  )
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newLabel, setNewLabel] = useState("")
  const [drawingMode, setDrawingMode] = useState<"create" | "edit" | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const polygonsRef = useRef<google.maps.Polygon[]>([])
  const drawingManagerRef = useRef<google.maps.drawing.DrawingManager | null>(null)
  const drawnPolygonRef = useRef<google.maps.Polygon | null>(null)
  const editPolygonRef = useRef<google.maps.Polygon | null>(null)
  const editLocationIdRef = useRef<number | null>(null)
  const pendingSaveRef = useRef<{ label: string; lat: number; lng: number; zoom: number } | null>(null)

  // Keep callbacks in refs to avoid stale closures
  const onSaveLocationRef = useRef(onSaveLocation)
  onSaveLocationRef.current = onSaveLocation
  const onUpdatePolygonRef = useRef(onUpdatePolygon)
  onUpdatePolygonRef.current = onUpdatePolygon

  // Default center/zoom from first item
  const defaultCenter = { lat: items[0].lat, lng: items[0].lng }
  const defaultZoom = items[0].zoom

  // Initialize map
  useEffect(() => {
    if (!mapsReady || !containerRef.current) return
    let cancelled = false

    mapsReady.then(() => {
      if (cancelled || !containerRef.current) return
      const map = new google.maps.Map(containerRef.current, {
        center: defaultCenter,
        zoom: defaultZoom,
        mapTypeId: "satellite",
        mapId: "robot-platform-map",
      })
      mapRef.current = map
      setMapReady(true)
    })

    return () => {
      cancelled = true
      mapRef.current = null
      setMapReady(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Render polygons from locations
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clear old polygons
    polygonsRef.current.forEach((p) => p.setMap(null))
    polygonsRef.current = []

    const allItems = locations.length > 0 ? locations : FALLBACK_LOCATIONS
    allItems.forEach((loc) => {
      if (!loc.polygon || loc.polygon.length < 3) return
      const poly = new google.maps.Polygon({
        paths: loc.polygon,
        ...POLYGON_STYLE,
        editable: false,
        map,
      })
      polygonsRef.current.push(poly)
    })
  }, [locations, mapReady])

  // Pan map when activeLocationId changes (from SidePanel filter)
  useEffect(() => {
    const map = mapRef.current
    if (!map || activeLocationId == null) return
    const loc = items.find((l) => l.id === activeLocationId)
    if (loc) {
      map.panTo({ lat: loc.lat, lng: loc.lng })
      map.setZoom(loc.zoom)
      setSelectedLocation(String(loc.id))
    }
  }, [activeLocationId, items])

  // Reset selection when locations list changes
  useEffect(() => {
    const currentItems = locations.length > 0 ? locations : FALLBACK_LOCATIONS
    if (!currentItems.find((l) => String(l.id) === selectedLocation)) {
      setSelectedLocation(String(currentItems[0].id))
    }
  }, [locations, selectedLocation])

  const cleanupDrawing = useCallback(() => {
    if (drawingManagerRef.current) {
      drawingManagerRef.current.setMap(null)
      drawingManagerRef.current = null
    }
    if (drawnPolygonRef.current) {
      drawnPolygonRef.current.setMap(null)
      drawnPolygonRef.current = null
    }
    if (editPolygonRef.current) {
      editPolygonRef.current.setEditable(false)
      editPolygonRef.current = null
    }
    editLocationIdRef.current = null
    pendingSaveRef.current = null
  }, [])

  function startDrawingManager() {
    const map = mapRef.current
    if (!map) return

    const dm = new google.maps.drawing.DrawingManager({
      drawingMode: google.maps.drawing.OverlayType.POLYGON,
      drawingControl: false,
      polygonOptions: {
        ...POLYGON_STYLE,
        editable: true,
      },
    })

    dm.setMap(map)
    drawingManagerRef.current = dm

    google.maps.event.addListener(dm, "polygoncomplete", (polygon: google.maps.Polygon) => {
      // Stop drawing mode
      dm.setDrawingMode(null)
      dm.setMap(null)
      drawingManagerRef.current = null
      drawnPolygonRef.current = polygon
    })
  }

  function handleLocationChange(id: string) {
    setSelectedLocation(id)
    const loc = items.find((l) => String(l.id) === id)
    if (loc && mapRef.current) {
      mapRef.current.panTo({ lat: loc.lat, lng: loc.lng })
      mapRef.current.setZoom(loc.zoom)
    }
  }

  function handleSaveClick() {
    setNewLabel("")
    setDialogOpen(true)
  }

  function handleSaveConfirm() {
    const label = newLabel.trim()
    if (!label || !mapRef.current) return
    const center = mapRef.current.getCenter()
    const zoom = mapRef.current.getZoom()
    if (!center || zoom == null) return

    // Store pending save data and start drawing mode
    pendingSaveRef.current = { label, lat: center.lat(), lng: center.lng(), zoom }
    setDialogOpen(false)
    setDrawingMode("create")
    startDrawingManager()
  }

  function handleFinishCreate() {
    const pending = pendingSaveRef.current
    if (!pending) return

    let polygon: PolygonPoint[] | null = null
    if (drawnPolygonRef.current) {
      polygon = getPolygonPath(drawnPolygonRef.current)
      drawnPolygonRef.current.setMap(null)
      drawnPolygonRef.current = null
    }

    onSaveLocationRef.current(pending.label, pending.lat, pending.lng, pending.zoom, polygon)
    cleanupDrawing()
    setDrawingMode(null)
  }

  function handleCancelCreate() {
    // Save without polygon
    const pending = pendingSaveRef.current
    if (pending) {
      onSaveLocationRef.current(pending.label, pending.lat, pending.lng, pending.zoom, null)
    }
    cleanupDrawing()
    setDrawingMode(null)
  }

  function handleEditPolygon() {
    const map = mapRef.current
    if (!map) return

    const locId = Number(selectedLocation)
    const loc = items.find((l) => l.id === locId)
    if (!loc || loc.id < 0) return

    editLocationIdRef.current = locId
    setDrawingMode("edit")

    if (loc.polygon && loc.polygon.length >= 3) {
      // Find the existing rendered polygon and make it editable
      // We need to create a separate editable polygon for editing
      const editPoly = new google.maps.Polygon({
        paths: loc.polygon,
        ...POLYGON_STYLE,
        editable: true,
        map,
      })
      editPolygonRef.current = editPoly

      // Hide the static polygon for this location
      const locIndex = (locations.length > 0 ? locations : FALLBACK_LOCATIONS).findIndex((l) => l.id === locId)
      if (locIndex >= 0 && polygonsRef.current[locIndex]) {
        polygonsRef.current[locIndex].setVisible(false)
      }
    } else {
      // No polygon exists — start DrawingManager
      startDrawingManager()
    }
  }

  function handleFinishEdit() {
    const locId = editLocationIdRef.current
    if (locId == null) return

    let polygon: PolygonPoint[] | null = null
    if (editPolygonRef.current) {
      polygon = getPolygonPath(editPolygonRef.current)
      editPolygonRef.current.setMap(null)
    } else if (drawnPolygonRef.current) {
      polygon = getPolygonPath(drawnPolygonRef.current)
      drawnPolygonRef.current.setMap(null)
    }

    onUpdatePolygonRef.current(locId, polygon)

    // Restore hidden static polygon visibility
    const locIndex = (locations.length > 0 ? locations : FALLBACK_LOCATIONS).findIndex((l) => l.id === locId)
    if (locIndex >= 0 && polygonsRef.current[locIndex]) {
      polygonsRef.current[locIndex].setVisible(true)
    }

    cleanupDrawing()
    setDrawingMode(null)
  }

  function handleCancelEdit() {
    const locId = editLocationIdRef.current

    if (editPolygonRef.current) {
      editPolygonRef.current.setMap(null)
    }
    if (drawnPolygonRef.current) {
      drawnPolygonRef.current.setMap(null)
    }

    // Restore hidden static polygon visibility
    if (locId != null) {
      const locIndex = (locations.length > 0 ? locations : FALLBACK_LOCATIONS).findIndex((l) => l.id === locId)
      if (locIndex >= 0 && polygonsRef.current[locIndex]) {
        polygonsRef.current[locIndex].setVisible(true)
      }
    }

    cleanupDrawing()
    setDrawingMode(null)
  }

  const currentLoc = items.find((l) => String(l.id) === selectedLocation)
  const canEditPolygon = currentLoc && currentLoc.id > 0 && drawingMode === null

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0">
        {!apiKey && (
          <div className="flex h-full items-center justify-center bg-muted">
            <p className="text-muted-foreground">
              Configura VITE_GOOGLE_MAPS_API_KEY en .env
            </p>
          </div>
        )}
      </div>

      {apiKey && (
        <Card className="absolute top-4 left-4 z-10 gap-2 p-3">
          <p className="mb-0 text-sm font-medium">Ubicacion</p>
          <div className="flex items-center gap-1.5">
            <Select value={selectedLocation} onValueChange={handleLocationChange}>
              <SelectTrigger className="h-8 w-48 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {items.map((loc) => (
                  <SelectItem key={loc.id} value={String(loc.id)} className="text-xs">
                    {loc.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleSaveClick}
              title="Guardar ubicacion actual"
            >
              +
            </Button>
            {canEditPolygon && (
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={handleEditPolygon}
                title="Editar poligono"
              >
                ✎
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Drawing mode overlay */}
      {drawingMode === "create" && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-2">
          <Card className="flex items-center gap-2 px-4 py-2">
            <span className="text-sm">Dibuja un poligono sobre el mapa</span>
            <Button size="sm" onClick={handleFinishCreate}>
              Confirmar
            </Button>
            <Button size="sm" variant="outline" onClick={handleCancelCreate}>
              Sin poligono
            </Button>
          </Card>
        </div>
      )}

      {drawingMode === "edit" && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-2">
          <Card className="flex items-center gap-2 px-4 py-2">
            <span className="text-sm">Edita el poligono</span>
            <Button size="sm" onClick={handleFinishEdit}>
              Confirmar
            </Button>
            <Button size="sm" variant="outline" onClick={handleCancelEdit}>
              Cancelar
            </Button>
          </Card>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Guardar ubicacion</DialogTitle>
            <DialogDescription>
              Guarda la vista actual del mapa con un nombre. Despues podras dibujar un poligono.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Nombre de la ubicacion"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveConfirm()
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveConfirm} disabled={!newLabel.trim()}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
