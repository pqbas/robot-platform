import { useEffect, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { toast } from "sonner"
import type { RecordingClassifications } from "@/types"
import {
  getCropImageUrl,
  getRecordingClassifications,
  reclassifyRecording,
} from "@/api/recordings"
import { useAppMode } from "@/context/AppModeContext"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, RefreshCw } from "lucide-react"

type Props = {
  recordingUuid: string | null
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Cap the initial gallery render, a session can have hundreds of crops.
const INITIAL_GALLERY = 60

export default function RipenessDialog({
  recordingUuid,
  title,
  open,
  onOpenChange,
}: Props) {
  const { mode } = useAppMode()
  const [data, setData] = useState<RecordingClassifications | null>(null)
  const [loading, setLoading] = useState(false)
  const [reclassifying, setReclassifying] = useState(false)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (!open || !recordingUuid) return
    let alive = true
    setLoading(true)
    setShowAll(false)
    getRecordingClassifications(recordingUuid)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [open, recordingUuid])

  const handleReclassify = async () => {
    if (!recordingUuid) return
    setReclassifying(true)
    try {
      await reclassifyRecording(recordingUuid)
      toast.success("Re-clasificación encolada")
      const d = await getRecordingClassifications(recordingUuid)
      setData(d)
    } catch (e) {
      let msg = "No se pudo re-clasificar"
      if (e instanceof Error && e.message) {
        try {
          msg = JSON.parse(e.message).detail ?? e.message
        } catch {
          msg = e.message
        }
      }
      toast.error(msg)
    } finally {
      setReclassifying(false)
    }
  }

  // Frequency-by-type: the bar height carries the magnitude, the x-axis label
  // carries identity → one fill for every bar (color encodes nothing). Sorted by
  // count so the chart reads as a ranking.
  const chartData = data
    ? Object.entries(data.distribution)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
    : []
  const total = chartData.reduce((acc, d) => acc + d.count, 0)
  const topType = chartData[0]?.type ?? null

  const isRobot = mode === "robot"
  const crops = data?.crops ?? []
  const visibleCrops = showAll ? crops : crops.slice(0, INITIAL_GALLERY)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle>{title}</DialogTitle>
            {isRobot && data && data.status !== "none" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                disabled={reclassifying || data.status === "classifying"}
                onClick={handleReclassify}
              >
                {reclassifying ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Re-clasificar
              </Button>
            )}
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Cargando clasificación…
          </div>
        ) : !data || data.status === "none" ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Esta sesión no tiene clasificación.
          </p>
        ) : data.status === "classifying" ? (
          <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Clasificando…
          </div>
        ) : data.status === "error" ? (
          <p className="py-12 text-center text-sm text-destructive">
            {data.error ?? "Error al clasificar"}
          </p>
        ) : crops.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Sin recortes clasificados.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Resumen: tipo dominante + total */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Tipo predominante:</span>
              {topType && <Badge variant="outline">{topType}</Badge>}
              <span className="ml-auto text-muted-foreground">
                {total} recortes
              </span>
            </div>

            {/* Frecuencia por tipo (freq en Y, tipo en X) */}
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ bottom: 24 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  className="stroke-border"
                />
                <XAxis
                  dataKey="type"
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={50}
                  className="text-xs"
                />
                <YAxis allowDecimals={false} className="text-xs" />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "var(--radius)",
                    color: "hsl(var(--card-foreground))",
                  }}
                />
                <Bar
                  dataKey="count"
                  fill="var(--color-chart-3, #f59e0b)"
                  radius={[4, 4, 0, 0]}
                  name="Cantidad"
                />
              </BarChart>
            </ResponsiveContainer>

            {/* Galería de recortes */}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {visibleCrops.map((c) => (
                <div key={`${c.track_id}-${c.crop}`} className="text-center">
                  <img
                    src={getCropImageUrl(recordingUuid!, c.crop)}
                    loading="lazy"
                    width={80}
                    height={80}
                    alt={c.label ?? "recorte"}
                    className="h-20 w-full rounded object-cover"
                  />
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {c.label ?? "-"}
                    {c.confidence != null &&
                      ` ${Math.round(c.confidence * 100)}%`}
                  </div>
                </div>
              ))}
            </div>

            {!showAll && crops.length > INITIAL_GALLERY && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => setShowAll(true)}
              >
                Ver todas ({crops.length})
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
