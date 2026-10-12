/* Actual source-image refinement. No opaque shutter cells, no copied labels.
   This bounded prototype supports the square 2020 overview raster only. */
(()=>{'use strict';
const $=id=>document.getElementById(id),svg=$('map'),viewport=$('map-viewport');if(!svg||!viewport||typeof requestAnimationFrame!=='function'||typeof cancelAnimationFrame!=='function')return;
const SVG='http://www.w3.org/2000/svg',HTML='http://www.w3.org/1999/xhtml';
const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
const MAX_PIXELS=960000,MAX_SIDE=1400,DURATION=900;
let ready=false,consumed=false,pageHidden=false,panel='map',serial=0,wave=null,frame=0,loadTimer=0,zoomTimer=0,quietTimer=0,gesture=false,zoomSum=0,previous=null,cached=null,visible=true,pendingVisibility=null,visibilityTimer=0,activeKind=null;
const appearanceKey=()=>['mapPalette','treatment','digital','playerMotion'].map(k=>document.documentElement.dataset[k]||'').join('|');
let appearance=appearanceKey();
const blocked=()=>pageHidden||document.hidden||panel!=='map'||$('modal')?.open||media?.matches||document.documentElement.dataset.digital==='off'||document.documentElement.dataset.playerMotion==='off';
function stopWave(){serial++;activeKind=null;pendingVisibility=null;clearTimeout(visibilityTimer);visibilityTimer=0;cancelAnimationFrame(frame);frame=0;clearTimeout(loadTimer);loadTimer=0;if(cached){cached.image.onload=null;cached.image.onerror=null}wave?.node.remove();wave=null;delete viewport.dataset.refinement;}
function cancel(){stopWave();clearTimeout(zoomTimer);clearTimeout(quietTimer);zoomTimer=quietTimer=0;gesture=false;zoomSum=0;}
function current(){
 const source=svg.querySelector('image.world-source-base');if(!source||source.hasAttribute('transform'))return null;
 const href=source.getAttribute('href'),box=['x','y','width','height'].map((k,i)=>Number(source.getAttribute(k)||(i<2?0:NaN)));
 const view=(svg.getAttribute('viewBox')||'').trim().split(/[ ,]+/).map(Number),rect=svg.getBoundingClientRect();
 if(!href||view.length!==4||![...box,...view,rect.width,rect.height].every(Number.isFinite)||box[2]<=0||box[3]<=0||view[2]<=0||view[3]<=0||rect.width<=0||rect.height<=0||Math.abs(box[2]/box[3]-1)>.001)return null;
 // Source and viewport use the same square registration. Never guess transforms.
 const x=Math.max(box[0],view[0]),y=Math.max(box[1],view[1]),right=Math.min(box[0]+box[2],view[0]+view[2]),bottom=Math.min(box[1]+box[3],view[1]+view[3]);
 if(right<=x||bottom<=y)return null;
 return {source,href,box,view,rect,region:[x,y,right-x,bottom-y]};
}
function show(kind,info,image,ticket){
 if(ticket!==serial||blocked()||!visible||!info.source.isConnected||info.source.getAttribute('href')!==info.href)return;
 if(!image.naturalWidth||!image.naturalHeight||Math.abs(image.naturalWidth/image.naturalHeight-info.box[2]/info.box[3])>.001)return;
 // Re-read the final camera after an asynchronous resource wait.
 info=current();if(!info||info.href!==cached?.href)return;
 const ratio=Math.min(1.25,Math.max(1,window.devicePixelRatio||1));
 let width=Math.max(1,Math.ceil(info.region[2]/info.view[2]*info.rect.width*ratio)),height=Math.max(1,Math.ceil(info.region[3]/info.view[3]*info.rect.height*ratio));
 const fit=Math.min(1,MAX_SIDE/width,MAX_SIDE/height,Math.sqrt(MAX_PIXELS/(width*height)));width=Math.max(1,Math.floor(width*fit));height=Math.max(1,Math.floor(height*fit));
 const canvas=document.createElementNS(HTML,'canvas'),scratch=document.createElement('canvas');canvas.width=width;canvas.height=height;scratch.width=scratch.height=96;
 canvas.style.width='100%';canvas.style.height='100%';canvas.style.display='block';
 let ctx,sample;try{ctx=canvas.getContext('2d',{alpha:true});sample=scratch.getContext('2d',{alpha:true});}catch{return}if(!ctx||!sample)return;
 ctx.imageSmoothingEnabled=false;sample.imageSmoothingEnabled=true;
 const node=document.createElementNS(SVG,'foreignObject');node.setAttribute('class','atlas-raster-refinement');node.setAttribute('aria-hidden','true');node.setAttribute('pointer-events','none');
 ['x','y','width','height'].forEach((key,i)=>node.setAttribute(key,String(info.region[i])));node.appendChild(canvas);
 const columns=info.rect.width<560?6:8,rows=48/columns,cells=[];
 for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
  const x=Math.round(col*width/columns),y=Math.round(row*height/rows),right=Math.round((col+1)*width/columns),bottom=Math.round((row+1)*height/rows);
  if(right>x&&bottom>y)cells.push({x,y,w:right-x,h:bottom-y,delay:col*32+row*28+((col+row)%3)*11,stage:0});
 }
 const sourceScale=image.naturalWidth/info.box[2],sourceX=(info.region[0]-info.box[0])*sourceScale,sourceY=(info.region[1]-info.box[1])*sourceScale,sourceW=info.region[2]*sourceScale,sourceH=info.region[3]*sourceScale;
 function paint(cell,stage){
  if(stage===6){ctx.clearRect(cell.x,cell.y,cell.w,cell.h);return;}
  // Each tier resamples ORIGINAL pixels. A coarse tier is never upscaled as a source.
  const samples=[4,7,12,24,48,96][stage],sx=sourceX+cell.x/width*sourceW,sy=sourceY+cell.y/height*sourceH,sw=cell.w/width*sourceW,sh=cell.h/height*sourceH;
  const nx=Math.max(1,Math.min(samples,Math.ceil(sw))),ny=Math.max(1,Math.min(samples,Math.ceil(sh)));
  sample.clearRect(0,0,96,96);sample.drawImage(image,sx,sy,sw,sh,0,0,nx,ny);
  ctx.clearRect(cell.x,cell.y,cell.w,cell.h);ctx.drawImage(scratch,0,0,nx,ny,cell.x,cell.y,cell.w,cell.h);
 }
 try{for(const cell of cells)paint(cell,0)}catch{return}
 // Fully painted before attachment: there is never a blank mask over the map.
 info.source.after(node);viewport.dataset.refinement=kind;
 const start=performance.now();wave={node,kind,ticket};
 function tick(now){
  if(ticket!==serial||blocked()||!visible||!info.source.isConnected||info.source.getAttribute('href')!==info.href){stopWave();return;}
  const elapsed=Math.max(0,now-start),budgetStart=performance.now();let pending=false;
  for(const cell of cells){
   const age=elapsed-cell.delay,stage=age>=445?6:age>=365?5:age>=285?4:age>=205?3:age>=130?2:age>=60?1:0;
   if(stage>cell.stage){if(performance.now()-budgetStart>4){pending=true;break}try{paint(cell,stage)}catch{stopWave();return}cell.stage=stage;}
  }
  if(elapsed>=DURATION&&!pending){stopWave();return;}
  frame=requestAnimationFrame(tick);
 }
 frame=requestAnimationFrame(tick);
}
function request(kind){
 stopWave();if(!ready||blocked())return;activeKind=kind;
 if(!visible){const waiting={kind};pendingVisibility=waiting;visibilityTimer=setTimeout(()=>{if(pendingVisibility===waiting)stopWave()},400);return;}
 const info=current();if(!info)return;
 const ticket=serial;
 if(cached?.href!==info.href||cached.failed||(cached.image.complete&&cached.image.src&&!cached.image.naturalWidth))cached={href:info.href,image:new Image()};const image=cached.image;
 const finish=ok=>{if(ticket!==serial)return;clearTimeout(loadTimer);loadTimer=0;image.onload=null;image.onerror=null;if(ok)show(kind,info,image,ticket);};
 if(image.complete&&image.naturalWidth){finish(true);return;}
 image.onload=()=>finish(true);image.onerror=()=>{if(ticket===serial)cached.failed=true;finish(false)};loadTimer=setTimeout(()=>finish(false),1200);
 if(!image.src)image.src=info.href;
}
function entry(){if(consumed)return;consumed=true;request('entry')}
window.NC_ATLAS_REFINEMENT={entry,preview:()=>request('preview'),cancel,cancelEntry:()=>{if(activeKind==='entry')cancel()}};
window.addEventListener('nc-atlas:local-ready',()=>{ready=true;if(new URLSearchParams(location.search).get('crew')!=='1')entry()},{once:true});
window.addEventListener('nc-atlas:refinement-preview',()=>request('preview'));
window.addEventListener('nc-atlas:panel',event=>{panel=event.detail?.panel||'map';if(blocked())cancel()});
window.addEventListener('nc-atlas:camera',event=>{
 const d=event.detail,v=d?.view;if(!Array.isArray(v)||v.length!==4||!v.every(Number.isFinite)||v[2]<=0)return;
 const old=previous;previous={view:[...v],map:d.map};
 if(!old)return;
 const unchanged=old.map===d.map&&v.every((value,i)=>Math.abs(value-old.view[i])<.000001);
 if(unchanged)return; // Resume/theme layout notifications are not a new camera action.
 if(!d.interaction||old.map!==d.map){cancel();return;}
 const zoom=Math.log(old.view[2]/v[2]);
 if(zoom<-.0001){cancel();return;} // Reversing/outward zoom immediately restores the authoritative image.
 if(Math.abs(zoom)<.0001){if(Math.hypot(v[0]-old.view[0],v[1]-old.view[1])>.01)cancel();return;}
 if(blocked())return;
 zoomSum+=zoom;clearTimeout(quietTimer);quietTimer=setTimeout(()=>{gesture=false;zoomSum=0;quietTimer=0},180);
 if(!gesture&&zoomSum>=.035){gesture=true;zoomTimer=setTimeout(()=>{zoomTimer=0;request('zoom')},60);}
});
for(const type of ['pointerdown','focusin'])window.addEventListener(type,cancel,{capture:true,passive:true});
// Closing a scrolled drawer may queue a scroll notification after replay begins.
// It is no longer user input on the map; visible scroll still cancels immediately.
window.addEventListener('scroll',event=>{if(event.target?.closest?.('[hidden]'))return;cancel()},{capture:true,passive:true});
window.addEventListener('wheel',()=>{if(wave?.kind!=='zoom'&&!gesture)cancel()},{capture:true,passive:true});
window.addEventListener('keydown',e=>{if(!['+','-','='].includes(e.key)||wave?.kind!=='zoom')cancel()},{capture:true,passive:true});
window.addEventListener('resize',cancel);window.addEventListener('pagehide',()=>{pageHidden=true;cancel()});window.addEventListener('pageshow',()=>{pageHidden=false});
document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel()});media?.addEventListener?.('change',()=>{if(media.matches)cancel()});window.addEventListener('nc-atlas:appearance',()=>{const next=appearanceKey();if(next!==appearance){appearance=next;cancel()}});
const intersection=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
 visible=entries[0]?.isIntersecting!==false;
 if(visible&&pendingVisibility){const kind=pendingVisibility.kind;request(kind)}else if(!visible&&!pendingVisibility)cancel();
}):null;intersection?.observe(viewport);
window.addEventListener('pagehide',()=>intersection?.disconnect());window.addEventListener('pageshow',()=>intersection?.observe(viewport));
const observer=new MutationObserver(()=>{if(blocked())cancel()});observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-digital','data-player-motion']});if($('modal'))observer.observe($('modal'),{attributes:true,attributeFilter:['open']});
})();
