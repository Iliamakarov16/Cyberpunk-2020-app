"""Register the supplied 2560x2012 map in the unchanged v7 source frame.

Only the existing annotation-cleanup windows reuse the prior cleaned raster.
No geometry, district masks, POIs, or stored campaign coordinates are modified.
"""
from pathlib import Path
import hashlib
import json
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT/'public'
ASSETS = PUBLIC/'assets/geography-2020'
world = json.loads((PUBLIC/'world-data.json').read_text())
cleanup = json.loads((ROOT/'docs/geography/cleanup-regions.json').read_text())
source = Image.open(ASSETS/'draken-original-v8.jpg').convert('RGB')
assert source.size == (2560, 2012)
projection = world['projection']
scale, offset = projection['scale'], projection['offsetX']
size = 2048
output_scale = size/1024
# Preserve the original 1536x1207 frame exactly, including its small aspect
# difference from the newly supplied image. This is a fixed registration,
# not a new georeference and not a warp of district plans.
sx, sy = source.width/1536, source.height/1207
inverse = (sx/(scale*output_scale), 0, (442-offset/scale)*sx,
           0, sy/(scale*output_scale), 0)
printed = source.transform((size, size), Image.Transform.AFFINE, inverse,
                           resample=Image.Resampling.BICUBIC, fillcolor='#0a1c2a')
# The left legend must not enter the map; use the exact existing crop.
draw = ImageDraw.Draw(printed)
draw.rectangle((0, 0, offset*output_scale-1, size), fill='#0a1c2a')
draw.rectangle(((offset+(1536-442)*scale)*output_scale, 0, size, size), fill='#0a1c2a')
mask = Image.new('L', (size, size))
draw = ImageDraw.Draw(mask)
for region in cleanup['regions']:
    x, y, x1, y1 = region['bbox']
    draw.rectangle(((offset+(x-442)*scale)*output_scale, y*scale*output_scale,
                    (offset+(x1-442)*scale)*output_scale, y1*scale*output_scale), fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(.65*scale*output_scale))
previous_clean = Image.open(ASSETS/'clean-basemap-v7.webp').convert('RGB')
assert previous_clean.size == printed.size
clean = Image.composite(previous_clean, printed, mask)
printed.save(ASSETS/'print-basemap-v8.webp', lossless=True, method=6)
clean.save(ASSETS/'clean-basemap-v8.webp', lossless=True, method=6)
report = {
    'source': 'assets/geography-2020/draken-original-v8.jpg',
    'sourceUrl': 'https://pd57k0blcbk.preview.infomaniak.website/wp-content/uploads/2024/09/NIGHT-CITY-WCBK-2020-scaled.jpg',
    'sourceSha256': hashlib.sha256((ASSETS/'draken-original-v8.jpg').read_bytes()).hexdigest(),
    'sourceDimensions': list(source.size),
    'sourceFramePreserved': [1536, 1207], 'cropPreserved': projection['crop'],
    'projectionPreserved': projection,
    'effectiveSourceCrop': [round(1094*sx), source.height],
    'worldUnitsPerSourcePixel': 1024/source.height,
    'annotationWindowsReused': len(cleanup['regions']),
    'limitation': 'Existing cleanup windows retain their previous lower-resolution detail. This source has 1.667x more pixels per axis; no new streets or district boundaries were generated.',
}
(ROOT/'qa/overview-v8-registration.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
