from __future__ import annotations

import json
import re
import shutil
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

from meshmoose_api.config import data_dir
from meshmoose_api.errors import format_job_error
from meshmoose_api.logging_util import JobLogger, utc_now
from meshmoose_api.photos import normalize_photo_upload


class JobStatus(str, Enum):
    QUEUED = "queued"
    PREPROCESSING = "preprocessing"
    AGENT_RUNNING = "agent_running"
    EXPORTING = "exporting"
    MEASURING = "measuring"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


AGENT_MODES = ("fast", "thoughtful", "auto", "zookeeper_pro")


def _parse_utc(iso: str | None) -> datetime | None:
    if not iso or not isinstance(iso, str):
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None


def _delta_ms(start_iso: str | None, end_iso: str) -> int:
    start = _parse_utc(start_iso)
    end = _parse_utc(end_iso)
    if start is None or end is None:
        return 0
    return max(0, int((end - start).total_seconds() * 1000))


@dataclass
class JobPaths:
    root: Path

    @property
    def meta(self) -> Path:
        return self.root / "meta.json"

    @property
    def inputs(self) -> Path:
        return self.root / "inputs"

    @property
    def outputs(self) -> Path:
        return self.root / "outputs"


def _slug(text: str, max_len: int = 48) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower()).strip("-")
    return (s or "job")[:max_len]


MAX_TAGS = 5
MAX_TAG_LEN = 24
MAX_TITLE_LEN = 80


def normalize_tags(tags: list[str] | None) -> list[str]:
    """Dedupe, trim, and cap tags for job metadata."""
    if not tags:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for raw in tags:
        if not isinstance(raw, str):
            continue
        tag = re.sub(r"\s+", " ", raw.strip())[:MAX_TAG_LEN]
        if not tag:
            continue
        key = tag.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(tag)
        if len(out) >= MAX_TAGS:
            break
    return out


def normalize_title(title: str | None, *, fallback: str = "job") -> str:
    t = (title or "").strip()
    if not t:
        return fallback[:MAX_TITLE_LEN]
    return t[:MAX_TITLE_LEN]


class JobStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or data_dir() / "jobs").resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self._locks: dict[str, threading.Lock] = {}
        self._global = threading.Lock()

    def _lock(self, job_id: str) -> threading.Lock:
        with self._global:
            if job_id not in self._locks:
                self._locks[job_id] = threading.Lock()
            return self._locks[job_id]

    def paths(self, job_id: str) -> JobPaths:
        return JobPaths(self.root / job_id)

    def logger(self, job_id: str) -> JobLogger:
        return JobLogger(self.paths(job_id).root)

    def create(
        self,
        *,
        prompt: str,
        mode: str = "thoughtful",
        title: str | None = None,
        tags: list[str] | None = None,
    ) -> dict[str, Any]:
        if mode not in AGENT_MODES:
            mode = "thoughtful"
        job_id = f"{utc_now()[:19].replace(':', '')}-{uuid.uuid4().hex[:8]}"
        job_id = job_id.replace("T", "-")
        paths = self.paths(job_id)
        paths.root.mkdir(parents=True, exist_ok=False)
        paths.inputs.mkdir()
        paths.outputs.mkdir()
        now = utc_now()
        meta = {
            "id": job_id,
            "title": normalize_title(title, fallback=_slug(prompt)[:40]),
            "tags": normalize_tags(tags),
            "prompt": prompt,
            "mode": mode,
            "status": JobStatus.QUEUED.value,
            "created_at": now,
            "updated_at": now,
            # Cumulative wall time spent in running statuses (excludes idle between refine runs).
            "active_ms": 0,
            "run_started_at": now,
            "conversation_id": None,
            "error": None,
            "input_photos": [],
            "input_meshes": [],
            "demo_id": None,
            "prompts": [
                {
                    "role": "initial",
                    "text": prompt,
                    "mode": mode,
                    "created_at": now,
                }
            ],
        }
        self.write_meta(job_id, meta)
        self.logger(job_id).emit("Job created", kind="status", status=meta["status"])
        return meta

    def patch_job(
        self,
        job_id: str,
        *,
        title: str | None = None,
        tags: list[str] | None = None,
    ) -> dict[str, Any]:
        fields: dict[str, Any] = {}
        if title is not None:
            fields["title"] = normalize_title(title, fallback=self.get(job_id).get("title") or "job")
        if tags is not None:
            fields["tags"] = normalize_tags(tags)
        if fields:
            self.update_meta(job_id, **fields)
        return self.get(job_id, hydrate=True)

    def append_prompt(
        self,
        job_id: str,
        *,
        text: str,
        role: str = "refine",
        mode: str | None = None,
        created_at: str | None = None,
    ) -> dict[str, Any]:
        meta = self.ensure_prompt_history(job_id)
        prompts = list(meta.get("prompts") or [])
        entry = {
            "role": role,
            "text": text,
            "mode": mode or meta.get("mode"),
            "created_at": created_at or utc_now(),
        }
        # Avoid duplicates when recovering from logs / double-submit.
        # Allow repeated finish / manual edit entries.
        if role not in {"finish", "edit"} and any(
            p.get("role") == role and p.get("text") == text for p in prompts
        ):
            return meta
        prompts.append(entry)
        return self.update_meta(job_id, prompts=prompts)

    def save_main_kcl(
        self,
        job_id: str,
        source: str,
        *,
        note: str | None = None,
    ) -> dict[str, Any]:
        """Write outputs/main.kcl, keep one previous snapshot, record prompt history."""
        _ = self.get(job_id)  # KeyError if missing
        paths = self.paths(job_id)
        paths.outputs.mkdir(parents=True, exist_ok=True)
        kcl_path = paths.outputs / "main.kcl"
        prev_path = paths.outputs / "main.prev.kcl"
        if kcl_path.is_file():
            prev_path.write_bytes(kcl_path.read_bytes())
        text = source.replace("\r\n", "\n")
        kcl_path.write_text(text, encoding="utf-8")
        label = (note or "").strip() or f"Manual KCL edit ({len(text)} chars)"
        self.append_prompt(job_id, text=label, role="edit")
        self.logger(job_id).emit(
            f"Saved main.kcl ({len(text)} chars)"
            + (f": {label}" if (note or "").strip() else ""),
            kind="kcl_edit",
        )
        return self.get(job_id, hydrate=True)

    def ensure_prompt_history(self, job_id: str) -> dict[str, Any]:
        """Backfill prompts[] from meta.prompt + job.log refine lines (legacy jobs)."""
        meta = self.get(job_id)
        prompts = list(meta.get("prompts") or [])
        changed = False
        if not prompts and meta.get("prompt"):
            prompts.append(
                {
                    "role": "initial",
                    "text": meta["prompt"],
                    "mode": meta.get("mode"),
                    "created_at": meta.get("created_at") or utc_now(),
                }
            )
            changed = True

        seen = {(p.get("role"), p.get("text")) for p in prompts}
        log_path = self.paths(job_id).outputs / "job.log"
        if log_path.is_file():
            # Matches both legacy "Refine queued: …" and "Refine queued (N chars): …"
            pattern = re.compile(
                r"^(\S+)\s+\w+\s+Refine queued(?: \(\d+ chars\))?:\s*(.+)\s*$"
            )
            for line in log_path.read_text(encoding="utf-8", errors="replace").splitlines():
                m = pattern.match(line)
                if not m:
                    continue
                ts, text = m.group(1), m.group(2).strip()
                key = ("refine", text)
                if not text or key in seen:
                    continue
                prompts.append(
                    {
                        "role": "refine",
                        "text": text,
                        "mode": meta.get("mode"),
                        "created_at": ts,
                    }
                )
                seen.add(key)
                changed = True

        if changed:
            meta = self.update_meta(job_id, prompts=prompts)
        return meta

    def hydrate(self, meta: dict[str, Any]) -> dict[str, Any]:
        job_id = meta.get("id")
        if not job_id:
            return meta
        return self.ensure_prompt_history(str(job_id))

    RUNNING_STATUSES = frozenset(
        {
            JobStatus.QUEUED.value,
            JobStatus.PREPROCESSING.value,
            JobStatus.AGENT_RUNNING.value,
            JobStatus.EXPORTING.value,
            JobStatus.MEASURING.value,
        }
    )

    def reap_orphans(self, *, reason: str = "Interrupted — API process restarted") -> int:
        """Mark in-flight jobs failed after a process restart (daemon workers are gone)."""
        count = 0
        for meta in self.list_jobs(hydrate=False):
            if meta.get("status") not in self.RUNNING_STATUSES:
                continue
            job_id = meta["id"]
            self.update_meta(job_id, cancel_requested=True, error=reason)
            self.set_status(job_id, JobStatus.FAILED, error=reason)
            self.logger(job_id).emit(reason, level="warn", kind="status")
            count += 1
        return count

    def request_cancel(self, job_id: str, *, reason: str = "Cancelled by user") -> dict[str, Any]:
        meta = self.get(job_id)
        if meta.get("status") not in self.RUNNING_STATUSES:
            return meta
        self.update_meta(job_id, cancel_requested=True, error=reason)
        return self.set_status(job_id, JobStatus.FAILED, error=reason)

    def clear_cancel(self, job_id: str) -> None:
        self.update_meta(job_id, cancel_requested=False)

    def is_cancelled(self, job_id: str) -> bool:
        return bool(self.get(job_id).get("cancel_requested"))

    def write_meta(self, job_id: str, meta: dict[str, Any]) -> None:
        meta["updated_at"] = utc_now()
        path = self.paths(job_id).meta
        tmp = path.with_suffix(".tmp")
        with self._lock(job_id):
            tmp.write_text(json.dumps(meta, indent=2), encoding="utf-8")
            tmp.replace(path)

    def update_meta(self, job_id: str, **fields: Any) -> dict[str, Any]:
        meta = self.get(job_id)
        meta.update(fields)
        self.write_meta(job_id, meta)
        return meta

    def set_status(self, job_id: str, status: JobStatus, error: str | None = None) -> dict[str, Any]:
        meta = self.get(job_id)
        prev = str(meta.get("status") or "")
        now = utc_now()
        active_ms = int(meta.get("active_ms") or 0)
        run_started = meta.get("run_started_at")
        prev_running = prev in self.RUNNING_STATUSES
        next_running = status.value in self.RUNNING_STATUSES

        fields: dict[str, Any] = {
            "status": status.value,
            "active_ms": active_ms,
            "run_started_at": run_started,
        }
        if prev_running and not next_running:
            active_ms += _delta_ms(
                run_started if isinstance(run_started, str) else None, now
            )
            fields["active_ms"] = active_ms
            fields["run_started_at"] = None
        elif not prev_running and next_running:
            fields["run_started_at"] = now
        elif next_running and not run_started:
            # Resume tracking for older jobs that lack run_started_at.
            fields["run_started_at"] = now

        if error is not None:
            fields["error"] = format_job_error(error) if error else error
        meta = self.update_meta(job_id, **fields)
        self.logger(job_id).emit(
            f"Status → {status.value}",
            level="error" if status == JobStatus.FAILED else "info",
            kind="status",
            status=status.value,
            error=fields.get("error", error),
        )
        return meta

    @staticmethod
    def _sanitize_meta_error(meta: dict[str, Any]) -> dict[str, Any]:
        err = meta.get("error")
        if isinstance(err, str) and err:
            cleaned = format_job_error(err)
            if cleaned != err:
                meta["error"] = cleaned
        return meta

    def get(self, job_id: str, *, hydrate: bool = False) -> dict[str, Any]:
        path = self.paths(job_id).meta
        if not path.is_file():
            raise KeyError(job_id)
        meta = json.loads(path.read_text(encoding="utf-8"))
        if hydrate:
            meta = self.ensure_prompt_history(job_id)
        return self._sanitize_meta_error(meta)

    def list_jobs(self, *, hydrate: bool = True) -> list[dict[str, Any]]:
        jobs: list[dict[str, Any]] = []
        for child in sorted(self.root.iterdir(), reverse=True):
            if (child / "meta.json").is_file():
                try:
                    meta = json.loads((child / "meta.json").read_text(encoding="utf-8"))
                    if hydrate and meta.get("id"):
                        meta = self.ensure_prompt_history(meta["id"])
                    jobs.append(self._sanitize_meta_error(meta))
                except json.JSONDecodeError:
                    continue
        return jobs

    def save_upload(self, job_id: str, filename: str, data: bytes, kind: str) -> str:
        if kind == "photo":
            safe, data = normalize_photo_upload(filename, data)
        else:
            safe = Path(filename).name.replace(" ", "_")
        dest = self.paths(job_id).inputs / safe
        dest.write_bytes(data)
        meta = self.get(job_id)
        key = "input_photos" if kind == "photo" else "input_meshes"
        names = list(meta.get(key) or [])
        if safe not in names:
            names.append(safe)
        self.update_meta(job_id, **{key: names})
        return safe

    def copy_demo_file(self, job_id: str, src: Path, kind: str) -> str:
        return self.save_upload(job_id, src.name, src.read_bytes(), kind)

    def retry_job(self, job_id: str) -> dict[str, Any]:
        """Clone a failed job's prompt + inputs into a new queued job."""
        src = self.get(job_id)
        if src.get("status") != JobStatus.FAILED.value:
            raise ValueError("Only failed jobs can be retried")
        photos = list(src.get("input_photos") or [])
        meshes = list(src.get("input_meshes") or [])
        if not photos or not meshes:
            raise ValueError("Failed job is missing input photos or meshes")

        new_meta = self.create(
            prompt=src.get("prompt") or "",
            mode=src.get("mode") or "thoughtful",
            title=src.get("title"),
            tags=list(src.get("tags") or []),
        )
        new_id = new_meta["id"]
        src_inputs = self.paths(job_id).inputs
        for name in photos:
            path = src_inputs / name
            if path.is_file():
                self.save_upload(new_id, name, path.read_bytes(), "photo")
        for name in meshes:
            path = src_inputs / name
            if path.is_file():
                self.save_upload(new_id, name, path.read_bytes(), "mesh")

        if src.get("demo_id"):
            self.update_meta(new_id, demo_id=src.get("demo_id"))

        note = f"Retried as job {new_id}"
        prev_notes = (src.get("notes") or "").strip()
        notes = f"{prev_notes}\n{note}".strip() if prev_notes else note
        self.update_meta(
            job_id,
            retried_as=new_id,
            notes=notes,
        )
        self.logger(job_id).emit(note, kind="retry", level="info")

        self.update_meta(new_id, retry_of=job_id)
        self.logger(new_id).emit(
            f"Retry of failed job {job_id}",
            kind="retry",
            level="info",
        )
        return self.get(new_id, hydrate=True)

    def artifact_path(self, job_id: str, relative: str) -> Path:
        # Prevent path escape
        rel = Path(relative)
        if rel.is_absolute() or ".." in rel.parts:
            raise ValueError("invalid path")
        # The active Compare reference resolves through meta, not a fixed file.
        if rel.as_posix() == "outputs/reference.stl":
            return self.reference_path(job_id)
        path = (self.paths(job_id).root / rel).resolve()
        root = self.paths(job_id).root.resolve()
        if not str(path).startswith(str(root)):
            raise ValueError("invalid path")
        return path

    def list_input_meshes(self, job_id: str) -> list[str]:
        """Mesh files in inputs/ the user can pick as the Compare reference."""
        meta = self.get(job_id)
        out: list[str] = []
        for name in meta.get("input_meshes") or []:
            if (self.paths(job_id).inputs / name).is_file():
                out.append(name)
        # The normalized agent mesh is always a candidate if present.
        agent = self.paths(job_id).inputs / "mesh_for_agent.stl"
        if agent.is_file() and "mesh_for_agent.stl" not in out:
            out.append("mesh_for_agent.stl")
        return out

    def reference_source(self, job_id: str) -> str:
        """Relative path (from job root) of the active reference mesh."""
        meta = self.get(job_id)
        src = meta.get("reference_source")
        if src and (self.paths(job_id).root / src).is_file():
            return src
        # Default: the normalized agent mesh, else the generated reference output.
        if (self.paths(job_id).inputs / "mesh_for_agent.stl").is_file():
            return "inputs/mesh_for_agent.stl"
        return "outputs/reference.stl"

    def reference_path(self, job_id: str) -> Path:
        return (self.paths(job_id).root / self.reference_source(job_id)).resolve()

    def set_reference_source(self, job_id: str, source: str) -> dict[str, Any]:
        """Set the active Compare reference to an input mesh or the default output."""
        allowed = {f"inputs/{n}" for n in self.list_input_meshes(job_id)}
        allowed.add("outputs/reference.stl")
        if source not in allowed:
            raise ValueError(
                f"Invalid reference '{source}'. Choose one of: {', '.join(sorted(allowed))}"
            )
        return self.update_meta(job_id, reference_source=source)

    def delete(self, job_id: str) -> None:
        shutil.rmtree(self.paths(job_id).root, ignore_errors=True)

    def list_artifacts(self, job_id: str) -> list[dict[str, Any]]:
        """List viewer-relevant inputs/outputs (photos, mesh, agent snapshots, exports)."""
        paths = self.paths(job_id)
        items: list[dict[str, Any]] = []
        meta = self.get(job_id)

        for name in meta.get("input_photos") or []:
            path = paths.inputs / name
            if path.is_file() and name.lower().endswith(
                (".jpg", ".jpeg", ".png", ".webp", ".gif")
            ):
                items.append(
                    {
                        "name": name,
                        "path": f"inputs/{name}",
                        "kind": "reference_photo",
                        "bytes": path.stat().st_size,
                        "mtime": path.stat().st_mtime,
                    }
                )

        out = paths.outputs
        if out.is_dir():
            for path in sorted(out.iterdir()):
                if not path.is_file():
                    continue
                name = path.name
                kind = "other"
                if name == "reference.stl":
                    kind = "reference_mesh"
                elif name == "generated.stl":
                    kind = "generated_mesh"
                elif name.startswith("agent_") and name.lower().endswith(
                    (".jpg", ".jpeg", ".png", ".webp")
                ):
                    kind = "agent_snapshot"
                elif name.endswith((".kcl", ".step", ".3mf", ".json", ".md", ".log")):
                    kind = "output"
                else:
                    continue
                items.append(
                    {
                        "name": name,
                        "path": f"outputs/{name}",
                        "kind": kind,
                        "bytes": path.stat().st_size,
                        "mtime": path.stat().st_mtime,
                    }
                )
        return items
