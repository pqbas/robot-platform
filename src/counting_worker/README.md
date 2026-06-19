# counting-worker

Offline blueberry counting. Reprocesses a recorded `{uuid}.mp4` frame-by-frame
(detect + ByteTrack + line-crossing) and produces:

1. the **authoritative count** (returned to the backend over the socket), and
2. a **frame-aligned detection sidecar** `{uuid}.jsonl` (written next to the MP4).

Why offline: the live pipeline (camera → JPEG → socket → inference worker →
data-channel) had variable latency that drifted the bbox to an older frame, so
the stored audit detections looked misaligned. Offline, the bbox for frame N is
computed from the exact pixels of frame N → aligned by construction.

## Run

```
make run-counting           # uv run counting-worker --control-socket /tmp/counting.sock
```

Idle = no thread, ~0% GPU. One job at a time (a second `count` returns `busy`).

## Protocol (Unix socket, JSON length-prefixed)

```
{"cmd": "count", "uuid": "...", "video_path": "...", "jsonl_path": "...",
 "engine_path": "...", "target_class": "blueberry", "count_mode": "horizontal",
 "threshold": 0.5, "direction": "left2right", "roi_mode": "square",
 "confidence": 0.25, "started_epoch": 0.0, "fps": 30.0}
  -> {"ok": true, "state": "counting"}            # or {"ok": false, "error": "busy"}

{"cmd": "status"}
  -> {"ok": true, "state": "idle"|"counting", "current": {...}|null,
      "last_result": {"ok": true, "uuid": "...", "total_count": 1234,
                      "frames": 900, "finished_at": "..."}|null}
```

The backend's `counting_poller` polls `status` and transcribes `last_result`
into `Recording.count` / `Recording.count_status`.

## Mirrors

State machine and socket framing are copied from `conversion_worker`.
`object_counter.py` is a verbatim copy of the backend's line-crossing geometry
(workers are isolated uv projects; see the parity test in `tests/`).
