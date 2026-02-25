import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const CLASSES = ["person", "arandano", "caja"]

type ClassSelectorProps = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export default function ClassSelector({
  value,
  onChange,
  disabled,
}: ClassSelectorProps) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-32 md:w-40">
        <SelectValue placeholder="Clase" />
      </SelectTrigger>
      <SelectContent>
        {CLASSES.map((cls) => (
          <SelectItem key={cls} value={cls}>
            {cls}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
