import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import type { Session, Camellon } from "@/types"
import { getSessions } from "@/api/sessions"
import { getCamellones } from "@/api/camellones"
import SessionsTable from "./components/SessionsTable"
import SessionDetail from "./components/SessionDetail"

export default function RegistryPage() {
  const [searchParams] = useSearchParams()
  const filterCamellon = searchParams.get("camellon")

  const [sessions, setSessions] = useState<Session[]>([])
  const [camellones, setCamellones] = useState<Map<number, Camellon>>(new Map())
  const [selected, setSelected] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [sessData, camData] = await Promise.all([
          getSessions(),
          getCamellones(),
        ])
        setSessions(sessData)
        setCamellones(new Map(camData.map((c) => [c.id, c])))
      } catch (e) {
        console.error("Error loading registry data:", e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filteredSessions = useMemo(() => {
    if (!filterCamellon) return sessions
    const id = Number(filterCamellon)
    return sessions.filter((s) => s.camellon_id === id)
  }, [sessions, filterCamellon])

  const camellonName = selected
    ? (camellones.get(selected.camellon_id)?.nombre ?? `#${selected.camellon_id}`)
    : ""

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 gap-4 p-4">
      <div className="flex-1 overflow-auto">
        {filterCamellon && (
          <p className="mb-2 text-sm text-muted-foreground">
            Filtrando por camellon: {camellones.get(Number(filterCamellon))?.nombre ?? filterCamellon}
          </p>
        )}
        <SessionsTable
          sessions={filteredSessions}
          camellones={camellones}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
        />
      </div>

      {selected && (
        <div className="w-80 shrink-0">
          <SessionDetail session={selected} camellonName={camellonName} />
        </div>
      )}
    </div>
  )
}
