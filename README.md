# Geocities Portfolio

Created ~~with immense shame~~ with love, using GPT Codex. 

I haven't looked in `main.js` even once, but I assume it's a nightmare.

You can check it out here: [cooperwebsite.org](https://cooperwebsite.org).

## Preview locally
Open `index.html` in any browser. We don't `npm` around here.

## Add more photos

1. Copy your new image files into the `photos/` directory.
2. Setup python environment with `./setup.sh` (only do this once)
3. Run `./update_portfolio.sh`

## Shared albums (unlisted links)

1. Create a folder inside `shared-albums/` (e.g. `shared-albums/birthday-2025`) and drop the full-size JPGs inside it.
2. (Optional) Add an `album.json` file in that folder to override the title/description/share text. Leave any field blank to keep the generic defaults. Example:
   ```json
   {
     "title": "Birthday 2025",
     "description": "Please keep this private link to yourself.",
     "shareText": "Tap Save to drop these into your Photos app.",
     "downloadPrefix": "birthday-2025"
   }
   ```
3. Run `./scripts/build_shared_album_manifest.py your-slug` to regenerate the manifest, zipped download, and the static page at `albums/your-slug/index.html`. Omit `your-slug` to rebuild every album.
4. Share `https://your-domain/albums/your-slug/` with friends. They'll see the private gallery plus the iPhone-friendly "Add to Photos" button and a `.zip` fallback download.
