"""Authenticated vault container and Argon2id key derivation.

The byte layout remains compatible with Password Manager v1::

    PMGRVAULT | uint32-be header length | JSON header | AEAD ciphertext

The exact header bytes, including the length prefix and magic value, are AEAD
associated data. Resource limits are deliberately checked before Argon2id is
invoked because the header has not yet been authenticated at that point.
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import struct
from dataclasses import dataclass
from typing import Any, Final

from argon2.low_level import Type, hash_secret_raw
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305

from .exceptions import VaultAuthenticationError, VaultFormatError

MAGIC: Final[bytes] = b"PMGRVAULT"
HEADER_LEN_SIZE: Final[int] = 4
VERSION: Final[int] = 1
SALT_SIZE: Final[int] = 16
NONCE_SIZE: Final[int] = 12
KEY_SIZE: Final[int] = 32

MIN_MEMORY_COST_KIB: Final[int] = 8_192
MAX_MEMORY_COST_KIB: Final[int] = 1_048_576
MAX_TIME_COST: Final[int] = 20
MAX_PARALLELISM: Final[int] = 16
MAX_HEADER_SIZE: Final[int] = 65_536

HEADER_FIELDS: Final[frozenset[str]] = frozenset({"version", "format", "kdf", "cipher"})
KDF_FIELDS: Final[frozenset[str]] = frozenset(
    {"name", "salt", "time_cost", "memory_cost", "parallelism", "hash_len"}
)
CIPHER_FIELDS: Final[frozenset[str]] = frozenset({"name", "nonce"})


@dataclass(frozen=True)
class KdfProfile:
    """Reusable Argon2id cost settings, excluding the per-write salt."""

    time_cost: int = 3
    memory_cost: int = 65_536
    parallelism: int = 1

    def validate(self) -> None:
        """Reject unsafe, invalid, or resource-exhausting cost settings."""

        values = (self.time_cost, self.memory_cost, self.parallelism)
        if any(not isinstance(value, int) or isinstance(value, bool) for value in values):
            raise VaultFormatError("Invalid Argon2id cost parameters.")
        if not 1 <= self.time_cost <= MAX_TIME_COST:
            raise VaultFormatError("Argon2id time cost is outside the supported range.")
        if not MIN_MEMORY_COST_KIB <= self.memory_cost <= MAX_MEMORY_COST_KIB:
            raise VaultFormatError("Argon2id memory cost is outside the supported range.")
        if not 1 <= self.parallelism <= MAX_PARALLELISM:
            raise VaultFormatError("Argon2id parallelism is outside the supported range.")


@dataclass(frozen=True)
class KdfParams:
    """Complete Argon2id parameters stored in a vault header."""

    salt: bytes
    time_cost: int = 3
    memory_cost: int = 65_536
    parallelism: int = 1
    hash_len: int = KEY_SIZE

    @classmethod
    def fresh(cls, profile: KdfProfile | None = None) -> KdfParams:
        """Create parameters with a new salt and the requested cost profile."""

        selected = profile or KdfProfile()
        selected.validate()
        return cls(
            salt=os.urandom(SALT_SIZE),
            time_cost=selected.time_cost,
            memory_cost=selected.memory_cost,
            parallelism=selected.parallelism,
        )

    @property
    def profile(self) -> KdfProfile:
        """Return reusable cost settings without the current salt."""

        return KdfProfile(
            time_cost=self.time_cost,
            memory_cost=self.memory_cost,
            parallelism=self.parallelism,
        )

    def to_json(self) -> dict[str, Any]:
        """Convert parameters to the strict header representation."""

        return {
            "name": "argon2id",
            "salt": b64encode(self.salt),
            "time_cost": self.time_cost,
            "memory_cost": self.memory_cost,
            "parallelism": self.parallelism,
            "hash_len": self.hash_len,
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> KdfParams:
        """Parse and bound untrusted KDF parameters before derivation."""

        require_exact_fields(data, KDF_FIELDS, "KDF parameters")
        if data.get("name") != "argon2id":
            raise VaultFormatError("Unsupported KDF in vault header.")
        if not isinstance(data.get("salt"), str):
            raise VaultFormatError("Invalid KDF salt in vault header.")
        for key in ("time_cost", "memory_cost", "parallelism", "hash_len"):
            if not isinstance(data.get(key), int) or isinstance(data[key], bool):
                raise VaultFormatError("Invalid KDF parameters in vault header.")
        try:
            salt = b64decode(data["salt"])
        except (ValueError, binascii.Error) as exc:
            raise VaultFormatError("Invalid KDF salt in vault header.") from exc
        params = cls(
            salt=salt,
            time_cost=data["time_cost"],
            memory_cost=data["memory_cost"],
            parallelism=data["parallelism"],
            hash_len=data["hash_len"],
        )
        if params.hash_len != KEY_SIZE:
            raise VaultFormatError("Unsupported derived key length in vault header.")
        if len(params.salt) < SALT_SIZE:
            raise VaultFormatError("KDF salt is too short.")
        params.profile.validate()
        return params


def b64encode(value: bytes) -> str:
    """Encode bytes as unpadded URL-safe base64."""

    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def b64decode(value: str) -> bytes:
    """Decode unpadded URL-safe base64."""

    padding = "=" * (-len(value) % 4)
    return base64.b64decode(value + padding, altchars=b"-_", validate=True)


def require_exact_fields(data: dict[str, Any], expected: frozenset[str], label: str) -> None:
    """Reject both missing and unsupported fields in a fixed-schema object."""

    fields = set(data)
    missing = sorted(expected - fields)
    if missing:
        raise VaultFormatError(f"{label} missing required field(s): {', '.join(missing)}.")
    extra = sorted(fields - expected)
    if extra:
        raise VaultFormatError(f"{label} contains unsupported field(s): {', '.join(extra)}.")


def derive_key(master_password: str, params: KdfParams) -> bytes:
    """Derive a 256-bit ChaCha20 key from a non-empty master password."""

    if not master_password:
        raise VaultAuthenticationError("Master password cannot be empty.")
    params.profile.validate()
    return hash_secret_raw(
        secret=master_password.encode("utf-8"),
        salt=params.salt,
        time_cost=params.time_cost,
        memory_cost=params.memory_cost,
        parallelism=params.parallelism,
        hash_len=params.hash_len,
        type=Type.ID,
    )


def make_header(params: KdfParams, nonce: bytes) -> dict[str, Any]:
    """Build a version-1 vault header."""

    return {
        "version": VERSION,
        "format": "jsonl",
        "kdf": params.to_json(),
        "cipher": {"name": "chacha20-poly1305", "nonce": b64encode(nonce)},
    }


def encode_header(header: dict[str, Any]) -> bytes:
    """Serialize a header deterministically."""

    return json.dumps(header, sort_keys=True, separators=(",", ":")).encode("utf-8")


def encrypt_payload(
    plaintext: bytes,
    master_password: str,
    *,
    kdf_profile: KdfProfile | None = None,
    kdf_params: KdfParams | None = None,
) -> bytes:
    """Encrypt plaintext into a complete compatible vault container."""

    if kdf_profile is not None and kdf_params is not None:
        raise ValueError("Specify either kdf_profile or kdf_params, not both.")
    params = kdf_params or KdfParams.fresh(kdf_profile)
    params.profile.validate()
    nonce = os.urandom(NONCE_SIZE)
    header_bytes = encode_header(make_header(params, nonce))
    if len(header_bytes) > MAX_HEADER_SIZE:
        raise VaultFormatError("Vault header is too large.")
    header_len = struct.pack(">I", len(header_bytes))
    aad = MAGIC + header_len + header_bytes
    key = derive_key(master_password, params)
    ciphertext = ChaCha20Poly1305(key).encrypt(nonce, plaintext, aad)
    return aad + ciphertext


def decrypt_payload(vault_bytes: bytes, master_password: str) -> bytes:
    """Authenticate and decrypt a complete vault container."""

    header, header_bytes, ciphertext = split_vault(vault_bytes)
    params = KdfParams.from_json(header["kdf"])
    cipher = header["cipher"]
    require_exact_fields(cipher, CIPHER_FIELDS, "Cipher parameters")
    if cipher.get("name") != "chacha20-poly1305":
        raise VaultFormatError("Unsupported cipher in vault header.")
    if not isinstance(cipher.get("nonce"), str):
        raise VaultFormatError("Invalid cipher nonce in vault header.")
    try:
        nonce = b64decode(cipher["nonce"])
    except (ValueError, binascii.Error) as exc:
        raise VaultFormatError("Invalid cipher nonce in vault header.") from exc
    if len(nonce) != NONCE_SIZE:
        raise VaultFormatError("Invalid cipher nonce length in vault header.")
    aad = MAGIC + struct.pack(">I", len(header_bytes)) + header_bytes
    key = derive_key(master_password, params)
    try:
        return ChaCha20Poly1305(key).decrypt(nonce, ciphertext, aad)
    except InvalidTag as exc:
        raise VaultAuthenticationError(
            "Vault authentication failed. The master password may be wrong, or the vault may be corrupted."
        ) from exc


def split_vault(vault_bytes: bytes) -> tuple[dict[str, Any], bytes, bytes]:
    """Parse container boundaries and validate the unauthenticated header shape."""

    prefix_size = len(MAGIC) + HEADER_LEN_SIZE
    if len(vault_bytes) < prefix_size:
        raise VaultFormatError("Vault file is too small.")
    if not vault_bytes.startswith(MAGIC):
        raise VaultFormatError("Vault file has an invalid magic header.")
    header_len = struct.unpack(">I", vault_bytes[len(MAGIC) : prefix_size])[0]
    if not 0 < header_len <= MAX_HEADER_SIZE:
        raise VaultFormatError("Vault file has an invalid header length.")
    header_end = prefix_size + header_len
    if header_end > len(vault_bytes):
        raise VaultFormatError("Vault file has a truncated header.")
    header_bytes = vault_bytes[prefix_size:header_end]
    ciphertext = vault_bytes[header_end:]
    if not ciphertext:
        raise VaultFormatError("Vault file has no encrypted payload.")
    try:
        header = json.loads(header_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise VaultFormatError("Vault header is not valid JSON.") from exc
    if not isinstance(header, dict):
        raise VaultFormatError("Vault header is not a JSON object.")
    require_exact_fields(header, HEADER_FIELDS, "Vault header")
    if not isinstance(header.get("version"), int) or isinstance(header["version"], bool):
        raise VaultFormatError("Invalid vault version.")
    if header["version"] != VERSION:
        raise VaultFormatError("Unsupported vault version.")
    if header.get("format") != "jsonl":
        raise VaultFormatError("Unsupported vault payload format.")
    if not isinstance(header.get("kdf"), dict):
        raise VaultFormatError("Invalid KDF parameters in vault header.")
    if not isinstance(header.get("cipher"), dict):
        raise VaultFormatError("Invalid cipher parameters in vault header.")
    return header, header_bytes, ciphertext
