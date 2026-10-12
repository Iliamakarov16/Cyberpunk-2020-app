(()=>{
'use strict';
const geo=window.NC_STREETS_DATA,data=window.NC_ATLAS_DATA;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const points=poly=>poly.map(p=>p.join(',')).join(' ');
const placeById=new Map(data.places.map(p=>[p.id,p]));
const districtById=new Map(data.districts.map(p=>[p.id,p]));
const plazaIds=new Set(geo.plans['B2-plaza'].markers?.map(m=>m.placeId)||[]);
const fill={park:'#c9dbc1',club:'#e6d5d1',medical:'#c5ddd9',corporate:'#e2d7bd',food:'#e5d5c8',culture:'#d3dccb',industrial:'#d6d4cc',transport:'#d5d8cf',government:'#d1dbe0',mixed:'#e7e2d7'};
const landmarkNames={'core-01':'City Hall','core-07':'EBM','core-08':'Arasaka','core-09':'Petrochem','core-10':'Microtech','core-14':'Raven','core-18':'Trauma Team','core-37':'N.C. University','core-45':'Port','core-50':'McCartney Stadium','core-59':'Lake Park','core-61':'City Hospital'};
function planFor(c){const id=c.district||c.id;if(c.id==='B2'||plazaIds.has(c.id)||plazaIds.has(c.parent))return 'B2-plaza';return geo.plans[id]?id:null}
function city({selected}){
 const sel=placeById.get(selected)||data.corePlaces.find(p=>p.id===selected)||districtById.get(selected);
 const district=sel?.district||sel?.id;
 const extent='M30 65H775L857 148 953 110 997 109 1035 122 1062 96 1081 116 1063 138 1087 160 1106 144 1122 161 1100 188 1107 211H1147V244H1106V281H1147V309H1107V361L1075 416 1130 491V606L1036 630 1082 669 1145 710V775L1080 816V850H1124V891L1149 917V967L1160 991V1268L1151 1287V1437H30Z';
 const selectedZone=geo.zones[district];
 return `<defs><pattern id="city-grid" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M100 0H0V100" fill="none" stroke="#8faaa3" stroke-width=".4" opacity=".2"/></pattern></defs><rect x="-800" y="-800" width="3500" height="3500" fill="#b9d3db"/><path d="M-800 -800H773V65H30V1437H1160V2200H-800Z" fill="#f2f0e8"/><path d="${extent}" fill="#faf9f2" stroke="#6e929c" stroke-width="2"/><path d="${extent}" fill="url(#city-grid)"/>${geo.blocks.map(b=>`<polygon class="city-block" points="${points(b.polygon)}" fill="${fill[b.category]||fill.mixed}"/>`).join('')}
 <path d="M303 502A113 113 0 1 1 529 502A113 113 0 1 1 303 502Z" fill="none" stroke="#c4ae7a" stroke-width="5"/>
 <path d="M501 591L613 435 951 112" fill="none" stroke="#c4ae7a" stroke-width="4"/>
 <path d="M602 1428Q665 1319 751 1257T941 1137L1149 920" fill="none" stroke="#d0b87c" stroke-width="5"/>
 ${Object.entries(geo.zones).map(([id,poly])=>`<polygon class="city-zone${district===id?' selected':''}" data-zone="${id}" tabindex="0" role="button" aria-label="${esc(districtById.get(id)?.name)}" points="${points(poly)}"><title>${esc(districtById.get(id)?.name)} · ${id}</title></polygon>`).join('')}
 ${geo.streets.filter(s=>s.id!=='plaza-drive').map(s=>`<text class="street-name ${s.level==='local'?'street-secondary':'street-major'}" x="${s.label[0]}" y="${s.label[1]}" transform="rotate(${s.rotation} ${s.label[0]} ${s.label[1]})">${esc(s.name)}</text>`).join('')}
 <text class="street-name street-major" x="415" y="390">PLAZA DRIVE</text>
 <text class="carto-water" x="1110" y="80">ДЕЛЬ-КОРОНАДО</text>
 <text class="carto-place" x="350" y="663">LAKE PARK</text>
 <text class="carto-place" x="1050" y="340">McCARTNEY</text><text class="carto-place" x="1050" y="358">STADIUM</text>
 <text class="carto-place" x="480" y="1120">ЮЖНЫЕ КВАРТАЛЫ</text>
 ${data.corePlaces.map(p=>`<g class="city-pin${selected===p.id?' selected':''}${landmarkNames[p.id]?' landmark':''}" data-pin="${p.id}" tabindex="0" role="button" aria-label="${esc(p.name)} · ${p.number}"><circle cx="${p.point[0]}" cy="${p.point[1]}" r="10"/><text x="${p.point[0]}" y="${p.point[1]}">${p.number}</text><title>${esc(p.name)}</title></g>`).join('')}
 ${selectedZone?`<text class="selected-district-label" x="${(Math.min(...selectedZone.map(p=>p[0]))+Math.max(...selectedZone.map(p=>p[0])))/2}" y="${Math.min(...selectedZone.map(p=>p[1]))+22}">${esc(districtById.get(district)?.name)}</text>`:''}
 <g class="north-mark"><path d="M45 35V2M38 12L45 2 52 12" fill="none" stroke="#334d54" stroke-width="2"/><text x="45" y="50" text-anchor="middle" font-size="13" fill="#334d54">С</text></g>`;
}
function sector(planId,selected){const parent=placeById.get(selected)?.parent;const p=geo.plans[planId];if(!p)return '';return `<rect x="-1000" y="-1000" width="5000" height="5000" fill="#fff"/><image href="${p.image}" width="${p.width}" height="${p.height}"/>${(p.markers||[]).filter(m=>m.placeId).map(m=>`<g class="plan-marker${m.placeId===selected||m.placeId===parent?' selected':''}" data-pin="${m.placeId}" tabindex="0" role="button" aria-label="${esc(placeById.get(m.placeId)?.name)}"><circle cx="${m.x}" cy="${m.y}" r="24"/><title>${esc(placeById.get(m.placeId)?.name)} · ${m.number}</title></g>`).join('')}`}
function region(selected){const p=geo.plans.region;const spots=[['F1',.77,.04],['H1',.61,.11],['B2',.425,.26],['E1',.48,.49],['J1',.825,.755],['G1',.415,.85],['I1',.615,.86]];return `<rect width="${p.width}" height="${p.height}" fill="white"/><image href="${p.image}" width="${p.width}" height="${p.height}"/>${spots.map(([id,x,y])=>`<g class="region-pin${(selected===id||placeById.get(selected)?.district===id)?' selected':''}" data-zone="${id}" tabindex="0" role="button" aria-label="${esc(districtById.get(id)?.name)}"><circle cx="${x*p.width}" cy="${y*p.height}" r="20"/><text x="${x*p.width}" y="${y*p.height}" dominant-baseline="central" text-anchor="middle">${id}</text><title>${esc(districtById.get(id)?.name)}</title></g>`).join('')}`}
function buildings(selected){const d=placeById.get(selected)?.district||selected;const poly=geo.zones[d];return `<rect width="2000" height="1303" fill="#b9d3db"/><image href="assets/sourcebook-city.jpg" width="2000" height="1303"/>${Object.entries(geo.zones).map(([id,points])=>`<polygon class="building-zone${d===id?' selected':''}" data-zone="${id}" tabindex="0" role="button" aria-label="${esc(districtById.get(id)?.name)}" points="${points.map(([x,y])=>[((x-46)/1104)*2000,((y-80)/744)*1303].join(',')).join(' ')}"><title>${esc(districtById.get(id)?.name)}</title></polygon>`).join('')}`}
const world=window.NC_WORLD_DATA;
const shortNames={A1:'Италия',A2:'Нортсайд',A3:'Сити-центр',A4:'Истсайд',A5:'Верх. Марина',A6:'Вост. Марина',B1:'Уэст-Хилл',B2:'Корп. центр',B3:'Банки',B4:'Медцентр',B5:'Даунтаун',B6:'Гавань',C1:'Университет',C2:'Лейк-Парк',C3:'Джапантаун',C4:'Литтл-Чайна',C5:'Студио-Сити',C6:'Чартер-Хилл'};
const path=rings=>rings.map(p=>'M'+p.map(x=>x.join(' ')).join('L')+'Z').join('');
function worldPoint(c){if(c.kind==='station')return c.point;if(world.points[c.id])return world.points[c.id].point;return world.districts[c.district||c.id]?.center}
const poiColors={club:'#e4c56c',medical:'#83d3cb',corporate:'#adc0e9',food:'#e2ad81',shop:'#d9c887',housing:'#afd0aa',hotel:'#c5acdc',culture:'#aad6bc',government:'#8dc3e5',industrial:'#b4b4a7',transport:'#d5aa85',services:'#9dbac0',place:'#b4c2cc'};
const poiIcons={club:'M-3 4V-4L4-5V2M-3-3L4-4M-3 4a2 2 0 1 1-2-2M4 2a2 2 0 1 1-2-2',medical:'M-4 0H4M0-4V4',corporate:'M-4 5V-4H4V5M-2-2h.1M2-2h.1M-2 1h.1M2 1h.1M-1 5V3H1V5',culture:'M-5-2L0-5 5-2ZM-4 0V4M0 0V4M4 0V4M-5 5H5',government:'M-4-4L0-5 4-4V0Q4 3 0 5Q-4 3-4 0Z',transport:'M-4-5H4V3H-4ZM-4-1H4M-2 5L-1 3M2 5L1 3',food:'M-3-5V5M-5-5V-1H-1V-5M3-5V5M3-5Q5-1 3 0',shop:'M-4-1H4V5H-4ZM-2-1V-3A2 2 0 0 1 2-3V-1',housing:'M-5 0L0-5 5 0M-4 0V5H4V0M-1 5V2H1V5',hotel:'M-5 5V-3M-5 2H5V5M-4-1H-1V2M-1 0H4V2',industrial:'M-5 5V-1L0-3V-1L5-3V5ZM-3-1V-5H-1V-3',services:'M-4 0H4M0-4V4',place:'M0-4A4 4 0 1 1-.01-4'};
function overviewPin(p,selected){const info=world.points[p.id],xy=info.point,mark=world.landmarks?.find(l=>l.id===p.id),color=poiColors[p.category]||poiColors.place;return `<g class="world-place-pin${selected===p.id?' selected':''}${mark?' landmark':''}" data-pin="${p.id}" data-priority="${mark?.priority||0}" style="--poi-color:${color}" transform="translate(${xy.join(' ')})" tabindex="0" role="button" aria-label="${esc(p.name)} · ${esc(data.categories[p.category])}"><circle class="pin-hit" r="12" fill="transparent"/><circle class="pin-halo" r="5"/><circle class="pin-dot" r="2"/><g class="pin-category"><path d="${poiIcons[p.category]||poiIcons.place}"/></g><text class="world-pin-label" x="12" y="4">${esc(p.name)}</text><title>${esc(p.name)} · ${esc(p.sourceCode||'Карта правил №'+p.number)} · ${esc(info.basis==='matched-overview-name'?'Сопоставлено по названию на обзорном плане':'Приблизительно в пределах сектора')} · исходный адрес по кнопке «План 2020»</title></g>`}

// The five palette variants are baked at build time from the unchanged source.
// Exactly one decoded basemap; no viewport-sized filter surfaces during gestures.
const overviewSource={width:2560,height:2012,cropWidth:1823,worldUnitsPerPixel:1024/2012,print:'assets/geography-2020/print-basemap-v8.webp'};
const dossierPalettes=['carmine','ultraviolet','amber','maelstrom','original'];
function dossierBasemap(palette=document.documentElement?.dataset?.mapPalette||document.documentElement?.dataset?.palette){return 'assets/geography-2020/dossier-v8/'+(dossierPalettes.includes(palette)?palette:'carmine')+'.webp'}
function updateDossierPalette(palette){const image=document.querySelector('.world-dossier-base .world-source-base');if(image)image.setAttribute('href',dossierBasemap(palette))}
function dossierBase(sourcePrint){
 if(sourcePrint)return `<rect x="-1024" y="-1024" width="3072" height="3072" fill="#0a1c2a"/><image class="world-basemap world-source-base" href="${overviewSource.print}" width="1024" height="1024"/>`;
 return `<defs><pattern id="dossier-grid" width="64" height="64" patternUnits="userSpaceOnUse"><path class="map-grid-stroke" d="M64 0H0V64" fill="none" stroke="#795d66" stroke-width=".35"/></pattern></defs>
 <rect class="world-dossier-water" x="-1024" y="-1024" width="3072" height="3072" fill="#050305"/>
 <g class="world-dossier-base"><image class="world-basemap world-source-base" href="${dossierBasemap()}" width="1024" height="1024"/></g>
 <rect class="map-coordinate-grid" width="1024" height="1024" fill="url(#dossier-grid)"/>`;
}
function districtSelector(d,selected){return `<g class="world-district-marker${selected===d.id?' selected':''}" data-zone="${d.id}" transform="translate(${d.center.join(' ')})" tabindex="0" role="button" aria-label="${esc(d.name)} · приблизительное положение"><circle r="8"/><text text-anchor="middle" dominant-baseline="central">${esc(d.id)}</text><title>${esc(d.name)} · приблизительный указатель; границы сверяй с исходным планом</title></g>`}

function atlasMap({selected,layers}){
 const c=placeById.get(selected)||data.corePlaces.find(p=>p.id===selected)||districtById.get(selected);
 const did=world.points[c?.id]?.overviewDistrict||c?.district||c?.contextDistrict||c?.id,area=world.districts[did];
 const count=id=>[...data.places,...data.corePlaces].filter(p=>p.status==='canon'&&(p.district||world.points[p.id]?.overviewDistrict||p.contextDistrict)===id).length;
 return `<defs><pattern id="world-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#718e9e" stroke-width=".12"/></pattern></defs>
 ${dossierBase(layers.sourcePrint)}
 
 ${layers.districts?Object.values(world.districts).map(d=>districtSelector(d,did)).join(''):''}
 ${layers.labels?world.macroAreas.map(d=>`<text class="world-label world-macro-label" data-region="${d.id}" x="${d.center[0]}" y="${d.center[1]}">${esc(d.name)}</text>`).join(''):''}
 ${layers.labels?Object.values(world.districts).filter(d=>d.region==='central').map(d=>`<text class="world-sector-label" data-label-id="${d.id}" x="${d.center[0]}" y="${d.center[1]}"><tspan x="${d.center[0]}">${d.id}</tspan><tspan class="sector-name" x="${d.center[0]}" dy="1.25em">${esc(shortNames[d.id]||d.name)}</tspan></text>`).join(''):''}
 ${layers.labels?world.waterLabels.map(d=>`<text class="world-water-label" x="${d.point[0]}" y="${d.point[1]}" ${d.rotation?`transform="rotate(${d.rotation} ${d.point.join(' ')})"`:''}>${esc(d.name)}</text>`).join(''):''}
 ${layers.labels&&layers.roadLabels?world.roadLabels.map(d=>`<text class="world-road-label" x="${d.point[0]}" y="${d.point[1]}">${esc(d.name)}</text>`).join(''):''}
 ${layers.places?Object.values(world.districts).filter(d=>count(d.id)>0).map(d=>`<g class="world-cluster${did===d.id?' selected':''}" data-zone="${d.id}" transform="translate(${d.center[0]} ${d.center[1]})" tabindex="0" role="button" aria-label="${esc(d.name)}: ${count(d.id)} мест"><circle r="7"/><text y=".15">${count(d.id)}</text><title>${esc(d.name)} · ${count(d.id)} мест</title></g>`).join(''):''}
 ${[...data.corePlaces,...data.places].filter(p=>world.points[p.id]&&(layers.places||selected===p.id)).map(p=>overviewPin(p,selected)).join('')}`;
}
function referenceMap(){const r=world.reference;return `<rect x="-1024" y="-1024" width="3072" height="3072" fill="#0a1c2a"/><image href="${r.assets.coast}" width="1024" height="1024"/><image href="${r.assets.buildingsOverview}" width="1024" height="1024"/><image href="${r.assets.roads}" width="1024" height="1024"/>${r.modernDistricts.map(d=>`<path class="world-boundary" d="${path(d.rings)}"/><text class="world-label world-modern-label" x="${d.center[0]}" y="${d.center[1]}">${esc(d.name)}</text>`).join('')}`}
function previousMap({selected,layers}){
 const world=window.NC_WORLD_DATA.legacy;
 const c=placeById.get(selected)||data.corePlaces.find(p=>p.id===selected)||districtById.get(selected);
 const did=c?.district||c?.contextDistrict||c?.id,area=world.districts[did];
 const count=id=>data.places.filter(p=>p.status==='canon'&&(id==='central'?world.districts[p.district]?.region==='central':p.district===id)).length;
 return `<defs><filter id="sourcebook-lines" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feConvolveMatrix order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" divisor="1" bias="0" preserveAlpha="true"/><feColorMatrix type="matrix" values="0 0 0 0 .39 0 0 0 0 .60 0 0 0 0 .66 .2126 .7152 .0722 0 0"/></filter><clipPath id="historical-land"><path d="${world.historical?.landPath||''}"/></clipPath><pattern id="world-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#718e9e" stroke-width=".1"/></pattern></defs>
 <rect x="-1024" y="-1024" width="3072" height="3072" fill="#0a1c2a"/>
 <image class="world-basemap" href="${world.assets.coast}" width="1024" height="1024"/>
 <image class="world-basemap" href="${world.assets.buildingsOverview}" width="1024" height="1024"/>
 <g id="world-buildings-detail" class="world-basemap"></g>
 <image class="world-basemap" href="${world.assets.roads}" width="1024" height="1024"/>
 ${layers.historical&&world.historical?`<path d="${world.historical.landPath}" fill="#172f39"/><g clip-path="url(#historical-land)"><image class="historical-basemap" href="${world.historical.image}" width="${world.historical.width}" height="${world.historical.height}" transform="matrix(${world.historical.transform.join(' ')})" filter="url(#sourcebook-lines)"><title>Довоенный центр: опубликованная застройка 2020. Привязка к общей карте авторская.</title></image></g>`:''}
 
 ${layers.districts?world.macroAreas.map(d=>`<path class="world-zone world-macro${area?.region===d.id?' selected':''}" data-zone="${d.select}" d="${path(d.rings)}" fill="${d.color}" stroke="${d.color}" tabindex="0" role="button" aria-label="${esc(d.name)} · район адаптации"><title>${esc(d.name)} · границы кампании</title></path>`).join(''):''}
 ${layers.districts?Object.values(world.districts).filter(d=>d.region==='central').map(d=>`<path class="world-zone world-sector${did===d.id?' selected':''}" data-zone="${d.id}" d="${path(d.rings)}" fill="${d.color}" stroke="${d.color}" tabindex="0" role="button" aria-label="${esc(d.name)} · ${d.id}"><title>${esc(d.name)} · ${d.id} · редакционная привязка</title></path>`).join(''):''}
 ${area?`<path class="selected-area" d="${path(area.rings)}"/>`:''}
 ${layers.modern?world.modernDistricts.map(d=>`<path class="world-boundary" d="${path(d.rings)}"><title>${esc(d.name)} · граница из игры 2077</title></path>`).join(''):''}
 ${layers.labels&&!layers.modern?world.macroAreas.map(d=>`<text class="world-label world-macro-label" x="${d.center[0]}" y="${d.center[1]}">${esc(d.name)}</text>`).join(''):''}
 ${layers.labels&&!layers.modern?Object.values(world.districts).filter(d=>d.region==='central').map(d=>`<text class="world-sector-label" data-label-id="${d.id}" x="${d.center[0]}" y="${d.center[1]}"><tspan x="${d.center[0]}">${d.id}</tspan><tspan class="sector-name" x="${d.center[0]}" dy="1.25em">${esc(shortNames[d.id]||d.name)}</tspan></text>`).join(''):''}
 ${layers.modern&&layers.labels?world.modernDistricts.map(d=>`<text class="world-modern-label world-label" x="${d.center[0]}" y="${d.center[1]}">${esc(d.name)} · 2077</text>`).join(''):''}
 ${layers.labels?'<text class="world-water-label" x="248" y="234" transform="rotate(-90 248 234)">ТИХИЙ ОКЕАН</text><text class="world-water-label" x="600" y="660">ПУСТОШИ</text>':''}
 ${layers.places?Object.values(world.districts).filter(d=>count(d.id)>0).map(d=>`<g class="world-cluster${did===d.id?' selected':''}" data-zone="${d.id}" transform="translate(${d.center[0]} ${d.center[1]})" tabindex="0" role="button" aria-label="${esc(d.name)}: ${count(d.id)} мест из справочника"><circle r="7"/><text y=".15">${count(d.id)}</text><title>${esc(d.name)} · ${count(d.id)} мест · точные номера на плане 2020</title></g>`).join(''):''}
 ${layers.places||c?.source==='core'?[...data.corePlaces,...data.places.filter(p=>world.points[p.id])].filter(p=>layers.places||selected===p.id).map(p=>{const xy=world.points[p.id].point;return `<g class="world-place-pin${selected===p.id?' selected':''}" data-pin="${p.id}" transform="translate(${xy[0]} ${xy[1]})" tabindex="0" role="button" aria-label="${esc(p.name)} · перенесено со старого плана"><circle class="pin-hit" r="12" fill="transparent"/><circle class="pin-halo" r="5"/><circle class="pin-dot" r="2.5"/><text class="world-pin-label" x="8" y="1">${esc(selected===p.id?p.name:String(p.number||p.sourceCode))}</text><title>${esc(p.name)} · ${p.sourceCode||'№'+p.number} · редакционная привязка; исходный адрес в карте правил</title></g>`}).join(''):''}`;
}
function buildingTiles(){return{key:'vector-2020',html:''}}
window.NC_CARTOGRAPHY={geo,world,city,atlasMap,referenceMap,previousMap,buildingTiles,overviewSource,dossierBasemap,updateDossierPalette,worldPoint,sector,region,buildings,planFor};
})();
