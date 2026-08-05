from sunnic_backend.config import Settings


def test_gemini_api_keys_parses_comma_separated_env_var(monkeypatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEYS", "key-one,key-two")

    settings = Settings(_env_file=None)

    assert settings.gemini_api_keys == ["key-one", "key-two"]


def test_gemini_api_keys_defaults_to_empty_list() -> None:
    settings = Settings(_env_file=None)

    assert settings.gemini_api_keys == []


def test_allowed_origins_parses_comma_separated_env_var(monkeypatch) -> None:
    monkeypatch.setenv("ALLOWED_ORIGINS", "chrome-extension://abc,http://localhost:5173")

    settings = Settings(_env_file=None)

    assert settings.allowed_origins == ["chrome-extension://abc", "http://localhost:5173"]


def test_allowed_origins_defaults_to_empty_list() -> None:
    settings = Settings(_env_file=None)

    assert settings.allowed_origins == []
