from dataclasses import dataclass, field


@dataclass
class CameraConfig:
    index: int = 1              # 0 = webcam, 1 = ZED 2i
    frame_width: int = 2560      # ZED stereo (2x1280)
    frame_height: int = 720
    crop_width: int = 1280       # 0 = no crop (webcam), >0 = stereo crop (ZED)


@dataclass
class PerceptionConfig:
    model_name: str = "yolo11n.pt"
    default_target_class: str = "person"
    confidence_threshold: float = 0.5


@dataclass
class DatabaseConfig:
    url: str = "sqlite+aiosqlite:///counting.db"


@dataclass
class ServerConfig:
    host: str = "0.0.0.0"
    port: int = 8080


@dataclass
class Config:
    camera: CameraConfig = field(default_factory=CameraConfig)
    perception: PerceptionConfig = field(default_factory=PerceptionConfig)
    database: DatabaseConfig = field(default_factory=DatabaseConfig)
    server: ServerConfig = field(default_factory=ServerConfig)


config = Config()
