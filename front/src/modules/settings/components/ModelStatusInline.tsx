import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

type Props = {
  filename: string | null
}

export default function ModelStatusInline({ filename }: Props) {
  const [models, setModels] = useState<LocalModel[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function refresh() {
    try {
      const items = await getLocalModels()
      setModels(items)
    } catch (err) {
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

  const current = filename
    ? models.find((m) => m.filename === filename) ?? null
    : null

  useEffect(() => {
    const needsPoll =
      current &&
      (current.engine_status === "converting" ||
        current.engine_status === "pending")
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
  }, [current])

  async function handleToggle(nextEnabled: boolean) {
    if (!current) return
    setBusy(true)
    const optimistic: EngineStatus = nextEnabled ? "converting" : "pytorch"
    setModels((ms) =>
      ms.map((m) =>
        m.uuid === current.uuid
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
      const result = await setTensorRT(current.uuid, nextEnabled)
      setModels((ms) =>
        ms.map((m) =>
          m.uuid === current.uuid
            ? { ...m, engine_status: result.engine_status }
            : m,
        ),
      )
    } catch (err) {
      setModels((ms) =>
        ms.map((m) => (m.uuid === current.uuid ? current : m)),
      )
      if (err instanceof ApiError && err.status === 409) {
        toast.error("Conversión en curso, espera a que termine")
      } else {
        const msg =
          err instanceof Error ? err.message : "Error al actualizar TensorRT"
        toast.error(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  if (loading || !filename) return null
  if (!current) {
    return (
      <p className="text-xs text-muted-foreground">
        Modelo <span className="font-mono">{filename}</span> no encontrado en este robot.
      </p>
    )
  }

  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">Modelo</p>
          <p className="truncate text-sm font-medium">{current.filename}</p>
        </div>
        <StatusBadge status={current.engine_status} />
        {current.engine_status === "error" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => handleToggle(true)}
            disabled={busy}
          >
            Reintentar
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant={current.tensorrt_enabled ? "default" : "outline"}
            onClick={() => handleToggle(!current.tensorrt_enabled)}
            disabled={busy}
            className="min-w-[88px]"
          >
            {current.tensorrt_enabled ? "TensorRT" : "PyTorch"}
          </Button>
        )}
      </div>
      {current.engine_status === "error" && current.engine_error && (
        <p className="mt-1 truncate text-xs text-destructive">
          {current.engine_error}
        </p>
      )}
    </div>
  )
}
