"""Ica site environment: diurnal heat, solar load on enclosures, paracas dust storms."""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .config import ICA_MONTHLY_HIGH_C, ICA_MONTHLY_LOW_C


@dataclass
class DustStorm:
    severity_db: float  # loss from dust on radomes + scattering (modelling assumption)
    remaining_min: int


class Environment:
    """Time advances in 1-minute steps.

    Modelling notes (be explicit in reports):
    * Ambient follows SENAMHI monthly normals with a sinusoid peaking at 15:00.
    * Solar load on an unshaded enclosure adds up to 18 C at noon; a sun shield
      removes ~60% of that. Radio self-heating adds 8 C (17 W typical draw).
    * Dust attenuation at 5 GHz in free air is small (<0.1 dB/km); the dominant
      effect of a paracas storm is deposits on radomes, modelled as 1-4 dB fixed
      loss plus 0.05 dB/km while the storm lasts.
    """

    SOLAR_GAIN_C = 18.0
    SELF_HEAT_C = 8.0

    def __init__(self, rng: np.random.Generator, month: int = 2, start_hour: float = 6.0,
                 storm_rate_per_min: float = 4e-4):
        self.rng = rng
        self.month = month  # 0 = January; March is the hottest month
        self.minute = int(start_hour * 60)
        self.storm_rate = storm_rate_per_min
        self.storm: DustStorm | None = None
        self.heatwave_c = 0.0
        self.sun_shield = False

    @property
    def hour(self) -> float:
        return (self.minute / 60.0) % 24

    @property
    def day(self) -> int:
        return self.minute // 1440

    def ambient_c(self) -> float:
        hi, lo = ICA_MONTHLY_HIGH_C[self.month], ICA_MONTHLY_LOW_C[self.month]
        phase = math.sin(2 * math.pi * (self.hour - 9) / 24)  # max at 15:00
        return lo + (hi - lo) * (0.5 + 0.5 * phase) + self.heatwave_c

    def solar_c(self) -> float:
        sun = max(0.0, math.sin(math.pi * (self.hour - 6) / 12))
        return self.SOLAR_GAIN_C * sun * (0.4 if self.sun_shield else 1.0)

    def radio_temp_c(self, jitter: float = 0.0) -> float:
        return self.ambient_c() + self.solar_c() + self.SELF_HEAT_C + jitter

    def dust_loss_db(self, distance_km: float) -> float:
        if not self.storm:
            return 0.0
        return self.storm.severity_db + 0.05 * distance_km

    def start_storm(self, severity_db: float | None = None, minutes: int | None = None) -> None:
        self.storm = DustStorm(float(self.rng.uniform(1, 4)) if severity_db is None else severity_db,
                               int(self.rng.integers(60, 240)) if minutes is None else minutes)

    def step(self) -> None:
        self.minute += 1
        if self.storm:
            self.storm.remaining_min -= 1
            if self.storm.remaining_min <= 0:
                self.storm = None
        elif 12 <= self.hour <= 18 and self.rng.random() < self.storm_rate:
            self.start_storm()  # paracas winds peak in the afternoon
