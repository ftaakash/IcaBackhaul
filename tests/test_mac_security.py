import pytest

from backhaul import security as sec
from backhaul.mac import simulate_csma, simulate_worp


def test_worp_flat_and_near_75pct():
    assert simulate_worp(5) == pytest.approx(0.75, abs=0.01)
    assert simulate_worp(50) == pytest.approx(simulate_worp(5))


def test_csma_degrades_with_contention_and_hidden_nodes():
    few = simulate_csma(5, n_frames=5000)
    many = simulate_csma(50, n_frames=5000)
    hidden = simulate_csma(50, n_frames=5000, hidden_frac=0.3)
    assert few > many > hidden
    assert simulate_worp(50) > few


def test_registration_needs_secret():
    bs = sec.BaseStation(b"s" * 32)
    nonce = bs.challenge("SU-1")
    assert not bs.verify("SU-1", sec.registration_response(b"wrong" * 6, nonce, "SU-1"))
    nonce = bs.challenge("SU-1")
    assert bs.verify("SU-1", sec.registration_response(b"s" * 32, nonce, "SU-1"))


def test_base_station_stops_announcing_when_full():
    bs = sec.BaseStation(b"k" * 32, max_clients=1)
    n = bs.challenge("SU-1")
    bs.verify("SU-1", sec.registration_response(b"k" * 32, n, "SU-1"))
    assert bs.challenge("ROGUE") is None


def test_roundtrip_tamper_and_replay():
    tx, rx = sec.establish_link(3, b"x" * 32)
    frame = tx.seal(b"breaker 52 closed", sec.VLAN_SCADA)
    assert rx.open(frame) == (sec.VLAN_SCADA, sec.TYPE_DATA, b"breaker 52 closed")
    with pytest.raises(sec.ReplayError):
        rx.open(frame)
    bad = tx.seal(b"reading", sec.VLAN_SCADA)
    with pytest.raises(sec.AuthError):
        rx.open(bad[:-1] + bytes([bad[-1] ^ 1]))
    # VLAN id is authenticated: moving a frame to another VLAN breaks the tag.
    good = tx.seal(b"reading", sec.VLAN_SCADA)
    hdr = bytearray(good[:sec.HEADER.size])
    hdr[6:8] = sec.VLAN_CORP.to_bytes(2, "big")
    with pytest.raises(sec.AuthError):
        rx.open(bytes(hdr) + good[sec.HEADER.size:])


def test_ciphertext_hides_payload():
    tx, _ = sec.establish_link(1, b"y" * 32)
    assert b"secret-setpoint" not in tx.seal(b"secret-setpoint", sec.VLAN_SCADA)
