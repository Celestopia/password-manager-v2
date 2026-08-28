"""Dependency and package smoke tests for the development environment."""

import struct

from password_manager_desktop.resources import application_icon


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
