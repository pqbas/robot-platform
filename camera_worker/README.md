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

## Run

```bash
make run-camera                # = cd camera_worker && uv run camera-worker
```

## Resolution modes

Defaults (`.env.robot`) target the ZED 2i over USB 3.0 SuperSpeed.
`CAMERA_WIDTH × CAMERA_HEIGHT` is the **stereo SBS** capture from the
sensor; `CAMERA_CROP` selects the left eye out of the side-by-side
frame (the worker outputs `CROP × HEIGHT` to consumers).

### 1080p (default)

```
CAMERA_WIDTH=3840
CAMERA_HEIGHT=1080
CAMERA_CROP=1920
CAMERA_FPS=30
```

Native sensor capture at 30 fps. YUYV bandwidth ≈ 250 MB/s
(`3840·1080·2 B · 30 fps`), well inside USB 3.0 headroom.
Output frame: 1920×1080 BGR.

### 720p (alternative)

```
CAMERA_WIDTH=2560
CAMERA_HEIGHT=720
CAMERA_CROP=1280
CAMERA_FPS=30
```

For weak USB links, tighter disk budgets, or laptop dev cameras that
don't negotiate 1080p. YUYV bandwidth ≈ 110 MB/s. Output frame:
1280×720 BGR. Switch is `make restart` after editing `.env.robot`.

The recording-worker reads height from the handshake and auto-scales
the encoder bitrate accordingly — no extra config needed when toggling.
See `recording_worker/README.md` (Quality).

## Verify the negotiated mode

```bash
v4l2-ctl --device=/dev/video0 --list-formats-ext | grep -A20 YUYV
journalctl -u camera-worker | grep "Camera opened"
lsusb -t                           # confirm the camera is on a 5000M port
```

The `Camera opened` log reports the actual width/height/fps/fourcc the
driver agreed to (may differ from the request if the hardware can't
match exactly).
