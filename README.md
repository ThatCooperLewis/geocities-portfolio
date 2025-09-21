# Geocities Portfolio

A lovingly tacky, old-school photo gallery built entirely with HTML and CSS.

## What's inside
- `index.html` — the main page with marquee banner, neon borders, and dynamically generated gallery slots.
- `styles/layout.css` — shared layout styles that keep everything feeling properly Geocities.
- `styles/theme-blue.css` — default “Basement Jazz” palette.
- `styles/theme-neon.css` — midnight neon palette.
- `styles/theme-sepia.css` — toasted sepia throwback palette.
- `styles/theme-sunny.css` — original bright pink/yellow throwback palette.
- `main.js` — discovers images and wires up the big-click lightbox.
- `photos/photos.js` & `photos/photos.json` — generated manifests the page reads to populate images.
- `thumbnails/` — auto-generated web-friendly versions of the originals.
- `scripts/generate_photo_manifest.py` — helper to rebuild the gallery manifest when you add photos.
- `scripts/generate_thumbnails.py` — creates optimized thumbnails in `thumbnails/`.
- `photos/` — drop your JPEGs (or other images) here.

## Preview locally
Open `index.html` in any browser. For the full Geocities nostalgia hit, resize your window down to 800×600.

## Add more photos
1. Copy your new image files into the `photos/` directory.
2. (Optional but recommended) Create fresh thumbnails with `python3 scripts/generate_thumbnails.py`.
3. Run `python3 scripts/generate_photo_manifest.py` to refresh both `photos/photos.json` and `photos/photos.js`.
4. Reload the page — the gallery pulls from the manifest and updates automatically.

If you host the site on a server that exposes directory listings, the gallery can fall back to auto-detecting files without the manifest, but the JSON keeps things reliable across setups.

> Huge source photos are fine — the thumbnail script bumps Pillow's decompression
> limit so you won't hit `DecompressionBombError` for high-megapixel shots.

## Gallery controls
Open any thumbnail to launch the lightbox, then use the neon arrow buttons or the ←/→ keys to cruise through the photo set. Press Esc to bail out.

## Theme switcher
Radio buttons near the bottom let visitors swap between Basement Jazz (default), Midnight Neon, Sepia Sunburst, or GeoGlitz Classic. Selections persist locally, so pick your favorite vibe and it sticks.

## Dependency install
If you plan to regenerate thumbnails, install Pillow first:

```
python3 -m pip install -r requirements.txt
```

## Contact link
The “Sign the Guestbook” link uses `mailto:`. Swap the address in `index.html` if you’d like to point it somewhere else.
