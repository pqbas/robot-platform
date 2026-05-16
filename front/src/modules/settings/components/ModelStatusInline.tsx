import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import {
  type EngineStatus,
  type LocalModel,
  getLocalModels,
  setTensorRT,
} from "@/api/models"
import { ApiError } from "@/api/client"
import { cn } from "@/lib/utils"

const POLL_INTERVAL_MS = 5000

type ModeOption = {
  key: "pytorch" | "tensorrt"
  label: string
  sublabel?: string
  active: boolean
  disabled: boolean
  onClick: () => void
}

function InferenceOption({ label, sublabel, active, disabled, onClick }: Omit<ModeOption, "key">) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-primary-foreground" : "bg-muted-foreground/50")} />
      <span>{label}</span>
      {sublabel && <span className="opacity-60">{sublabel}</span>}
    </button>
  )
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

  useEffect(() => { refresh() }, [])

  const current = filename
    ? models.find((m) => m.filename === filename) ?? null
    : null

  useEffect(() => {
    const needsPoll =
      current &&
      (current.engine_status === "converting" || current.engine_status === "pending")
    if (!needsPoll) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      return
    }
    if (intervalRef.current) return
    intervalRef.current = setInterval(refresh, POLL_INTERVAL_MS)
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    }
  }, [current])

  async function handleToggle(nextEnabled: boolean) {
    if (!current) return
    setBusy(true)
    const optimistic: EngineStatus = nextEnabled ? "converting" : "pytorch"
    setModels((ms) =>
      ms.map((m) =>
        m.uuid === current.uuid
          ? { ...m, tensorrt_enabled: nextEnabled, engine_status: optimistic, engine_error: null }
          : m,
      ),
    )
    try {
      const result = await setTensorRT(current.uuid, nextEnabled)
      setModels((ms) =>
        ms.map((m) => m.uuid === current.uuid ? { ...m, engine_status: result.engine_status } : m),
      )
    } catch (err) {
      setModels((ms) => ms.map((m) => (m.uuid === current.uuid ? current : m)))
      if (err instanceof ApiError && err.status === 409) {
        toast.error("Conversión en curso, espera a que termine")
      } else {
        toast.error(err instanceof Error ? err.message : "Error al actualizar TensorRT")
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

  const isConverting = current.engine_status === "converting" || current.engine_status === "pending"
  const trtReady = current.engine_status === "ready"
  const trtError = current.engine_status === "error"

  let trtSublabel: string | undefined
  if (isConverting) trtSublabel = "convirtiendo..."
  else if (trtError) trtSublabel = "error"

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <InferenceOption
          label="PyTorch"
          active={!current.tensorrt_enabled}
          disabled={busy}
          onClick={() => current.tensorrt_enabled && handleToggle(false)}
        />
        <InferenceOption
          label="TensorRT"
          sublabel={trtSublabel}
          active={current.tensorrt_enabled && trtReady}
          disabled={busy || isConverting}
          onClick={() => !current.tensorrt_enabled && !isConverting && handleToggle(true)}
        />
      </div>
      {trtError && current.engine_error && (
        <p className="text-xs text-destructive truncate">{current.engine_error}</p>
      )}
    </div>
  )
}
