#!/usr/bin/env python3
"""Generate manifest + album pages for shared albums."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import zipfile

REPO_ROOT = Path(__file__).resolve().parent.parent
SHARED_ROOT = REPO_ROOT / "shared-albums"
PUBLIC_ALBUM_DIR = REPO_ROOT / "albums"
TEMPLATE_PATH = PUBLIC_ALBUM_DIR / "_album-template.html"
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"}
DEFAULT_DESCRIPTION = "Private gallery for friends and family. Please keep this link to yourself."
DEFAULT_SHARE_TEXT = "Tap Save to add these photos to your camera roll."


def load_template() -> str:
    if not TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"Album template missing: {TEMPLATE_PATH}")
    return TEMPLATE_PATH.read_text(encoding="utf-8")


def load_metadata(album_dir: Path) -> dict:
    metadata_file = album_dir / "album.json"
    if metadata_file.exists():
        return json.loads(metadata_file.read_text(encoding="utf-8"))
    return {}


def friendly_title(slug: str) -> str:
    return slug.replace("-", " ").replace("_", " ").title()


def iter_album_files(album_dir: Path):
    for path in sorted(album_dir.iterdir()):
        if not path.is_file():
            continue
        if path.suffix.lower() not in ALLOWED_EXTENSIONS:
            continue
        yield path


def normalized_value(mapping: dict, key: str):
    value = mapping.get(key)
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return None
    return value


def build_manifest(album_dir: Path) -> dict:
    slug = album_dir.name
    metadata = load_metadata(album_dir)
    download_prefix = normalized_value(metadata, "downloadPrefix") or slug
    title = normalized_value(metadata, "title") or friendly_title(slug)
    description = normalized_value(metadata, "description") or DEFAULT_DESCRIPTION
    share_text = normalized_value(metadata, "shareText") or DEFAULT_SHARE_TEXT
    files = []
    for index, path in enumerate(iter_album_files(album_dir), start=1):
        rel_path = Path("shared-albums") / slug / path.name
        suffix = path.suffix.lower()
        download_name = f"{download_prefix}-{index:02d}{suffix}" if download_prefix else path.name
        files.append(
            {
                "filename": path.name,
                "src": rel_path.as_posix(),
                "downloadName": download_name,
            }
        )

    manifest = {
        "slug": slug,
        "title": title,
        "description": description,
        "shareText": share_text,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "downloadArchive": normalized_value(metadata, "downloadArchive"),
        "files": files,
    }
    if not manifest["downloadArchive"]:
        manifest["downloadArchive"] = f"shared-albums/{slug}.zip" if files else None
    return manifest


def write_manifest(album_dir: Path, manifest: dict) -> Path:
    output_path = album_dir / "manifest.json"
    output_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return output_path


def build_zip(album_dir: Path, manifest: dict, *, skip_zip: bool) -> Path | None:
    if skip_zip:
        return None
    if not manifest.get("files"):
        return None
    archive_path = SHARED_ROOT / f"{album_dir.name}.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for file_entry in manifest["files"]:
            source = album_dir / file_entry["filename"]
            arcname = file_entry.get("downloadName") or file_entry["filename"]
            archive.write(source, arcname)
    return archive_path


def ensure_page(slug: str, template: str, skip_pages: bool) -> Path | None:
    if skip_pages:
        return None
    target_dir = PUBLIC_ALBUM_DIR / slug
    target_dir.mkdir(parents=True, exist_ok=True)
    contents = template.replace("{{ALBUM_SLUG}}", slug)
    target_file = target_dir / "index.html"
    target_file.write_text(contents, encoding="utf-8")
    return target_file


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build manifests + client pages for shared albums.")
    parser.add_argument("slugs", nargs="*", help="Album slugs to build. Defaults to every directory in shared-albums.")
    parser.add_argument("--skip-zip", action="store_true", help="Do not generate zipped archives.")
    parser.add_argument("--skip-pages", action="store_true", help="Do not update the public album HTML files.")
    return parser.parse_args(argv)


def select_album_dirs(slugs: list[str]) -> list[Path]:
    if slugs:
        return [SHARED_ROOT / slug for slug in slugs]
    return [path for path in SHARED_ROOT.iterdir() if path.is_dir()]


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not SHARED_ROOT.exists():
        print(f"Shared album directory missing: {SHARED_ROOT}", file=sys.stderr)
        return 1
    album_dirs = select_album_dirs(args.slugs)
    missing = [slug for slug in args.slugs if slug and not (SHARED_ROOT / slug).exists()]
    for slug in missing:
        print(f"Skipping unknown album '{slug}'", file=sys.stderr)
    album_dirs = [path for path in album_dirs if path.exists()]
    if not album_dirs:
        print("No shared albums found.", file=sys.stderr)
        return 1

    template = load_template() if not args.skip_pages else ""

    for album_dir in album_dirs:
        manifest = build_manifest(album_dir)
        manifest_path = write_manifest(album_dir, manifest)
        zip_path = build_zip(album_dir, manifest, skip_zip=args.skip_zip)
        page_path = ensure_page(album_dir.name, template, args.skip_pages)
        print(f"Built {manifest_path}")
        if zip_path:
            print(f"  ↳ Updated archive {zip_path}")
        if page_path:
            print(f"  ↳ Updated page   {page_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
