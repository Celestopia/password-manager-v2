"""Dependency and package smoke tests for the development environment."""

import struct
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from password_manager_desktop.resources import application_icon, installation_directory


def test_runtime_dependencies_import() -> None:
    import argon2  # noqa: F401
    import cryptography  # noqa: F401
    import webview  # noqa: F401


def test_project_package_imports() -> None:
    import password_manager_core
    import password_manager_desktop  # noqa: F401

    assert password_manager_core.__version__ == "0.1.0"


def test_windows_application_icon_has_required_sizes() -> None:
    icon_bytes = application_icon().read_bytes()
    reserved, icon_type, image_count = struct.unpack_from("<HHH", icon_bytes)
    sizes = {
        (icon_bytes[6 + index * 16] or 256, icon_bytes[7 + index * 16] or 256)
        for index in range(image_count)
    }

    assert (reserved, icon_type) == (0, 1)
    assert {(16, 16), (32, 32), (48, 48), (256, 256)} <= sizes


def test_source_installation_directory_is_project_root() -> None:
    assert installation_directory() == Path(__file__).resolve().parents[1]


def test_frozen_installation_directory_is_executable_parent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    executable = tmp_path / "PasswordManagerV2.exe"
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(executable))

    assert installation_directory() == tmp_path


def test_desktop_window_starts_maximized(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import password_manager_desktop.app as desktop_app

    index = tmp_path / "index.html"
    icon = tmp_path / "icon.ico"
    index.write_text("<!doctype html>", encoding="utf-8")
    icon.write_bytes(b"test icon")
    window = MagicMock()
    create_window = MagicMock(return_value=window)
    start = MagicMock()
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(desktop_app, "frontend_index", lambda: index)
    monkeypatch.setattr(desktop_app, "application_icon", lambda: icon)
    monkeypatch.setattr(desktop_app.webview, "create_window", create_window)
    monkeypatch.setattr(desktop_app.webview, "start", start)

    assert desktop_app.main([]) == 0
    assert create_window.call_args.kwargs["maximized"] is True
    start.assert_called_once_with(gui="edgechromium", debug=False, private_mode=True, icon=str(icon))
