from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Literal

LogLevel = Literal["debug", "info", "warn", "error"]

logger = logging.getLogger("meshmoose.jobs")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobLogger:
    """Append structured events to a job for UI + disk (never log secrets)."""

    def __init__(self, job_dir: Path) -> None:
        self.job_dir = job_dir
        self.events_path = job_dir / "events.jsonl"
        self.log_path = job_dir / "outputs" / "job.log"
        self._lock = threading.Lock()
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.events_path.parent.mkdir(parents=True, exist_ok=True)
        self._listeners: list[Callable[[dict[str, Any]], None]] = []

    def add_listener(self, callback: Callable[[dict[str, Any]], None]) -> None:
        self._listeners.append(callback)

    def emit(
        self,
        message: str,
        *,
        level: LogLevel = "info",
        kind: str = "log",
        **extra: Any,
    ) -> dict[str, Any]:
        event = {
            "ts": utc_now(),
            "level": level,
            "kind": kind,
            "message": message,
            **extra,
        }
        line = json.dumps(event, ensure_ascii=False)
        with self._lock:
            with self.events_path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
            with self.log_path.open("a", encoding="utf-8") as fh:
                fh.write(f"{event['ts']} {level.upper()} {message}\n")
        log_fn = {
            "debug": logger.debug,
            "info": logger.info,
            "warn": logger.warning,
            "error": logger.error,
        }.get(level, logger.info)
        log_fn("[%s] %s", self.job_dir.name, message)
        for listener in list(self._listeners):
            try:
                listener(event)
            except Exception:  # noqa: BLE001
                logger.exception("job event listener failed")
        return event

    def read_events(self, after: int = 0) -> list[dict[str, Any]]:
        """Return parsed events with index >= after (event count, not file line).

        ``emit`` writes one JSON object per non-empty line, so the already-seen
        prefix is skipped by counting lines — no ``json.loads`` until ``after``.
        """
        events, _ = self.read_events_with_cursor(after)
        return events

    def read_events_with_cursor(self, after: int = 0) -> tuple[list[dict[str, Any]], int]:
        """Like ``read_events``, also returning the next cursor index."""
        if not self.events_path.is_file():
            return [], max(0, after)
        events: list[dict[str, Any]] = []
        idx = 0
        with self.events_path.open(encoding="utf-8") as fh:
            for line in fh:
                raw = line.strip()
                if not raw:
                    continue
                if idx < after:
                    idx += 1
                    continue
                try:
                    events.append(json.loads(raw))
                except json.JSONDecodeError:
                    # Still advance so a corrupt line cannot stall the SSE cursor.
                    pass
                idx += 1
        return events, idx
