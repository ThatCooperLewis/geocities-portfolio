#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_BIN="$ROOT_DIR/venv/bin"
THUMB_SCRIPT="$ROOT_DIR/scripts/generate_thumbnails.py"
MANIFEST_SCRIPT="$ROOT_DIR/scripts/generate_photo_manifest.py"
OPTIMIZE_SCRIPT="$ROOT_DIR/scripts/optimize_raw_images.py"

if [[ ! -x "$VENV_BIN/python" ]];
then
  echo "Virtualenv python not found at $VENV_BIN/python" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$VENV_BIN/activate"

echo "### Optimizing raw images... "
python "$OPTIMIZE_SCRIPT"
echo "### Generating low-res thumbnails..."
python "$THUMB_SCRIPT" "$@"
echo "### Building directory manifest"
python "$MANIFEST_SCRIPT"
