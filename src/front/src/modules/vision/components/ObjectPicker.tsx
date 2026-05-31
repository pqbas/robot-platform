import { useEffect, useState } from "react"
import { getAvailableLabels, selectLabel, type AvailableLabelItem } from "@/api/vision"
import { apiFetch } from "@/api/client"
import { Button } from "@/components/ui/button"

type ObjectPickerProps = {
  onSelect: (label: string) => void
}

export default function ObjectPicker({ onSelect }: ObjectPickerProps) {
  const [labels, setLabels] = useState<AvailableLabelItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selecting, setSelecting] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  function fetchLabels() {
    setLoading(true)
    getAvailableLabels()
      .then(setLabels)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchLabels()
  }, [])

  async function handleSelect(item: AvailableLabelItem) {
    setSelecting(item.label)
    try {
      await selectLabel(item.label, item.model_filename)
      onSelect(item.label)
    } finally {
      setSelecting(null)
    }
  }

  async function handleForcePull() {
    setSyncing(true)
    try {
      await apiFetch("/api/sync/pull", { method: "POST" })
      fetchLabels()
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Cargando etiquetas...
      </div>
    )
  }

  if (labels.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
        <p>No hay modelos asignados a este robot</p>
        <Button variant="outline" size="sm" onClick={handleForcePull} disabled={syncing}>
          {syncing ? "Sincronizando..." : "Sincronizar ahora"}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">¿Qué quieres detectar?</h2>
        <Button variant="ghost" size="sm" onClick={handleForcePull} disabled={syncing} title="Sincronizar modelos">
          {syncing ? "..." : "↻"}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-4 w-full max-w-sm">
        {labels.map((item) => (
          <button
            key={`${item.model_filename}-${item.label}`}
            onClick={() => handleSelect(item)}
            disabled={selecting !== null}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-card p-6 text-card-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="text-lg font-medium capitalize">{item.label}</span>
            {selecting === item.label && (
              <span className="text-xs text-muted-foreground">Cargando...</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
