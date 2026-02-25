import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { DashboardKPIs } from "@/types"

type Props = { kpis: DashboardKPIs }

const items: { key: keyof DashboardKPIs; label: string; fmt?: (v: number) => string }[] = [
  { key: "total_count", label: "Total Conteos" },
  { key: "session_count", label: "Sesiones" },
  { key: "camellon_count", label: "Camellones" },
  { key: "avg_per_session", label: "Promedio / Sesión", fmt: (v) => v.toFixed(1) },
]

export default function KpiCards({ kpis }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.key}>
          <CardHeader className="px-4 pb-1 pt-4 md:px-6 md:pb-2 md:pt-6">
            <CardTitle className="text-muted-foreground text-xs font-medium md:text-sm">
              {item.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 md:px-6 md:pb-6">
            <p className="text-2xl font-bold md:text-3xl">
              {item.fmt ? item.fmt(kpis[item.key]) : kpis[item.key].toLocaleString()}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
