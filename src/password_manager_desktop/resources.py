"""Resolve bundled frontend resources in source and PyInstaller builds."""

from __future__ import annotations

import sys
from pathlib import Path


def application_root() -> Path:
    """Return the source root or PyInstaller extraction root."""

    resource_root = sys.__dict__.get("_MEIPASS")
    if getattr(sys, "frozen", False) and isinstance(resource_root, str):
        return Path(resource_root)
    return Path(__file__).resolve().parents[2]


def frontend_index() -> Path:
    """Return the production Vite index included with the desktop app."""

    return application_root() / "frontend" / "dist" / "index.html"


def application_icon() -> Path:
    """Return the Windows application icon for source and packaged runs."""

    return application_root() / "assets" / "pm-icon.ico"
