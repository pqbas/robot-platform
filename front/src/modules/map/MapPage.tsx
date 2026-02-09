import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import type { CamellonGeoSummary } from "@/types"
import { getGeoSummary, updateLocation } from "@/api/camellones"
import GoogleMap from "./components/GoogleMap"
import InfoPanel from "./components/InfoPanel"
import UnlocatedList from "./components/UnlocatedList"

export default function MapPage() {
  const [camellones, setCamellones] = useState<CamellonGeoSummary[]>([])
  const [selected, setSelected] = useState<CamellonGeoSummary | null>(null)
  const [locatingId, setLocatingId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await getGeoSummary()
      setCamellones(data)
    } catch (e) {
      console.error("Error loading geo summary:", e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const unlocated = camellones.filter((c) => c.lat == null || c.lng == null)

  const handleMarkerClick = useCallback((c: CamellonGeoSummary) => {
    setSelected(c)
  }, [])

  const handleMapClick = useCallback(
    async (lat: number, lng: number) => {
      if (locatingId == null) return
      try {
        await updateLocation(locatingId, lat, lng)
        toast.success("Ubicacion asignada")
        setLocatingId(null)
        load()
      } catch (e) {
        toast.error(
          "Error al asignar ubicacion: " +
            (e instanceof Error ? e.message : "desconocido"),
        )
      }
    },
    [locatingId, load],
  )

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Cargando mapa...</p>
      </div>
    )
  }

  return (
    <div className="relative flex flex-1">
      <GoogleMap
        camellones={camellones}
        locatingId={locatingId}
        onMarkerClick={handleMarkerClick}
        onMapClick={handleMapClick}
      />

      {selected && (
        <InfoPanel camellon={selected} onClose={() => setSelected(null)} />
      )}

      <UnlocatedList
        camellones={unlocated}
        locatingId={locatingId}
        onLocate={setLocatingId}
      />

      {locatingId != null && (
        <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
          Haz click en el mapa para ubicar el camellon
        </div>
      )}
    </div>
  )
}
