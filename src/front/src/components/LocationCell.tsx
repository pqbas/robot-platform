/**
 * Stacked location cell shared by the sessions and recordings tables.
 *
 * Shows the camellon as the primary line and "Empresa · Fundo" muted below it,
 * so a single "Ubicación" column carries the full empresa → fundo → camellon
 * hierarchy. Any missing parent level is simply omitted.
 */
export function LocationCell({
  camellon,
  fundo,
  empresa,
}: {
  camellon: string | null
  fundo: string | null
  empresa: string | null
}) {
  if (!camellon) {
    return (
      <span className="italic text-muted-foreground text-xs">Sin ubicación</span>
    )
  }
  const parent = [empresa, fundo].filter(Boolean).join(" · ")
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-sm">{camellon}</span>
      {parent && (
        <span className="text-xs text-muted-foreground">{parent}</span>
      )}
    </div>
  )
}
