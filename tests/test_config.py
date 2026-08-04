from sunnic_backend.config import Settings


def test_allowed_origins_parses_comma_separated_env_var(monkeypatch) -> None:
    monkeypatch.setenv("ALLOWED_ORIGINS", "chrome-extension://abc,http://localhost:5173")

    settings = Settings(_env_file=None)

    assert settings.allowed_origins == ["chrome-extension://abc", "http://localhost:5173"]


def test_allowed_origins_defaults_to_empty_list() -> None:
    settings = Settings(_env_file=None)

    assert settings.allowed_origins == []
