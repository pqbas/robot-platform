import { useMemo, useState } from "react"
import type { Session, Camellon, MapLocation } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import SessionsTable from "./SessionsTable"
import SessionDetail from "./SessionDetail"

type SidePanelProps = {
  sessions: Session[]
  camellones: Map<number, Camellon>
  locations: MapLocation[]
  locationFilter: string
  onLocationFilterChange: (value: string) => void
  selectedSession: Session | null
  dateFrom: string | null
  dateTo: string | null
  onSelectSession: (session: Session) => void
  onDateChange: (from: string | null, to: string | null) => void
}

export default function SidePanel({
  sessions,
  camellones,
  locations,
  locationFilter,
  onLocationFilterChange,
  selectedSession,
  dateFrom,
  dateTo,
  onSelectSession,
  onDateChange,
}: SidePanelProps) {
  const [classFilter, setClassFilter] = useState<string>("all")

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
    const classes = new Set(sessions.map((s) => s.target_class))
    return Array.from(classes).sort()
  }, [sessions])

  const filteredSessions = useMemo(() => {
    let result = sessions
    if (locationFilter !== "all") {
      const ids = camellonIdsByLocation.get(locationFilter)
      if (ids) {
        result = result.filter((s) => ids.has(s.camellon_id))
      } else {
        result = []
      }
    }
    if (classFilter !== "all") {
      result = result.filter((s) => s.target_class === classFilter)
    }
    return result
  }, [sessions, locationFilter, classFilter, camellonIdsByLocation])

  const hasActiveFilters =
    locationFilter !== "all" ||
    classFilter !== "all" ||
    dateFrom != null ||
    dateTo != null

  function clearAllFilters() {
    onLocationFilterChange("all")
    setClassFilter("all")
    onDateChange(null, null)
  }

  const camellonName = selectedSession
    ? (camellones.get(selectedSession.camellon_id)?.nombre ??
      `#${selectedSession.camellon_id}`)
    : ""

  return (
    <div className="flex h-full flex-col overflow-hidden border-l">
      <div className="flex min-h-0 flex-1 flex-col p-4">
        {/* Header */}
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h3 className="text-sm font-semibold">
            Sesiones
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              ({filteredSessions.length})
            </span>
          </h3>
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

        {/* Filters */}
        <div className="mb-4 flex items-end gap-1.5">
          <div className="min-w-0 flex-1 space-y-0.5">
            <Label className="text-xs text-muted-foreground">Ubicacion</Label>
            <Select value={locationFilter} onValueChange={onLocationFilterChange}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.label}>
                    {loc.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 flex-1 space-y-0.5">
            <Label className="text-xs text-muted-foreground">Clase</Label>
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {targetClasses.map((cls) => (
                  <SelectItem key={cls} value={cls}>
                    {cls}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 flex-1 space-y-0.5">
            <Label className="text-xs text-muted-foreground">Desde</Label>
            <Input
              type="date"
              className="h-7 text-xs"
              value={dateFrom ?? ""}
              onChange={(e) => onDateChange(e.target.value || null, dateTo)}
            />
          </div>

          <div className="min-w-0 flex-1 space-y-0.5">
            <Label className="text-xs text-muted-foreground">Hasta</Label>
            <Input
              type="date"
              className="h-7 text-xs"
              value={dateTo ?? ""}
              onChange={(e) => onDateChange(dateFrom, e.target.value || null)}
            />
          </div>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1">
          <SessionsTable
            sessions={filteredSessions}
            camellones={camellones}
            selectedId={selectedSession?.id ?? null}
            onSelect={onSelectSession}
          />
        </div>
      </div>

      {selectedSession && (
        <>
          <Separator />
          <div className="shrink-0 p-4">
            <SessionDetail
              session={selectedSession}
              camellonName={camellonName}
            />
          </div>
        </>
      )}
    </div>
  )
}
