import os
from dataclasses import dataclass, field


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


@dataclass(frozen=True)
class Settings:
    executor_url: str = field(default_factory=lambda: _env("EXECUTOR_URL", "http://localhost:7460"))
    jwt_secret: str = field(
        default_factory=lambda: _env("DEV_JWT_SECRET", "dev-secret-not-for-production-32b-min!")
    )
    stream_delay_ms: int = field(default_factory=lambda: int(_env("AGENT_STREAM_DELAY_MS", "15")))
    port: int = field(default_factory=lambda: int(_env("AGENT_PORT", "7462")))
