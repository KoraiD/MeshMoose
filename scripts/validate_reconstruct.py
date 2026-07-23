#!/usr/bin/env python3
"""Validate multimodal reconstruction: image + STL + text → Zoo Agent → KCL.

Reads demos/beverage-holder-stand inputs, calls the ML Copilot WebSocket with
attachments, writes KCL and logs under that demo's results/ directory.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SAMPLE_DIR = ROOT / "demos" / "beverage-holder-stand"
DEFAULT_RESULTS_DIR = DEFAULT_SAMPLE_DIR / "results"

PROMPT_FALLBACK = (
    "This is a stand for a Lidl/Ernesto beverage dispenser glass. It has five "
    "parts: four legs and a top ring. Legs and top join with wood dowels."
)

RECONSTRUCT_INSTRUCTIONS = """
Using the attached photograph and the attached STL mesh as geometric reference,
recreate this part as clean, editable parametric KCL (not by leaving the STL
as a foreign import). Prefer sketch + extrude features with clear dimensions.
Match overall size and features (top ring, tap recess, legs, dowel holes).
Put the full model in main.kcl. If anything is ambiguous from the
partial/approximate mesh, use the photo and this description for intent.
""".strip()


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, raw = line.split("=", 1)
        values[key.strip()] = raw.strip().strip('"').strip("'")
    return values


def resolve_token() -> str:
    import os

    env = load_env_file(ROOT / ".env.local")
    env.update(load_env_file(ROOT / ".env"))
    for key in (
        "ZOO_SECRET_KEY",
        "ZOO_API_TOKEN",
        "KITTYCAD_API_TOKEN",
        "ZOO_API_KEY",
    ):
        value = os.environ.get(key) or env.get(key)
        if value:
            return value
    raise SystemExit(
        "No Zoo API token found. Set ZOO_SECRET_KEY in .env.local "
        "(or ZOO_API_TOKEN / KITTYCAD_API_TOKEN)."
    )


def extract_rtf_text(path: Path) -> str:
    raw = path.read_text(encoding="utf-8", errors="replace")
    text = re.sub(r"\\'[0-9a-fA-F]{2}", "", raw)
    text = re.sub(r"\\[a-zA-Z]+-?\d* ?", "", text)
    text = text.replace("{", "").replace("}", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text or PROMPT_FALLBACK


def prepare_image(src: Path, dest: Path, max_edge: int = 1280) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as img:
        img = img.convert("RGB")
        img.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        img.save(dest, format="JPEG", quality=85, optimize=True)
    return dest


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


def recv_raw_message(ws: Any) -> dict[str, Any]:
    """Receive one WS frame as a plain dict.

    The generated SDK cannot parse Files messages whose `data` fields are
    JSON uint8 arrays, so we bypass model_validate_json.
    """
    message = ws.ws.recv(timeout=ws._recv_timeout)
    if isinstance(message, bytes):
        try:
            return json.loads(message.decode("utf-8"))
        except Exception:
            return {"_binary": True, "_len": len(message)}
    return json.loads(message)


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


def run_agent(
    *,
    prompt: str,
    image_path: Path,
    stl_path: Path,
    results_dir: Path,
    project_name: str,
    mode: str,
    recv_timeout: float,
) -> dict[str, Any]:
    from kittycad import KittyCAD
    from kittycad.models.ml_copilot_mode import MlCopilotMode

    token = resolve_token()
    client = KittyCAD(token=token)
    client.websocket_recv_timeout = recv_timeout
    client.headers["Cache-Control"] = "no-cache"
    client.headers["User-Agent"] = "zoo-makeathon-validate-reconstruct/0.1"

    image_bytes = image_path.read_bytes()
    stl_bytes = stl_path.read_bytes()

    try:
        mode_enum = MlCopilotMode(mode)
    except ValueError:
        mode_enum = MlCopilotMode.THOUGHTFUL

    transcript: list[dict[str, Any]] = []
    deltas: list[str] = []
    file_outputs: dict[str, str] = {}
    conversation_id: str | None = None
    errors: list[str] = []
    saved_binary: list[dict[str, Any]] = []

    print(f"Connecting to ML Copilot (mode={mode_enum})…", flush=True)
    with client.ml.ml_copilot_ws() as ws:
        # JSON uint8 lists work; BSON send_binary currently interrupts Zookeeper
        # when attachments are present (validated Jul 2026).
        payload = {
            "type": "user",
            "content": prompt,
            "project_name": project_name,
            "mode": str(mode_enum),
            "current_files": {"main.kcl": []},
            "additional_files": [
                {
                    "name": image_path.name,
                    "mimetype": "image/jpeg",
                    "data": list(image_bytes),
                },
                {
                    "name": stl_path.name,
                    "mimetype": "model/stl",
                    "data": list(stl_bytes),
                },
            ],
        }
        ws.ws.send(json.dumps(payload))
        print(
            f"Prompt + attachments sent "
            f"(jpeg={len(image_bytes)}B stl={len(stl_bytes)}B). Waiting…",
            flush=True,
        )

        for i in range(500):
            raw = recv_raw_message(ws)
            kind = message_kind(raw)
            entry: dict[str, Any] = {"i": i, "kind": kind}

            if kind == "conversation_id":
                body = raw["conversation_id"]
                if isinstance(body, dict):
                    conversation_id = body.get("conversation_id") or conversation_id
                else:
                    conversation_id = str(body)
                entry["conversation_id"] = conversation_id
                print(f"conversation_id={conversation_id}", flush=True)
            elif kind == "delta":
                body = raw["delta"]
                text = body.get("delta", "") if isinstance(body, dict) else str(body)
                deltas.append(text)
                entry["delta"] = text
                print(text, end="", flush=True)
            elif kind == "info":
                body = raw["info"]
                text = body.get("text", "") if isinstance(body, dict) else str(body)
                entry["text"] = text
                print(f"\n[info] {text}", flush=True)
            elif kind == "tool_output":
                body = raw["tool_output"]
                result = body.get("result", body) if isinstance(body, dict) else body
                entry["tool_type"] = (
                    result.get("type") if isinstance(result, dict) else None
                )
                collect_outputs(result, file_outputs)
                main = find_main_kcl(result)
                if main:
                    file_outputs["main.kcl"] = main
                print(
                    f"\n[tool_output] type={entry['tool_type']}",
                    flush=True,
                )
            elif kind == "project_updated":
                body = raw["project_updated"]
                collect_outputs(body, file_outputs)
                print("\n[project_updated]", flush=True)
            elif kind == "files":
                body = raw["files"]
                files = body
                if isinstance(body, dict) and "files" in body:
                    files = body["files"]
                if not isinstance(files, list):
                    files = []
                entry["files_count"] = len(files)
                for f in files:
                    if not isinstance(f, dict):
                        continue
                    name = f.get("name") or "file"
                    data = bytes_from_wire(f.get("data"))
                    mime = f.get("mimetype") or ""
                    if name.endswith(".kcl") or mime.startswith("text/"):
                        file_outputs[name] = data.decode("utf-8", errors="replace")
                    else:
                        safe = name.replace("/", "_").replace(" ", "_")
                        out = results_dir / f"agent_{safe}"
                        out.write_bytes(data)
                        saved_binary.append(
                            {
                                "name": name,
                                "path": str(out.name),
                                "mimetype": mime,
                                "nbytes": len(data),
                            }
                        )
                    print(f"\n[files] {name} ({len(data)} bytes)", flush=True)
            elif kind == "request_attachments":
                body = raw.get("request_attachments") or {}
                print(
                    "\n[server requested attachments — resending JSON]",
                    flush=True,
                )
                ws.ws.send(
                    json.dumps(
                        {
                            "type": "attachment_response",
                            "files": payload["additional_files"],
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
                entry["error"] = detail
                print(f"\n[error] {detail}", flush=True)
            elif kind == "end_of_stream":
                body = raw.get("end_of_stream") or {}
                entry["end_of_stream"] = True
                if isinstance(body, dict) and body.get("whole_response"):
                    entry["whole_response"] = body["whole_response"]
                transcript.append(entry)
                print("\n[end_of_stream]", flush=True)
                break
            elif kind == "reasoning":
                print(".", end="", flush=True)
            elif kind in {"session_data", "attachments_loaded", "pong"}:
                print(f"\n[{kind}]", flush=True)
            else:
                entry["raw_keys"] = list(raw.keys())
                print(f"\n[{kind}] keys={list(raw.keys())}", flush=True)

            if kind not in {"delta", "reasoning"}:
                transcript.append(entry)
            elif kind == "delta":
                # Keep deltas only in assistant_text to avoid huge transcripts.
                pass

        else:
            errors.append("Timed out waiting for end_of_stream (message cap).")

    return {
        "conversation_id": conversation_id,
        "assistant_text": "".join(deltas),
        "files": file_outputs,
        "errors": errors,
        "transcript": transcript,
        "saved_binary": saved_binary,
    }


def maybe_export_stl(main_kcl: str, out_stl: Path) -> str | None:
    """Best-effort Engine export of generated KCL to STL."""
    import os

    try:
        import asyncio

        import kcl
    except ImportError:
        return "zoo-kcl not installed; skip export"

    token = resolve_token()
    os.environ.setdefault("ZOO_API_TOKEN", token)
    os.environ.setdefault("KITTYCAD_API_TOKEN", token)

    async def _export() -> None:
        files = await kcl.execute_code_and_export(
            main_kcl,
            kcl.FileExportFormat.Stl,
        )
        out_stl.write_bytes(files[0].contents)

    try:
        print("Exporting generated KCL → STL via Engine…", flush=True)
        asyncio.run(_export())
        return None
    except Exception as exc:  # noqa: BLE001 — validation harness
        return f"export failed: {exc}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample-dir", type=Path, default=DEFAULT_SAMPLE_DIR)
    parser.add_argument("--results-dir", type=Path, default=DEFAULT_RESULTS_DIR)
    parser.add_argument(
        "--mode",
        default="thoughtful",
        choices=["fast", "thoughtful", "auto", "zookeeper_pro"],
    )
    parser.add_argument("--recv-timeout", type=float, default=300.0)
    parser.add_argument("--skip-export", action="store_true")
    args = parser.parse_args()

    sample_dir: Path = args.sample_dir
    results_dir: Path = args.results_dir
    results_dir.mkdir(parents=True, exist_ok=True)

    jpeg = sample_dir / "img_4782.jpg"
    stl = sample_dir / "lidl-jar-stand.stl"
    prompt_file = sample_dir / "prompt.txt"
    for required in (jpeg, stl):
        if not required.is_file():
            raise SystemExit(f"Missing sample file: {required}")

    if prompt_file.is_file():
        prompt_body = prompt_file.read_text(encoding="utf-8").strip()
    else:
        rtf = sample_dir / "prompt.rtf"
        prompt_body = extract_rtf_text(rtf) if rtf.is_file() else PROMPT_FALLBACK
    prompt = f"{prompt_body}\n\n{RECONSTRUCT_INSTRUCTIONS}"

    prepared_jpeg = prepare_image(jpeg, results_dir / "input_photo.jpg")
    ref_stl = results_dir / "reference.stl"
    ref_stl.write_bytes(stl.read_bytes())
    (results_dir / "prompt.txt").write_text(prompt, encoding="utf-8")

    run = run_agent(
        prompt=prompt,
        image_path=prepared_jpeg,
        stl_path=stl,
        results_dir=results_dir,
        project_name="beverage-holder-stand-validate",
        mode=args.mode,
        recv_timeout=args.recv_timeout,
    )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    meta_path = results_dir / f"run_{stamp}.json"
    meta_path.write_text(
        json.dumps(
            {
                "created_at": stamp,
                "mode": args.mode,
                "conversation_id": run["conversation_id"],
                "errors": run["errors"],
                "assistant_text": run["assistant_text"],
                "files": list(run["files"].keys()),
                "saved_binary": run["saved_binary"],
                "transcript": run["transcript"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    main_kcl = run["files"].get("main.kcl")
    if not main_kcl:
        for name, content in run["files"].items():
            if name.endswith(".kcl"):
                main_kcl = content
                break

    if main_kcl:
        (results_dir / "main.kcl").write_text(main_kcl, encoding="utf-8")
        print(f"Wrote {results_dir / 'main.kcl'}", flush=True)
        for name, content in run["files"].items():
            if name == "main.kcl":
                continue
            safe = name.replace("/", "_")
            (results_dir / safe).write_text(content, encoding="utf-8")
    else:
        print("WARNING: No KCL outputs found in tool_output.", flush=True)

    (results_dir / "assistant.md").write_text(
        run["assistant_text"] or "(no assistant text)",
        encoding="utf-8",
    )

    export_note = None
    if main_kcl and not args.skip_export:
        export_note = maybe_export_stl(main_kcl, results_dir / "generated.stl")
        if export_note:
            print(export_note, flush=True)
        else:
            print(f"Wrote {results_dir / 'generated.stl'}", flush=True)

    summary = {
        "ok": bool(main_kcl) and not run["errors"],
        "conversation_id": run["conversation_id"],
        "errors": run["errors"],
        "has_main_kcl": bool(main_kcl),
        "export_note": export_note,
        "meta": str(meta_path),
    }
    (results_dir / "summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, indent=2), flush=True)
    if not main_kcl or run["errors"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
