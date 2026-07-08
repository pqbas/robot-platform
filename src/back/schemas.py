import json
from typing import Literal

from pydantic import BaseModel, Field, field_validator


# --- Camellon ---

class CamellonCreate(BaseModel):
    nombre: str
    fundo_uuid: str | None = None


class CamellonRename(BaseModel):
    nombre: str


class CamellonLocationUpdate(BaseModel):
    lat: float
    lng: float


class CamellonOut(BaseModel):
    id: int
    nombre: str
    lat: float | None
    lng: float | None
    fundo_uuid: str | None = None
    fundo_nombre: str | None = None
    empresa_nombre: str | None = None

    model_config = {"from_attributes": True}


class CamellonSummary(BaseModel):
    id: int
    nombre: str
    total_count: int


class CamellonGeoSummary(BaseModel):
    id: int
    nombre: str
    lat: float | None
    lng: float | None
    total_count: int


# --- Session ---

class SessionStart(BaseModel):
    camellon_id: int
    target_class: str = "person"


class SessionOut(BaseModel):
    id: int
    camellon_id: int | None = None
    device_id: str
    start_time: str
    end_time: str | None
    target_class: str
    total_count: int
    recording_uuid: str | None = None
    # Offline counting status/number derived from the linked recording (the
    # video is the source of truth). 'done' + count once the worker finishes.
    count_status: str = "none"
    count: int | None = None
    # Ripeness classification status derived from the same linked recording
    # (second stage of the offline pipeline). 'none' when the category has no
    # classifier assigned — classification is opt-in per category.
    classification_status: str = "none"
    # Linked recording's duration/size/upload state, surfaced so the sessions
    # table can show the same columns as the recordings table.
    duration_seconds: float | None = None
    file_size_bytes: int | None = None
    uploaded_at: str | None = None

    model_config = {"from_attributes": True}


class SessionStopOut(BaseModel):
    id: int
    total_count: int
    end_time: str


class SessionSave(BaseModel):
    # Optional: save now, assign the location later (see SessionUpdate).
    camellon_id: int | None = None
    target_class: str
    total_count: int


class SessionUpdate(BaseModel):
    camellon_id: int


# --- Counting (live) ---

class CountingStartRequest(BaseModel):
    target_class: str = "person"


class CountingStatusOut(BaseModel):
    active: bool
    target_class: str | None = None
    start_time: str | None = None
    total_count: int = 0


class CountingStopOut(BaseModel):
    total_count: int
    target_class: str


# --- Event ---

class EventOut(BaseModel):
    id: int
    session_id: int
    timestamp: str
    object_class: str
    track_id: int | None

    model_config = {"from_attributes": True}


# --- Data channel payload ---

class DetectionItem(BaseModel):
    class_name: str
    confidence: float
    bbox: list[float]  # [x1, y1, x2, y2]
    track_id: int | None = None


class FrameDetectionPayload(BaseModel):
    count: int
    target_class: str
    detections: list[DetectionItem]
    session_active: bool = False
    error: str | None = None


# --- Camera config ---

class CameraDevice(BaseModel):
    index: int
    name: str
    available: bool


class CameraConfigOut(BaseModel):
    index: int
    frame_width: int
    frame_height: int
    crop_width: int


class CameraConfigUpdate(BaseModel):
    index: int | None = None
    frame_width: int | None = None
    frame_height: int | None = None
    crop_width: int | None = None


# --- Camera resolution preset (Phase 11) ---


class CameraResolutionOut(BaseModel):
    preset: Literal["1080p", "720p"]


class CameraResolutionUpdate(BaseModel):
    preset: Literal["1080p", "720p"]


class CameraSourceOut(BaseModel):
    rtsp_url: str


class CameraSourceUpdate(BaseModel):
    rtsp_url: str


class CameraRestartOut(BaseModel):
    ok: bool
    pid: int


# --- Counting config ---

class CountingConfigOut(BaseModel):
    count_mode: str
    threshold: float = Field(ge=0.0, le=1.0)
    direction: str
    confidence_threshold: float = Field(ge=0.0, le=1.0)
    roi_mode: Literal["square", "full"] = "square"


class CountingConfigUpdate(BaseModel):
    count_mode: str | None = None
    threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    direction: str | None = None
    confidence_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    roi_mode: Literal["square", "full"] | None = None


# --- Location ---


class PolygonPoint(BaseModel):
    lat: float
    lng: float


class LocationCreate(BaseModel):
    label: str
    lat: float
    lng: float
    zoom: int = 17
    polygon: list[PolygonPoint] | None = None


class LocationUpdate(BaseModel):
    polygon: list[PolygonPoint] | None = None


class LocationOut(BaseModel):
    id: int
    label: str
    lat: float
    lng: float
    zoom: int
    polygon: list[PolygonPoint] | None = None

    model_config = {"from_attributes": True}

    @field_validator("polygon", mode="before")
    @classmethod
    def parse_polygon_json(cls, v: object) -> object:
        if isinstance(v, str):
            return json.loads(v)
        return v


# --- Dashboard ---


class DashboardKPIs(BaseModel):
    total_count: int
    session_count: int
    camellon_count: int
    avg_per_session: float


class DailyTrendItem(BaseModel):
    date: str
    count: int


class CamellonBreakdownItem(BaseModel):
    camellon_id: int
    nombre: str
    count: int


class ClassBreakdownItem(BaseModel):
    target_class: str
    count: int


class DashboardStatsOut(BaseModel):
    kpis: DashboardKPIs
    daily_trend: list[DailyTrendItem]
    by_camellon: list[CamellonBreakdownItem]
    by_class: list[ClassBreakdownItem]


# --- Vision labels ---


class AvailableLabelItem(BaseModel):
    label: str
    model_filename: str
    source: str = "uploaded"


class SelectLabelRequest(BaseModel):
    label: str
    model_filename: str


# --- Device context ---


class ActiveContextSet(BaseModel):
    empresa_uuid: str
    empresa_name: str
    fundo_uuid: str
    fundo_name: str
    fundo_region: str | None = None


# --- Sync ---


class SyncEmpresa(BaseModel):
    uuid: str
    name: str
    is_active: bool = True
    created_at: str | None = None


class SyncFundo(BaseModel):
    uuid: str
    empresa_uuid: str
    name: str
    region: str | None = None
    is_active: bool = True
    created_at: str | None = None


class SyncLocation(BaseModel):
    uuid: str
    device_id: str | None = None
    label: str
    lat: float
    lng: float
    zoom: int = 17
    polygon: str | None = None


class SyncCamellon(BaseModel):
    uuid: str
    device_id: str | None = None
    fundo_uuid: str | None = None
    nombre: str
    lat: float | None = None
    lng: float | None = None


class SyncSession(BaseModel):
    uuid: str
    device_id: str | None = None
    # None when the session was saved without a location (resolved on server).
    camellon_uuid: str | None = None
    start_time: str
    end_time: str | None = None
    target_class: str
    total_count: int = 0
    recording_uuid: str | None = None


class SyncEvent(BaseModel):
    uuid: str
    device_id: str | None = None
    session_uuid: str  # resolved on server side
    timestamp: str
    object_class: str
    track_id: int | None = None


class SyncResult(BaseModel):
    received: int
    inserted: int
    skipped: int
    errors: list[str] = []
    successful_uuids: list[str] = []  # uuids that were inserted or skipped (idempotent)


# --- Recordings ---


class RecordingOut(BaseModel):
    uuid: str
    device_id: str
    session_uuid: str | None
    camellon_id: int | None
    camellon_nombre: str | None
    fundo_uuid: str | None
    fundo_nombre: str | None = None
    empresa_nombre: str | None = None
    started_at: str
    ended_at: str | None
    duration_seconds: float | None
    file_path: str
    file_size_bytes: int | None
    width: int | None
    height: int | None
    fps: float | None
    uploaded_at: str | None
    count_status: str = "none"
    count: int | None = None
    count_error: str | None = None
    classification_status: str = "none"
    classification_error: str | None = None

    model_config = {"from_attributes": True}


class RecordingPlaceUpdate(BaseModel):
    camellon_id: int | None


class RecountRequest(BaseModel):
    """Per-video counting parameters reviewed in the re-process dialog. All
    optional: only the fields the operator set override the global defaults. The
    chosen class fixes the model (``model_uuid``) and the operator picks which
    runtime of that model to run (``runtime``: pytorch .pt vs tensorrt .engine)."""

    count_mode: str | None = None
    threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    direction: str | None = None
    roi_mode: Literal["square", "full"] | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    target_class: str | None = None
    model_uuid: str | None = None
    runtime: Literal["pytorch", "tensorrt"] | None = None
    method: Literal["single", "tiled"] | None = None


class RecountConfigOut(BaseModel):
    """Config the re-process dialog prefills: the video's last-used params if it
    was counted before, else the current global defaults."""

    count_mode: str
    threshold: float
    direction: str
    roi_mode: Literal["square", "full"]
    confidence: float
    target_class: str | None
    model_uuid: str | None
    runtime: Literal["pytorch", "tensorrt"] | None
    method: Literal["single", "tiled"] = "single"


class CountingMethodOut(BaseModel):
    """A selectable object (model+class) plus its persisted counting method.

    Mirrors a CountingOptionOut entry; ``method`` is the per-object choice
    (default ``single``). Lets the settings page show one toggle per object."""

    label: str
    model_uuid: str
    model_version: str
    model_filename: str
    source: str
    method: Literal["single", "tiled"]


class CountingMethodUpdate(BaseModel):
    model_uuid: str
    label: str
    method: Literal["single", "tiled"]


class CountingOptionOut(BaseModel):
    """A selectable model+class for the re-process dialog: each detection model
    paired with a class it's configured to count, plus whether its TensorRT
    engine is built (so the dialog can offer/disable that runtime)."""

    label: str
    model_uuid: str
    model_version: str
    model_filename: str
    source: str
    tensorrt_available: bool


class SyncRecording(BaseModel):
    uuid: str
    device_id: str | None = None
    session_uuid: str | None = None
    camellon_uuid: str | None = None
    started_at: str
    ended_at: str | None = None
    duration_seconds: float | None = None
    file_path: str
    file_size_bytes: int | None = None
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    count: int | None = None
    count_status: str = "none"
    count_config: str | None = None
