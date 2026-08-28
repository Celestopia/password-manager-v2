"""Minimal Windows clipboard support for secrets without JavaScript exposure."""

from __future__ import annotations

import ctypes
import threading
import time
from ctypes import wintypes


class WindowsClipboard:
    """Copy a secret and clear it later only when it is still unchanged."""

    CF_UNICODETEXT = 13
    GMEM_MOVEABLE = 0x0002

    def __init__(self) -> None:
        self._guard = threading.RLock()
        self._managed_secret: str | None = None
        self._timer: threading.Timer | None = None
        self._user32 = ctypes.WinDLL("user32", use_last_error=True)
        self._kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self._configure_functions()

    def _configure_functions(self) -> None:
        self._user32.OpenClipboard.argtypes = [wintypes.HWND]
        self._user32.OpenClipboard.restype = wintypes.BOOL
        self._user32.CloseClipboard.argtypes = []
        self._user32.CloseClipboard.restype = wintypes.BOOL
        self._user32.EmptyClipboard.argtypes = []
        self._user32.EmptyClipboard.restype = wintypes.BOOL
        self._user32.GetClipboardData.argtypes = [wintypes.UINT]
        self._user32.GetClipboardData.restype = wintypes.HANDLE
        self._user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
        self._user32.SetClipboardData.restype = wintypes.HANDLE
        self._kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
        self._kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
        self._kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
        self._kernel32.GlobalLock.restype = wintypes.LPVOID
        self._kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
        self._kernel32.GlobalUnlock.restype = wintypes.BOOL
        self._kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]
        self._kernel32.GlobalFree.restype = wintypes.HGLOBAL

    def copy_secret(self, secret: str, *, clear_after_seconds: int = 30) -> None:
        """Place ``secret`` on the clipboard and schedule conditional clearing."""

        with self._guard:
            self._set_text(secret)
            self._managed_secret = secret
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(clear_after_seconds, self.clear_managed)
            self._timer.daemon = True
            self._timer.start()

    def clear_managed(self) -> None:
        """Clear only the secret copied by this application if still present."""

        with self._guard:
            secret = self._managed_secret
            self._managed_secret = None
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
            if secret is None:
                return
            try:
                if self._get_text() == secret:
                    self._clear()
            except OSError:
                return

    def _open(self) -> None:
        for _ in range(10):
            if self._user32.OpenClipboard(None):
                return
            time.sleep(0.02)
        raise ctypes.WinError(ctypes.get_last_error())

    def _set_text(self, text: str) -> None:
        encoded = (text + "\0").encode("utf-16-le")
        handle = self._kernel32.GlobalAlloc(self.GMEM_MOVEABLE, len(encoded))
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        pointer = self._kernel32.GlobalLock(handle)
        if not pointer:
            self._kernel32.GlobalFree(handle)
            raise ctypes.WinError(ctypes.get_last_error())
        ctypes.memmove(pointer, encoded, len(encoded))
        self._kernel32.GlobalUnlock(handle)
        self._open()
        try:
            if not self._user32.EmptyClipboard():
                raise ctypes.WinError(ctypes.get_last_error())
            if not self._user32.SetClipboardData(self.CF_UNICODETEXT, handle):
                raise ctypes.WinError(ctypes.get_last_error())
            handle = None
        finally:
            self._user32.CloseClipboard()
            if handle:
                self._kernel32.GlobalFree(handle)

    def _get_text(self) -> str:
        self._open()
        try:
            handle = self._user32.GetClipboardData(self.CF_UNICODETEXT)
            if not handle:
                return ""
            pointer = self._kernel32.GlobalLock(handle)
            if not pointer:
                return ""
            try:
                return ctypes.wstring_at(pointer)
            finally:
                self._kernel32.GlobalUnlock(handle)
        finally:
            self._user32.CloseClipboard()

    def _clear(self) -> None:
        self._open()
        try:
            self._user32.EmptyClipboard()
        finally:
            self._user32.CloseClipboard()

