"""Persistent record order, no-op saves, and bridge validation."""

import csv
from collections.abc import Iterator
from pathlib import Path

import pytest

from password_manager_core.exceptions import RecordLookupError, SessionStateError, VaultConflictError
from password_manager_core.models import Record, jsonl_to_records, new_record, records_to_jsonl
from password_manager_core.vault import load_vault
from password_manager_desktop.bridge import DesktopBridge
from password_manager_desktop.session import VaultSession

PASSWORD = "correct horse battery staple"


@pytest.fixture
def vault(tmp_path: Path) -> Iterator[tuple[VaultSession, Path, list[Record]]]:
    path = tmp_path / "ordered.pmdb"
    records = [new_record(account=name, password="secret-" + name) for name in "ABCD"]
    source = tmp_path / "source.jsonl"
    source.write_bytes(records_to_jsonl(records))
    session = VaultSession()
    session.create(path, PASSWORD, overwrite=False, memory_mib=8)
    session.import_jsonl(source)
    try:
        yield session, path, records
    finally:
        session.lock()


@pytest.mark.parametrize(("moved", "target", "placement", "expected"), [
    (0, 3, "after", "BCDA"),
    (3, 0, "before", "DABC"),
    (0, 2, "before", "BACD"),
    (3, 1, "after", "ABDC"),
])
def test_move_persists_order_without_changing_fields(
    vault: tuple[VaultSession, Path, list[Record]], tmp_path: Path,
    moved: int, target: int, placement: str, expected: str,
) -> None:
    session, path, records = vault
    result = session.move_record(records[moved]["id"], records[target]["id"], placement)
    assert result["changed"] is True
    assert "secret-" not in repr(result)
    persisted = load_vault(path, PASSWORD).records
    assert "".join(record["account"] for record in persisted) == expected
    assert {record["id"]: record for record in persisted} == {record["id"]: record for record in records}
    assert load_vault(path.with_suffix(".pmdb.bak"), PASSWORD).records == records
    for fmt in ("jsonl", "csv"):
        output = tmp_path / ("export." + fmt)
        session.export_records(output, fmt, confirmed_plaintext=True)
        if fmt == "jsonl":
            exported = jsonl_to_records(output.read_bytes())
        else:
            with output.open(encoding="utf-8", newline="") as handle:
                exported = list(csv.DictReader(handle))
        assert "".join(record["account"] for record in exported) == expected
    session.lock()
    session.unlock(path, PASSWORD)
    assert "".join(str(record["account"]) for record in session.list_records()) == expected


@pytest.mark.parametrize(("moved", "target", "placement"), [(0, 0, "after"), (0, 1, "before"), (1, 0, "after")])
def test_move_noop_does_not_rewrite(vault: tuple[VaultSession, Path, list[Record]], moved: int, target: int, placement: str) -> None:
    session, path, records = vault
    backup = path.with_suffix(".pmdb.bak")
    before = (path.read_bytes(), path.stat().st_mtime_ns, backup.read_bytes())
    assert session.move_record(records[moved]["id"], records[target]["id"], placement)["changed"] is False
    assert (path.read_bytes(), path.stat().st_mtime_ns, backup.read_bytes()) == before


def test_move_rejects_invalid_requests(vault: tuple[VaultSession, Path, list[Record]]) -> None:
    session, path, records = vault
    before = path.read_bytes()
    with pytest.raises(ValueError):
        session.move_record(records[0]["id"], records[1]["id"], "middle")
    with pytest.raises(RecordLookupError):
        session.move_record("missing", records[1]["id"], "before")
    with pytest.raises(RecordLookupError):
        session.move_record(records[0]["id"], "missing", "after")
    assert path.read_bytes() == before
    session.lock()
    with pytest.raises(SessionStateError):
        session.move_record(records[0]["id"], records[1]["id"], "before")


def test_move_rolls_back_failed_save(vault: tuple[VaultSession, Path, list[Record]], monkeypatch: pytest.MonkeyPatch) -> None:
    session, path, records = vault
    before = path.read_bytes()
    summaries = session.list_records()

    def fail(*_args: object, **_kwargs: object) -> None:
        raise OSError("simulated failure")

    monkeypatch.setattr("password_manager_desktop.session.write_records", fail)
    with pytest.raises(OSError):
        session.move_record(records[0]["id"], records[3]["id"], "after")
    assert session.list_records() == summaries
    assert path.read_bytes() == before


def test_move_rejects_external_changes(vault: tuple[VaultSession, Path, list[Record]]) -> None:
    session, path, records = vault
    summaries = session.list_records()
    path.write_bytes(path.read_bytes() + b"external")
    with pytest.raises(VaultConflictError):
        session.move_record(records[0]["id"], records[3]["id"], "after")
    assert session.list_records() == summaries


def test_move_bridge_validates_arguments_and_returns_safe_order(vault: tuple[VaultSession, Path, list[Record]]) -> None:
    session, _, records = vault
    bridge = DesktopBridge(session=session)
    for args in [(None, records[0]["id"], "after"), (records[0]["id"], [], "before"),
                 (records[0]["id"], records[1]["id"], True), (records[0]["id"], records[1]["id"], "middle")]:
        response = bridge.move_record(*args)
        assert response["ok"] is False
        assert isinstance(response["error"], dict)
        assert response["error"]["code"] == "INVALID_ARGUMENT"
    response = bridge.move_record(records[3]["id"], records[0]["id"], "before")
    assert response["ok"] is True
    assert isinstance(response["data"], dict)
    assert response["data"]["records"] == session.list_records()
    assert "secret-" not in repr(response)
