"""Strict password-record schema, lookup, and plaintext serialization."""

from __future__ import annotations

import csv
import io
import json
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

from .exceptions import RecordLookupError, RecordValidationError

type Record = dict[str, Any]
type CustomField = dict[str, str]

ALLOWED_FIELDS = frozenset(
    {
        "id",
        "account",
        "username",
        "password",
        "phonenumber",
        "mail",
        "date",
        "url",
        "custom_fields",
        "tags",
        "created_at",
        "updated_at",
    }
)
STRING_FIELDS = (
    "id",
    "account",
    "username",
    "password",
    "phonenumber",
    "mail",
    "date",
    "url",
    "created_at",
    "updated_at",
)
CSV_COLUMNS = (
    "id",
    "account",
    "username",
    "password",
    "phonenumber",
    "mail",
    "date",
    "url",
    "tags",
    "custom_fields",
    "created_at",
    "updated_at",
)


def utc_now() -> str:
    """Return a second-precision UTC ISO-8601 timestamp."""

    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def new_record(
    *,
    account: str,
    username: str = "",
    password: str = "",
    phonenumber: str = "",
    mail: str = "",
    date: str = "",
    url: str = "",
    custom_fields: list[CustomField] | None = None,
    tags: list[str] | None = None,
) -> Record:
    """Create a normalized record with a UUID and timestamps."""

    now = utc_now()
    return normalize_record(
        {
            "id": str(uuid.uuid4()),
            "account": account,
            "username": username,
            "password": password,
            "phonenumber": phonenumber,
            "mail": mail,
            "date": date,
            "url": url,
            "custom_fields": custom_fields or [],
            "tags": tags or [],
            "created_at": now,
            "updated_at": now,
        }
    )


def normalize_record(raw: dict[str, Any]) -> Record:
    """Validate and copy one record using the version-1 fixed schema."""

    unknown = sorted(set(raw) - ALLOWED_FIELDS)
    if unknown:
        raise RecordValidationError(f"Record contains unsupported field(s): {', '.join(unknown)}.")
    missing = sorted(ALLOWED_FIELDS - set(raw))
    if missing:
        raise RecordValidationError(f"Record is missing required field(s): {', '.join(missing)}.")
    record: Record = {key: raw[key] for key in ALLOWED_FIELDS}
    for key in STRING_FIELDS:
        if not isinstance(record[key], str):
            raise RecordValidationError(f"Record field '{key}' must be a string.")
    if not record["id"] or not record["account"]:
        raise RecordValidationError("Record fields 'id' and 'account' must be non-empty strings.")
    record["custom_fields"] = normalize_custom_fields(record["custom_fields"])
    if not isinstance(record["tags"], list) or not all(isinstance(tag, str) for tag in record["tags"]):
        raise RecordValidationError("Record field 'tags' must be a list of strings.")
    record["tags"] = list(record["tags"])
    return record


def normalize_custom_fields(value: Any) -> list[CustomField]:
    """Validate custom fields with unique, non-empty keys."""

    if not isinstance(value, list):
        raise RecordValidationError("Record field 'custom_fields' must be a list.")
    normalized: list[CustomField] = []
    seen: set[str] = set()
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            raise RecordValidationError(f"Custom field #{index} must be an object.")
        unknown = sorted(set(item) - {"key", "value"})
        if unknown:
            raise RecordValidationError(
                f"Custom field #{index} contains unsupported field(s): {', '.join(unknown)}."
            )
        key = item.get("key")
        field_value = item.get("value")
        if not isinstance(key, str) or not isinstance(field_value, str):
            raise RecordValidationError(f"Custom field #{index} key and value must be strings.")
        key = key.strip()
        if not key:
            raise RecordValidationError(f"Custom field #{index} key cannot be empty.")
        if key in seen:
            raise RecordValidationError(f"Duplicate custom field key: {key}.")
        seen.add(key)
        normalized.append({"key": key, "value": field_value})
    return normalized


def normalize_records(records: Iterable[Record]) -> list[Record]:
    """Normalize records and reject duplicate IDs."""

    normalized: list[Record] = []
    seen_ids: set[str] = set()
    for record in records:
        item = normalize_record(record)
        if item["id"] in seen_ids:
            raise RecordValidationError(f"Duplicate record id '{item['id']}'.")
        seen_ids.add(item["id"])
        normalized.append(item)
    return normalized


def records_to_jsonl(records: Iterable[Record]) -> bytes:
    """Serialize records as deterministic UTF-8 JSON Lines."""

    lines = [
        json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        for record in normalize_records(records)
    ]
    return (("\n".join(lines) + "\n") if lines else "").encode("utf-8")


def jsonl_to_records(data: bytes) -> list[Record]:
    """Parse and validate UTF-8 JSON Lines."""

    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RecordValidationError("Vault payload is not valid UTF-8 JSONL.") from exc
    raw_records: list[Record] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError as exc:
            raise RecordValidationError(f"Invalid JSON on JSONL line {line_number}.") from exc
        if not isinstance(raw, dict):
            raise RecordValidationError(f"JSONL line {line_number} is not an object.")
        raw_records.append(raw)
    return normalize_records(raw_records)


def records_to_csv(records: Iterable[Record]) -> bytes:
    """Serialize records as plaintext CSV for explicit export only."""

    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=CSV_COLUMNS, lineterminator="\n")
    writer.writeheader()
    for record in normalize_records(records):
        row = dict(record)
        row["tags"] = json.dumps(record["tags"], ensure_ascii=False, separators=(",", ":"))
        row["custom_fields"] = json.dumps(
            record["custom_fields"], ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        writer.writerow(row)
    return output.getvalue().encode("utf-8")


def find_record(records: list[Record], selector: str) -> Record:
    """Find exactly one record by UUID prefix or account substring."""

    needle = selector.casefold()
    matches = [
        record
        for record in records
        if record["id"].casefold().startswith(needle) or needle in record["account"].casefold()
    ]
    if not matches:
        raise RecordLookupError(f"No record matches '{selector}'.")
    if len(matches) > 1:
        labels = ", ".join(f"{item['account']} ({item['id'][:8]})" for item in matches[:8])
        raise RecordLookupError(f"Selector '{selector}' matches multiple records: {labels}.")
    return matches[0]


def find_record_by_id(records: list[Record], record_id: str) -> Record:
    """Find one record by its complete stable ID."""

    matches = [record for record in records if record["id"] == record_id]
    if len(matches) != 1:
        raise RecordLookupError("The selected record no longer exists.")
    return matches[0]


def search_records(records: list[Record], query: str) -> list[Record]:
    """Search account names case-insensitively, preserving v1 behavior."""

    needle = query.casefold()
    return [record for record in records if needle in record["account"].casefold()]
