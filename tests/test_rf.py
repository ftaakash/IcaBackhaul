import math

import pytest

from backhaul import rf


def test_fspl_known_value():
    # 1 km at 5800 MHz: 20log(1)+20log(5800)+32.44 = 107.71 dB
    assert rf.fspl_db(1, 5800) == pytest.approx(107.71, abs=0.01)


def test_fspl_doubles_distance_adds_6db():
    assert rf.fspl_db(10, 5800) - rf.fspl_db(5, 5800) == pytest.approx(6.02, abs=0.01)


def test_noise_floor_40mhz():
    assert rf.noise_floor_dbm(40, 6) == pytest.approx(-174 + 76.02 + 6, abs=0.01)


def test_fresnel_midpoint_10km():
    # r1 = 17.32*sqrt(5*5/(5.8*10)) ~ 11.37 m
    assert rf.fresnel_radius_m(5, 5, 5.8) == pytest.approx(11.37, abs=0.05)


def test_mast_height_grows_with_distance():
    assert rf.required_mast_height_m(12, 5.8, 10) > rf.required_mast_height_m(3, 5.8, 10) > 10


def test_datasheet_throughput_reproduced():
    for width, expected in rf.DATASHEET_MAX_MBPS.items():
        top = max(i for i, r in enumerate(rf.PHY_RATE_MBPS[width]) if r)
        assert rf.mac_throughput_mbps(top, width) == pytest.approx(expected)


def test_best_mcs_monotonic_and_skips_undefined():
    picks = [rf.best_mcs(s, 40) for s in range(0, 45)]
    assert picks == sorted(picks)
    assert rf.best_mcs(50, 20) == 8  # MCS9 undefined at 20 MHz
    assert rf.best_mcs(0, 40) == -1


def test_per_falls_with_margin():
    assert rf.packet_error_rate(10, 4) > rf.packet_error_rate(18, 4) > rf.packet_error_rate(24, 4)
    assert rf.packet_error_rate(30, -1) == 1.0


def test_power_sum():
    assert rf.power_sum_dbm(-90, -90) == pytest.approx(-86.99, abs=0.01)
    assert rf.power_sum_dbm() < -200


def test_link_budget_respects_eirp_limit():
    b = rf.link_budget(5, 5800, 40, 28, 22, eirp_limit_dbm=40)
    assert b.eirp_dbm == 40
    assert math.isclose(b.snr_db, b.rx_dbm - b.noise_dbm)
