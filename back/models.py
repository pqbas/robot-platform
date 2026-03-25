from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, ForeignKey, Float, Integer, Text
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


class FruitType(Base):
    __tablename__ = "fruit_types"

    uuid: Mapped[str] = mapped_column(Text, primary_key=True, default=_new_uuid)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, default=_now_iso)


class YoloModel(Base):
    __tablename__ = "yolo_models"

    uuid: Mapped[str] = mapped_column(Text, primary_key=True, default=_new_uuid)
    fruit_type_uuid: Mapped[str] = mapped_column(
        ForeignKey("fruit_types.uuid"), nullable=False
    )
    version: Mapped[str] = mapped_column(Text, nullable=False)
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    file_hash: Mapped[str] = mapped_column(Text, nullable=False)
    classes: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    fruit_type: Mapped["FruitType"] = relationship()


class Fundo(Base):
    __tablename__ = "fundos"

    uuid: Mapped[str] = mapped_column(Text, primary_key=True, default=_new_uuid)
    empresa_uuid: Mapped[str] = mapped_column(
        ForeignKey("empresas.uuid"), nullable=False
    )
    fruit_type_uuid: Mapped[str | None] = mapped_column(
        ForeignKey("fruit_types.uuid"), nullable=True
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    region: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(Text, default=_now_iso)
    empresa: Mapped["Empresa"] = relationship(back_populates="fundos")
    fruit_type: Mapped["FruitType | None"] = relationship()


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    api_key_hash: Mapped[str] = mapped_column(Text, nullable=False)
    last_sync_at: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


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

    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(Text, unique=True, default=_new_uuid)
    device_id: Mapped[str] = mapped_column(Text, default=get_device_id)
    fundo_uuid: Mapped[str | None] = mapped_column(
        ForeignKey("fundos.uuid"), nullable=True
    )
    nombre: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    fundo: Mapped["Fundo | None"] = relationship()
    sessions: Mapped[list["Session"]] = relationship(back_populates="camellon")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(Text, unique=True, default=_new_uuid)
    device_id: Mapped[str] = mapped_column(Text, default=get_device_id)
    camellon_id: Mapped[int] = mapped_column(
        ForeignKey("camellones.id"), nullable=False
    )
    start_time: Mapped[str] = mapped_column(Text, nullable=False)
    end_time: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_class: Mapped[str] = mapped_column(Text, nullable=False)
    total_count: Mapped[int] = mapped_column(Integer, default=0)
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
