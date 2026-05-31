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
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.key}>
          <CardHeader className="px-2 pb-0 pt-0.5">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {item.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-0.5">
            <p className="text-4xl font-bold">
              {item.fmt ? item.fmt(kpis[item.key]) : kpis[item.key].toLocaleString()}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
