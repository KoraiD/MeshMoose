"""Human-readable job error formatting (Zoo/KCL exceptions are often noisy)."""

from __future__ import annotations

import ast
import re
from typing import Any

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
_BOX_RE = re.compile(r"[╭╰─│·▲╰─┘┌┐└]+")


def strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", text)


def _unwrap_literal(text: str) -> str:
    """Unwrap Python reprs like ('msg', True) that KclError sometimes stringifies to."""
    s = text.strip()
    if not (s.startswith("(") and s.endswith(")")):
        return s
    try:
        val = ast.literal_eval(s)
    except (ValueError, SyntaxError, MemoryError):
        return s
    if isinstance(val, tuple) and val:
        first = val[0]
        if isinstance(first, str):
            return first
    if isinstance(val, str):
        return val
    return s


def _summarize(text: str, *, max_len: int = 480) -> str:
    cleaned = strip_ansi(text)
    cleaned = _unwrap_literal(cleaned)
    cleaned = strip_ansi(cleaned)
    lines: list[str] = []
    for raw in cleaned.splitlines():
        line = _BOX_RE.sub(" ", raw)
        line = re.sub(r"\s+", " ", line).strip(" \t|-")
        if not line:
            continue
        # Skip source-listing crumbs like "1 │ // comment"
        if re.match(r"^\d+\s+", line) and ("│" in raw or "//" in line):
            continue
        if line in {"main", "True", "False"}:
            continue
        lines.append(line)

    def _strip_bullet(ln: str) -> str:
        return re.sub(r"^[×xX]\s*", "", ln).strip()

    title = next(
        (ln for ln in lines if "kcl" in ln.lower() and "error" in ln.lower()),
        None,
    )
    # Prefer a concrete reason line (colon / "interrupted"), not the title itself.
    detail = None
    for ln in lines:
        low = ln.lower()
        if title and ln == title:
            continue
        if "interrupted" in low or "hangup:" in low or (
            "hangup" in low and "error" not in low
        ):
            detail = _strip_bullet(ln)
            break
    # Prefer a concrete hangup/interrupt line; keep a KCL title when useful.
    if detail and title:
        detail_body = detail.split(":", 1)[-1].strip() if ":" in detail else detail
        if detail_body and detail_body.lower() not in title.lower():
            summary = f"{title}: {detail_body}"
        else:
            summary = title
    elif detail:
        summary = detail
    elif title:
        summary = title
    elif lines:
        summary = lines[0]
        if len(lines) > 1 and len(summary) < 80:
            summary = f"{summary} — {lines[1]}"
    else:
        summary = cleaned.strip() or "Unknown error"

    summary = re.sub(r"\s+", " ", summary).strip()
    if len(summary) > max_len:
        return summary[: max_len - 1].rstrip() + "…"
    return summary


def format_job_error(exc: Any) -> str:
    """Turn Zoo/KCL/Python exceptions into a short UI-safe message."""
    if exc is None:
        return "Unknown error"
    if isinstance(exc, BaseException):
        parts: list[str] = []
        for arg in exc.args:
            if isinstance(arg, str):
                parts.append(arg)
            elif isinstance(arg, tuple):
                for item in arg:
                    if isinstance(item, str):
                        parts.append(item)
            elif isinstance(arg, BaseException):
                parts.append(str(arg))
        parts.append(str(exc))
        summaries = [_summarize(p) for p in parts if p]
        for summary in summaries:
            low = summary.lower()
            if "hangup" in low or "interrupted" in low:
                return summary
        return summaries[0] if summaries else _summarize(type(exc).__name__)
    return _summarize(str(exc))
