"""Windows process-level sibling lock files for vault write ownership."""

from __future__ import annotations

import json
import msvcrt
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO, Self

from .exceptions import VaultBusyError


class VaultFileLock:
    """Hold a non-blocking Windows byte-range lock for one vault session."""

    def __init__(self, vault_path: Path) -> None:
        self.vault_path = vault_path.resolve()
        self.lock_path = self.vault_path.with_suffix(self.vault_path.suffix + ".lock")
        self._handle: BinaryIO | None = None
        self._guard = threading.RLock()

    @property
    def held(self) -> bool:
        """Return whether this object currently owns the OS lock."""

        return self._handle is not None

    def acquire(self) -> None:
        """Acquire the lock or fail immediately when another process owns it."""

        with self._guard:
            if self._handle is not None:
                return
            self.lock_path.parent.mkdir(parents=True, exist_ok=True)
            handle = self.lock_path.open("a+b")
            try:
                handle.seek(0, os.SEEK_END)
                if handle.tell() == 0:
                    handle.write(b"\0")
                    handle.flush()
                handle.seek(0)
                try:
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                except OSError as exc:
                    raise VaultBusyError("Vault is already open for writing in another application instance.") from exc
                metadata = json.dumps(
                    {
                        "pid": os.getpid(),
                        "application": "PasswordManagerV2",
                        "opened_at": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
                handle.seek(1)
                handle.write(metadata)
                handle.truncate()
                handle.flush()
                self._handle = handle
            except Exception:
                handle.close()
                raise

    def release(self) -> None:
        """Release the OS lock; the harmless sibling file may remain."""

        with self._guard:
            handle = self._handle
            self._handle = None
            if handle is None:
                return
            try:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            finally:
                handle.close()

    def __enter__(self) -> Self:
        self.acquire()
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        self.release()
