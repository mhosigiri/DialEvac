"""Builds an illustrative creek-flood layer for the Floodplain map.

Method (HAND, "height above nearest drainage"):
  1. Named, open OSM creeks/rivers (waterway=stream|river with a name, no tunnel) in the area, from Overpass  -> rasterised onto a z14 grid.
  2. USGS 3DEP elevation from AWS Terrarium tiles at z14 (~8 m/px here).
  3. For every pixel: nearest waterway pixel (Euclidean), HAND = elevation - waterway elevation
     (waterway elevation = 5x5 minimum, so a slightly misplaced line still sits in the channel).
  4. Pixels farther than MAX_DIST_M from any waterway get HAND = 60 m, so they can never flood.
  5. HAND is written as Terrarium-encoded PNG tiles (z12-14) in tiles/flood/, which MapLibre reads as a
     raster-dem source. A color-relief layer then paints water where HAND < the animated water level.
  6. assets/flood.js gets per-household HAND + the tile bounds.

This is an illustration, not a hydraulic model (no flow routing, no culverts, no rainfall).
Run from outputs/floodplain-map:   python3 tools/build_flood.py <cache_dir>
"""
import io, json, math, os, sys, urllib.request, urllib.parse
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.cache')
os.makedirs(CACHE, exist_ok=True)
Z = 14
S, W, N, E = 32.93, -96.82, 33.03, -96.68  # area (padded around the households)
MAX_DIST_M = 450
UA = {'User-Agent': 'haven-map-prototype/0.1'}

def tile_xy(lon, lat, z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n

# z14 tile range aligned to z12 (multiples of 4) so z12/z13 tiles can be built by 2x2 averaging
x0, y0 = tile_xy(W, N, Z); x1, y1 = tile_xy(E, S, Z)
tx0, ty0 = int(x0) // 4 * 4, int(y0) // 4 * 4
tx1, ty1 = (int(x1) // 4 + 1) * 4 - 1, (int(y1) // 4 + 1) * 4 - 1
nx, ny = tx1 - tx0 + 1, ty1 - ty0 + 1
print('z14 tiles', tx0, ty0, tx1, ty1, f'({nx}x{ny})')

def fetch(url, path):
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r, open(path, 'wb') as f: f.write(r.read())
    return path

# ---- 1. DEM ----
dem = np.zeros((ny * 256, nx * 256), dtype=np.float32)
for ty in range(ty0, ty1 + 1):
    for tx in range(tx0, tx1 + 1):
        p = fetch(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png', os.path.join(CACHE, f'dem_{Z}_{tx}_{ty}.png'))
        a = np.asarray(Image.open(p).convert('RGB'), dtype=np.float32)
        dem[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
print('DEM', dem.shape, 'range', dem.min(), dem.max())

# ---- 2. waterways ----
wpath = os.path.join(CACHE, 'waterways.json')
if not os.path.exists(wpath):
    q = f'[out:json][timeout:90];way["waterway"~"^(stream|river|canal|drain|ditch)$"]({S - .02},{W - .02},{N + .02},{E + .02});out geom;'
    req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data': q}).encode(), headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r, open(wpath, 'wb') as f: f.write(r.read())
ways = [w for w in json.load(open(wpath))['elements']  # named, open (not culverted) creeks and rivers only
        if w['tags'].get('waterway') in ('stream', 'river') and 'name' in w['tags'] and 'tunnel' not in w['tags']]
print('waterways', len(ways))
stream = np.zeros(dem.shape, dtype=bool)
def to_px(lon, lat):
    x, y = tile_xy(lon, lat, Z)
    return (x - tx0) * 256, (y - ty0) * 256
for w in ways:
    g = w.get('geometry') or []
    for a, b in zip(g, g[1:]):
        (ax, ay), (bx, by) = to_px(a['lon'], a['lat']), to_px(b['lon'], b['lat'])
        n = int(max(abs(bx - ax), abs(by - ay)) * 2) + 1
        xs = np.linspace(ax, bx, n).astype(int); ys = np.linspace(ay, by, n).astype(int)
        ok = (xs >= 0) & (xs < dem.shape[1]) & (ys >= 0) & (ys < dem.shape[0])
        stream[ys[ok], xs[ok]] = True
print('stream pixels', int(stream.sum()))

# ---- 3. HAND ----
chan = ndimage.minimum_filter(dem, size=5)           # channel bottom near each stream pixel
dist, (iy, ix) = ndimage.distance_transform_edt(~stream, return_indices=True)
lat_c = (S + N) / 2
m_per_px = 156543.03392 * math.cos(math.radians(lat_c)) / 2 ** Z
hand = dem - chan[iy, ix]
hand = np.clip(hand, 0, 59)
hand[dist * m_per_px > MAX_DIST_M] = 60
hand = ndimage.gaussian_filter(hand, 0.8)            # soften pixel steps; keeps shorelines smooth
print('m/px %.2f' % m_per_px, 'HAND<=2m area km2 %.2f' % ((hand <= 2).sum() * m_per_px ** 2 / 1e6), 'HAND<=4m %.2f' % ((hand <= 4).sum() * m_per_px ** 2 / 1e6))

# ---- 4. tiles ----
def encode(v):
    v = v + 32768.0
    r = np.floor(v / 256); g = np.floor(v - r * 256); b = np.floor((v - r * 256 - g) * 256)
    return np.stack([r, g, b], -1).clip(0, 255).astype(np.uint8)
out = os.path.join(ROOT, 'tiles', 'flood')
count = 0
level = hand
for z in (14, 13, 12):
    k = 2 ** (14 - z); zx0, zy0 = tx0 // k, ty0 // k
    for j in range(level.shape[0] // 256):
        for i in range(level.shape[1] // 256):
            d = os.path.join(out, str(z), str(zx0 + i)); os.makedirs(d, exist_ok=True)
            Image.fromarray(encode(level[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256])).save(os.path.join(d, f'{zy0 + j}.png'), optimize=True)
            count += 1
    if z > 12: level = level.reshape(level.shape[0] // 2, 2, level.shape[1] // 2, 2).mean(axis=(1, 3))
print('tiles written', count)

# ---- 5. per-household HAND + bounds ----
def lonlat_of(px, py):
    n = 2 ** Z * 256; x = px / n + tx0 / 2 ** Z; y = py / n + ty0 / 2 ** Z
    return x * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y))))
wb, nb = lonlat_of(0, 0); eb, sb = lonlat_of(dem.shape[1], dem.shape[0])
fp = open(os.path.join(ROOT, 'assets', 'footprints.js')).read()
feats = json.loads(fp[fp.index('{'):fp.rindex('}') + 1])['features']
hh = {}
for f in feats:
    p = f['properties']; x, y = to_px(p['lng'], p['lat'])
    hh[p['id']] = round(float(hand[int(y), int(x)]), 2)
vals = sorted(hh.values())
print('household HAND: <=2m', sum(v <= 2 for v in vals), '<=4m', sum(v <= 4 for v in vals), '<=6m', sum(v <= 6 for v in vals), 'of', len(vals))
with open(os.path.join(ROOT, 'assets', 'flood.js'), 'w') as f:
    f.write('// GENERATED by tools/build_flood.py (HAND from USGS 3DEP + OSM waterways). Illustrative, not a flood model.\n')
    f.write("'use strict';\n")
    f.write(f'const FLOOD_BOUNDS = {json.dumps([round(wb + 2e-3, 5), round(sb + 2e-3, 5), round(eb - 2e-3, 5), round(nb - 2e-3, 5)])};  // inset so edge-touching tiles are not requested\n')
    f.write(f'const FLOOD_HAND = {json.dumps(hh)};\n')
print('bounds', wb, sb, eb, nb)
