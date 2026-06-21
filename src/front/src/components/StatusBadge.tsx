import { Badge } from "@/components/ui/badge"
import type { RowStatus } from "@/lib/recordingFormat"

/** Upload-state badge shared by the recordings and sessions tables. */
export function StatusBadge({ status }: { status: RowStatus }) {
  switch (status) {
    case "active":
      return <Badge variant="destructive">grabando</Badge>
    case "uploaded":
      return <Badge variant="default">subido</Badge>
    case "uploading":
      return <Badge variant="outline">subiendo</Badge>
    case "pending":
      return <Badge variant="secondary">pendiente</Badge>
    case "missing":
      return <Badge variant="outline">archivo perdido</Badge>
  }
}
