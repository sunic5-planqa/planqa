from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str = ""
    sunnic_haiku_model: str = "claude-haiku-4-5"
    sunnic_sonnet_model: str = "claude-sonnet-5"


settings = Settings()
