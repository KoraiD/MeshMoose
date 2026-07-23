"""Normalize uploaded photos for Zoo Agent (JPEG / PNG / WebP)."""

from __future__ import annotations

import io
import platform
import subprocess
import tempfile
from pathlib import Path

# Accepted uploads (some need conversion before Zoo attach).
UPLOAD_PHOTO_SUFFIXES = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".heic",
    ".heif",
}

# MIME types Zoo Agent is known to accept as image attachments.
ZOO_READY_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def mime_for_photo(path: Path | str) -> str:
    suffix = Path(path).suffix.lower()
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    return "application/octet-stream"


def _safe_stem(filename: str) -> str:
    return Path(filename).stem.replace(" ", "_") or "photo"


def _convert_with_pillow(data: bytes, out_format: str) -> bytes:
    from PIL import Image

    img = Image.open(io.BytesIO(data))
    if out_format.upper() == "JPEG" and img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    save_kwargs: dict = {"format": out_format}
    if out_format.upper() == "JPEG":
        save_kwargs["quality"] = 92
        save_kwargs["optimize"] = True
    img.save(buf, **save_kwargs)
    return buf.getvalue()


def _heic_to_jpeg_pillow(data: bytes) -> bytes:
    try:
        from pillow_heif import register_heif_opener
    except ImportError as exc:  # pragma: no cover - optional dep path
        raise RuntimeError(
            "HEIC support requires pillow-heif (pip install pillow-heif)"
        ) from exc
    register_heif_opener()
    return _convert_with_pillow(data, "JPEG")


def _heic_to_jpeg_sips(data: bytes) -> bytes:
    if platform.system() != "Darwin":
        raise RuntimeError("sips HEIC conversion is only available on macOS")
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.heic"
        dst = Path(tmp) / "out.jpg"
        src.write_bytes(data)
        proc = subprocess.run(
            ["sips", "-s", "format", "jpeg", str(src), "--out", str(dst)],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0 or not dst.is_file():
            err = (proc.stderr or proc.stdout or "sips failed").strip()
            raise RuntimeError(f"HEIC conversion via sips failed: {err}")
        return dst.read_bytes()


def heic_to_jpeg(data: bytes) -> bytes:
    try:
        return _heic_to_jpeg_pillow(data)
    except Exception:
        if platform.system() == "Darwin":
            return _heic_to_jpeg_sips(data)
        raise


def normalize_photo_upload(filename: str, data: bytes) -> tuple[str, bytes]:
    """
    Return (safe_filename, bytes) suitable for Zoo Agent image attach.

    JPG/JPEG/PNG/WebP pass through. HEIC/HEIF and GIF are converted to JPEG/PNG.
    """
    raw_name = Path(filename).name.replace(" ", "_") or "photo.jpg"
    suffix = Path(raw_name).suffix.lower()
    if not suffix:
        # Browsers sometimes omit extension; sniff PNG/JPEG magic.
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            return f"{_safe_stem(raw_name)}.png", data
        if data[:3] == b"\xff\xd8\xff":
            return f"{_safe_stem(raw_name)}.jpg", data
        raise ValueError("Photo has no recognizable image type")

    if suffix not in UPLOAD_PHOTO_SUFFIXES:
        raise ValueError(
            f"Unsupported photo type '{suffix}'. "
            f"Use: {', '.join(sorted(UPLOAD_PHOTO_SUFFIXES))}"
        )

    if suffix in ZOO_READY_SUFFIXES:
        return raw_name, data

    stem = _safe_stem(raw_name)
    if suffix in {".heic", ".heif"}:
        return f"{stem}.jpg", heic_to_jpeg(data)

    if suffix == ".gif":
        return f"{stem}.png", _convert_with_pillow(data, "PNG")

    raise ValueError(f"Unsupported photo type '{suffix}'")
