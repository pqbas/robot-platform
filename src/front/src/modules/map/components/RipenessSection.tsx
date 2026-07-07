import { useEffect, useState } from "react"
import { toast } from "sonner"
import type { AppMode, RecordingClassifications } from "@/types"
import {
  getCropImageUrl,
  getRecordingClassifications,
  reclassifyRecording,
} from "@/api/recordings"
import { Button } from "@/components/ui/button"
import { Loader2, RefreshCw } from "lucide-react"

type Props = {
  recordingUuid: string
  mode: AppMode | null
}

// How many thumbnails to render before the "ver todas" reveal — a session can
// have hundreds of crops and mounting them all at once janks the panel.
const INITIAL_GALLERY = 60

// Deterministic palette keyed by class index (labels come from the model, so we
// can't hardcode names). Sorted-label order gives a stable color per class.
const PALETTE = [
  "#22c55e", // green
  "#eab308", // amber
  "#ef4444", // red
  "#3b82f6", // blue
  "#a855f7", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
]

function colorForLabel(sortedLabels: string[], label: string): string {
  const i = sortedLabels.indexOf(label)
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length]
}

export default function RipenessSection({ recordingUuid, mode }: Props) {
  const [data, setData] = useState<RecordingClassifications | null>(null)
  const [loading, setLoading] = useState(true)
  const [reclassifying, setReclassifying] = useState(false)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setShowAll(false)
    getRecordingClassifications(recordingUuid)
      .then((d) => {
        if (alive) setData(d)
      })
      .catch(() => {
        if (alive) setData(null)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [recordingUuid])

  const handleReclassify = async () => {
    setReclassifying(true)
    try {
      await reclassifyRecording(recordingUuid)
      toast.success("Re-clasificación encolada")
      const d = await getRecordingClassifications(recordingUuid)
      setData(d)
    } catch (e) {
      // FastAPI errors come back as a JSON {"detail": "..."} body; unwrap it for
      // a readable toast (e.g. 409 "La categoría no tiene un clasificador…").
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

  if (loading) {
    return (
      <div className="flex items-center gap-2 border-t pt-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Cargando madurez…
      </div>
    )
  }

  if (!data) return null

  // Opt-in per category: nothing to show when the category has no classifier or
  // the recording was never classified. Stay silent (don't imply "missing").
  if (data.status === "none" || (data.status === "done" && data.crops.length === 0)) {
    return null
  }

  const isRobot = mode === "robot"

  const header = (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold">Madurez</h3>
      {isRobot && (
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
  )

  if (data.status === "classifying") {
    return (
      <div className="space-y-2 border-t pt-3">
        {header}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Clasificando madurez…
        </div>
      </div>
    )
  }

  if (data.status === "error") {
    return (
      <div className="space-y-2 border-t pt-3">
        {header}
        <p className="text-sm text-destructive">
          {data.error ?? "Error al clasificar la madurez"}
        </p>
      </div>
    )
  }

  // status === "done" with crops.
  const total = Object.values(data.distribution).reduce((a, b) => a + b, 0)
  const sortedLabels = Object.keys(data.distribution).sort()
  const visibleCrops = showAll
    ? data.crops
    : data.crops.slice(0, INITIAL_GALLERY)

  return (
    <div className="space-y-3 border-t pt-3">
      {header}

      <div className="space-y-1.5">
        {sortedLabels.map((label) => {
          const n = data.distribution[label]
          const pct = total > 0 ? (n / total) * 100 : 0
          const color = colorForLabel(sortedLabels, label)
          return (
            <div key={label} className="text-xs">
              <div className="mb-0.5 flex justify-between">
                <span>{label}</span>
                <span className="text-muted-foreground">
                  {n} · {Math.round(pct)}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded bg-muted">
                <div
                  className="h-full rounded"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {visibleCrops.map((c) => (
          <div key={`${c.track_id}-${c.crop}`} className="text-center">
            <img
              src={getCropImageUrl(recordingUuid, c.crop)}
              loading="lazy"
              width={80}
              height={80}
              alt={c.label ?? "recorte"}
              className="h-20 w-full rounded object-cover"
              style={{
                borderBottom: c.label
                  ? `3px solid ${colorForLabel(sortedLabels, c.label)}`
                  : undefined,
              }}
            />
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {c.label ?? "—"}
              {c.confidence != null && ` ${Math.round(c.confidence * 100)}%`}
            </div>
          </div>
        ))}
      </div>

      {!showAll && data.crops.length > INITIAL_GALLERY && (
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={() => setShowAll(true)}
        >
          Ver todas ({data.crops.length})
        </Button>
      )}
    </div>
  )
}
