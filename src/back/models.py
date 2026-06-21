from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import BigInteger, Boolean, ForeignKey, Float, Integer, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from back.config import get_device_id


def _new_uuid() -> str:
    return str(uuid4())


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


# --- Domain models ---


class Empresa(Base):
    __tablename__ = "empresas"

    uuid: Mapped[str] = mapped_column(Text, primary_key=True, default=_new_uuid)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(Text, default=_now_iso)
    fundos: Mapped[list["Fundo"]] = relationship(back_populates="empresa")


class DeviceModel(Base):
    __tablename__ = "device_models"

    device_id: Mapped[str] = mapped_column(Text, ForeignKey("devices.id"), primary_key=True)
    model_uuid: Mapped[str] = mapped_column(Text, ForeignKey("detection_models.uuid"), primary_key=True)


class DetectionModel(Base):
    __tablename__ = "detection_models"

    uuid: Mapped[str] = mapped_column(Text, primary_key=True, default=_new_uuid)
    version: Mapped[str] = mapped_column(Text, nullable=False)
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    file_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(Text, nullable=False, default="uploaded")
    class_mapping: Mapped[str | None] = mapped_column(Text, nullable=True, default="[]")
    epochs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    map50: Mapped[float | None] = mapped_column(Float, nullable=True)
    map50_95: Mapped[float | None] = mapped_column(Float, nullable=True)
    precision: Mapped[float | None] = mapped_column(Float, nullable=True)
    recall: Mapped[float | None] = mapped_column(Float, nullable=True)
    dataset_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(Text, default=_now_iso)
    tensorrt_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    engine_status: Mapped[str] = mapped_column(
        Text, nullable=False, default="pytorch"
    )
    engine_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    selected_label: Mapped[str | None] = mapped_column(Text, nullable=True)


class ClassificationModel(Base):
    """Library of post-counting classifiers (custom PyTorch ``SupervisedModel``).

    Mirrors ``DetectionModel`` as a registry/library; a ``Category`` points at one
    of these as its chosen classifier. ``class_names`` is the ordered
    index→name list from training (``discover_classes``) — it travels with the
    checkpoint so the worker never hardcodes label order.
    """

    __tablename__ = "classification_models"

    uuid: Mapped[str] = mapped_column(Text, primary_key=True, default=_new_uuid)
    version: Mapped[str] = mapped_column(Text, nullable=False)
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    file_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(Text, nullable=False, default="uploaded")
    class_names: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    num_classes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    latent_dim: Mapped[int] = mapped_column(Integer, nullable=False, default=128)
    imgsz: Mapped[int] = mapped_column(Integer, nullable=False, default=128)
    created_at: Mapped[str] = mapped_column(Text, default=_now_iso)


class Category(Base):
    """The deployment hub: the object/fruit to detect/count/classify.

    A category (``arandano``, ``persona``…) holds *the best already chosen* for
    that object — its detector, its (optional) classifier, and the full counting
    geometry. ``name`` is the counted class (a detector ``system_label``).
    The platform deploys winners here; experimentation lives elsewhere.
    """

    __tablename__ = "categories"

    name: Mapped[str] = mapped_column(Text, primary_key=True)
    detection_model_uuid: Mapped[str | None] = mapped_column(
        ForeignKey("detection_models.uuid"), nullable=True
    )
    classification_model_uuid: Mapped[str | None] = mapped_column(
        ForeignKey("classification_models.uuid"), nullable=True
    )
    # Counting geometry lives per-category: counting blueberries needs one
    # parameter set, counting people another. config.counting is only the seed
    # default for new categories; build_count_config reads geometry from here.
    method: Mapped[str] = mapped_column(Text, nullable=False, default="single")
    count_mode: Mapped[str] = mapped_column(Text, nullable=False, default="horizontal")
    threshold: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    direction: Mapped[str] = mapped_column(
        Text, nullable=False, default="left2right"
    )
    roi_mode: Mapped[str] = mapped_column(Text, nullable=False, default="square")
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.25)
    updated_at: Mapped[str] = mapped_column(Text, default=_now_iso)


class Fundo(Base):
    __tablename__ = "fundos"

    uuid: Mapped[str] = mapped_column(Text, primary_key=True, default=_new_uuid)
    empresa_uuid: Mapped[str] = mapped_column(
        ForeignKey("empresas.uuid"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    region: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(Text, default=_now_iso)
    empresa: Mapped["Empresa"] = relationship(back_populates="fundos")


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    api_key_hash: Mapped[str] = mapped_column(Text, nullable=False)
    last_sync_at: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    fundo_uuid: Mapped[str | None] = mapped_column(
        ForeignKey("fundos.uuid"), nullable=True
    )
    fundo: Mapped["Fundo | None"] = relationship()


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False, default="viewer")
    empresa_uuid: Mapped[str | None] = mapped_column(
        ForeignKey("empresas.uuid"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(Text, default=_now_iso)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[str | None] = mapped_column(Text, nullable=True)
    empresa: Mapped["Empresa | None"] = relationship()


# --- Existing models ---


class Location(Base):
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(Text, unique=True, default=_new_uuid)
    device_id: Mapped[str] = mapped_column(Text, default=get_device_id)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    zoom: Mapped[int] = mapped_column(Integer, default=17)
    polygon: Mapped[str | None] = mapped_column(Text, nullable=True)


class Camellon(Base):
    __tablename__ = "camellones"
    __table_args__ = (
        UniqueConstraint("fundo_uuid", "nombre", name="uq_camellones_fundo_nombre"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(Text, unique=True, default=_new_uuid)
    device_id: Mapped[str] = mapped_column(Text, default=get_device_id)
    fundo_uuid: Mapped[str | None] = mapped_column(
        ForeignKey("fundos.uuid"), nullable=True
    )
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    fundo: Mapped["Fundo | None"] = relationship()
    sessions: Mapped[list["Session"]] = relationship(back_populates="camellon")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(Text, unique=True, default=_new_uuid)
    device_id: Mapped[str] = mapped_column(Text, default=get_device_id)
    # Nullable: a session can be saved without picking a location (the field
    # operator may not know/have time to set it) and assigned later via edit.
    camellon_id: Mapped[int | None] = mapped_column(
        ForeignKey("camellones.id"), nullable=True
    )
    start_time: Mapped[str] = mapped_column(Text, nullable=False)
    end_time: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_class: Mapped[str] = mapped_column(Text, nullable=False)
    total_count: Mapped[int] = mapped_column(Integer, default=0)
    recording_uuid: Mapped[str | None] = mapped_column(Text, nullable=True)
    camellon: Mapped["Camellon"] = relationship(back_populates="sessions")
    events: Mapped[list["Event"]] = relationship(back_populates="session")


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(Text, unique=True, default=_new_uuid)
    device_id: Mapped[str] = mapped_column(Text, default=get_device_id)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("sessions.id"), nullable=False
    )
    timestamp: Mapped[str] = mapped_column(Text, nullable=False)
    object_class: Mapped[str] = mapped_column(Text, nullable=False)
    track_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    session: Mapped["Session"] = relationship(back_populates="events")


# --- Capture and classification models ---


class CaptureBurst(Base):
    __tablename__ = "capture_bursts"

    uuid: Mapped[str] = mapped_column(Text, primary_key=True, default=_new_uuid)
    session_uuid: Mapped[str] = mapped_column(Text, nullable=False)
    device_id: Mapped[str] = mapped_column(Text, default=get_device_id)
    captured_at: Mapped[str] = mapped_column(Text, default=_now_iso)
    frame_count: Mapped[int] = mapped_column(Integer, default=0)
    frames: Mapped[list["CaptureFrame"]] = relationship(back_populates="burst")


class CaptureFrame(Base):
    __tablename__ = "capture_frames"

    uuid: Mapped[str] = mapped_column(Text, primary_key=True, default=_new_uuid)
    burst_uuid: Mapped[str] = mapped_column(
        ForeignKey("capture_bursts.uuid"), nullable=False
    )
    frame_index: Mapped[int] = mapped_column(Integer, nullable=False)
    image_path: Mapped[str] = mapped_column(Text, nullable=False)
    captured_at: Mapped[str] = mapped_column(Text, default=_now_iso)
    burst: Mapped["CaptureBurst"] = relationship(back_populates="frames")
    detections: Mapped[list["FrameDetection"]] = relationship(back_populates="frame")


class FrameDetection(Base):
    __tablename__ = "frame_detections"

    id: Mapped[int] = mapped_column(primary_key=True)
    frame_uuid: Mapped[str] = mapped_column(
        ForeignKey("capture_frames.uuid"), nullable=False
    )
    track_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    class_name: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    x: Mapped[float] = mapped_column(Float, nullable=False)
    y: Mapped[float] = mapped_column(Float, nullable=False)
    w: Mapped[float] = mapped_column(Float, nullable=False)
    h: Mapped[float] = mapped_column(Float, nullable=False)
    frame: Mapped["CaptureFrame"] = relationship(back_populates="detections")


class Recording(Base):
    __tablename__ = "recordings"

    uuid: Mapped[str] = mapped_column(Text, primary_key=True, default=_new_uuid)
    device_id: Mapped[str] = mapped_column(Text, default=get_device_id)
    session_uuid: Mapped[str | None] = mapped_column(Text, nullable=True)
    camellon_id: Mapped[int | None] = mapped_column(ForeignKey("camellones.id"), nullable=True)
    started_at: Mapped[str] = mapped_column(Text, nullable=False)
    ended_at: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    # BigInteger: file sizes routinely exceed 2 GB (int32 max). SQLite stores
    # integers as 64-bit dynamically so it never overflowed, but Postgres
    # INTEGER is 32-bit and rejected uploads >2 GB (see migration 019).
    file_size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fps: Mapped[float | None] = mapped_column(Float, nullable=True)
    uploaded_at: Mapped[str | None] = mapped_column(Text, nullable=True)
    # When the {uuid}.jsonl detection sidecar was last pushed to the server.
    # Robot-local bookkeeping (never synced) — decoupled from uploaded_at (the
    # MP4) because the sidecar is written incrementally by the counting-worker
    # AFTER recording ends, so the MP4 can upload while the JSONL is still
    # partial. The poller resets this to NULL whenever a (re)count finishes, so
    # the now-complete sidecar re-uploads on the next cycle. NULL + count_status
    # 'done' ⇒ needs (re)upload.
    detections_uploaded_at: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Deferred offline counting (counting-worker). The video is the source of
    # truth; the count is recomputed offline. count_config snapshots the config
    # + model identity (model_uuid/version/file_hash/engine_path) for
    # reproducibility / recount. none|pending|counting|done|error.
    count_status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="none", default="none"
    )
    count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    count_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    count_config: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Post-counting classification (classification-worker). Only runs when the
    # counted category has a classifier assigned; otherwise stays 'none' (zero
    # cost). classification_config pins the classifier identity for
    # reproducibility (mirror of count_config). none|pending|classifying|done|error.
    classification_status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="none", default="none"
    )
    classification_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    classification_config: Mapped[str | None] = mapped_column(Text, nullable=True)
    # When classification results+metadata were last pushed (auto sync, like
    # detections_uploaded_at). NULL + status 'done' ⇒ needs (re)upload.
    classifications_uploaded_at: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )
    # When the crop JPGs were last pushed (manual, with the MP4 — they are heavy).
    crops_uploaded_at: Mapped[str | None] = mapped_column(Text, nullable=True)
    camellon: Mapped["Camellon | None"] = relationship()


class FruitCrop(Base):
    __tablename__ = "fruit_crops"

    uuid: Mapped[str] = mapped_column(Text, primary_key=True, default=_new_uuid)
    # The artifact is the video, not the Session (which may not exist when the
    # count finishes). Crops are produced per Recording; the Session relates via
    # recording_uuid when saved — so session_uuid is now nullable.
    session_uuid: Mapped[str | None] = mapped_column(Text, nullable=True)
    recording_uuid: Mapped[str | None] = mapped_column(Text, nullable=True)
    track_id: Mapped[int] = mapped_column(Integer, nullable=False)
    image_path: Mapped[str] = mapped_column(Text, nullable=False)
    source_frame_uuid: Mapped[str | None] = mapped_column(Text, nullable=True)
    bbox_x: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_y: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_w: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_h: Mapped[float] = mapped_column(Float, nullable=False)
    captured_at: Mapped[str] = mapped_column(Text, default=_now_iso)
    classifications: Mapped[list["FruitClassification"]] = relationship(back_populates="crop")


class FruitClassification(Base):
    __tablename__ = "fruit_classifications"

    uuid: Mapped[str] = mapped_column(Text, primary_key=True, default=_new_uuid)
    crop_uuid: Mapped[str] = mapped_column(
        ForeignKey("fruit_crops.uuid"), nullable=False
    )
    model_uuid: Mapped[str | None] = mapped_column(Text, nullable=True)
    class_name: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    classified_at: Mapped[str] = mapped_column(Text, default=_now_iso)
    crop: Mapped["FruitCrop"] = relationship(back_populates="classifications")


# --- Sync models ---


class SyncLog(Base):
    """Tracks which records have been synced to the server."""
    __tablename__ = "sync_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    table_name: Mapped[str] = mapped_column(Text, nullable=False)
    record_uuid: Mapped[str] = mapped_column(Text, nullable=False)
    synced_at: Mapped[str] = mapped_column(Text, default=_now_iso)


class Command(Base):
    """Server-to-robot command queue. Robot polls for pending commands."""
    __tablename__ = "commands"

    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(Text, unique=True, default=_new_uuid)
    device_id: Mapped[str] = mapped_column(Text, nullable=False)
    command_type: Mapped[str] = mapped_column(Text, nullable=False)  # e.g. "upload_frames"
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON with params
    status: Mapped[str] = mapped_column(Text, default="pending")  # pending | completed | failed
    created_at: Mapped[str] = mapped_column(Text, default=_now_iso)
    completed_at: Mapped[str | None] = mapped_column(Text, nullable=True)
