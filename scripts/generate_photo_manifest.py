#!/usr/bin/env python3
"""Generate gallery manifest files consumed by the frontend."""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PHOTOS_DIR = REPO_ROOT / "photos"
THUMBNAILS_DIR = REPO_ROOT / "thumbnails"
OPTIMIZED_DIR = REPO_ROOT / "optimized"
JSON_OUTPUT_FILE = PHOTOS_DIR / "photos.json"
JS_OUTPUT_FILE = PHOTOS_DIR / "photos.js"
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff"}


def iter_photo_files(directory: Path):
    def sort_key(path: Path) -> str:
        try:
            relative = path.relative_to(directory)
        except ValueError:
            relative = path
        return relative.as_posix().lower()

    for path in sorted(directory.rglob("*"), key=sort_key):
        if path.is_file() and path.suffix.lower() in ALLOWED_EXTENSIONS:
            yield path


def friendly_title(stem: str) -> str:
    cleaned = re.sub(r"[_\-]+", " ", stem).strip()
    if not cleaned:
        return stem
    return cleaned.title()


def build_manifest() -> tuple[list[dict], list[str], list[str]]:
    entries: list[dict] = []
    missing_thumbs: list[str] = []
    missing_optimised: list[str] = []

    for file in iter_photo_files(PHOTOS_DIR):
        relative_path = file.relative_to(PHOTOS_DIR)
        relative_str = relative_path.as_posix()
        filename = relative_path.name
        raw_rel = f"photos/{relative_str}"

        optimised_candidate = OPTIMIZED_DIR / relative_path
        if optimised_candidate.exists():
            full_rel = f"optimized/{relative_str}"
        else:
            full_rel = raw_rel
            missing_optimised.append(relative_str)

        thumbnail_path = THUMBNAILS_DIR / relative_path
        if thumbnail_path.exists():
            thumb_rel = f"thumbnails/{relative_str}"
        else:
            thumb_rel = full_rel
            missing_thumbs.append(relative_str)

        entries.append(
            {
                "filename": filename,
                "full": full_rel,
                "thumb": thumb_rel,
                "download": raw_rel,
                "title": friendly_title(file.stem),
                "directory": relative_path.parent.as_posix() if relative_path.parent != Path('.') else "",
            }
        )

    return entries, missing_thumbs, missing_optimised


def write_outputs(manifest: list[dict]) -> None:
    json_payload = json.dumps(manifest, indent=2)
    JSON_OUTPUT_FILE.write_text(json_payload + "\n", encoding="utf-8")
    JS_OUTPUT_FILE.write_text(f"window.__PHOTO_MANIFEST__ = {json_payload};\n", encoding="utf-8")


def main() -> None:
    manifest, missing_thumbs, missing_optimised = build_manifest()
    write_outputs(manifest)

    message = (
        f"Generated {JSON_OUTPUT_FILE} & {JS_OUTPUT_FILE} with {len(manifest)} image"
        f"{'s' if len(manifest) != 1 else ''}."
    )
    if missing_thumbs:
        message += (
            " Missing thumbnails for: " + ", ".join(missing_thumbs) +
            ". Run scripts/generate_thumbnails.py and rerun this script to create them."
        )
    if missing_optimised:
        message += (
            " Missing optimised copies for: " + ", ".join(missing_optimised) +
            ". Run scripts/optimize_raw_images.py to populate optimized/."
        )
    print(message)


if __name__ == "__main__":
    main()
