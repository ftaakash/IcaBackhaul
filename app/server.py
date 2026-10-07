"""ProximVision-style NMS: FastAPI backend that runs the simulation in real time."""
from __future__ import annotations

import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backhaul import Network, rf

STATIC = Path(__file__).parent / "static"
TICK_S = 0.25


class Control(BaseModel):
    action: str
    link_id: int | None = None
    value: float | bool | None = None


class Simulator:
    """Owns the network and advances it in a background thread."""

    def __init__(self, seed: int = 7, steps_per_tick: int = 2):
        self.lock = threading.RLock()
        self.running = True
        self.steps_per_tick = steps_per_tick
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.reset(seed)

    def reset(self, seed: int = 7) -> None:
        with self.lock:
            self.net = Network(seed=seed)

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            if self.running:
                with self.lock:
                    self.net.run(self.steps_per_tick)
            time.sleep(TICK_S)

    def state(self) -> dict:
        with self.lock:
            s = self.net.state()
        s["running"] = self.running
        s["speed"] = self.steps_per_tick
        return s

    def control(self, c: Control) -> None:
        with self.lock:
            net = self.net
            a = c.action
            if a in ("interfere", "tamper"):
                if c.link_id is None or not 0 <= c.link_id < len(net.links):
                    raise HTTPException(400, "valid link_id required")
                (net.inject_interference if a == "interfere" else net.tamper)(c.link_id)
            elif a == "pause":
                self.running = False
            elif a == "resume":
                self.running = True
            elif a == "speed":
                self.steps_per_tick = int(max(1, min(60, c.value or 1)))
            elif a == "step":
                net.run(int(max(1, min(1440, c.value or 1))))
            elif a == "clearconnect":
                net.clearconnect = bool(c.value)
            elif a == "licence":
                net.set_licence(bool(c.value))
            elif a == "sun_shield":
                net.env.sun_shield = bool(c.value)
            elif a == "heatwave":
                net.env.heatwave_c = 5.0 if c.value else 0.0
            elif a == "dust_storm":
                net.env.start_storm(severity_db=3.5, minutes=120)
                net.alarms.event(net.t, -1, "Paracas dust storm started (120 min)", "minor")
            elif a == "reset":
                self.reset(int(c.value or 7))
            else:
                raise HTTPException(400, f"unknown action {a!r}")


def create_app(autostart: bool = True) -> FastAPI:
    sim = Simulator()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if autostart:
            sim.start()
        yield
        sim.stop()

    app = FastAPI(title="Ica Backhaul NMS", lifespan=lifespan)
    app.state.sim = sim

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(STATIC / "index.html")

    @app.get("/api/state")
    def state() -> dict:
        return sim.state()

    @app.post("/api/control")
    def control(c: Control) -> dict:
        sim.control(c)
        return {"ok": True}

    @app.get("/api/link-budget")
    def link_budget() -> list[dict]:
        with sim.lock:
            net = sim.net
            rows = []
            for l in net.links:
                b = rf.link_budget(l.distance_km, l.channel.center, l.channel.width, l.max_tx_dbm,
                                   l.gain_dbi, net.radio.cable_loss_db, net.radio.noise_figure_db,
                                   obstacle_m=l.site.obstacle_m, eirp_limit_dbm=net.radio.eirp_limit_dbm)
                rows.append({"link": l.site.name, "distance_km": l.distance_km, "channel": l.channel.label(),
                             "eirp_dbm": round(b.eirp_dbm, 1), "fspl_db": round(b.fspl_db, 1),
                             "rx_dbm": round(b.rx_dbm, 1), "snr_db": round(b.snr_db, 1),
                             "clear_sky_mcs": b.mcs, "mast_height_m": round(b.mast_height_m, 1)})
            return rows

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()
