from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str = ""
    sunnic_haiku_model: str = "claude-haiku-4-5"
    sunnic_sonnet_model: str = "claude-sonnet-5"
    sunnic_gemini_model: str = "gemini-flash-lite-latest"
    gemini_api_keys: Annotated[list[str], NoDecode] = []
    allowed_origins: Annotated[list[str], NoDecode] = []

    @field_validator("gemini_api_keys", mode="before")
    @classmethod
    def _split_gemini_keys(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


settings = Settings()
