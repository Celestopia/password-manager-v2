"""Restricted pywebview API surface between React and the Python session."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

import webview

from password_manager_core.exceptions import (
    ImportConflictError,
    PasswordManagerError,
    PlaintextConfirmationError,
    RecordLookupError,
    RecordValidationError,
    SessionStateError,
    VaultAuthenticationError,
    VaultBusyError,
    VaultConflictError,
    VaultFormatError,
)

from .clipboard import WindowsClipboard
from .resources import installation_directory
from .session import VaultSession

T = TypeVar("T")


class DesktopBridge:
    """Expose only explicit business operations to the renderer."""

    _EXPORT_AUTHORIZATION_SECONDS = 300.0

    def __init__(self, session: VaultSession | None = None, clipboard: WindowsClipboard | None = None) -> None:
        self._session = session or VaultSession()
        self._clipboard = clipboard or WindowsClipboard()
        self._window: webview.Window | None = None
        self._path_grants: dict[Path, set[str]] = {}
        self._path_grants_lock = threading.RLock()
        self._export_authorized_until = 0.0
        self._export_authorization_lock = threading.RLock()

    def _attach_window(self, window: webview.Window) -> None:
        self._window = window

    def _shutdown(self) -> None:
        self._revoke_export_authorization()
        self._session.lock()

    def get_status(self) -> dict[str, object]:
        return self._call(self._session.status)

    def choose_vault(self) -> dict[str, object]:
        return self._call(lambda: self._choose_file("open_vault"))

    def choose_new_vault_path(self) -> dict[str, object]:
        return self._call(lambda: self._choose_file("create_vault"))

    def choose_import_file(self) -> dict[str, object]:
        return self._call(lambda: self._choose_file("import"))

    def choose_export_file(self, export_format: object) -> dict[str, object]:
        return self._call(lambda: self._choose_export(export_format))

    def unlock_vault(self, path: object, master_password: object) -> dict[str, object]:
        return self._call(
            lambda: self._session.unlock(
                self._authorized_path(path, "open_vault", consume=True),
                self._require_string(master_password, "master_password"),
            )
        )

    def create_vault(
        self,
        path: object,
        master_password: object,
        overwrite: object = False,
        memory_mib: object = 64,
    ) -> dict[str, object]:
        def create() -> dict[str, object]:
            if not isinstance(overwrite, bool):
                raise TypeError("overwrite must be a boolean.")
            if not isinstance(memory_mib, int) or isinstance(memory_mib, bool):
                raise TypeError("memory_mib must be an integer.")
            return self._session.create(
                self._authorized_path(path, "create_vault", consume=True),
                self._require_string(master_password, "master_password"),
                overwrite=overwrite,
                memory_mib=memory_mib,
            )

        return self._call(create)

    def lock_vault(self) -> dict[str, object]:
        def lock() -> dict[str, object]:
            self._revoke_export_authorization()
            return self._session.lock()

        return self._call(lock)

    def list_records(self, query: object = "") -> dict[str, object]:
        return self._call(lambda: self._session.list_records(self._require_string(query, "query")))

    def get_record_details(self, record_id: object) -> dict[str, object]:
        return self._call(lambda: self._session.get_record_details(self._require_string(record_id, "record_id")))

    def reveal_password(self, record_id: object) -> dict[str, object]:
        return self._call(lambda: {"password": self._session.reveal_password(self._require_string(record_id, "record_id"))})

    def copy_password(self, record_id: object) -> dict[str, object]:
        def copy_password() -> dict[str, bool]:
            secret = self._session.password_for_clipboard(self._require_string(record_id, "record_id"))
            self._clipboard.copy_secret(secret)
            return {"copied": True}

        return self._call(copy_password)

    def reveal_custom_fields(self, record_id: object) -> dict[str, object]:
        return self._call(lambda: self._session.reveal_custom_fields(self._require_string(record_id, "record_id")))

    def add_record(self, values: object) -> dict[str, object]:
        return self._call(lambda: self._session.add_record(self._require_dict(values, "values")))

    def update_record(self, record_id: object, values: object) -> dict[str, object]:
        return self._call(
            lambda: self._session.update_record(
                self._require_string(record_id, "record_id"), self._require_dict(values, "values")
            )
        )

    def delete_record(self, record_id: object) -> dict[str, object]:
        return self._call(lambda: self._session.delete_record(self._require_string(record_id, "record_id")))

    def move_record(self, record_id: object, target_id: object, placement: object) -> dict[str, object]:
        return self._call(
            lambda: self._session.move_record(
                self._require_string(record_id, "record_id"),
                self._require_string(target_id, "target_id"),
                self._require_string(placement, "placement"),
            )
        )

    def rename_tag(self, old_name: object, new_name: object) -> dict[str, object]:
        return self._call(
            lambda: self._session.rename_tag(
                self._require_string(old_name, "old_name"),
                self._require_string(new_name, "new_name"),
            )
        )

    def delete_tag(self, name: object) -> dict[str, object]:
        return self._call(lambda: self._session.delete_tag(self._require_string(name, "name")))

    def import_jsonl(self, path: object) -> dict[str, object]:
        return self._call(
            lambda: self._session.import_jsonl(self._authorized_path(path, "import", consume=True))
        )

    def authorize_export(self, master_password: object) -> dict[str, object]:
        def authorize() -> dict[str, bool]:
            self._revoke_export_authorization()
            self._session.authorize_plaintext_export(
                self._require_string(master_password, "master_password")
            )
            with self._export_authorization_lock:
                self._export_authorized_until = time.monotonic() + self._EXPORT_AUTHORIZATION_SECONDS
            return {"authorized": True}

        return self._call(authorize)

    def export_records(self, path: object, export_format: object, confirmed_plaintext: object) -> dict[str, object]:
        def export() -> dict[str, str]:
            self._consume_export_authorization()
            if confirmed_plaintext is not True:
                raise PlaintextConfirmationError("Plaintext export requires explicit confirmation.")
            selected_format = self._require_string(export_format, "export_format")
            output = self._authorized_path(path, f"export_{selected_format}", consume=True)
            self._session.export_records(output, selected_format, confirmed_plaintext=True)
            return {"path": str(output), "format": selected_format}

        return self._call(export)

    def change_master_password(self, current_password: object, new_password: object) -> dict[str, object]:
        return self._call(
            lambda: self._change_password(
                self._require_string(current_password, "current_password"),
                self._require_string(new_password, "new_password"),
            )
        )

    def get_header_info(self) -> dict[str, object]:
        return self._call(self._session.header_info)

    def _change_password(self, current_password: str, new_password: str) -> dict[str, bool]:
        self._session.change_master_password(current_password, new_password)
        return {"changed": True}

    def _choose_file(self, purpose: str) -> dict[str, str | None]:
        window = self._require_window()
        if purpose == "create_vault":
            result = window.create_file_dialog(
                webview.FileDialog.SAVE,
                directory=str(self._default_vault_directory()),
                save_filename="vault.pmdb",
                file_types=("Password Manager vault (*.pmdb)",),
            )
        elif purpose == "import":
            result = window.create_file_dialog(
                webview.FileDialog.OPEN,
                file_types=("JSON Lines (*.jsonl)",),
            )
        else:
            result = window.create_file_dialog(
                webview.FileDialog.OPEN,
                directory=str(self._default_vault_directory()),
                file_types=("Password Manager vault (*.pmdb)",),
            )
        if not result:
            return {"path": None}
        path = Path(result[0]).expanduser().resolve()
        if purpose == "create_vault" and not path.suffix:
            path = path.with_suffix(".pmdb")
        self._grant(path, purpose)
        return {"path": str(path)}

    def _choose_export(self, export_format: object) -> dict[str, str | None]:
        self._require_export_authorization()
        try:
            selected = self._require_string(export_format, "export_format")
            if selected not in {"jsonl", "csv"}:
                raise ValueError("Unsupported export format.")
            result = self._require_window().create_file_dialog(
                webview.FileDialog.SAVE,
                save_filename=f"accounts.{selected}",
                file_types=(("JSON Lines (*.jsonl)",) if selected == "jsonl" else ("CSV (*.csv)",)),
            )
        except Exception:
            self._revoke_export_authorization()
            raise
        if not result:
            self._revoke_export_authorization()
            return {"path": None}
        path = Path(result[0]).expanduser().resolve()
        if not path.suffix:
            path = path.with_suffix(f".{selected}")
        self._grant(path, f"export_{selected}")
        return {"path": str(path)}

    def _require_export_authorization(self) -> None:
        with self._export_authorization_lock:
            authorized = time.monotonic() <= self._export_authorized_until
        if not authorized:
            self._revoke_export_authorization()
            raise PermissionError("Plaintext export requires fresh master-password authorization.")

    def _consume_export_authorization(self) -> None:
        with self._export_authorization_lock:
            if time.monotonic() <= self._export_authorized_until:
                self._export_authorized_until = 0.0
                return
        self._revoke_export_authorization()
        raise PermissionError("Plaintext export requires fresh master-password authorization.")

    def _revoke_export_authorization(self) -> None:
        with self._export_authorization_lock:
            self._export_authorized_until = 0.0
        with self._path_grants_lock:
            for path, purposes in list(self._path_grants.items()):
                export_purposes = {purpose for purpose in purposes if purpose.startswith("export_")}
                purposes.difference_update(export_purposes)
                if not purposes:
                    self._path_grants.pop(path, None)

    def _grant(self, path: Path, purpose: str) -> None:
        with self._path_grants_lock:
            self._path_grants.setdefault(path, set()).add(purpose)

    def _authorized_path(self, value: object, purpose: str, *, consume: bool = False) -> Path:
        path = Path(self._require_string(value, "path")).expanduser().resolve()
        with self._path_grants_lock:
            purposes = self._path_grants.get(path, set())
            if purpose not in purposes:
                raise PermissionError("The path was not selected through the application file dialog.")
            if consume:
                purposes.remove(purpose)
                if not purposes:
                    self._path_grants.pop(path, None)
        return path

    @staticmethod
    def _default_vault_directory() -> Path:
        return installation_directory()

    def _require_window(self) -> webview.Window:
        if self._window is None:
            raise RuntimeError("Desktop window is not ready.")
        return self._window

    @staticmethod
    def _require_string(value: object, name: str) -> str:
        if not isinstance(value, str):
            raise TypeError(f"{name} must be a string.")
        return value

    @staticmethod
    def _require_dict(value: object, name: str) -> dict[str, Any]:
        if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
            raise ValueError(f"{name} must be an object with string keys.")
        return value

    def _call(self, operation: Callable[[], T]) -> dict[str, object]:
        try:
            return {"ok": True, "data": operation()}
        except Exception as exc:  # noqa: BLE001 - bridge boundary must never leak a traceback
            return {"ok": False, "error": {"code": self._error_code(exc), "message": self._safe_message(exc)}}

    @staticmethod
    def _safe_message(exc: Exception) -> str:
        if isinstance(exc, (PasswordManagerError, OSError, TypeError, ValueError, PermissionError)):
            return str(exc)
        return "An unexpected application error occurred."

    @staticmethod
    def _error_code(exc: Exception) -> str:
        mapping: tuple[tuple[type[BaseException], str], ...] = (
            (VaultAuthenticationError, "VAULT_AUTHENTICATION_FAILED"),
            (VaultBusyError, "VAULT_BUSY"),
            (VaultConflictError, "VAULT_CONFLICT"),
            (VaultFormatError, "VAULT_FORMAT_INVALID"),
            (RecordValidationError, "RECORD_INVALID"),
            (RecordLookupError, "RECORD_NOT_FOUND"),
            (ImportConflictError, "IMPORT_CONFLICT"),
            (SessionStateError, "SESSION_STATE_INVALID"),
            (PlaintextConfirmationError, "PLAINTEXT_CONFIRMATION_REQUIRED"),
            (FileNotFoundError, "FILE_NOT_FOUND"),
            (FileExistsError, "FILE_EXISTS"),
            (PermissionError, "PERMISSION_DENIED"),
            (TypeError, "INVALID_ARGUMENT"),
            (ValueError, "INVALID_ARGUMENT"),
            (OSError, "IO_ERROR"),
        )
        for exception_type, code in mapping:
            if isinstance(exc, exception_type):
                return code
        return "INTERNAL_ERROR"
