"""ProximVision-style fault management: threshold alarms and an event log."""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, asdict

SEVERITY_ORDER = {"critical": 0, "major": 1, "minor": 2, "info": 3}


@dataclass
class Alarm:
    link_id: int
    kind: str
    severity: str
    message: str
    raised_at: int  # simulation minute


class AlarmManager:
    def __init__(self, log_size: int = 300):
        self.active: dict[tuple[int, str], Alarm] = {}
        self.events: deque[dict] = deque(maxlen=log_size)
        self.raised_total = 0

    def _log(self, t: int, link_id: int, severity: str, text: str) -> None:
        self.events.appendleft({"t": t, "link": link_id, "severity": severity, "text": text})

    def set(self, t: int, link_id: int, kind: str, active: bool, severity: str, message: str) -> None:
        key = (link_id, kind)
        if active and key not in self.active:
            self.active[key] = Alarm(link_id, kind, severity, message, t)
            self.raised_total += 1
            self._log(t, link_id, severity, f"RAISED {kind}: {message}")
        elif not active and key in self.active:
            del self.active[key]
            self._log(t, link_id, "info", f"CLEARED {kind}")

    def event(self, t: int, link_id: int, text: str, severity: str = "info") -> None:
        self._log(t, link_id, severity, text)

    def snapshot(self) -> list[dict]:
        return sorted((asdict(a) for a in self.active.values()),
                      key=lambda a: (SEVERITY_ORDER[a["severity"]], a["link_id"]))
