"""Mesh alignment and deviation analysis between reference and generated STL.

ICP registration (trimesh) plus per-vertex distance sampling for the Compare
view heatmap. Distances are vertex-to-surface from the generated mesh onto the
reference, so the client can color the generated mesh by local deviation.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import trimesh

# Cap vertex counts so ICP/proximity stay interactive on large scans.
MAX_SAMPLES = 20000


def _load(path: Path) -> trimesh.Trimesh:
    mesh = trimesh.load(path, force="mesh")
    if isinstance(mesh, trimesh.Scene):
        geoms = tuple(mesh.geometry.values())
        if not geoms:
            raise ValueError(f"No geometry in {path.name}")
        mesh = trimesh.util.concatenate(geoms)
    if not isinstance(mesh, trimesh.Trimesh):
        raise ValueError(f"Could not load mesh from {path.name}")
    return mesh


def _subsample_idx(n_vertices: int, max_n: int = MAX_SAMPLES) -> np.ndarray:
    """Deterministic linspace indices into a vertex array of length n_vertices."""
    if n_vertices <= max_n:
        return np.arange(n_vertices, dtype=np.int64)
    return np.linspace(0, n_vertices - 1, max_n).astype(np.int64)


def align_meshes(
    *,
    reference_stl: Path,
    generated_stl: Path,
    sample: int = 4000,
) -> dict[str, Any]:
    """ICP-align generated onto reference; return transform + deviation stats.

    The transform maps generated-mesh coordinates into reference space and is
    meant to be applied client-side to the generated (overlay) mesh.
    """
    ref = _load(reference_stl)
    gen = _load(generated_stl)

    ref_pts = ref.vertices[_subsample_idx(len(ref.vertices), sample)]
    gen_pts = gen.vertices[_subsample_idx(len(gen.vertices), sample)]

    matrix, _transformed, cost = trimesh.registration.icp(
        gen_pts,
        ref_pts,
        max_iterations=60,
    )

    aligned = trimesh.Trimesh(vertices=gen.vertices.copy(), faces=gen.faces, process=False)
    aligned.apply_transform(matrix)

    # Per-vertex distance from aligned generated → reference surface.
    query_idx = _subsample_idx(len(aligned.vertices), MAX_SAMPLES)
    query_pts = aligned.vertices[query_idx]
    _closest, distances, _tid = trimesh.proximity.closest_point(ref, query_pts)

    dist = np.asarray(distances, dtype=np.float64)
    finite = dist[np.isfinite(dist)]
    stats: dict[str, Any] = {
        "samples": int(len(query_pts)),
        "mean": float(finite.mean()) if finite.size else None,
        "max": float(finite.max()) if finite.size else None,
        "p95": float(np.percentile(finite, 95)) if finite.size else None,
        "rms": float(np.sqrt((finite**2).mean())) if finite.size else None,
        "icp_cost": float(cost),
    }

    return {
        "transform": np.asarray(matrix, dtype=float).tolist(),
        "vertex_indices": query_idx.tolist(),
        "distances": dist.tolist(),
        "stats": stats,
        "units": "mm",
    }
