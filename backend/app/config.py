from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All settings come from environment variables (or a .env file)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./dev.db"
    secret_key: str = "dev-only-secret-change-me-in-production-0000"
    token_days: int = 30

    # Demo mode returns SMS login codes in the API response instead of sending them.
    demo_mode: bool = True

    # Temporary shared key for the operator endpoints until operator accounts exist.
    ops_key: str = "demo-ops-key"

    # A driver whose last position is older than this shows as "signal lost".
    signal_lost_after_s: int = 90
    default_radius_km: float = 8.0

    otp_ttl_s: int = 300
    otp_max_attempts: int = 3


@lru_cache
def get_settings() -> Settings:
    return Settings()
