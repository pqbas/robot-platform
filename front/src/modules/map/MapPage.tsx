import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
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

export default function MapPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [camellones, setCamellones] = useState<Map<number, Camellon>>(new Map())
  const [locations, setLocations] = useState<MapLocation[]>([])
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [locationFilter, setLocationFilter] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState<string | null>(null)
  const [dateTo, setDateTo] = useState<string | null>(null)

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

  return (
    <div className="flex flex-1">
      {/* Left: Map */}
      <div className="relative flex-1">
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

      {/* Right: Side Panel */}
      <div className="w-1/2 shrink-0">
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
