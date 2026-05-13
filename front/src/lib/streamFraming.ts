import type { Detection } from "@/types"

export type FrameHeader = {
  frame_id?: number
  timestamp_us?: number
  is_keyframe?: boolean
  detections?: Detection[]
  target_class?: string | null
  session_active?: boolean
  session_total?: number
  error?: string | null
}

export type ParsedFrame = {
  header: FrameHeader
  payload: Uint8Array
}

export function parseFrame(buf: ArrayBuffer): ParsedFrame {
  const view = new DataView(buf)
  const headerLen = view.getUint32(0, false)
  const headerBytes = new Uint8Array(buf, 4, headerLen)
  const header = JSON.parse(
    new TextDecoder("utf-8").decode(headerBytes),
  ) as FrameHeader
  const payload = new Uint8Array(buf, 4 + headerLen)
  return { header, payload }
}
