# Geocities Portfolio

If AI can only generate slop, best you can do is lean into it

## Preview locally
Open `index.html` in any browser. We don't `npm` around here.

## Add more photos

If you plan to regenerate thumbnails, install Pillow first:

```
python3 -m venv venv
source venv/bin/activate
python -m pip install -r requirements.txt
```

1. Copy your new image files into the `photos/` directory.
2. Ensure python enviornment is setup (see dependency install)
3. Run `./update_images.sh`