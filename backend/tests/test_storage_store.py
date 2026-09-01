from sunnic_backend.storage.store import Store, _PostgresBackend, _SqliteBackend


def test_store_defaults_to_sqlite_backend_without_a_dsn() -> None:
    store = Store(dsn=None)

    assert isinstance(store._backend, _SqliteBackend)


def test_store_uses_postgres_backend_when_dsn_given() -> None:
    # Construction must stay fully synchronous (Store() runs at module import time, before an
    # event loop exists) — this only checks the backend picked, not an actual connection, since
    # asyncpg.create_pool() is lazily deferred to first real use (see _PostgresBackend._ensure_pool).
    store = Store(dsn="postgresql://user:pass@localhost/db")

    assert isinstance(store._backend, _PostgresBackend)
    assert store._backend._pool is None
