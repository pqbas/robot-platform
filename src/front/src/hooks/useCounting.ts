import { useCallback, useEffect, useRef, useState } from "react"
import type { CountingState } from "@/types"
import {
  getCountingStatus,
  startCounting as apiStart,
  stopCounting as apiStop,
  saveSession,
  discardCounting,
} from "@/api/sessions"

export type UseCountingReturn = {
  state: CountingState
  startTime: Date | null
  targetClass: string | null
  startCounting: (targetClass: string) => Promise<void>
  stopCounting: () => Promise<void>
  save: () => Promise<void>
  discard: () => Promise<void>
}

export function useCounting(): UseCountingReturn {
  const [state, setState] = useState<CountingState>("IDLE")
  const [startTime, setStartTime] = useState<Date | null>(null)
  const [targetClass, setTargetClass] = useState<string | null>(null)

  const targetClassRef = useRef<string | null>(null)
  const stopResultRef = useRef<{ target_class: string } | null>(null)

  // Rehydrate from backend on mount: if another device left a session running,
  // recover its state so the user can stop/save it from here. The count itself
  // is computed offline, so there is no live number to restore.
  useEffect(() => {
    let cancelled = false
    getCountingStatus()
      .then((s) => {
        if (cancelled || !s.active) return
        targetClassRef.current = s.target_class
        setTargetClass(s.target_class)
        setStartTime(s.start_time ? new Date(s.start_time) : new Date())
        setState("COUNTING")
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const startCounting = useCallback(async (cls: string) => {
    await apiStart(cls)
    setTargetClass(cls)
    targetClassRef.current = cls
    setStartTime(new Date())
    setState("COUNTING")
  }, [])

  const stopCounting = useCallback(async () => {
    const result = await apiStop()
    stopResultRef.current = { target_class: result.target_class }
    setState("SAVING")
  }, [])

  const save = useCallback(async () => {
    const cls = stopResultRef.current?.target_class ?? targetClassRef.current ?? "person"
    // The authoritative count arrives later (offline worker → poller backfill of
    // Session.total_count), so we save with 0 as a placeholder.
    await saveSession(cls, 0)
    stopResultRef.current = null
    setState("IDLE")
    setStartTime(null)
    setTargetClass(null)
  }, [])

  const discard = useCallback(async () => {
    // Drop the auto-started recording on the backend before clearing local
    // state. Best-effort: a failure must not leave the UI stuck.
    try {
      await discardCounting()
    } catch {
      // ignore: clearing local state below still returns the user to IDLE
    }
    stopResultRef.current = null
    setState("IDLE")
    setStartTime(null)
    setTargetClass(null)
  }, [])

  return {
    state,
    startTime,
    targetClass,
    startCounting,
    stopCounting,
    save,
    discard,
  }
}
