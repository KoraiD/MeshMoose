from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
from typing import Annotated

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from meshmoose_api import __version__
from meshmoose_api.align import align_meshes
from meshmoose_api.config import ROOT, configure_logging, data_dir
from meshmoose_api.finishes import get_finish_preset, list_finish_presets
from meshmoose_api.jobs import AGENT_MODES, JobStatus, JobStore, normalize_tags
from meshmoose_api.pipeline import apply_finish_job, refine_job, run_job
from meshmoose_api.zoo_usage import fetch_zoo_usage


class JobPatch(BaseModel):
    title: str | None = Field(default=None, max_length=80)
    tags: list[str] | None = None


class ReferencePatch(BaseModel):
    source: str


configure_logging()
app = FastAPI(
    title="MeshMoose.ai API",
    version=__version__,
    description=(
        "Local multimodal reconstruction API: photo + mesh + prompt → parametric KCL "
        "via Zoo Agent / Engine / File Format. Authenticate with "
        "`Authorization: Bearer <ZOO_API_TOKEN>`."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_tags=[
        {"name": "system", "description": "Health and service metadata"},
        {"name": "jobs", "description": "Create, monitor, refine, and export jobs"},
        {"name": "demos", "description": "Packaged sample fixtures"},
        {"name": "account", "description": "Zoo usage (proxied, sanitized)"},
    ],
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:4173",
        "http://localhost:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = JobStore()
DEMOS_DIR = ROOT / "demos"
PROMPT_MAX_CHARS = 8000
REFINE_MAX_CHARS = 2000
# Per-file upload cap. Zookeeper payloads are ~64MB after JSON uint8 expansion;
# 32MB per raw file leaves headroom for multi-file jobs (see docs/api-notes.md).
MAX_UPLOAD_BYTES = 32 * 1024 * 1024


async def _read_capped(upload: UploadFile, filename: str) -> bytes:
    """Read an upload, rejecting as soon as it exceeds the per-file limit.

    Reads at most MAX_UPLOAD_BYTES + 1 so oversized payloads are rejected
    without buffering the whole body in memory.
    """
    data = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"'{filename}' exceeds the "
                f"{MAX_UPLOAD_BYTES // (1024 * 1024)}MB per-file limit. "
                "Resize photos or simplify meshes before uploading."
            ),
        )
    return data


def require_token(
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Authorization Bearer token required")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Empty token")
    return token


@app.get("/health", tags=["system"])
def health() -> dict:
    return {"ok": True, "service": "meshmoose-api", "version": __version__}


@app.get("/zoo/usage", tags=["account"])
def zoo_usage(token: str = Depends(require_token)) -> dict:
    """Proxy Zoo payment balance + recent API calls (sanitized, no PII)."""
    try:
        return fetch_zoo_usage(token)
    except Exception as exc:  # noqa: BLE001
        logging.getLogger("meshmoose.jobs").warning("Zoo usage fetch failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=f"Could not fetch Zoo usage: {exc}",
        ) from exc


@app.get("/demos", tags=["demos"])
def list_demos() -> list[dict]:
    demos: list[dict] = []
    if not DEMOS_DIR.is_dir():
        return demos
    for child in sorted(DEMOS_DIR.iterdir()):
        manifest = child / "demo.json"
        if manifest.is_file():
            data = json.loads(manifest.read_text(encoding="utf-8"))
            data["id"] = child.name
            demos.append(data)
    return demos


@app.get("/finishes", tags=["jobs"])
def finishes(_: str = Depends(require_token)) -> list[dict]:
    """List PBR surface-finish presets for Apply finish."""
    return list_finish_presets()


@app.get("/jobs", tags=["jobs"])
def list_jobs(_: str = Depends(require_token)) -> list[dict]:
    return store.list_jobs()


@app.get("/jobs/{job_id}", tags=["jobs"])
def get_job(job_id: str, _: str = Depends(require_token)) -> dict:
    try:
        return store.get(job_id, hydrate=True)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc


@app.delete("/jobs/{job_id}", tags=["jobs"])
def delete_job(job_id: str, _: str = Depends(require_token)) -> dict:
    try:
        store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    store.delete(job_id)
    return {"ok": True, "id": job_id}


@app.patch("/jobs/{job_id}", tags=["jobs"])
def patch_job(job_id: str, body: JobPatch, _: str = Depends(require_token)) -> dict:
    """Rename a job and/or replace its tags (max 5)."""
    try:
        store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    if body.title is None and body.tags is None:
        raise HTTPException(status_code=400, detail="Provide title and/or tags")
    tags = normalize_tags(body.tags) if body.tags is not None else None
    return store.patch_job(job_id, title=body.title, tags=tags)


@app.post("/jobs/{job_id}/retry", tags=["jobs"])
def retry_job(
    job_id: str,
    background: BackgroundTasks,
    token: str = Depends(require_token),
) -> dict:
    """Clone a failed job's prompt + input files into a new run."""
    try:
        store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    try:
        meta = store.retry_job(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    background.add_task(_start_job_thread, meta["id"], token)
    return meta


@app.post("/jobs/{job_id}/cancel", tags=["jobs"])
def cancel_job(job_id: str, _: str = Depends(require_token)) -> dict:
    try:
        meta = store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    if meta.get("status") not in JobStore.RUNNING_STATUSES:
        raise HTTPException(status_code=409, detail="Job is not running")
    return store.request_cancel(job_id)


@app.get("/jobs/{job_id}/events", tags=["jobs"])
async def job_events(
    job_id: str,
    after: int = 0,
    _: str = Depends(require_token),
) -> StreamingResponse:
    try:
        store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc

    start = max(0, after)

    async def gen():
        log = store.logger(job_id)
        seen = start
        # Backlog from cursor (0 = full history; reconnects pass the last seen index).
        events, seen = log.read_events_with_cursor(seen)
        for ev in events:
            yield f"data: {json.dumps(ev)}\n\n"
        # Keep streaming for the life of the connection so refine / finish after a
        # succeeded job still push status + artifacts to the open Workbench page.
        while True:
            await asyncio.sleep(0.5)
            try:
                store.get(job_id)
            except KeyError:
                yield f"data: {json.dumps({'kind': 'stream_end', 'status': 'gone'})}\n\n"
                break
            new_events, seen = log.read_events_with_cursor(seen)
            for ev in new_events:
                yield f"data: {json.dumps(ev)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/jobs/{job_id}/reference", tags=["jobs"])
def get_reference(job_id: str, _: str = Depends(require_token)) -> dict:
    """Active Compare reference mesh + the list of selectable input meshes."""
    try:
        store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    return {
        "active": store.reference_source(job_id),
        "available": [f"inputs/{n}" for n in store.list_input_meshes(job_id)]
        + ["outputs/reference.stl"],
    }


@app.put("/jobs/{job_id}/reference", tags=["jobs"])
def put_reference(job_id: str, body: ReferencePatch, _: str = Depends(require_token)) -> dict:
    try:
        store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    try:
        store.set_reference_source(job_id, body.source)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"active": store.reference_source(job_id)}


@app.post("/jobs/{job_id}/align", tags=["jobs"])
def align_job(job_id: str, _: str = Depends(require_token)) -> dict:
    """ICP-align generated mesh onto reference and compute per-vertex deviation."""
    try:
        store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    paths = store.paths(job_id)
    ref = store.reference_path(job_id)
    gen = paths.outputs / "generated.stl"
    if not ref.is_file() or not gen.is_file():
        raise HTTPException(
            status_code=400,
            detail="Both a reference mesh and generated.stl are required — run a successful job first",
        )
    try:
        return align_meshes(reference_stl=ref, generated_stl=gen)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Alignment failed: {exc}") from exc


@app.get("/jobs/{job_id}/artifacts", tags=["jobs"])
def job_artifacts(job_id: str, _: str = Depends(require_token)) -> list[dict]:
    try:
        store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    return store.list_artifacts(job_id)


@app.get("/jobs/{job_id}/files/{file_path:path}", tags=["jobs"])
def job_file(job_id: str, file_path: str, _: str = Depends(require_token)) -> FileResponse:
    try:
        path = store.artifact_path(job_id, file_path)
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        path,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
        },
    )


def _start_job_thread(job_id: str, token: str) -> None:
    threading.Thread(target=run_job, args=(store, job_id, token), daemon=True).start()


@app.post("/jobs", tags=["jobs"])
async def create_job(
    background: BackgroundTasks,
    prompt: str = Form(...),
    mode: str = Form("thoughtful"),
    title: str | None = Form(None),
    tags: str | None = Form(None),
    photos: list[UploadFile] = File(default=[]),
    meshes: list[UploadFile] = File(default=[]),
    token: str = Depends(require_token),
) -> dict:
    if mode not in AGENT_MODES:
        mode = "thoughtful"
    if len(prompt) > PROMPT_MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Prompt exceeds {PROMPT_MAX_CHARS} characters",
        )
    if not photos:
        raise HTTPException(status_code=400, detail="At least one photo is required")
    if not meshes:
        raise HTTPException(status_code=400, detail="At least one mesh is required")

    tag_list: list[str] | None = None
    if tags is not None and tags.strip():
        tag_list = [t for t in re.split(r"[,|]", tags) if t.strip()]
    meta = store.create(prompt=prompt, mode=mode, title=title, tags=tag_list)
    job_id = meta["id"]
    try:
        for photo in photos:
            data = await _read_capped(photo, photo.filename or "photo.jpg")
            store.save_upload(job_id, photo.filename or "photo.jpg", data, "photo")
        for mesh in meshes:
            data = await _read_capped(mesh, mesh.filename or "mesh.stl")
            store.save_upload(job_id, mesh.filename or "mesh.stl", data, "mesh")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    background.add_task(_start_job_thread, job_id, token)
    return store.get(job_id)


@app.post("/jobs/from-demo/{demo_id}", tags=["demos"])
async def create_job_from_demo(
    demo_id: str,
    background: BackgroundTasks,
    mode: str = Form("thoughtful"),
    prompt: str | None = Form(None),
    token: str = Depends(require_token),
) -> dict:
    demo_dir = DEMOS_DIR / demo_id
    manifest_path = demo_dir / "demo.json"
    if not manifest_path.is_file():
        raise HTTPException(status_code=404, detail="Demo not found")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    use_prompt = prompt or manifest.get("prompt") or ""
    if mode not in AGENT_MODES:
        mode = manifest.get("mode") or "thoughtful"

    meta = store.create(prompt=use_prompt, mode=mode, title=manifest.get("title"))
    job_id = meta["id"]
    store.update_meta(job_id, demo_id=demo_id)

    for name in manifest.get("photos") or []:
        src = demo_dir / name
        if src.is_file():
            store.copy_demo_file(job_id, src, "photo")
    for name in manifest.get("meshes") or []:
        src = demo_dir / name
        if src.is_file():
            store.copy_demo_file(job_id, src, "mesh")

    if not store.get(job_id).get("input_photos") or not store.get(job_id).get("input_meshes"):
        raise HTTPException(status_code=400, detail="Demo missing photos or meshes")

    background.add_task(_start_job_thread, job_id, token)
    return store.get(job_id)


@app.post("/jobs/{job_id}/refine", tags=["jobs"])
async def refine(
    job_id: str,
    background: BackgroundTasks,
    message: str = Form(...),
    photos: list[UploadFile] = File(default=[]),
    meshes: list[UploadFile] = File(default=[]),
    token: str = Depends(require_token),
) -> dict:
    try:
        meta = store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc

    if meta.get("status") in {"queued", "preprocessing", "agent_running", "exporting", "measuring"}:
        raise HTTPException(status_code=409, detail="Job is still running")

    kcl = store.paths(job_id).outputs / "main.kcl"
    if not kcl.is_file():
        raise HTTPException(
            status_code=400,
            detail="No main.kcl available to refine — run a successful job first",
        )

    text = message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Refine message is empty")
    if len(text) > REFINE_MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Refine message exceeds {REFINE_MAX_CHARS} characters",
        )

    photo_names: list[str] = []
    mesh_names: list[str] = []
    try:
        for photo in photos or []:
            data = await _read_capped(photo, photo.filename or "refine_photo.jpg")
            if not data:
                continue
            name = store.save_upload(
                job_id, photo.filename or "refine_photo.jpg", data, "photo"
            )
            photo_names.append(name)
        for mesh in meshes or []:
            data = await _read_capped(mesh, mesh.filename or "refine_mesh.stl")
            if not data:
                continue
            name = store.save_upload(
                job_id, mesh.filename or "refine_mesh.stl", data, "mesh"
            )
            mesh_names.append(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    attach_note = ""
    if photo_names or mesh_names:
        attach_note = f" (+{len(photo_names)} photo(s), {len(mesh_names)} mesh(es))"

    store.clear_cancel(job_id)
    store.append_prompt(
        job_id,
        text=text if not attach_note else f"{text}{attach_note}",
        role="refine",
        mode=meta.get("mode"),
    )
    store.update_meta(job_id, error=None)
    # Claim the job immediately so clients can't double-submit while the thread starts.
    store.set_status(job_id, JobStatus.AGENT_RUNNING)
    store.logger(job_id).emit(
        f"Refine queued ({len(text)} chars){attach_note}: {text[:160]}",
        kind="refine",
    )

    def _start() -> None:
        threading.Thread(
            target=refine_job,
            kwargs={
                "store": store,
                "job_id": job_id,
                "token": token,
                "message": text,
                "photo_names": photo_names,
                "mesh_names": mesh_names,
            },
            daemon=True,
        ).start()

    background.add_task(_start)
    return store.get(job_id, hydrate=True)


@app.post("/jobs/{job_id}/finish", tags=["jobs"])
async def apply_finish(
    job_id: str,
    background: BackgroundTasks,
    preset: str = Form(...),
    token: str = Depends(require_token),
) -> dict:
    """Apply a PBR appearance preset to main.kcl and re-export (no Agent call)."""
    try:
        meta = store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc

    if meta.get("status") in {
        "queued",
        "preprocessing",
        "agent_running",
        "exporting",
        "measuring",
    }:
        raise HTTPException(status_code=409, detail="Job is still running")

    kcl = store.paths(job_id).outputs / "main.kcl"
    if not kcl.is_file():
        raise HTTPException(
            status_code=400,
            detail="No main.kcl available — run a successful job first",
        )

    try:
        finish = get_finish_preset(preset)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    store.clear_cancel(job_id)
    store.update_meta(job_id, error=None)
    # Record prompt history before returning so the UI updates immediately.
    store.append_prompt(
        job_id,
        text=f"Apply finish: {finish.name}",
        role="finish",
        mode=meta.get("mode"),
    )
    store.set_status(job_id, JobStatus.EXPORTING)
    store.logger(job_id).emit(
        f"Finish queued: {finish.name} ({finish.id})",
        kind="finish",
    )

    def _start() -> None:
        threading.Thread(
            target=apply_finish_job,
            kwargs={
                "store": store,
                "job_id": job_id,
                "token": token,
                "preset_id": finish.id,
            },
            daemon=True,
        ).start()

    background.add_task(_start)
    return store.get(job_id, hydrate=True)


# Serve demo static files for UI previews
if DEMOS_DIR.is_dir():
    app.mount("/demo-assets", StaticFiles(directory=str(DEMOS_DIR)), name="demo-assets")


@app.on_event("startup")
def _startup() -> None:
    data_dir()
    n = store.reap_orphans()
    if n:
        logging.getLogger("meshmoose.jobs").warning("Reaped %s orphaned in-flight job(s)", n)
