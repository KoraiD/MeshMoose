from __future__ import annotations

import traceback
from pathlib import Path

from meshmoose_api.agent import run_copilot_reconstruct, run_copilot_refine
from meshmoose_api.errors import format_job_error
from meshmoose_api.export_kcl import export_kcl
from meshmoose_api.finishes import apply_finish_to_kcl, get_finish_preset
from meshmoose_api.jobs import JobStatus, JobStore
from meshmoose_api.metrics import compare_meshes
from meshmoose_api.preprocess import ensure_stl_for_agent


def run_job(store: JobStore, job_id: str, token: str) -> None:
    log = store.logger(job_id)
    paths = store.paths(job_id)
    try:
        store.clear_cancel(job_id)
        meta = store.get(job_id)
        store.set_status(job_id, JobStatus.PREPROCESSING)
        photo_names = meta.get("input_photos") or []
        mesh_names = meta.get("input_meshes") or []
        photo_paths = [paths.inputs / n for n in photo_names]
        mesh_paths = [paths.inputs / n for n in mesh_names]
        for p in photo_paths:
            if not p.is_file():
                raise FileNotFoundError(f"Missing photo: {p.name}")
        for m in mesh_paths:
            if not m.is_file():
                raise FileNotFoundError(f"Missing mesh: {m.name}")

        # Prefer an immediate STL preview when the user already uploaded STL.
        ref = paths.outputs / "reference.stl"
        early = next((m for m in mesh_paths if m.suffix.lower() == ".stl"), None)
        if early is not None:
            ref.write_bytes(early.read_bytes())
            log.emit(
                "Reference mesh ready (uploaded STL)",
                kind="artifact",
                path="outputs/reference.stl",
                name="reference.stl",
            )

        agent_stl = paths.inputs / "mesh_for_agent.stl"
        ensure_stl_for_agent(mesh_paths, agent_stl, log=log)
        ref.write_bytes(agent_stl.read_bytes())
        log.emit(
            "Reference mesh ready for viewer",
            kind="artifact",
            path="outputs/reference.stl",
            name="reference.stl",
        )

        store.set_status(job_id, JobStatus.AGENT_RUNNING)
        result = run_copilot_reconstruct(
            token=token,
            prompt=meta["prompt"],
            photo_paths=photo_paths,
            stl_path=agent_stl,
            mode=meta.get("mode") or "thoughtful",
            outputs_dir=paths.outputs,
            log=log,
            project_name=f"meshmoose-{job_id}",
        )
        if result["errors"] and not result.get("main_kcl"):
            raise RuntimeError("; ".join(result["errors"]))

        main_kcl = result.get("main_kcl")
        if not main_kcl:
            raise RuntimeError("Agent did not return main.kcl")

        (paths.outputs / "main.kcl").write_text(main_kcl, encoding="utf-8")
        # Snapshot the first reconstruction so the UI can diff initial vs current.
        initial_kcl = paths.outputs / "main.initial.kcl"
        if not initial_kcl.is_file():
            initial_kcl.write_text(main_kcl, encoding="utf-8")
        (paths.outputs / "assistant.md").write_text(
            result.get("assistant_text") or "", encoding="utf-8"
        )
        store.update_meta(job_id, conversation_id=result.get("conversation_id"))

        store.set_status(job_id, JobStatus.EXPORTING)
        export_kcl(
            token=token,
            main_kcl=main_kcl,
            out_stl=paths.outputs / "generated.stl",
            out_step=paths.outputs / "generated.step",
            out_3mf=paths.outputs / "generated.3mf",
            log=log,
        )

        store.set_status(job_id, JobStatus.MEASURING)
        try:
            compare_meshes(
                token=token,
                reference_stl=ref,
                generated_stl=paths.outputs / "generated.stl",
                out_json=paths.outputs / "metrics.json",
                log=log,
            )
        except Exception as exc:  # noqa: BLE001
            log.emit(f"Measure step failed (non-fatal): {exc}", level="warn", kind="measure")

        if store.is_cancelled(job_id):
            log.emit("Job aborted (cancelled)", level="warn", kind="status")
            return
        store.set_status(job_id, JobStatus.SUCCEEDED)
        log.emit("Job succeeded", kind="status", status="succeeded")
    except Exception as exc:  # noqa: BLE001
        if store.is_cancelled(job_id):
            log.emit(f"Job stopped after cancel: {exc}", level="warn", kind="error")
            return
        tb = traceback.format_exc()
        nice = format_job_error(exc)
        log.emit(nice, level="error", kind="error")
        log.emit(tb, level="error", kind="error", level_detail="traceback")
        store.set_status(job_id, JobStatus.FAILED, error=nice)


def apply_finish_job(store: JobStore, job_id: str, token: str, preset_id: str) -> None:
    """Patch main.kcl with appearance() for a preset, then re-export (no Agent)."""
    log = store.logger(job_id)
    paths = store.paths(job_id)
    try:
        if store.is_cancelled(job_id):
            log.emit("Finish aborted (cancelled before start)", level="warn", kind="status")
            return
        kcl_path = paths.outputs / "main.kcl"
        if not kcl_path.is_file():
            raise RuntimeError("No main.kcl to finish — run a successful job first")

        preset = get_finish_preset(preset_id)
        main_kcl = kcl_path.read_text(encoding="utf-8")
        new_kcl = apply_finish_to_kcl(main_kcl, preset)
        kcl_path.write_text(new_kcl, encoding="utf-8")

        assist = paths.outputs / "assistant.md"
        prev = assist.read_text(encoding="utf-8") if assist.is_file() else ""
        note = (
            f"## Apply finish\n\nApplied **{preset.name}** "
            f"(`appearance` color={preset.color}, metalness={preset.metalness:g}, "
            f"roughness={preset.roughness:g}"
            + (f", opacity={preset.opacity:g}" if preset.opacity is not None else "")
            + ")."
        )
        assist.write_text(prev + ("\n\n---\n\n" if prev.strip() else "") + note, encoding="utf-8")
        # Prompt history is appended in the HTTP handler so the response includes it.

        log.emit(f"Applied finish preset '{preset.id}' ({preset.name})", kind="finish")
        store.set_status(job_id, JobStatus.EXPORTING)
        export_kcl(
            token=token,
            main_kcl=new_kcl,
            out_stl=paths.outputs / "generated.stl",
            out_step=paths.outputs / "generated.step",
            out_3mf=paths.outputs / "generated.3mf",
            log=log,
        )
        if store.is_cancelled(job_id):
            log.emit("Finish aborted after export (cancelled)", level="warn", kind="status")
            return

        ref = store.reference_path(job_id)
        if ref.is_file():
            store.set_status(job_id, JobStatus.MEASURING)
            try:
                compare_meshes(
                    token=token,
                    reference_stl=ref,
                    generated_stl=paths.outputs / "generated.stl",
                    out_json=paths.outputs / "metrics.json",
                    log=log,
                )
            except Exception as exc:  # noqa: BLE001
                log.emit(f"Measure step failed (non-fatal): {exc}", level="warn")

        if store.is_cancelled(job_id):
            log.emit("Finish aborted before success (cancelled)", level="warn", kind="status")
            return
        store.set_status(job_id, JobStatus.SUCCEEDED)
        log.emit("Finish succeeded", kind="status", status="succeeded")
    except Exception as exc:  # noqa: BLE001
        if store.is_cancelled(job_id):
            log.emit(f"Finish stopped after cancel: {exc}", level="warn", kind="error")
            return
        nice = format_job_error(exc)
        log.emit(nice, level="error", kind="error")
        store.set_status(job_id, JobStatus.FAILED, error=nice)


def refine_job(
    store: JobStore,
    job_id: str,
    token: str,
    message: str,
    *,
    photo_names: list[str] | None = None,
    mesh_names: list[str] | None = None,
) -> None:
    log = store.logger(job_id)
    paths = store.paths(job_id)
    try:
        if store.is_cancelled(job_id):
            log.emit("Refine aborted (cancelled before start)", level="warn", kind="status")
            return
        meta = store.get(job_id)
        kcl_path = paths.outputs / "main.kcl"
        if not kcl_path.is_file():
            raise RuntimeError("No main.kcl to refine — run a successful job first")
        main_kcl = kcl_path.read_text(encoding="utf-8")

        photo_paths = [paths.inputs / n for n in (photo_names or []) if (paths.inputs / n).is_file()]
        mesh_paths = [paths.inputs / n for n in (mesh_names or []) if (paths.inputs / n).is_file()]
        agent_stl: Path | None = None
        if mesh_paths:
            store.set_status(job_id, JobStatus.PREPROCESSING)
            agent_stl = paths.inputs / "mesh_for_agent_refine.stl"
            ensure_stl_for_agent(mesh_paths, agent_stl, log=log)
            # Do NOT overwrite reference.stl here — a refine texture/reference mesh
            # is guidance for the Agent, not necessarily the part being rebuilt.
            # The user picks which mesh is the Compare reference (see /reference).

        log.emit(
            f"Starting refine ({len(message)} chars, "
            f"photos={len(photo_paths)}, meshes={len(mesh_paths)})",
            kind="refine",
        )
        store.set_status(job_id, JobStatus.AGENT_RUNNING)
        result = run_copilot_refine(
            token=token,
            message=message,
            main_kcl=main_kcl,
            mode=meta.get("mode") or "thoughtful",
            outputs_dir=paths.outputs,
            log=log,
            project_name=f"meshmoose-{job_id}",
            conversation_id=meta.get("conversation_id"),
            photo_paths=photo_paths or None,
            stl_path=agent_stl,
        )
        if store.is_cancelled(job_id):
            log.emit("Refine aborted after agent (cancelled)", level="warn", kind="status")
            return
        if result["errors"] and not result.get("main_kcl"):
            raise RuntimeError("; ".join(result["errors"]))

        new_kcl = result.get("main_kcl") or main_kcl
        kcl_path.write_text(new_kcl, encoding="utf-8")
        assist = paths.outputs / "assistant.md"
        prev = assist.read_text(encoding="utf-8") if assist.is_file() else ""
        assist.write_text(
            prev + "\n\n---\n\n## Refine\n\n" + (result.get("assistant_text") or ""),
            encoding="utf-8",
        )
        store.update_meta(job_id, conversation_id=result.get("conversation_id"))

        store.set_status(job_id, JobStatus.EXPORTING)
        export_kcl(
            token=token,
            main_kcl=new_kcl,
            out_stl=paths.outputs / "generated.stl",
            out_step=paths.outputs / "generated.step",
            out_3mf=paths.outputs / "generated.3mf",
            log=log,
        )
        if store.is_cancelled(job_id):
            log.emit("Refine aborted after export (cancelled)", level="warn", kind="status")
            return

        ref = store.reference_path(job_id)
        if ref.is_file():
            store.set_status(job_id, JobStatus.MEASURING)
            try:
                compare_meshes(
                    token=token,
                    reference_stl=ref,
                    generated_stl=paths.outputs / "generated.stl",
                    out_json=paths.outputs / "metrics.json",
                    log=log,
                )
            except Exception as exc:  # noqa: BLE001
                log.emit(f"Measure step failed (non-fatal): {exc}", level="warn")

        if store.is_cancelled(job_id):
            log.emit("Refine aborted before success (cancelled)", level="warn", kind="status")
            return
        store.set_status(job_id, JobStatus.SUCCEEDED)
        log.emit("Refine succeeded", kind="status", status="succeeded")
    except Exception as exc:  # noqa: BLE001
        if store.is_cancelled(job_id):
            log.emit(f"Refine stopped after cancel: {exc}", level="warn", kind="error")
            return
        nice = format_job_error(exc)
        log.emit(nice, level="error", kind="error")
        store.set_status(job_id, JobStatus.FAILED, error=nice)
