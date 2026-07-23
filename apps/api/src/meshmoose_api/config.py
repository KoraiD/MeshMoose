from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

# .../apps/api/src/meshmoose_api/config.py → repo root is parents[4]
ROOT = Path(__file__).resolve().parents[4]


def data_dir() -> Path:
    path = Path(os.environ.get("MESHMOOSE_DATA_DIR", ROOT / "data")).resolve()
    path.mkdir(parents=True, exist_ok=True)
    (path / "jobs").mkdir(exist_ok=True)
    return path


def configure_logging(level: str | int = logging.INFO) -> None:
    """Configure process-wide logging once (stdout, user-visible via job stream too)."""
    root = logging.getLogger()
    if getattr(root, "_meshmoose_configured", False):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s [%(name)s] %(message)s",
            datefmt="%H:%M:%S",
        )
    )
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)
    setattr(root, "_meshmoose_configured", True)
