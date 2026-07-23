from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh

from meshmoose_api.logging_util import JobLogger
from meshmoose_api.threemf import load_mesh_from_3mf

MESH_EXTS = {".stl", ".obj", ".ply", ".xyz", ".txt", ".3mf"}


def _load_xyz(path: Path) -> np.ndarray:
    rows: list[list[float]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.replace(",", " ").split()
        if len(parts) < 3:
            continue
        try:
            rows.append([float(parts[0]), float(parts[1]), float(parts[2])])
        except ValueError:
            continue
    if len(rows) < 4:
        raise ValueError(f"{path.name}: need at least 4 XYZ points to build a mesh")
    return np.asarray(rows, dtype=np.float64)


def mesh_from_points(points: np.ndarray, log: JobLogger | None = None) -> trimesh.Trimesh:
    """Best-effort point cloud → mesh for Agent attachment (DIY fidelity)."""
    if log:
        log.emit(f"Meshing {len(points)} points (convex hull fallback for XYZ)", level="info")
    # Convex hull is a DIY approximation; logged so users understand limits.
    hull = trimesh.convex.convex_hull(points)
    if hull.is_empty:
        raise ValueError("Failed to build a mesh from point cloud")
    return hull


def ensure_stl_for_agent(
    mesh_paths: list[Path],
    out_stl: Path,
    log: JobLogger | None = None,
) -> Path:
    """Convert first usable mesh to STL for the Agent; prefer STL/PLY over XYZ."""
    if not mesh_paths:
        raise ValueError("At least one mesh file is required (stl, obj, ply, 3mf, xyz)")

    ordered = sorted(
        mesh_paths,
        key=lambda p: {
            ".stl": 0,
            ".obj": 1,
            ".ply": 2,
            ".3mf": 3,
            ".xyz": 4,
            ".txt": 5,
        }.get(p.suffix.lower(), 9),
    )
    src = ordered[0]
    ext = src.suffix.lower()
    if log:
        log.emit(f"Preprocess mesh: {src.name}", kind="preprocess")

    if ext == ".stl":
        out_stl.write_bytes(src.read_bytes())
        if log:
            log.emit(f"Using STL as-is → {out_stl.name}")
        return out_stl

    if ext in {".obj", ".ply", ".3mf"}:
        if ext == ".3mf":
            mesh = load_mesh_from_3mf(src)
        else:
            mesh = trimesh.load(src, force="mesh")
            if isinstance(mesh, trimesh.Scene):
                mesh = trimesh.util.concatenate(tuple(mesh.geometry.values()))
            if not isinstance(mesh, trimesh.Trimesh):
                raise ValueError(f"Could not load mesh from {src.name}")
        mesh.export(out_stl)
        if log:
            note = " (Zoo has no native 3MF; converted via trimesh)" if ext == ".3mf" else ""
            log.emit(
                f"Converted {src.name} → {out_stl.name} ({len(mesh.faces)} faces){note}"
            )
        return out_stl

    if ext in {".xyz", ".txt"}:
        points = _load_xyz(src)
        mesh = mesh_from_points(points, log=log)
        mesh.export(out_stl)
        if log:
            log.emit(
                f"Converted {src.name} → {out_stl.name} via convex hull "
                f"({len(mesh.faces)} faces). Expect approximate geometry.",
                level="warn",
            )
        return out_stl

    raise ValueError(f"Unsupported mesh type: {src.suffix}")
