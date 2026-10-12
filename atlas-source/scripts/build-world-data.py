"""Register the 2020 campaign layer to an independently extracted 2077 map.

Input: NC Zoning Board's subdistricts.json. Output is an authored campaign
adaptation; the original source-book addresses are kept in atlas-data.json.
Requires shapely. Usage: python scripts/build-world-data.py INPUT_DIRECTORY
"""
import json, sys
from pathlib import Path
from shapely.geometry import Polygon, Point, box
from shapely.ops import unary_union, nearest_points

ROOT = Path(__file__).resolve().parents[1]
INPUT = Path(sys.argv[1])
raw = json.loads((INPUT / 'subdistricts.json').read_text())
atlas = json.loads((ROOT / 'public/atlas-data.json').read_text())
legacy = json.loads((ROOT / 'public/streets-data.json').read_text())

def project(p):
    return ((p[0] + 6298) / 12113 * 1024, (4427 - p[1]) / 12111 * 1024)

def geometry(points):
    return Polygon([project(p) for p in points]).buffer(0)

def rings(g):
    if g.is_empty:
        return []
    if g.geom_type == 'Polygon':
        return [[[round(x, 3), round(y, 3)] for x, y in g.exterior.coords]]
    return [p for part in g.geoms if part.geom_type in ('Polygon','MultiPolygon') for p in rings(part)]

def center(g):
    p = g.representative_point()
    return [round(p.x, 3), round(p.y, 3)]

def on_land(p, g):
    p = Point(p)
    if not g.covers(p):
        p = nearest_points(g.buffer(-.5) if not g.buffer(-.5).is_empty else g, p)[0]
    return [round(p.x, 3), round(p.y, 3)]

modern, sub = {}, {}
for d in raw['districts']:
    if d.get('polygon'):
        modern[d['id']] = geometry(d['polygon'])
    for s in d.get('subdistricts', []):
        if s.get('polygon'):
            sub[s['id']] = geometry(s['polygon'])

central = unary_union([modern['city_center'], modern['heywood']])
south = central.intersection(box(0, 446, 1024, 1024))
core = central.difference(south)
outer = {
    'H1': modern['watson'],
    'F1': modern['westbrook'],
    'E1': south,
    'J1': sub['arroyo'],
    'I1': sub['rancho_coronado'],
    'G1': unary_union([modern['pacifica'], modern['dogtown']]),
    'CZ': south.intersection(box(405, 450, 490, 491)),
}

def warp(p):
    # Keep the published order of the old central quarters. This transform is
    # editorial registration, not a claim of surviving buildings in 2077.
    return (310 + p[0] * .16 + p[1] * .05, 290 + p[1] * .155)

colors = {'H1':'#76acbd','F1':'#ac94c9','E1':'#d4a479','J1':'#93b693',
          'I1':'#c2b276','G1':'#c6899d','CZ':'#dc8b77'}
districts = {}
for d in atlas['districts']:
    if d['id'] in legacy['zones']:
        old = legacy['zones'][d['id']]
        g = Polygon([warp(p) for p in old]).buffer(0).intersection(core)
        if g.is_empty or g.area < 1:
            p = on_land(warp([sum(x for x,y in old)/len(old), sum(y for x,y in old)/len(old)]), core)
            g = Point(p).buffer(7).intersection(core)
        label = center(g)
        districts[d['id']] = {'id':d['id'], 'name':d['name'], 'rings':rings(g),
             'center':label,'basis':'campaign-adaptation','region':'central',
             'color':'#90b8bd','sourcePlan':d['id']}
    else:
        g = outer[d['id']]
        districts[d['id']] = {'id':d['id'],'name':d['name'],'rings':rings(g),
             'center':center(g),'basis':'campaign-adaptation','region':d['id'],
             'color':colors[d['id']],'sourcePlan':d['id'] if d['id'] in legacy['plans'] else None}

# A few labels are moved into open parts of their authored regions for legibility.
for key,p in {'H1':[425,165],'F1':[543,296],'E1':[390,470],'J1':[527,460],
              'I1':[554,535],'G1':[355,560],'CZ':[445,473]}.items():
    districts[key]['label'] = on_land(p, outer[key])

macro = [{'id':'central','name':'ЦЕНТРАЛЬНЫЙ ГОРОД','select':'B2','rings':rings(core),
          'center':[364,391],'color':'#88bcc6'}]
for key in ['H1','F1','E1','J1','I1','G1']:
    d=districts[key]
    macro.append({'id':key,'name':d['name'].upper(),'select':key,'rings':d['rings'],
                  'center':d.get('label',d['center']),'color':d['color']})

points = {p['id']:{'point':on_land(warp(p['point']),central),
                   'basis':'registered-source-map','source':'core',
                   'originalPoint':p['point']} for p in atlas['corePlaces']}
world = {
    'version':'3.0.0','width':1024,'height':1024,'defaultBounds':[220,35,445,620],
    'coordinateSystem':'CET-north-up-normalized1024',
    'projection':{'extentCET':[-6298,5815,-7684,4427],
                  'x':'(cetX+6298)/12113*1024','y':'(4427-cetY)/12111*1024'},
    'assets':{'coast':'assets/world/coast.svg','roads':'assets/world/roads.svg',
              'buildingsOverview':'assets/world/buildings-2048.webp',
              'buildingTiles':'assets/world/buildings/{x}-{y}.webp','tileSize':128,
              'tiles':[[int(v) for v in p.stem.split('-')] for p in sorted((ROOT/'public/assets/world/buildings').glob('*.webp'))]},
    'districts':districts,'macroAreas':macro,'points':points,
    'modernDistricts':[{'id':k,'name':next(d['name'] for d in raw['districts'] if d['id']==k),
                        'rings':rings(g),'center':center(g),'basis':'extracted-game-trigger'}
                       for k,g in modern.items() if k not in ('ncx_morro_rock','dogtown')],
    'policy':'Узнаваемая география и дорожная сеть 2077 используются как основа кампании. '
             'Районы и места 2020 размещены редакционно. Такая привязка не является '
             'канонической картой переименования, сохранности зданий или точных адресов. '
             'Адреса и номера проверяются на отдельных опубликованных планах 2020.',
    'sources':[{'title':'Cyberpunk 2077: exported 3D map geometry',
                'url':'https://github.com/nczoning/nc-zoning-board/blob/main/docs/3dmap-asset-reference.md',
                'credit':'© CD PROJEKT RED; export and decoding: NC Zoning Board contributors'},
               {'title':'Night City Sourcebook / Cyberpunk 2020',
                'url':'https://talsorianstore.com/products/night-city','credit':'© R. Talsorian Games'}]
}
out=ROOT/'public/world-data.json'
out.write_text(json.dumps(world,ensure_ascii=False,separators=(',',':')))
(ROOT/'public/world-data.js').write_text('window.NC_WORLD_DATA='+out.read_text()+';\n')
print('Registered',len(districts),'campaign districts and',len(points),'source-map points.')
