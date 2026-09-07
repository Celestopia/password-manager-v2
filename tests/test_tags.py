"""Derived tag-registry mutation and bridge tests."""

from collections.abc import Iterator
from pathlib import Path

import pytest

from password_manager_core.exceptions import VaultConflictError
from password_manager_core.models import Record, new_record, records_to_jsonl
from password_manager_core.vault import load_vault
from password_manager_desktop.bridge import DesktopBridge
from password_manager_desktop.session import VaultSession

PASSWORD = "correct horse battery staple"


@pytest.fixture
def tagged_vault(tmp_path: Path) -> Iterator[tuple[VaultSession, Path, list[Record]]]:
    path = tmp_path / "tagged.pmdb"
    records = [
        new_record(account="First", password="first-secret", tags=["work", "shared"]),
        new_record(account="Second", password="second-secret", tags=["personal", "shared"]),
        new_record(account="Third", password="third-secret"),
    ]
    source = tmp_path / "source.jsonl"
    source.write_bytes(records_to_jsonl(records))
    session = VaultSession()
    session.create(path, PASSWORD, overwrite=False, memory_mib=8)
    session.import_jsonl(source)
    try:
        yield session, path, records
    finally:
        session.lock()


def test_rename_tag_merges_references_atomically_and_preserves_order(
    tagged_vault: tuple[VaultSession, Path, list[Record]], monkeypatch: pytest.MonkeyPatch
) -> None:
    session, path, records = tagged_vault
    changed_at = "2026-09-07T01:02:03Z"
    monkeypatch.setattr("password_manager_desktop.session.utc_now", lambda: changed_at)

    result = session.rename_tag("work", "personal")

    assert result["changed"] is True
    assert "secret" not in repr(result)
    persisted = load_vault(path, PASSWORD).records
    assert [record["id"] for record in persisted] == [record["id"] for record in records]
    assert persisted[0]["tags"] == ["personal", "shared"]
    assert persisted[0]["updated_at"] == changed_at
    assert persisted[1] == records[1]
    assert persisted[2] == records[2]


def test_delete_tag_removes_every_reference_in_one_write(
    tagged_vault: tuple[VaultSession, Path, list[Record]], monkeypatch: pytest.MonkeyPatch
) -> None:
    session, path, records = tagged_vault
    changed_at = "2026-09-07T02:03:04Z"
    monkeypatch.setattr("password_manager_desktop.session.utc_now", lambda: changed_at)

    result = session.delete_tag("shared")

    assert result["changed"] is True
    persisted = load_vault(path, PASSWORD).records
    assert [record["tags"] for record in persisted] == [["work"], ["personal"], []]
    assert [record["id"] for record in persisted] == [record["id"] for record in records]
    assert persisted[0]["updated_at"] == changed_at
    assert persisted[1]["updated_at"] == changed_at
    assert persisted[2] == records[2]


def test_tag_noops_do_not_rewrite_and_invalid_names_are_rejected(
    tagged_vault: tuple[VaultSession, Path, list[Record]]
) -> None:
    session, path, _ = tagged_vault
    backup = path.with_suffix(".pmdb.bak")
    before = (path.read_bytes(), path.stat().st_mtime_ns, backup.read_bytes())
    assert session.rename_tag("work", "work")["changed"] is False
    assert session.delete_tag("missing")["changed"] is False
    assert (path.read_bytes(), path.stat().st_mtime_ns, backup.read_bytes()) == before
    with pytest.raises(ValueError):
        session.rename_tag("work", "  ")
    with pytest.raises(TypeError):
        session.delete_tag(None)  # type: ignore[arg-type]


def test_tag_mutation_rolls_back_failed_and_conflicting_writes(
    tagged_vault: tuple[VaultSession, Path, list[Record]], monkeypatch: pytest.MonkeyPatch
) -> None:
    session, path, _ = tagged_vault
    before = session.list_records()

    def fail(*_args: object, **_kwargs: object) -> None:
        raise OSError("simulated failure")

    monkeypatch.setattr("password_manager_desktop.session.write_records", fail)
    with pytest.raises(OSError):
        session.rename_tag("work", "office")
    assert session.list_records() == before

    monkeypatch.undo()
    path.write_bytes(path.read_bytes() + b"external")
    with pytest.raises(VaultConflictError):
        session.delete_tag("shared")
    assert session.list_records() == before


def test_tag_bridge_validates_arguments_and_returns_safe_summaries(
    tagged_vault: tuple[VaultSession, Path, list[Record]]
) -> None:
    session, _, _ = tagged_vault
    bridge = DesktopBridge(session=session)
    for response in (
        bridge.rename_tag(None, "new"),
        bridge.rename_tag("work", []),
        bridge.rename_tag("work", " "),
        bridge.delete_tag(True),
    ):
        assert response["ok"] is False
        assert isinstance(response["error"], dict)
        assert response["error"]["code"] == "INVALID_ARGUMENT"

    response = bridge.rename_tag("work", "office")
    assert response["ok"] is True
    assert "secret" not in repr(response)
    assert response["data"] == {"changed": True, "records": session.list_records()}
    bridge.lock_vault()
    locked = bridge.delete_tag("shared")
    assert locked["ok"] is False
    assert isinstance(locked["error"], dict)
    assert locked["error"]["code"] == "SESSION_STATE_INVALID"
