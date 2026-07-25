from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from meshmoose_api.agent import build_additional_files, find_main_kcl, message_kind
from meshmoose_api.jobs import JobStore
from meshmoose_api.finishes import apply_finish_to_kcl, get_finish_preset
from meshmoose_api.photos import normalize_photo_upload
from meshmoose_api.preprocess import ensure_stl_for_agent, mesh_from_points
from meshmoose_api.scan_corrupt import ScanCorruptParams, corrupt_scan_file, corrupt_scan_mesh
from meshmoose_api.threemf import stl_to_3mf


def test_find_main_kcl():
    payload = {"result": {"type": "edit_kcl_code", "outputs": {"main.kcl": "x = 1"}}}
    assert find_main_kcl(payload) == "x = 1"


def test_build_additional_files(tmp_path: Path):
    photo = tmp_path / "a.png"
    stl = tmp_path / "b.stl"
    photo.write_bytes(b"\x89PNG\r\n")
    stl.write_bytes(b"solid x\nendsolid x\n")
    files = build_additional_files([photo], stl)
    assert len(files) == 2
    assert files[0]["mimetype"] == "image/png"
    assert files[1]["mimetype"] == "model/stl"
    assert files[0]["data"] == [0x89, ord("P"), ord("N"), ord("G"), 13, 10]


def test_normalize_photo_jpg_passthrough():
    raw = b"\xff\xd8\xff\xe0" + b"\x00" * 32
    name, data = normalize_photo_upload("part.JPG", raw)
    assert name == "part.JPG"
    assert data == raw


def test_normalize_photo_gif_to_png():
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), color=(10, 20, 30)).save(buf, format="GIF")
    name, data = normalize_photo_upload("shot.gif", buf.getvalue())
    assert name == "shot.png"
    assert data[:8] == b"\x89PNG\r\n\x1a\n"


def test_normalize_photo_rejects_unknown():
    with pytest.raises(ValueError, match="Unsupported photo type"):
        normalize_photo_upload("model.tiff", b"II*\x00")


def test_apply_finish_to_kcl_rewrites_existing_appearance():
    src = (
        "tokenCut = subtract([a], tools = [b])\n\n"
        "tokenFinished = appearance(\n"
        "  tokenCut,\n"
        '  color = "#e65a8a",\n'
        "  roughness = 72,\n"
        "  metalness = 0,\n"
        ")\n\n"
        "hide(tokenProfile)\n"
    )
    # Legacy buggy bare pipe should be stripped on re-apply.
    buggy = (
        src
        + "\n// meshmoose-finish: Stainless steel\n"
        + "tokenFinished\n"
        + '  |> appearance(color = "#E0E0E0", metalness = 100, roughness = 15)\n'
    )
    steel = get_finish_preset("stainless-steel")
    out = apply_finish_to_kcl(buggy, steel)
    assert out.count("appearance(") == 1
    assert 'color = "#E0E0E0"' in out
    assert "#e65a8a" not in out
    assert "tokenFinished\n  |> appearance" not in out
    assert "tokenFinished = appearance(tokenCut," in out or "tokenFinished = appearance(\n  tokenCut," in out

    glass = get_finish_preset("glass")
    out2 = apply_finish_to_kcl(out, glass)
    assert out2.count("meshmoose-finish") == 1
    assert "opacity = 20" in out2
    assert 'color = "#FFFFFF"' in out2


def test_apply_finish_to_kcl_pipes_onto_last_assignment():
    src = (
        "part = startSketchOn(XY)\n"
        "  |> circle(center = [0, 0], radius = 5)\n"
        "  |> extrude(length = 2)\n\n"
        "hide(sketch)\n"
    )
    preset = get_finish_preset("brushed-aluminum")
    out = apply_finish_to_kcl(src, preset)
    assert "|> extrude(length = 2)\n  |> appearance(" in out
    assert 'color = "#B8B8B8"' in out
    assert "hide(sketch)" in out
    assert "part = part" not in out


def test_3mf_roundtrip_via_trimesh(tmp_path: Path):
    import trimesh

    stl = tmp_path / "box.stl"
    out = tmp_path / "box.3mf"
    trimesh.creation.box().export(stl)
    stl_to_3mf(stl, out)
    assert out.is_file() and out.stat().st_size > 100
    ensure_stl_for_agent([out], tmp_path / "from3mf.stl")
    assert (tmp_path / "from3mf.stl").is_file()


def test_corrupt_scan_mesh_reduces_faces(tmp_path: Path):
    import trimesh

    src = tmp_path / "sphere.stl"
    out = tmp_path / "sphere_partial.stl"
    trimesh.creation.icosphere(subdivisions=3).export(src)
    before = len(trimesh.load(src, force="mesh").faces)
    result = corrupt_scan_file(
        src,
        out,
        ScanCorruptParams(missing_pct=0.35, noise=0.5, artifacts=4, seed=7),
    )
    assert out.is_file()
    assert result["faces_after"] < before
    assert result["faces_after"] >= 4
    # ~35% missing ⇒ retain roughly 50–85% (artifacts remove a little more).
    assert 0.45 * before <= result["faces_after"] <= 0.9 * before
    # Same seed → same face count
    out2 = tmp_path / "sphere_partial_b.stl"
    result2 = corrupt_scan_file(
        src,
        out2,
        ScanCorruptParams(missing_pct=0.35, noise=0.5, artifacts=4, seed=7),
    )
    assert result2["faces_after"] == result["faces_after"]
    # Helper also works in-memory
    mesh = corrupt_scan_mesh(
        trimesh.load(src, force="mesh"),
        ScanCorruptParams(missing_pct=0.2, noise=0.1, artifacts=1, seed=1),
    )
    assert len(mesh.faces) >= 4


def test_corrupt_scan_multiparts_preserves_most_surface():
    """Beverage-stand-like assemblies must not collapse to a tiny fragment."""
    import trimesh

    # Five boxes spaced apart (ring + legs caricature).
    parts = [trimesh.creation.box()]
    for ox, oy in ((3, 0), (-3, 0), (0, 3), (0, -3)):
        b = trimesh.creation.box(extents=[0.6, 0.6, 2.0])
        b.apply_translation([ox, oy, -1.0])
        parts.append(b)
    mesh = trimesh.util.concatenate(parts)
    out = corrupt_scan_mesh(
        mesh,
        ScanCorruptParams(missing_pct=0.3, noise=0.2, artifacts=4, seed=7),
    )
    retained = len(out.faces) / max(len(mesh.faces), 1)
    assert retained >= 0.5, f"retained only {retained:.1%}"


def test_message_kind():
    assert message_kind({"delta": {"delta": "hi"}}) == "delta"
    assert message_kind({"files": {"files": []}}) == "files"


def test_job_store_create_and_log(tmp_path: Path):
    store = JobStore(tmp_path / "jobs")
    meta = store.create(prompt="Make a bracket", mode="thoughtful")
    assert meta["status"] == "queued"
    log = store.logger(meta["id"])
    log.emit("hello", level="info")
    events = log.read_events()
    assert any(e.get("message") == "hello" for e in events)
    assert (store.paths(meta["id"]).outputs / "job.log").is_file()


def test_read_events_cursor_skips_prefix_without_replay(tmp_path: Path):
    from meshmoose_api.logging_util import JobLogger

    job_dir = tmp_path / "job"
    job_dir.mkdir()
    log = JobLogger(job_dir)
    for msg in ("one", "two", "three"):
        log.emit(msg, kind="status")

    first, cursor = log.read_events_with_cursor(0)
    assert [e["message"] for e in first] == ["one", "two", "three"]
    assert cursor == 3

    rest, cursor2 = log.read_events_with_cursor(2)
    assert [e["message"] for e in rest] == ["three"]
    assert cursor2 == 3
    assert log.read_events_with_cursor(3) == ([], 3)


def test_xyz_to_stl(tmp_path: Path):
    xyz = tmp_path / "cloud.xyz"
    pts = np.array(
        [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
            [1, 1, 0],
            [1, 0, 1],
            [0, 1, 1],
            [1, 1, 1],
        ],
        dtype=float,
    )
    xyz.write_text("\n".join(" ".join(map(str, row)) for row in pts))
    out = tmp_path / "out.stl"
    ensure_stl_for_agent([xyz], out)
    assert out.is_file()
    assert out.stat().st_size > 80


def test_mesh_from_points_requires_volume():
    pts = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0.2, 0.2, 0.5]], dtype=float)
    mesh = mesh_from_points(pts)
    assert len(mesh.faces) > 0


def test_auth_required(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MESHMOOSE_DATA_DIR", str(tmp_path))
    from fastapi.testclient import TestClient
    from meshmoose_api.main import app

    client = TestClient(app)
    res = client.get("/jobs")
    assert res.status_code == 401


def test_active_ms_only_counts_running_segments(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    import meshmoose_api.jobs as jobs_mod
    from meshmoose_api.jobs import JobStatus

    clock = {"t": "2026-01-01T00:00:00+00:00"}

    def fake_now() -> str:
        return clock["t"]

    monkeypatch.setattr(jobs_mod, "utc_now", fake_now)
    store = JobStore(tmp_path / "jobs")
    meta = store.create(prompt="x", mode="fast")
    assert meta["active_ms"] == 0
    assert meta["run_started_at"] == "2026-01-01T00:00:00+00:00"

    clock["t"] = "2026-01-01T00:00:30+00:00"
    done = store.set_status(meta["id"], JobStatus.SUCCEEDED)
    assert done["run_started_at"] is None
    assert done["active_ms"] == 30_000

    clock["t"] = "2026-01-01T00:05:00+00:00"
    running = store.set_status(meta["id"], JobStatus.AGENT_RUNNING)
    assert running["run_started_at"] == "2026-01-01T00:05:00+00:00"
    assert running["active_ms"] == 30_000

    clock["t"] = "2026-01-01T00:05:20+00:00"
    done2 = store.set_status(meta["id"], JobStatus.SUCCEEDED)
    assert done2["run_started_at"] is None
    assert done2["active_ms"] == 50_000


def test_retry_failed_job(tmp_path: Path):
    store = JobStore(tmp_path / "jobs")
    meta = store.create(prompt="Make a coin", mode="fast", title="Coin")
    job_id = meta["id"]
    store.save_upload(job_id, "a.jpg", b"\xff\xd8\xff\xd9", "photo")
    store.save_upload(job_id, "a.stl", b"solid x\nendsolid x\n", "mesh")
    store.update_meta(job_id, status="failed", error="boom")

    new = store.retry_job(job_id)
    assert new["id"] != job_id
    assert new["prompt"] == "Make a coin"
    assert new["retry_of"] == job_id
    assert new["input_photos"] == ["a.jpg"]
    assert new["input_meshes"] == ["a.stl"]
    failed = store.get(job_id)
    assert failed["retried_as"] == new["id"]
    assert "Retried as" in (failed.get("notes") or "")


def test_list_artifacts(tmp_path: Path):
    store = JobStore(tmp_path / "jobs")
    meta = store.create(prompt="x", mode="fast")
    store.save_upload(meta["id"], "ref.jpg", b"\xff\xd8\xff\xd9", "photo")
    out = store.paths(meta["id"]).outputs
    (out / "reference.stl").write_bytes(b"solid x\nendsolid x\n")
    (out / "agent_top_view.jpeg").write_bytes(b"\xff\xd8\xff\xd9")
    arts = store.list_artifacts(meta["id"])
    kinds = {a["kind"] for a in arts}
    assert "reference_photo" in kinds
    assert "reference_mesh" in kinds
    assert "agent_snapshot" in kinds
    assert arts[0]["kind"] == "reference_photo"


def test_create_records_initial_prompt(tmp_path: Path):
    store = JobStore(tmp_path / "jobs")
    meta = store.create(prompt="Make a washer", mode="thoughtful")
    prompts = meta["prompts"]
    assert len(prompts) == 1
    assert prompts[0]["role"] == "initial"
    assert prompts[0]["text"] == "Make a washer"
    assert prompts[0]["mode"] == "thoughtful"


def test_append_prompt_backfills_and_appends(tmp_path: Path):
    store = JobStore(tmp_path / "jobs")
    meta = store.create(prompt="initial", mode="fast")
    # Simulate a legacy job without prompts[].
    store.update_meta(meta["id"], prompts=[])
    updated = store.append_prompt(meta["id"], text="make hole 4mm", role="refine")
    roles = [p["role"] for p in updated["prompts"]]
    assert roles == ["initial", "refine"]
    assert updated["prompts"][1]["text"] == "make hole 4mm"


def test_ensure_prompt_history_recovers_from_log(tmp_path: Path):
    store = JobStore(tmp_path / "jobs")
    meta = store.create(prompt="initial coin", mode="thoughtful")
    job_id = meta["id"]
    store.update_meta(job_id, prompts=[])
    log = store.paths(job_id).outputs / "job.log"
    log.write_text(
        "2026-07-22T18:01:24+00:00 INFO Refine queued: Add a dog head logo\n"
        "2026-07-22T19:14:54+00:00 INFO Refine queued (42 chars): Thicken the rim\n",
        encoding="utf-8",
    )
    hydrated = store.ensure_prompt_history(job_id)
    texts = [p["text"] for p in hydrated["prompts"]]
    assert texts[0] == "initial coin"
    assert "Add a dog head logo" in texts
    assert "Thicken the rim" in texts


def test_reap_and_delete(tmp_path: Path):
    store = JobStore(tmp_path / "jobs")
    meta = store.create(prompt="x", mode="fast")
    store.update_meta(meta["id"], status="agent_running")
    assert store.reap_orphans() == 1
    assert store.get(meta["id"])["status"] == "failed"
    store.delete(meta["id"])
    assert not store.paths(meta["id"]).root.exists()


def test_demos_endpoint_lists_bundled_demos():
    from fastapi.testclient import TestClient

    import meshmoose_api.main as main_mod

    client = TestClient(main_mod.app)
    res = client.get("/demos")
    assert res.status_code == 200
    demos = res.json()
    ids = {d["id"] for d in demos}
    assert "beverage-holder-stand" in ids
    assert "partial-stand" in ids
    for demo_id in ("beverage-holder-stand", "partial-stand"):
        demo = next(d for d in demos if d["id"] == demo_id)
        assert demo["photos"]
        assert demo["meshes"]
        assert demo["prompt"]
        assert demo["title"]


def test_finishes_endpoint_lists_presets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MESHMOOSE_DATA_DIR", str(tmp_path))
    from fastapi.testclient import TestClient

    import meshmoose_api.main as main_mod
    from meshmoose_api.jobs import JobStore as LiveStore

    main_mod.store = LiveStore(tmp_path / "jobs")
    client = TestClient(main_mod.app)
    res = client.get("/finishes", headers={"Authorization": "Bearer test-token"})
    assert res.status_code == 200
    presets = res.json()
    ids = {p["id"] for p in presets}
    assert "brushed-aluminum" in ids
    assert "glass" in ids
    brushed = next(p for p in presets if p["id"] == "brushed-aluminum")
    assert brushed["color"]
    assert "metalness" in brushed


def test_save_kcl_endpoint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MESHMOOSE_DATA_DIR", str(tmp_path))
    from fastapi.testclient import TestClient

    import meshmoose_api.main as main_mod
    from meshmoose_api.jobs import JobStore as LiveStore

    main_mod.store = LiveStore(tmp_path / "jobs")
    client = TestClient(main_mod.app)
    headers = {"Authorization": "Bearer test-token"}
    meta = main_mod.store.create(prompt="edit me", mode="fast")
    job_id = meta["id"]
    main_mod.store.update_meta(job_id, status="succeeded")
    kcl_path = main_mod.store.paths(job_id).outputs / "main.kcl"
    kcl_path.write_text("part = 1\n", encoding="utf-8")

    res = client.put(
        f"/jobs/{job_id}/kcl",
        headers=headers,
        json={"kcl": "part = 2\n", "note": "bump dimension"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["kcl"] == "part = 2\n"
    assert body["job"]["status"] == "succeeded"
    assert any(p.get("role") == "edit" for p in body["job"].get("prompts") or [])
    assert kcl_path.read_text(encoding="utf-8") == "part = 2\n"
    prev = main_mod.store.paths(job_id).outputs / "main.prev.kcl"
    assert prev.read_text(encoding="utf-8") == "part = 1\n"

    from meshmoose_api.jobs import JobStatus

    main_mod.store.set_status(job_id, JobStatus.EXPORTING)
    busy = client.put(
        f"/jobs/{job_id}/kcl",
        headers=headers,
        json={"kcl": "part = 3\n"},
    )
    assert busy.status_code == 409


def test_finish_endpoint_requires_kcl(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MESHMOOSE_DATA_DIR", str(tmp_path))
    from fastapi.testclient import TestClient

    import meshmoose_api.main as main_mod
    from meshmoose_api.jobs import JobStore as LiveStore

    main_mod.store = LiveStore(tmp_path / "jobs")
    client = TestClient(main_mod.app)
    headers = {"Authorization": "Bearer test-token"}
    meta = main_mod.store.create(prompt="finish me", mode="fast")
    main_mod.store.update_meta(meta["id"], status="succeeded")
    res = client.post(
        f"/jobs/{meta['id']}/finish",
        headers=headers,
        data={"preset": "brushed-aluminum"},
    )
    assert res.status_code == 400
    assert "main.kcl" in res.json()["detail"]


def test_finish_endpoint_queues_export(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MESHMOOSE_DATA_DIR", str(tmp_path))
    from fastapi.testclient import TestClient

    import meshmoose_api.main as main_mod
    from meshmoose_api.jobs import JobStore as LiveStore

    main_mod.store = LiveStore(tmp_path / "jobs")
    client = TestClient(main_mod.app)
    headers = {"Authorization": "Bearer test-token"}
    meta = main_mod.store.create(prompt="finish me", mode="fast")
    job_id = meta["id"]
    main_mod.store.update_meta(job_id, status="succeeded")
    kcl = main_mod.store.paths(job_id).outputs / "main.kcl"
    kcl.write_text(
        "part = startSketchOn(XY)\n"
        "  |> circle(center = [0, 0], radius = 5)\n"
        "  |> extrude(length = 2)\n",
        encoding="utf-8",
    )

    def noop_finish(**_kwargs):
        return None

    monkeypatch.setattr("meshmoose_api.main.apply_finish_job", noop_finish)
    with client:
        res = client.post(
            f"/jobs/{job_id}/finish",
            headers=headers,
            data={"preset": "matte-plastic"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "exporting"
    prompts = body.get("prompts") or []
    assert any(p.get("role") == "finish" for p in prompts)


def test_obj_to_stl(tmp_path: Path):
    import trimesh

    obj = tmp_path / "box.obj"
    out = tmp_path / "box.stl"
    trimesh.creation.box().export(obj)
    ensure_stl_for_agent([obj], out)
    assert out.is_file()
    assert out.stat().st_size > 80


def test_delete_job_endpoint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MESHMOOSE_DATA_DIR", str(tmp_path))
    from fastapi.testclient import TestClient

    import meshmoose_api.main as main_mod
    from meshmoose_api.jobs import JobStore as LiveStore

    main_mod.store = LiveStore(tmp_path / "jobs")
    client = TestClient(main_mod.app)
    headers = {"Authorization": "Bearer test-token"}
    meta = main_mod.store.create(prompt="delete me", mode="fast")
    job_id = meta["id"]
    res = client.delete(f"/jobs/{job_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["ok"] is True
    res = client.get(f"/jobs/{job_id}", headers=headers)
    assert res.status_code == 404


def test_refine_validation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MESHMOOSE_DATA_DIR", str(tmp_path))
    from fastapi.testclient import TestClient

    import meshmoose_api.main as main_mod
    from meshmoose_api.jobs import JobStore as LiveStore
    from meshmoose_api.main import REFINE_MAX_CHARS

    main_mod.store = LiveStore(tmp_path / "jobs")
    client = TestClient(main_mod.app)
    headers = {"Authorization": "Bearer test-token"}

    meta = main_mod.store.create(prompt="bracket", mode="thoughtful")
    job_id = meta["id"]
    # Succeeded but no KCL yet → missing artifact.
    main_mod.store.update_meta(job_id, status="succeeded")
    res = client.post(f"/jobs/{job_id}/refine", headers=headers, data={"message": "thicken"})
    assert res.status_code == 400
    assert "main.kcl" in res.json()["detail"]

    (main_mod.store.paths(job_id).outputs / "main.kcl").write_text("x = 1\n", encoding="utf-8")
    main_mod.store.update_meta(job_id, status="agent_running")
    res = client.post(f"/jobs/{job_id}/refine", headers=headers, data={"message": "thicken"})
    assert res.status_code == 409

    main_mod.store.update_meta(job_id, status="succeeded")
    too_long = "x" * (REFINE_MAX_CHARS + 1)
    res = client.post(
        f"/jobs/{job_id}/refine",
        headers=headers,
        data={"message": too_long},
    )
    assert res.status_code == 400


def test_create_job_rejects_oversized_upload(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MESHMOOSE_DATA_DIR", str(tmp_path))
    from fastapi.testclient import TestClient

    import meshmoose_api.main as main_mod
    from meshmoose_api.jobs import JobStore as LiveStore

    main_mod.store = LiveStore(tmp_path / "jobs")
    client = TestClient(main_mod.app)
    headers = {"Authorization": "Bearer test-token"}

    oversized = b"\xff\xd8\xff" + b"\x00" * (main_mod.MAX_UPLOAD_BYTES + 1)
    res = client.post(
        "/jobs",
        headers=headers,
        data={"prompt": "make a stand"},
        files=[
            ("photos", ("big.jpg", oversized, "image/jpeg")),
            ("meshes", ("part.stl", b"solid x\nendsolid x\n", "model/stl")),
        ],
    )
    assert res.status_code == 413
    assert "limit" in res.json()["detail"]


def test_refine_rejects_oversized_upload(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MESHMOOSE_DATA_DIR", str(tmp_path))
    from fastapi.testclient import TestClient

    import meshmoose_api.main as main_mod
    from meshmoose_api.jobs import JobStore as LiveStore

    main_mod.store = LiveStore(tmp_path / "jobs")
    client = TestClient(main_mod.app)
    headers = {"Authorization": "Bearer test-token"}

    meta = main_mod.store.create(prompt="bracket", mode="fast")
    job_id = meta["id"]
    main_mod.store.paths(job_id).outputs.joinpath("main.kcl").write_text(
        "x = 1\n", encoding="utf-8"
    )
    main_mod.store.update_meta(job_id, status="succeeded")

    oversized = b"\xff\xd8\xff" + b"\x00" * (main_mod.MAX_UPLOAD_BYTES + 1)
    res = client.post(
        f"/jobs/{job_id}/refine",
        headers=headers,
        data={"message": "thicken the rim"},
        files=[("photos", ("big.jpg", oversized, "image/jpeg"))],
    )
    assert res.status_code == 413


def test_align_meshes_recovers_translation(tmp_path: Path):
    import trimesh
    from meshmoose_api.align import align_meshes

    ref = trimesh.creation.box(extents=[10, 10, 10])
    ref.export(tmp_path / "ref.stl")
    gen = trimesh.creation.box(extents=[10, 10, 10])
    gen.apply_translation([2.0, -1.0, 0.5])
    gen.export(tmp_path / "gen.stl")

    result = align_meshes(reference_stl=tmp_path / "ref.stl", generated_stl=tmp_path / "gen.stl")
    assert len(result["transform"]) == 4
    assert "vertex_indices" not in result  # contiguous → omitted; client assumes 0..N-1
    assert len(result["distances"]) == result["stats"]["samples"]
    assert result["stats"]["mean"] is not None
    # A translated identical box should align to ~zero deviation.
    assert result["stats"]["mean"] < 0.01
    assert result["stats"]["max"] < 0.01


def test_align_meshes_reports_deviation(tmp_path: Path):
    import trimesh
    from meshmoose_api.align import align_meshes

    ref = trimesh.creation.box(extents=[10, 10, 10])
    ref.export(tmp_path / "ref.stl")
    gen = trimesh.creation.box(extents=[12, 10, 10])
    gen.export(tmp_path / "gen.stl")

    result = align_meshes(reference_stl=tmp_path / "ref.stl", generated_stl=tmp_path / "gen.stl")
    assert result["stats"]["mean"] > 0.1
    assert result["stats"]["max"] >= result["stats"]["mean"]


def test_align_endpoint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MESHMOOSE_DATA_DIR", str(tmp_path))
    import trimesh
    from fastapi.testclient import TestClient

    import meshmoose_api.main as main_mod
    from meshmoose_api.jobs import JobStore as LiveStore

    main_mod.store = LiveStore(tmp_path / "jobs")
    client = TestClient(main_mod.app)
    headers = {"Authorization": "Bearer test-token"}

    meta = main_mod.store.create(prompt="box", mode="fast")
    job_id = meta["id"]
    out = main_mod.store.paths(job_id).outputs
    trimesh.creation.box().export(out / "reference.stl")
    trimesh.creation.box().export(out / "generated.stl")
    main_mod.store.update_meta(job_id, status="succeeded")

    res = client.post(f"/jobs/{job_id}/align", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert "transform" in body
    assert body["stats"]["mean"] is not None


def test_align_endpoint_requires_meshes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MESHMOOSE_DATA_DIR", str(tmp_path))
    from fastapi.testclient import TestClient

    import meshmoose_api.main as main_mod
    from meshmoose_api.jobs import JobStore as LiveStore

    main_mod.store = LiveStore(tmp_path / "jobs")
    client = TestClient(main_mod.app)
    headers = {"Authorization": "Bearer test-token"}

    meta = main_mod.store.create(prompt="box", mode="fast")
    res = client.post(f"/jobs/{meta['id']}/align", headers=headers)
    assert res.status_code == 400


def test_reference_select_endpoints(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MESHMOOSE_DATA_DIR", str(tmp_path))
    from fastapi.testclient import TestClient

    import meshmoose_api.main as main_mod
    from meshmoose_api.jobs import JobStore as LiveStore

    main_mod.store = LiveStore(tmp_path / "jobs")
    client = TestClient(main_mod.app)
    headers = {"Authorization": "Bearer test-token"}

    meta = main_mod.store.create(prompt="coin", mode="fast")
    job_id = meta["id"]
    # Seed two input meshes + the normalized agent mesh.
    main_mod.store.save_upload(job_id, "scan_a.stl", b"solid a\nendsolid a\n", "mesh")
    main_mod.store.save_upload(job_id, "texture.stl", b"solid t\nendsolid t\n", "mesh")
    (main_mod.store.paths(job_id).inputs / "mesh_for_agent.stl").write_bytes(
        b"solid m\nendsolid m\n"
    )

    res = client.get(f"/jobs/{job_id}/reference", headers=headers)
    assert res.status_code == 200
    body = res.json()
    # Default resolves to the normalized agent mesh.
    assert body["active"] == "inputs/mesh_for_agent.stl"
    assert "inputs/scan_a.stl" in body["available"]
    assert "inputs/texture.stl" in body["available"]

    # Switch the reference to the texture mesh.
    res = client.put(
        f"/jobs/{job_id}/reference",
        headers=headers,
        json={"source": "inputs/texture.stl"},
    )
    assert res.status_code == 200
    assert res.json()["active"] == "inputs/texture.stl"

    # The files endpoint now serves the texture mesh as reference.stl.
    res = client.get(f"/jobs/{job_id}/files/outputs/reference.stl", headers=headers)
    assert res.status_code == 200
    assert res.content == b"solid t\nendsolid t\n"

    # Reject an invalid source.
    res = client.put(
        f"/jobs/{job_id}/reference",
        headers=headers,
        json={"source": "inputs/nope.stl"},
    )
    assert res.status_code == 400


def test_zoo_usage_requires_auth(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MESHMOOSE_DATA_DIR", str(tmp_path))
    from fastapi.testclient import TestClient
    from meshmoose_api.main import app

    client = TestClient(app)
    assert client.get("/zoo/usage").status_code == 401


def test_fetch_zoo_usage_sanitizes_pii(monkeypatch: pytest.MonkeyPatch):
    class _Balance:
        def model_dump(self, mode: str = "json"):
            return {
                "monthly_api_credits_remaining": 1000,
                "monthly_api_credits_remaining_monetary_value": 8.3,
                "stable_api_credits_remaining": 50,
                "stable_api_credits_remaining_monetary_value": 0.4,
                "updated_at": "2026-01-01T00:00:00Z",
                "subscription_details": {
                    "modeling_app": {
                        "display_name": "Free",
                        "name": "free",
                        "monthly_pay_as_you_go_api_credits": 1205,
                        "monthly_pay_as_you_go_api_credits_monetary_value": 10,
                        "pay_as_you_go_api_credit_price": 0.0083,
                    }
                },
            }

    class _Call:
        def model_dump(self, mode: str = "json"):
            return {
                "id": "c1",
                "endpoint": "/ws/ml/copilot?token=should-strip",
                "method": "GET",
                "seconds": 12,
                "minutes": 0,
                "price": 0.1,
                "status_code": 200,
                "created_at": "2026-01-01T12:00:00Z",
                "email": "user@example.com",
                "ip_address": "1.2.3.4",
                "user_agent": "SecretAgent/1.0",
            }

    class _FakeClient:
        def __init__(self, token: str | None = None):
            self.headers: dict[str, str] = {}
            self.payments = type(
                "P",
                (),
                {"get_payment_balance_for_user": staticmethod(lambda: _Balance())},
            )()
            self.api_calls = type(
                "A",
                (),
                {"user_list_api_calls": staticmethod(lambda limit=12: [_Call()])},
            )()

    monkeypatch.setattr("kittycad.KittyCAD", _FakeClient)

    from meshmoose_api.zoo_usage import fetch_zoo_usage

    payload = fetch_zoo_usage("tok_test")
    assert payload["balance"]["plan_name"] == "Free"
    assert payload["balance"]["monthly_api_credits_remaining"] == 1000
    assert payload["recent_totals"]["count"] == 1
    call = payload["recent_calls"][0]
    assert call["endpoint"] == "/ws/ml/copilot"
    assert "email" not in call
    assert "ip_address" not in call
    assert "user_agent" not in call
    blob = str(payload)
    assert "user@example.com" not in blob
    assert "1.2.3.4" not in blob
    assert "should-strip" not in blob


def test_zoo_usage_endpoint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MESHMOOSE_DATA_DIR", str(tmp_path))
    from fastapi.testclient import TestClient
    import meshmoose_api.main as main_mod

    monkeypatch.setattr(
        main_mod,
        "fetch_zoo_usage",
        lambda token: {
            "balance": {"plan_name": "Free", "monthly_api_credits_remaining": 42},
            "recent_calls": [],
            "recent_totals": {"count": 0, "seconds": 0, "price": 0},
        },
    )
    client = TestClient(main_mod.app)
    res = client.get("/zoo/usage", headers={"Authorization": "Bearer test-token"})
    assert res.status_code == 200
    body = res.json()
    assert body["balance"]["plan_name"] == "Free"
    assert body["balance"]["monthly_api_credits_remaining"] == 42

def test_compare_meshes_via_sdk(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    stl = tmp_path / "part.stl"
    stl.write_text(
        "solid t\nfacet normal 0 0 1\nouter loop\n"
        "vertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\n"
        "endloop\nendfacet\nendsolid t\n",
        encoding="utf-8",
    )
    out = tmp_path / "metrics.json"
    job_dir = tmp_path / "job"
    job_dir.mkdir()
    (job_dir / "outputs").mkdir()

    class _Model:
        def __init__(self, payload: dict):
            self._payload = payload

        def model_dump(self, mode: str = "json"):
            return self._payload

    class _FakeFile:
        def create_file_volume(self, **kwargs):
            assert kwargs["body"] == stl.read_bytes()
            return _Model({"volume": 1.5})

        def create_file_surface_area(self, **kwargs):
            return _Model({"surface_area": 4.0})

        def create_file_center_of_mass(self, **kwargs):
            return _Model({"center_of_mass": [0.1, 0.2, 0.3]})

        def create_file_mass(self, **kwargs):
            assert kwargs["material_density"] == 1240.0
            return _Model({"mass": 2.0})

    class _FakeClient:
        def __init__(self, token: str | None = None):
            self.headers: dict[str, str] = {}
            self.file = _FakeFile()

    monkeypatch.setattr("meshmoose_api.metrics.KittyCAD", _FakeClient)

    from meshmoose_api.logging_util import JobLogger
    from meshmoose_api.metrics import compare_meshes

    result = compare_meshes(
        token="tok",
        reference_stl=stl,
        generated_stl=stl,
        out_json=out,
        log=JobLogger(job_dir),
    )
    assert result["reference"]["volume"]["volume"] == 1.5
    assert result["generated"]["mass"]["mass"] == 2.0
    assert result["delta"]["volume"]["abs"] == 0.0
    assert out.is_file()


def test_export_kcl_restores_token_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Token env vars must not linger (or clobber prior values) after export."""
    import os
    import sys
    import types
    from meshmoose_api.logging_util import JobLogger

    monkeypatch.delenv("ZOO_API_TOKEN", raising=False)
    monkeypatch.delenv("KITTYCAD_API_TOKEN", raising=False)

    seen_env: dict[str, str | None] = {}

    class _File:
        def __init__(self, contents: bytes):
            self.contents = contents

    class _Format:
        Stl = "stl"
        Step = "step"

    async def _fake_execute(_code, _fmt):
        seen_env["ZOO_API_TOKEN"] = os.environ.get("ZOO_API_TOKEN")
        seen_env["KITTYCAD_API_TOKEN"] = os.environ.get("KITTYCAD_API_TOKEN")
        return [_File(b"solid x\nendsolid x\n")]

    fake_kcl = types.ModuleType("kcl")
    fake_kcl.FileExportFormat = _Format
    fake_kcl.execute_code_and_export = _fake_execute
    monkeypatch.setitem(sys.modules, "kcl", fake_kcl)

    monkeypatch.setattr(
        "meshmoose_api.export_kcl.stl_to_3mf",
        lambda stl, out, log=None: out.write_bytes(b"3mf"),
    )

    from meshmoose_api.export_kcl import export_kcl

    job_dir = tmp_path / "job"
    (job_dir / "outputs").mkdir(parents=True)
    export_kcl(
        token="secret-token-123",
        main_kcl="x = 1",
        out_stl=tmp_path / "g.stl",
        out_step=tmp_path / "g.step",
        log=JobLogger(job_dir),
    )

    assert seen_env["ZOO_API_TOKEN"] == "secret-token-123"
    assert os.environ.get("ZOO_API_TOKEN") is None
    assert os.environ.get("KITTYCAD_API_TOKEN") is None


def test_export_kcl_restores_prior_env_value(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """A pre-existing env value must survive a job export unchanged."""
    import os
    import sys
    import types
    from meshmoose_api.logging_util import JobLogger

    monkeypatch.setenv("ZOO_API_TOKEN", "user-shell-token")

    class _File:
        def __init__(self, contents: bytes):
            self.contents = contents

    class _Format:
        Stl = "stl"
        Step = "step"

    async def _fake_execute(_code, _fmt):
        return [_File(b"solid x\nendsolid x\n")]

    fake_kcl = types.ModuleType("kcl")
    fake_kcl.FileExportFormat = _Format
    fake_kcl.execute_code_and_export = _fake_execute
    monkeypatch.setitem(sys.modules, "kcl", fake_kcl)
    monkeypatch.setattr(
        "meshmoose_api.export_kcl.stl_to_3mf",
        lambda stl, out, log=None: out.write_bytes(b"3mf"),
    )

    from meshmoose_api.export_kcl import export_kcl

    job_dir = tmp_path / "job"
    (job_dir / "outputs").mkdir(parents=True)
    export_kcl(
        token="job-token",
        main_kcl="x = 1",
        out_stl=tmp_path / "g.stl",
        out_step=tmp_path / "g.step",
        log=JobLogger(job_dir),
    )

    assert os.environ.get("ZOO_API_TOKEN") == "user-shell-token"


def test_format_job_error_strips_kcl_ansi_tuple():
    from meshmoose_api.errors import format_job_error

    # Shape matches json.loads of Zoo KclError str() stored in meta.json
    # (literal \x1b escapes, not raw ESC bytes).
    raw = (
        r"('\x1b[31mKCL EngineHangup error\x1b[0m\n\n  "
        r"\x1b[31m×\x1b[0m engine hangup: modeling connection interrupted; "
        r"please reconnect and retry\n', True)"
    )
    out = format_job_error(raw)
    assert "hangup" in out.lower()
    assert "interrupted" in out.lower()
    assert "\x1b" not in out
    assert r"\x1b" not in out
    assert "True)" not in out


def test_format_job_error_from_exception_args():
    from meshmoose_api.errors import format_job_error

    class KclError(Exception):
        pass

    exc = KclError(
        (
            "\x1b[31mKCL EngineHangup error\x1b[0m\n\n"
            "  \x1b[31m×\x1b[0m engine hangup: modeling connection interrupted; "
            "please reconnect and retry\n",
            True,
        )
    )
    out = format_job_error(exc)
    assert "modeling connection interrupted" in out.lower()
    assert "\x1b" not in out


def test_export_kcl_retries_retryable_engine_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """Engine hangups (KclError.is_retryable) should be retried, not fail the job."""
    import sys
    import types
    from meshmoose_api.logging_util import JobLogger

    class _File:
        def __init__(self, contents: bytes):
            self.contents = contents

    class _Format:
        Stl = "stl"
        Step = "step"

    class _Retryable(Exception):
        def is_retryable(self) -> bool:
            return True

    calls = {"n": 0}

    async def _flaky_execute(_code, _fmt):
        calls["n"] += 1
        # Fail first STL attempt, then succeed; STEP succeeds immediately.
        if calls["n"] == 1:
            raise _Retryable("engine hangup")
        return [_File(b"solid x\nendsolid x\n")]

    fake_kcl = types.ModuleType("kcl")
    fake_kcl.FileExportFormat = _Format
    fake_kcl.execute_code_and_export = _flaky_execute
    monkeypatch.setitem(sys.modules, "kcl", fake_kcl)
    monkeypatch.setattr(
        "meshmoose_api.export_kcl.stl_to_3mf",
        lambda stl, out, log=None: out.write_bytes(b"3mf"),
    )

    from meshmoose_api.export_kcl import export_kcl

    job_dir = tmp_path / "job"
    (job_dir / "outputs").mkdir(parents=True)
    out_stl = tmp_path / "g.stl"
    out_step = tmp_path / "g.step"
    export_kcl(
        token="tok",
        main_kcl="x = 1",
        out_stl=out_stl,
        out_step=out_step,
        log=JobLogger(job_dir),
    )

    assert out_stl.is_file()
    assert out_step.is_file()
    # 1 failed STL + 1 ok STL + 1 ok STEP
    assert calls["n"] == 3

