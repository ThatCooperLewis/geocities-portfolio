#!/usr/bin/env python3
"""Produce optimised copies of the raw photos while leaving originals intact.

The optimiser walks the ``photos/`` tree, generates space-friendly variants
inside ``optimized/`` that respect the requested size and resolution limits, and
preserves the original files for archival use.
"""

from __future__ import annotations

import argparse
import os
import shutil
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Iterable

try:
    from PIL import Image, ImageOps

    Image.MAX_IMAGE_PIXELS = max(getattr(Image, "MAX_IMAGE_PIXELS", 0) or 0, 1_000_000_000)
except ImportError as exc:  # pragma: no cover - friendly CLI error
    raise SystemExit(
        "Pillow is required. Install dependencies with:\n"
        "  python3 -m pip install -r requirements.txt\n"
        f"Original error: {exc}"
    )

REPO_ROOT = Path(__file__).resolve().parent.parent
PHOTOS_DIR = REPO_ROOT / "photos"
OPTIMIZED_DIR = REPO_ROOT / "optimized"
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"}
FORMAT_MAP = {
    ".jpg": "JPEG",
    ".jpeg": "JPEG",
    ".png": "PNG",
    ".webp": "WEBP",
    ".bmp": "BMP",
    ".tiff": "TIFF",
}
QUALITY_EXTENSIONS = {".jpg", ".jpeg", ".webp"}
DEFAULT_MAX_BYTES = 4 * 1024 * 1024
DEFAULT_MAX_DIMENSION = 3000
DEFAULT_INITIAL_QUALITY = 90
DEFAULT_MIN_QUALITY = 60
DEFAULT_QUALITY_STEP = 5
DEFAULT_SCALE_STEP = 0.9
DEFAULT_MIN_SCALE = 0.6


def iter_photo_files(directory: Path) -> Iterable[Path]:
    def sort_key(path: Path) -> str:
        try:
            relative = path.relative_to(directory)
        except ValueError:
            relative = path
        return relative.as_posix().lower()

    for entry in sorted(directory.rglob("*"), key=sort_key):
        if entry.is_file() and entry.suffix.lower() in ALLOWED_EXTENSIONS:
            yield entry


def convert_mode(image: Image.Image, ext: str) -> Image.Image:
    if ext in {".jpg", ".jpeg", ".webp"} and image.mode not in {"RGB", "L"}:
        return image.convert("RGB")
    if ext == ".png" and image.mode == "P":
        return image.convert("RGBA")
    return image


def save_kwargs(ext: str, quality: int | None) -> dict:
    if ext in {".jpg", ".jpeg"}:
        return {"quality": quality, "optimize": True, "progressive": True}
    if ext == ".webp":
        return {"quality": quality, "method": 6}
    if ext == ".png":
        return {"optimize": True}
    if ext == ".tiff":
        return {"compression": "tiff_lzw"}
    return {}


def build_scale_sequence(scale_step: float, min_scale: float) -> list[float]:
    values = [1.0]
    current = 1.0
    while current - min_scale > 1e-6:
        next_scale = max(current * scale_step, min_scale)
        if abs(next_scale - current) < 1e-6:
            break
        values.append(next_scale)
        current = next_scale
    return values


def render_variant(image: Image.Image, scale: float) -> Image.Image:
    if scale >= 0.999:
        return image
    width, height = image.size
    target = (max(1, int(round(width * scale))), max(1, int(round(height * scale))))
    if target == image.size:
        return image
    try:
        resample = Image.Resampling.LANCZOS
    except AttributeError:  # pragma: no cover - Pillow < 9
        resample = Image.LANCZOS
    return image.resize(target, resample=resample)


def try_encode(image: Image.Image, ext: str, *, scale: float, quality: int | None) -> tuple[bytes, tuple[int, int]]:
    variant = render_variant(image, scale)
    buffer = BytesIO()
    format_name = FORMAT_MAP[ext]
    kwargs = save_kwargs(ext, quality)
    variant.save(buffer, format=format_name, **kwargs)
    return buffer.getvalue(), variant.size


def optimise_file(
    path: Path,
    *,
    output_root: Path,
    max_bytes: int,
    max_dimension: int,
    initial_quality: int,
    min_quality: int,
    quality_step: int,
    scale_step: float,
    min_scale: float,
    dry_run: bool,
) -> str:
    try:
        relative_path = path.relative_to(PHOTOS_DIR)
    except ValueError:
        relative_path = Path(path.name)

    destination = output_root / relative_path

    stat_info = path.stat()
    original_size = stat_info.st_size
    original_mode = stat_info.st_mode

    ext = path.suffix.lower()
    if ext not in FORMAT_MAP:
        return "skipped_unknown_format"

    with Image.open(path) as image:
        if getattr(image, "is_animated", False) and getattr(image, "n_frames", 1) > 1:
            return "skipped_animated"

        image = ImageOps.exif_transpose(image)
        image = convert_mode(image, ext)
        image.load()

        width, height = image.size
        longest_dimension = max(width, height)
        dimension_scale = 1.0
        if max_dimension > 0 and longest_dimension > max_dimension:
            dimension_scale = max_dimension / float(longest_dimension)
        dimension_scale = min(dimension_scale, 1.0)

        # For already-small files, keep an exact copy to avoid needless re-encoding.
        if dimension_scale >= 0.999 and original_size <= max_bytes:
            if dry_run:
                print(
                    f"DRY-RUN: Would copy {path.relative_to(REPO_ROOT)} -> {destination.relative_to(REPO_ROOT)}"
                )
                return "dry_run"

            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
            print(
                f"Copied {path.relative_to(REPO_ROOT)} -> {destination.relative_to(REPO_ROOT)} "
                f"(already within limits; {original_size / 1024:.1f} KiB)"
            )
            return "copied"

        base_scales = build_scale_sequence(scale_step, min_scale)
        scales: list[float] = []
        for base_scale in base_scales:
            actual_scale = base_scale * dimension_scale
            if dimension_scale > 0:
                actual_scale = min(actual_scale, dimension_scale)
            if actual_scale <= 0:
                continue
            if not scales or abs(scales[-1] - actual_scale) > 1e-6:
                scales.append(actual_scale)
        if not scales:
            scales = [dimension_scale if dimension_scale > 0 else 1.0]

        target_payload: bytes | None = None
        target_size: tuple[int, int] | None = None
        chosen_scale: float | None = None
        chosen_quality: int | None = None

        quality_supported = ext in QUALITY_EXTENSIONS

        for scale in scales:
            payload, size = try_encode(
                image,
                ext,
                scale=scale,
                quality=initial_quality if quality_supported else None,
            )
            if len(payload) <= max_bytes and (max_dimension <= 0 or max(size) <= max_dimension):
                target_payload = payload
                target_size = size
                chosen_scale = scale
                chosen_quality = initial_quality if quality_supported else None
                break

        if target_payload is None and quality_supported:
            min_scale_value = scales[-1]
            quality = initial_quality - quality_step
            while quality >= min_quality:
                payload, size = try_encode(image, ext, scale=min_scale_value, quality=quality)
                if len(payload) <= max_bytes and (max_dimension <= 0 or max(size) <= max_dimension):
                    target_payload = payload
                    target_size = size
                    chosen_scale = min_scale_value
                    chosen_quality = quality
                    break
                quality -= quality_step

        if target_payload is None or target_size is None:
            return "failed"

    destination_str = destination.relative_to(REPO_ROOT)
    if dry_run:
        print(
            f"DRY-RUN: Would optimise {path.relative_to(REPO_ROOT)} -> {destination_str} "
            f"({target_size[0]}x{target_size[1]}, {len(target_payload) / 1024:.1f} KiB; was {original_size / 1024:.1f} KiB)"
            + (f", scale {chosen_scale:.3f}" if chosen_scale is not None else "")
            + (
                f", quality {chosen_quality}" if chosen_quality is not None and chosen_quality != initial_quality else ""
            )
        )
        return "dry_run"

    destination.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(
        prefix=path.stem + "_optimised_",
        suffix=path.suffix,
        dir=destination.parent,
        delete=False,
    ) as tmp:
        tmp.write(target_payload)
        tmp_path = Path(tmp.name)

    os.chmod(tmp_path, original_mode)
    os.replace(tmp_path, destination)

    print(
        f"Optimised {path.relative_to(REPO_ROOT)} -> {destination_str} "
        f"({target_size[0]}x{target_size[1]}, {len(target_payload) / 1024:.1f} KiB; was {original_size / 1024:.1f} KiB)"
        + (f", scale {chosen_scale:.3f}" if chosen_scale is not None else "")
        + (
            f", quality {chosen_quality}" if chosen_quality is not None and chosen_quality != initial_quality else ""
        )
    )
    return "optimised"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--max-bytes",
        type=int,
        default=DEFAULT_MAX_BYTES,
        help="Target max file size in bytes (default: 4 MiB)",
    )
    parser.add_argument(
        "--max-dimension",
        type=int,
        default=DEFAULT_MAX_DIMENSION,
        help="Maximum allowed width or height in pixels for optimised images (default: 3000)",
    )
    parser.add_argument(
        "--initial-quality",
        type=int,
        default=DEFAULT_INITIAL_QUALITY,
        help="Starting quality for JPEG/WEBP encodes (default: 90)",
    )
    parser.add_argument(
        "--min-quality",
        type=int,
        default=DEFAULT_MIN_QUALITY,
        help="Lowest quality to try for JPEG/WEBP (default: 70)",
    )
    parser.add_argument(
        "--quality-step",
        type=int,
        default=DEFAULT_QUALITY_STEP,
        help="Quality decrement when the minimum scale still exceeds the size budget (default: 5)",
    )
    parser.add_argument(
        "--scale-step",
        type=float,
        default=DEFAULT_SCALE_STEP,
        help="Factor applied when shrinking dimensions (default: 0.9)",
    )
    parser.add_argument(
        "--min-scale",
        type=float,
        default=DEFAULT_MIN_SCALE,
        help="Smallest scale factor allowed relative to the original (default: 0.6)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Report changes without modifying files")
    args = parser.parse_args(argv)

    if args.max_bytes <= 0:
        raise SystemExit("--max-bytes must be positive")
    if args.max_dimension <= 0:
        raise SystemExit("--max-dimension must be positive")
    if not (0.0 < args.min_scale <= 1.0):
        raise SystemExit("--min-scale must be between 0 and 1")
    if not (0.0 < args.scale_step < 1.0):
        raise SystemExit("--scale-step must be between 0 and 1")
    if args.min_quality > args.initial_quality:
        raise SystemExit("--min-quality cannot exceed --initial-quality")

    if not PHOTOS_DIR.exists():
        raise SystemExit(f"Photos directory not found: {PHOTOS_DIR}")

    OPTIMIZED_DIR.mkdir(parents=True, exist_ok=True)

    stats = {
        "optimised": 0,
        "copied": 0,
        "failed": 0,
        "skipped_unknown_format": 0,
        "skipped_animated": 0,
        "dry_run": 0,
    }

    for photo in iter_photo_files(PHOTOS_DIR):
        outcome = optimise_file(
            photo,
            output_root=OPTIMIZED_DIR,
            max_bytes=args.max_bytes,
            max_dimension=args.max_dimension,
            initial_quality=args.initial_quality,
            min_quality=args.min_quality,
            quality_step=args.quality_step,
            scale_step=args.scale_step,
            min_scale=args.min_scale,
            dry_run=args.dry_run,
        )
        stats[outcome] = stats.get(outcome, 0) + 1

    summary = (
        "Optimisation complete: "
        f"optimised={stats['optimised']} "
        f"copied={stats['copied']} "
        f"skipped_animated={stats['skipped_animated']} "
        f"skipped_unknown={stats['skipped_unknown_format']} "
        f"failures={stats['failed']}"
    )
    if args.dry_run:
        summary += f" dry_run_only={stats['dry_run']}"
    print(summary)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
