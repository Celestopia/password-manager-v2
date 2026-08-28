"""Dependency and package smoke tests for the development environment."""


def test_runtime_dependencies_import() -> None:
    import argon2  # noqa: F401
    import cryptography  # noqa: F401
    import webview  # noqa: F401


def test_project_package_imports() -> None:
    import password_manager_core
    import password_manager_desktop  # noqa: F401

    assert password_manager_core.__version__ == "0.1.0"

