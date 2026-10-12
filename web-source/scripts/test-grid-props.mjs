import {ACTOR_HEIGHT} from '../lib/firefight/appearances.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROP_CATALOG, propFootprint, propPixelBounds, isVehicleFootprint } from '../lib/firefight/props.mjs';
import { BattleRenderer } from '../lib/firefight/renderer.mjs';
import { drawGridProp } from '../lib/firefight/prop-renderer.mjs';

test('catalog uses exact integer-cell footprints and schema-preserving quarter turns', () => {
    assert.deepEqual(propFootprint('car'), { w: 4, h: 2 });
    assert.deepEqual(propFootprint('van', 'vertical'), { w: 2, h: 5 });
    for (const type of Object.keys(PROP_CATALOG)) {
        const h = propFootprint(type), v = propFootprint(type, 'vertical');
        assert.deepEqual(h, { w: v.h, h: v.w });
    }
    assert.equal(propFootprint('__proto__'), null);
    assert.equal(propFootprint('car', 'diagonal'), null);
    assert.equal(isVehicleFootprint({ type: 'car', w: 2, h: 4 }), true);
    assert.equal(isVehicleFootprint({ type: 'car', w: 3, h: 2 }), false);
    assert.equal(isVehicleFootprint({ type: 'van', w: 5, h: 2 }), true);
});

// Record real drawing geometry after transforms, before clipping. The check must
// catch overhangs rather than hiding them behind the clip added as a safety net.
function recordingContext(bounds) {
    let matrix = [1, 0, 0, 1, 0, 0], points = 0;
    const stack = [];
    const point = (x, y) => {
        const [a,b,c,d,e,f] = matrix, px = a*x+c*y+e, py=b*x+d*y+f;
        assert(px >= bounds.x-1e-8 && px <= bounds.x+bounds.w+1e-8, 'X overhang: '+px);
        assert(py >= bounds.y-1e-8 && py <= bounds.y+bounds.h+1e-8, 'Y overhang: '+py);
        points++;
    };
    const rect = (x,y,w,h) => { point(x,y);point(x+w,y);point(x,y+h);point(x+w,y+h); };
    return {
        save(){ stack.push([...matrix]); }, restore(){ assert(stack.length);matrix=stack.pop(); },
        translate(x,y){ const [a,b,c,d,e,f]=matrix;matrix=[a,b,c,d,e+a*x+c*y,f+b*x+d*y]; },
        rotate(angle){const [a,b,c,d,e,f]=matrix,co=Math.cos(angle),si=Math.sin(angle);matrix=[a*co+c*si,b*co+d*si,c*co-a*si,d*co-b*si,e,f];},
        scale(x,y){const [a,b,c,d,e,f]=matrix;matrix=[a*x,b*x,c*y,d*y,e,f];},
        ellipse(x,y,rx,ry){point(x-rx,y-ry);point(x+rx,y+ry);},
        fillRect:rect,strokeRect:rect,rect,moveTo:point,lineTo:point,
        arc(x,y,r){point(x-r,y-r);point(x+r,y+r);},
        beginPath(){},closePath(){},setLineDash(){},clip(){},stroke(){},fill(){},
        done(){assert.equal(stack.length,0);assert(points>20);assert.deepEqual(matrix,[1,0,0,1,0,0]);},
    };
}
test('all scenery is grid-contained without atlas stretch in both orientations', () => {
    for (const type of Object.keys(PROP_CATALOG)) for (const orientation of ['horizontal','vertical',0,90,180,270]) {
        const prop={type,x:3,y:5,...propFootprint(type,orientation),...(typeof orientation==='number'?{facing:orientation}:{})};
        const c=recordingContext(propPixelBounds(prop));drawGridProp(c,prop);c.done();
    }
    for(const [w,h,facing] of [[1,2,0],[3,1,90],[1,3,180],[2,1,270]]){const prop={type:'table',x:2,y:3,w,h,facing,flipped:true};const c=recordingContext(propPixelBounds(prop));drawGridProp(c,prop);c.done();}
    for (const type of ['crate','barrel','table','counter']) {
        const prop={type,x:2,y:3,w:3,h:4};
        const c=recordingContext(propPixelBounds(prop));drawGridProp(c,prop);c.done();
    }
});
test('renderer anchors every prop at full footprint bottom and preserves human perspective',()=>{
    const renderer=readFileSync(new URL('../lib/firefight/renderer.mjs',import.meta.url),'utf8');
    assert(renderer.includes('z: p.y + p.h - .1'));
    assert(renderer.includes('else this.drawProp(p);'));
    assert(renderer.includes("fx?.kind==='flip'&&fx.propId===p.id&&!reduce"));
    assert(renderer.includes('drawGridProp(this.ctx, prop, TILE)'));
    assert(!renderer.includes("p.type === 'crate' ? 5 : 4"));
    assert.equal(ACTOR_HEIGHT,108);
    assert(renderer.includes('this.sprite(a.sprite, px, py, ACTOR_HEIGHT, undefined, a.facing < 0'));
});

test('texture cache is reused across positions, bounded and has a no-canvas fallback', () => {
    const previous = globalThis.OffscreenCanvas;
    const previousDocument = globalThis.document;
    let allocated = 0, drawn = 0;
    globalThis.OffscreenCanvas = class {
        constructor(width,height){this.width=width;this.height=height;allocated++;}
        getContext(){return recordingContext({x:0,y:0,w:this.width,h:this.height});}
    };
    try {
        const r = Object.create(BattleRenderer.prototype);r.ctx={drawImage(){drawn++;}};
        r.drawProp({type:'car',x:0,y:0,w:4,h:2});
        r.drawProp({type:'car',x:10,y:5,w:4,h:2});
        assert.equal(allocated,1);assert.equal(drawn,2);assert.equal(r.propCache.size,1);
        r.drawProp({type:'car',x:0,y:0,w:4,h:2,facing:180});assert.equal(r.propCache.size,2,'Opposite facings need distinct cached surfaces');
        for(let w=1;w<=50;w++)r.drawProp({type:'table',x:0,y:0,w,h:1});
        assert(r.propCache.size<=32);
        assert([...r.propCache.values()].reduce((n,c)=>n+c.width*c.height,0)<=2*1024*1024);
        delete globalThis.OffscreenCanvas;delete globalThis.document;
        const direct=Object.create(BattleRenderer.prototype);
        direct.ctx=recordingContext({x:0,y:0,w:64,h:64});
        direct.drawProp({type:'crate',x:0,y:0,w:1,h:1});direct.ctx.done();
    } finally {globalThis.OffscreenCanvas=previous;globalThis.document=previousDocument;}
});

test('walls and either door state never occlude the neighboring grid cell',()=>{
    const r=Object.create(BattleRenderer.prototype);
    for (const method of ['wall','closed','open']) {
        r.ctx=recordingContext({x:3*64,y:5*64,w:64,h:64});
        if(method==='wall')r.drawWall(3,5);else r.drawDoor(3,5,method==='open');
        r.ctx.done();
    }
    // The neighboring barrel's lower rim ends at y=5*64; every wall primitive
    // starts in its own y=5 cell. No inherited 22-pixel upward cap can cover it.
    r.ctx=recordingContext({x:3*64,y:4*64,w:64,h:64});
    drawGridProp(r.ctx,{type:'barrel',x:3,y:4,w:1,h:1});r.ctx.done();
});

test('connected wall caps have no internal front seam and doors follow either wall axis',()=>{
    const r=Object.create(BattleRenderer.prototype),calls=[];
    r.ctx=new Proxy({}, {get:(_,key)=> (...args)=>calls.push([key,...args]),set:()=>true});
    const state={tiles:Array.from({length:3},()=>Array.from({length:3},()=>({type:'floor'})))};r.data={state};
    state.tiles[1][1]={type:'wall'};r.drawWall(1,1);const isolated=calls.length;
    calls.length=0;for(const [x,y] of [[1,0],[1,2],[0,1],[2,1]])state.tiles[y][x]={type:'wall'};
    r.drawWall(1,1);assert(calls.length<isolated,'Internal wall edges must not draw isolated-block faces');assert(!calls.some(c=>c[0]==='strokeRect'));
    const renderDoor=vertical=>{calls.length=0;state.tiles=Array.from({length:3},()=>Array.from({length:3},()=>({type:'floor'})));state.tiles[1][1]={type:'door',open:false};for(const [x,y] of vertical?[[1,0],[1,2]]:[[0,1],[2,1]])state.tiles[y][x]={type:'wall'};r.drawDoor(1,1,false);return JSON.stringify(calls);};
    assert.notEqual(renderDoor(false),renderDoor(true));
    for(const vertical of [false,true])for(const open of [false,true]){renderDoor(vertical);r.ctx=recordingContext({x:64,y:64,w:64,h:64});r.drawDoor(1,1,open);r.ctx.done();r.ctx=new Proxy({}, {get:(_,key)=>(...args)=>calls.push([key,...args]),set:()=>true});}
});
