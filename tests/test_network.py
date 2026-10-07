import pytest
from fastapi.testclient import TestClient

from app.server import create_app
from backhaul import Network
from backhaul.network import hub_isolation_db


@pytest.fixture(scope="module")
def day_runs():
    on = Network(seed=11)
    off = Network(seed=11, clearconnect=False)
    on.run(1440)
    off.run(1440)
    return on, off


def test_fifteen_links_planned_on_distinct_channels_where_bearings_close():
    net = Network(seed=3)
    assert len(net.links) == 15
    for a in net.links:
        for b in net.links:
            if a.id < b.id and hub_isolation_db(a.site.bearing_deg, b.site.bearing_deg) <= 10:
                assert a.channel.overlap_mhz(b.channel) == 0


def test_eirp_never_exceeded(day_runs):
    on, _ = day_runs
    for l in on.links:
        assert l.tx_power_dbm + l.gain_dbi - on.radio.cable_loss_db <= on.radio.eirp_limit_dbm + 1e-9


def test_clearconnect_beats_legacy(day_runs):
    on, off = day_runs
    k_on, k_off = on.kpis(), off.kpis()
    assert k_on["availability_pct"] > k_off["availability_pct"]
    assert k_on["scada_delivery_pct"] >= k_off["scada_delivery_pct"]


def test_capacity_respects_licence_cap(day_runs):
    on, _ = day_runs
    assert all(l.capacity_mbps <= 320 for l in on.links)
    up = Network(seed=21, licence_upgraded=True, hub_isolation_bonus_db=20)
    up.run(60)
    assert any(l.wide for l in up.links)
    assert max(l.capacity_mbps for l in up.links) > 320
    assert all(l.capacity_mbps <= 670 for l in up.links)


def test_wide_channels_only_where_clean():
    net = Network(seed=21, licence_upgraded=True)
    assert all(l.distance_km <= 5.0 for l in net.links if l.wide)


def test_strict_priority_under_congestion():
    net = Network(seed=4)
    link = next(l for l in net.links if l.site.kind == "thermal")  # 4 cameras = 16 Mbps CCTV
    link.capacity_mbps = 5.0
    net._traffic(link)
    s, c, d = (link.stats[k] for k in ("scada", "cctv", "data"))
    assert s.delivered == pytest.approx(s.offered)            # telemetry always gets through
    assert c.delivered == pytest.approx(5.0 - s.offered)      # video takes what is left
    assert d.delivered == 0                                     # corporate data waits


def test_tamper_is_detected():
    net = Network(seed=5)
    net.run(5)
    net.tamper(0)
    net.run(1)
    assert net.links[0].frames_rejected == 1 or not net.links[0].up


def test_injected_interference_triggers_dcs():
    net = Network(seed=2)
    net.run(30)
    before = net.links[4].dcs_events
    net.inject_interference(4, level_dbm=-45)
    net.run(30)
    assert net.links[4].dcs_events > before


def test_sun_shield_lowers_radio_temperature():
    a, b = Network(seed=1), Network(seed=1, sun_shield=True)
    a.env.minute = b.env.minute = 13 * 60
    assert b.env.radio_temp_c() < a.env.radio_temp_c() - 5


def test_api_state_and_controls():
    client = TestClient(create_app(autostart=False))
    s = client.get("/api/state").json()
    assert len(s["links"]) == 15 and "kpis" in s
    assert client.post("/api/control", json={"action": "step", "value": 10}).status_code == 200
    assert client.get("/api/state").json()["t"] == 10
    assert client.post("/api/control", json={"action": "interfere", "link_id": 99}).status_code == 400
    assert client.post("/api/control", json={"action": "nope"}).status_code == 400
    rows = client.get("/api/link-budget").json()
    assert len(rows) == 15 and all(r["mast_height_m"] > 0 for r in rows)
