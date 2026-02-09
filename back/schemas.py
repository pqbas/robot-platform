from pydantic import BaseModel


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
