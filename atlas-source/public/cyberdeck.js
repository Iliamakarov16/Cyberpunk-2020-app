/* Passive optical feedback. Camera, geography and hit regions remain authoritative. */
(()=>{'use strict';
const $=id=>document.getElementById(id),ring=$('atlas-optical-register');if(!ring)return;
const ticks=ring.querySelector('.ring-ticks'),arcs=ring.querySelector('.ring-arcs'),edge=ring.querySelector('.ring-edge'),readout=$('atlas-relative-zoom'),media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
let previous=null,baseWidth=0,relative=1,settleTimer=0,hiddenPage=false,intersecting=true,panel='map';

const disabled=()=>hiddenPage||document.hidden||!intersecting||panel!=='map'||!!$('modal')?.open||media?.matches||document.documentElement.dataset.digital==='off'||document.documentElement.dataset.playerMotion==='off';
function settle(){clearTimeout(settleTimer);settleTimer=0;ring.classList.remove('is-active','is-panning');ticks.style.transform='scale(1)';arcs.style.transform=`rotate(${25+Math.log2(Math.max(.01,relative))*18}deg)`;edge.style.opacity='';}
function refresh(){const pause=disabled();ring.classList.toggle('is-paused',pause);if(pause)settle();}
function camera(e){const d=e.detail,v=d?.view;if(!Array.isArray(v)||v.length!==4||!v.every(Number.isFinite)||v[2]<=0||v[3]<=0||!Number.isFinite(d.width)||!Number.isFinite(d.height)||d.width<=0||d.height<=0)return;
 const same=previous?.map===d.map;if(!same)baseWidth=v[2];relative=baseWidth/v[2];if(readout)readout.textContent=`×${relative.toFixed(2)} · ${d.map==='city2020'?'ОБЗОР':'ПЛАН'}`;
 const old=previous;previous={view:[...v],map:d.map};refresh();if(!same||!old||!d.interaction){settle();return;}if(disabled())return;
 const z=Math.log(old.view[2]/v[2]),unit=Math.max(v[2]/d.width,v[3]/d.height),dx=((old.view[0]+old.view[2]/2)-(v[0]+v[2]/2))/unit,dy=((old.view[1]+old.view[3]/2)-(v[1]+v[3]/2))/unit;
 if(Math.abs(z)<1e-8&&Math.hypot(dx,dy)<.05)return;
 ring.classList.add('is-active');ticks.style.transform=`scale(${1+Math.max(-.045,Math.min(.045,z*.2))})`;arcs.style.transform=`rotate(${25+Math.log2(Math.max(.01,relative))*18+Math.max(-7,Math.min(7,z*20))}deg)`;
 if(Math.hypot(dx,dy)>.5){ring.classList.add('is-panning');edge.style.transform=`rotate(${Math.atan2(dy,dx)*180/Math.PI+90}deg)`;}
 clearTimeout(settleTimer);settleTimer=setTimeout(settle,180);
}
window.addEventListener('nc-atlas:camera',camera);window.addEventListener('nc-atlas:panel',e=>{panel=e.detail?.panel||'map';refresh()});window.addEventListener('nc-atlas:appearance',refresh);
document.addEventListener('visibilitychange',refresh);media?.addEventListener?.('change',refresh);
const observer=typeof MutationObserver==='function'?new MutationObserver(refresh):null;function observe(){observer?.observe(document.documentElement,{attributes:true,attributeFilter:['data-digital','data-player-motion']});if($('modal'))observer?.observe($('modal'),{attributes:true,attributeFilter:['open']})}observe();
const intersection=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{intersecting=entries[0]?.isIntersecting!==false;refresh()}):null;intersection?.observe($('map-viewport'));
window.addEventListener('pagehide',()=>{hiddenPage=true;settle();refresh();observer?.disconnect();intersection?.disconnect()});window.addEventListener('pageshow',()=>{hiddenPage=false;observe();intersection?.observe($('map-viewport'));refresh()});
refresh();
})();
