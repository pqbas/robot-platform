import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  getCountingMethods,
  setCountingMethod,
  type CountingMethod,
  type CountingMethodValue,
} from "@/api/config"

// Per-object counting method (single | tiled). One row per object (model+class);
// default is single. Tiled splits the central strip into 2 tiles with independent
// trackers — better for blueberries. Persists immediately on change.
export default function CountingMethodsPanel() {
  const [items, setItems] = useState<CountingMethod[] | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    getCountingMethods()
      .then(setItems)
      .catch(() => toast.error("No se pudieron cargar los métodos por objeto"))
  }, [])

  const keyOf = (m: CountingMethod) => `${m.model_uuid}::${m.label}`

  const handleChange = async (m: CountingMethod, value: CountingMethodValue) => {
    const key = keyOf(m)
    setSavingKey(key)
    try {
      const updated = await setCountingMethod(m.model_uuid, m.label, value)
      setItems((prev) =>
        prev
          ? prev.map((it) => (keyOf(it) === key ? { ...it, method: updated.method } : it))
          : prev,
      )
    } catch {
      toast.error("No se pudo guardar el método")
    } finally {
      setSavingKey(null)
    }
  }

  if (items === null) {
    return <p className="text-sm text-muted-foreground">Cargando objetos…</p>
  }
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay objetos configurados para contar todavía.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {items.map((m) => {
        const key = keyOf(m)
        return (
          <div
            key={key}
            className="flex items-center justify-between gap-4 rounded-md border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium capitalize">{m.label}</p>
              <p className="truncate text-xs text-muted-foreground">
                {m.model_filename}
              </p>
            </div>
            <Select
              value={m.method}
              onValueChange={(v) => handleChange(m, v as CountingMethodValue)}
              disabled={savingKey === key}
            >
              <SelectTrigger className="w-40 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single</SelectItem>
                <SelectItem value="tiled">Tiled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )
      })}
    </div>
  )
}
