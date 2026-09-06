"""Strict, local-only command-line client backed by the shared vault session."""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from password_manager_core.exceptions import PasswordManagerError, RecordLookupError
from password_manager_core.models import CustomField
from password_manager_core.vault import read_header
from password_manager_desktop.session import VaultSession


def main(argv: list[str] | None = None) -> int:
    """Run the CLI and return its process exit code."""

    args = build_parser().parse_args(argv)
    try:
        return int(args.handler(args))
    except (PasswordManagerError, OSError, TypeError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nAborted.", file=sys.stderr)
        return 130


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="pm-v2", description="Local-only encrypted password manager.")
    commands = parser.add_subparsers(dest="command", required=True)

    init = commands.add_parser("init", help="Create an encrypted vault.")
    add_vault_arg(init)
    init.add_argument("--force", action="store_true", help="Overwrite an existing vault and retain a backup.")
    init.add_argument("--memory-mib", type=int, default=64, help="Argon2id memory cost in MiB.")
    init.set_defaults(handler=cmd_init)

    listing = commands.add_parser("list", help="List records without secrets.")
    add_vault_arg(listing)
    listing.add_argument("--sort", action="store_true")
    listing.set_defaults(handler=cmd_list)

    search = commands.add_parser("search", help="Search account names without secrets.")
    add_vault_arg(search)
    search.add_argument("query")
    search.set_defaults(handler=cmd_search)

    show = commands.add_parser("show", help="Show one record selected by UUID prefix or account text.")
    add_vault_arg(show)
    show.add_argument("selector")
    show.add_argument("--reveal", action="store_true", help="Print password and custom-field values.")
    show.add_argument("--json", action="store_true")
    show.set_defaults(handler=cmd_show)

    add = commands.add_parser("add", help="Add a record; the password is read from a hidden prompt.")
    add_vault_arg(add)
    add.add_argument("--account")
    add.add_argument("--username", default="")
    add.add_argument("--phonenumber", default="")
    add.add_argument("--mail", default="")
    add.add_argument("--date", default="")
    add.add_argument("--url", default="")
    add.add_argument("--description", default="")
    add.add_argument("--field", action="append", default=[], metavar="KEY=VALUE")
    add.add_argument("--tag", action="append", default=[])
    add.set_defaults(handler=cmd_add)

    edit = commands.add_parser("edit", help="Update explicitly supplied fields on one record.")
    add_vault_arg(edit)
    edit.add_argument("selector")
    for option in ("account", "username", "phonenumber", "mail", "date", "url", "description"):
        edit.add_argument(f"--{option}", default=argparse.SUPPRESS)
    edit.add_argument("--change-password", action="store_true", help="Read a replacement password from a hidden prompt.")
    edit.add_argument("--replace-fields", action="store_true", help="Replace custom fields with repeated --field values.")
    edit.add_argument("--field", action="append", default=[], metavar="KEY=VALUE")
    edit.add_argument("--replace-tags", action="store_true", help="Replace tags with repeated --tag values.")
    edit.add_argument("--tag", action="append", default=[])
    edit.set_defaults(handler=cmd_edit)

    delete = commands.add_parser("delete", help="Delete one record.")
    add_vault_arg(delete)
    delete.add_argument("selector")
    delete.add_argument("-y", "--yes", action="store_true")
    delete.set_defaults(handler=cmd_delete)

    export = commands.add_parser("export", help="Export plaintext records after explicit acknowledgement.")
    add_vault_arg(export)
    export.add_argument("output", type=Path)
    export.add_argument("--format", choices=("jsonl", "csv"))
    export.add_argument("--confirm-plaintext", action="store_true")
    export.set_defaults(handler=cmd_export)

    import_parser = commands.add_parser("import", help="Import a plaintext JSONL file.")
    add_vault_arg(import_parser)
    import_parser.add_argument("input", type=Path)
    import_parser.set_defaults(handler=cmd_import)

    passwd = commands.add_parser("passwd", help="Change the master password.")
    add_vault_arg(passwd)
    passwd.set_defaults(handler=cmd_passwd)

    info = commands.add_parser("info", help="Show unauthenticated vault header metadata.")
    add_vault_arg(info)
    info.set_defaults(handler=cmd_info)

    digest = commands.add_parser("hash", help="Print a digest of a string (not a password-storage operation).")
    digest.add_argument("value")
    digest.add_argument("--algorithm", choices=("md5", "sha1", "sha256", "sha512"), default="sha256")
    digest.set_defaults(handler=cmd_hash)
    return parser


def add_vault_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("vault", nargs="?", type=Path, default=None, help=f"Vault path (default: {default_vault_path()}).")


def application_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def default_vault_path() -> Path:
    return application_dir() / "vault.pmdb"


def resolve_vault_path(value: Path | None, *, require_exists: bool) -> Path:
    path = (value or default_vault_path()).expanduser().resolve()
    if require_exists and not path.is_file():
        raise FileNotFoundError(f"Vault file does not exist: {path}")
    return path


def with_unlocked[T](args: argparse.Namespace, operation: Callable[[VaultSession], T]) -> T:
    session = VaultSession()
    try:
        session.unlock(resolve_vault_path(args.vault, require_exists=True), prompt_master_password("Master password"))
        return operation(session)
    finally:
        session.lock()


def cmd_init(args: argparse.Namespace) -> int:
    session = VaultSession()
    vault = resolve_vault_path(args.vault, require_exists=False)
    try:
        session.create(vault, prompt_new_master_password(), overwrite=args.force, memory_mib=args.memory_mib)
    finally:
        session.lock()
    print(f"Initialized vault: {vault}")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    records = with_unlocked(args, lambda session: session.list_records())
    if args.sort:
        records.sort(key=lambda record: str(record["account"]).casefold())
    print_records(records)
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    print_records(with_unlocked(args, lambda session: session.list_records(args.query)))
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    def show(session: VaultSession) -> dict[str, object]:
        record_id = select_id(session, args.selector)
        details = session.get_record_details(record_id)
        details["password"] = session.reveal_password(record_id) if args.reveal else "********"
        fields = session.reveal_custom_fields(record_id) if args.reveal else details.pop("custom_fields")
        details["custom_fields"] = fields
        return details

    record = with_unlocked(args, show)
    if args.json:
        print(json.dumps(record, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        for label, key in (("ID", "id"), ("Account", "account"), ("Username", "username"), ("Password", "password"),
                           ("Phone", "phonenumber"), ("Mail", "mail"), ("Date", "date"), ("URL", "url"),
                           ("Description", "description"),
                           ("Updated", "updated_at")):
            print(f"{label + ':':<10}{record[key]}")
        tags = record["tags"]
        print(f"{'Tags:':<10}{', '.join(str(tag) for tag in tags) if isinstance(tags, list) else ''}")
        fields = record["custom_fields"]
        if isinstance(fields, list) and fields:
            print("Custom fields:")
            for field in fields:
                if isinstance(field, dict):
                    print(f"  {field.get('key', '')}: {field.get('value', '********')}")
    return 0


def cmd_add(args: argparse.Namespace) -> int:
    values = {
        "account": args.account if args.account is not None else prompt_required("Account"),
        "username": args.username,
        "password": prompt_secret_twice("Password", allow_empty=True),
        "phonenumber": args.phonenumber,
        "mail": args.mail,
        "date": args.date,
        "url": args.url,
        "description": args.description,
        "custom_fields": parse_custom_fields(args.field),
        "tags": args.tag,
    }
    saved = with_unlocked(args, lambda session: session.add_record(values))
    print(f"Added record: {saved['account']} ({str(saved['id'])[:8]})")
    return 0


def cmd_edit(args: argparse.Namespace) -> int:
    values: dict[str, Any] = {
        key: getattr(args, key)
        for key in ("account", "username", "phonenumber", "mail", "date", "url", "description")
        if hasattr(args, key)
    }
    if args.change_password:
        values["password_change"] = prompt_secret_twice("New password")
    if args.replace_fields:
        values["custom_fields"] = parse_custom_fields(args.field)
    elif args.field:
        raise ValueError("Use --replace-fields when supplying --field values.")
    if args.replace_tags:
        values["tags"] = args.tag
    elif args.tag:
        raise ValueError("Use --replace-tags when supplying --tag values.")
    if not values:
        raise ValueError("No changes were supplied.")

    def edit(session: VaultSession) -> dict[str, object]:
        return session.update_record(select_id(session, args.selector), values)

    saved = with_unlocked(args, edit)
    print(f"Updated record: {saved['account']} ({str(saved['id'])[:8]})")
    return 0


def cmd_delete(args: argparse.Namespace) -> int:
    def delete(session: VaultSession) -> dict[str, object] | None:
        record_id = select_id(session, args.selector)
        details = session.get_record_details(record_id)
        if not args.yes and not confirm(f"Delete '{details['account']}'?", default=False):
            return None
        return session.delete_record(record_id)

    deleted = with_unlocked(args, delete)
    if deleted is None:
        print("No changes made.")
    else:
        print(f"Deleted record: {deleted['account']} ({str(deleted['id'])[:8]})")
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    if not args.confirm_plaintext:
        raise ValueError("Refusing plaintext export without --confirm-plaintext.")
    export_format = args.format or ("csv" if args.output.suffix.casefold() == ".csv" else "jsonl")
    output = args.output.expanduser().resolve()
    with_unlocked(args, lambda session: session.export_records(output, export_format, confirmed_plaintext=True))
    print(f"Exported plaintext {export_format.upper()}: {output}")
    return 0


def cmd_import(args: argparse.Namespace) -> int:
    source = args.input.expanduser().resolve(strict=True)
    result = with_unlocked(args, lambda session: session.import_jsonl(source))
    print(
        f"Imported {result['imported_count']} record(s); "
        f"skipped {result['skipped_count']} identical record(s)."
    )
    return 0


def cmd_passwd(args: argparse.Namespace) -> int:
    session = VaultSession()
    try:
        current = prompt_master_password("Current master password")
        session.unlock(resolve_vault_path(args.vault, require_exists=True), current)
        session.change_master_password(current, prompt_new_master_password())
    finally:
        session.lock()
    print("Master password changed.")
    return 0


def cmd_info(args: argparse.Namespace) -> int:
    print(json.dumps(read_header(resolve_vault_path(args.vault, require_exists=True)), indent=2, sort_keys=True))
    return 0


def cmd_hash(args: argparse.Namespace) -> int:
    print(hashlib.new(args.algorithm, args.value.encode("utf-8")).hexdigest())
    return 0


def select_id(session: VaultSession, selector: str) -> str:
    needle = selector.casefold()
    matches = [
        record for record in session.list_records()
        if str(record["id"]).casefold().startswith(needle) or needle in str(record["account"]).casefold()
    ]
    if not matches:
        raise RecordLookupError(f"No record matches '{selector}'.")
    if len(matches) > 1:
        labels = ", ".join(f"{item['account']} ({str(item['id'])[:8]})" for item in matches[:8])
        raise RecordLookupError(f"Selector '{selector}' matches multiple records: {labels}.")
    return str(matches[0]["id"])


def parse_custom_fields(raw_fields: list[str]) -> list[CustomField]:
    fields: list[CustomField] = []
    seen: set[str] = set()
    for raw in raw_fields:
        if "=" not in raw:
            raise ValueError("Custom fields must use KEY=VALUE syntax.")
        key, value = raw.split("=", 1)
        key = key.strip()
        if not key or key in seen:
            raise ValueError("Custom field keys must be non-empty and unique.")
        seen.add(key)
        fields.append({"key": key, "value": value})
    return fields


def prompt_master_password(label: str) -> str:
    value = getpass.getpass(f"{label}: ")
    if not value:
        raise ValueError("Password cannot be empty.")
    return value


def prompt_new_master_password() -> str:
    value = prompt_secret_twice("New master password")
    if len(value) < 12:
        raise ValueError("Master password must be at least 12 characters.")
    return value


def prompt_secret_twice(label: str, *, allow_empty: bool = False) -> str:
    first = getpass.getpass(f"{label}: ")
    second = getpass.getpass(f"Confirm {label.casefold()}: ")
    if first != second:
        raise ValueError(f"Both {label.casefold()} entries must match.")
    if not first and not allow_empty:
        raise ValueError(f"{label} cannot be empty.")
    return first


def prompt_required(label: str) -> str:
    value = input(f"{label}: ").strip()
    if not value:
        raise ValueError(f"{label} cannot be empty.")
    return value


def confirm(question: str, *, default: bool) -> bool:
    answer = input(f"{question} [{'Y/n' if default else 'y/N'}]: ").strip().casefold()
    return default if not answer else answer in {"y", "yes"}


def print_records(records: list[dict[str, object]]) -> None:
    if not records:
        print("No records.")
        return
    rows = [
        (str(item["id"])[:8], str(item["account"]), str(item["username"]), str(item["updated_at"]))
        for item in records
    ]
    widths = [max(len(title), *(len(row[index]) for row in rows)) for index, title in enumerate(("ID", "Account", "Username", "Updated"))]
    print("  ".join(title.ljust(widths[index]) for index, title in enumerate(("ID", "Account", "Username", "Updated"))))
    print("  ".join("-" * width for width in widths))
    for row in rows:
        print("  ".join(value.ljust(widths[index]) for index, value in enumerate(row)))
