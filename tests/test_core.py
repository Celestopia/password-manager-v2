"""Behavioral tests for encrypted storage and the authoritative vault session."""

from __future__ import annotations

import base64
import copy
import json
import struct
from pathlib import Path

import pytest

from password_manager_core.crypto import MAGIC, KdfProfile, decrypt_payload, encrypt_payload, split_vault
from password_manager_core.exceptions import (
    ImportConflictError,
    PlaintextConfirmationError,
    RecordValidationError,
    VaultAuthenticationError,
    VaultBusyError,
    VaultConflictError,
    VaultFormatError,
)
from password_manager_core.models import jsonl_to_records, new_record, records_to_jsonl
from password_manager_core.vault import initialize_vault, load_vault, read_header, write_records
from password_manager_desktop.session import VaultSession

FAST_KDF = KdfProfile(time_cost=1, memory_cost=8_192, parallelism=1)
MASTER_PASSWORD = "correct horse battery staple"
V1_GOLDEN = (
    "UE1HUlZBVUxUAAAA2HsiY2lwaGVyIjp7Im5hbWUiOiJjaGFjaGEyMC1wb2x5MTMwNSIsIm5vbmNlIjoia1lGNF9nTk0yaTAz"
    "VzJTZSJ9LCJmb3JtYXQiOiJqc29ubCIsImtkZiI6eyJoYXNoX2xlbiI6MzIsIm1lbW9yeV9jb3N0Ijo4MTkyLCJuYW1lIjoi"
    "YXJnb24yaWQiLCJwYXJhbGxlbGlzbSI6MSwic2FsdCI6InRhRlEwMV9xeTV4UGJwTHlKQzRlUGciLCJ0aW1lX2Nvc3QiOjN9"
    "LCJ2ZXJzaW9uIjoxfaiwfh2bcdV8BocxcsmRsaU0EN+ee3K1kRLZnjv5yn8K3R3JiuJU5ZIbCxhNmQdXglHU6DUPHRo8BZVZ"
    "M0oPBSwAvc44cHjuop71YmlGD8i9KNlKp6qojvqFlyJgq5L/gM1DIYw9LuRwhV3aFxpDJGRZuaCepf3yBHE2uM3Z0AKTF08w3"
    "bQv6vKKEu/7ewKlA2J1ItUzuvOnXqmWJ/9CRy4UrgIUgRZOXBmpyQ/+ksLbNJ988mACJzWnEp4krF5IqdfnRV86Vai+qSt7On"
    "idZLWnDx3P+uog/T59WYCIt690Lk+OECjXmXeaNNtsCzWL1Hzb2E0O3w2wdsvYc2UsGPwfgvQ+3O3synpPi6wInH1DLnIDcY"
    "yLYChD3LwKHLYqzka9Uj/SlKP2MMjZKWrVtsJETXlj8o0TcXza9k6CGKP/m7QKytdEpnmZ2TX47xKjVBV8SdDxVJDurkAPyrZ"
    "V/VgXMyJbBXucJEdFtpdR0S/7zgcOHH4bbNr1c4iHQrdWI3WBROcXRhk="
)


def test_authenticated_container_round_trip_and_rejects_wrong_password() -> None:
    plaintext = b'{"account":"example"}\n'
    encrypted = encrypt_payload(plaintext, MASTER_PASSWORD, kdf_profile=FAST_KDF)

    assert encrypted != plaintext
    assert decrypt_payload(encrypted, MASTER_PASSWORD) == plaintext
    with pytest.raises(VaultAuthenticationError):
        decrypt_payload(encrypted, "this is the wrong password")


def test_jsonl_round_trip_preserves_unicode_and_rejects_duplicate_ids() -> None:
    first = new_record(account="银行", username="alice", password="secret", description="主账户\n需保留")
    second = new_record(account="Mail", username="bob", password="secret-2")

    assert jsonl_to_records(records_to_jsonl([first, second])) == [first, second]
    with pytest.raises(RecordValidationError, match="Duplicate record id"):
        records_to_jsonl([first, first])


def test_description_is_strictly_required_and_must_be_a_string() -> None:
    record = new_record(account="Example")
    assert record["description"] == ""
    missing = dict(record)
    del missing["description"]
    with pytest.raises(RecordValidationError, match="missing required field.*description"):
        records_to_jsonl([missing])  # type: ignore[list-item]
    invalid = dict(record)
    invalid["description"] = None
    with pytest.raises(RecordValidationError, match="description.*must be a string"):
        records_to_jsonl([invalid])  # type: ignore[list-item]


def test_vault_write_detects_conflicts_and_keeps_overwrite_backup(tmp_path: Path) -> None:
    path = tmp_path / "vault.pmdb"
    original = initialize_vault(path, MASTER_PASSWORD, kdf_profile=FAST_KDF)
    original_bytes = path.read_bytes()
    record = new_record(account="Example", password="secret")

    updated = write_records(
        path,
        [record],
        MASTER_PASSWORD,
        kdf_profile=FAST_KDF,
        expected_fingerprint=original,
    )
    assert load_vault(path, MASTER_PASSWORD).records == [record]
    assert path.with_suffix(".pmdb.bak").read_bytes() == original_bytes

    path.write_bytes(path.read_bytes() + b"external change")
    with pytest.raises(VaultConflictError):
        write_records(
            path,
            [record],
            MASTER_PASSWORD,
            kdf_profile=FAST_KDF,
            expected_fingerprint=updated,
        )


def test_session_mutations_persist_without_exposing_secrets(tmp_path: Path) -> None:
    path = tmp_path / "session.pmdb"
    export_path = tmp_path / "export.jsonl"
    session = VaultSession()
    session.create(path, MASTER_PASSWORD, overwrite=False, memory_mib=8)

    summary = session.add_record(
        {
            "account": "Example",
            "username": "alice",
            "password": "top secret",
            "description": "Primary account\n背景信息",
            "custom_fields": [{"key": "PIN", "value": "1234"}],
            "tags": ["work"],
        }
    )
    assert "password" not in summary
    assert summary["created_at"] == summary["updated_at"]
    assert "description" not in summary
    details = session.get_record_details(str(summary["id"]))
    assert details["description"] == "Primary account\n背景信息"
    assert details["custom_fields"] == [
        {"key": "PIN", "has_value": True}
    ]
    assert session.reveal_password(str(summary["id"])) == "top secret"
    assert session.list_records("background") == []

    session.update_record(
        str(summary["id"]),
        {"account": "Renamed", "password_change": "new secret", "description": ""},
    )
    assert session.reveal_password(str(summary["id"])) == "new secret"
    with pytest.raises(PlaintextConfirmationError):
        session.export_records(export_path, "jsonl", confirmed_plaintext=False)
    session.export_records(export_path, "jsonl", confirmed_plaintext=True)
    session.lock()

    assert jsonl_to_records(export_path.read_bytes())[0]["account"] == "Renamed"
    assert load_vault(path, MASTER_PASSWORD).records[0]["password"] == "new secret"
    assert load_vault(path, MASTER_PASSWORD).records[0]["description"] == ""


@pytest.mark.parametrize("values", [{"password": ""}, {}])
def test_empty_password_survives_storage_export_import_and_edits(tmp_path: Path, values: dict[str, str]) -> None:
    path = tmp_path / "empty.pmdb"
    exported = tmp_path / "empty.jsonl"
    session = VaultSession()
    session.create(path, MASTER_PASSWORD, overwrite=False, memory_mib=8)
    try:
        saved = session.add_record({"account": "Passwordless", **values})
        record_id = str(saved["id"])
        assert session.get_record_details(record_id)["has_password"] is False
        session.export_records(exported, "jsonl", confirmed_plaintext=True)
        assert jsonl_to_records(exported.read_bytes())[0]["password"] == ""
        session.lock()
        session.unlock(path, MASTER_PASSWORD)
        assert session.reveal_password(record_id) == ""
        session.delete_record(record_id)
        assert session.import_jsonl(exported)["imported_count"] == 1
        session.update_record(record_id, {"username": "alice"})
        assert session.reveal_password(record_id) == ""
        session.update_record(record_id, {"password_change": "later secret"})
        session.update_record(record_id, {"username": "bob"})
        assert session.reveal_password(record_id) == "later secret"
    finally:
        session.lock()
    assert load_vault(path, MASTER_PASSWORD).records[0]["password"] == "later secret"


def test_import_merges_new_records_and_skips_identical_records(tmp_path: Path) -> None:
    path = tmp_path / "merge.pmdb"
    source = tmp_path / "import.jsonl"
    session = VaultSession()
    first = new_record(account="Existing", username="alice", password="secret")
    second = new_record(account="New", username="bob", password="new secret")
    session.create(path, MASTER_PASSWORD, overwrite=False, memory_mib=8)

    source.write_bytes(records_to_jsonl([first]))
    assert session.import_jsonl(source) == {"imported_count": 1, "skipped_count": 0}
    vault_before_noop = path.read_bytes()
    backup_before_noop = path.with_suffix(".pmdb.bak").read_bytes()

    source.write_bytes(records_to_jsonl([first]))
    assert session.import_jsonl(source) == {"imported_count": 0, "skipped_count": 1}
    assert path.read_bytes() == vault_before_noop
    assert path.with_suffix(".pmdb.bak").read_bytes() == backup_before_noop

    source.write_bytes(records_to_jsonl([first, second]))
    assert session.import_jsonl(source) == {"imported_count": 1, "skipped_count": 1}
    assert {record["id"] for record in session.list_records()} == {first["id"], second["id"]}


def test_import_conflict_rejects_the_entire_merge(tmp_path: Path) -> None:
    path = tmp_path / "conflict-import.pmdb"
    source = tmp_path / "conflict.jsonl"
    session = VaultSession()
    existing = new_record(account="Existing", password="secret")
    not_imported = new_record(account="Must not be imported", password="secret")
    session.create(path, MASTER_PASSWORD, overwrite=False, memory_mib=8)
    source.write_bytes(records_to_jsonl([existing]))
    session.import_jsonl(source)
    vault_before_conflict = path.read_bytes()

    conflicting = copy.deepcopy(existing)
    conflicting["account"] = "Changed content"
    source.write_bytes(records_to_jsonl([conflicting, not_imported]))
    with pytest.raises(ImportConflictError, match=existing["id"]):
        session.import_jsonl(source)

    assert path.read_bytes() == vault_before_conflict
    assert [record["id"] for record in session.list_records()] == [existing["id"]]


def test_import_rejects_duplicate_ids_within_the_source_file(tmp_path: Path) -> None:
    path = tmp_path / "invalid-import.pmdb"
    source = tmp_path / "duplicates.jsonl"
    duplicate = new_record(account="Duplicate", password="secret")
    encoded = json.dumps(duplicate, ensure_ascii=False, separators=(",", ":"))
    source.write_text(f"{encoded}\n{encoded}\n", encoding="utf-8")
    session = VaultSession()
    session.create(path, MASTER_PASSWORD, overwrite=False, memory_mib=8)

    with pytest.raises(RecordValidationError, match="Duplicate record id"):
        session.import_jsonl(source)

    assert session.list_records() == []


def test_export_reauthentication_locks_session_after_one_failure(tmp_path: Path) -> None:
    path = tmp_path / "reauth.pmdb"
    session = VaultSession()
    session.create(path, MASTER_PASSWORD, overwrite=False, memory_mib=8)

    session.authorize_plaintext_export(MASTER_PASSWORD)
    assert session.unlocked is True

    with pytest.raises(VaultAuthenticationError, match="vault has been locked"):
        session.authorize_plaintext_export("incorrect master password")

    assert session.unlocked is False


def test_unmigrated_golden_vault_is_rejected_by_strict_schema(tmp_path: Path) -> None:
    path = tmp_path / "legacy.pmdb"
    path.write_bytes(base64.b64decode(V1_GOLDEN))

    with pytest.raises(RecordValidationError, match="missing required field.*description"):
        load_vault(path, "legacy-master-password")


def test_untrusted_kdf_cost_is_bounded_before_derivation() -> None:
    encrypted = encrypt_payload(b"", MASTER_PASSWORD, kdf_profile=FAST_KDF)
    header, _, ciphertext = split_vault(encrypted)
    header["kdf"]["memory_cost"] = 1_048_577
    header_bytes = json.dumps(header, sort_keys=True, separators=(",", ":")).encode()
    malicious = MAGIC + struct.pack(">I", len(header_bytes)) + header_bytes + ciphertext

    with pytest.raises(VaultFormatError, match="memory cost"):
        decrypt_payload(malicious, MASTER_PASSWORD)


def test_strict_lock_blocks_a_second_session(tmp_path: Path) -> None:
    path = tmp_path / "locked.pmdb"
    first = VaultSession()
    second = VaultSession()
    try:
        first.create(path, MASTER_PASSWORD, overwrite=False, memory_mib=8)
        with pytest.raises(VaultBusyError):
            second.unlock(path, MASTER_PASSWORD)
        first.lock()
        assert second.unlock(path, MASTER_PASSWORD)["unlocked"] is True
    finally:
        first.lock()
        second.lock()


def test_session_preserves_kdf_costs_but_rotates_salt(tmp_path: Path) -> None:
    path = tmp_path / "profile.pmdb"
    session = VaultSession()
    try:
        session.create(path, MASTER_PASSWORD, overwrite=False, memory_mib=8)
        first_header = read_header(path)
        session.add_record({"account": "Example", "password": "secret"})
        second_header = read_header(path)
    finally:
        session.lock()

    assert first_header["kdf"]["memory_cost"] == second_header["kdf"]["memory_cost"] == 8_192
    assert first_header["kdf"]["salt"] != second_header["kdf"]["salt"]
    assert first_header["cipher"]["nonce"] != second_header["cipher"]["nonce"]


def test_failed_save_rolls_back_memory(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    path = tmp_path / "rollback.pmdb"
    session = VaultSession()
    session.create(path, MASTER_PASSWORD, overwrite=False, memory_mib=8)

    def fail_write(*_args: object, **_kwargs: object) -> None:
        raise OSError("simulated disk failure")

    monkeypatch.setattr("password_manager_desktop.session.write_records", fail_write)
    try:
        with pytest.raises(OSError, match="simulated disk failure"):
            session.add_record({"account": "Not persisted", "password": "secret"})
        assert session.list_records() == []
    finally:
        session.lock()


def test_external_modification_rejects_session_mutation(tmp_path: Path) -> None:
    path = tmp_path / "conflict.pmdb"
    session = VaultSession()
    session.create(path, MASTER_PASSWORD, overwrite=False, memory_mib=8)
    path.write_bytes(path.read_bytes() + b"external")
    try:
        with pytest.raises(VaultConflictError):
            session.add_record({"account": "Not persisted", "password": "secret"})
        assert session.list_records() == []
    finally:
        session.lock()
