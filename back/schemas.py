import json

from pydantic import BaseModel, field_validator


# --- Camellon ---

class CamellonCreate(BaseModel):
    nombre: str


class CamellonLocationUpdate(BaseModel):
    lat: float
    lng: float


class CamellonOut(BaseModel):
    id: int
    nombre: str
    lat: float | None
    lng: float | None

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
    camellon_id: int
    start_time: str
    end_time: str | None
    target_class: str
    total_count: int

    model_config = {"from_attributes": True}


class SessionStopOut(BaseModel):
    id: int
    total_count: int
    end_time: str


class SessionSave(BaseModel):
    camellon_id: int
    target_class: str
    total_count: int


# --- Counting (live) ---

class CountingStartRequest(BaseModel):
    target_class: str = "person"


class CountingStatusOut(BaseModel):
    active: bool
    target_class: str | None = None


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
    session_total: int = 0


# --- Counting config ---

class CountingConfigOut(BaseModel):
    count_mode: str
    threshold: int
    direction: str
    confidence_threshold: float


class CountingConfigUpdate(BaseModel):
    count_mode: str | None = None
    threshold: int | None = None
    direction: str | None = None
    confidence_threshold: float | None = None


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
