#!/usr/bin/env python3
"""Generate web-optimised thumbnails for gallery images.

Thumbnails are written to the top-level ``thumbnails/`` directory using the same
file names as the originals. JPEG files are saved with adjustable quality,
other formats are optimized where possible. Existing thumbnails are skipped if
unchanged unless ``--force`` is supplied.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Iterable

try:
    from PIL import Image, ImageSequence

    # Allow extremely large source images while still guarding against unbounded values.
    # Pillow raises a DecompressionBombError above MAX_IMAGE_PIXELS; bump the ceiling so
    # high-resolution originals can be processed without manual tweaks.
    Image.MAX_IMAGE_PIXELS = max(getattr(Image, "MAX_IMAGE_PIXELS", 0) or 0, 1_000_000_000)
except ImportError as exc:  # pragma: no cover - friendly CLI message
    raise SystemExit(
        "Pillow is required. Install dependencies with: \n"
        "  python3 -m pip install -r requirements.txt\n"
        f"Original error: {exc}"
    )

REPO_ROOT = Path(__file__).resolve().parent.parent
PHOTOS_DIR = REPO_ROOT / "photos"
THUMBNAIL_DIR = REPO_ROOT / "thumbnails"
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".webp"}
DEFAULT_MAX_SIZE = 640
DEFAULT_QUALITY = 78


def iter_photo_files(directory: Path) -> Iterable[Path]:
    """Yield all valid image files within ``directory`` and its subfolders."""

    def sort_key(path: Path) -> str:
        try:
            relative = path.relative_to(directory)
        except ValueError:
            relative = path
        return relative.as_posix().lower()

    for entry in sorted(directory.rglob("*"), key=sort_key):
        if entry.is_file() and entry.suffix.lower() in ALLOWED_EXTENSIONS:
            yield entry


def coerce_single_frame(image: Image.Image) -> Image.Image:
    """Return a single-frame image for GIFs/animated formats."""
    if getattr(image, "is_animated", False):
        first = ImageSequence.Iterator(image).__next__()
        return first.convert("RGBA")
    return image


def convert_if_needed(image: Image.Image, ext: str) -> Image.Image:
    if ext in {".jpg", ".jpeg", ".webp"} and image.mode not in {"RGB", "L"}:
        return image.convert("RGB")
    if ext == ".png" and image.mode == "P":
        return image.convert("RGBA")
    return image


def save_kwargs_for_extension(ext: str, quality: int) -> dict:
    if ext in {".jpg", ".jpeg"}:
        return {"quality": quality, "optimize": True, "progressive": True}
    if ext == ".png":
        return {"optimize": True}
    if ext == ".webp":
        return {"quality": quality, "method": 6}
    return {}


def generate_thumbnail(src: Path, dest: Path, *, max_size: int, quality: int, force: bool) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not force and dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime:
        return False

    with Image.open(src) as image:
        ext = dest.suffix.lower()
        image = coerce_single_frame(image)
        image = convert_if_needed(image, ext)
        try:
            resample = Image.Resampling.LANCZOS  # Pillow >= 9
        except AttributeError:  # pragma: no cover
            resample = Image.LANCZOS
        image.thumbnail((max_size, max_size), resample=resample)
        kwargs = save_kwargs_for_extension(ext, quality)
        image.save(dest, **kwargs)
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-size", type=int, default=DEFAULT_MAX_SIZE, help="Longest edge for thumbnails (pixels)")
    parser.add_argument(
        "--quality",
        type=int,
        default=DEFAULT_QUALITY,
        help="JPEG/WEBP quality (1-100)",
    )
    parser.add_argument("--force", action="store_true", help="Regenerate all thumbnails even if up-to-date")
    args = parser.parse_args(argv)

    if not PHOTOS_DIR.exists():
        raise SystemExit(f"Photos directory not found: {PHOTOS_DIR}")

    generated = 0
    skipped = 0
    for src in iter_photo_files(PHOTOS_DIR):
        dest = THUMBNAIL_DIR / src.relative_to(PHOTOS_DIR)
        if generate_thumbnail(src, dest, max_size=args.max_size, quality=args.quality, force=args.force):
            generated += 1
        else:
            skipped += 1

    print(f"Generated {generated} thumbnail(s); skipped {skipped} already up-to-date.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
