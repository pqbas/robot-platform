import { useCallback, useEffect, useState } from "react"
import { getDashboardStats, type DashboardFilters as Filters } from "@/api/dashboard"
import { getCamellones } from "@/api/camellones"
import type { Camellon, DashboardStats } from "@/types"
import DashboardFilters from "./components/DashboardFilters"
import KpiCards from "./components/KpiCards"
import TrendChart from "./components/TrendChart"
import CamellonBarChart from "./components/CamellonBarChart"
import ClassBarChart from "./components/ClassBarChart"

export default function DashboardPage() {
  const [filters, setFilters] = useState<Filters>({})
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [camellones, setCamellones] = useState<Camellon[]>([])
  const [classes, setClasses] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const fetchStats = useCallback(async (f: Filters) => {
    setLoading(true)
    try {
      const data = await getDashboardStats(f)
      setStats(data)
      // Derive unique classes from the unfiltered class breakdown
      if (!f.target_class) {
        setClasses(data.by_class.map((c) => c.target_class))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    getCamellones().then(setCamellones)
    fetchStats(filters)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchStats(filters)
  }, [filters, fetchStats])

  return (
    <div className="flex-1 overflow-auto space-y-4 p-4 md:space-y-6 md:p-6">
      <DashboardFilters
        filters={filters}
        onChange={setFilters}
        classes={classes}
        camellones={camellones}
      />

      {loading && !stats ? (
        <p className="text-muted-foreground py-20 text-center">Cargando...</p>
      ) : stats ? (
        <>
          <KpiCards kpis={stats.kpis} />
          <TrendChart data={stats.daily_trend} />
          <div className="grid gap-4 md:grid-cols-2">
            <CamellonBarChart data={stats.by_camellon} />
            <ClassBarChart data={stats.by_class} />
          </div>
        </>
      ) : null}
    </div>
  )
}
