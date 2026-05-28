import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Session, Camellon, MapLocation } from "@/types"
import { getCamellones } from "@/api/camellones"
import { getSessions, getSessionDevices } from "@/api/sessions"
import { getLocations } from "@/api/locations"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import SessionsTable from "@/modules/map/components/SessionsTable"
import SessionDetail from "@/modules/map/components/SessionDetail"

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [camellones, setCamellones] = useState<Map<number, Camellon>>(new Map())
  const [locations, setLocations] = useState<MapLocation[]>([])
  const [devices, setDevices] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [locationFilter, setLocationFilter] = useState("all")
  const [classFilter, setClassFilter] = useState("all")
  const [deviceFilter, setDeviceFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState<string | null>(null)
  const [dateTo, setDateTo] = useState<string | null>(null)

  const loadBase = useCallback(async () => {
    try {
      const [camData, locData, devData] = await Promise.all([
        getCamellones(),
        getLocations(),
        getSessionDevices(),
      ])
      setCamellones(new Map(camData.map((c) => [c.id, c])))
      setLocations(locData)
      setDevices(devData)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSessions = useCallback(async () => {
    try {
      const params: { from?: string; to?: string; device_id?: string } = {}
      if (dateFrom) params.from = dateFrom
      if (dateTo) params.to = dateTo
      if (deviceFilter !== "all") params.device_id = deviceFilter
      setSessions(await getSessions(params))
    } catch (e) {
      console.error(e)
    }
  }, [dateFrom, dateTo, deviceFilter])

  useEffect(() => { loadBase() }, [loadBase])
  useEffect(() => { loadSessions() }, [loadSessions])

  const camellonIdsByLocation = useMemo(() => {
    const map = new Map<string, Set<number>>()
    for (const [id, cam] of camellones) {
      const locLabel = locations.find((l) => l.label === cam.nombre)?.label
      if (locLabel) {
        if (!map.has(locLabel)) map.set(locLabel, new Set())
        map.get(locLabel)!.add(id)
      }
    }
    return map
  }, [camellones, locations])

  const targetClasses = useMemo(() => {
    return Array.from(new Set(sessions.map((s) => s.target_class))).sort()
  }, [sessions])

  const filteredSessions = useMemo(() => {
    let result = sessions
    if (locationFilter !== "all") {
      const ids = camellonIdsByLocation.get(locationFilter)
      result = ids ? result.filter((s) => ids.has(s.camellon_id)) : []
    }
    if (classFilter !== "all") {
      result = result.filter((s) => s.target_class === classFilter)
    }
    return result
  }, [sessions, locationFilter, classFilter, camellonIdsByLocation])

  const hasActiveFilters =
    locationFilter !== "all" ||
    classFilter !== "all" ||
    deviceFilter !== "all" ||
    dateFrom != null ||
    dateTo != null

  function clearAllFilters() {
    setLocationFilter("all")
    setClassFilter("all")
    setDeviceFilter("all")
    setDateFrom(null)
    setDateTo(null)
  }

  const camellonName = selectedSession
    ? (camellones.get(selectedSession.camellon_id)?.nombre ?? `#${selectedSession.camellon_id}`)
    : ""

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Cargando...
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-4 overflow-auto p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Sesiones</h1>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={clearAllFilters}
          >
            Limpiar filtros
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 items-end gap-3 md:flex md:gap-4">
        <div className="space-y-1 md:min-w-0 md:flex-1">
          <Label className="text-xs">Ubicacion</Label>
          <Select value={locationFilter} onValueChange={setLocationFilter}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {locations.map((loc) => (
                <SelectItem key={loc.id} value={loc.label}>{loc.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 md:min-w-0 md:flex-1">
          <Label className="text-xs">Clase</Label>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {targetClasses.map((cls) => (
                <SelectItem key={cls} value={cls}>{cls}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {devices.length > 1 && (
          <div className="space-y-1 md:min-w-0 md:flex-1">
            <Label className="text-xs">Device</Label>
            <Select value={deviceFilter} onValueChange={setDeviceFilter}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {devices.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1 md:min-w-0 md:flex-1">
          <Label className="text-xs">Desde</Label>
          <Input
            type="date"
            className="h-9"
            value={dateFrom ?? ""}
            onChange={(e) => setDateFrom(e.target.value || null)}
          />
        </div>

        <div className="space-y-1 md:min-w-0 md:flex-1">
          <Label className="text-xs">Hasta</Label>
          <Input
            type="date"
            className="h-9"
            value={dateTo ?? ""}
            onChange={(e) => setDateTo(e.target.value || null)}
          />
        </div>
      </div>

      <div className="rounded-md border">
        <SessionsTable
          sessions={filteredSessions}
          camellones={camellones}
          selectedId={selectedSession?.id ?? null}
          onSelect={setSelectedSession}
          onSessionUpdated={async (updated) => {
            setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
            const fresh = await getCamellones()
            setCamellones(new Map(fresh.map((c) => [c.id, c])))
          }}
        />
      </div>

      {selectedSession && (
        <>
          <Separator />
          <SessionDetail session={selectedSession} camellonName={camellonName} />
        </>
      )}
    </div>
  )
}
