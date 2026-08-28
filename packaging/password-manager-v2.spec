# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path


project_root = Path(SPECPATH).resolve().parent
frontend_dist = project_root / "frontend" / "dist"

if not (frontend_dist / "index.html").is_file():
    raise FileNotFoundError("frontend/dist is missing; run npm run build before PyInstaller.")

a = Analysis(
    [str(project_root / "packaging" / "desktop_entry.py")],
    pathex=[str(project_root / "src")],
    binaries=[],
    datas=[(str(frontend_dist), "frontend/dist")],
    hiddenimports=["webview.platforms.edgechromium"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "pytest", "mypy", "ruff"],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="PasswordManagerV2",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="PasswordManagerV2",
)

