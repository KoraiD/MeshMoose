"""Simulate a high-quality but incomplete 3D scan from a clean mesh.

Used for pipeline tests: photo + partial noisy mesh → Agent reconstruction.
`--missing` is the primary control for how much geometry is gone; artifacts add
localized scan defects without destroying the rest of the surface.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np
import trimesh

from meshmoose_api.threemf import load_mesh_from_3mf

SUPPORTED_IN = {".stl", ".ply", ".obj", ".3mf"}


@dataclass
class ScanCorruptParams:
    """Controls how aggressively a clean mesh is damaged."""

    missing_pct: float = 0.3
    """Fraction of faces removed by a planar cut (0–0.85). Main incompleteness knob."""

    noise: float = 0.4
    """Surface noise strength (0 = none, 1 ≈ ~0.6% of bbox diagonal RMS)."""

    artifacts: int = 3
    """Number of localized scan artifacts (holes, spikes, floaters, thin dropout strips)."""

    seed: int | None = 42
    """RNG seed for reproducible corruption."""

    keep_largest: bool = False
    """If True, drop every component but the largest after the planar cut.
    Default False so multi-part prints (legs + ring) stay intact."""


def load_mesh_file(path: Path | str) -> trimesh.Trimesh:
    src = Path(path)
    if not src.is_file():
        raise FileNotFoundError(f"Mesh not found: {src}")
    ext = src.suffix.lower()
    if ext not in SUPPORTED_IN:
        raise ValueError(
            f"Unsupported mesh type '{ext}'. Use: {', '.join(sorted(SUPPORTED_IN))}"
        )
    if ext == ".3mf":
        mesh = load_mesh_from_3mf(src)
    else:
        loaded = trimesh.load(src, force="mesh")
        if isinstance(loaded, trimesh.Scene):
            geoms = tuple(loaded.geometry.values())
            if not geoms:
                raise ValueError(f"No geometry in {src.name}")
            loaded = trimesh.util.concatenate(geoms)
        if not isinstance(loaded, trimesh.Trimesh):
            raise ValueError(f"Could not load mesh from {src.name}")
        mesh = loaded
    mesh = mesh.copy()
    mesh.remove_unreferenced_vertices()
    if mesh.is_empty or len(mesh.faces) < 4:
        raise ValueError(f"Mesh too small after load: {src.name}")
    return mesh


def _bbox_diag(mesh: trimesh.Trimesh) -> float:
    extents = mesh.bounding_box.extents
    diag = float(np.linalg.norm(extents))
    return max(diag, 1e-6)


def _submesh_faces(mesh: trimesh.Trimesh, keep_mask: np.ndarray) -> trimesh.Trimesh:
    keep_idx = np.nonzero(keep_mask)[0]
    if len(keep_idx) < 4:
        return mesh
    out = mesh.submesh([keep_idx], append=True)
    if not isinstance(out, trimesh.Trimesh) or out.is_empty or len(out.faces) < 4:
        return mesh
    return out


def _keep_largest_component(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    parts = mesh.split(only_watertight=False)
    if not parts:
        return mesh
    parts = sorted(parts, key=lambda m: len(m.faces), reverse=True)
    return parts[0]


def _planar_missing(
    mesh: trimesh.Trimesh, missing_pct: float, rng: np.random.Generator
) -> trimesh.Trimesh:
    """Drop approximately `missing_pct` of faces on the far side of a random plane."""
    pct = float(np.clip(missing_pct, 0.0, 0.85))
    if pct <= 0 or len(mesh.faces) < 8:
        return mesh

    centers = mesh.triangles_center
    direction = rng.normal(size=3)
    direction = direction / (np.linalg.norm(direction) + 1e-12)
    projections = centers @ direction
    cutoff = np.quantile(projections, 1.0 - pct)
    keep = projections <= cutoff
    # Guarantee we never keep fewer than ~12% of faces from a bad quantile edge case.
    min_keep = max(4, int(len(mesh.faces) * 0.12))
    if int(keep.sum()) < min_keep:
        order = np.argsort(projections)
        keep = np.zeros(len(mesh.faces), dtype=bool)
        keep[order[: min(len(order), max(min_keep, int(len(order) * (1.0 - pct))))]] = True
    return _submesh_faces(mesh, keep)


def _add_normal_noise(
    mesh: trimesh.Trimesh, noise: float, rng: np.random.Generator
) -> None:
    strength = float(np.clip(noise, 0.0, 2.0))
    if strength <= 0:
        return
    # Milder than before: 0.6% of diagonal at noise=1 (was 1.0%).
    sigma = _bbox_diag(mesh) * 0.006 * strength
    try:
        normals = mesh.vertex_normals
    except Exception:  # noqa: BLE001
        normals = np.zeros_like(mesh.vertices)
        normals[:, 2] = 1.0
    displace = normals * rng.normal(0.0, sigma, size=(len(mesh.vertices), 1))
    displace += rng.normal(0.0, sigma * 0.25, size=mesh.vertices.shape)
    mesh.vertices = mesh.vertices + displace


def _remove_local_faces(
    mesh: trimesh.Trimesh,
    center: np.ndarray,
    radius: float,
    *,
    max_frac: float,
    rng: np.random.Generator,
) -> trimesh.Trimesh:
    """Remove faces near `center`, capped to `max_frac` of total faces."""
    centers = mesh.triangles_center
    dist = np.linalg.norm(centers - center, axis=1)
    candidates = np.nonzero(dist <= radius)[0]
    if len(candidates) == 0:
        return mesh
    cap = max(1, int(len(mesh.faces) * max_frac))
    if len(candidates) > cap:
        candidates = rng.choice(candidates, size=cap, replace=False)
    keep = np.ones(len(mesh.faces), dtype=bool)
    keep[candidates] = False
    return _submesh_faces(mesh, keep)


def _artifact_hole(mesh: trimesh.Trimesh, rng: np.random.Generator) -> trimesh.Trimesh:
    centers = mesh.triangles_center
    idx = int(rng.integers(0, len(centers)))
    radius = _bbox_diag(mesh) * float(rng.uniform(0.03, 0.07))
    return _remove_local_faces(
        mesh, centers[idx], radius, max_frac=0.06, rng=rng
    )


def _artifact_spikes(mesh: trimesh.Trimesh, rng: np.random.Generator) -> None:
    n = max(2, int(len(mesh.vertices) * 0.0015))
    n = min(n, 24, len(mesh.vertices))
    picks = rng.choice(len(mesh.vertices), size=n, replace=False)
    try:
        normals = mesh.vertex_normals[picks]
    except Exception:  # noqa: BLE001
        normals = rng.normal(size=(n, 3))
        normals /= np.linalg.norm(normals, axis=1, keepdims=True) + 1e-12
    mag = _bbox_diag(mesh) * rng.uniform(0.01, 0.03, size=(n, 1))
    mesh.vertices[picks] = mesh.vertices[picks] + normals * mag


def _artifact_floater(mesh: trimesh.Trimesh, rng: np.random.Generator) -> trimesh.Trimesh:
    """Detach a tiny face cluster and offset it slightly (scan debris)."""
    if len(mesh.faces) < 80:
        return mesh
    centers = mesh.triangles_center
    idx = int(rng.integers(0, len(centers)))
    radius = _bbox_diag(mesh) * float(rng.uniform(0.02, 0.045))
    dist = np.linalg.norm(centers - centers[idx], axis=1)
    cluster_idx = np.nonzero(dist <= radius)[0]
    cap = max(3, int(len(mesh.faces) * 0.03))
    if len(cluster_idx) < 3:
        return mesh
    if len(cluster_idx) > cap:
        cluster_idx = rng.choice(cluster_idx, size=cap, replace=False)
    cluster_mask = np.zeros(len(mesh.faces), dtype=bool)
    cluster_mask[cluster_idx] = True
    chunk = mesh.submesh([cluster_idx], append=True)
    rest = _submesh_faces(mesh, ~cluster_mask)
    if not isinstance(chunk, trimesh.Trimesh) or chunk.is_empty:
        return mesh
    if rest is mesh and len(rest.faces) == len(mesh.faces):
        return mesh
    offset = rng.normal(size=3)
    offset = offset / (np.linalg.norm(offset) + 1e-12) * (_bbox_diag(mesh) * 0.02)
    chunk.vertices = chunk.vertices + offset
    return trimesh.util.concatenate([rest, chunk])


def _artifact_edge_shred(mesh: trimesh.Trimesh, rng: np.random.Generator) -> trimesh.Trimesh:
    """Remove a thin local dropout strip (capped), not a whole-model band."""
    centers = mesh.triangles_center
    idx = int(rng.integers(0, len(centers)))
    direction = rng.normal(size=3)
    direction /= np.linalg.norm(direction) + 1e-12
    # Local band around a random face, not the global median (which shredded assemblies).
    local = np.nonzero(
        np.linalg.norm(centers - centers[idx], axis=1)
        <= _bbox_diag(mesh) * 0.2
    )[0]
    if len(local) < 8:
        local = np.arange(len(centers))
    projections = centers[local] @ direction
    mid = float(np.median(projections))
    band = _bbox_diag(mesh) * float(rng.uniform(0.008, 0.02))
    in_band_local = np.abs(projections - mid) <= band
    candidates = local[in_band_local]
    if len(candidates) == 0:
        return mesh
    cap = max(1, int(len(mesh.faces) * 0.05))
    if len(candidates) > cap:
        candidates = rng.choice(candidates, size=cap, replace=False)
    keep = np.ones(len(mesh.faces), dtype=bool)
    keep[candidates] = False
    return _submesh_faces(mesh, keep)


def _prune_dust(
    mesh: trimesh.Trimesh, *, min_frac: float = 0.008, keep_floaters: int = 2
) -> trimesh.Trimesh:
    """Drop tiny disconnected scraps; optionally keep a couple of floater chips."""
    parts = mesh.split(only_watertight=False)
    if len(parts) <= 1:
        return mesh
    parts = sorted(parts, key=lambda m: len(m.faces), reverse=True)
    threshold = max(8, int(len(mesh.faces) * min_frac))
    kept = [p for p in parts if len(p.faces) >= threshold]
    tiny = [p for p in parts if len(p.faces) < threshold]
    if tiny and keep_floaters > 0:
        kept.extend(tiny[:keep_floaters])
    if not kept:
        return parts[0]
    if len(kept) == 1:
        return kept[0]
    return trimesh.util.concatenate(kept)


def corrupt_scan_mesh(
    mesh: trimesh.Trimesh,
    params: ScanCorruptParams | None = None,
) -> trimesh.Trimesh:
    """
    Return a copy of `mesh` with a planar missing region, mild surface noise,
    and a few localized scanning artifacts.
    """
    p = params or ScanCorruptParams()
    rng = np.random.default_rng(p.seed)
    out = mesh.copy()
    start_faces = len(out.faces)

    out = _planar_missing(out, p.missing_pct, rng)
    if p.keep_largest:
        largest = _keep_largest_component(out)
        # Only accept keep_largest if it doesn't nuke the post-cut mesh.
        if len(largest.faces) >= max(4, int(len(out.faces) * 0.5)):
            out = largest

    _add_normal_noise(out, p.noise, rng)

    kinds: tuple[Callable[..., Any], ...] = (
        _artifact_hole,
        _artifact_spikes,
        _artifact_floater,
        _artifact_edge_shred,
    )
    for _ in range(max(0, int(p.artifacts))):
        kind = kinds[int(rng.integers(0, len(kinds)))]
        if kind is _artifact_spikes:
            _artifact_spikes(out, rng)
        else:
            out = kind(out, rng)

    out = _prune_dust(out, keep_floaters=2 if p.artifacts > 0 else 0)
    out.remove_unreferenced_vertices()
    if out.is_empty or len(out.faces) < 4:
        raise ValueError("Corruption removed too much geometry — lower missing_pct / artifacts")

    # Soft safety: if artifacts somehow destroyed >85% beyond the requested missing,
    # fall back to planar-only + noise (still incomplete, still usable).
    expected_min = max(4, int(start_faces * (1.0 - float(np.clip(p.missing_pct, 0, 0.85)) * 1.35)))
    if len(out.faces) < expected_min and start_faces > 50:
        rng2 = np.random.default_rng(p.seed)
        out = _planar_missing(mesh.copy(), p.missing_pct, rng2)
        _add_normal_noise(out, p.noise * 0.5, rng2)
        out.remove_unreferenced_vertices()

    return out


def corrupt_scan_file(
    in_path: Path | str,
    out_path: Path | str,
    params: ScanCorruptParams | None = None,
) -> dict[str, Any]:
    """Load → corrupt → write STL (or PLY if out suffix is .ply)."""
    src = Path(in_path)
    dest = Path(out_path)
    p = params or ScanCorruptParams()
    mesh = load_mesh_file(src)
    before_faces = len(mesh.faces)
    before_verts = len(mesh.vertices)
    corrupted = corrupt_scan_mesh(mesh, p)
    dest.parent.mkdir(parents=True, exist_ok=True)
    ext = dest.suffix.lower()
    if ext not in {".stl", ".ply"}:
        dest = dest.with_suffix(".stl")
    corrupted.export(dest)
    return {
        "input": str(src),
        "output": str(dest),
        "params": asdict(p),
        "faces_before": before_faces,
        "faces_after": len(corrupted.faces),
        "vertices_before": before_verts,
        "vertices_after": len(corrupted.vertices),
        "retained_pct": round(100.0 * len(corrupted.faces) / max(before_faces, 1), 1),
        "bytes": dest.stat().st_size,
    }
