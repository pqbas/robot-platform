/** Detector selection shared by SettingsPage (where it is picked) and
 *  VisionPage (where it is used to start a session).
 *
 *  The two pages agree via a single localStorage entry holding either a
 *  composite `label::model_filename` key or NO_DETECTOR. The backend keeps its
 *  own `DetectionModel.selected_label` (what the inference worker loads and the
 *  recount default); "no detector" is a session-level choice on top of that, so
 *  picking it does not clear the backend selection.
 */

export const SELECTED_LABEL_KEY = "vision.selectedLabel.v3"

/** Sentinel: record the video with no detector attached. Radix Select rejects
 *  "" as an item value, hence a named token. */
export const NO_DETECTOR = "__none__"

export type LabelRef = { label: string; model_filename: string }

export function toSelectKey(l: LabelRef) {
  return `${l.label}::${l.model_filename}`
}

export function fromSelectKey(key: string): LabelRef {
  if (key === NO_DETECTOR) return { label: "", model_filename: "" }
  const idx = key.indexOf("::")
  if (idx === -1) return { label: key, model_filename: "" }
  return { label: key.slice(0, idx), model_filename: key.slice(idx + 2) }
}
