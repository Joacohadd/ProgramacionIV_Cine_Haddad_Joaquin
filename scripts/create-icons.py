"""Genera los PNG del icono PWA a partir de la marca vectorial simple."""

from pathlib import Path
from PIL import Image, ImageDraw

PUBLIC = Path(__file__).resolve().parents[1] / "public"


def crear_icono(size: int) -> None:
    scale = 4
    canvas = size * scale
    image = Image.new("RGB", (canvas, canvas), "#111710")
    draw = ImageDraw.Draw(image)
    center = canvas / 2
    radius = canvas * 0.28
    points = [
        (center, center - radius),
        (center + radius, center),
        (center, center + radius),
        (center - radius, center),
        (center, center - radius),
    ]
    draw.line(points, fill="#f0e9d9", width=int(canvas * 0.026), joint="curve")
    spot = canvas * 0.105
    draw.ellipse(
        (center - spot, center - spot, center + spot, center + spot),
        fill="#dc7350",
    )
    image.resize((size, size), Image.Resampling.LANCZOS).save(PUBLIC / f"icon-{size}.png")


for dimension in (192, 512):
    crear_icono(dimension)
