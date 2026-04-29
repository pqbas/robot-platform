# Camera worker

Captures V4L2 frames once and fans them out to every connected client
(WebRTC backend, recording-worker, …) over a Unix socket. The backend
never opens `/dev/video*` directly.

## Sockets

- **Frames (server)**: `/tmp/camera.sock`. Length-prefixed framing.
  - Handshake (server → client): 4-byte big-endian length + JSON
    `{width, height, channels, fps}`.
  - Frame stream: 4-byte big-endian length + raw BGR bytes
    (`width * height * 3` bytes per frame).
- **Control (server)**: `/tmp/camera-control.sock`. JSON length-prefixed
  request/response. Used by the backend to swap the active resolution
  preset without restarting the systemd unit (Phase 11).
  - `{"cmd": "reload"}` → re-reads `data/robot/camera_settings.json`,
    closes V4L2, reopens at the new dimensions, and kicks every consumer
    (WebRTC backend + recording-worker) with a sentinel so they reconnect
    and pick up the new handshake. Response: `{"ok": true, "width": ...,
    "height": ..., "fps": ...}`.
  - `{"cmd": "status"}` → current dimensions/fps without touching V4L2.

## Run

```bash
make run-camera                # = cd camera_worker && uv run camera-worker
```

## Resolution modes

The active preset lives in `data/robot/camera_settings.json`:

```json
{ "preset": "1080p" }
```

The operator switches between presets from the **Vision** screen in
the frontend (Phase 11). The backend writes the file and pings the
control socket; no systemd restart, no SSH. If the file is missing or
the JSON is corrupt, the worker falls back to `1080p` and logs a
warning. The env vars `CAMERA_WIDTH/HEIGHT/CROP` only apply when the
JSON file is absent and remain documented here as the underlying
dimensions per preset.

| Preset  | CAMERA_WIDTH | CAMERA_HEIGHT | CAMERA_CROP | Output frame |
|---------|--------------|---------------|-------------|--------------|
| `1080p` | 3840         | 1080          | 1920        | 1920×1080    |
| `720p`  | 2560         | 720           | 1280        | 1280×720     |

1080p is the production default and works end-to-end: the recording
worker writes 1080p / 12 Mbps NVENC and the WebRTC live sustains
1080p @ 30 fps over H.264 NVENC (Phase 10 — see
`spec/27-04-26-webrtc-nvenc-live/`). 720p is kept as a network
fallback only.

### 1080p (default)

Native sensor capture at 30 fps. YUYV bandwidth ≈ 250 MB/s
(`3840·1080·2 B · 30 fps`), well inside USB 3.0 headroom.
Output frame: 1920×1080 BGR.

### 720p (troubleshooting fallback)

Toggle from the Vision screen if the network between the Jetson and
the operator laptop is weak (RTT > 200 ms or sustained packet loss
> 2%). The live stream adapts bitrate, but on lossy links a smaller
frame helps.

YUYV bandwidth ≈ 110 MB/s. Output frame: 1280×720 BGR. The control
socket reload closes the V4L2 device and reopens it; clients are
disconnected automatically and reconnect with the new handshake.

The recording-worker reads height from the handshake and auto-scales
the encoder bitrate accordingly (12 Mbps at 1080p, 8 Mbps at 720p
NVENC). See `recording_worker/README.md` (Quality).

## Verify the negotiated mode

```bash
v4l2-ctl --device=/dev/video0 --list-formats-ext | grep -A20 YUYV
journalctl -u camera-worker | grep "Camera opened"
lsusb -t                           # confirm the camera is on a 5000M port
```

The `Camera opened` log reports the actual width/height/fps/fourcc the
driver agreed to (may differ from the request if the hardware can't
match exactly).
