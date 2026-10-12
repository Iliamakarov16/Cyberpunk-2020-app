"""Register source geometry without asserting continuity with the 2077 city.
The affine transform preserves the relative order of pre-war source blocks.
"""
import json
from pathlib import Path
from shapely.geometry import Polygon
from shapely.ops import unary_union
ROOT=Path(__file__).resolve().parents[1]
world=json.loads((ROOT/'public/world-data.json').read_text())
geo=json.loads((ROOT/'public/streets-data.json').read_text())
atlas=json.loads((ROOT/'public/atlas-data.json').read_text())
def warp(p): return [round(310+p[0]*.16+p[1]*.05,3),round(290+p[1]*.155,3)]
for key,old in geo['zones'].items():
    area=world['districts'][key];area['rings']=[[warp(p) for p in old]]
    area['center']=warp([sum(p[0] for p in old)/len(old),sum(p[1] for p in old)/len(old)])
    area['basis']='registered-prewar-sourcebook'
land=unary_union([Polygon(v['rings'][0]).buffer(0) for k,v in world['districts'].items() if k in geo['zones']])
parts=[land] if land.geom_type=='Polygon' else list(land.geoms)
land_path=''.join('M'+'L'.join(f'{x:.3f},{y:.3f}' for x,y in p.exterior.coords)+'Z' for p in parts)
world['historical']={'image':'assets/sourcebook-city.jpg','width':2000,'height':1303,
 'transform':[.08832,0,.0285495,.08850345,321.36,302.4],
 'landPath':land_path,
 'basis':'Sourcebook illustration registered to campaign geography',
 'note':'Центральные кварталы показаны по довоенному плану Sourcebook; окружающая география 2077 сохранена как каркас кампании. Регистрация и стыковка границ авторские.'}
world['version']='4.0.0';world['policy']=world['historical']['note']+' Каноничные номера и адреса сверяются на исходных планах. Поздняя застройка вне восстановленного центра не подтверждена для 2020.'
history_url='https://rtalsoriangames.com/2026/02/19/night-city-2045-timeline-interface-red-volume-5-pod-available/'
if not any(s['url']==history_url for s in world['sources']):
    world['sources'].append({'title':'История перестройки Night City (R. Talsorian Games)','url':history_url})
world['points']={k:v for k,v in world['points'].items() if v['source']!='ncs'}
for key,plan in geo['plans'].items():
    if key not in geo['zones']: continue
    zone=geo['zones'][key]
    x0,x1=min(p[0] for p in zone),max(p[0] for p in zone)
    y0,y1=min(p[1] for p in zone),max(p[1] for p in zone)
    for m in plan.get('markers',[]):
        if not m.get('placeId') or m['placeId'] in world['points']: continue
        source_point=[m['x'],m['y']]
        registered=[x0+m['x']/plan['width']*(x1-x0),y0+m['y']/plan['height']*(y1-y0)]
        world['points'][m['placeId']]={'point':warp(registered),'basis':'approximate-sector-registration','source':'ncs','sourcePlan':key,'sourcePoint':source_point}
world['history']=[{'year':2020,'text':'Довоенный корпоративный центр, Лейк-Парк и районы исходного Sourcebook.'},{'year':2023,'text':'20 августа: ядерный взрыв в штаб-квартире Arasaka.'},{'year':2028,'text':'Новая городская хартия и реорганизация районов.'},{'year':2038,'text':'Тогдашний Heywood разделён на Santo Domingo и North Heywood.'},{'year':2045,'text':'В центре сохраняется Hot Zone; продолжается восстановление.'},{'year':2077,'text':'Поздний перестроенный город. Сетка дорог используется только как каркас адаптации.'}]
atlas['version']='4.0.0';atlas['geographyPolicy']=world['policy']
for name,obj,variable in [('world-data',world,'NC_WORLD_DATA'),('atlas-data',atlas,'NC_ATLAS_DATA')]:
    raw=json.dumps(obj,ensure_ascii=False,separators=(',',':'));(ROOT/'public'/f'{name}.json').write_text(raw)
    jsname='data' if name=='atlas-data' else name;(ROOT/'public'/f'{jsname}.js').write_text('window.'+variable+'='+raw+';\n')
print('Historical central layer registered; original source addresses retained.')
