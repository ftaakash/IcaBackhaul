"""Secure transport modelled on the case study's security layers.

L1 air:     proprietary framing (WORP-style header) + AES-GCM authenticated encryption
L2 access:  challenge-response registration with a shared secret (WORP uses an
            MD5-keyed secret string; HMAC-SHA256 is used here as the modern equivalent)
L3 network: 802.1Q-style VLAN id carried in the authenticated header
L4 mgmt:    TLS 1.2+ with a self-generated certificate (see scripts/gen_cert.py, run.py)

Framing is NOT a security control on its own; confidentiality and integrity come
from AES-GCM. The header is passed as associated data so it cannot be altered.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import struct

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

MAGIC = b"WP"
VERSION = 1
HEADER = struct.Struct(">2sBBHHBQ")  # magic, ver, type, link_id, vlan, direction, seq
TYPE_DATA, TYPE_MGMT = 1, 2
VLAN_SCADA, VLAN_CCTV, VLAN_CORP = 10, 20, 30


class AuthError(Exception):
    """Frame failed authentication (tampered, wrong key, or not our protocol)."""


class ReplayError(Exception):
    """Sequence number not newer than the last accepted one."""


def registration_response(secret: bytes, nonce: bytes, su_id: str) -> bytes:
    return hmac.new(secret, nonce + su_id.encode(), hashlib.sha256).digest()


class BaseStation:
    """Hub side: issues challenges and only admits subscribers that know the secret."""

    def __init__(self, secret: bytes, max_clients: int = 1):
        self.secret = secret
        self.max_clients = max_clients
        self.registered: set[str] = set()
        self._pending: dict[str, bytes] = {}

    def challenge(self, su_id: str) -> bytes | None:
        if len(self.registered) >= self.max_clients and su_id not in self.registered:
            return None  # stops announcing itself once full
        nonce = os.urandom(16)
        self._pending[su_id] = nonce
        return nonce

    def verify(self, su_id: str, response: bytes) -> bool:
        nonce = self._pending.pop(su_id, None)
        if nonce is None:
            return False
        ok = hmac.compare_digest(registration_response(self.secret, nonce, su_id), response)
        if ok:
            self.registered.add(su_id)
        return ok


def derive_session_key(secret: bytes, link_id: int, salt: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt,
                info=b"backhaul-sim link %d" % link_id).derive(secret)


class SecureChannel:
    """One direction of an encrypted, replay-protected link."""

    def __init__(self, key: bytes, link_id: int, direction: int):
        self.aead = AESGCM(key)
        self.link_id = link_id
        self.direction = direction
        self.tx_seq = 0
        self.rx_seq = -1

    def _nonce(self, direction: int, seq: int) -> bytes:
        return struct.pack(">HBxQ", self.link_id, direction, seq)  # 12 bytes, unique per key/dir

    def seal(self, payload: bytes, vlan: int, ftype: int = TYPE_DATA) -> bytes:
        self.tx_seq += 1
        header = HEADER.pack(MAGIC, VERSION, ftype, self.link_id, vlan, self.direction, self.tx_seq)
        return header + self.aead.encrypt(self._nonce(self.direction, self.tx_seq), payload, header)

    def open(self, frame: bytes) -> tuple[int, int, bytes]:
        if len(frame) < HEADER.size + 16:
            raise AuthError("short frame")
        header = frame[:HEADER.size]
        magic, ver, ftype, link_id, vlan, direction, seq = HEADER.unpack(header)
        if magic != MAGIC or ver != VERSION or link_id != self.link_id:
            raise AuthError("not a frame for this link")
        try:
            payload = self.aead.decrypt(self._nonce(direction, seq), frame[HEADER.size:], header)
        except Exception as exc:  # cryptography raises InvalidTag
            raise AuthError("authentication tag mismatch") from exc
        if seq <= self.rx_seq:
            raise ReplayError(f"seq {seq} <= {self.rx_seq}")
        self.rx_seq = seq
        return vlan, ftype, payload


def establish_link(link_id: int, secret: bytes) -> tuple[SecureChannel, SecureChannel]:
    """Register the remote unit, then build uplink sender (site) and receiver (hub)."""
    bs = BaseStation(secret)
    su_id = f"SU-{link_id:02d}"
    nonce = bs.challenge(su_id)
    if nonce is None or not bs.verify(su_id, registration_response(secret, nonce, su_id)):
        raise AuthError("registration failed")
    key = derive_session_key(secret, link_id, nonce)
    return SecureChannel(key, link_id, 0), SecureChannel(key, link_id, 0)
