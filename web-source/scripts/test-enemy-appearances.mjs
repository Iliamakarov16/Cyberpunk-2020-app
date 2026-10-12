import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ACTOR_APPEARANCES,actorAppearance,isActorAppearanceId,appearanceImageReady,ACTOR_HEIGHT,ACTOR_FOOT_ANCHOR} from '../lib/firefight/appearances.mjs';
import {BattleRenderer,TILE} from '../lib/firefight/renderer.mjs';
import {SPRITE_BOUNDS} from '../lib/firefight/scene.mjs';

test('static crops reference unchanged RGBA PNGs and preserve original IDs',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../../provenance/enemy-sprites-v1/manifest.json',import.meta.url),'utf8'));
 assert.equal(ACTOR_APPEARANCES.length,12);
 for(const a of ACTOR_APPEARANCES){
  assert.equal(actorAppearance(a.id),a);assert.match(a.url,/^\/art\/(?:combat-atlas\.png|enemies-v1\/[a-z0-9-]+\.png)$/);
  const png=await readFile(new URL('../public'+a.url,import.meta.url));
  assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],a.dimensions);
  const [x,y,w,h]=a.sourceRect;assert(x>=0&&y>=0&&w>0&&h>0&&x+w<=a.dimensions[0]&&y+h<=a.dimensions[1]);
  if(a.id<4)assert.deepEqual(a.sourceRect,SPRITE_BOUNDS[a.id]);
  else{assert.equal(png[25],6);const original=manifest.sprites.find(row=>row.appearanceId===a.id);assert(original);assert.deepEqual(a.sourceRect,original.sourceRect);assert.equal(createHash('sha256').update(png).digest('hex'),original.sourceSha256);}
 }
 assert.equal(ACTOR_HEIGHT,108);assert.deepEqual(ACTOR_FOOT_ANCHOR,[.5,.86]);
});
test('invalid cosmetic identifiers cannot supply a URL or crop',()=>{
 for(const id of [-1,12,1.5,true,false,null,undefined,'4','https://example.invalid/actor.png',NaN]){assert.equal(isActorAppearanceId(id),false);assert.equal(actorAppearance(id).id,2);}
 for(let id=0;id<12;id++)assert.equal(isActorAppearanceId(id),true);
});
function make(){
 globalThis.Image=class{complete=false;naturalWidth=0;naturalHeight=0;};globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 globalThis.matchMedia=()=>({matches:true});globalThis.devicePixelRatio=1;globalThis.cancelAnimationFrame=()=>{};globalThis.requestAnimationFrame=()=>0;
 const calls=[],picks=[],ctx={save(){},restore(){},translate(...args){calls.push(['translate',...args]);},scale(...args){calls.push(['scale',...args]);},drawImage(...args){calls.push(['draw',...args]);}};
 const canvas={getContext:()=>ctx,getBoundingClientRect:()=>({width:900,height:412}),addEventListener(){},removeEventListener(){}};
 const r=new BattleRenderer(canvas,p=>picks.push(p));r.atlas.complete=true;r.atlas.naturalWidth=1774;r.atlas.naturalHeight=887;
 return {r,calls,picks};
}
test('new images load lazily once, fallback safely, retain crop, scale and mirroring',()=>{
 const {r,calls}=make(),a=actorAppearance(10);assert.equal(r.appearanceImages.size,0);
 const image=r.appearanceImage(a);assert.equal(image.src,a.url);assert.equal(r.appearanceImage(a),image);assert.equal(r.appearanceImages.size,1);
 r.sprite(10,100,180,108,undefined,true);assert.equal(calls.find(c=>c[0]==='draw')[1],r.atlas);
 calls.length=0;Object.assign(image,{complete:true,naturalWidth:a.dimensions[0],naturalHeight:a.dimensions[1]});assert(appearanceImageReady(image,a));
 r.sprite(10,100,180,108,undefined,true);const draw=calls.find(c=>c[0]==='draw');assert.equal(draw[1],image);assert.deepEqual(draw.slice(2,6),a.sourceRect);assert.equal(draw.at(-1),108);assert(calls.some(c=>c[0]==='scale'&&c[1]===-1));
 image.naturalWidth--;assert.equal(appearanceImageReady(image,a),false);calls.length=0;r.sprite(10,100,180,108);assert.equal(calls.find(c=>c[0]==='draw')[1],r.atlas);r.dispose();
});
test('wide figure edge picks the visible actor and not only a narrow center',()=>{
 const {r,picks}=make();r.camera={x:0,y:0,scale:1};r.data={state:{width:20,height:20,actors:[{id:'heavy',sprite:10,x:4,y:4,status:'active'}]}};
 r.pick({x:(4.5)*TILE+42,y:(4+.86)*TILE-60});assert.equal(picks.at(-1).actorId,'heavy');
 r.pick({x:(4.5)*TILE+48,y:(4+.86)*TILE-60});assert.equal(picks.at(-1).actorId,null);r.dispose();
});
test('disposing clears every image handler and queued render becomes a no-op',()=>{
 const {r}=make(),image=r.appearanceImage(actorAppearance(4)),queued=[r.atlas.onload,r.propsAtlas.onload,r.floor.onload,image.onload];
 r.dispose();assert.equal(r.appearanceImages.size,0);for(const im of [r.atlas,r.propsAtlas,r.floor,image]){assert.equal(im.onload,null);assert.equal(im.onerror,null);}
 r.ctx=null;for(const callback of queued)assert.doesNotThrow(callback);assert.doesNotThrow(()=>r.render());
});
