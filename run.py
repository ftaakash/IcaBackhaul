"""Start the NMS dashboard.

    python run.py                 # http://127.0.0.1:8000
    python run.py --tls           # https with certs/ from scripts/gen_cert.py, TLS 1.2 minimum
"""
from __future__ import annotations

import argparse
import ssl
from pathlib import Path

import uvicorn


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--tls", action="store_true", help="serve HTTPS (management-plane mandate)")
    p.add_argument("--cert", default="certs/nms.crt")
    p.add_argument("--key", default="certs/nms.key")
    a = p.parse_args()

    kwargs = {}
    if a.tls:
        if not (Path(a.cert).exists() and Path(a.key).exists()):
            raise SystemExit("certificate missing: run  python scripts/gen_cert.py  first")
        kwargs = {"ssl_certfile": a.cert, "ssl_keyfile": a.key}

    config = uvicorn.Config("app.server:app", host=a.host, port=a.port, **kwargs)
    config.load()
    if config.ssl is not None:
        config.ssl.minimum_version = ssl.TLSVersion.TLSv1_2  # refuse TLS 1.0/1.1
    uvicorn.Server(config).run()


if __name__ == "__main__":
    main()
