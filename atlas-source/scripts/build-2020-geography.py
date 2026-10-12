"""Build registered 2020 overlays, retaining the detailed source-image basemap.

Needs Shapely 2.2. Published address plans remain independent and authoritative.
The Voronoi regions below are explicitly editorial selection masks, not borders.
"""
from pathlib import Path
import json, re, unicodedata, math, html
from shapely import voronoi_polygons
from shapely.geometry import Polygon, MultiPoint, Point, box
from shapely.ops import nearest_points

ROOT = Path(__file__).resolve().parents[1]
PUB = ROOT / 'public'
DOC = ROOT / 'docs/geography'
read = lambda p: json.loads(p.read_text())
old = read(PUB/'world-data.json')
legacy = old.get('legacy', old)
catalog = read(PUB/'atlas-data.json')
plans = read(PUB/'streets-data.json')['plans']
g = read(DOC/'reference-topology.json')
blocks = read(DOC/'reference-blocks.json')['footprints']
locs = read(DOC/'reference-locations.json')
landmarks = read(DOC/'landmark-visibility.json')
scale, ox = g['sourceProjection']['scale'], g['sourceProjection']['offsetX']
def xy(p): return [round((p[0]-442)*scale+ox,3), round(p[1]*scale,3)]
def path(points): return 'M'+'L'.join(' '.join(f'{v:.3f}' for v in p) for p in points)+'Z'
def rings(poly):
    if poly.is_empty: return []
    ps = [poly] if poly.geom_type=='Polygon' else list(poly.geoms)
    return [[[round(x,3),round(y,3)] for x,y in p.exterior.coords] for p in ps if p.area>1]
def dpath(poly): return ''.join(path(r) for r in rings(poly))
def svg(body): return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'+body+'</svg>'
land=Polygon(g['landPolygonNormalized'])
assert land.is_valid
out=PUB/'assets/geography-2020';out.mkdir(exist_ok=True)
lake=Polygon([xy(p) for p in [[795,568],[817,606],[935,656],[795,656]]])
coast=svg('<defs><pattern id="sea" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M0 10Q5 8 10 10T20 10" fill="none" stroke="#426b79" stroke-width=".25" opacity=".16"/></pattern></defs><rect width="1024" height="1024" fill="#0c202e"/><rect width="1024" height="1024" fill="url(#sea)"/><path d="'+dpath(land)+'" fill="#223840" stroke="#77949a" stroke-width=".8"/><path d="'+dpath(lake)+'" fill="#264b43" stroke="#658777" stroke-width=".4"/>')
plaza=xy([873,558]);radius=64*scale
coast=coast.replace('</svg>',f'<circle cx="{plaza[0]}" cy="{plaza[1]}" r="{radius}" fill="#294840"/></svg>')
(out/'coast.svg').write_text(coast)
blockPaths=[]
for i,b in enumerate(blocks):
    p=Polygon([xy(v) for v in b['points']])
    if not p.is_valid:p=p.buffer(0)
    p=p.intersection(land).difference(lake)
    if p.is_empty:continue
    # Source contours contain both buildings and whole quarter masses.
    fill=['#49626a','#415b64','#3d555f','#526b70'][i%4]
    blockPaths.append(f'<path d="{dpath(p)}" fill="{fill}" stroke="#91a5a8" stroke-opacity=".38" stroke-width=".26"/>')
(out/'blocks.svg').write_text(svg(''.join(blockPaths)))
roadPaths=[]
for road in g['majorRoads']:
    p='M'+'L'.join(' '.join(map(str,v)) for v in road['pointsNormalized'])
    roadPaths.append(f'<path d="{p}" fill="none" stroke="#142c35" stroke-width="6" stroke-linejoin="round"/><path d="{p}" fill="none" stroke="#d4bd85" stroke-width="2.3" stroke-linejoin="round"/>')
# The northern road crossing already exists in the 2020 primary map.
bp='M'+'L'.join(' '.join(map(str,v)) for v in g['bridgeNorth']['pointsNormalized'])
roadPaths.append(f'<path d="{bp}" fill="none" stroke="#e3d2aa" stroke-width="2.7"/>')
roadPaths.append(f'<circle cx="{plaza[0]}" cy="{plaza[1]}" r="{radius}" fill="none" stroke="#19313a" stroke-width="3"/><circle cx="{plaza[0]}" cy="{plaza[1]}" r="{radius}" fill="none" stroke="#92a6a5" stroke-width=".95"/>')
(out/'roads.svg').write_text(svg(''.join(roadPaths)))
localRoads=[]
for name in ['reference-local-roads-central.json','reference-local-roads-outer.json','reference-local-roads-seams.json']:
    localRoads.extend(read(DOC/name)['roads'])
localPaths=[]
for road in localRoads:
    vertices=[xy(p) for p in road['points']]
    if len(vertices)<2:continue
    p='M'+'L'.join(' '.join(map(str,v)) for v in vertices)
    collector=road['kind']=='collector'
    localPaths.append((p,collector))
localBody='<defs><clipPath id="local-road-land"><path d="'+dpath(land)+'"/></clipPath></defs><g clip-path="url(#local-road-land)" fill="none" stroke-linejoin="round" stroke-linecap="round">'
for p,collector in localPaths:
    localBody+=f'<path d="{p}" stroke="#152e36" stroke-width="{3.2 if collector else 2.0}"/>'
for p,collector in localPaths:
    localBody+=f'<path d="{p}" stroke="{"#a9b0a0" if collector else "#81999c"}" stroke-width="{1.2 if collector else .7}"/>'
(out/'local-roads.svg').write_text(svg(localBody+'</g>'))

# District selection anchors. Sourcebook names omitted by Draken use explicitly
# editorial anchors; no geometrical claim is made for the administrative borders.
anchors={'A1':[680,551],'A2':[781,454],'A3':[900,435],'A4':[969,463],
 'A5':[969,387],'A6':[1082,429],'B1':[755,505],'B2':[869,551],
 'B3':[973,517],'B4':[1010,564],'B5':[1142,554],'B6':[1140,462],
 'C1':[688,646],'C2':[850,631],'C3':[989,641],'C4':[1045,621],
 'C5':[1122,615],'C6':[1180,649], 'E1':[804,773], 'CZ':[758,819],
 'H1':[845,134],'F1':[1260,163],'J1':[1251,935],'I1':[956,1087],'G1':[710,1095]}
anchorNorm={k:xy(v)for k,v in anchors.items()}
centralMask=Polygon(g['regions'][1]['polygonNormalized']).intersection(land)
centralMask=centralMask.union(box(*xy([1120,560]),*xy([1270,714]))).intersection(land)
centralMask=centralMask.intersection(box(0,0,1024,xy([0,714])[1]))
outerMask=land.difference(centralMask)
def partition(ids,mask):
    pts=MultiPoint([anchorNorm[k]for k in ids])
    cells=list(voronoi_polygons(pts,extend_to=box(0,0,1024,1024)).geoms)
    result={}
    for k in ids:
        pt=Point(anchorNorm[k]); cell=next(c for c in cells if c.covers(pt)).intersection(mask)
        assert cell.is_valid and not cell.is_empty,k
        result[k]=cell
    return result
shapes=partition(list(anchors)[:18],centralMask)
# Two overview features are recognizable without inventing a rectangular grid:
# the circular Corporate Center and the adjoining triangular Lake Park.
corporateMask=Point(plaza).buffer(radius,quad_segs=64).intersection(centralMask)
parkMask=lake.difference(corporateMask)
for k in list(anchors)[:18]:
    if k not in ['B2','C2']:shapes[k]=shapes[k].difference(corporateMask).difference(parkMask)
shapes['B2']=corporateMask;shapes['C2']=parkMask
shapes.update(partition(list(anchors)[18:],outerMask))
districts={}
palette={'central':'#6fa4b3','H1':'#a0b69a','F1':'#b1a7bc','E1':'#b48882','J1':'#b8a27e','I1':'#a4aa7d','G1':'#8cb0a0','CZ':'#bb7878'}
for d in catalog['districts']:
    k=d['id']; region='central'if k in list(anchors)[:18]else k
    districts[k]={'id':k,'name':d['name'],'rings':rings(shapes[k]),'center':anchorNorm[k],
      'basis':'editorial-selection-mask','region':region,'color':palette[region],
      'sourcePlan':k if k in plans else None}
macro=[]
for ids,name,sel in [(list(anchors)[:18],'ЦЕНТРАЛЬНЫЙ ПОЛУОСТРОВ','B2')]+[([k],districts[k]['name'].upper(),k)for k in ['H1','F1','E1','J1','I1','G1']]:
    region='central'if len(ids)>1 else sel
    poly=centralMask if len(ids)>1 else shapes[sel]
    center=xy([938,345])if len(ids)>1 else districts[sel]['center']
    macro.append({'id':region,'name':name,'select':sel,'rings':rings(poly),'center':center,'color':palette[region],'basis':'editorial-selection-mask'})

def norm(s):
    s=unicodedata.normalize('NFKD',s).casefold()
    return re.sub(r'[^a-z0-9]','',s)
aliases={'cityhall':'Night City Hall','citylibrary':'Burroughs Municipal Library','citymuseum':'Night City Museum',
 'arasakatower':'Arasaka','eurobusinessmachines':'EBM','network54offices':'Net 54',
 'plazabusinesstower':'Plaza Tower','westcitytower':'West City Tower','infocomp':'Infocomp',
 'worldsatcommunications':'World Sat','orbitalairoffices':'Orbital Air','merrillasukagafinch':'Merrill, Asukaga, & Finch',
 'mcCartneyfieldstadium'.lower():'McCartney Stadium',
 'nightowl':'The Night Owl','caféchrome':'Café Chrome','bodukkanperformancecenter':'Bodakkan Performing Arts Center',
 'forlornhope':'The Forlorn Hope','citypoliceprecinct1':'NCPD Precinct #1',
 'citypoliceprecinct2':'NCPD Precinct #2','citypoliceprecinct3':'NCPD Precinct #3',
 'nightcityfirestation1':'Night City Fire Station','hallofjustice':'NC Court of Justice'}
match={}
for l in locs['locations']:
    for e in [l['english']]+l['matchEnglish']:match.setdefault(norm(e),[]).append(l)
conflictNums={l['number'] for l in locs['criticalConflicts']}
catalogById={p['id']:p for p in catalog['corePlaces']+catalog['places']}
points={};report=[]
for pid,prev in legacy['points'].items():
    p=catalogById[pid];did=p.get('district')or p.get('contextDistrict')
    if did not in districts:
        # Unassigned Core locations retain an approximate geographical relation
        # within the old city, never a guessed Sourcebook sector claim.
        sp=prev.get('originalPoint',[580,780]);did='E1'if sp[1]>1030 else 'C6'if sp[0]>930 else 'C3'
    center=anchorNorm[did]; shape=shapes[did]
    sp=prev.get('sourcePoint');plan=plans.get(prev.get('sourcePlan',did))
    if sp and plan:
        dx=(sp[0]/plan['width']-.5);dy=(sp[1]/plan['height']-.5)
    else:
        sp0=prev.get('originalPoint',[580,780]);dx=(sp0[0]%170)/170-.5;dy=(sp0[1]%210)/210-.5
    bounds=shape.bounds;spanx=min(bounds[2]-bounds[0],75);spany=min(bounds[3]-bounds[1],75)
    point=[center[0]+dx*spanx*.7,center[1]+dy*spany*.7]
    if not shape.covers(Point(point)):
        near=nearest_points(shape,Point(point))[0];point=[near.x*.98+center[0]*.02,near.y*.98+center[1]*.02]
        if not shape.covers(Point(point)):point=list(shape.representative_point().coords)[0]
    info={**prev,'point':[round(v,3)for v in point],'basis':'approximate-sector-registration','overviewDistrict':did}
    eng=norm(p['english']);key=norm(aliases.get(eng,p['english']))
    candidates=match.get(key,[])
    unique={l['number']:l for l in candidates}
    if len(unique)==1:
        l=next(iter(unique.values()))
        # Primary sector evidence outranks the fan map. Different editions can
        # disagree; retain the original published position in the source plan.
        hasPrimary=p.get('district')is not None
        compatible=shapes[did].buffer(12).covers(Point(l['pointNormalized']))
        if l['number']not in conflictNums and (not hasPrimary or compatible):
            info.update(point=l['pointNormalized'],basis='matched-overview-name',referenceNumber=l['number'])
            if p['source']=='core':
                overviewDid=next((k for k,v in shapes.items()if v.covers(Point(info['point']))),did)
                info['overviewDistrict']=overviewDid
        else:report.append({'id':pid,'name':p['english'],'referenceNumber':l['number'],'policy':'primary-sector-retained','district':did})
    points[pid]=info

# Add addresses only when a published source marker, an explicitly reviewed
# reference correspondence or a catalog parent supports their position.
extraAnchors={a['id']:a for a in landmarks.get('missingAnchors',[])}
for pid,p in catalogById.items():
    if pid in points or p.get('status')!='canon' or p.get('source')!='ncs':continue
    did=p.get('district'); planid='B2-plaza' if any(m.get('placeId')==pid for m in plans['B2-plaza']['markers']) else did
    plan=plans.get(planid); marker=next((m for m in plan.get('markers',[]) if m.get('placeId')==pid),None) if plan else None
    extra=extraAnchors.get(pid)
    if extra:planid=extra['plan'];plan=plans[planid];sp=extra['sourcePoint']
    elif marker:sp=[marker['x'],marker['y']]
    else:continue
    shape=shapes[did];center=anchorNorm[did];bounds=shape.bounds
    spanx=min(bounds[2]-bounds[0],220 if shape.area>20000 else 75)
    spany=min(bounds[3]-bounds[1],270 if shape.area>20000 else 75)
    point=[center[0]+(sp[0]/plan['width']-.5)*spanx*.7,center[1]+(sp[1]/plan['height']-.5)*spany*.7]
    if not shape.covers(Point(point)):
        near=nearest_points(shape,Point(point))[0];point=[near.x*.98+center[0]*.02,near.y*.98+center[1]*.02]
        if not shape.covers(Point(point)):point=list(shape.representative_point().coords)[0]
    points[pid]={'point':[round(v,3) for v in point],'source':'ncs','sourcePoint':sp,'sourcePlan':planid,'overviewDistrict':did,'basis':'approximate-sector-registration','sourceBasis':extra['basis'] if extra else marker.get('basis','published-source-plan-marker')}
for a in landmarks.get('overviewReferenceProposals',[]):
    pid=a['id'];did=a['district']
    if pid not in points and land.covers(Point(a['point'])) and shapes[did].buffer(12).covers(Point(a['point'])):
        points[pid]={'point':a['point'],'source':'ncs','overviewDistrict':did,'basis':'matched-overview-name','referenceNumber':a['referenceNumber'],'sourcePlan':did}
# Named interior spaces share the documented address of their parent complex.
for _ in range(3):
    for pid,p in catalogById.items():
        parent=p.get('parent')
        if pid not in points and p.get('status')=='canon' and parent in points:
            points[pid]={**points[parent],'basis':'shared-parent-address','parent':parent}

world={'version':'7.0.0','layoutVersion':7,'mapId':'city2020','width':1024,'height':1024,
 'defaultBounds':[90,0,880,1024],'coordinateSystem':'Draken-overview-north-up-normalized1024',
 'projection':g['sourceProjection'],'assets':{'coast':'assets/geography-2020/coast.svg',
 'roads':'assets/geography-2020/roads.svg','localRoads':'assets/geography-2020/local-roads.svg','buildingsOverview':'assets/geography-2020/blocks.svg','cleanBasemap':'assets/geography-2020/clean-basemap-v7.webp','printBasemap':'assets/geography-2020/print-basemap-v7.webp','cleanBasemapSource':'assets/geography-2020/clean-basemap-v7.svg','printBasemapSource':'assets/geography-2020/print-basemap-v7.svg','tiles':[]},
 'districts':districts,'macroAreas':macro,'points':points,'modernDistricts':[],
 'landmarks':[{k:l[k] for k in ['id','label','priority']}for l in landmarks['landmarks'] if l['id'] in points],
 'waterLabels':[{'name':'ТИХИЙ ОКЕАН','point':xy([505,650]),'rotation':-90},
 {'name':'DEL CORONADO BAY','point':xy([700,310])}, {'name':'SAN MORRO BAY','point':xy([956,935])}],
 'roadLabels':[{'name':'US 16','point':xy([617,625])},{'name':'US 828','point':xy([1329,545])},
 {'name':'US 126','point':xy([736,1170])},{'name':'DEL CORONADO BRIDGE','point':xy([920,318])}],
 'footprintCount':len(blocks),'renderedFootprintCount':len(blockPaths),'localRoadPolylineCount':len(localPaths),
 'policy':'Графическая основа — предоставленный референс Draken RPG Maps. Видимые улицы, здания и берега сохранены из исходного изображения; очищенные фрагменты заменяют только печатные подписи и номера. Линии, скрытые исходным текстом, восстановлены локально. Каноничные названия проверены по Sourcebook; обзорные позиции и области выбора приблизительны. Исходные планы определяют точный адрес.',
 'sources':[
 {'title':'Draken RPG Maps: Night City 2020 — пользовательский референс','credit':'Draken RPG Maps; unofficial','official':False},
 {'title':'Night City Sourcebook','url':'https://talsorianstore.com/products/night-city','pages':[14,16,19,20],'credit':'© R. Talsorian Games'},
 {'title':'Cyberpunk RED Easy Mode','url':'https://d1vzi28wh99zvq.cloudfront.net/pdf_previews/409912-sample.pdf','pages':[7],'credit':'© R. Talsorian Games'},
 {'title':'Night City Atlas 2045','url':'https://rtalsoriangames.com/2025/01/15/cyberpunk-red-alert-january-2025-dlc-night-city-atlas/','pages':[2,3],'credit':'© R. Talsorian Games'},
 {'title':'J Gray: retcons and rough placement','url':'https://bsky.app/profile/jgraygaming.bsky.social/post/3lpjwfzdkhs2n'}],
 'history':[{'year':2020,'text':'Довоенный центральный полуостров, Del Coronado Bridge и широкий San Morro Bay.'},
 {'year':2023,'text':'20 августа: ядерный взрыв в башне Arasaka; центр разрушен.'},
 {'year':'2030–2035','text':'Огромные массы засыпки перемещают из разрушенного центра; значительную часть старого залива засыпают (RED Easy Mode, стр. 7).'},
 {'year':2045,'text':'Официальные карты показывают Morro Canal, Pacifica Bridge и San Morro Bridge. Точные даты постройки мостов не установлены.'},
 {'year':2077,'text':'Поздний город после восстановления, новых районов и переселений. Игровой масштаб и признанные RTG ретконы исключают точное соответствие всех улиц.'}],
 'reference':{'epoch':2077,'defaultBounds':legacy['defaultBounds'],'assets':legacy['assets'],
 'modernDistricts':legacy['modernDistricts'],'coordinateSystem':legacy['coordinateSystem'],
 'policy':'Отдельная географическая основа 2077 для сравнения, без перенесённых меток 2020.'},
 'legacy':legacy}
raw=json.dumps(world,ensure_ascii=False,separators=(',',':'))
(PUB/'world-data.json').write_text(raw);(PUB/'world-data.js').write_text('window.NC_WORLD_DATA='+raw+';\n')
(DOC/'registration-report.json').write_text(json.dumps({'policy':'Names matched, never numbers; primary plans win.','matched':sum(i['basis']=='matched-overview-name'for i in points.values()),'conflicts':report},ensure_ascii=False,indent=2))
# NCART retains the published station graph. These schematic positions respect
# the 2020 bay topology; the shapes do not assert exact tunnels or entrances.
transit=read(PUB/'transit-data.json')
stationAnchors={'high-street':[988,401],'harbor-view':[1000,447],
 'city-center':[900,461],'north-plaza':[891,492],'14th-street':[810,568],
 '6th-street-west':[665,542],'williams-street':[938,568],'transit-center':[990,619],
 'japantown':[989,690],'university':[694,664],'westbrook':[1230,140],
 'westbrook-south':[1200,302],'north-oak':[841,178],'south-west-hills':[1285,520],
 'east-city':[1370,610],'heywood':[1232,940],'133rd-street':[1214,796],
 'southland-mall':[976,744],'88th-street':[855,761],'44th-street':[660,766],
 'west-beach':[660,845],'san-morro':[720,905],'airport':[870,806],
 'rancho-coronado':[956,1075],'pacifica':[710,1095]}
for s in transit['stations']:
    s.setdefault('previousPoint',s['point'])
    s['point']=xy(stationAnchors[s['id'].removeprefix('metro-')])
    assert land.buffer(2).covers(Point(s['point'])),s['id']
    s['basis']='sourcebook-topology-editorial-2020-position'
def edge(a,b,via):return {'from':'metro-'+a,'to':'metro-'+b,'points':[xy(p)for p in via],'basis':'editorial-schematic-on-2020-overview'}
transit['displayEdges']=[
 edge('north-oak','high-street',[[841,178],[840,252],[834,350],[922,381],[988,401]]),
 edge('southland-mall','133rd-street',[[976,744],[1040,688],[1110,640],[1200,680],[1214,796]])]
transit['coordinateSystem']=world['coordinateSystem']
traw=json.dumps(transit,ensure_ascii=False,separators=(',',':'))
(PUB/'transit-data.json').write_text(traw);(PUB/'transit-data.js').write_text('window.NC_TRANSIT_DATA='+traw+';\n')
print(json.dumps({'sourceFootprints':len(blocks),'rendered':len(blockPaths),'districts':len(districts),'points':len(points),'matchedOverviewNames':sum(i['basis']=='matched-overview-name'for i in points.values())}))
