"""Windows pywebview entry point for Password Manager v2."""

from __future__ import annotations

import importlib
import sys
from collections.abc import Sequence

import webview

from .bridge import DesktopBridge
from .resources import application_icon, frontend_index


def main(argv: Sequence[str] | None = None) -> int:
    """Open the bundled React application in an Edge WebView2 window."""

    arguments = list(sys.argv[1:] if argv is None else argv)
    if sys.platform != "win32":
        raise RuntimeError("Password Manager v2 currently supports Windows only.")
    index = frontend_index()
    if not index.is_file():
        raise FileNotFoundError(f"Frontend build is missing: {index}. Run npm run build first.")
    icon = application_icon()
    if not icon.is_file():
        raise FileNotFoundError(f"Application icon is missing: {icon}.")
    if arguments == ["--smoke-test"]:
        importlib.import_module("webview.platforms.edgechromium")
        return 0
    if arguments:
        raise ValueError(f"Unsupported argument(s): {' '.join(arguments)}")
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    bridge = DesktopBridge()
    window = webview.create_window(
        "Password Manager v2",
        url=index.as_uri(),
        js_api=bridge,
        width=1240,
        height=780,
        min_size=(960, 620),
        maximized=True,
        background_color="#0b1120",
        text_select=True,
        zoomable=False,
    )
    if window is None:
        raise RuntimeError("Unable to create the desktop window.")
    bridge._attach_window(window)
    window.events.closed += bridge._shutdown
    webview.start(gui="edgechromium", debug=False, private_mode=True, icon=str(icon))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
