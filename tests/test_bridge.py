"""Security-boundary tests for the restricted pywebview bridge."""

from __future__ import annotations

from pathlib import Path

import pytest

from password_manager_core.models import new_record, records_to_jsonl
from password_manager_desktop.bridge import DesktopBridge
from password_manager_desktop.session import VaultSession

MASTER_PASSWORD = "correct horse battery staple"


class FakeClipboard:
    def __init__(self) -> None:
        self.secret: str | None = None

    def copy_secret(self, secret: str, *, clear_after_seconds: int = 30) -> None:
        self.secret = secret

    def clear_managed(self) -> None:
        self.secret = None


def assert_data(response: dict[str, object]) -> object:
    assert response["ok"] is True
    return response["data"]


def test_default_vault_directory_is_installation_directory_without_creating_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "application"
    monkeypatch.setattr("password_manager_desktop.bridge.installation_directory", lambda: target)

    assert DesktopBridge._default_vault_directory() == target
    assert not target.exists()


def test_bridge_requires_dialog_grants_and_never_returns_copied_secret(tmp_path: Path) -> None:
    path = (tmp_path / "bridge.pmdb").resolve()
    clipboard = FakeClipboard()
    bridge = DesktopBridge(session=VaultSession(), clipboard=clipboard)  # type: ignore[arg-type]
    bridge._grant(path, "create_vault")

    assert_data(bridge.create_vault(str(path), MASTER_PASSWORD, False, 8))
    saved = assert_data(
        bridge.add_record(
            {
                "account": "Example",
                "username": "alice",
                "password": "native-only-secret",
                "custom_fields": [{"key": "PIN", "value": "1234"}],
            }
        )
    )
    assert isinstance(saved, dict)
    record_id = str(saved["id"])
    listing = assert_data(bridge.list_records())
    details = assert_data(bridge.get_record_details(record_id))
    assert "native-only-secret" not in repr(listing)
    assert "1234" not in repr(details)

    copy_result = bridge.copy_password(record_id)
    assert "native-only-secret" not in repr(copy_result)
    assert clipboard.secret == "native-only-secret"
    bridge._shutdown()

    denied = DesktopBridge(session=VaultSession(), clipboard=FakeClipboard())  # type: ignore[arg-type]
    response = denied.unlock_vault(str(path), MASTER_PASSWORD)
    assert response == {
        "ok": False,
        "error": {
            "code": "PERMISSION_DENIED",
            "message": "The path was not selected through the application file dialog.",
        },
    }


def test_bridge_consumes_file_grants(tmp_path: Path) -> None:
    path = (tmp_path / "one-shot.pmdb").resolve()
    bridge = DesktopBridge(session=VaultSession(), clipboard=FakeClipboard())  # type: ignore[arg-type]
    bridge._grant(path, "create_vault")
    assert_data(bridge.create_vault(str(path), MASTER_PASSWORD, False, 8))
    bridge.lock_vault()

    repeated = bridge.create_vault(str(path), MASTER_PASSWORD, True, 8)
    assert repeated["ok"] is False
    assert repeated["error"] == {
        "code": "PERMISSION_DENIED",
        "message": "The path was not selected through the application file dialog.",
    }


def test_bridge_requires_one_shot_export_reauthentication(tmp_path: Path) -> None:
    vault_path = (tmp_path / "export-auth.pmdb").resolve()
    first_export = (tmp_path / "first.jsonl").resolve()
    second_export = (tmp_path / "second.jsonl").resolve()
    clipboard = FakeClipboard()
    bridge = DesktopBridge(session=VaultSession(), clipboard=clipboard)  # type: ignore[arg-type]
    bridge._grant(vault_path, "create_vault")
    assert_data(bridge.create_vault(str(vault_path), MASTER_PASSWORD, False, 8))

    bridge._grant(first_export, "export_jsonl")
    denied = bridge.export_records(str(first_export), "jsonl", True)
    assert denied["ok"] is False
    assert denied["error"] == {
        "code": "PERMISSION_DENIED",
        "message": "Plaintext export requires fresh master-password authorization.",
    }

    assert_data(bridge.authorize_export(MASTER_PASSWORD))
    bridge._grant(first_export, "export_jsonl")
    assert_data(bridge.export_records(str(first_export), "jsonl", True))
    assert first_export.is_file()

    bridge._grant(second_export, "export_jsonl")
    repeated = bridge.export_records(str(second_export), "jsonl", True)
    assert repeated["ok"] is False
    assert repeated["error"] == {
        "code": "PERMISSION_DENIED",
        "message": "Plaintext export requires fresh master-password authorization.",
    }


def test_failed_export_reauthentication_locks_and_clears_clipboard(tmp_path: Path) -> None:
    vault_path = (tmp_path / "failed-export-auth.pmdb").resolve()
    clipboard = FakeClipboard()
    clipboard.secret = "managed secret"
    bridge = DesktopBridge(session=VaultSession(), clipboard=clipboard)  # type: ignore[arg-type]
    bridge._grant(vault_path, "create_vault")
    assert_data(bridge.create_vault(str(vault_path), MASTER_PASSWORD, False, 8))

    response = bridge.authorize_export("incorrect master password")

    assert response == {
        "ok": False,
        "error": {
            "code": "VAULT_AUTHENTICATION_FAILED",
            "message": "Master password is incorrect. The vault has been locked.",
        },
    }
    assert assert_data(bridge.get_status()) == {
        "unlocked": False,
        "vault_path": None,
        "record_count": 0,
    }
    assert clipboard.secret is None


def test_bridge_reports_merge_counts_and_import_conflicts(tmp_path: Path) -> None:
    vault_path = (tmp_path / "bridge-import.pmdb").resolve()
    import_path = (tmp_path / "records.jsonl").resolve()
    record = new_record(account="Imported", password="secret")
    bridge = DesktopBridge(session=VaultSession(), clipboard=FakeClipboard())  # type: ignore[arg-type]
    bridge._grant(vault_path, "create_vault")
    assert_data(bridge.create_vault(str(vault_path), MASTER_PASSWORD, False, 8))

    import_path.write_bytes(records_to_jsonl([record]))
    bridge._grant(import_path, "import")
    assert assert_data(bridge.import_jsonl(str(import_path))) == {
        "imported_count": 1,
        "skipped_count": 0,
    }

    conflicting = dict(record)
    conflicting["account"] = "Conflicting content"
    import_path.write_bytes(records_to_jsonl([conflicting]))  # type: ignore[list-item]
    bridge._grant(import_path, "import")
    response = bridge.import_jsonl(str(import_path))
    assert response["ok"] is False
    assert response["error"] == {
        "code": "IMPORT_CONFLICT",
        "message": f"Import conflicts with 1 existing record(s): {record['id']}.",
    }
