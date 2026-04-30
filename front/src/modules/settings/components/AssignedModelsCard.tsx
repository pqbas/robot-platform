import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  type EngineStatus,
  type LocalModel,
  getLocalModels,
  setTensorRT,
} from "@/api/models"
import { ApiError } from "@/api/client"

const POLL_INTERVAL_MS = 5000

const STATUS_LABEL: Record<EngineStatus, string> = {
  pytorch: "PyTorch",
  pending: "En cola",
  converting: "Convirtiendo...",
  ready: "TensorRT FP16",
  error: "Error",
}

function StatusBadge({ status }: { status: EngineStatus }) {
  const label = STATUS_LABEL[status]
  switch (status) {
    case "ready":
      return (
        <Badge className="bg-green-600 hover:bg-green-600 text-white">
          {label}
        </Badge>
      )
    case "converting":
    case "pending":
      return (
        <Badge className="bg-yellow-500 hover:bg-yellow-500 text-black">
          {label}
        </Badge>
      )
    case "error":
      return <Badge variant="destructive">{label}</Badge>
    case "pytorch":
    default:
      return <Badge variant="secondary">{label}</Badge>
  }
}

function ToggleButton({
  enabled,
  busy,
  onClick,
}: {
  enabled: boolean
  busy: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant={enabled ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      disabled={busy}
      className="min-w-[88px]"
    >
      {enabled ? "TensorRT" : "PyTorch"}
    </Button>
  )
}

export default function AssignedModelsCard() {
  const [models, setModels] = useState<LocalModel[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function refresh() {
    try {
      const items = await getLocalModels()
      setModels(items)
    } catch (err) {
      // 404 in server mode is expected; treat as "no models card".
      if (err instanceof ApiError && err.status === 404) {
        setModels([])
      } else {
        console.warn("Failed to fetch local models", err)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    const needsPoll = models.some(
      (m) => m.engine_status === "converting" || m.engine_status === "pending",
    )
    if (!needsPoll) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }
    if (intervalRef.current) return
    intervalRef.current = setInterval(refresh, POLL_INTERVAL_MS)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [models])

  async function handleToggle(model: LocalModel, nextEnabled: boolean) {
    setBusy((b) => ({ ...b, [model.uuid]: true }))
    // Optimistic UI: flip the status to converting (or pytorch) immediately.
    const optimistic: EngineStatus = nextEnabled ? "converting" : "pytorch"
    setModels((ms) =>
      ms.map((m) =>
        m.uuid === model.uuid
          ? {
              ...m,
              tensorrt_enabled: nextEnabled,
              engine_status: optimistic,
              engine_error: null,
            }
          : m,
      ),
    )
    try {
      const result = await setTensorRT(model.uuid, nextEnabled)
      setModels((ms) =>
        ms.map((m) =>
          m.uuid === model.uuid
            ? { ...m, engine_status: result.engine_status }
            : m,
        ),
      )
    } catch (err) {
      // Revert optimistic update.
      setModels((ms) =>
        ms.map((m) => (m.uuid === model.uuid ? model : m)),
      )
      if (err instanceof ApiError && err.status === 409) {
        toast.error("Conversión en curso, espera a que termine")
      } else {
        const msg =
          err instanceof Error ? err.message : "Error al actualizar TensorRT"
        toast.error(msg)
      }
    } finally {
      setBusy((b) => ({ ...b, [model.uuid]: false }))
    }
  }

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground">
        Cargando modelos asignados...
      </div>
    )
  }

  if (models.length === 0) return null

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Modelos asignados</h2>
        <p className="text-xs text-muted-foreground">
          Activa TensorRT para acelerar la inferencia en este robot. La
          conversión se ejecuta localmente y puede tardar varios minutos.
        </p>
      </div>
      <div className="space-y-2">
        {models.map((m, idx) => (
          <div key={m.uuid}>
            {idx > 0 && <Separator className="mb-2" />}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.filename}</p>
                {m.engine_error && m.engine_status === "error" && (
                  <p className="mt-0.5 truncate text-xs text-destructive">
                    {m.engine_error}
                  </p>
                )}
              </div>
              <StatusBadge status={m.engine_status} />
              {m.engine_status === "error" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleToggle(m, true)}
                  disabled={busy[m.uuid]}
                >
                  Reintentar
                </Button>
              ) : (
                <ToggleButton
                  enabled={m.tensorrt_enabled}
                  busy={!!busy[m.uuid]}
                  onClick={() => handleToggle(m, !m.tensorrt_enabled)}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
