/**
 * Formatting + upload-status helpers for recordings, shared by the recordings
 * table and the sessions table (a session shows the duration/size/upload state
 * of its linked recording). Pure functions only — the matching <StatusBadge>
 * component lives in @/components/StatusBadge.
 */

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`
}

/** Date + time shown in the recordings and sessions tables (es locale). */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("es", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatSize(bytes: number | null): string {
  if (bytes == null || bytes === 0) return "—"
  const mb = bytes / 1_048_576
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

export type RowStatus = "active" | "uploaded" | "uploading" | "pending" | "missing"

/** Upload state of a recording from its timestamps + the in-flight upload set. */
export function rowStatus(
  rec: { uuid: string; ended_at: string | null; uploaded_at: string | null },
  uploadingSet?: Set<string>,
): RowStatus {
  if (rec.ended_at == null) return "active"
  if (rec.uploaded_at == null && uploadingSet?.has(rec.uuid)) return "uploading"
  return rec.uploaded_at ? "uploaded" : "pending"
}
