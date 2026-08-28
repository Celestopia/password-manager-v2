"""Application-specific exception hierarchy."""


class PasswordManagerError(Exception):
    """Base class for expected password-manager failures."""


class VaultFormatError(PasswordManagerError):
    """Raised when a vault does not match the supported binary format."""


class VaultAuthenticationError(PasswordManagerError):
    """Raised when a vault cannot be authenticated with a supplied password."""


class VaultBusyError(PasswordManagerError):
    """Raised when another process already holds the vault write lock."""


class VaultConflictError(PasswordManagerError):
    """Raised when the vault changed on disk after it was unlocked."""


class RecordValidationError(PasswordManagerError):
    """Raised when a password record violates the fixed schema."""


class RecordLookupError(PasswordManagerError):
    """Raised when a record lookup has zero or multiple results."""


class SessionStateError(PasswordManagerError):
    """Raised when an operation is invalid for the current vault session."""


class PlaintextConfirmationError(PasswordManagerError):
    """Raised when plaintext export was not explicitly acknowledged."""

