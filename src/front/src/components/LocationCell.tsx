/**
 * Single-line location cell shared by the sessions and recordings tables.
 *
 * Joins the available levels of the empresa → fundo → camellon hierarchy with
 * " · " on one line; missing levels are omitted. Truncates with a title
 * tooltip so a long path never wraps to a second line.
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
  const path = [empresa, fundo, camellon].filter(Boolean).join(" · ")
  return (
    <span className="block truncate text-xs" title={path}>
      {path}
    </span>
  )
}
