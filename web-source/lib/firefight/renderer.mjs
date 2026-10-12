import {propFacing} from './props.mjs';
import { SPRITE_BOUNDS, PROP_BOUNDS } from './scene.mjs';
import { actorAppearance, appearanceImageReady, ACTOR_HEIGHT, ACTOR_FOOT_ANCHOR, FALLBACK_APPEARANCE_ID } from './appearances.mjs';
import { drawGridProp } from './prop-renderer.mjs';
import { actorHeading, interpolateHeading, drawHeadingMarker } from './heading.mjs';
export const TILE = 64;
export class BattleRenderer {
    constructor(canvas, onPick, onCamera) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onPick = onPick;
        this.onCamera = onCamera;
        this.camera = { scale: .8, x: 0, y: 0 };
        this.data = null;
        this.pointers = new Map();
        this.frame = 0;
        this.effect = null;
        this.appearanceImages = new Map();
        this.disposed = false;
        this.atlas = new Image();
        this.atlas.onload = () => this.render();
        this.atlas.src = '/art/combat-atlas.png';
        this.propsAtlas = new Image();
        this.propsAtlas.onload = () => this.render();
        this.propsAtlas.src = '/art/grid-aligned-props.png';
        this.floor = new Image();
        this.floor.onload = () => this.render();
        this.floor.src = '/art/concrete-floor.png';
        this.handlers = { pointerdown: e => this.down(e), pointermove: e => this.move(e), pointerup: e => this.up(e), pointercancel: e => this.cancel(e), wheel: e => this.wheel(e) };
        for (const [k, h] of Object.entries(this.handlers))
            canvas.addEventListener(k, h, { passive: false });
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(canvas);
        this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.resize();
    }
    dispose() {
        this.disposed = true;
        for (const image of [this.atlas, this.propsAtlas, this.floor, ...this.appearanceImages.values()]) { image.onload = null; image.onerror = null; }
        this.appearanceImages.clear();
        cancelAnimationFrame(this.frame);
        this.resizeObserver.disconnect();
        this.propCache?.clear();
        for (const [k, h] of Object.entries(this.handlers))
            this.canvas.removeEventListener(k, h);
    }
    resize() {
        const center = this.initialized ? this.world({ x: this.width / 2, y: this.height / 2 }) : null;
        const rect = this.canvas.getBoundingClientRect(), ratio = Math.min(2, devicePixelRatio || 1);
        this.width = rect.width;
        this.height = rect.height;
        this.ratio = ratio;
        this.canvas.width = Math.round(rect.width * ratio);
        this.canvas.height = Math.round(rect.height * ratio);
        if (!this.initialized && this.data) {
            this.fit(true);
            this.initialized = true;
        }
        else if (center) {
            this.camera.x = this.width / 2 - center.x * this.camera.scale;
            this.camera.y = this.height / 2 - center.y * this.camera.scale;
            this.clamp();
        }
        this.render();
    }
    setData(data, effect) {
        this.data = data;
        if(typeof data?.reducedMotion==='boolean')this.reduce=data.reducedMotion;
        if (!effect) {
            this.effect = null;
            this.effectInput = null;
            this.lastEffect = null;
        }
        if (effect && effect !== this.effectInput) {
            // The same event ID may arrive with a newly redacted projection.
            // Replace its payload too, while ordinary renders never restart it.
            const start=effect.id===this.lastEffect&&this.effect?this.effect.start:performance.now();
            this.effect = { ...effect, start };
            this.effectInput=effect;
            this.lastEffect = effect.id;
        }
        if (!this.initialized && this.width && data) {
            this.fit(true);
            this.initialized = true;
        }
        this.render();
    }
    fit(initial = false) {
        if (!this.data)
            return;
        const s = this.data.state;
        this.camera.scale = Math.min((this.width - 38) / (s.width * TILE), (this.height - 40) / (s.height * TILE));
        if (initial && this.height < 420)
            this.camera.scale = Math.max(.4, this.camera.scale);
        this.camera.x = (this.width - s.width * TILE * this.camera.scale) / 2;
        this.camera.y = (this.height - s.height * TILE * this.camera.scale) / 2;
        this.onCamera?.({ ...this.camera });
        this.render();
    }
    center(actor) {
        if (!actor)
            return;
        this.camera.x = this.width / 2 - (actor.x + .5) * TILE * this.camera.scale;
        this.camera.y = this.height / 2 - (actor.y + .45) * TILE * this.camera.scale;
        this.clamp();
        this.onCamera?.({ ...this.camera });
        this.render();
    }
    clamp() {
        if (!this.data)
            return;
        const s = this.data.state, margin = 140;
        this.camera.x = Math.max(-s.width * TILE * this.camera.scale + margin, Math.min(this.width - margin, this.camera.x));
        this.camera.y = Math.max(-s.height * TILE * this.camera.scale + margin, Math.min(this.height - margin, this.camera.y));
    }
    zoom(factor, point = { x: this.width / 2, y: this.height / 2 }) {
        const c = this.camera, old = c.scale;
        c.scale = Math.max(.28, Math.min(1.8, c.scale * factor));
        c.x = point.x - (point.x - c.x) * c.scale / old;
        c.y = point.y - (point.y - c.y) * c.scale / old;
        this.clamp();
        this.onCamera?.({ ...c });
        this.render();
    }
    point(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    down(e) {
        e.preventDefault();
        this.canvas.setPointerCapture(e.pointerId);
        const p = this.point(e);
        this.pointers.set(e.pointerId, p);
        if (this.pointers.size === 1)
            this.gesture = { start: p, last: p, moved: false, multi: false };
        if (this.pointers.size >= 2) {
            this.gesture.multi = true;
            this.gesture.moved = true;
            this.pinch = this.pinchInfo();
        }
    }
    pinchInfo() { const [a, b] = [...this.pointers.values()]; return { distance: Math.hypot(a.x - b.x, a.y - b.y), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; }
    move(e) {
        if (!this.pointers.has(e.pointerId))
            return;
        e.preventDefault();
        const p = this.point(e);
        this.pointers.set(e.pointerId, p);
        if (this.pointers.size >= 2) {
            const next = this.pinchInfo();
            if (this.pinch?.distance > 0) {
                this.zoom(next.distance / this.pinch.distance, next.center);
                this.camera.x += next.center.x - this.pinch.center.x;
                this.camera.y += next.center.y - this.pinch.center.y;
                this.clamp();
            }
            this.pinch = next;
            this.render();
            return;
        }
        const g = this.gesture;
        if (!g || g.multi)
            return;
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > 7)
            g.moved = true;
        if (g.moved) {
            this.camera.x += p.x - g.last.x;
            this.camera.y += p.y - g.last.y;
            this.clamp();
            this.onCamera?.({ ...this.camera });
            this.render();
        }
        g.last = p;
    }
    up(e) {
        const g = this.gesture, p = this.point(e);
        this.pointers.delete(e.pointerId);
        if (!this.pointers.size) {
            if (g && !g.moved && !g.multi)
                this.pick(p);
            this.gesture = null;
            this.pinch = null;
        }
    }
    cancel(e) {
        this.pointers.delete(e.pointerId);
        if (!this.pointers.size) {
            this.gesture = null;
            this.pinch = null;
        }
    }
    wheel(e) { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, this.point(e)); }
    world(p) { return { x: (p.x - this.camera.x) / this.camera.scale, y: (p.y - this.camera.y) / this.camera.scale }; }
    pick(p) {
        if (!this.data)
            return;
        const w = this.world(p), s = this.data.state;
        // Prefer the visible figure, including its torso, over the underlying tile.
        const actors = s.actors.filter(a => a.status !== 'dead').sort((a, b) => b.y - a.y);
        const hit = actors.find(a => {
            const appearance = actorAppearance(a.sprite), [, , sw, sh] = appearance.sourceRect;
            const cx = (a.x + ACTOR_FOOT_ANCHOR[0]) * TILE, bottom = (a.y + ACTOR_FOOT_ANCHOR[1]) * TILE, height = ACTOR_HEIGHT;
            const half = Math.max(34, ACTOR_HEIGHT * sw / sh / 2);
            const extra = Math.max(0, 18 / this.camera.scale - half);
            return w.x >= cx - half - extra && w.x <= cx + half + extra && w.y >= bottom - height && w.y <= bottom + 8;
        });
        const cell = { x: Math.floor(w.x / TILE), y: Math.floor(w.y / TILE) };
        if (cell.x < 0 || cell.y < 0 || cell.x >= s.width || cell.y >= s.height)
            return;
        this.onPick({ ...cell, actorId: hit?.id || null });
    }
    appearanceImage(appearance) {
        if (appearance.original || this.disposed) return this.atlas;
        let image = this.appearanceImages.get(appearance.id);
        if (!image) {
            image = new Image();
            this.appearanceImages.set(appearance.id, image);
            image.onload = () => { if (!this.disposed) this.render(); };
            image.onerror = () => { image.onload = null; image.onerror = null; if (!this.disposed) this.render(); };
            image.src = appearance.url;
        }
        return image;
    }
    sprite(index, x, bottom, height, width, flip = false, opacity = 1) {
        const appearance = actorAppearance(index), candidate = this.appearanceImage(appearance);
        // Loading, broken, wrong-sized and unknown artwork safely uses the original guard.
        const ready = !appearance.original && appearanceImageReady(candidate, appearance);
        const image = ready ? candidate : this.atlas;
        if (!image.complete || !image.naturalWidth) return;
        const [sx, sy, sw, sh] = ready ? appearance.sourceRect : SPRITE_BOUNDS[appearance.original ? appearance.id : FALLBACK_APPEARANCE_ID];
        const w = width || height * sw / sh, c = this.ctx;
        c.save();
        c.imageSmoothingEnabled = false;
        c.globalAlpha = opacity;
        c.translate(x, bottom);
        if (flip) c.scale(-1, 1);
        c.drawImage(image, sx, sy, sw, sh, -w / 2, -height, w, height);
        c.restore();
    }
    propSprite(index, x, bottom, width, height) {
        if (!this.propsAtlas.complete || !this.propsAtlas.naturalWidth)
            return;
        const [sx, sy, sw, sh] = PROP_BOUNDS[index];
        this.ctx.drawImage(this.propsAtlas, sx, sy, sw, sh, x - width / 2, bottom - (height || width * sh / sw), width, height || width * sh / sw);
    }
    drawProp(prop) {
        // Draw each unique footprint once. Keep a small per-renderer cache so
        // wood/metal detail does not rerun during every phone pan/zoom frame.
        const width = prop.w * TILE, height = prop.h * TILE;
        const canCache = width * height <= 1024 * 1024;
        this.propCache ||= new Map();
        const key = `${prop.type}:${prop.w}:${prop.h}:${propFacing(prop)}:${prop.flipped===true}`;
        let surface = this.propCache.get(key);
        if (!surface && canCache) {
            if (typeof OffscreenCanvas !== 'undefined') surface = new OffscreenCanvas(width, height);
            else if (globalThis.document?.createElement) {
                surface = document.createElement('canvas'); surface.width = width; surface.height = height;
            }
            const context = surface?.getContext?.('2d');
            if (context) {
                drawGridProp(context, { ...prop, x: 0, y: 0 }, TILE);
                let pixels = [...this.propCache.values()].reduce((total, item) => total + item.width * item.height, 0);
                while (this.propCache.size && (this.propCache.size >= 32 || pixels + width * height > 2 * 1024 * 1024)) {
                    const oldest = this.propCache.keys().next().value, item = this.propCache.get(oldest);
                    pixels -= item.width * item.height; this.propCache.delete(oldest);
                }
                this.propCache.set(key, surface);
            } else surface = null;
        }
        if (surface) this.ctx.drawImage(surface, prop.x * TILE, prop.y * TILE);
        else drawGridProp(this.ctx, prop, TILE);
    }
    deviceMarker(device) {
        const c = this.ctx, x = (device.x + .5) * TILE, y = (device.y + .5) * TILE;
        c.save();
        c.fillStyle = '#142c34';
        c.strokeStyle = device.active ? '#9bd7ce' : '#b3bca0';
        c.lineWidth = 2;
        c.fillRect(x - 14, y - 13, 28, 26);
        c.strokeRect(x - 14, y - 13, 28, 26);
        if (device.type === 'port') {
            c.strokeStyle = '#9bd7ce';
            c.strokeRect(x - 7, y - 5, 14, 10);
            c.fillStyle = '#9bd7ce';
            c.fillRect(x - 2, y - 2, 4, 4);
        }
        if (device.type === 'camera') {
            c.beginPath();
            c.arc(x, y, 6, 0, Math.PI * 2);
            c.stroke();
        }
        if (device.type === 'speaker') {
            for (let n = -1; n <= 1; n++) {
                c.beginPath();
                c.moveTo(x - 7, y + n * 5);
                c.lineTo(x + 7, y + n * 5);
                c.stroke();
            }
        }
        if (device.type === 'port') {
            c.font = (13 / this.camera.scale) + 'px sans-serif';
            c.textAlign = 'center';
            c.fillStyle = '#b9d6c9';
            c.fillText('Порт деки', x, y + 20 / this.camera.scale);
        }
        c.restore();
    }
    wallConnected(x, y) {
        const tile=this.data?.state?.tiles?.[y]?.[x];
        return tile?.type==='wall'||tile?.type==='door';
    }
    drawWall(x, y) {
        const c=this.ctx,px=x*TILE,py=y*TILE;
        const north=this.wallConnected(x,y-1),south=this.wallConnected(x,y+1),west=this.wallConnected(x-1,y),east=this.wallConnected(x+1,y);
        // A continuous cap, with side faces only on exposed edges. No per-cell
        // boxes or overhang into a passable neighbouring square.
        c.fillStyle='#1b2428';c.fillRect(px,py,TILE,TILE);
        const left=west?0:4,right=east?0:7,front=south?0:18;
        c.fillStyle='#424b4c';c.fillRect(px+left,py,TILE-left-right,TILE-front);
        if(!north){c.fillStyle='#69746e';c.fillRect(px+left,py+1,TILE-left-right,3);}
        if(!west){c.fillStyle='#596660';c.fillRect(px+1,py,3,TILE-front);}
        if(!east){c.fillStyle='#273335';c.fillRect(px+TILE-7,py,7,TILE);}
        if(!south){c.fillStyle='#283336';c.fillRect(px+left,py+TILE-18,TILE-left-right,15);c.fillStyle='#182428';c.fillRect(px+left,py+TILE-3,TILE-left-right,3);c.fillStyle='#70796b';c.fillRect(px+left,py+TILE-19,TILE-left-right,2);}
        // Subtle material marks do not turn the continuous run back into tiles.
        if((x+2*y)%3===0){c.fillStyle='#98a39813';c.fillRect(px+15,py+13,25,2);}
    }
    drawDoor(x, y, open) {
        const c=this.ctx,px=x*TILE,py=y*TILE;
        const vertical=(this.wallConnected(x,y-1)||this.wallConnected(x,y+1))&&!(this.wallConnected(x-1,y)||this.wallConnected(x+1,y));
        c.fillStyle=open?'#82927726':'#16232999';c.fillRect(px+2,py+2,TILE-4,TILE-4);
        // Orient the opening, not the camera: jambs, leaf and depth stay inside this cell.
        c.fillStyle='#6b6c58';
        if(vertical){
            c.fillRect(px+17,py+2,30,6);c.fillRect(px+17,py+TILE-8,30,6);
            if(open){c.fillStyle='#354442';c.fillRect(px+5,py+3,TILE-10,9);c.fillStyle='#9cb79d';c.fillRect(px+7,py+5,TILE-14,2);}
            else{
                c.fillStyle='#141c20';c.fillRect(px+20,py+6,26,TILE-12);
                c.fillStyle='#58625e';c.fillRect(px+22,py+8,17,TILE-16);
                c.fillStyle='#7c8576';c.fillRect(px+23,py+9,3,TILE-18);
                c.fillStyle='#293637';c.fillRect(px+39,py+8,5,TILE-16);
                c.fillStyle='#c6ab70';c.fillRect(px+29,py+TILE-19,3,7);
            }
        }else{
            c.fillRect(px+2,py+17,6,30);c.fillRect(px+TILE-8,py+17,6,30);
            if(open){c.fillStyle='#354442';c.fillRect(px+3,py+5,9,TILE-10);c.fillStyle='#9cb79d';c.fillRect(px+5,py+7,2,TILE-14);}
            else{
                c.fillStyle='#141c20';c.fillRect(px+6,py+20,TILE-12,26);
                c.fillStyle='#58625e';c.fillRect(px+8,py+22,TILE-16,17);
                c.fillStyle='#7c8576';c.fillRect(px+9,py+23,TILE-18,3);
                c.fillStyle='#293637';c.fillRect(px+8,py+39,TILE-16,5);
                c.fillStyle='#c6ab70';c.fillRect(px+TILE-19,py+29,7,3);
            }
        }
        if(open){
            c.strokeStyle='#a4b79366';c.lineWidth=1;c.setLineDash([3,4]);c.beginPath();
            if(vertical){c.moveTo(px+TILE/2,py+16);c.lineTo(px+TILE/2,py+TILE-9);}
            else{c.moveTo(px+16,py+TILE/2);c.lineTo(px+TILE-9,py+TILE/2);}
            c.stroke();c.setLineDash([]);
        }
    }
    tileOutline(x, y, color, fill = false) {
        const c = this.ctx;
        c.fillStyle = color;
        if (fill)
            c.fillRect(x * TILE + 2, y * TILE + 2, TILE - 4, TILE - 4);
        c.strokeStyle = color;
        c.lineWidth = 2;
        const px = x * TILE + 4, py = y * TILE + 4, sz = TILE - 8, l = 12;
        for (const [ox, oy, dx, dy] of [[0, 0, 1, 1], [sz, 0, -1, 1], [0, sz, 1, -1], [sz, sz, -1, -1]]) {
            c.beginPath();
            c.moveTo(px + ox + dx * l, py + oy);
            c.lineTo(px + ox, py + oy);
            c.lineTo(px + ox, py + oy + dy * l);
            c.stroke();
        }
    }
    render() {
        if (this.disposed) return;
        cancelAnimationFrame(this.frame);
        if (!this.data || !this.width || !this.height)
            return;
        const c = this.ctx, s = this.data.state, cam = this.camera, now = performance.now(), fx = this.effect;
        const reduce=this.reduce||fx?.static===true;
        const visibleCells=Array.isArray(s.vision?.cells)?new Set(s.vision.cells.map(([x,y])=>x+','+y)):null;
        const point = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x>=0 && p.y>=0 && p.x<s.width && p.y<s.height && (!visibleCells||visibleCells.has(p.x+','+p.y));
        const shotGeometry=fx?.kind==='shoot'&&point(fx.from)&&point(fx.to);
        const meleeGeometry=fx?.kind==='melee'&&point(fx.from)&&point(fx.to);
        const moveGeometry=fx?.kind==='move'&&point(fx.from)&&Array.isArray(fx.path)&&fx.path.length>0&&fx.path.every(point);
        c.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
        c.imageSmoothingEnabled = false;
        c.fillStyle = '#0c1216';
        c.fillRect(0, 0, this.width, this.height);
        c.save();
        c.translate(cam.x, cam.y);
        c.scale(cam.scale, cam.scale);
        c.fillStyle = '#192026';
        c.fillRect(0, 0, s.width * TILE, s.height * TILE);
        if (this.floor.complete && this.floor.naturalWidth) {
            c.globalAlpha = .58;
            for (let y = 0; y < s.height; y += 4)
                for (let x = 0; x < s.width; x += 4)
                    c.drawImage(this.floor, x * TILE, y * TILE, 4 * TILE, 4 * TILE);
            c.globalAlpha = 1;
        }
        for (let y = 0; y < s.height; y++)
            for (let x = 0; x < s.width; x++) {
                const t = s.tiles[y][x];
                c.fillStyle = t.zone === 'street' ? '#0a172066' : t.zone === 'office' ? '#45341928' : '#14212944';
                c.fillRect(x * TILE, y * TILE, TILE, TILE);
                if (this.data.grid) {
                    c.strokeStyle = '#889f9a20';
                    c.lineWidth = 1;
                    c.strokeRect(x * TILE, y * TILE, TILE, TILE);
                }
            }
        // Functional geometry and subdued lighting stay aligned to the collision map.
        for (const [x, y, color] of [[13, 3, '#e5b563'], [7, 12, '#59aeb6'], [19, 4, '#ba8054']]) {
            const g = c.createRadialGradient((x + .5) * TILE, (y + .5) * TILE, 0, (x + .5) * TILE, (y + .5) * TILE, TILE * 5);
            g.addColorStop(0, color + '25');
            g.addColorStop(1, color + '00');
            c.fillStyle = g;
            c.fillRect((x - 5) * TILE, (y - 5) * TILE, TILE * 10, TILE * 10);
        }
        c.fillStyle = '#a9c7c138';
        c.font = '16px sans-serif';
        c.textAlign = 'center';
        c.fillText('ВХОД', 7.5 * TILE, 14.6 * TILE);
        c.fillStyle = '#c6b98a33';
        c.font = '14px sans-serif';
        c.fillText('ПОДСОБКА', 19.5 * TILE, 3.45 * TILE);
        const preview = this.data.preview;
        if (preview?.path) {
            for (const p of preview.path) {
                c.fillStyle = '#8ed3d12b';
                c.fillRect(p.x * TILE + 3, p.y * TILE + 3, TILE - 6, TILE - 6);
            }
            const a = preview.actor;
            c.beginPath();
            c.moveTo((a.x + .5) * TILE, (a.y + .5) * TILE);
            for (const p of preview.path)
                c.lineTo((p.x + .5) * TILE, (p.y + .5) * TILE);
            c.strokeStyle = '#9bd8d2';
            c.lineWidth = 3;
            c.setLineDash([6, 5]);
            c.stroke();
            c.setLineDash([]);
        }
        if (this.data.propGhost) { c.save(); c.globalAlpha=.6; this.drawProp(this.data.propGhost); c.restore(); }
        if (preview?.footprint) {
            const p = preview.footprint;
            c.fillStyle = '#ddb76b28';
            c.fillRect(p.x * TILE, p.y * TILE, p.w * TILE, p.h * TILE);
            c.strokeStyle = '#ddb76b';
            c.lineWidth = 2;
            c.strokeRect(p.x * TILE + 1, p.y * TILE + 1, p.w * TILE - 2, p.h * TILE - 2);
        }
        if (this.data.cell)
            this.tileOutline(this.data.cell.x, this.data.cell.y, this.data.preview?.ok === false ? '#d58b75' : '#ddb76b');
        if (s.vision) {
            const visible=new Set((s.vision.cells||[]).map(([x,y])=>x+','+y));
            c.fillStyle='#070c10';
            for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++)if(!visible.has(x+','+y))c.fillRect(x*TILE,y*TILE,TILE,TILE);
        }
        const drawables = [];
        for (let y = 0; y < s.height; y++)
            for (let x = 0; x < s.width; x++) {
                const t = s.tiles[y][x];
                if (t.type === 'wall')
                    drawables.push({ z: y + .2, draw: () => this.drawWall(x, y) });
                if (t.type === 'door')
                    drawables.push({ z: y + .3, draw: () => this.drawDoor(x, y, t.open) });
            }
        for (const edge of s.vision?.obstacles || []) {
            const px=edge.x*TILE,py=edge.y*TILE;
            c.fillStyle='#343f40';c.fillRect(px+3,py+3,TILE-6,TILE-6);
            c.strokeStyle='#85958b66';c.lineWidth=2;
            for(let i=12;i<TILE-8;i+=12){c.beginPath();c.moveTo(px+i,py+7);c.lineTo(px+7,py+i);c.stroke();}
            c.strokeRect(px+3,py+3,TILE-6,TILE-6);
        }
        for (const p of s.props)
            drawables.push({ z: p.y + p.h - .1, draw: () => {if(fx?.kind==='flip'&&fx.propId===p.id&&!reduce){const t=Math.min(1,(now-fx.start)/550),base=(p.y+p.h)*TILE;c.save();c.translate(0,base);c.scale(1,.65+.35*(1-Math.pow(1-t,3)));c.translate(0,-base);this.drawProp(p);c.restore();}else this.drawProp(p);} });
        for (const device of (s.devices || []).filter(d=>!d.remoteOnly&&Number.isInteger(d.x)&&Number.isInteger(d.y)))
            if (device.type !== 'door')
                drawables.push({ z: device.y + .5, draw: () => this.deviceMarker(device) });
        for (const a of s.actors) {
            const port = (s.devices || []).find(d => d.id === a.net?.linkedPortId);
            if (port && !port.remoteOnly && Number.isInteger(port.x) && Number.isInteger(port.y)) {
                c.strokeStyle = '#8dd4cf88';
                c.lineWidth = 2;
                c.setLineDash([4, 4]);
                c.beginPath();
                c.moveTo((a.x + .5) * TILE, (a.y + .7) * TILE);
                c.lineTo((port.x + .5) * TILE, (port.y + .5) * TILE);
                c.stroke();
                c.setLineDash([]);
            }
        }
        for (const a of s.actors)
            drawables.push({ z: a.y + .85, draw: () => {
                    let x = a.x, y = a.y;
                    if (moveGeometry && fx.actorIds?.[0] === a.id && !reduce) {
                        const elapsed = Math.min(1, (now - fx.start) / Math.max(240, Math.min(1100, (fx.path?.length || 1) * 85)));
                        const route = [fx.from, ...fx.path], position = elapsed * (route.length - 1), index = Math.min(route.length - 2, Math.floor(position)), t = position - index;
                        if (index >= 0) {
                            x = route[index].x + (route[index + 1].x - route[index].x) * t;
                            y = route[index].y + (route[index + 1].y - route[index].y) * t;
                        }
                    }
                    if (meleeGeometry&&fx.actorIds?.[0]===a.id&&!reduce) {const t=Math.min(1,(now-fx.start)/600),length=Math.hypot(fx.to.x-fx.from.x,fx.to.y-fx.from.y)||1,lunge=Math.sin(t*Math.PI)*.2;x+=(fx.to.x-fx.from.x)/length*lunge;y+=(fx.to.y-fx.from.y)/length*lunge;}
                    if (shotGeometry && fx.actorIds?.[0] === a.id && !reduce) {
                        const t = now - fx.start;
                        if (t < 180) {
                            const length = Math.hypot(fx.to.x - fx.from.x, fx.to.y - fx.from.y) || 1;
                            const recoil = Math.sin(t / 180 * Math.PI) * .12;
                            x -= (fx.to.x - fx.from.x) / length * recoil;
                            y -= (fx.to.y - fx.from.y) / length * recoil;
                        }
                    }
                    const px = (x + ACTOR_FOOT_ANCHOR[0]) * TILE, py = (y + ACTOR_FOOT_ANCHOR[1]) * TILE, selected = this.data.selectedId === a.id, turn = this.data.activeId === a.id, target = this.data.targetId === a.id;
                    c.fillStyle = '#03090b99';
                    c.beginPath();
                    c.ellipse(px, py, 26, 10, 0, 0, Math.PI * 2);
                    c.fill();
                    if (selected || turn || target) {
                        c.strokeStyle = target ? '#de826e' : a.team === 'crew' ? '#9dd0c8' : '#dba968';
                        c.lineWidth = selected ? 3 : 2;
                        c.setLineDash(a.hidden ? [5, 4] : []);
                        c.beginPath();
                        c.ellipse(px, py, 29, 12, 0, 0, Math.PI * 2);
                        c.stroke();
                        c.setLineDash([]);
                    }
                    if (a.status === 'dead') {
                        c.save();
                        c.translate(px, py - 6);
                        c.rotate(Math.PI / 2);
                        c.filter = 'grayscale(1)';
                        this.sprite(a.sprite, 0, 0, 90, undefined, false, .6);
                        c.restore();
                    }
                    else {
                        c.save();
                        if (fx?.kind === 'shoot' && fx.hit && fx.actorIds[1] === a.id && now - fx.start > 170 && now - fx.start < 430 && !reduce)
                            c.filter = 'brightness(1.75)';
                        this.sprite(a.sprite, px, py, ACTOR_HEIGHT, undefined, a.facing < 0, a.hidden ? .48 : 1);
                        c.restore();
                    }
                    if (a.status === 'active') {
                        const confirmed=actorHeading(a),turning=fx?.kind==='face'&&fx.actorIds?.[0]===a.id&&Number.isInteger(fx.fromHeading)&&!reduce;
                        const heading=turning?interpolateHeading(fx.fromHeading,confirmed,(now-fx.start)/220):confirmed;
                        drawHeadingMarker(c,px,py,heading,{selected,alpha:a.hidden?.48:1,screenScale:cam.scale});
                        if(selected&&preview?.type==='face'&&Number.isInteger(preview.heading))drawHeadingMarker(c,px,py,preview.heading,{selected:true,preview:true,alpha:.75,screenScale:cam.scale});
                    }
                    if (fx?.kind==='reload'&&fx.actorIds?.[0]===a.id&&(reduce||now-fx.start<400)) {
                        c.save();c.strokeStyle='#edc77b';c.lineWidth=3;c.beginPath();const pulse=reduce?0:(now-fx.start)/400;
                        c.arc(px,py-25,13+pulse*5,-Math.PI/2,Math.PI*(1.25+pulse*.5));c.stroke();c.restore();
                    }
                    if (a.status === 'stunned') {
                        c.fillStyle = '#e1b968';
                        c.font = 'bold 20px sans-serif';
                        c.textAlign = 'center';
                        c.fillText('!', px, py - 115);
                    }
                    if (selected || turn || target) {
                        c.font = '500 ' + (14 / cam.scale) + 'px sans-serif';
                        c.textAlign = 'center';
                        const name = a.name + (a.hidden ? ' · скрыт' : '');
                        const width = c.measureText(name).width + 16 / cam.scale;
                        c.fillStyle = '#0c141be8';
                        c.fillRect(px - width / 2, py - 145, width, 24 / cam.scale);
                        c.fillStyle = target ? '#f0b09c' : '#e8e5d6';
                        c.fillText(name, px, py - 145 + 17 / cam.scale);
                    }
                } });
        drawables.sort((a, b) => a.z - b.z).forEach(item => item.draw());
        for (const aim of preview?.targets?.length ? preview.targets : preview?.target ? [preview.target] : []) {
            c.beginPath();
            c.moveTo((preview.actor.x + .5) * TILE, (preview.actor.y + .2) * TILE);
            c.lineTo((aim.x + .5) * TILE, (aim.y + .2) * TILE);
            c.strokeStyle = preview.ok ? '#dcb566' : '#de826e';
            c.lineWidth = 2;
            c.setLineDash([8, 6]);
            c.stroke();
            c.setLineDash([]);
            const cover=(preview.lines?.find(line=>line.targetId===aim.id)||preview.line)?.cover;
            if (point(cover))this.tileOutline(cover.x, cover.y, '#91c6b7');
        }
        if (this.data.ghost) {
            this.sprite(this.data.ghost.sprite, (this.data.ghost.x + ACTOR_FOOT_ANCHOR[0]) * TILE, (this.data.ghost.y + ACTOR_FOOT_ANCHOR[1]) * TILE, ACTOR_HEIGHT, undefined, false, .55);
        }
        if (fx && now - fx.start < 1400) {
            const t = now - fx.start;
            if (shotGeometry && !reduce) {
                const from = { x: (fx.from.x + .65) * TILE, y: (fx.from.y + .2) * TILE };
                const locHeight = fx.location === 'head' ? -.65 : fx.location?.includes('Leg') ? .55 : .08;
                const to = { x: (fx.to.x + .5) * TILE + (fx.hit ? 0 : (fx.roll % 2 ? 65 : -65)), y: (fx.to.y + (fx.hit ? locHeight : -1.55)) * TILE };
                const dx = to.x - from.x, dy = to.y - from.y;
                if (t < 145) {
                    c.save();
                    c.translate(from.x, from.y);
                    c.rotate(Math.atan2(dy, dx));
                    c.globalAlpha = 1 - t / 145;
                    c.fillStyle = '#fff1b5';
                    c.beginPath();
                    c.moveTo(-3, -5);
                    c.lineTo(25, 0);
                    c.lineTo(-3, 5);
                    c.closePath();
                    c.fill();
                    c.fillStyle = '#eab05b';
                    c.fillRect(0, -10, 5, 20);
                    c.restore();
                }
                if (t < 280) {
                    const p = Math.min(1, t / 230), tail = Math.max(0, p - .18);
                    c.strokeStyle = '#fff0b4';
                    c.lineWidth = 3;
                    c.beginPath();
                    c.moveTo(from.x + dx * tail, from.y + dy * tail);
                    c.lineTo(from.x + dx * p, from.y + dy * p);
                    c.stroke();
                }
                if (t > 170 && t < 600) {
                    const age = (t - 170) / 430;
                    c.globalAlpha = 1 - age;
                    c.fillStyle = !fx.hit || !fx.damage ? '#e7c17a' : '#d58c74';
                    for (let i = 0; i < 7; i++) {
                        const angle = i * 2.4 + (fx.roll || 1), speed = 12 + i * 4;
                        c.fillRect(to.x + Math.cos(angle) * speed * age - 2, to.y + Math.sin(angle) * speed * age + age * age * 12 - 2, 3, 3);
                    }
                    c.globalAlpha = 1;
                }
                if (t < 420) {
                    const age = t / 420;
                    c.save();
                    c.translate(from.x - 12 - age * 22, from.y + age * age * 48);
                    c.rotate(age * 8);
                    c.fillStyle = '#bc995f';
                    c.fillRect(-2, -4, 4, 8);
                    c.restore();
                }
            }
            if (shotGeometry || meleeGeometry) {
                c.globalAlpha = reduce ? 1 : Math.max(0, 1 - t / 1400);
                c.font = 'bold ' + (16 / cam.scale) + 'px sans-serif';
                c.textAlign = 'center';
                c.fillStyle = fx.damage ? '#f4aa8f' : '#f2d89b';
                c.fillText(fx.hit ? (fx.damage ? '-' + fx.damage : 'БРОНЯ') : 'МИМО', (fx.to.x + .5) * TILE, (fx.to.y - 1.25) * TILE - (reduce ? 0 : t * .018));
                c.globalAlpha = 1;
            }
            if(fx.kind==='flip'){const prop=s.props.find(p=>p.id===fx.propId);if(prop){c.strokeStyle='#b7dca0';c.lineWidth=2/cam.scale;c.strokeRect(prop.x*TILE+2,prop.y*TILE+2,prop.w*TILE-4,prop.h*TILE-4);}}
            if (['switch','reload','unjam'].includes(fx.kind)) {const unit=s.actors.find(a=>a.id===fx.actorIds?.[0]);if(unit){this.tileOutline(unit.x,unit.y,'#9bd7ce');c.font='bold '+(12/cam.scale)+'px sans-serif';c.textAlign='center';c.fillStyle='#bce2d6';c.fillText(({switch:'ОРУЖИЕ',reload:'МАГАЗИН',unjam:'ЗАДЕРЖКА'})[fx.kind],(unit.x+.5)*TILE,(unit.y-.9)*TILE);}}
            if (['control','door'].includes(fx.kind) && point(fx.at)) {
                this.tileOutline(fx.at.x, fx.at.y, fx.kind==='door'||fx.success ? '#9bd7ce' : '#d58c74');
            }
        }
        else
            this.effect = null;
        c.restore();
        const vignette = c.createRadialGradient(this.width / 2, this.height / 2, this.height * .25, this.width / 2, this.height / 2, Math.max(this.width, this.height) * .7);
        vignette.addColorStop(0, '#07101600');
        vignette.addColorStop(1, '#07101670');
        c.fillStyle = vignette;
        c.fillRect(0, 0, this.width, this.height);
        if (this.effect && !reduce)
            this.frame = requestAnimationFrame(() => this.render());
    }
}
