from __future__ import annotations

import asyncio
import os
from pathlib import Path

from meshmoose_api.logging_util import JobLogger
from meshmoose_api.threemf import stl_to_3mf


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

    os.environ["ZOO_API_TOKEN"] = token
    os.environ["KITTYCAD_API_TOKEN"] = token

    async def _run() -> None:
        log.emit("Exporting KCL → STL via Engine", kind="export")
        stl_files = await kcl.execute_code_and_export(
            main_kcl, kcl.FileExportFormat.Stl
        )
        out_stl.write_bytes(stl_files[0].contents)
        log.emit(
            f"Wrote {out_stl.name} ({out_stl.stat().st_size} B)",
            kind="artifact",
            path=f"outputs/{out_stl.name}",
            name=out_stl.name,
        )

        log.emit("Exporting KCL → STEP via Engine", kind="export")
        step_files = await kcl.execute_code_and_export(
            main_kcl, kcl.FileExportFormat.Step
        )
        out_step.write_bytes(step_files[0].contents)
        log.emit(
            f"Wrote {out_step.name} ({out_step.stat().st_size} B)",
            kind="artifact",
            path=f"outputs/{out_step.name}",
            name=out_step.name,
        )

    asyncio.run(_run())

    # Zoo has no native 3MF; derive from the STL for slicer / print workflows.
    target_3mf = out_3mf if out_3mf is not None else out_stl.with_suffix(".3mf")
    try:
        log.emit("Converting STL → 3MF (trimesh; Zoo has no native 3MF)", kind="export")
        stl_to_3mf(out_stl, target_3mf, log=log)
    except Exception as exc:  # noqa: BLE001
        log.emit(f"3MF export skipped: {exc}", level="warn", kind="export")
