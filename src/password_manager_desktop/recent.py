"""Best-effort, per-user recent vault paths; never stores vault contents."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from password_manager_core.vault import atomic_write


class RecentVaults:
    def __init__(self, path: Path | None = None) -> None:
        base = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")))
        self.path = path or base / "PasswordManagerV2" / "recent-vaults.json"
        self._guard = threading.RLock()

    def paths(self) -> list[str]:
        with self._guard:
            try:
                with self.path.open("rb") as source:
                    raw = source.read(65_537)
                if len(raw) > 65_536:
                    return []
                data = json.loads(raw)
                if not isinstance(data, dict) or data.get("version") != 1:
                    return []
                paths = data.get("paths")
                if not isinstance(paths, list) or len(paths) > 3:
                    return []
                result: list[str] = []
                for value in paths:
                    if not isinstance(value, str) or not value or "\0" in value or not Path(value).is_absolute():
                        return []
                    if value.casefold() not in {item.casefold() for item in result}:
                        result.append(value)
                return result
            except (OSError, ValueError, UnicodeError):
                return []

    def remember(self, path: Path) -> None:
        with self._guard:
            value = str(path.resolve())
            paths = [value] + [item for item in self.paths() if item.casefold() != value.casefold()]
            self._save(paths[:3])

    def remove(self, value: str) -> None:
        with self._guard:
            self._save([item for item in self.paths() if item.casefold() != value.casefold()])

    def selected(self, value: str) -> Path:
        for item in self.paths():
            if item == value:
                return Path(item)
        raise PermissionError("The vault is not in recent history. Select it through Open a vault.")

    def directory(self, fallback: Path) -> Path:
        for value in self.paths():
            try:
                parent = Path(value).parent
                if parent.is_dir():
                    return parent
            except OSError:
                continue
        return fallback

    def _save(self, paths: list[str]) -> None:
        try:
            atomic_write(self.path, json.dumps({"version": 1, "paths": paths}).encode("utf-8"), make_backup=False)
        except OSError:
            # History is optional: failure must not turn a successful unlock into an error.
            pass
