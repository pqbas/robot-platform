import os
from dataclasses import dataclass, field
from enum import Enum

from dotenv import load_dotenv

# Allow selecting a specific .env file via ENV_FILE variable
load_dotenv(os.getenv("ENV_FILE", ".env"))


class AppMode(str, Enum):
    ROBOT = "robot"
    SERVER = "server"


@dataclass
class CameraConfig:
    index: int = 1              # 0 = webcam, 1 = ZED 2i
    frame_width: int = 2560      # ZED stereo (2x1280)
    frame_height: int = 720
    crop_width: int = 1280       # 0 = no crop (webcam), >0 = stereo crop (ZED)
    socket_path: str = field(default_factory=lambda: os.getenv("CAMERA_SOCKET", "/tmp/camera.sock"))
    control_socket_path: str = field(
        default_factory=lambda: os.getenv("CAMERA_CONTROL_SOCKET", "/tmp/camera-control.sock")
    )


@dataclass
class PerceptionConfig:
    model_name: str = "yolo11n.pt"
    default_target_class: str = "blueberry"
    confidence_threshold: float = 0.25
    socket_path: str = os.getenv("INFERENCE_SOCKET", "/tmp/inference.sock")


@dataclass
class StorageConfig:
    models_dir: str = os.getenv("MODELS_DIR", "data/robot/models")
    frames_dir: str = os.getenv("FRAMES_DIR", "data/server/frames")
    device_context_path: str = os.getenv(
        "DEVICE_CONTEXT_PATH", "data/robot/device_context.json"
    )
    recordings_dir: str = os.getenv("RECORDINGS_DIR", "data/robot/recordings")
    camera_settings_path: str = os.getenv(
        "CAMERA_SETTINGS_PATH", "data/robot/camera_settings.json"
    )


@dataclass
class DatabaseConfig:
    url: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///data/robot/robot.db")


@dataclass
class ServerConfig:
    host: str = "0.0.0.0"
    port: int = int(os.getenv("PORT", "8080"))


@dataclass
class CountingConfig:
    count_mode: str = "horizontal"      # "vertical" | "horizontal"
    threshold: float = 0.5              # normalized line position in [0, 1]
    direction: str = "left2right"       # "top2down" | "down2top" | "left2right" | "right2left"
    confidence_threshold: float = 0.25
    roi_mode: str = "square"            # "square" (centered, side=height) | "full" (whole frame)


@dataclass
class RecordingConfig:
    control_socket_path: str = os.getenv("RECORDING_SOCKET", "/tmp/recording.sock")


@dataclass
class ConversionConfig:
    control_socket_path: str = os.getenv("CONVERSION_SOCKET", "/tmp/conversion.sock")


@dataclass
class EncoderConfig:
    bitrate: int = 1_000_000        # target bitrate in bps (1 Mbps)
    preset: str = "low-latency"     # "low-latency" | "high-quality"


@dataclass
class SyncConfig:
    server_url: str = os.getenv("SYNC_SERVER_URL", "")
    api_key: str = os.getenv("SYNC_API_KEY", "")
    interval_seconds: int = int(os.getenv("SYNC_INTERVAL", "300"))


@dataclass
class AuthConfig:
    secret_key: str = os.getenv("AUTH_SECRET_KEY", "dev-secret-change-me")
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440  # 24h


@dataclass
class Config:
    mode: AppMode = AppMode(os.getenv("ROBOT_MODE", "robot"))
    camera: CameraConfig = field(default_factory=CameraConfig)
    perception: PerceptionConfig = field(default_factory=PerceptionConfig)
    counting: CountingConfig = field(default_factory=CountingConfig)
    database: DatabaseConfig = field(default_factory=DatabaseConfig)
    storage: StorageConfig = field(default_factory=StorageConfig)
    server: ServerConfig = field(default_factory=ServerConfig)
    encoder: EncoderConfig = field(default_factory=EncoderConfig)
    recording: RecordingConfig = field(default_factory=RecordingConfig)
    conversion: ConversionConfig = field(default_factory=ConversionConfig)
    sync: SyncConfig = field(default_factory=SyncConfig)
    auth: AuthConfig = field(default_factory=AuthConfig)
    public_url: str = field(default_factory=lambda: os.getenv("SERVER_PUBLIC_URL", ""))


config = Config()


def get_device_id() -> str:
    """Auto-detect robot ID from Jetson serial number, fallback to env var.

    The Jetson devicetree file is a fixed-size blob padded with NUL bytes;
    str.strip() doesn't remove those, so we strip them explicitly to keep
    the value safe for PostgreSQL (which rejects \\x00 in TEXT/VARCHAR).
    """
    try:
        with open("/sys/firmware/devicetree/base/serial-number") as f:
            raw = f.read().strip().strip("\x00")
            return f"jetson-{raw}"
    except FileNotFoundError:
        return os.getenv("ROBOT_ID", "dev-local")
