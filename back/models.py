from sqlalchemy import ForeignKey, Float, Integer, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Camellon(Base):
    __tablename__ = "camellones"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    sessions: Mapped[list["Session"]] = relationship(back_populates="camellon")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
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
    session_id: Mapped[int] = mapped_column(
        ForeignKey("sessions.id"), nullable=False
    )
    timestamp: Mapped[str] = mapped_column(Text, nullable=False)
    object_class: Mapped[str] = mapped_column(Text, nullable=False)
    track_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    session: Mapped["Session"] = relationship(back_populates="events")
