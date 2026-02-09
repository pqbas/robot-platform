import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

type DateFilterProps = {
  dateFrom: string | null
  dateTo: string | null
  onChange: (from: string | null, to: string | null) => void
}

export default function DateFilter({ dateFrom, dateTo, onChange }: DateFilterProps) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        className="h-8 w-36 text-xs"
        placeholder="Desde"
        value={dateFrom ?? ""}
        onChange={(e) => onChange(e.target.value || null, dateTo)}
      />
      <Input
        type="date"
        className="h-8 w-36 text-xs"
        placeholder="Hasta"
        value={dateTo ?? ""}
        onChange={(e) => onChange(dateFrom, e.target.value || null)}
      />
      {(dateFrom || dateTo) && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() => onChange(null, null)}
        >
          Limpiar
        </Button>
      )}
    </div>
  )
}
