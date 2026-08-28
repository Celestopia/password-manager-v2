"""Security-boundary tests for the restricted pywebview bridge."""

from __future__ import annotations

from pathlib import Path

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
