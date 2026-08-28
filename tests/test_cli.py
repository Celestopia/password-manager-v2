"""Command-line contract tests."""

from __future__ import annotations

import pytest

from password_manager_cli.cli import build_parser


def test_import_command_does_not_offer_destructive_replace_mode() -> None:
    with pytest.raises(SystemExit) as exc_info:
        build_parser().parse_args(["import", "vault.pmdb", "records.jsonl", "--replace"])

    assert exc_info.value.code == 2
