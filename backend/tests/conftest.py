import pytest

from sunnic_backend.storage.store import _SqliteBackend, store


# store.py's module-level `store` singleton defaults to a fixed file (backend/data/sunnic.db) so
# local dev "just works" restart-to-restart — but that same persistence means test runs would
# accumulate real rows across pytest invocations (e.g. test_api_teams.py's RACE01 fixed-code
# test would start failing on its second run ever, since that code would already be taken).
# Swap the shared singleton's backend for a throwaway SQLite file before any test runs — mutating
# the existing Store instance (not rebinding the `store` name) so every module that already did
# `from sunnic_backend.storage.store import store` keeps seeing the same object.
@pytest.fixture(autouse=True, scope="session")
def _isolated_store(tmp_path_factory: pytest.TempPathFactory) -> None:
    db_path = tmp_path_factory.mktemp("store") / "test.db"
    store._backend = _SqliteBackend(db_path)
