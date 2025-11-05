#!/usr/bin/env python3
"""Generate gallery manifest files consumed by the frontend."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Mapping

try:
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = max(getattr(Image, "MAX_IMAGE_PIXELS", 0) or 0, 1_000_000_000)
except ImportError:  # pragma: no cover - Pillow is optional but recommended
    Image = None  # type: ignore[assignment]

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


def decode_bytes(value: bytes) -> str:
    for encoding in ("utf-8", "latin-1"):
        try:
            return value.decode(encoding).strip()
        except UnicodeDecodeError:
            continue
    return value.decode("utf-8", errors="ignore").strip()


def parse_iptc(payload: bytes) -> Mapping[tuple[int, int], list[str]]:
    results: dict[tuple[int, int], list[str]] = {}
    index = 0
    limit = len(payload)

    while index + 5 <= limit:
        if payload[index] != 0x1C:
            index += 1
            continue

        record = payload[index + 1]
        dataset = payload[index + 2]
        index += 3

        if index + 2 > limit:
            break
        size = (payload[index] << 8) | payload[index + 1]
        index += 2

        if size & 0x8000:
            if index + 2 > limit:
                break
            size = ((size & 0x7FFF) << 16) | (payload[index] << 8) | payload[index + 1]
            index += 2

        if size <= 0 or index + size > limit:
            break

        raw = payload[index : index + size]
        index += size

        if not raw:
            continue

        text = decode_bytes(raw)
        key = (record, dataset)
        results.setdefault(key, []).append(text)

    return results


def extract_from_iptc(info: Mapping[int, bytes] | bytes | None) -> tuple[str | None, str | None]:
    if not info:
        return None, None
    if isinstance(info, (bytes, bytearray)):
        payload = bytes(info)
    else:
        payload = info.get(0x0404)  # IPTC-NAA record
    if not payload:
        return None, None

    fields = parse_iptc(payload)

    def first(record: int, dataset: int) -> str | None:
        values = fields.get((record, dataset))
        if not values:
            return None
        for value in values:
            if value:
                return value
        return None

    headline = first(2, 105) or first(2, 5)
    description = first(2, 120)
    return headline, description


def extract_lang_alt(element, namespaces) -> str | None:
    if element is None:
        return None
    candidates = element.findall("rdf:Alt/rdf:li", namespaces) or element.findall("rdf:Seq/rdf:li", namespaces)
    if not candidates:
        candidates = element.findall("rdf:li", namespaces)
    preferred = None
    for node in candidates:
        lang = node.attrib.get("{http://www.w3.org/XML/1998/namespace}lang", "").lower()
        text = (node.text or "").strip()
        if not text:
            continue
        if lang in ("x-default", "en-us", "en"):
            return text
        if preferred is None:
            preferred = text
    return preferred


def extract_from_xmp(blob: bytes) -> tuple[str | None, str | None]:
    from xml.etree import ElementTree as ET

    try:
        root = ET.fromstring(blob)
    except ET.ParseError:
        return None, None

    namespaces = {
        "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
        "dc": "http://purl.org/dc/elements/1.1/",
        "photoshop": "http://ns.adobe.com/photoshop/1.0/",
    }

    headline_value = None
    description_value = None
    title_value = None

    for description in root.findall(".//rdf:Description", namespaces):
        if headline_value is None:
            headline_attr = description.attrib.get("{http://ns.adobe.com/photoshop/1.0/}Headline")
            if headline_attr:
                headline_attr = headline_attr.strip()
                if headline_attr:
                    headline_value = headline_attr
        if description_value is None:
            desc_element = description.find("dc:description", namespaces)
            candidate = extract_lang_alt(desc_element, namespaces)
            if candidate:
                description_value = candidate
        if title_value is None:
            title_element = description.find("dc:title", namespaces)
            candidate = extract_lang_alt(title_element, namespaces)
            if candidate:
                title_value = candidate

    return headline_value or title_value, description_value


def extract_metadata(path: Path) -> tuple[str | None, str | None]:
    if Image is None:
        return None, None

    try:
        with Image.open(path) as image:
            photoshop_info = {}
            if isinstance(image.info.get("photoshop"), dict):
                photoshop_info = image.info["photoshop"]  # type: ignore[assignment]
            iptc_source: Mapping[int, bytes] | bytes | None = photoshop_info
            if not iptc_source and image.info.get("iptc"):
                iptc_source = image.info["iptc"]
            headline, description = extract_from_iptc(iptc_source)

            if (headline is None or description is None) and image.info.get("xmp"):
                xmp_headline, xmp_description = extract_from_xmp(image.info["xmp"])
                if headline is None:
                    headline = xmp_headline
                if description is None:
                    description = xmp_description

            return headline or None, description or None
    except Exception as exc:  # pragma: no cover - safety net for unexpected files
        print(f"Warning: failed to read metadata from {path}: {exc}", file=sys.stderr)
        return None, None


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

        headline, description = extract_metadata(file)
        title = headline or friendly_title(file.stem)

        entries.append(
            {
                "filename": filename,
                "full": full_rel,
                "thumb": thumb_rel,
                "download": raw_rel,
                "title": title,
                "description": description or "",
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
