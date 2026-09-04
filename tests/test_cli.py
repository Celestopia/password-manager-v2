"""Command-line contract tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from password_manager_cli.cli import build_parser, main, prompt_new_master_password, prompt_secret_twice
from password_manager_core.vault import load_vault
from password_manager_desktop.session import VaultSession


def test_add_accepts_empty_password(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "empty.pmdb"
    master = "correct horse battery staple"
    session = VaultSession()
    session.create(path, master, overwrite=False, memory_mib=8)
    session.lock()
    answers = iter(["", "", master])
    monkeypatch.setattr("getpass.getpass", lambda _: next(answers))
    assert main(["add", str(path), "--account", "Passwordless"]) == 0
    assert load_vault(path, master).records[0]["password"] == ""


@pytest.mark.parametrize("answers", [("", "different"), ("different", "")])
def test_empty_allowed_still_requires_matching_confirmation(
    answers: tuple[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    values = iter(answers)
    monkeypatch.setattr("getpass.getpass", lambda _: next(values))
    with pytest.raises(ValueError, match="must match"):
        prompt_secret_twice("Password", allow_empty=True)


@pytest.mark.parametrize("password", ["", "short"])
def test_master_password_requirements_are_unchanged(password: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("getpass.getpass", lambda _: password)
    with pytest.raises(ValueError):
        prompt_new_master_password()


def test_import_command_does_not_offer_destructive_replace_mode() -> None:
    with pytest.raises(SystemExit) as exc_info:
        build_parser().parse_args(["import", "vault.pmdb", "records.jsonl", "--replace"])

    assert exc_info.value.code == 2
