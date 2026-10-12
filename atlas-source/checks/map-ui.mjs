import './catalog-layout.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';

// Actual DOM bubbling catches container/control selector collisions. This is
// an interaction regression check, not native-browser or touch-layout QA.
for(const width of [640,390]){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),{url:'https://atlas.example/',runScripts:'outside-only',virtualConsole:vc});
 const w=dom.window,d=w.document,rect=()=>({width,height:850,left:0,top:0});
 w.matchMedia=()=>({matches:width<700});w.HTMLElement.prototype.getBoundingClientRect=rect;w.SVGElement.prototype.getBoundingClientRect=rect;
 for(const el of d.querySelectorAll('script[src]'))w.eval(fs.readFileSync(new URL('../public/'+el.getAttribute('src').split('?')[0],import.meta.url),'utf8'));
 const api=w.NightCityAtlas;
 const workspace=d.querySelector('.workspace'),panelIds=['catalog-panel','detail','atlas-tools'];
 assert(panelIds.every(id=>d.getElementById(id).hidden),'Fresh map does not have open drawers');
 assert(d.querySelector('.map-bottom').hidden,'Fresh map does not show an arbitrary selected district');
 assert.equal(d.querySelector('.mobile-nav'),null,'No duplicate permanent mobile navigation');
 assert(!d.getElementById('map-viewport').contains(d.getElementById('atlas-tools')),'Scrollable tools are outside the gesture canvas');
 const firstCamera=JSON.stringify(api.getContext().view);
 d.getElementById('catalog-toggle').click();assert.equal(workspace.dataset.panel,'catalog');assert(!d.getElementById('catalog-panel').hidden);assert.equal(d.activeElement.id,'search');assert(d.getElementById('map-viewport').inert);
 d.getElementById('tools-toggle').click();assert.equal(workspace.dataset.panel,'tools');assert(d.getElementById('catalog-panel').hidden);assert(!d.getElementById('atlas-tools').hidden);assert.equal(d.activeElement.id,'tools-close');
 d.getElementById('panel-backdrop').click();assert.equal(workspace.dataset.panel,'map');assert.equal(JSON.stringify(api.getContext().view),firstCamera,'Opening and dismissing drawers preserves camera');
 api.selectLocation('core-39');assert(!d.querySelector('.map-bottom').hidden);assert(d.getElementById('detail').hidden,'API selection reveals a compact strip');
 d.getElementById('show-card').click();assert.equal(workspace.dataset.panel,'detail');assert(!d.getElementById('detail').hidden);assert.equal(d.activeElement.id,'detail-close');assert(d.getElementById('detail-content').textContent.includes(api.getSelection().name));
 const selectedPoint=api.getContext().point,cardView=api.getContext().view,cardUnit=Math.max(cardView[2]/width,cardView[3]/850);assert((selectedPoint[1]-cardView[1])/cardUnit<850*.48,'Selected place remains above the phone sheet');
 d.getElementById('detail-expand').click();assert(d.getElementById('detail').classList.contains('expanded'));
 d.getElementById('detail-expand').click();assert(!d.getElementById('detail').classList.contains('expanded'));
 d.getElementById('detail-close').click();assert.equal(workspace.dataset.panel,'map');assert(!d.querySelector('.map-bottom').hidden);assert.equal(d.activeElement.id,'show-card');
 d.getElementById('tools-toggle').click();d.getElementById('help').click();assert.equal(workspace.dataset.panel,'map','A dialog closes its originating drawer');assert(d.getElementById('modal').open);d.getElementById('modal-close').focus();d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'/',bubbles:true}));assert.equal(workspace.dataset.panel,'map','Search shortcut does not open behind a dialog');d.getElementById('modal-close').click();
 d.querySelector('button[data-map="synthesis"]').click();

 const visible=()=>[...d.querySelectorAll('.world-place-pin')].filter(g=>g.style.display!=='none');
 assert(visible().length>=4,'City overview has visible canonical landmarks at '+width+'px');
 assert(visible().some(g=>g.querySelector('text').style.display!=='none'),'Named landmarks on overview');
 assert.equal(d.querySelectorAll('.world-source-base').length,1,'A single detailed source basemap');
 assert.equal(d.querySelector('.world-source-base').getAttribute('href'),w.NC_CARTOGRAPHY.dossierBasemap());
 assert.equal(d.getElementById('map-viewport').dataset.basemap,'dossier');
 assert(!d.querySelector('.world-local-roads'),'No schematic street lines over the source image');
 assert(!d.querySelector('[data-layer="streets"]'),'Baked source streets are not advertised as a removable layer');
 const tab=map=>d.querySelector('button[data-map="'+map+'"]');
 tab('reference2077').click();assert.equal(api.getContext().map,'reference2077');assert.equal(d.getElementById('map-viewport').dataset.basemap,'dark');assert(d.getElementById('map-title').textContent.includes('2077'));
 const assets=[...d.querySelectorAll('#map image')].map(e=>e.getAttribute('href'));
 assert(assets.includes(w.NC_WORLD_DATA.reference.assets.coast));assert(!assets.includes(w.NC_WORLD_DATA.assets.coast));
 assert(!d.querySelector('.world-place-pin'),'No 2020 pins over 2077 geography');
 const beforeRef=JSON.stringify(api.getContext().view);d.querySelector('#map image').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));assert.equal(JSON.stringify(api.getContext().view),beforeRef);assert(tab('reference2077').classList.contains('active'));
 tab('synthesis').click();assert.equal(api.getContext().map,'city2020');assert(visible().length>=4);
 d.getElementById('zoom-in').click();const zoomed=JSON.stringify(api.getContext().view);d.querySelector('#map image').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));assert.equal(JSON.stringify(api.getContext().view),zoomed,'Blank canvas click preserves camera');
 const search=d.getElementById('search');search.value='Arasaka';search.dispatchEvent(new w.Event('input'));
 assert(d.querySelector('#results [data-select="core-08"]'),'Core places can be found in the normal catalog');
 assert(d.querySelector('#results [data-select^="ncs-"]'),'Sourcebook places remain searchable');
 d.getElementById('clear-filters').click();api.selectLocation('B2');d.getElementById('district-places').click();assert.equal(d.getElementById('district-filter').value,'B2');assert(d.querySelector('#results [data-select^="ncs-"]'));
 const checkbox=d.querySelector('[data-layer="roadLabels"]');checkbox.checked=false;checkbox.dispatchEvent(new w.Event('change',{bubbles:true}));assert(!d.querySelector('.world-road-label'));
 assert.equal(d.querySelector('.world-source-base').getAttribute('href'),w.NC_CARTOGRAPHY.dossierBasemap(),'Road-label toggle does not remove source streets');
 checkbox.checked=true;checkbox.dispatchEvent(new w.Event('change',{bubbles:true}));assert(d.querySelector('.world-road-label'));
 const names=d.querySelector('[data-layer="labels"]');names.checked=false;names.dispatchEvent(new w.Event('change',{bubbles:true}));assert(!d.querySelector('.world-road-label'));assert(!d.querySelector('.world-sector-label'));
 names.checked=true;names.dispatchEvent(new w.Event('change',{bubbles:true}));
 const camera=JSON.stringify(api.getContext().view),source=d.querySelector('[data-layer="sourcePrint"]');source.checked=true;source.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(d.querySelector('.world-source-base').getAttribute('href'),w.NC_CARTOGRAPHY.overviewSource.print);assert.equal(JSON.stringify(api.getContext().view),camera,'Source comparison preserves camera');
 source.checked=false;source.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(d.querySelector('.world-source-base').getAttribute('href'),w.NC_CARTOGRAPHY.dossierBasemap());

 const metro=d.querySelector('[data-layer="metro"]');metro.checked=true;metro.dispatchEvent(new w.Event('change',{bubbles:true}));
 api.selectLocation('core-39');for(let i=0;i<8;i++)d.getElementById('zoom-in').click();
 const view=api.getContext().view,unit=Math.max(view[2]/width,view[3]/850);
 const selected=d.querySelector('.world-place-pin.selected');assert(selected,'Selected point stays visible on deep zoom');
 assert(Math.abs(Number(selected.querySelector('.pin-halo').getAttribute('r'))/unit-11)<.01,'Selected symbol remains 11 screen pixels');
 for(const t of d.querySelectorAll('.world-pin-label,.world-road-label,.world-water-label,.metro-station text')){
   if(t.style.display==='none'||t.parentNode.style.display==='none')continue;
   assert(parseFloat(t.style.strokeWidth)/unit<=3.01,'Map text halo stays within three screen pixels: '+t.className.baseVal);
 }
 d.getElementById('tools-toggle').click();d.getElementById('metro-open').click();assert.equal(workspace.dataset.panel,'map');assert(d.getElementById('metro-form'),'NCART routing is reachable through tools');d.getElementById('modal-close').click();
 assert.deepEqual(errors,[]);dom.window.close();
}
console.log('Real DOM: era switching, camera preservation, visible landmarks, detailed source base and label layers, unified search, single-drawer navigation, card expansion, NCART access and screen-sized marker halos passed at 640/390px.');
