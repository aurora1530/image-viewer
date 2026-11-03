"""Generate desktop and Web icons from a source PNG. Requires Python 3 and Pillow."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "design" / "app-icon" / "source.png"


def main():
    with Image.open(SOURCE) as source:
        artwork = source.convert("RGBA")
    # Remove nearly transparent pixels before calculating the artwork bounds.
    alpha = artwork.getchannel("A").point(lambda value: 0 if value <= 8 else value)
    artwork.putalpha(alpha)
    bounds = alpha.getbbox()
    if bounds is None:
        raise ValueError("Icon source is fully transparent")
    artwork = artwork.crop(bounds)

    # Use the same centered silhouette and safe margin for every export.
    artwork.thumbnail((880, 880), Image.Resampling.LANCZOS)
    master = Image.new("RGBA", (1024, 1024))
    master.alpha_composite(artwork, ((1024 - artwork.width) // 2, (1024 - artwork.height) // 2))
    build = ROOT / "build"
    public = ROOT / "public"
    build.mkdir(exist_ok=True)
    public.mkdir(exist_ok=True)
    master.save(build / "icon.png")
    master.save(build / "icon.ico", sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)])
    master.save(build / "icon.icns", sizes=[(n, n) for n in (16, 32, 64, 128, 256, 512, 1024)])
    master.save(public / "favicon.ico", sizes=[(n, n) for n in (16, 32, 48)])
    master.resize((32, 32), Image.Resampling.LANCZOS).save(public / "favicon-32.png")
    # Touch icons have an opaque background; the OS supplies the outer mask.
    touch = Image.new("RGBA", (1024, 1024), "#1c1c1e")
    touch.alpha_composite(master)
    touch.convert("RGB").resize((180, 180), Image.Resampling.LANCZOS).save(
        public / "apple-touch-icon.png"
    )
    print("Generated desktop and Web icons from design/app-icon/source.png")


if __name__ == "__main__":
    main()
