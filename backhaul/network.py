"""The 15-link backhaul: per-minute simulation of every radio pair."""
from __future__ import annotations

import json
import math
from collections import deque
from dataclasses import dataclass, field

import numpy as np

from . import rf
from .config import SITES, RadioConfig, Site, HUB_NAME
from .environment import Environment
from .nms import AlarmManager
from .security import AuthError, ReplayError, VLAN_SCADA, establish_link
from .spectrum import Channel, Spectrum, channels_for_width

HUB = -1
DCS_RETRY_THRESHOLD = 0.15
DCS_HOLD_STEPS = 3
DDRS_MARGIN_DB = 3.0
ATPC_FADE_MARGIN_DB = 4.0
WIDE_CHANNEL_MAX_KM = 5.0
CLEAN_SIR_DB = 38.0  # an 80 MHz link must leave every affected link this much SIR

# Offered load per site type (Mbps): SCADA telemetry, per-camera CCTV, corporate data mean.
SCADA_MBPS = 0.3
CCTV_MBPS_PER_CAM = 4.0
DATA_MEAN_MBPS = {"office": 60.0, "thermal": 15.0, "substation": 6.0}


def hub_isolation_db(bearing_a: float, bearing_b: float) -> float:
    """Isolation between co-located hub antennas pointing in different directions."""
    diff = abs((bearing_a - bearing_b + 180) % 360 - 180)
    if diff >= 60:
        return 40.0
    if diff >= 30:
        return 30.0
    if diff >= 15:
        return 20.0
    return 10.0


@dataclass
class ClassStats:
    offered: float = 0.0
    delivered: float = 0.0


@dataclass
class Link:
    id: int
    site: Site
    radio: RadioConfig
    channel: Channel | None = None
    tx_power_dbm: float = 0.0
    mcs: int = -1
    fixed_mcs: int | None = None  # legacy mode: rate chosen once at install
    wide: bool = False            # running an 80 MHz channel (needs the 670 Mbps licence)
    sinr_db: float = 0.0
    per: float = 1.0
    capacity_mbps: float = 0.0
    up: bool = False
    temp_c: float = 25.0
    retry_streak: int = 0
    outage_steps: int = 0
    steps: int = 0
    up_steps: int = 0
    dcs_events: int = 0
    radar_events: int = 0
    frames_ok: int = 0
    frames_rejected: int = 0
    offered_mbps: float = 0.0
    delivered_mbps: float = 0.0
    stats: dict[str, ClassStats] = field(default_factory=lambda: {k: ClassStats() for k in ("scada", "cctv", "data")})
    history: deque = field(default_factory=lambda: deque(maxlen=180))

    @property
    def distance_km(self) -> float:
        return self.site.distance_km

    @property
    def gain_dbi(self) -> float:
        r = self.radio
        return r.long_range_gain_dbi if self.distance_km > r.long_range_km else r.antenna_gain_dbi

    @property
    def max_tx_dbm(self) -> float:
        """Highest tx power that respects both hardware and the EIRP limit."""
        r = self.radio
        return min(r.tx_power_max_dbm, r.eirp_limit_dbm - self.gain_dbi + r.cable_loss_db)

    @property
    def availability(self) -> float:
        return self.up_steps / self.steps if self.steps else 0.0


class Network:
    def __init__(self, seed: int = 7, clearconnect: bool = True, licence_upgraded: bool = False,
                 sun_shield: bool = False, month: int = 2, n_interferers: int = 30,
                 radar_rate: float = 2e-4, storm_rate: float = 4e-4, demand_scale: float = 1.0,
                 hub_isolation_bonus_db: float = 0.0,
                 radio: RadioConfig | None = None, sites: tuple[Site, ...] = SITES):
        self.seed = seed
        self.demand_scale = demand_scale
        self.hub_isolation_bonus_db = hub_isolation_bonus_db  # e.g. split hub across two masts
        self.rng = np.random.default_rng(seed)
        self.radio = radio or RadioConfig()
        self.clearconnect = clearconnect
        self.licence_upgraded = licence_upgraded
        self.env = Environment(self.rng, month=month, storm_rate_per_min=storm_rate)
        self.env.sun_shield = sun_shield
        self.spectrum = Spectrum(self.rng, n_interferers=n_interferers, radar_rate=radar_rate)
        self.alarms = AlarmManager()
        self.links = [Link(i, s, self.radio) for i, s in enumerate(sites)]
        self.total_history: deque = deque(maxlen=360)
        secret = self.rng.bytes(32)
        self._tunnels = {l.id: establish_link(l.id, secret) for l in self.links}
        self._tamper_next: set[int] = set()
        self.t = 0
        self._install()

    # ---------- installation: ACS channel plan + install-time rate --------------
    def _clear_sky_rx_dbm(self, link: Link, ch: Channel) -> float:
        r = self.radio
        tx = link.tx_power_dbm or link.max_tx_dbm
        return tx + 2 * (link.gain_dbi - r.cable_loss_db) - rf.fspl_db(link.distance_km, ch.center)

    def _candidate_score(self, link: Link, ch: Channel, assigned: list[Link]) -> float:
        """Lower is better: minus the worst signal-to-interference ratio the choice creates.

        Both directions count: what the band and the other hub radios do to this link, and
        what this link would do to each of them. Ranking by SIR (not raw dBm) lets a short,
        strong link share spectrum that would ruin a long, weak one.
        """
        ext = rf.power_sum_dbm(self.spectrum.interference_dbm(ch, HUB, include_inactive=True),
                               self.spectrum.interference_dbm(ch, link.id, include_inactive=True))
        own_in = [self._own_interference(link, o, victim_ch=ch) for o in assigned]
        worst = self._clear_sky_rx_dbm(link, ch) - rf.power_sum_dbm(ext, *own_in)
        for o in assigned:
            leak = self._own_interference(o, link, aggressor_ch=ch)
            if leak > -200:
                worst = min(worst, self._clear_sky_rx_dbm(o, o.channel) - leak)
        return -worst

    def _own_interference(self, victim: Link, aggressor: Link, victim_ch: Channel | None = None,
                          aggressor_ch: Channel | None = None) -> float:
        """Co-located hub radio of another link leaking into the victim's receiver."""
        vch = victim_ch or victim.channel
        ach = aggressor_ch or aggressor.channel
        if aggressor is victim or vch is None or ach is None:
            return -300.0
        ov = vch.overlap_mhz(ach)
        if ov == 0:
            return -300.0
        # Near-field coupling between adjacent panels on the same mast.
        tx = aggressor.tx_power_dbm or aggressor.max_tx_dbm
        return (tx - 45.0 - self.hub_isolation_bonus_db
                - hub_isolation_db(victim.site.bearing_deg, aggressor.site.bearing_deg)
                + 10 * math.log10(ov / ach.width))

    def acs(self, link: Link, others: list[Link] | None = None) -> Channel:
        """Automatic Channel Selection: least-interfered allowed channel."""
        others = [o for o in (others if others is not None else self.links) if o is not link and o.channel]
        cands = [c for c in channels_for_width(self.width_for(link)) if self.spectrum.allowed(c)]
        return min(cands, key=lambda c: self._candidate_score(link, c, others))

    def _install(self) -> None:
        assigned: list[Link] = []
        for link in self.links:
            link.channel = None
        # Wide (80 MHz) channels are hardest to place, then long links with least margin.
        for link in sorted(self.links, key=lambda l: (not self._wide_eligible(l), -l.distance_km)):
            link.tx_power_dbm = link.max_tx_dbm
            link.wide = self._wide_eligible(link)
            link.channel = self.acs(link, assigned)
            if link.wide and self._candidate_score(link, link.channel, assigned) > -CLEAN_SIR_DB:
                link.wide = False  # no clean 80 MHz slot left: stay at 40 MHz
                link.channel = self.acs(link, assigned)
            assigned.append(link)
        for link in self.links:
            sinr = self._sinr(link, fading_db=0.0)
            # Legacy practice: lock the rate at install with a generous 6 dB margin.
            link.fixed_mcs = max(0, rf.best_mcs(sinr, self.width_for(link), margin_db=6.0))
            link.mcs = link.fixed_mcs

    # ---------- physics ----------------------------------------------------------
    def _rx_dbm(self, link: Link, fading_db: float) -> float:
        r = self.radio
        eirp = link.tx_power_dbm + link.gain_dbi - r.cable_loss_db
        loss = rf.fspl_db(link.distance_km, link.channel.center) + self.env.dust_loss_db(link.distance_km)
        return eirp - loss + link.gain_dbi - r.cable_loss_db + fading_db

    def _sinr(self, link: Link, fading_db: float) -> float:
        rx = self._rx_dbm(link, fading_db)
        noise = rf.noise_floor_dbm(link.channel.width, self.radio.noise_figure_db)
        i_hub = rf.power_sum_dbm(self.spectrum.interference_dbm(link.channel, HUB),
                                 *(self._own_interference(link, o) for o in self.links))
        i_site = self.spectrum.interference_dbm(link.channel, link.id)
        sinr_hub = rx - rf.power_sum_dbm(noise, i_hub)
        sinr_site = rx - rf.power_sum_dbm(noise, i_site)
        return min(sinr_hub, sinr_site)

    @property
    def cap_mbps(self) -> float:
        return self.radio.upgraded_cap_mbps if self.licence_upgraded else self.radio.licence_cap_mbps

    def width_for(self, link: Link) -> int:
        """The 670 Mbps licence needs 80 MHz channels, which only short, high-SNR links can
        afford: 80 MHz costs 3 dB of noise and leaves just 7 channels for 15 co-located radios."""
        return 80 if link.wide else self.radio.channel_width_mhz

    def _wide_eligible(self, link: Link) -> bool:
        return self.licence_upgraded and link.distance_km <= WIDE_CHANNEL_MAX_KM

    def set_licence(self, upgraded: bool) -> None:
        """Apply the field licence key and replan channels for the new width."""
        if upgraded == self.licence_upgraded:
            return
        self.licence_upgraded = upgraded
        self._install()
        self.alarms.event(self.t, -1, f"Licence {'upgraded to 670' if upgraded else 'set to 320'} Mbps; "
                                      f"{sum(l.wide for l in self.links)} links moved to clean 80 MHz channels")

    # ---------- per-minute step --------------------------------------------------
    def step(self) -> None:
        self.t += 1
        self.env.step()
        self.spectrum.step()
        for link in self.links:
            width = self.width_for(link)
            link.steps += 1
            link.temp_c = self.env.radio_temp_c(jitter=float(self.rng.normal(0, 0.8)))

            # DFS: radar on our channel forces an immediate move, ClearConnect or not.
            if self.spectrum.radar_hit(link.channel):
                self.spectrum.block_channel(link.channel)
                old = link.channel
                link.channel = self.acs(link)  # every radio rescans after radar (regulatory)
                if not self.clearconnect:  # legacy radios re-negotiate a fixed rate on re-association
                    link.fixed_mcs = max(0, rf.best_mcs(self._sinr(link, 0.0), self.width_for(link), 6.0))
                link.radar_events += 1
                link.outage_steps = 1  # channel availability check
                self.alarms.event(self.t, link.id, f"DFS radar on {old.label()}, moved to {link.channel.label()}", "minor")

            # Thermal protection.
            thermal_derate = 3.0 if link.temp_c > self.radio.max_operating_temp_c else 0.0
            shutdown = link.temp_c > self.radio.shutdown_temp_c

            fading = float(self.rng.normal(0, 1.0))
            tx_saved = link.tx_power_dbm
            link.tx_power_dbm = tx_saved - thermal_derate
            sinr = self._sinr(link, fading)
            link.tx_power_dbm = tx_saved
            link.sinr_db = sinr

            if self.clearconnect:
                link.mcs = rf.best_mcs(sinr, width, DDRS_MARGIN_DB)                       # DDRS
                top = max(i for i, r in enumerate(rf.PHY_RATE_MBPS[width]) if r)
                target = rf.SNR_THRESHOLD_DB[top] + DDRS_MARGIN_DB + ATPC_FADE_MARGIN_DB  # ATPC
                if sinr > target + 1:
                    link.tx_power_dbm = max(self.radio.tx_power_min_dbm, link.tx_power_dbm - 1)
                elif sinr < target - 1:
                    link.tx_power_dbm = min(link.max_tx_dbm, link.tx_power_dbm + 1)
                mcs = link.mcs
            else:
                link.tx_power_dbm = link.max_tx_dbm
                mcs = link.fixed_mcs
                link.mcs = mcs

            per = rf.packet_error_rate(sinr, mcs) if mcs >= 0 else 1.0
            link.per = per
            goodput = (1 - 0.5 * per) if self.clearconnect else (1 - per)  # HARQ vs plain ARQ
            raw = rf.mac_throughput_mbps(mcs, width) * goodput
            in_outage = link.outage_steps > 0
            link.outage_steps = max(0, link.outage_steps - 1)
            link.up = mcs >= 0 and per < 0.5 and not shutdown and not in_outage
            link.capacity_mbps = min(raw, self.cap_mbps) if link.up else 0.0
            link.up_steps += link.up

            # DCS: persistent retries -> rescan and hop.
            if self.clearconnect and not in_outage:
                bad = per > DCS_RETRY_THRESHOLD or not link.up
                link.retry_streak = link.retry_streak + 1 if bad else 0
                if link.retry_streak >= DCS_HOLD_STEPS and not shutdown:
                    new = self.acs(link)
                    if new != link.channel:
                        self.alarms.event(self.t, link.id,
                                          f"DCS: SINR {sinr:.0f} dB, retries {per:.0%}, "
                                          f"{link.channel.label()} -> {new.label()}")
                        link.channel = new
                        link.dcs_events += 1
                        link.outage_steps = 1 if new.dfs else 0
                    link.retry_streak = 0

            self._traffic(link)
            self._telemetry(link)
            self._alarms(link, shutdown)
            link.history.append(round(link.delivered_mbps, 1))

        self.total_history.append(round(sum(l.delivered_mbps for l in self.links), 1))

    def _traffic(self, link: Link) -> None:
        g = self.demand_scale  # growth factor for capacity planning (1.0 = today)
        demand = {
            "scada": SCADA_MBPS,
            "cctv": CCTV_MBPS_PER_CAM * link.site.cameras * g,
            "data": float(self.rng.lognormal(math.log(DATA_MEAN_MBPS[link.site.kind] * g), 0.5)),
        }
        left = link.capacity_mbps
        for cls in ("scada", "cctv", "data"):  # strict priority, like WORP service flows
            got = min(demand[cls], left)
            left -= got
            link.stats[cls].offered += demand[cls]
            link.stats[cls].delivered += got
        link.offered_mbps = sum(demand.values())
        link.delivered_mbps = link.capacity_mbps - left

    def _telemetry(self, link: Link) -> None:
        """Send one SCADA reading over the encrypted tunnel when the link is up."""
        if not link.up:
            return
        tx, rx = self._tunnels[link.id]
        reading = json.dumps({"site": link.site.name, "t": self.t, "temp_c": round(link.temp_c, 1),
                              "sinr_db": round(link.sinr_db, 1)}).encode()
        frame = tx.seal(reading, VLAN_SCADA)
        if link.id in self._tamper_next:
            self._tamper_next.discard(link.id)
            frame = frame[:-1] + bytes([frame[-1] ^ 0x01])  # attacker flips one bit
        try:
            vlan, _, payload = rx.open(frame)
            assert vlan == VLAN_SCADA and payload == reading
            link.frames_ok += 1
        except (AuthError, ReplayError) as exc:
            link.frames_rejected += 1
            self.alarms.event(self.t, link.id, f"Security: frame rejected ({exc})", "major")

    def _alarms(self, link: Link, shutdown: bool) -> None:
        a, t, i = self.alarms, self.t, link.id
        a.set(t, i, "link_down", not link.up, "critical", "link down")
        a.set(t, i, "low_sinr", link.up and link.sinr_db < 15, "major", f"SINR {link.sinr_db:.1f} dB")
        a.set(t, i, "high_retries", link.up and link.per > 0.10, "minor", f"retries {link.per:.0%}")
        a.set(t, i, "over_temp", link.temp_c > self.radio.max_operating_temp_c, "major",
              f"radio at {link.temp_c:.1f} C" + (" (shutdown)" if shutdown else ""))
        a.set(t, i, "congested", link.up and link.offered_mbps > link.capacity_mbps * 1.02, "minor",
              f"offered {link.offered_mbps:.0f} > capacity {link.capacity_mbps:.0f} Mbps")

    # ---------- operator actions (dashboard controls) ---------------------------
    def inject_interference(self, link_id: int, level_dbm: float = -45.0) -> None:
        link = self.links[link_id]
        self.spectrum.add_interferer(link.channel, level_dbm=level_dbm, duty=0.95,
                                     receivers={HUB: 0.0, link.id: 0.0})
        self.alarms.event(self.t, link_id, f"Test: strong interferer added on {link.channel.label()}", "minor")

    def tamper(self, link_id: int) -> None:
        self._tamper_next.add(link_id)

    def run(self, minutes: int) -> None:
        for _ in range(minutes):
            self.step()

    # ---------- reporting --------------------------------------------------------
    def kpis(self) -> dict:
        n = len(self.links)
        scada_off = sum(l.stats["scada"].offered for l in self.links)
        scada_del = sum(l.stats["scada"].delivered for l in self.links)
        cctv_off = sum(l.stats["cctv"].offered for l in self.links)
        cctv_del = sum(l.stats["cctv"].delivered for l in self.links)
        return {
            "links_up": sum(l.up for l in self.links),
            "links": n,
            "availability_pct": round(100 * sum(l.availability for l in self.links) / n, 3),
            "capacity_mbps": round(sum(l.capacity_mbps for l in self.links), 1),
            "delivered_mbps": round(sum(l.delivered_mbps for l in self.links), 1),
            "mean_sinr_db": round(float(np.mean([l.sinr_db for l in self.links])), 1),
            "scada_delivery_pct": round(100 * scada_del / scada_off, 3) if scada_off else 100.0,
            "cctv_delivery_pct": round(100 * cctv_del / cctv_off, 3) if cctv_off else 100.0,
            "dcs_events": sum(l.dcs_events for l in self.links),
            "radar_events": sum(l.radar_events for l in self.links),
            "frames_ok": sum(l.frames_ok for l in self.links),
            "frames_rejected": sum(l.frames_rejected for l in self.links),
            "active_alarms": len(self.alarms.active),
        }

    def state(self) -> dict:
        env = self.env
        return {
            "t": self.t,
            "t0": env.minute - self.t,  # clock minute at simulation start (for event times)
            "day": env.day,
            "clock": f"{int(env.hour):02d}:{int(env.minute % 60):02d}",
            "ambient_c": round(env.ambient_c(), 1),
            "storm": bool(env.storm),
            "heatwave": env.heatwave_c > 0,
            "sun_shield": env.sun_shield,
            "clearconnect": self.clearconnect,
            "licence_upgraded": self.licence_upgraded,
            "cap_mbps": self.cap_mbps,
            "hub": HUB_NAME,
            "kpis": self.kpis(),
            "links": [{
                "id": l.id, "name": l.site.name, "kind": l.site.kind,
                "bearing": l.site.bearing_deg, "distance_km": l.distance_km,
                "channel": l.channel.label(), "dfs": l.channel.dfs,
                "tx_dbm": round(l.tx_power_dbm, 1), "gain_dbi": l.gain_dbi,
                "mcs": l.mcs, "modulation": rf.MODULATION[l.mcs] if l.mcs >= 0 else "-",
                "sinr_db": round(l.sinr_db, 1), "per_pct": round(100 * l.per, 2),
                "capacity_mbps": round(l.capacity_mbps, 1), "delivered_mbps": round(l.delivered_mbps, 1),
                "offered_mbps": round(l.offered_mbps, 1), "temp_c": round(l.temp_c, 1),
                "up": l.up, "availability_pct": round(100 * l.availability, 2),
                "dcs_events": l.dcs_events, "history": list(l.history)[-60:],
            } for l in self.links],
            "total_history": list(self.total_history),
            "alarms": self.alarms.snapshot(),
            "events": list(self.alarms.events)[:60],
        }
