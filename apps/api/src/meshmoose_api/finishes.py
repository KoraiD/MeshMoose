"""PBR surface-finish presets mapped to KCL `appearance(...)`."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any

FINISH_MARKER = "// meshmoose-finish"


@dataclass(frozen=True)
class FinishPreset:
    id: str
    name: str
    description: str
    color: str
    metalness: float
    roughness: float
    opacity: float | None = None


# Presets aligned with Zoo Design Studio PBR examples (KCL uses 0–100 percentages).
FINISH_PRESETS: tuple[FinishPreset, ...] = (
    FinishPreset(
        id="polished-aluminum",
        name="Polished aluminum",
        description="Bright metal, mirror-smooth",
        color="#C0C0C0",
        metalness=100,
        roughness=10,
    ),
    FinishPreset(
        id="brushed-aluminum",
        name="Brushed aluminum",
        description="Satin metal finish",
        color="#B8B8B8",
        metalness=100,
        roughness=30,
    ),
    FinishPreset(
        id="stainless-steel",
        name="Stainless steel",
        description="Cool polished steel",
        color="#E0E0E0",
        metalness=100,
        roughness=15,
    ),
    FinishPreset(
        id="anodized-red",
        name="Anodized red",
        description="Colored anodized metal",
        color="#CC0000",
        metalness=100,
        roughness=25,
    ),
    FinishPreset(
        id="matte-plastic",
        name="Matte plastic",
        description="Non-metallic ABS-like",
        color="#4A90E2",
        metalness=0,
        roughness=60,
    ),
    FinishPreset(
        id="glossy-plastic",
        name="Glossy plastic",
        description="Shiny injection-molded plastic",
        color="#4A90E2",
        metalness=0,
        roughness=20,
    ),
    FinishPreset(
        id="rubber",
        name="Rubber",
        description="Soft matte elastomer",
        color="#2C2C2C",
        metalness=0,
        roughness=90,
    ),
    FinishPreset(
        id="glass",
        name="Glass",
        description="Clear transparent",
        color="#FFFFFF",
        metalness=0,
        roughness=0,
        opacity=20,
    ),
)

_PRESET_BY_ID = {p.id: p for p in FINISH_PRESETS}

_ASSIGN_RE = re.compile(r"^([A-Za-z_][\w]*)\s*=", re.MULTILINE)
_APPEARANCE_ASSIGN_RE = re.compile(
    r"^([A-Za-z_][\w]*)\s*=\s*appearance\s*\(",
    re.MULTILINE,
)
# Legacy buggy finish: unassigned `name\n  |> appearance(...)` left the prior solid painted.
_LEGACY_BARE_PIPE_RE = re.compile(
    r"\n+[A-Za-z_][\w]*\s*\n\s*\|>\s*appearance\s*\((?:[^()]|\([^()]*\))*\)\s*$",
)


def list_finish_presets() -> list[dict[str, Any]]:
    return [asdict(p) for p in FINISH_PRESETS]


def get_finish_preset(preset_id: str) -> FinishPreset:
    key = (preset_id or "").strip().lower()
    preset = _PRESET_BY_ID.get(key)
    if preset is None:
        known = ", ".join(p.id for p in FINISH_PRESETS)
        raise ValueError(f"Unknown finish preset '{preset_id}'. Choose one of: {known}")
    return preset


def _strip_previous_finish(kcl: str) -> str:
    body = kcl
    if FINISH_MARKER in body:
        body = body.split(FINISH_MARKER, 1)[0]
    body = _LEGACY_BARE_PIPE_RE.sub("", body)
    return body.rstrip()


def _matching_paren_end(text: str, open_idx: int) -> int:
    """Return index of ')' matching '(' at open_idx."""
    depth = 0
    i = open_idx
    while i < len(text):
        ch = text[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError("Unbalanced parentheses in appearance(...) call")


def _first_arg(inner: str) -> str:
    """First appearance() argument (solids), stopping before named kwargs."""
    depth = 0
    for i, ch in enumerate(inner):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "," and depth == 0:
            # Prefer cutting before named args like `color =`
            rest = inner[i + 1 :].lstrip()
            if re.match(r"[A-Za-z_][\w]*\s*=", rest):
                return inner[:i].strip()
            # Positional second arg — keep scanning; solids are first.
            return inner[:i].strip()
    return inner.strip()


def _appearance_kwargs(preset: FinishPreset) -> str:
    parts = [
        f'color = "{preset.color}"',
        f"metalness = {preset.metalness:g}",
        f"roughness = {preset.roughness:g}",
    ]
    if preset.opacity is not None:
        parts.append(f"opacity = {preset.opacity:g}")
    return ", ".join(parts)


def _format_appearance_assignment(name: str, solids_arg: str, preset: FinishPreset) -> str:
    kwargs = _appearance_kwargs(preset)
    solids = solids_arg.strip()
    if "\n" in solids or len(solids) > 48:
        return (
            f"{name} = appearance(\n"
            f"  {solids},\n"
            f"  {kwargs},\n"
            f")"
        )
    return f"{name} = appearance({solids}, {kwargs})"


def _pipe_appearance(preset: FinishPreset) -> str:
    return f"appearance({_appearance_kwargs(preset)})"


def apply_finish_to_kcl(kcl: str, preset: FinishPreset) -> str:
    """
    Apply a finish so Live Engine shows it: rewrite the last solid's appearance
    in-place (or assign a piped appearance). Never leave a bare unassigned pipe —
    that keeps the previous painted solid in the scene.
    """
    body = _strip_previous_finish(kcl)
    if not body.strip():
        raise ValueError("main.kcl is empty — nothing to finish")

    matches = list(_APPEARANCE_ASSIGN_RE.finditer(body))
    if matches:
        m = matches[-1]
        name = m.group(1)
        open_paren = body.index("(", m.end() - 1)
        close_paren = _matching_paren_end(body, open_paren)
        inner = body[open_paren + 1 : close_paren]
        solids = _first_arg(inner)
        replacement = _format_appearance_assignment(name, solids, preset)
        new_body = body[: m.start()] + replacement + body[close_paren + 1 :]
        note = f"\n\n{FINISH_MARKER}: {preset.name}\n"
        return new_body.rstrip() + note

    pipe = _pipe_appearance(preset)
    matches = list(_ASSIGN_RE.finditer(body))
    if matches:
        # Pipe appearance onto the last assignment in-place so the solid itself
        # is painted (KCL bindings are not reassigned).
        start = matches[-1].start()
        head, tail = body[:start], body[start:]
        lines = tail.splitlines(keepends=True)
        stmt: list[str] = [lines[0]]
        consumed = 1
        for line in lines[1:]:
            stripped = line.strip()
            if stripped == "":
                # Trailing blank ends the statement before the next top-level line.
                if consumed + 1 < len(lines) and lines[consumed].strip() == "":
                    break
                stmt.append(line)
                consumed += 1
                continue
            # Continuation: indented, or a dangling pipe.
            if line[0] in " \t" or stripped.startswith("|>"):
                stmt.append(line)
                consumed += 1
                continue
            break
        stmt_text = "".join(stmt).rstrip()
        # Drop a trailing appearance pipe if we already applied one this way.
        stmt_text = re.sub(
            r"\n?\s*\|>\s*appearance\s*\((?:[^()]|\([^()]*\))*\)\s*$",
            "",
            stmt_text,
        )
        stmt_text = f"{stmt_text}\n  |> {pipe}"
        rest = "".join(lines[consumed:])
        note = f"\n\n{FINISH_MARKER}: {preset.name}\n"
        return (head + stmt_text + ("\n" if rest else "") + rest).rstrip() + note

    lines = body.splitlines()
    last_i = max(i for i, line in enumerate(lines) if line.strip())
    lines[last_i] = f"{lines[last_i].rstrip()} |> {pipe}"
    return "\n".join(lines) + f"\n\n{FINISH_MARKER}: {preset.name}\n"
