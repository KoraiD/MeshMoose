from __future__ import annotations

import asyncio
import os
import threading
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import TypeVar

from meshmoose_api.logging_util import JobLogger
from meshmoose_api.threemf import stl_to_3mf

# zoo-kcl reads the token from process env, which is shared across job threads.
# Serialize exports so one job's token can never leak into another job's call,
# and restore the prior env afterwards so tokens never linger in the process.
_EXPORT_LOCK = threading.Lock()
_TOKEN_ENV_KEYS = ("ZOO_API_TOKEN", "KITTYCAD_API_TOKEN")

# Engine websocket hangups are often transient; zoo-kcl marks them retryable.
MAX_EXPORT_ATTEMPTS = 3

_T = TypeVar("_T")


async def _execute_with_retries(
    log: JobLogger,
    label: str,
    async_fn: Callable[..., Awaitable[_T]],
    *args: object,
) -> _T:
    """Retry Zoo Engine exports when KclError.is_retryable() is true."""
    attempts_left = MAX_EXPORT_ATTEMPTS
    while True:
        try:
            return await async_fn(*args)
        except Exception as error:  # noqa: BLE001 — kcl raises KclError / others
            attempts_left -= 1
            is_retryable = getattr(error, "is_retryable", None)
            if attempts_left > 0 and callable(is_retryable) and is_retryable():
                log.emit(
                    f"{label} hit a retryable Engine error "
                    f"({attempts_left} attempt(s) left): {error}",
                    level="warn",
                    kind="export",
                )
                await asyncio.sleep(0.75 * (MAX_EXPORT_ATTEMPTS - attempts_left))
                continue
            raise


def export_kcl(
    *,
    token: str,
    main_kcl: str,
    out_stl: Path,
    out_step: Path,
    log: JobLogger,
    out_3mf: Path | None = None,
) -> None:
    import kcl

    with _EXPORT_LOCK:
        saved = {key: os.environ.get(key) for key in _TOKEN_ENV_KEYS}
        os.environ["ZOO_API_TOKEN"] = token
        os.environ["KITTYCAD_API_TOKEN"] = token
        try:
            _export_stl_step(kcl, main_kcl, out_stl, out_step, log)
        finally:
            for key, prior in saved.items():
                if prior is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = prior

    # Zoo has no native 3MF; derive from the STL for slicer / print workflows.
    target_3mf = out_3mf if out_3mf is not None else out_stl.with_suffix(".3mf")
    try:
        log.emit("Converting STL → 3MF (trimesh; Zoo has no native 3MF)", kind="export")
        stl_to_3mf(out_stl, target_3mf, log=log)
    except Exception as exc:  # noqa: BLE001
        log.emit(f"3MF export skipped: {exc}", level="warn", kind="export")


def _export_stl_step(kcl, main_kcl: str, out_stl: Path, out_step: Path, log: JobLogger) -> None:
    async def _run() -> None:
        log.emit("Exporting KCL → STL via Engine", kind="export")
        stl_files = await _execute_with_retries(
            log,
            "STL export",
            kcl.execute_code_and_export,
            main_kcl,
            kcl.FileExportFormat.Stl,
        )
        out_stl.write_bytes(stl_files[0].contents)
        log.emit(
            f"Wrote {out_stl.name} ({out_stl.stat().st_size} B)",
            kind="artifact",
            path=f"outputs/{out_stl.name}",
            name=out_stl.name,
        )

        log.emit("Exporting KCL → STEP via Engine", kind="export")
        step_files = await _execute_with_retries(
            log,
            "STEP export",
            kcl.execute_code_and_export,
            main_kcl,
            kcl.FileExportFormat.Step,
        )
        out_step.write_bytes(step_files[0].contents)
        log.emit(
            f"Wrote {out_step.name} ({out_step.stat().st_size} B)",
            kind="artifact",
            path=f"outputs/{out_step.name}",
            name=out_step.name,
        )

    asyncio.run(_run())
