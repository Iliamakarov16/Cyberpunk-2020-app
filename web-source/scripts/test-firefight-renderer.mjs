import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleRenderer } from '../lib/firefight/renderer.mjs';
import { createDemoScene } from '../lib/firefight/scene.mjs';
test('same-ID effect redaction replaces geometry and ordinary renders never restart it',()=>{
 const r=Object.create(BattleRenderer.prototype);r.render=()=>{};r.initialized=true;
 const data={state:createDemoScene(),reducedMotion:false},event={id:'event-1-a',kind:'shoot',from:{x:1,y:1},to:{x:2,y:2}};
 r.setData(data,event);const start=r.effect.start;r.setData(data,event);assert.equal(r.effect.start,start);
 const safe={id:event.id,kind:'shoot',static:true};r.setData(data,safe);assert.equal(r.effect.static,true);assert(!('from' in r.effect));assert(!('to' in r.effect));
 r.effect=null;r.setData(data,safe);assert.equal(r.effect,null,'Expired same object cannot restart');
 r.setData(data,null);assert.equal(r.effectInput,null);
});
// Role projections are server-owned. These fixtures only exercise the original camera.
const viewFor = (scene, role) => ({...scene,actors:scene.actors.filter(a=>role==='gm'||!a.hidden)});
function renderer(width = 844, height = 269) {
    globalThis.Image = class {
        complete = false;
        naturalWidth = 0;
    };
    globalThis.ResizeObserver = class {
        observe() { }
        disconnect() { }
    };
    globalThis.matchMedia = () => ({ matches: true });
    globalThis.devicePixelRatio = 1;
    globalThis.cancelAnimationFrame = () => { };
    globalThis.requestAnimationFrame = () => 0;
    const picks = [], rect = { left: 0, top: 0, width, height };
    const canvas = { getContext: () => ({}), getBoundingClientRect: () => rect, addEventListener() { }, removeEventListener() { }, setPointerCapture() { } };
    const r = new BattleRenderer(canvas, c => picks.push(c));
    r.render = () => { };
    r.setData({ state: viewFor(createDemoScene(), 'gm') }, null);
    const event = (id, x, y) => ({ pointerId: id, clientX: x, clientY: y, preventDefault() { } });
    return { r, picks, rect, event };
}
test('short tap selects a cell without changing scene state', () => {
    const { r, picks, event } = renderer();
    const before = JSON.stringify(r.data.state);
    r.down(event(1, 400, 120));
    r.up(event(1, 400, 120));
    assert.equal(picks.length, 1);
    assert.equal(JSON.stringify(r.data.state), before);
    r.dispose();
});
test('drag, pointer cancellation and pinch never become a cell tap', () => {
    const { r, picks, event } = renderer();
    r.down(event(1, 300, 120));
    r.move(event(1, 330, 140));
    r.up(event(1, 330, 140));
    r.down(event(2, 300, 120));
    r.cancel(event(2, 300, 120));
    const scale = r.camera.scale;
    r.down(event(3, 300, 120));
    r.down(event(4, 400, 120));
    r.move(event(4, 450, 120));
    r.up(event(4, 450, 120));
    r.up(event(3, 300, 120));
    assert.equal(picks.length, 0);
    assert.ok(r.camera.scale > scale);
    r.dispose();
});
test('phone starts at a readable zoom; fit button can still show the whole map', () => {
    const { r } = renderer();
    assert.ok(r.camera.scale >= .4);
    r.fit();
    assert.ok(r.camera.scale < .3);
    r.dispose();
});
test('rotation retains the same point in the center of the camera', () => {
    const { r, rect } = renderer();
    const center = r.world({ x: r.width / 2, y: r.height / 2 });
    rect.width = 1360;
    rect.height = 650;
    r.resize();
    const after = r.world({ x: r.width / 2, y: r.height / 2 });
    assert.ok(Math.abs(center.x - after.x) < 1e-6);
    assert.ok(Math.abs(center.y - after.y) < 1e-6);
    r.dispose();
});
test('switching views clears a previous shot effect with hidden actor positions', () => {
    const { r } = renderer();
    r.setData(r.data, { id: 'shot', kind: 'shoot', from: { x: 19, y: 5 }, to: { x: 6, y: 10 } });
    assert.ok(r.effect);
    r.setData({ state: viewFor(createDemoScene(), 'player', 'ray') }, null);
    assert.equal(r.effect, null);
    assert.equal(r.lastEffect, null);
    r.dispose();
});
