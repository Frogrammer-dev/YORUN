"""Render frozen source roads and latest actual routes for visual diagnosis only."""
import json
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw

root = Path.cwd()
area = sys.argv[sys.argv.index('--area') + 1] if '--area' in sys.argv else 'gwangalli'
if area not in ('gwangalli', 'seomyeon', 'gangnam'):
    raise ValueError('Unknown frozen area')
roads = json.loads((root / f'eval/recognition/llm-routes-20261010/{area}-roads.json').read_text(encoding='utf-8'))
results = json.loads((root / 'eval/recognition/route-improvement/offline-cascade-20261013/results.json').read_text(encoding='utf-8'))
points = {e['id']: (e['lat'], e['lon']) for e in roads['elements'] if e['type'] == 'node'}
ways = [e for e in roads['elements'] if e['type'] == 'way']
filtered = '--filtered' in sys.argv
if filtered:
    graph = json.loads((root / f'reports/route-improvement-20261012/{area}-filtered-graph.json').read_text(encoding='utf-8'))
    points = dict(enumerate(graph['nodes']))
    ways = [{'nodes': edge} for edge in graph['edges']]
rows = [next(r for r in results['cases'] if r['caseId'] == area + '-' + s) for s in ('square', 'heart', 'cat')]
image = Image.new('RGB', (1560, 640), 'white')
draw = ImageDraw.Draw(image)
for panel, row in enumerate(rows):
    b = row['bbox']; offset = panel * 520
    width_m = (b['east'] - b['west']) * math.cos(math.radians((b['north'] + b['south']) / 2))
    height_m = b['north'] - b['south']; factor = min(470 / width_m, 540 / height_m)
    width, height = width_m * factor, height_m * factor
    left, top = offset + (520 - width) / 2, 52 + (540 - height) / 2
    def xy(latlon):
        lat, lon = latlon
        return left + (lon - b['west']) * math.cos(math.radians((b['north'] + b['south']) / 2)) * factor, top + (b['north'] - lat) * factor
    draw.rectangle((left, top, left + width, top + height), outline='#bbbbbb')
    for way in ways:
        line = [xy(points[n]) for n in way.get('nodes', []) if n in points]
        if len(line) > 1:
            # Crop to panel bounds; source roads include graph-excluded edges.
            layer = Image.new('RGBA', image.size)
            layer_draw = ImageDraw.Draw(layer)
            layer_draw.line(line, fill='#dddddd', width=1)
            cropped = layer.crop((int(left), int(top), int(left + width + 1), int(top + height + 1)))
            image.paste(cropped, (int(left), int(top)), cropped)
    draw = ImageDraw.Draw(image)
    route = [xy(p) for p in row['candidate']['latlngs']]
    draw.line(route, fill='#e96b20', width=4)
    x, y = route[0]; draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill='#173c67')
    draw.text((offset + 20, 18), f"{row['caseId']} | score {row['candidate']['similarity']}", fill='black')
legend = 'Gray: actual filtered simple graph; steps excluded.' if filtered else 'Gray: frozen source ways (includes graph-excluded edges).'
draw.text((20, 612), 'Orange: validated real route. ' + legend + ' Blue: current start. No score/route changes.', fill='black')
filename = f'{area}-filtered-road-diagnostic.png' if filtered else f'{area}-road-diagnostic.png'
destination = root / 'reports/route-improvement-20261012' / filename
image.save(destination)
print(destination)
