"""Static configuration: sites, radio parameters and climate data.

The site layout is ILLUSTRATIVE. The Proxim case study confirms 15 point-to-point
links between Electro Dunas offices, thermal plants and the data center in Ica,
but does not publish the site map. Distances and bearings below are plausible
values for a city-scale backhaul, chosen so the link mix spans 1.8-13.8 km.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

# Hub = data center, Ica city centre.
HUB_NAME = "Data Center"
HUB_LAT, HUB_LON = -14.0678, -75.7286


@dataclass(frozen=True)
class Site:
    name: str
    kind: str          # "office" | "thermal" | "substation"
    bearing_deg: float  # from the hub
    distance_km: float
    cameras: int        # CCTV streams backhauled from the site
    obstacle_m: float   # tallest obstruction near mid-path (buildings, dunes)

    @property
    def latlon(self) -> tuple[float, float]:
        return offset_latlon(HUB_LAT, HUB_LON, self.bearing_deg, self.distance_km)


def offset_latlon(lat: float, lon: float, bearing_deg: float, dist_km: float) -> tuple[float, float]:
    """Great-circle destination point."""
    r = 6371.0
    b, la, lo, d = math.radians(bearing_deg), math.radians(lat), math.radians(lon), dist_km / r
    la2 = math.asin(math.sin(la) * math.cos(d) + math.cos(la) * math.sin(d) * math.cos(b))
    lo2 = lo + math.atan2(math.sin(b) * math.sin(d) * math.cos(la), math.cos(d) - math.sin(la) * math.sin(la2))
    return math.degrees(la2), math.degrees(lo2)


SITES: tuple[Site, ...] = (
    Site("Head Office", "office", 15, 1.8, 2, 12),
    Site("Commercial Office Centro", "office", 70, 2.5, 1, 15),
    Site("Substation Norte", "substation", 350, 3.2, 2, 10),
    Site("Thermal Plant A", "thermal", 200, 4.0, 4, 8),
    Site("Branch Office Sur", "office", 165, 4.6, 1, 12),
    Site("Substation Este", "substation", 95, 5.5, 2, 9),
    Site("Operations Base", "office", 300, 6.3, 3, 10),
    Site("Thermal Plant B", "thermal", 230, 7.0, 4, 6),
    Site("Substation Oeste", "substation", 270, 7.8, 2, 8),
    Site("Branch Office Norte", "office", 30, 8.5, 1, 10),
    Site("Thermal Plant C", "thermal", 130, 9.4, 4, 7),
    Site("Substation Sureste", "substation", 145, 10.2, 2, 9),
    Site("Branch Office Valle", "office", 320, 11.5, 1, 14),
    Site("Thermal Plant D", "thermal", 185, 12.6, 4, 6),
    Site("Substation Lejana", "substation", 55, 13.8, 2, 12),
)


@dataclass
class RadioConfig:
    """Tsunami QB-10100L parameters (Proxim QB-10100 datasheet)."""
    tx_power_max_dbm: float = 28.0      # dual chain
    tx_power_min_dbm: float = 1.0       # 0-27 dB control range
    antenna_gain_dbi: float = 22.0      # QB-10150 integrated panel
    long_range_gain_dbi: float = 28.0   # QB-10150-LKL, used above long_range_km
    long_range_km: float = 8.0
    cable_loss_db: float = 0.5
    noise_figure_db: float = 6.0
    eirp_limit_dbm: float = 50.0        # PtP limit; set per national regulation (MTC Peru)
    channel_width_mhz: int = 40
    licence_cap_mbps: float = 320.0     # 10100L ships "over 320 Mbps usable"
    upgraded_cap_mbps: float = 670.0    # field upgrade by licence key
    max_operating_temp_c: float = 60.0  # datasheet: -40 to 60 C
    shutdown_temp_c: float = 70.0       # modelled protective shutdown


# SENAMHI 1991-2020 normals for Ica (San Camilo), converted from deg F.
ICA_MONTHLY_HIGH_C = (31.7, 32.8, 33.3, 31.7, 29.4, 26.1, 25.0, 26.1, 27.8, 29.4, 30.0, 31.1)
ICA_MONTHLY_LOW_C = (17.8, 18.9, 17.8, 15.6, 12.2, 10.6, 10.6, 10.6, 11.1, 12.2, 13.3, 15.6)
