"""Core encryption and vault services for Password Manager v2."""

__version__ = "0.1.0"

from .crypto import KdfProfile
from .models import Record, new_record
from .vault import load_vault, read_records, write_records

__all__ = [
    "KdfProfile",
    "Record",
    "__version__",
    "load_vault",
    "new_record",
    "read_records",
    "write_records",
]
