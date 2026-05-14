import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { MapIcon, List } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Session, Camellon, MapLocation, PolygonPoint } from "@/types"
import { getCamellones } from "@/api/camellones"
import { getSessions } from "@/api/sessions"
import {
  getLocations,
  createLocation,
  deleteLocation,
  updateLocationPolygon,
} from "@/api/locations"
import GoogleMap from "./components/GoogleMap"
import SidePanel from "./components/SidePanel"

const MAPS_ENABLED = !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY

export default function MapPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [camellones, setCamellones] = useState<Map<number, Camellon>>(new Map())
  const [locations, setLocations] = useState<MapLocation[]>([])
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [locationFilter, setLocationFilter] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState<string | null>(null)
  const [dateTo, setDateTo] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<"table" | "map">("table")

  const loadBase = useCallback(async () => {
    try {
      const [camData, locData] = await Promise.all([
        getCamellones(),
        getLocations(),
      ])
      setCamellones(new Map(camData.map((c) => [c.id, c])))
      setLocations(locData)
    } catch (e) {
      console.error("Error loading map data:", e)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSessions = useCallback(async () => {
    try {
      const params: { from?: string; to?: string } = {}
      if (dateFrom) params.from = dateFrom
      if (dateTo) params.to = dateTo
      const sessData = await getSessions(params)
      setSessions(sessData)
    } catch (e) {
      console.error("Error loading sessions:", e)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    loadBase()
  }, [loadBase])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const handleSaveLocation = useCallback(
    async (label: string, lat: number, lng: number, zoom: number, polygon?: PolygonPoint[] | null) => {
      try {
        const loc = await createLocation({ label, lat, lng, zoom, polygon })
        setLocations((prev) => [...prev, loc])
        toast.success("Ubicacion guardada")
      } catch (e) {
        toast.error(
          "Error al guardar ubicacion: " +
            (e instanceof Error ? e.message : "desconocido"),
        )
      }
    },
    [],
  )

  const handleDeleteLocation = useCallback(async (id: number) => {
    try {
      await deleteLocation(id)
      setLocations((prev) => prev.filter((l) => l.id !== id))
      toast.success("Ubicacion eliminada")
    } catch (e) {
      toast.error(
        "Error al eliminar ubicacion: " +
          (e instanceof Error ? e.message : "desconocido"),
      )
    }
  }, [])

  const handleUpdatePolygon = useCallback(
    async (id: number, polygon: PolygonPoint[] | null) => {
      try {
        const updated = await updateLocationPolygon(id, polygon)
        setLocations((prev) => prev.map((l) => (l.id === id ? updated : l)))
        toast.success("Poligono actualizado")
      } catch (e) {
        toast.error(
          "Error al actualizar poligono: " +
            (e instanceof Error ? e.message : "desconocido"),
        )
      }
    },
    [],
  )

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Cargando mapa...</p>
      </div>
    )
  }

  // Sin API key de Google Maps: solo Logs (SidePanel) full-width. Sin toggle
  // mobile ni columna de mapa.
  if (!MAPS_ENABLED) {
    return (
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SidePanel
          sessions={sessions}
          camellones={camellones}
          locations={locations}
          locationFilter={locationFilter}
          onLocationFilterChange={setLocationFilter}
          selectedSession={selectedSession}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onSelectSession={setSelectedSession}
          onDateChange={(from, to) => {
            setDateFrom(from)
            setDateTo(to)
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      {/* Mobile toggle */}
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2 md:hidden">
        <Button
          variant={mobileView === "table" ? "default" : "outline"}
          size="sm"
          onClick={() => setMobileView("table")}
        >
          <List className="mr-1.5 size-4" />
          Sesiones
        </Button>
        <Button
          variant={mobileView === "map" ? "default" : "outline"}
          size="sm"
          onClick={() => setMobileView("map")}
        >
          <MapIcon className="mr-1.5 size-4" />
          Mapa
        </Button>
      </div>

      {/* Map */}
      <div className={`relative flex-1 ${mobileView === "map" ? "block" : "hidden"} md:block md:flex-1`}>
        <GoogleMap
          locations={locations}
          activeLocationId={
            locationFilter !== "all"
              ? locations.find((l) => l.label === locationFilter)?.id ?? null
              : null
          }
          onSaveLocation={handleSaveLocation}
          onDeleteLocation={handleDeleteLocation}
          onUpdatePolygon={handleUpdatePolygon}
        />
      </div>

      {/* Side Panel */}
      <div className={`min-h-0 flex-1 overflow-hidden ${mobileView === "table" ? "flex" : "hidden"} md:flex md:w-1/3 md:flex-none md:shrink-0`}>
        <SidePanel
          sessions={sessions}
          camellones={camellones}
          locations={locations}
          locationFilter={locationFilter}
          onLocationFilterChange={setLocationFilter}
          selectedSession={selectedSession}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onSelectSession={setSelectedSession}
          onDateChange={(from, to) => {
            setDateFrom(from)
            setDateTo(to)
          }}
        />
      </div>
    </div>
  )
}
