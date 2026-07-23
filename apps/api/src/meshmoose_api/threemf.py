"""3MF helpers via trimesh (Zoo has no native 3MF import/export)."""

from __future__ import annotations

from pathlib import Path

import trimesh

from meshmoose_api.logging_util import JobLogger


def load_mesh_from_3mf(path: Path) -> trimesh.Trimesh:
    loaded = trimesh.load(path, force="mesh")
    if isinstance(loaded, trimesh.Scene):
        geoms = tuple(loaded.geometry.values())
        if not geoms:
            raise ValueError(f"No geometry in {path.name}")
        loaded = trimesh.util.concatenate(geoms)
    if not isinstance(loaded, trimesh.Trimesh):
        raise ValueError(f"Could not load mesh from {path.name}")
    return loaded


def stl_to_3mf(stl_path: Path, out_3mf: Path, log: JobLogger | None = None) -> Path:
    """Convert an STL mesh to 3MF for download / slicers."""
    mesh = trimesh.load(stl_path, force="mesh")
    if isinstance(mesh, trimesh.Scene):
        mesh = trimesh.util.concatenate(tuple(mesh.geometry.values()))
    if not isinstance(mesh, trimesh.Trimesh):
        raise ValueError(f"Could not load STL for 3MF export: {stl_path.name}")
    out_3mf.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(out_3mf)
    if log:
        log.emit(
            f"Wrote {out_3mf.name} ({out_3mf.stat().st_size} B) via trimesh (Zoo has no native 3MF)",
            kind="artifact",
            path=f"outputs/{out_3mf.name}",
            name=out_3mf.name,
        )
    return out_3mf
