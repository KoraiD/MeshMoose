"""MeshMoose CLI — drive the local API without the browser UI.

Examples:
  meshmoose health
  meshmoose jobs list --json
  meshmoose jobs create --prompt "…" --photo a.jpg --mesh a.stl --wait
  meshmoose demos run beverage-holder-stand --mode fast --wait
  meshmoose mesh corrupt part.stl -o partial.stl --missing 0.3 --noise 0.4
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from meshmoose_api.client import MeshMooseClient, MeshMooseError
from meshmoose_api.scan_corrupt import ScanCorruptParams, corrupt_scan_file

ROOT = Path(__file__).resolve().parents[4]


def _load_dotenv_local() -> None:
    path = ROOT / ".env.local"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip("'").strip('"'))


def _resolve_token(cli_token: str | None) -> str:
    _load_dotenv_local()
    return (
        (cli_token or "").strip()
        or os.environ.get("ZOO_API_TOKEN", "").strip()
        or os.environ.get("ZOO_SECRET_KEY", "").strip()
        or os.environ.get("MESHMOOSE_TOKEN", "").strip()
    )


def _print(data: Any, *, as_json: bool) -> None:
    if as_json or isinstance(data, (dict, list)):
        print(json.dumps(data, indent=2, default=str))
    else:
        print(data)


def _client_from_args(args: argparse.Namespace) -> MeshMooseClient:
    return MeshMooseClient(
        base_url=args.base,
        token=_resolve_token(getattr(args, "token", None)),
        timeout=float(getattr(args, "http_timeout", 60.0)),
    )


def cmd_health(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        _print(client.health(), as_json=args.json)
    return 0


_BASH_COMPLETION = r"""# meshmoose bash completion — source this file or `eval "$(meshmoose completion bash)"`
_meshmoose() {
    local cur prev cmds
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"
    cmds="health usage demos jobs mesh completion"
    case "${COMP_WORDS[1]}" in
        demos) COMPREPLY=( $(compgen -W "list run" -- "$cur") ) ;;
        jobs)  COMPREPLY=( $(compgen -W "list get create wait cancel retry resume delete rename logs refine finish save-kcl kcl-versions kcl-restore artifacts download" -- "$cur") ) ;;
        mesh)  COMPREPLY=( $(compgen -W "corrupt" -- "$cur") ) ;;
        completion) COMPREPLY=( $(compgen -W "bash zsh" -- "$cur") ) ;;
        *)     COMPREPLY=( $(compgen -W "$cmds" -- "$cur") ) ;;
    esac
    return 0
}
complete -F _meshmoose meshmoose
"""

_ZSH_COMPLETION = r"""#compdef meshmoose
# meshmoose zsh completion — place in fpath or `eval "$(meshmoose completion zsh)"`
_meshmoose() {
    local -a cmds
    cmds=(health usage demos jobs mesh completion)
    if (( CURRENT == 2 )); then
        _describe 'command' cmds
        return
    fi
    case "${words[2]}" in
        demos) compadd list run ;;
        jobs)  compadd list get create wait cancel retry resume delete rename logs refine finish save-kcl kcl-versions kcl-restore artifacts download ;;
        mesh)  compadd corrupt ;;
        completion) compadd bash zsh ;;
    esac
}
_meshmoose "$@"
"""


def cmd_completion(args: argparse.Namespace) -> int:
    script = _ZSH_COMPLETION if args.shell == "zsh" else _BASH_COMPLETION
    print(script)
    return 0


def cmd_usage(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        if not args.watch:
            _print(client.usage(), as_json=True)
            return 0
        import time

        try:
            while True:
                payload = client.usage()
                bal = payload.get("balance") or {}
                totals = payload.get("recent_totals") or {}
                remaining = bal.get("monthly_api_credits_remaining")
                plan = bal.get("plan_name") or "?"
                print(
                    f"[{time.strftime('%H:%M:%S')}] plan={plan} "
                    f"credits_remaining={remaining} "
                    f"recent: {totals.get('count', 0)} calls / "
                    f"{totals.get('seconds', 0)}s / ${totals.get('price', 0)}",
                    flush=True,
                )
                time.sleep(float(args.interval))
        except KeyboardInterrupt:
            return 130


def cmd_demos_list(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        demos = client.list_demos()
        if args.json:
            _print(demos, as_json=True)
        else:
            for d in demos:
                print(f"{d.get('id')}\t{d.get('title') or ''}")
    return 0


def cmd_demos_run(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        job = client.create_job_from_demo(
            args.demo_id,
            mode=args.mode,
            prompt=args.prompt,
        )
        job_id = job["id"]
        print(f"job_id: {job_id}", flush=True)
        if args.wait:
            job = client.wait_job(
                job_id,
                timeout=args.timeout,
                on_status=lambda status, _meta: print(f"status: {status}", flush=True),
            )
        _print(job, as_json=args.json or True)
        return 0 if job.get("status") != "failed" else 1


def cmd_jobs_list(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        jobs = client.list_jobs()
        if args.json:
            _print(jobs, as_json=True)
        else:
            for j in jobs:
                print(f"{j.get('id')}\t{j.get('status')}\t{j.get('title') or ''}")
    return 0


def cmd_jobs_get(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        job = client.get_job(args.job_id)
        if args.json:
            _print(job, as_json=True)
        else:
            tags = ",".join(job.get("tags") or [])
            print(f"id:      {job.get('id')}")
            print(f"title:   {job.get('title') or ''}")
            print(f"status:  {job.get('status')}")
            print(f"mode:    {job.get('mode')}")
            print(f"tags:    {tags}")
            print(f"created: {job.get('created_at')}")
            if job.get("error"):
                print(f"error:   {job.get('error')}")
            print(f"prompt:  {job.get('prompt') or ''}")
    return 0


def cmd_jobs_create(args: argparse.Namespace) -> int:
    photos = list(args.photo or [])
    meshes = list(args.mesh or [])
    if not photos or not meshes:
        print(
            "Error: at least one --photo and one --mesh are required.\n"
            "  meshmoose jobs create --prompt \"Make a stand\" "
            "--photo stand.jpg --mesh stand.stl",
            file=sys.stderr,
        )
        return 2
    tags = [t.strip() for t in (args.tag or []) if t and t.strip()] or None
    with _client_from_args(args) as client:
        job = client.create_job(
            prompt=args.prompt,
            photos=photos,
            meshes=meshes,
            mode=args.mode,
            title=(args.title.strip() if args.title else None) or None,
            tags=tags,
        )
        job_id = job["id"]
        print(f"job_id: {job_id}", flush=True)
        if args.wait:
            job = client.wait_job(
                job_id,
                timeout=args.timeout,
                on_status=lambda status, _meta: print(f"status: {status}", flush=True),
            )
        _print(job, as_json=True)
        return 0 if job.get("status") != "failed" else 1


def cmd_jobs_wait(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        job = client.wait_job(
            args.job_id,
            timeout=args.timeout,
            on_status=lambda status, _meta: print(f"status: {status}", flush=True),
        )
        _print(job, as_json=True)
        return 0 if job.get("status") != "failed" else 1


def cmd_jobs_cancel(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        _print(client.cancel_job(args.job_id), as_json=True)
    return 0


def cmd_jobs_retry(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        job = client.retry_job(args.job_id)
        print(f"job_id: {job['id']}", flush=True)
        if args.wait:
            job = client.wait_job(
                job["id"],
                timeout=args.timeout,
                on_status=lambda status, _meta: print(f"status: {status}", flush=True),
            )
        _print(job, as_json=True)
        return 0 if job.get("status") != "failed" else 1


def cmd_jobs_resume(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        job = client.resume_job(args.job_id)
        print(f"job_id: {job['id']} (resume)", flush=True)
        if args.wait:
            job = client.wait_job(
                job["id"],
                timeout=args.timeout,
                on_status=lambda status, _meta: print(f"status: {status}", flush=True),
            )
        _print(job, as_json=True)
        return 0 if job.get("status") != "failed" else 1


def cmd_jobs_delete(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        _print(client.delete_job(args.job_id), as_json=True)
    return 0


def cmd_jobs_rename(args: argparse.Namespace) -> int:
    if not args.title and args.tag is None:
        print("Error: provide --title and/or --tag", file=sys.stderr)
        return 2
    tags = [t.strip() for t in (args.tag or []) if t and t.strip()] if args.tag is not None else None
    with _client_from_args(args) as client:
        job = client.patch_job(
            args.job_id,
            title=(args.title.strip() if args.title else None),
            tags=tags,
        )
        if args.json:
            _print(job, as_json=True)
        else:
            print(f"{job.get('id')}\t{job.get('title') or ''}\t{','.join(job.get('tags') or [])}")
    return 0


def cmd_jobs_logs(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        try:
            data = client.download_file(args.job_id, "outputs/job.log")
        except MeshMooseError:
            print("Error: no job.log yet (job may not have started)", file=sys.stderr)
            return 1
    lines = data.decode("utf-8", errors="replace").splitlines()
    tail = lines[-args.lines :] if args.lines > 0 else lines
    for line in tail:
        print(line)
    return 0


def cmd_jobs_refine(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        job = client.refine_job(
            args.job_id,
            message=args.message,
            photos=list(args.photo or []),
            meshes=list(args.mesh or []),
        )
        print(f"job_id: {job['id']}", flush=True)
        if args.wait:
            job = client.wait_job(
                job["id"],
                timeout=args.timeout,
                on_status=lambda status, _meta: print(f"status: {status}", flush=True),
            )
        _print(job, as_json=True)
        return 0 if job.get("status") != "failed" else 1


def cmd_jobs_finish(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        if args.list_presets:
            presets = client.list_finishes()
            if args.json:
                _print(presets, as_json=True)
            else:
                for p in presets:
                    print(f"{p['id']}\t{p['name']}\t{p.get('description') or ''}")
            return 0
        if not args.job_id or not args.preset:
            print(
                "Error: job_id and --preset are required "
                "(or use --list-presets).",
                file=sys.stderr,
            )
            return 2
        job = client.apply_finish(args.job_id, preset=args.preset)
        print(f"job_id: {job['id']}", flush=True)
        if args.wait:
            job = client.wait_job(
                job["id"],
                timeout=args.timeout,
                on_status=lambda status, _meta: print(f"status: {status}", flush=True),
            )
        _print(job, as_json=True)
        return 0 if job.get("status") != "failed" else 1


def cmd_jobs_save_kcl(args: argparse.Namespace) -> int:
    path = Path(args.file)
    if not path.is_file():
        print(f"Error: file not found: {path}", file=sys.stderr)
        return 2
    source = path.read_text(encoding="utf-8")
    with _client_from_args(args) as client:
        result = client.save_kcl(
            args.job_id,
            source,
            note=args.note,
            reexport=bool(args.reexport),
        )
        job = result.get("job") if isinstance(result, dict) else None
        print(f"job_id: {args.job_id}", flush=True)
        if args.reexport and args.wait and isinstance(job, dict):
            job = client.wait_job(
                args.job_id,
                timeout=args.timeout,
                on_status=lambda status, _meta: print(f"status: {status}", flush=True),
            )
            result = {**result, "job": job}
        _print(result, as_json=True)
        if isinstance(job, dict) and job.get("status") == "failed":
            return 1
        return 0


def cmd_jobs_kcl_versions(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        versions = client.list_kcl_versions(args.job_id)
        if args.json:
            _print(versions, as_json=True)
        else:
            if not versions:
                print("(no KCL versions)")
            for v in versions:
                note = v.get("note") or ""
                print(
                    f"{v.get('id')}\t{v.get('created_at')}\t"
                    f"{v.get('chars')} chars\t{note}".rstrip()
                )
        return 0


def cmd_jobs_kcl_restore(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        result = client.restore_kcl(
            args.job_id,
            args.version_id,
            note=args.note,
            reexport=bool(args.reexport),
        )
        job = result.get("job") if isinstance(result, dict) else None
        print(f"job_id: {args.job_id}", flush=True)
        if args.reexport and args.wait and isinstance(job, dict):
            job = client.wait_job(
                args.job_id,
                timeout=args.timeout,
                on_status=lambda status, _meta: print(f"status: {status}", flush=True),
            )
            result = {**result, "job": job}
        _print(result, as_json=True)
        if isinstance(job, dict) and job.get("status") == "failed":
            return 1
        return 0


def cmd_jobs_artifacts(args: argparse.Namespace) -> int:
    with _client_from_args(args) as client:
        arts = client.list_artifacts(args.job_id)
        if args.json:
            _print(arts, as_json=True)
        else:
            for a in arts:
                print(f"{a.get('kind')}\t{a.get('path')}\t{a.get('name') or ''}")
    return 0


def cmd_mesh_corrupt(args: argparse.Namespace) -> int:
    """Offline helper — no API required."""
    src = Path(args.input)
    out = Path(args.out) if args.out else src.with_name(f"{src.stem}_partial.stl")
    params = ScanCorruptParams(
        missing_pct=float(args.missing),
        noise=float(args.noise),
        artifacts=int(args.artifacts),
        seed=None if args.seed is None else int(args.seed),
        keep_largest=bool(args.keep_largest),
    )
    result = corrupt_scan_file(src, out, params)
    if args.json:
        _print(result, as_json=True)
    else:
        print(
            f"wrote {result['output']} "
            f"({result['faces_before']} → {result['faces_after']} faces, "
            f"{result['retained_pct']}% retained, {result['bytes']} bytes)",
            flush=True,
        )
    return 0


def cmd_jobs_download(args: argparse.Namespace) -> int:
    out_dir = Path(args.out or ".")
    out_dir.mkdir(parents=True, exist_ok=True)
    with _client_from_args(args) as client:
        if args.file:
            paths = [args.file]
        else:
            arts = client.list_artifacts(args.job_id)
            paths = [str(a["path"]) for a in arts if a.get("path")]
        for rel in paths:
            data = client.download_file(args.job_id, rel)
            dest = out_dir / Path(rel).name
            dest.write_bytes(data)
            print(f"wrote {dest} ({len(data)} bytes)", flush=True)
    return 0


def build_parser() -> argparse.ArgumentParser:
    shared = argparse.ArgumentParser(add_help=False)
    shared.add_argument(
        "--base",
        default=os.environ.get("MESHMOOSE_BASE", "http://127.0.0.1:8787"),
        help="API base URL (env MESHMOOSE_BASE)",
    )
    shared.add_argument(
        "--token",
        default=None,
        help="Zoo API token (env ZOO_API_TOKEN / ZOO_SECRET_KEY / MESHMOOSE_TOKEN)",
    )
    shared.add_argument(
        "--json",
        action="store_true",
        help="Prefer JSON output where applicable",
    )
    shared.add_argument(
        "--http-timeout",
        type=float,
        default=60.0,
        help="Per-request HTTP timeout in seconds",
    )

    p = argparse.ArgumentParser(
        prog="meshmoose",
        description="CLI for the MeshMoose local API (jobs, demos, usage).",
        epilog=(
            "Examples:\n"
            "  meshmoose health\n"
            "  meshmoose jobs list --json\n"
            "  meshmoose jobs create --prompt \"Washer 20mm\" "
            "--photo a.jpg --mesh a.stl --wait\n"
            "  meshmoose demos run beverage-holder-stand --mode fast --wait\n"
            "  meshmoose jobs rename JOB_ID --title \"Coin v2\" --tag coin\n"
            "  meshmoose jobs logs JOB_ID --lines 50\n"
            "  meshmoose usage --watch --interval 30\n"
            "  meshmoose jobs download JOB_ID --out ./out\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        parents=[shared],
    )

    sub = p.add_subparsers(dest="command", required=True)

    health = sub.add_parser(
        "health",
        parents=[shared],
        help="Check API health",
        epilog="Example: meshmoose health",
    )
    health.set_defaults(func=cmd_health)

    completion = sub.add_parser(
        "completion",
        parents=[shared],
        help="Print shell completion script (bash | zsh)",
        epilog=(
            "Examples:\n"
            "  eval \"$(meshmoose completion bash)\"   # bash\n"
            "  eval \"$(meshmoose completion zsh)\"    # zsh"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    completion.add_argument("shell", choices=("bash", "zsh"))
    completion.set_defaults(func=cmd_completion)

    usage = sub.add_parser(
        "usage",
        parents=[shared],
        help="Show Zoo account usage (credits + recent calls)",
        epilog="Example: meshmoose usage · meshmoose usage --watch --interval 30",
    )
    usage.add_argument(
        "--watch",
        action="store_true",
        help="Poll usage repeatedly (Ctrl+C to stop)",
    )
    usage.add_argument(
        "--interval",
        type=float,
        default=30.0,
        help="Seconds between --watch polls (default 30)",
    )
    usage.set_defaults(func=cmd_usage)

    demos = sub.add_parser("demos", parents=[shared], help="Packaged demos")
    demos_sub = demos.add_subparsers(dest="demos_cmd", required=True)
    d_list = demos_sub.add_parser(
        "list",
        parents=[shared],
        help="List demos",
        epilog="Example: meshmoose demos list",
    )
    d_list.set_defaults(func=cmd_demos_list)
    d_run = demos_sub.add_parser(
        "run",
        parents=[shared],
        help="Create a job from a demo",
        epilog="Example: meshmoose demos run beverage-holder-stand --mode fast --wait",
    )
    d_run.add_argument("demo_id")
    d_run.add_argument("--mode", default="thoughtful")
    d_run.add_argument("--prompt", default=None)
    d_run.add_argument("--wait", action="store_true")
    d_run.add_argument("--timeout", type=float, default=900.0)
    d_run.set_defaults(func=cmd_demos_run)

    jobs = sub.add_parser("jobs", parents=[shared], help="Job lifecycle")
    jobs_sub = jobs.add_subparsers(dest="jobs_cmd", required=True)

    j_list = jobs_sub.add_parser(
        "list",
        parents=[shared],
        help="List jobs",
        epilog="Example: meshmoose jobs list",
    )
    j_list.set_defaults(func=cmd_jobs_list)

    j_get = jobs_sub.add_parser(
        "get",
        parents=[shared],
        help="Get one job",
        epilog="Example: meshmoose jobs get JOB_ID",
    )
    j_get.add_argument("job_id")
    j_get.set_defaults(func=cmd_jobs_get)

    j_create = jobs_sub.add_parser(
        "create",
        parents=[shared],
        help="Create a reconstruct job",
        epilog=(
            "Example:\n"
            "  meshmoose jobs create --prompt \"Make a stand\" "
            "--photo stand.jpg --mesh stand.stl "
            "--title \"Beverage stand\" --tag stand --wait"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    j_create.add_argument("--prompt", required=True)
    j_create.add_argument("--photo", action="append", default=[], metavar="PATH")
    j_create.add_argument("--mesh", action="append", default=[], metavar="PATH")
    j_create.add_argument("--mode", default="thoughtful")
    j_create.add_argument("--title", default=None, help="Optional job title")
    j_create.add_argument(
        "--tag",
        action="append",
        default=[],
        metavar="TAG",
        help="Optional tag (repeatable, max 5)",
    )
    j_create.add_argument("--wait", action="store_true")
    j_create.add_argument("--timeout", type=float, default=900.0)
    j_create.set_defaults(func=cmd_jobs_create)

    j_wait = jobs_sub.add_parser(
        "wait",
        parents=[shared],
        help="Poll until job finishes",
        epilog="Example: meshmoose jobs wait JOB_ID --timeout 600",
    )
    j_wait.add_argument("job_id")
    j_wait.add_argument("--timeout", type=float, default=900.0)
    j_wait.set_defaults(func=cmd_jobs_wait)

    j_cancel = jobs_sub.add_parser(
        "cancel",
        parents=[shared],
        help="Cancel a running job",
        epilog="Example: meshmoose jobs cancel JOB_ID",
    )
    j_cancel.add_argument("job_id")
    j_cancel.set_defaults(func=cmd_jobs_cancel)

    j_retry = jobs_sub.add_parser(
        "retry",
        parents=[shared],
        help="Retry a failed job (clone prompt + inputs)",
        epilog="Example: meshmoose jobs retry JOB_ID --wait",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    j_retry.add_argument("job_id")
    j_retry.add_argument("--wait", action="store_true")
    j_retry.add_argument("--timeout", type=float, default=900.0)
    j_retry.set_defaults(func=cmd_jobs_retry)

    j_resume = jobs_sub.add_parser(
        "resume",
        parents=[shared],
        help="Resume a failed job from its Agent KCL checkpoint",
        epilog="Example: meshmoose jobs resume JOB_ID --wait",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    j_resume.add_argument("job_id")
    j_resume.add_argument("--wait", action="store_true")
    j_resume.add_argument("--timeout", type=float, default=900.0)
    j_resume.set_defaults(func=cmd_jobs_resume)

    j_delete = jobs_sub.add_parser(
        "delete",
        parents=[shared],
        help="Delete a job and its files",
        epilog="Example: meshmoose jobs delete JOB_ID",
    )
    j_delete.add_argument("job_id")
    j_delete.set_defaults(func=cmd_jobs_delete)

    j_rename = jobs_sub.add_parser(
        "rename",
        parents=[shared],
        help="Rename a job and/or replace its tags",
        epilog=(
            "Example:\n"
            "  meshmoose jobs rename JOB_ID --title \"Coin v2\"\n"
            "  meshmoose jobs rename JOB_ID --tag coin --tag pla"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    j_rename.add_argument("job_id")
    j_rename.add_argument("--title", default=None, help="New title (max 80 chars)")
    j_rename.add_argument(
        "--tag",
        action="append",
        default=None,
        metavar="TAG",
        help="Replace tags (repeatable, max 5; omit to keep existing)",
    )
    j_rename.set_defaults(func=cmd_jobs_rename)

    j_logs = jobs_sub.add_parser(
        "logs",
        parents=[shared],
        help="Print a job's log (tail)",
        epilog="Example: meshmoose jobs logs JOB_ID --lines 50",
    )
    j_logs.add_argument("job_id")
    j_logs.add_argument(
        "--lines",
        type=int,
        default=80,
        help="Number of trailing lines to print (0 = all, default 80)",
    )
    j_logs.set_defaults(func=cmd_jobs_logs)

    j_refine = jobs_sub.add_parser(
        "refine",
        parents=[shared],
        help="Refine a succeeded job",
        epilog='Example: meshmoose jobs refine JOB_ID --message "Thicken 0.5mm" --wait',
    )
    j_refine.add_argument("job_id")
    j_refine.add_argument("--message", required=True)
    j_refine.add_argument("--photo", action="append", default=[], metavar="PATH")
    j_refine.add_argument("--mesh", action="append", default=[], metavar="PATH")
    j_refine.add_argument("--wait", action="store_true")
    j_refine.add_argument("--timeout", type=float, default=900.0)
    j_refine.set_defaults(func=cmd_jobs_refine)

    j_finish = jobs_sub.add_parser(
        "finish",
        parents=[shared],
        help="Apply a PBR surface finish preset (appearance) and re-export",
        epilog=(
            "Example: meshmoose jobs finish JOB_ID --preset brushed-aluminum --wait\n"
            "         meshmoose jobs finish --list-presets"
        ),
    )
    j_finish.add_argument("job_id", nargs="?", default=None)
    j_finish.add_argument("--preset", default=None, help="Finish preset id")
    j_finish.add_argument(
        "--list-presets",
        action="store_true",
        help="List available finish presets and exit",
    )
    j_finish.add_argument("--wait", action="store_true")
    j_finish.add_argument("--timeout", type=float, default=900.0)
    j_finish.set_defaults(func=cmd_jobs_finish)

    j_save_kcl = jobs_sub.add_parser(
        "save-kcl",
        parents=[shared],
        help="Save edited main.kcl (archives previous into kcl_history/)",
        epilog="Example: meshmoose jobs save-kcl JOB_ID --file ./main.kcl --reexport --wait",
    )
    j_save_kcl.add_argument("job_id")
    j_save_kcl.add_argument("--file", required=True, help="Path to .kcl source")
    j_save_kcl.add_argument("--note", default=None, help="Optional history note")
    j_save_kcl.add_argument(
        "--reexport",
        action="store_true",
        help="Re-export STL/STEP/3MF after save (uses Engine minutes)",
    )
    j_save_kcl.add_argument("--wait", action="store_true", help="Wait when --reexport")
    j_save_kcl.add_argument("--timeout", type=float, default=900.0)
    j_save_kcl.set_defaults(func=cmd_jobs_save_kcl)

    j_kcl_versions = jobs_sub.add_parser(
        "kcl-versions",
        parents=[shared],
        help="List archived main.kcl versions",
        epilog="Example: meshmoose jobs kcl-versions JOB_ID",
    )
    j_kcl_versions.add_argument("job_id")
    j_kcl_versions.set_defaults(func=cmd_jobs_kcl_versions)

    j_kcl_restore = jobs_sub.add_parser(
        "kcl-restore",
        parents=[shared],
        help="Restore an archived main.kcl version",
        epilog="Example: meshmoose jobs kcl-restore JOB_ID VERSION_ID --reexport --wait",
    )
    j_kcl_restore.add_argument("job_id")
    j_kcl_restore.add_argument("version_id")
    j_kcl_restore.add_argument("--note", default=None, help="Optional history note")
    j_kcl_restore.add_argument(
        "--reexport",
        action="store_true",
        help="Re-export STL/STEP/3MF after restore",
    )
    j_kcl_restore.add_argument("--wait", action="store_true", help="Wait when --reexport")
    j_kcl_restore.add_argument("--timeout", type=float, default=900.0)
    j_kcl_restore.set_defaults(func=cmd_jobs_kcl_restore)

    j_arts = jobs_sub.add_parser(
        "artifacts",
        parents=[shared],
        help="List job artifacts",
        epilog="Example: meshmoose jobs artifacts JOB_ID",
    )
    j_arts.add_argument("job_id")
    j_arts.set_defaults(func=cmd_jobs_artifacts)

    j_dl = jobs_sub.add_parser(
        "download",
        parents=[shared],
        help="Download artifacts to a folder",
        epilog="Example: meshmoose jobs download JOB_ID --out ./exports",
    )
    j_dl.add_argument("job_id")
    j_dl.add_argument("--out", default=".")
    j_dl.add_argument("--file", default=None, help="Relative artifact path (default: all)")
    j_dl.set_defaults(func=cmd_jobs_download)

    mesh = sub.add_parser(
        "mesh",
        parents=[shared],
        help="Local mesh utilities (no API required)",
    )
    mesh_sub = mesh.add_subparsers(dest="mesh_cmd", required=True)
    m_corrupt = mesh_sub.add_parser(
        "corrupt",
        parents=[shared],
        help="Make a partial noisy scan mesh for pipeline tests",
        epilog=(
            "Example:\n"
            "  meshmoose mesh corrupt demos/beverage-holder-stand/lidl-jar-stand.stl \\\n"
            "    -o /tmp/stand_partial.stl --missing 0.35 --noise 0.5 --artifacts 4 --seed 7"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    m_corrupt.add_argument("input", help="Input STL / PLY / OBJ / 3MF")
    m_corrupt.add_argument(
        "-o",
        "--out",
        default=None,
        help="Output path (default: <input>_partial.stl)",
    )
    m_corrupt.add_argument(
        "--missing",
        type=float,
        default=0.3,
        help="Fraction of mesh removed by planar cut (0–0.9, default 0.3)",
    )
    m_corrupt.add_argument(
        "--noise",
        type=float,
        default=0.4,
        help="Surface noise strength (0–2, default 0.4)",
    )
    m_corrupt.add_argument(
        "--artifacts",
        type=int,
        default=3,
        help="Number of scan artifacts: holes, spikes, floaters, shreds (default 3)",
    )
    m_corrupt.add_argument(
        "--seed",
        type=int,
        default=42,
        help="RNG seed (omit randomness with a fixed seed; use -1 for nondeterministic)",
    )
    m_corrupt.add_argument(
        "--keep-largest",
        action="store_true",
        help="After the planar cut, keep only the largest connected component",
    )
    m_corrupt.set_defaults(func=cmd_mesh_corrupt)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    # Normalize seed=-1 → None for nondeterministic runs.
    if getattr(args, "seed", None) == -1:
        args.seed = None
    try:
        return int(args.func(args))
    except MeshMooseError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except (TimeoutError, ValueError, FileNotFoundError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
