"""Bake the former sRGB SVG palette filters once, never during map gestures.

Requires Pillow and NumPy. Keeps the existing 2048-square source raster and its
projection unchanged. This is a color transform, not new cartographic detail.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'public/assets/geography-2020/clean-basemap-v8.webp'
DEST = ROOT / 'public/assets/geography-2020/dossier-v8'
PALETTES = {
    'carmine': ('#050305', '#211117', '#b9a79d', '#463039', '#ff285c'),
    'ultraviolet': ('#040307', '#1d1725', '#b6adbe', '#382d40', '#c86bf0'),
    'amber': ('#040604', '#1e2119', '#b4b7a4', '#373d2f', '#ffc663'),
    'maelstrom': ('#030404', '#222323', '#b0b2ad', '#393d39', '#ff3948'),
    'original': ('#02070b', '#17242a', '#9cafac', '#34464a', '#f2154e'),
}

def rgb(value):
    return np.array([int(value[i:i+2], 16) for i in (1, 3, 5)], dtype=np.float32) / 255

source = np.asarray(Image.open(SOURCE).convert('RGB'), dtype=np.float32) / 255
r, g, b = (source[:, :, i] for i in range(3))
# feColorMatrix(saturate=0), inverse transfer, then gamma exponent 1.8.
line_alpha = np.clip(1 - (.213*r + .715*g + .072*b), 0, 1) ** 1.8
park_alpha = np.clip(-4*r + 4*g - .08, 0, 1)
land_alpha = np.clip(20*r + 20*g - 40*b + 1.5, 0, 1)
route_alpha = np.clip(5*r - 5*g - 1.75, 0, 1)

def over(front, alpha, back):
    return front * alpha[:, :, None] + back * (1-alpha[:, :, None])

DEST.mkdir(parents=True, exist_ok=True)
outputs = []
for name, colors in PALETTES.items():
    water, land, line, park, route = map(rgb, colors)
    drawing = over(line, line_alpha, land)
    drawing = over(park, park_alpha, drawing)
    drawing = over(drawing, land_alpha, water)
    drawing = over(route, route_alpha, drawing)
    output = DEST / (name + '.webp')
    Image.fromarray(np.uint8(np.rint(np.clip(drawing, 0, 1)*255))).save(output, lossless=True, method=6)
    outputs.append({'path': str(output.relative_to(ROOT/'public')), 'width': source.shape[1], 'height': source.shape[0], 'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()})
manifest = {'source': str(SOURCE.relative_to(ROOT/'public')), 'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'operation': 'precomputed-sRGB-palette-no-new-geometry', 'outputs': outputs}
(ROOT/'qa/dossier-basemap-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(json.dumps(manifest, indent=2))
