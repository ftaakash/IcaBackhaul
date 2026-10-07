"""Generate a self-signed certificate for the NMS, as the case study's radios do.

    python scripts/gen_cert.py [--cn nms.local] [--out certs]
"""
from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID


def generate(cn: str, out: Path, days: int = 825) -> tuple[Path, Path]:
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn),
                      x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Backhaul Sim NMS")])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now)
            .not_valid_after(now + dt.timedelta(days=days))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(cn), x509.DNSName("localhost"),
                                                        x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), False)
            .sign(key, hashes.SHA256()))
    out.mkdir(parents=True, exist_ok=True)
    crt, kp = out / "nms.crt", out / "nms.key"
    crt.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    kp.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                     serialization.NoEncryption()))
    kp.chmod(0o600)
    return crt, kp


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--cn", default="nms.local")
    p.add_argument("--out", default="certs")
    a = p.parse_args()
    c, k = generate(a.cn, Path(a.out))
    print(f"wrote {c} and {k}")
