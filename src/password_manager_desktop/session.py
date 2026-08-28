"""Authoritative unlocked-vault session with transactional mutation semantics."""

from __future__ import annotations

import copy
import hmac
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

from password_manager_core.crypto import KdfProfile
from password_manager_core.exceptions import (
    ImportConflictError,
    PlaintextConfirmationError,
    RecordValidationError,
    SessionStateError,
    VaultAuthenticationError,
    VaultConflictError,
)
from password_manager_core.locking import VaultFileLock
from password_manager_core.models import (
    CustomField,
    Record,
    find_record_by_id,
    new_record,
    normalize_custom_fields,
    normalize_records,
    records_to_csv,
    records_to_jsonl,
    search_records,
    utc_now,
)
from password_manager_core.vault import (
    FileFingerprint,
    atomic_write,
    fingerprint_file,
    initialize_vault,
    load_vault,
    read_header,
    read_import_jsonl,
    write_records,
)

T = TypeVar("T")


class VaultSession:
    """Keep secrets in Python and expose only minimum business-level views."""

    _ADD_FIELDS = frozenset(
        {"account", "username", "password", "phonenumber", "mail", "date", "url", "custom_fields", "tags"}
    )
    _UPDATE_FIELDS = frozenset(
        {
            "account",
            "username",
            "password_change",
            "phonenumber",
            "mail",
            "date",
            "url",
            "custom_fields",
            "tags",
        }
    )

    def __init__(self) -> None:
        self._guard = threading.RLock()
        self._vault_path: Path | None = None
        self._master_password = ""
        self._records: list[Record] = []
        self._kdf_profile: KdfProfile | None = None
        self._fingerprint: FileFingerprint | None = None
        self._file_lock: VaultFileLock | None = None

    @property
    def unlocked(self) -> bool:
        return self._vault_path is not None and bool(self._master_password)

    def status(self) -> dict[str, object]:
        """Return non-secret application state."""

        with self._guard:
            return {
                "unlocked": self.unlocked,
                "vault_path": str(self._vault_path) if self._vault_path is not None else None,
                "record_count": len(self._records) if self.unlocked else 0,
            }

    def unlock(self, path: Path, master_password: str) -> dict[str, object]:
        """Acquire exclusive ownership and authenticate an existing vault."""

        with self._guard:
            self._require_locked()
            resolved = path.expanduser().resolve(strict=True)
            if not resolved.is_file():
                raise FileNotFoundError(f"Vault file does not exist: {resolved}")
            file_lock = VaultFileLock(resolved)
            file_lock.acquire()
            try:
                snapshot = load_vault(resolved, master_password)
            except Exception:
                file_lock.release()
                raise
            self._vault_path = resolved
            self._master_password = master_password
            self._records = snapshot.records
            self._kdf_profile = snapshot.kdf_profile
            self._fingerprint = snapshot.fingerprint
            self._file_lock = file_lock
            return self.status()

    def create(
        self,
        path: Path,
        master_password: str,
        *,
        overwrite: bool,
        memory_mib: int = 64,
    ) -> dict[str, object]:
        """Create, lock, and enter a new empty vault session."""

        with self._guard:
            self._require_locked()
            self._validate_new_master_password(master_password)
            if not isinstance(memory_mib, int) or isinstance(memory_mib, bool):
                raise TypeError("Memory cost must be an integer number of MiB.")
            profile = KdfProfile(memory_cost=memory_mib * 1024)
            profile.validate()
            resolved = path.expanduser().resolve()
            file_lock = VaultFileLock(resolved)
            file_lock.acquire()
            try:
                fingerprint = initialize_vault(
                    resolved,
                    master_password,
                    overwrite=overwrite,
                    kdf_profile=profile,
                )
            except Exception:
                file_lock.release()
                raise
            self._vault_path = resolved
            self._master_password = master_password
            self._records = []
            self._kdf_profile = profile
            self._fingerprint = fingerprint
            self._file_lock = file_lock
            return self.status()

    def lock(self) -> dict[str, object]:
        """Drop Python references to unlocked secrets and release file ownership."""

        with self._guard:
            file_lock = self._file_lock
            self._vault_path = None
            self._master_password = ""
            self._records = []
            self._kdf_profile = None
            self._fingerprint = None
            self._file_lock = None
            if file_lock is not None:
                file_lock.release()
            return self.status()

    def list_records(self, query: str = "") -> list[dict[str, object]]:
        """Return non-secret summaries; passwords and custom values never leave Python."""

        with self._guard:
            self._require_unlocked()
            source = search_records(self._records, query.strip()) if query.strip() else self._records
            return [self._summary(record) for record in source]

    def get_record_details(self, record_id: str) -> dict[str, object]:
        """Return details with only custom-field keys and value-presence flags."""

        with self._guard:
            self._require_unlocked()
            record = find_record_by_id(self._records, record_id)
            details = self._summary(record)
            details.update(
                {
                    "created_at": record["created_at"],
                    "has_password": bool(record["password"]),
                    "custom_fields": [
                        {"key": field["key"], "has_value": bool(field["value"])}
                        for field in record["custom_fields"]
                    ],
                }
            )
            return details

    def reveal_password(self, record_id: str) -> str:
        """Return one password only after an explicit reveal action."""

        with self._guard:
            self._require_unlocked()
            return str(find_record_by_id(self._records, record_id)["password"])

    def password_for_clipboard(self, record_id: str) -> str:
        """Return one password to the native clipboard adapter, never the frontend."""

        return self.reveal_password(record_id)

    def reveal_custom_fields(self, record_id: str) -> list[CustomField]:
        """Return custom values only after an explicit user action."""

        with self._guard:
            self._require_unlocked()
            record = find_record_by_id(self._records, record_id)
            return copy.deepcopy(record["custom_fields"])

    def add_record(self, values: dict[str, Any]) -> dict[str, object]:
        """Validate and persist a new record transactionally."""

        parsed = self._parse_add_values(values)
        if not parsed["password"]:
            raise RecordValidationError("Password cannot be empty for a new record.")
        created = new_record(**parsed)

        def mutate(records: list[Record]) -> Record:
            records.append(created)
            return created

        record = self._mutate(mutate)
        return self._summary(record)

    def update_record(self, record_id: str, values: dict[str, Any]) -> dict[str, object]:
        """Update allowed fields without returning or pre-filling the old password."""

        parsed = self._parse_update_values(values)

        def mutate(records: list[Record]) -> Record:
            record = find_record_by_id(records, record_id)
            for key, value in parsed.items():
                if key == "password_change":
                    record["password"] = value
                else:
                    record[key] = value
            record["updated_at"] = utc_now()
            normalized = normalize_records(records)
            records[:] = normalized
            return find_record_by_id(records, record_id)

        record = self._mutate(mutate)
        return self._summary(record)

    def delete_record(self, record_id: str) -> dict[str, object]:
        """Delete a record transactionally."""

        def mutate(records: list[Record]) -> Record:
            record = find_record_by_id(records, record_id)
            records.remove(record)
            return record

        deleted = self._mutate(mutate)
        return self._summary(deleted)

    def import_jsonl(self, source: Path) -> dict[str, int]:
        """Merge validated JSONL records, skipping identical existing IDs."""

        imported = read_import_jsonl(source)
        with self._guard:
            path, password, profile, fingerprint = self._unlocked_parts()
            self._assert_disk_unchanged(path, fingerprint)
            existing_by_id = {record["id"]: record for record in self._records}
            additions: list[Record] = []
            conflict_ids: list[str] = []
            skipped_count = 0
            for record in imported:
                existing = existing_by_id.get(record["id"])
                if existing is None:
                    additions.append(record)
                elif existing == record:
                    skipped_count += 1
                else:
                    conflict_ids.append(record["id"])
            if conflict_ids:
                preview = ", ".join(conflict_ids[:5])
                remainder = max(0, len(conflict_ids) - 5)
                suffix = f" and {remainder} more" if remainder else ""
                raise ImportConflictError(
                    f"Import conflicts with {len(conflict_ids)} existing record(s): {preview}{suffix}."
                )
            if not additions:
                return {"imported_count": 0, "skipped_count": skipped_count}

            staged = normalize_records(copy.deepcopy(self._records) + additions)
            new_fingerprint = write_records(
                path,
                staged,
                password,
                kdf_profile=profile,
                expected_fingerprint=fingerprint,
            )
            self._records = staged
            self._fingerprint = new_fingerprint
            return {"imported_count": len(additions), "skipped_count": skipped_count}

    def export_records(self, path: Path, export_format: str, *, confirmed_plaintext: bool) -> None:
        """Write an explicitly acknowledged plaintext export."""

        if not confirmed_plaintext:
            raise PlaintextConfirmationError("Plaintext export requires explicit confirmation.")
        with self._guard:
            self._require_unlocked()
            if export_format == "jsonl":
                data = records_to_jsonl(self._records)
            elif export_format == "csv":
                data = records_to_csv(self._records)
            else:
                raise ValueError("Unsupported export format.")
            atomic_write(path.expanduser().resolve(), data, make_backup=False)

    def authorize_plaintext_export(self, master_password: str) -> None:
        """Re-authenticate a plaintext export or lock immediately on failure."""

        with self._guard:
            self._require_unlocked()
            if hmac.compare_digest(master_password, self._master_password):
                return
            self.lock()
            raise VaultAuthenticationError("Master password is incorrect. The vault has been locked.")

    def change_master_password(self, current_password: str, new_password: str) -> None:
        """Re-authenticate the current file and rewrite it under a new password."""

        self._validate_new_master_password(new_password)
        with self._guard:
            path, _, profile, fingerprint = self._unlocked_parts()
            if not hmac.compare_digest(current_password, self._master_password):
                # Re-reading below would also fail, but this avoids an expensive KDF for obvious mismatch.
                raise ValueError("Current master password is incorrect.")
            self._assert_disk_unchanged(path, fingerprint)
            authenticated = load_vault(path, current_password)
            if authenticated.fingerprint != fingerprint:
                raise VaultConflictError("Vault changed on disk. Reload it before changing the password.")
            new_fingerprint = write_records(
                path,
                self._records,
                new_password,
                kdf_profile=profile,
                expected_fingerprint=fingerprint,
            )
            self._master_password = new_password
            self._fingerprint = new_fingerprint

    def header_info(self) -> dict[str, object]:
        """Return non-secret format metadata for the unlocked vault."""

        with self._guard:
            path, _, _, _ = self._unlocked_parts()
            return read_header(path)

    def _mutate(self, operation: Callable[[list[Record]], T]) -> T:
        with self._guard:
            path, password, profile, fingerprint = self._unlocked_parts()
            self._assert_disk_unchanged(path, fingerprint)
            staged = copy.deepcopy(self._records)
            result = operation(staged)
            staged = normalize_records(staged)
            new_fingerprint = write_records(
                path,
                staged,
                password,
                kdf_profile=profile,
                expected_fingerprint=fingerprint,
            )
            self._records = staged
            self._fingerprint = new_fingerprint
            return result

    def _unlocked_parts(self) -> tuple[Path, str, KdfProfile, FileFingerprint]:
        self._require_unlocked()
        assert self._vault_path is not None
        assert self._kdf_profile is not None
        assert self._fingerprint is not None
        assert self._file_lock is not None and self._file_lock.held
        return self._vault_path, self._master_password, self._kdf_profile, self._fingerprint

    @staticmethod
    def _assert_disk_unchanged(path: Path, expected: FileFingerprint) -> None:
        if fingerprint_file(path) != expected:
            raise VaultConflictError("Vault changed on disk. Reload it before saving.")

    def _require_locked(self) -> None:
        if self.unlocked:
            raise SessionStateError("Lock the current vault before opening another one.")

    def _require_unlocked(self) -> None:
        if not self.unlocked:
            raise SessionStateError("No vault is unlocked.")

    @staticmethod
    def _validate_new_master_password(password: str) -> None:
        if not isinstance(password, str) or len(password) < 12:
            raise ValueError("Master password must be at least 12 characters.")

    @staticmethod
    def _summary(record: Record) -> dict[str, object]:
        return {
            "id": record["id"],
            "account": record["account"],
            "username": record["username"],
            "phonenumber": record["phonenumber"],
            "mail": record["mail"],
            "date": record["date"],
            "url": record["url"],
            "tags": list(record["tags"]),
            "updated_at": record["updated_at"],
            "has_custom_fields": bool(record["custom_fields"]),
        }

    def _parse_add_values(self, values: dict[str, Any]) -> dict[str, Any]:
        self._require_mapping(values)
        self._reject_unknown(values, self._ADD_FIELDS)
        required = self._require_string(values, "account", non_empty=True)
        return {
            "account": required,
            "username": self._optional_string(values, "username"),
            "password": self._optional_string(values, "password", strip=False),
            "phonenumber": self._optional_string(values, "phonenumber"),
            "mail": self._optional_string(values, "mail"),
            "date": self._optional_string(values, "date"),
            "url": self._optional_string(values, "url"),
            "custom_fields": normalize_custom_fields(values.get("custom_fields", [])),
            "tags": self._parse_tags(values.get("tags", [])),
        }

    def _parse_update_values(self, values: dict[str, Any]) -> dict[str, Any]:
        self._require_mapping(values)
        self._reject_unknown(values, self._UPDATE_FIELDS)
        parsed: dict[str, Any] = {}
        for key in ("account", "username", "phonenumber", "mail", "date", "url"):
            if key in values:
                parsed[key] = self._require_string(values, key, non_empty=key == "account")
        if "password_change" in values:
            parsed["password_change"] = self._require_string(values, "password_change", strip=False)
        if "custom_fields" in values:
            parsed["custom_fields"] = normalize_custom_fields(values["custom_fields"])
        if "tags" in values:
            parsed["tags"] = self._parse_tags(values["tags"])
        return parsed

    @staticmethod
    def _require_mapping(value: object) -> None:
        if not isinstance(value, dict):
            raise RecordValidationError("Record input must be an object.")

    @staticmethod
    def _reject_unknown(values: dict[str, Any], allowed: frozenset[str]) -> None:
        unknown = sorted(set(values) - allowed)
        if unknown:
            raise RecordValidationError(f"Unsupported record input field(s): {', '.join(unknown)}.")

    @staticmethod
    def _require_string(
        values: dict[str, Any], key: str, *, non_empty: bool = False, strip: bool = True
    ) -> str:
        value = values.get(key)
        if not isinstance(value, str):
            raise RecordValidationError(f"Record input '{key}' must be a string.")
        result = value.strip() if strip else value
        if non_empty and not result:
            raise RecordValidationError(f"Record input '{key}' cannot be empty.")
        return result

    @classmethod
    def _optional_string(cls, values: dict[str, Any], key: str, *, strip: bool = True) -> str:
        if key not in values:
            return ""
        return cls._require_string(values, key, strip=strip)

    @staticmethod
    def _parse_tags(value: object) -> list[str]:
        if not isinstance(value, list) or not all(isinstance(tag, str) for tag in value):
            raise RecordValidationError("Record input 'tags' must be a list of strings.")
        return [tag.strip() for tag in value if tag.strip()]
