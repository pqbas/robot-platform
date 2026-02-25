import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Camellon } from "@/types"
import type { DashboardFilters as Filters } from "@/api/dashboard"

type Props = {
  filters: Filters
  onChange: (filters: Filters) => void
  classes: string[]
  camellones: Camellon[]
}

export default function DashboardFilters({ filters, onChange, classes, camellones }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })

  return (
    <div className="grid grid-cols-2 items-end gap-3 md:flex md:flex-wrap md:gap-4">
      <div className="space-y-1">
        <Label className="text-xs">Desde</Label>
        <Input
          type="date"
          className="h-9 w-full md:w-40"
          value={filters.from ?? ""}
          onChange={(e) => set({ from: e.target.value || undefined })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Hasta</Label>
        <Input
          type="date"
          className="h-9 w-full md:w-40"
          value={filters.to ?? ""}
          onChange={(e) => set({ to: e.target.value || undefined })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Clase</Label>
        <Select
          value={filters.target_class ?? "__all__"}
          onValueChange={(v) => set({ target_class: v === "__all__" ? undefined : v })}
        >
          <SelectTrigger className="h-9 w-full md:w-36">
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas</SelectItem>
            {classes.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Camellón</Label>
        <Select
          value={filters.camellon_id != null ? String(filters.camellon_id) : "__all__"}
          onValueChange={(v) =>
            set({ camellon_id: v === "__all__" ? undefined : Number(v) })
          }
        >
          <SelectTrigger className="h-9 w-full md:w-44">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos</SelectItem>
            {camellones.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="col-span-2 h-9 md:col-span-1"
        onClick={() => onChange({})}
      >
        Limpiar
      </Button>
    </div>
  )
}
