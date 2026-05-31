import { useCallback, useEffect, useRef, useState } from "react"
import {
  getRecordings,
  startRecording as apiStart,
  stopRecording as apiStop,
} from "@/api/recordings"
import type { Recording } from "@/types"

type State = {
  recording: Recording | null
  loading: boolean
  startedAt: Date | null
  durationStr: string
}

function formatDuration(start: Date | null): string {
  if (!start) return "0s"
  const secs = Math.floor((Date.now() - start.getTime()) / 1000)
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`
}

/** Tracks the active recording (if any) and exposes start/stop helpers.
 *  On mount it queries /api/recordings/ to recover state across browser
 *  refreshes — the source of truth is the backend, not localStorage. */
export function useRecording() {
  const [state, setState] = useState<State>({
    recording: null,
    loading: true,
    startedAt: null,
    durationStr: "0s",
  })
  const tickRef = useRef<number | null>(null)

  const setActive = useCallback((rec: Recording | null) => {
    setState((prev) => ({
      ...prev,
      recording: rec,
      startedAt: rec ? new Date(rec.started_at) : null,
      durationStr: rec ? formatDuration(new Date(rec.started_at)) : "0s",
    }))
  }, [])

  // Hydrate on mount: any row with ended_at == null is the in-flight one.
  useEffect(() => {
    let cancelled = false
    getRecordings()
      .then((rows) => {
        if (cancelled) return
        const inFlight = rows.find((r) => r.ended_at == null) ?? null
        setActive(inFlight)
      })
      .catch((err) => {
        console.error("getRecordings on mount failed:", err)
      })
      .finally(() => {
        if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [setActive])

  // Tick the duration label every second while a recording is active.
  useEffect(() => {
    if (!state.recording || !state.startedAt) {
      if (tickRef.current != null) {
        window.clearInterval(tickRef.current)
        tickRef.current = null
      }
      return
    }
    const id = window.setInterval(() => {
      setState((prev) =>
        prev.startedAt
          ? { ...prev, durationStr: formatDuration(prev.startedAt) }
          : prev,
      )
    }, 1000)
    tickRef.current = id
    return () => {
      window.clearInterval(id)
      tickRef.current = null
    }
  }, [state.recording, state.startedAt])

  const start = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }))
    try {
      const rec = await apiStart()
      setActive(rec)
      return rec
    } finally {
      setState((prev) => ({ ...prev, loading: false }))
    }
  }, [setActive])

  const stop = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }))
    try {
      const rec = await apiStop()
      setActive(null)
      return rec
    } finally {
      setState((prev) => ({ ...prev, loading: false }))
    }
  }, [setActive])

  return {
    recording: state.recording,
    loading: state.loading,
    durationStr: state.durationStr,
    start,
    stop,
  }
}
