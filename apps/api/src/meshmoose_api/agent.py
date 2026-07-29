from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect as ws_connect

from meshmoose_api.logging_util import JobLogger
from meshmoose_api.photos import mime_for_photo

RECONSTRUCT_SUFFIX = """
Using the attached photograph(s) and the attached STL mesh as geometric reference,
recreate this part as clean, editable parametric KCL (not by leaving the STL as a
foreign import). Prefer sketch + extrude / revolve with clear dimensions. Put the
full model in main.kcl. If the mesh is approximate or partial, use the photos and
this description for design intent.
""".strip()

REFINE_ATTACH_SUFFIX = """
Additional photograph(s) and/or mesh may be attached for this refine turn.
Use them as updated visual/geometric reference while editing the current main.kcl.
Do not leave the STL as a frozen foreign import — keep the model parametric.
""".strip()

RESUME_MESSAGE = """
The previous Agent session was interrupted before completion.
Continue from the attached current main.kcl and finish a complete, clean parametric
reconstruction of the part. Prefer sketch + extrude / revolve with clear dimensions.
Put the full model in main.kcl.
""".strip()

# conversation_id and/or latest main.kcl text from the live Agent stream.
CheckpointFn = Callable[..., None]

# Zoo Agent turns can stall for minutes while modeling; the default websockets
# ping_timeout (20s) then closes with 1011 keepalive ping timeout. Keep sending
# pings (proxy keepalive) but do not treat a slow pong as a hard failure.
_COPILOT_PING_INTERVAL = 20.0
_COPILOT_PING_TIMEOUT = None
_COPILOT_CLOSE_TIMEOUT = 120.0


def copilot_ws_factory(uri: str, **kwargs: Any):
    """KittyCAD ml_copilot_ws factory with Agent-friendly keepalive settings."""
    kwargs.setdefault("ping_interval", _COPILOT_PING_INTERVAL)
    kwargs.setdefault("ping_timeout", _COPILOT_PING_TIMEOUT)
    kwargs.setdefault("close_timeout", _COPILOT_CLOSE_TIMEOUT)
    kwargs.setdefault("max_size", None)
    return ws_connect(uri, **kwargs)


def build_resume_message(prompts: list[dict[str, Any]] | None) -> str:
    """RESUME_MESSAGE plus the latest user refine/initial text when available."""
    last_user: str | None = None
    for entry in reversed(prompts or []):
        role = entry.get("role")
        if role == "resume":
            continue
        if role not in {"refine", "initial"}:
            continue
        text = (entry.get("text") or "").strip()
        if text:
            last_user = text
            break
    if not last_user:
        return RESUME_MESSAGE
    return (
        f"{RESUME_MESSAGE}\n\n"
        "The user's latest instruction before the interruption was:\n"
        f"{last_user}"
    )


def _note_ws_closed(
    log: JobLogger,
    errors: list[str],
    exc: BaseException,
    *,
    has_main_kcl: bool,
) -> None:
    msg = str(exc).strip() or "Agent websocket closed"
    errors.append(msg)
    log.emit(msg, level="warn" if has_main_kcl else "error", kind="agent")



def mime_for_path(path: Path) -> str:
    suffix = path.suffix.lower()
    photo = mime_for_photo(path)
    if photo != "application/octet-stream":
        return photo
    if suffix == ".stl":
        return "model/stl"
    if suffix == ".ply":
        return "model/ply"
    return "application/octet-stream"


def build_additional_files(
    photo_paths: list[Path] | None = None,
    stl_path: Path | None = None,
) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    for photo in photo_paths or []:
        if not photo.is_file():
            continue
        files.append(
            {
                "name": photo.name,
                "mimetype": mime_for_path(photo),
                "data": list(photo.read_bytes()),
            }
        )
    if stl_path is not None and stl_path.is_file():
        files.append(
            {
                "name": stl_path.name,
                "mimetype": "model/stl",
                "data": list(stl_path.read_bytes()),
            }
        )
    return files


def find_main_kcl(value: Any) -> str | None:
    if isinstance(value, dict):
        outputs = value.get("outputs")
        if isinstance(outputs, dict):
            for key, content in outputs.items():
                if str(key).endswith("main.kcl") and isinstance(content, str):
                    return content
            for content in outputs.values():
                if isinstance(content, str) and (
                    "sketch" in content or "extrude" in content or "|" in content
                ):
                    return content
        for child in value.values():
            found = find_main_kcl(child)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = find_main_kcl(item)
            if found:
                return found
    return None


def collect_outputs(value: Any, bucket: dict[str, str]) -> None:
    if isinstance(value, dict):
        outputs = value.get("outputs")
        if isinstance(outputs, dict):
            for key, content in outputs.items():
                if isinstance(content, str):
                    bucket[str(key)] = content
        for child in value.values():
            collect_outputs(child, bucket)
    elif isinstance(value, list):
        for item in value:
            collect_outputs(item, bucket)


def bytes_from_wire(data: Any) -> bytes:
    if isinstance(data, (bytes, bytearray)):
        return bytes(data)
    if isinstance(data, list):
        return bytes(int(x) & 0xFF for x in data)
    if isinstance(data, str):
        return data.encode("utf-8")
    return b""


def message_kind(raw: dict[str, Any]) -> str:
    for key in (
        "pong",
        "session_data",
        "conversation_id",
        "delta",
        "tool_output",
        "error",
        "info",
        "modes_response",
        "backend_shutdown",
        "project_updated",
        "reasoning",
        "request_attachments",
        "attachments_loaded",
        "end_of_stream",
        "files",
        "replay",
    ):
        if key in raw:
            return key
    return "unknown"


def emit_checkpoint(
    on_checkpoint: CheckpointFn | None,
    *,
    conversation_id: str | None = None,
    main_kcl: str | None = None,
) -> None:
    """Persist Agent progress mid-stream (conversation id and/or draft KCL)."""
    if on_checkpoint is None:
        return
    if conversation_id is None and not (main_kcl and main_kcl.strip()):
        return
    on_checkpoint(conversation_id=conversation_id, main_kcl=main_kcl)


def run_copilot_reconstruct(
    *,
    token: str,
    prompt: str,
    photo_paths: list[Path],
    stl_path: Path,
    mode: str,
    outputs_dir: Path,
    log: JobLogger,
    project_name: str,
    current_files: dict[str, bytes] | None = None,
    recv_timeout: float = 600.0,
    on_checkpoint: CheckpointFn | None = None,
) -> dict[str, Any]:
    """Call Zoo ML Copilot with JSON uint8 attachments (BSON breaks attachments)."""
    from kittycad import KittyCAD

    client = KittyCAD(token=token)
    client.websocket_recv_timeout = recv_timeout
    client.headers["Cache-Control"] = "no-cache"
    client.headers["User-Agent"] = "MeshMoose.ai/0.1"

    full_prompt = f"{prompt.strip()}\n\n{RECONSTRUCT_SUFFIX}"
    additional_files = build_additional_files(photo_paths, stl_path)

    cf: dict[str, list[int]] = {"main.kcl": []}
    if current_files:
        cf = {k: list(v) for k, v in current_files.items()}

    payload = {
        "type": "user",
        "content": full_prompt,
        "project_name": project_name,
        "mode": mode,
        "current_files": cf,
        "additional_files": additional_files,
    }

    transcript: list[dict[str, Any]] = []
    deltas: list[str] = []
    file_outputs: dict[str, str] = {}
    conversation_id: str | None = None
    errors: list[str] = []

    log.emit(
        f"Connecting to Zoo ML Copilot (mode={mode}, "
        f"photos={len(photo_paths)}, stl={stl_path.stat().st_size}B)",
        kind="agent",
    )

    with client.ml.ml_copilot_ws(ws_factory=copilot_ws_factory) as ws:
        ws.ws.send(json.dumps(payload))
        log.emit("Prompt + attachments sent to Agent", kind="agent")

        for i in range(500):
            try:
                message = ws.ws.recv(timeout=ws._recv_timeout)
            except ConnectionClosed as exc:
                _note_ws_closed(
                    log,
                    errors,
                    exc,
                    has_main_kcl=bool(file_outputs.get("main.kcl")),
                )
                break
            if isinstance(message, bytes):
                try:
                    raw = json.loads(message.decode("utf-8"))
                except Exception:
                    log.emit("Received binary non-JSON frame", level="warn", kind="agent")
                    continue
            else:
                raw = json.loads(message)

            kind = message_kind(raw)
            if kind == "conversation_id":
                body = raw["conversation_id"]
                conversation_id = (
                    body.get("conversation_id")
                    if isinstance(body, dict)
                    else str(body)
                )
                log.emit(f"conversation_id={conversation_id}", kind="agent")
                emit_checkpoint(on_checkpoint, conversation_id=conversation_id)
            elif kind == "delta":
                body = raw["delta"]
                text = body.get("delta", "") if isinstance(body, dict) else str(body)
                deltas.append(text)
                log.emit(text, kind="assistant_delta", level="debug")
            elif kind == "info":
                body = raw["info"]
                text = body.get("text", "") if isinstance(body, dict) else str(body)
                log.emit(text, kind="agent")
            elif kind == "tool_output":
                body = raw["tool_output"]
                result = body.get("result", body) if isinstance(body, dict) else body
                collect_outputs(result, file_outputs)
                main = find_main_kcl(result)
                if main:
                    file_outputs["main.kcl"] = main
                    emit_checkpoint(
                        on_checkpoint,
                        conversation_id=conversation_id,
                        main_kcl=main,
                    )
                t = result.get("type") if isinstance(result, dict) else "?"
                log.emit(f"tool_output type={t}", kind="agent")
            elif kind == "project_updated":
                collect_outputs(raw.get("project_updated"), file_outputs)
                main = find_main_kcl(raw.get("project_updated"))
                if main:
                    file_outputs["main.kcl"] = main
                    emit_checkpoint(
                        on_checkpoint,
                        conversation_id=conversation_id,
                        main_kcl=main,
                    )
                log.emit("project_updated", kind="agent")
            elif kind == "files":
                body = raw["files"]
                files = body.get("files") if isinstance(body, dict) else body
                if not isinstance(files, list):
                    files = []
                for f in files:
                    if not isinstance(f, dict):
                        continue
                    name = (f.get("name") or "file").replace("/", "_").replace(" ", "_")
                    data = bytes_from_wire(f.get("data"))
                    mime = f.get("mimetype") or ""
                    if name.endswith(".kcl") or mime.startswith("text/"):
                        text = data.decode("utf-8", errors="replace")
                        file_outputs[name] = text
                        log.emit(f"Received file {name} ({len(data)} B)", kind="agent")
                        if name.endswith("main.kcl") or name == "main.kcl":
                            emit_checkpoint(
                                on_checkpoint,
                                conversation_id=conversation_id,
                                main_kcl=text,
                            )
                    else:
                        rel = f"outputs/agent_{name}"
                        dest = outputs_dir / f"agent_{name}"
                        dest.write_bytes(data)
                        log.emit(
                            f"Received snapshot {name} ({len(data)} B)",
                            kind="artifact",
                            path=rel,
                            name=name,
                            mimetype=mime,
                        )
            elif kind == "request_attachments":
                body = raw.get("request_attachments") or {}
                log.emit("Server requested attachments — resending", level="warn", kind="agent")
                ws.ws.send(
                    json.dumps(
                        {
                            "type": "attachment_response",
                            "files": additional_files,
                            "request_id": body.get("request_id"),
                            "prompt_id": body.get("prompt_id"),
                            "seq": body.get("seq"),
                        }
                    )
                )
            elif kind == "error":
                body = raw["error"]
                detail = (
                    body.get("detail", str(body))
                    if isinstance(body, dict)
                    else str(body)
                )
                errors.append(detail)
                log.emit(detail, level="error", kind="agent")
            elif kind == "end_of_stream":
                log.emit("Agent stream complete", kind="agent")
                break
            elif kind == "reasoning":
                if i % 8 == 0:
                    log.emit("Agent reasoning…", kind="agent", level="debug")
            elif kind in {"session_data", "attachments_loaded", "pong"}:
                log.emit(kind, kind="agent", level="debug")
            else:
                transcript.append({"kind": kind, "keys": list(raw.keys())})
        else:
            msg = "Timed out waiting for end_of_stream"
            errors.append(msg)
            # Draft KCL may already be on the wire — continue when present.
            level = "warn" if file_outputs.get("main.kcl") else "error"
            log.emit(msg, level=level, kind="agent")

    assistant = "".join(deltas)
    main_kcl = file_outputs.get("main.kcl")
    if not main_kcl:
        for name, content in file_outputs.items():
            if name.endswith(".kcl"):
                main_kcl = content
                break

    return {
        "conversation_id": conversation_id,
        "assistant_text": assistant,
        "files": file_outputs,
        "main_kcl": main_kcl,
        "errors": errors,
    }


def run_copilot_refine(
    *,
    token: str,
    message: str,
    main_kcl: str,
    mode: str,
    outputs_dir: Path,
    log: JobLogger,
    project_name: str,
    conversation_id: str | None,
    photo_paths: list[Path] | None = None,
    stl_path: Path | None = None,
    recv_timeout: float = 600.0,
    on_checkpoint: CheckpointFn | None = None,
) -> dict[str, Any]:
    """Refine with current KCL; optionally re-attach photos and/or an STL mesh."""
    from kittycad import KittyCAD

    client = KittyCAD(token=token)
    client.websocket_recv_timeout = recv_timeout
    client.headers["Cache-Control"] = "no-cache"
    client.headers["User-Agent"] = "MeshMoose.ai/0.1"

    additional_files = build_additional_files(photo_paths, stl_path)
    content = message.strip()
    if additional_files:
        content = f"{content}\n\n{REFINE_ATTACH_SUFFIX}"

    payload: dict[str, Any] = {
        "type": "user",
        "content": content,
        "project_name": project_name,
        "mode": mode,
        "current_files": {"main.kcl": list(main_kcl.encode("utf-8"))},
    }
    if additional_files:
        payload["additional_files"] = additional_files

    deltas: list[str] = []
    file_outputs: dict[str, str] = {}
    errors: list[str] = []
    new_conversation_id = conversation_id

    log.emit(
        f"Refine (mode={mode}, attachments={len(additional_files)}"
        f"{', conversation=' + conversation_id if conversation_id else ', new conversation'})",
        kind="agent",
    )
    with client.ml.ml_copilot_ws(
        conversation_id=conversation_id,
        ws_factory=copilot_ws_factory,
    ) as ws:
        ws.ws.send(json.dumps(payload))
        for i in range(500):
            try:
                message_raw = ws.ws.recv(timeout=ws._recv_timeout)
            except ConnectionClosed as exc:
                _note_ws_closed(
                    log,
                    errors,
                    exc,
                    has_main_kcl=bool(file_outputs.get("main.kcl")),
                )
                break
            raw = (
                json.loads(message_raw.decode("utf-8"))
                if isinstance(message_raw, bytes)
                else json.loads(message_raw)
            )
            kind = message_kind(raw)
            if kind == "conversation_id":
                body = raw["conversation_id"]
                new_conversation_id = (
                    body.get("conversation_id")
                    if isinstance(body, dict)
                    else str(body)
                )
                log.emit(f"conversation_id={new_conversation_id}", kind="agent")
                emit_checkpoint(on_checkpoint, conversation_id=new_conversation_id)
            elif kind == "delta":
                body = raw["delta"]
                text = body.get("delta", "") if isinstance(body, dict) else str(body)
                deltas.append(text)
                if text:
                    log.emit(text, kind="assistant_delta", level="debug")
            elif kind == "info":
                body = raw["info"]
                text = body.get("text", "") if isinstance(body, dict) else str(body)
                if text:
                    log.emit(text, kind="agent")
            elif kind == "tool_output":
                body = raw["tool_output"]
                result = body.get("result", body) if isinstance(body, dict) else body
                collect_outputs(result, file_outputs)
                main = find_main_kcl(result)
                if main:
                    file_outputs["main.kcl"] = main
                    emit_checkpoint(
                        on_checkpoint,
                        conversation_id=new_conversation_id,
                        main_kcl=main,
                    )
                log.emit(
                    f"tool_output type={result.get('type') if isinstance(result, dict) else '?'}",
                    kind="agent",
                )
            elif kind == "project_updated":
                collect_outputs(raw.get("project_updated"), file_outputs)
                main = find_main_kcl(raw.get("project_updated"))
                if main:
                    file_outputs["main.kcl"] = main
                    emit_checkpoint(
                        on_checkpoint,
                        conversation_id=new_conversation_id,
                        main_kcl=main,
                    )
                log.emit("project_updated", kind="agent")
            elif kind == "request_attachments":
                body = raw.get("request_attachments") or {}
                if additional_files:
                    log.emit(
                        "Server requested attachments — resending refine files",
                        level="warn",
                        kind="agent",
                    )
                    ws.ws.send(
                        json.dumps(
                            {
                                "type": "attachment_response",
                                "files": additional_files,
                                "request_id": body.get("request_id"),
                                "prompt_id": body.get("prompt_id"),
                                "seq": body.get("seq"),
                            }
                        )
                    )
                else:
                    log.emit(
                        "Server requested attachments but none were provided for refine",
                        level="warn",
                        kind="agent",
                    )
            elif kind == "error":
                body = raw["error"]
                detail = (
                    body.get("detail", str(body))
                    if isinstance(body, dict)
                    else str(body)
                )
                errors.append(detail)
                log.emit(detail, level="error", kind="agent")
            elif kind == "end_of_stream":
                log.emit("Refine stream complete", kind="agent")
                break
            elif kind == "files":
                body = raw["files"]
                files = body.get("files") if isinstance(body, dict) else body
                if isinstance(files, list):
                    for f in files:
                        if not isinstance(f, dict):
                            continue
                        name = (f.get("name") or "file").replace("/", "_").replace(" ", "_")
                        data = bytes_from_wire(f.get("data"))
                        if name.endswith(".kcl"):
                            text = data.decode("utf-8", errors="replace")
                            file_outputs[name] = text
                            if name.endswith("main.kcl") or name == "main.kcl":
                                emit_checkpoint(
                                    on_checkpoint,
                                    conversation_id=new_conversation_id,
                                    main_kcl=text,
                                )
                        else:
                            rel = f"outputs/agent_{name}"
                            (outputs_dir / f"agent_{name}").write_bytes(data)
                            log.emit(
                                f"Received snapshot {name}",
                                kind="artifact",
                                path=rel,
                                name=name,
                            )
            elif kind == "reasoning":
                if i % 8 == 0:
                    log.emit("Agent reasoning…", kind="agent", level="debug")
            elif kind in {"session_data", "attachments_loaded", "pong", "replay"}:
                log.emit(kind, kind="agent", level="debug")
        else:
            msg = "Timed out waiting for end_of_stream"
            errors.append(msg)
            level = "warn" if file_outputs.get("main.kcl") else "error"
            log.emit(msg, level=level, kind="agent")

    main = file_outputs.get("main.kcl")
    if not main:
        for name, content in file_outputs.items():
            if name.endswith(".kcl"):
                main = content
                break
    return {
        "conversation_id": new_conversation_id,
        "assistant_text": "".join(deltas),
        "files": file_outputs,
        "main_kcl": main,
        "errors": errors,
    }
