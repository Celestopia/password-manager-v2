from pathlib import Path

import pytest

from password_manager_desktop.bridge import DesktopBridge
from password_manager_desktop.recent import RecentVaults


def test_history_order_limit_restart_and_case_deduplication(tmp_path: Path) -> None:
    store = RecentVaults(tmp_path / "history.json")
    paths = [tmp_path / f"vault{index}.pmdb" for index in range(4)]
    for path in paths:
        store.remember(path)
    assert RecentVaults(store.path).paths() == [str(path) for path in reversed(paths[1:])]
    store.remember(Path(str(paths[2]).upper()))
    assert len(store.paths()) == 3
    assert store.paths()[0].casefold() == str(paths[2]).casefold()
    store.remove(store.paths()[0])
    assert len(store.paths()) == 2


def test_history_missing_files_corruption_and_unwritable_storage(tmp_path: Path) -> None:
    store = RecentVaults(tmp_path / "history.json")
    missing = tmp_path / "missing.pmdb"
    store.remember(missing)
    assert store.selected(str(missing)) == missing
    assert store.directory(tmp_path / "fallback") == tmp_path
    with pytest.raises(PermissionError):
        store.selected(str(tmp_path / "arbitrary.pmdb"))
    store.path.write_text('{"version":1,"paths":["relative.pmdb"]}')
    assert store.paths() == []
    store.path.write_bytes(b"x" * 65_537)
    assert store.paths() == []
    blocked = RecentVaults(store.path / "child.json")
    blocked.remember(missing)
    assert blocked.paths() == []


def test_bridge_history_only_tracks_success_and_revalidates_recent(tmp_path: Path) -> None:
    bridge = DesktopBridge()
    path = tmp_path / "vault.pmdb"
    password = "synthetic master password"
    assert bridge.unlock_recent_vault(str(path), password)["ok"] is False
    bridge._grant(path, "create_vault")
    assert bridge.create_vault(str(path), password, 8)["ok"] is True
    bridge.lock_vault()
    assert bridge.list_recent_vaults()["data"] == [str(path)]
    assert bridge.unlock_recent_vault(str(path), "wrong")["ok"] is False
    assert bridge.list_recent_vaults()["data"] == [str(path)]
    assert bridge.unlock_recent_vault(str(path), password)["ok"] is True
    bridge.lock_vault()
    bridge.forget_recent_vault(str(path))
    assert path.exists()
    assert bridge.unlock_recent_vault(str(path), password)["ok"] is False
