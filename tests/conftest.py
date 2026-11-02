"""Keep application history tests isolated from real user data."""
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolated_user_data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "user-data"))
