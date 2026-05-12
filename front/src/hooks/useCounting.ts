import { useCallback, useEffect, useRef, useState } from "react"
import type { CountingState, FrameData } from "@/types"
import { findOrCreateCamellon } from "@/api/camellones"
import {
  getCountingStatus,
  startCounting as apiStart,
  stopCounting as apiStop,
  saveSession,
} from "@/api/sessions"

export type UseCountingReturn = {
  state: CountingState
  startTime: Date | null
  lastFrameCount: number
  sessionTotal: number
  targetClass: string | null
  startCounting: (targetClass: string) => Promise<void>
  stopCounting: () => Promise<void>
  save: (camellon: string) => Promise<void>
  discard: () => void
  updateFrame: (data: FrameData) => void
}

export function useCounting(): UseCountingReturn {
  const [state, setState] = useState<CountingState>("IDLE")
  const [startTime, setStartTime] = useState<Date | null>(null)
  const [lastFrameCount, setLastFrameCount] = useState(0)
  const [sessionTotal, setSessionTotal] = useState(0)
  const [targetClass, setTargetClass] = useState<string | null>(null)

  const targetClassRef = useRef<string | null>(null)
  const stopResultRef = useRef<{ total_count: number; target_class: string } | null>(null)

  // Rehydrate from backend on mount: if another device left a session running,
  // recover its state so the user can stop/save it from here.
  useEffect(() => {
    let cancelled = false
    getCountingStatus()
      .then((s) => {
        if (cancelled || !s.active) return
        targetClassRef.current = s.target_class
        setTargetClass(s.target_class)
        setStartTime(s.start_time ? new Date(s.start_time) : new Date())
        setSessionTotal(s.total_count)
        setLastFrameCount(s.total_count)
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
    setLastFrameCount(0)
    setSessionTotal(0)
    setState("COUNTING")
  }, [])

  const stopCounting = useCallback(async () => {
    const result = await apiStop()
    stopResultRef.current = result
    setSessionTotal(result.total_count)
    setState("SAVING")
  }, [])

  const save = useCallback(
    async (camellon: string) => {
      const cam = await findOrCreateCamellon(camellon)
      const result = stopResultRef.current
      const cls = result?.target_class ?? targetClassRef.current ?? "person"
      const total = result?.total_count ?? 0
      await saveSession(cam.id, cls, total)
      stopResultRef.current = null
      setState("IDLE")
      setStartTime(null)
      setTargetClass(null)
    },
    [],
  )

  const discard = useCallback(() => {
    stopResultRef.current = null
    setState("IDLE")
    setStartTime(null)
    setLastFrameCount(0)
    setSessionTotal(0)
    setTargetClass(null)
  }, [])

  const updateFrame = useCallback((data: FrameData) => {
    setLastFrameCount(data.count)
    if (data.session_active) {
      setSessionTotal(data.session_total)
    }
  }, [])

  return {
    state,
    startTime,
    lastFrameCount,
    sessionTotal,
    targetClass,
    startCounting,
    stopCounting,
    save,
    discard,
    updateFrame,
  }
}
