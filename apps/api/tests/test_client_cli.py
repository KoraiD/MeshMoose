"""Tests for MeshMooseClient helpers + CLI (FastAPI TestClient; no live Zoo)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from meshmoose_api.cli import main as cli_main
from meshmoose_api.client import MeshMooseClient, MeshMooseError


class _TestTransport:
    """Minimal sync httpx transport backed by Starlette TestClient."""

    def __init__(self, app):
        self._tc = TestClient(app)

    def handle_request(self, request):  # type: ignore[no-untyped-def]
        import httpx

        url = httpx.URL(str(request.url))
        path = url.raw_path.decode("ascii")
        if url.query:
            path = f"{path}?{url.query.decode('ascii')}"
        headers = {k.decode(): v.decode() for k, v in request.headers.raw}
        # Drop hop-by-hop / host that confuse TestClient
        headers.pop("host", None)
        content = b"".join(request.stream)
        res = self._tc.request(
            request.method,
            path,
            headers=headers,
            content=content,
        )
        return httpx.Response(
            status_code=res.status_code,
            headers=res.headers,
            content=res.content,
            request=request,
        )

    def close(self) -> None:
        self._tc.close()


@pytest.fixture()
def api_app(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MESHMOOSE_DATA_DIR", str(tmp_path))
    import meshmoose_api.main as main_mod
    from meshmoose_api.jobs import JobStore

    main_mod.store = JobStore()
    # Do not start Zoo worker threads during unit tests.
    monkeypatch.setattr(main_mod, "_start_job_thread", lambda *_a, **_k: None)
    return main_mod.app


@pytest.fixture()
def client(api_app):
    c = MeshMooseClient(
        base_url="http://test",
        token="test-token",
        transport=_TestTransport(api_app),  # type: ignore[arg-type]
    )
    yield c
    try:
        c.close()
    except Exception:  # noqa: BLE001
        pass


def test_client_health(client: MeshMooseClient):
    body = client.health()
    assert body["ok"] is True
    assert body["service"] == "meshmoose-api"


def test_client_jobs_lifecycle(client: MeshMooseClient, tmp_path: Path):
    photo = tmp_path / "a.jpg"
    mesh = tmp_path / "a.stl"
    photo.write_bytes(b"\xff\xd8\xff\xd9")
    mesh.write_bytes(b"solid x\nendsolid x\n")

    job = client.create_job(
        prompt="Make a washer",
        photos=[photo],
        meshes=[mesh],
        mode="fast",
    )
    job_id = job["id"]
    assert job_id
    listed = client.list_jobs()
    assert any(j["id"] == job_id for j in listed)
    got = client.get_job(job_id)
    assert got["prompt"] == "Make a washer"

    try:
        client.cancel_job(job_id)
    except MeshMooseError:
        pass
    deleted = client.delete_job(job_id)
    assert deleted["ok"] is True


def test_client_requires_token_for_jobs(api_app):
    c = MeshMooseClient(
        base_url="http://test",
        token="",
        transport=_TestTransport(api_app),  # type: ignore[arg-type]
    )
    with pytest.raises(MeshMooseError) as exc:
        c.list_jobs()
    assert exc.value.status_code == 401
    try:
        c.close()
    except Exception:  # noqa: BLE001
        pass


def test_cli_health(api_app, monkeypatch: pytest.MonkeyPatch, capsys):
    def fake_client(*_a: Any, **_k: Any) -> MeshMooseClient:
        return MeshMooseClient(
            base_url="http://test",
            token="t",
            transport=_TestTransport(api_app),  # type: ignore[arg-type]
        )

    monkeypatch.setattr("meshmoose_api.cli.MeshMooseClient", fake_client)
    code = cli_main(["health", "--json"])
    assert code == 0
    out = capsys.readouterr().out
    assert "meshmoose-api" in out


def test_cli_jobs_list(api_app, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys):
    transport = _TestTransport(api_app)
    real = MeshMooseClient(base_url="http://test", token="t", transport=transport)  # type: ignore[arg-type]
    photo = tmp_path / "p.jpg"
    mesh = tmp_path / "m.stl"
    photo.write_bytes(b"\xff\xd8\xff\xd9")
    mesh.write_bytes(b"solid x\nendsolid x\n")
    job = real.create_job(prompt="x", photos=[photo], meshes=[mesh], mode="fast")

    def fake_client(*_a: Any, **_k: Any) -> MeshMooseClient:
        return MeshMooseClient(
            base_url="http://test",
            token="t",
            transport=_TestTransport(api_app),  # type: ignore[arg-type]
        )

    monkeypatch.setattr("meshmoose_api.cli.MeshMooseClient", fake_client)
    code = cli_main(["jobs", "list"])
    assert code == 0
    assert job["id"] in capsys.readouterr().out
    real.delete_job(job["id"])
    try:
        real.close()
    except Exception:  # noqa: BLE001
        pass


def test_cli_create_missing_files_errors(capsys):
    code = cli_main(["jobs", "create", "--prompt", "x"])
    assert code == 2
    err = capsys.readouterr().err
    assert "--photo" in err


def test_cli_jobs_create_title_and_tags(
    api_app, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
):
    photo = tmp_path / "p.jpg"
    mesh = tmp_path / "m.stl"
    photo.write_bytes(b"\xff\xd8\xff\xd9")
    mesh.write_bytes(b"solid x\nendsolid x\n")

    def fake_client(*_a: Any, **_k: Any) -> MeshMooseClient:
        return MeshMooseClient(
            base_url="http://test",
            token="t",
            transport=_TestTransport(api_app),  # type: ignore[arg-type]
        )

    monkeypatch.setattr("meshmoose_api.cli.MeshMooseClient", fake_client)
    code = cli_main(
        [
            "jobs",
            "create",
            "--prompt",
            "Make a stand",
            "--photo",
            str(photo),
            "--mesh",
            str(mesh),
            "--title",
            "Beverage stand",
            "--tag",
            "stand",
            "--tag",
            "demo",
            "--mode",
            "fast",
        ]
    )
    assert code == 0
    out = capsys.readouterr().out
    assert "job_id:" in out
    assert "Beverage stand" in out


def test_client_patch_and_retry(client: MeshMooseClient, tmp_path: Path):
    photo = tmp_path / "a.jpg"
    mesh = tmp_path / "a.stl"
    photo.write_bytes(b"\xff\xd8\xff\xd9")
    mesh.write_bytes(b"solid x\nendsolid x\n")

    job = client.create_job(
        prompt="Make a coin",
        photos=[photo],
        meshes=[mesh],
        mode="fast",
        title="Coin",
        tags=["token"],
    )
    patched = client.patch_job(
        job["id"], title="Beverage holder stand", tags=["stand", "demo"]
    )
    assert patched["title"] == "Beverage holder stand"
    assert patched["tags"] == ["stand", "demo"]

    # Force failed so retry is allowed.
    import meshmoose_api.main as main_mod

    main_mod.store.update_meta(job["id"], status="failed", error="boom")
    retried = client.retry_job(job["id"])
    assert retried["retry_of"] == job["id"]
    assert retried["title"] == "Beverage holder stand"
    assert retried["tags"] == ["stand", "demo"]
    client.delete_job(retried["id"])
    client.delete_job(job["id"])


def test_cli_jobs_retry(api_app, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys):
    transport = _TestTransport(api_app)
    real = MeshMooseClient(base_url="http://test", token="t", transport=transport)  # type: ignore[arg-type]
    photo = tmp_path / "p.jpg"
    mesh = tmp_path / "m.stl"
    photo.write_bytes(b"\xff\xd8\xff\xd9")
    mesh.write_bytes(b"solid x\nendsolid x\n")
    job = real.create_job(prompt="x", photos=[photo], meshes=[mesh], mode="fast")
    import meshmoose_api.main as main_mod

    main_mod.store.update_meta(job["id"], status="failed", error="boom")

    def fake_client(*_a: Any, **_k: Any) -> MeshMooseClient:
        return MeshMooseClient(
            base_url="http://test",
            token="t",
            transport=_TestTransport(api_app),  # type: ignore[arg-type]
        )

    monkeypatch.setattr("meshmoose_api.cli.MeshMooseClient", fake_client)
    code = cli_main(["jobs", "retry", job["id"]])
    assert code == 0
    out = capsys.readouterr().out
    assert "job_id:" in out
    real.delete_job(job["id"])
    try:
        real.close()
    except Exception:  # noqa: BLE001
        pass


def test_cli_jobs_rename(api_app, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys):
    transport = _TestTransport(api_app)
    real = MeshMooseClient(base_url="http://test", token="t", transport=transport)  # type: ignore[arg-type]
    photo = tmp_path / "p.jpg"
    mesh = tmp_path / "m.stl"
    photo.write_bytes(b"\xff\xd8\xff\xd9")
    mesh.write_bytes(b"solid x\nendsolid x\n")
    job = real.create_job(prompt="x", photos=[photo], meshes=[mesh], mode="fast", title="Old")

    def fake_client(*_a: Any, **_k: Any) -> MeshMooseClient:
        return MeshMooseClient(
            base_url="http://test",
            token="t",
            transport=_TestTransport(api_app),  # type: ignore[arg-type]
        )

    monkeypatch.setattr("meshmoose_api.cli.MeshMooseClient", fake_client)
    code = cli_main(
        ["jobs", "rename", job["id"], "--title", "New title", "--tag", "coin", "--tag", "pla"]
    )
    assert code == 0
    out = capsys.readouterr().out
    assert "New title" in out
    updated = real.get_job(job["id"])
    assert updated["title"] == "New title"
    assert updated["tags"] == ["coin", "pla"]
    real.delete_job(job["id"])
    try:
        real.close()
    except Exception:  # noqa: BLE001
        pass


def test_cli_jobs_rename_requires_field(api_app, monkeypatch: pytest.MonkeyPatch, capsys):
    def fake_client(*_a: Any, **_k: Any) -> MeshMooseClient:
        return MeshMooseClient(
            base_url="http://test",
            token="t",
            transport=_TestTransport(api_app),  # type: ignore[arg-type]
        )

    monkeypatch.setattr("meshmoose_api.cli.MeshMooseClient", fake_client)
    code = cli_main(["jobs", "rename", "some-id"])
    assert code == 2
    assert "--title" in capsys.readouterr().err


def test_cli_jobs_logs(api_app, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys):
    transport = _TestTransport(api_app)
    real = MeshMooseClient(base_url="http://test", token="t", transport=transport)  # type: ignore[arg-type]
    photo = tmp_path / "p.jpg"
    mesh = tmp_path / "m.stl"
    photo.write_bytes(b"\xff\xd8\xff\xd9")
    mesh.write_bytes(b"solid x\nendsolid x\n")
    job = real.create_job(prompt="x", photos=[photo], meshes=[mesh], mode="fast")
    # The create already emits a "Job created" line into outputs/job.log.

    def fake_client(*_a: Any, **_k: Any) -> MeshMooseClient:
        return MeshMooseClient(
            base_url="http://test",
            token="t",
            transport=_TestTransport(api_app),  # type: ignore[arg-type]
        )

    monkeypatch.setattr("meshmoose_api.cli.MeshMooseClient", fake_client)
    code = cli_main(["jobs", "logs", job["id"]])
    assert code == 0
    out = capsys.readouterr().out
    assert "Job created" in out
    real.delete_job(job["id"])
    try:
        real.close()
    except Exception:  # noqa: BLE001
        pass


def test_cli_jobs_logs_missing(api_app, monkeypatch: pytest.MonkeyPatch, capsys):
    def fake_client(*_a: Any, **_k: Any) -> MeshMooseClient:
        return MeshMooseClient(
            base_url="http://test",
            token="t",
            transport=_TestTransport(api_app),  # type: ignore[arg-type]
        )

    monkeypatch.setattr("meshmoose_api.cli.MeshMooseClient", fake_client)
    code = cli_main(["jobs", "logs", "nonexistent-job"])
    assert code == 1
    assert "job.log" in capsys.readouterr().err


def test_cli_completion(capsys):
    code = cli_main(["completion", "bash"])
    assert code == 0
    out = capsys.readouterr().out
    assert "complete -F _meshmoose meshmoose" in out
    code = cli_main(["completion", "zsh"])
    assert code == 0
    assert "#compdef meshmoose" in capsys.readouterr().out


def test_openapi_docs_available(api_app):
    with TestClient(api_app) as http:
        res = http.get("/openapi.json")
        assert res.status_code == 200
        spec = res.json()
        paths = spec["paths"]
        assert "/jobs" in paths
        assert "/health" in paths
        assert "/finishes" in paths
        assert "/jobs/{job_id}/finish" in paths
        assert "/demos" in paths
        assert spec["info"]["title"] == "MeshMoose.ai API"


def test_client_list_finishes(client: MeshMooseClient):
    presets = client.list_finishes()
    assert isinstance(presets, list)
    assert any(p.get("id") == "brushed-aluminum" for p in presets)


def test_cli_mesh_corrupt(tmp_path: Path, capsys):
    import trimesh

    from meshmoose_api.cli import main as cli_main

    src = tmp_path / "sphere.stl"
    out = tmp_path / "partial.stl"
    trimesh.creation.icosphere(subdivisions=2).export(src)
    code = cli_main(
        [
            "mesh",
            "corrupt",
            str(src),
            "-o",
            str(out),
            "--missing",
            "0.3",
            "--noise",
            "0.2",
            "--artifacts",
            "2",
            "--seed",
            "1",
        ]
    )
    assert code == 0
    assert out.is_file()
    assert out.stat().st_size > 80
    printed = capsys.readouterr().out
    assert "faces" in printed.lower() or "wrote" in printed.lower() or out.name in printed
