"""Minimal Windows clipboard support for secrets without JavaScript exposure."""

from __future__ import annotations

import ctypes
import threading
import time
from ctypes import wintypes


class WindowsClipboard:
    """Copy a secret directly to the Windows clipboard."""

    CF_UNICODETEXT = 13
    GMEM_MOVEABLE = 0x0002

    def __init__(self) -> None:
        self._guard = threading.RLock()
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

    def copy_secret(self, secret: str) -> None:
        """Place ``secret`` on the clipboard until another application replaces it."""

        with self._guard:
            self._set_text(secret)

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
