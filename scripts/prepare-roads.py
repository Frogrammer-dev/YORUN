"""Import the official South Korea OSM extract into a local spatial road database."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import urllib.request
import osmium

p = argparse.ArgumentParser()
p.add_argument('--date', default='261009', help='Geofabrik extract date YYMMDD')
p.add_argument('--data-dir', default='data/roads')
args = p.parse_args()
root = Path(args.data_dir).resolve()
root.mkdir(parents=True, exist_ok=True)
name = f'south-korea-{args.date}.osm.pbf'
url = 'https://download.geofabrik.de/asia/' + name
source = root / name
expected = urllib.request.urlopen(url + '.md5', timeout=60).read().decode().split()[0]
if not source.exists() or hashlib.file_digest(source.open('rb'), 'md5').hexdigest() != expected:
    temporary = source.with_suffix('.download')
    with urllib.request.urlopen(url, timeout=120) as response, temporary.open('wb') as output:
        count = 0
        while chunk := response.read(4 * 1024 * 1024):
            output.write(chunk)
            count += len(chunk)
            print(f'Downloaded {count // 1048576} MiB', flush=True)
    with temporary.open('rb') as downloaded:
        if hashlib.file_digest(downloaded, 'md5').hexdigest() != expected:
            raise RuntimeError('Source checksum mismatch')
    os.replace(temporary, source)
# libosmium's Windows file API needs an ASCII relative path in Unicode workspaces.
os.chdir(root)
with osmium.io.Reader(source.name) as reader:
    timestamp = reader.header().get('osmosis_replication_timestamp')
if not timestamp:
    raise RuntimeError('Source data timestamp missing')
filename = f'roads-{args.date}-{expected[:8]}.sqlite'
if (root / filename).exists() and (root / 'manifest.json').exists():
    installed = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    if installed.get('file') == filename:
        with sqlite3.connect(f'file:{filename}?mode=ro', uri=True) as existing:
            if existing.execute('PRAGMA quick_check').fetchone()[0] == 'ok':
                print('This verified extract is already installed', flush=True)
                sys.exit(0)
temp = root / (filename + '.building')
if temp.exists():
    temp.unlink()
db = sqlite3.connect(temp)
db.executescript('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; CREATE TABLE ways(id INTEGER PRIMARY KEY, geometry TEXT NOT NULL, tags TEXT NOT NULL); CREATE VIRTUAL TABLE bounds USING rtree(id,min_lon,max_lon,min_lat,max_lat); CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);')
kinds = set('footway path pedestrian living_street residential service unclassified track cycleway tertiary tertiary_link secondary secondary_link primary primary_link steps'.split())

class Roads(osmium.SimpleHandler):
    count = 0

    def way(self, way):
        if way.tags.get('highway') not in kinds or way.tags.get('area') == 'yes':
            return
        if len(way.nodes) < 2 or any(not n.location.valid() for n in way.nodes):
            return
        geometry = [[n.ref, n.lat, n.lon] for n in way.nodes]
        tags = dict(way.tags)
        db.execute('INSERT INTO ways VALUES (?,?,?)', (way.id, json.dumps(geometry, separators=(',', ':')), json.dumps(tags, ensure_ascii=False, separators=(',', ':'))))
        db.execute('INSERT INTO bounds VALUES (?,?,?,?,?)', (way.id, min(n[2] for n in geometry), max(n[2] for n in geometry), min(n[1] for n in geometry), max(n[1] for n in geometry)))
        self.count += 1
        if self.count % 20000 == 0:
            db.commit()
            print(f'Imported {self.count} roads', flush=True)

handler = Roads()
handler.apply_file(source.name, locations=True, idx='flex_mem')
metadata = {'schema': '1', 'timestamp': timestamp, 'source': url, 'checksum': expected, 'ways': str(handler.count), 'region': 'South Korea'}
db.executemany('INSERT INTO metadata VALUES (?,?)', metadata.items())
db.commit()
if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
    raise RuntimeError('Database integrity check failed')
db.close()
os.replace(temp, root / filename)
manifest = root / 'manifest.json.tmp'
manifest.write_text(json.dumps({'file': filename, **metadata}, indent=2), encoding='utf-8')
os.replace(manifest, root / 'manifest.json')
print(json.dumps({'file': filename, **metadata}), flush=True)
