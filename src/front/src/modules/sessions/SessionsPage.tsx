import { useCallback, useEffect, useMemo, useState } from "react"
import type { Session, Camellon, Empresa, Fundo } from "@/types"
import { getAllCamellones } from "@/api/camellones"
import { getEmpresas, getFundos } from "@/api/admin"
import { getSessions, getSessionDevices } from "@/api/sessions"
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
import { useAppMode } from "@/context/AppModeContext"
import SessionsTable from "@/modules/map/components/SessionsTable"

export default function SessionsPage() {
  const { mode } = useAppMode()
  const [sessions, setSessions] = useState<Session[]>([])
  const [camellones, setCamellones] = useState<Map<number, Camellon>>(new Map())
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [fundos, setFundos] = useState<Fundo[]>([])
  const [devices, setDevices] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [empresaFilter, setEmpresaFilter] = useState("all")
  const [fundoFilter, setFundoFilter] = useState("all")
  const [classFilter, setClassFilter] = useState("all")
  const [deviceFilter, setDeviceFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState<string | null>(null)
  const [dateTo, setDateTo] = useState<string | null>(null)

  const loadBase = useCallback(async () => {
    try {
      const [camData, empData, fundoData, devData] = await Promise.all([
        getAllCamellones(),
        getEmpresas(),
        getFundos(),
        getSessionDevices(),
      ])
      setCamellones(new Map(camData.map((c) => [c.id, c])))
      setEmpresas(empData)
      setFundos(fundoData)
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

  // Poll while an offline count OR classification is still running so the
  // "procesando…"/"clasificando…" badges flip to their final state without a
  // manual reload (worker → poller → DB is async). Classification chains AFTER
  // the count, so we must keep polling on 'classifying' too — otherwise the poll
  // stops the moment the count finishes and the ripeness badge stays stuck.
  const hasPending = sessions.some(
    (s) =>
      s.count_status === "counting" ||
      s.count_status === "pending" ||
      s.classification_status === "classifying",
  )
  useEffect(() => {
    if (!hasPending) return
    const id = setInterval(loadSessions, 3000)
    return () => clearInterval(id)
  }, [hasPending, loadSessions])

  // session.camellon_id -> fundo_uuid, via camellon.fundo_uuid
  const fundoByCamellonId = useMemo(() => {
    const map = new Map<number, string>()
    for (const [id, cam] of camellones) {
      if (cam.fundo_uuid) map.set(id, cam.fundo_uuid)
    }
    return map
  }, [camellones])

  // session.camellon_id -> empresa_uuid, via camellon.fundo_uuid -> fundo.empresa_uuid
  const empresaByCamellonId = useMemo(() => {
    const fundoToEmpresa = new Map(fundos.map((f) => [f.uuid, f.empresa_uuid]))
    const map = new Map<number, string>()
    for (const [id, cam] of camellones) {
      const empresaUuid = cam.fundo_uuid
        ? fundoToEmpresa.get(cam.fundo_uuid)
        : undefined
      if (empresaUuid) map.set(id, empresaUuid)
    }
    return map
  }, [camellones, fundos])

  // Cascade Empresa → Fundo → Clase: each level's options derive from the
  // session set already narrowed by the parent filters, so a filter can never
  // offer a value that yields zero results. Empresa is the top level, so its
  // options come from all sessions (not the synced catalog, which may list
  // empresas with no captured sessions).
  const empresaOptions = useMemo(() => {
    const empresaById = new Map(empresas.map((e) => [e.uuid, e]))
    const seen = new Map<string, string>()
    for (const s of sessions) {
      const empresaUuid =
        s.camellon_id == null ? undefined : empresaByCamellonId.get(s.camellon_id)
      if (!empresaUuid || seen.has(empresaUuid)) continue
      const e = empresaById.get(empresaUuid)
      seen.set(empresaUuid, e?.name ?? empresaUuid)
    }
    return Array.from(seen, ([uuid, name]) => ({ uuid, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }, [sessions, empresas, empresaByCamellonId])

  const sessionsByEmpresa = useMemo(() => {
    if (empresaFilter === "all") return sessions
    return sessions.filter(
      (s) =>
        s.camellon_id != null &&
        empresaByCamellonId.get(s.camellon_id) === empresaFilter,
    )
  }, [sessions, empresaFilter, empresaByCamellonId])

  // Fundos referenced by the empresa-narrowed sessions (built from the
  // sessions so it never lists fundos with no captured sessions).
  const fundoOptions = useMemo(() => {
    const fundoById = new Map(fundos.map((f) => [f.uuid, f]))
    const seen = new Map<string, string>()
    for (const s of sessionsByEmpresa) {
      const fundoUuid =
        s.camellon_id == null ? undefined : fundoByCamellonId.get(s.camellon_id)
      if (!fundoUuid || seen.has(fundoUuid)) continue
      const f = fundoById.get(fundoUuid)
      seen.set(fundoUuid, f?.name ?? fundoUuid)
    }
    return Array.from(seen, ([uuid, name]) => ({ uuid, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }, [sessionsByEmpresa, fundos, fundoByCamellonId])

  const sessionsByFundo = useMemo(() => {
    if (fundoFilter === "all") return sessionsByEmpresa
    return sessionsByEmpresa.filter(
      (s) =>
        s.camellon_id != null &&
        fundoByCamellonId.get(s.camellon_id) === fundoFilter,
    )
  }, [sessionsByEmpresa, fundoFilter, fundoByCamellonId])

  // Classes present in the empresa+fundo-narrowed sessions.
  const targetClasses = useMemo(() => {
    return Array.from(new Set(sessionsByFundo.map((s) => s.target_class))).sort()
  }, [sessionsByFundo])

  const filteredSessions = useMemo(() => {
    if (classFilter === "all") return sessionsByFundo
    return sessionsByFundo.filter((s) => s.target_class === classFilter)
  }, [sessionsByFundo, classFilter])

  // When a parent filter changes and the current child selection is no longer
  // among its options, reset the child to "all" so the list never goes empty
  // from a stale selection (e.g. fundo of another empresa).
  useEffect(() => {
    if (
      empresaFilter !== "all" &&
      !empresaOptions.some((e) => e.uuid === empresaFilter)
    ) {
      setEmpresaFilter("all")
    }
  }, [empresaOptions, empresaFilter])

  useEffect(() => {
    if (fundoFilter !== "all" && !fundoOptions.some((f) => f.uuid === fundoFilter)) {
      setFundoFilter("all")
    }
  }, [fundoOptions, fundoFilter])

  useEffect(() => {
    if (classFilter !== "all" && !targetClasses.includes(classFilter)) {
      setClassFilter("all")
    }
  }, [targetClasses, classFilter])

  const hasActiveFilters =
    empresaFilter !== "all" ||
    fundoFilter !== "all" ||
    classFilter !== "all" ||
    deviceFilter !== "all" ||
    dateFrom != null ||
    dateTo != null

  function clearAllFilters() {
    setEmpresaFilter("all")
    setFundoFilter("all")
    setClassFilter("all")
    setDeviceFilter("all")
    setDateFrom(null)
    setDateTo(null)
  }


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
        {mode === "server" && (
          <div className="space-y-1 md:min-w-0 md:flex-1">
            <Label className="text-xs">Empresa</Label>
            <Select value={empresaFilter} onValueChange={setEmpresaFilter}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {empresaOptions.map((emp) => (
                  <SelectItem key={emp.uuid} value={emp.uuid}>{emp.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {mode === "server" && (
          <div className="space-y-1 md:min-w-0 md:flex-1">
            <Label className="text-xs">Fundo</Label>
            <Select value={fundoFilter} onValueChange={setFundoFilter}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {fundoOptions.map((f) => (
                  <SelectItem key={f.uuid} value={f.uuid}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

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
            const fresh = await getAllCamellones()
            setCamellones(new Map(fresh.map((c) => [c.id, c])))
          }}
          onSessionDeleted={(id) => {
            setSessions((prev) => prev.filter((s) => s.id !== id))
            setSelectedSession((cur) => (cur?.id === id ? null : cur))
          }}
        />
      </div>
    </div>
  )
}
