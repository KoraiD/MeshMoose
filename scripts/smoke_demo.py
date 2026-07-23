#!/usr/bin/env python3
"""End-to-end smoke: create job from demo → wait → optional refine → check artifacts.

Requires a running MeshMoose API and ZOO_API_TOKEN (or ZOO_SECRET_KEY) in the env.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_dotenv_local() -> None:
    path = ROOT / ".env.local"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip().strip("'").strip('"')
        os.environ.setdefault(key, val)


def token() -> str:
    load_dotenv_local()
    return (
        os.environ.get("ZOO_API_TOKEN")
        or os.environ.get("ZOO_SECRET_KEY")
        or ""
    ).strip()


def api(
    base: str,
    method: str,
    path: str,
    tok: str,
    *,
    data: bytes | None = None,
    content_type: str | None = None,
) -> tuple[int, object]:
    req = urllib.request.Request(
        f"{base.rstrip('/')}{path}",
        data=data,
        method=method,
        headers={"Authorization": f"Bearer {tok}"},
    )
    if content_type:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            body = res.read()
            if not body:
                return res.status, None
            return res.status, json.loads(body.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {exc.code} {method} {path}: {detail}") from exc


def wait_job(base: str, tok: str, job_id: str, timeout: float) -> dict:
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        _, meta = api(base, "GET", f"/jobs/{job_id}", tok)
        assert isinstance(meta, dict)
        status = meta.get("status")
        if status != last:
            print(f"  status → {status}", flush=True)
            last = str(status)
        if status in {"succeeded", "failed"}:
            return meta
        time.sleep(3)
    raise SystemExit(f"Timed out after {timeout}s waiting for job {job_id}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8787")
    parser.add_argument("--demo", default="beverage-holder-stand")
    parser.add_argument("--mode", default="fast", help="Agent mode for the smoke job")
    parser.add_argument("--timeout", type=float, default=900.0)
    parser.add_argument("--skip-refine", action="store_true")
    parser.add_argument(
        "--refine-message",
        default="Slightly thicken the body by 0.5 mm. Keep all other dimensions.",
    )
    args = parser.parse_args()

    tok = token()
    if not tok:
        print("Set ZOO_API_TOKEN (or ZOO_SECRET_KEY) in the environment or .env.local", file=sys.stderr)
        return 2

    print(f"Health check {args.base}/health …", flush=True)
    code, health = api(args.base, "GET", "/health", tok)
    if code != 200 or not isinstance(health, dict) or not health.get("ok"):
        print(f"API unhealthy: {health}", file=sys.stderr)
        return 1
    print(f"  ok · {health.get('service')} {health.get('version')}", flush=True)

    print(f"Creating job from demo `{args.demo}` (mode={args.mode}) …", flush=True)
    boundary = "----MeshMooseSmoke"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="mode"\r\n\r\n{args.mode}\r\n'
        f"--{boundary}--\r\n"
    ).encode()
    _, created = api(
        args.base,
        "POST",
        f"/jobs/from-demo/{args.demo}",
        tok,
        data=body,
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    assert isinstance(created, dict)
    job_id = created["id"]
    print(f"  job_id={job_id}", flush=True)

    meta = wait_job(args.base, tok, job_id, args.timeout)
    if meta.get("status") != "succeeded":
        print(f"Job failed: {meta.get('error')}", file=sys.stderr)
        return 1

    _, arts = api(args.base, "GET", f"/jobs/{job_id}/artifacts", tok)
    assert isinstance(arts, list)
    names = {a["name"] for a in arts}
    required = {"main.kcl", "generated.stl", "generated.step", "reference.stl"}
    missing = required - names
    if missing:
        print(f"Missing artifacts: {sorted(missing)}", file=sys.stderr)
        return 1
    print(f"  artifacts ok ({len(arts)} files)", flush=True)

    prompts = meta.get("prompts") or []
    if not prompts:
        print("Warning: prompts[] empty after success", file=sys.stderr)
    else:
        print(f"  prompts={len(prompts)} (initial recorded)", flush=True)

    if args.skip_refine:
        print("SMOKE OK (reconstruct only)")
        return 0

    print(f"Refining: {args.refine_message!r}", flush=True)
    boundary = "----MeshMooseRefine"
    refine_body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="message"\r\n\r\n{args.refine_message}\r\n'
        f"--{boundary}--\r\n"
    ).encode()
    _, refined = api(
        args.base,
        "POST",
        f"/jobs/{job_id}/refine",
        tok,
        data=refine_body,
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    assert isinstance(refined, dict)
    meta = wait_job(args.base, tok, job_id, args.timeout)
    if meta.get("status") != "succeeded":
        print(f"Refine failed: {meta.get('error')}", file=sys.stderr)
        return 1

    prompts = meta.get("prompts") or []
    roles = [p.get("role") for p in prompts]
    if "refine" not in roles:
        print(f"Refine prompt missing from history: {roles}", file=sys.stderr)
        return 1
    print(f"  prompt history ok ({len(prompts)} entries)", flush=True)
    print("SMOKE OK (reconstruct + refine)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
