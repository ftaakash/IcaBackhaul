"""5 GHz spectrum model: channel plan, third-party interferers and DFS radar."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .rf import power_sum_dbm

# Contiguous blocks of 20 MHz channel centres inside 5.150-5.925 GHz.
BLOCKS_MHZ: tuple[tuple[int, ...], ...] = (
    (5180, 5200, 5220, 5240, 5260, 5280, 5300, 5320),                     # U-NII-1/2A
    (5500, 5520, 5540, 5560, 5580, 5600, 5620, 5640, 5660, 5680, 5700, 5720),  # U-NII-2C
    (5745, 5765, 5785, 5805, 5825, 5845, 5865, 5885, 5905),               # U-NII-3 + 5.9
)
DFS_RANGE_MHZ = (5250, 5730)  # radar-detection channels


@dataclass(frozen=True)
class Channel:
    members: tuple[int, ...]  # 20 MHz centres covered

    @property
    def width(self) -> int:
        return 20 * len(self.members)

    @property
    def center(self) -> float:
        return sum(self.members) / len(self.members)

    @property
    def dfs(self) -> bool:
        return any(DFS_RANGE_MHZ[0] <= m <= DFS_RANGE_MHZ[1] for m in self.members)

    def overlap_mhz(self, other: "Channel") -> int:
        return 20 * len(set(self.members) & set(other.members))

    def label(self) -> str:
        return f"{self.center:.0f}/{self.width}"


def channels_for_width(width: int) -> list[Channel]:
    k = width // 20
    out = []
    for block in BLOCKS_MHZ:
        for start in range(0, len(block) - k + 1, k):
            out.append(Channel(tuple(block[start:start + k])))
    return out


@dataclass
class Interferer:
    channel: Channel
    level_dbm: float           # level at a reference receiver
    p_on: float                # off -> on per step
    p_off: float               # on -> off per step
    active: bool = False
    coupling: dict[int, float] = field(default_factory=dict)  # receiver id -> dB offset


class Spectrum:
    """Third-party users of the unlicensed band plus radar on DFS channels.

    Receiver ids: -1 is the hub (data center mast), 0..n-1 are remote sites.
    """

    def __init__(self, rng: np.random.Generator, n_interferers: int = 30, radar_rate: float = 2e-4):
        self.rng = rng
        self.radar_rate = radar_rate
        self.interferers: list[Interferer] = []
        self.nol: dict[Channel, int] = {}  # DFS non-occupancy list -> steps remaining
        for _ in range(n_interferers):
            self.add_interferer()

    def add_interferer(self, channel: Channel | None = None, level_dbm: float | None = None,
                       duty: float | None = None, receivers: dict[int, float] | None = None) -> Interferer:
        rng = self.rng
        if channel is None:
            width = int(rng.choice([20, 40, 80], p=[0.5, 0.35, 0.15]))
            channel = channels_for_width(width)[rng.integers(len(channels_for_width(width)))]
        duty = float(rng.uniform(0.1, 0.7)) if duty is None else duty
        p_off = float(rng.uniform(0.02, 0.2))
        p_on = p_off * duty / max(1e-6, 1 - duty)
        itf = Interferer(channel, float(rng.uniform(-96, -66)) if level_dbm is None else level_dbm,
                         min(p_on, 1.0), p_off, active=bool(rng.random() < duty))
        if receivers:
            itf.coupling.update(receivers)
        self.interferers.append(itf)
        return itf

    def _coupling(self, itf: Interferer, rx: int) -> float:
        if rx not in itf.coupling:
            # Directional antennas: most interferers are far off-axis for a given receiver.
            itf.coupling[rx] = float(np.clip(self.rng.normal(-10, 7), -40, 6))
        return itf.coupling[rx]

    def step(self) -> None:
        for itf in self.interferers:
            if itf.active:
                itf.active = self.rng.random() >= itf.p_off
            else:
                itf.active = self.rng.random() < itf.p_on
        for ch in list(self.nol):
            self.nol[ch] -= 1
            if self.nol[ch] <= 0:
                del self.nol[ch]

    def interference_dbm(self, channel: Channel, rx: int, include_inactive: bool = False) -> float:
        levels = []
        for itf in self.interferers:
            if not (itf.active or include_inactive):
                continue
            ov = channel.overlap_mhz(itf.channel)
            if ov == 0:
                continue
            frac = ov / itf.channel.width  # interferer power spread over its bandwidth
            weight = 1.0 if itf.active else 0.4  # scans average over the duty cycle
            levels.append(itf.level_dbm + self._coupling(itf, rx) + 10 * np.log10(frac * weight))
        return power_sum_dbm(*levels)

    def radar_hit(self, channel: Channel) -> bool:
        return channel.dfs and self.rng.random() < self.radar_rate

    def block_channel(self, channel: Channel, steps: int = 30) -> None:
        """Radar seen: channel goes on the non-occupancy list (30 min)."""
        self.nol[channel] = steps

    def allowed(self, channel: Channel) -> bool:
        return not any(channel.overlap_mhz(b) for b in self.nol)
