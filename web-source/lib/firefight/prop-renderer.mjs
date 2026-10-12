import { propPixelBounds, propFacing } from './props.mjs';
import { drawVehicle } from './vehicle-renderer.mjs';

// Original code-native 2.5D artwork. The camera and light stay fixed while the
// object turns. Ground anchors and every face stay inside occupied integer cells.
// Upright character artwork is intentionally unaffected.
function panel(c, x, y, w, h, fill, stroke = '#141d1f') {
    c.fillStyle = fill;
    c.fillRect(x, y, w, h);
    c.strokeStyle = stroke;
    c.lineWidth = 2;
    c.strokeRect(x + 1, y + 1, w - 2, h - 2);
}
function line(c, x1, y1, x2, y2, color, width = 1) {
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
}
function weathering(c, x, y, w, h, seed, wood = false) {
    let state = seed;
    const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    for (let n = 0; n < Math.min(120, w * h / 30); n++) {
        const length = wood ? 4 + next() * Math.min(35, w / 3) : 1 + next() * 3;
        const px = x + next() * Math.max(0, w - length), py = y + next() * Math.max(0, h - 1);
        c.fillStyle = n % 3 ? '#10191b24' : '#e1cfa526';
        c.fillRect(px, py, length, wood ? .7 : 1);
    }
}
function furniture(c, w, h, counter) {
    panel(c, 4, 4, w - 8, h - 8, '#111b1e');
    panel(c, 7, 7, w - 14, h - 14, counter ? '#6c5037' : '#775437', '#382b22');
    c.fillStyle = '#a17a4b'; c.fillRect(10, 10, w - 20, 3);
    c.fillStyle = '#382d25'; c.fillRect(10, h - 15, w - 20, 4);
    for (let y = 21; y < h - 18; y += 9) {
        line(c, 12, y, w - 12, y, '#b18a572d');
        line(c, 18 + y % 13, y + 3, w - 20 - y % 19, y + 3, '#372d263b');
    }
    weathering(c, 15, 15, w - 30, h - 30, 193, true);
    if (counter) {
        c.fillStyle = '#a99463'; c.fillRect(9, 8, 4, h - 16); c.fillRect(w - 13, 8, 4, h - 16);
        for (let x = 64; x < w - 16; x += 64) line(c, x, 15, x, h - 16, '#3b322780', 2);
    } else {
        for (const x of [10, w - 14]) for (const y of [10, h - 14]) {
            c.fillStyle = '#c1a674'; c.fillRect(x, y, 3, 3);
        }
    }
}
function crate(c, tile) {
    panel(c, 4, 4, tile - 8, tile - 8, '#1b2528');
    panel(c, 8, 8, tile - 16, tile - 16, '#61635b', '#969486');
    panel(c, 15, 15, tile - 30, tile - 30, '#454d4c', '#303b3d');
    weathering(c, 16, 16, tile - 32, tile - 32, 49);
    c.fillStyle = '#242e31'; c.fillRect(9, tile / 2 - 3, tile - 18, 6);
    for (const x of [10, tile - 18]) for (const y of [10, tile - 18]) {
        panel(c, x, y, 8, 8, '#7a7e70', '#343f40');
    }
    c.fillStyle = '#b29653'; c.fillRect(tile / 2 - 5, tile / 2 - 3, 10, 6);
}
function barrel(c, tile) {
    const mid = tile / 2;
    for (const [radius, color] of [[tile * .43, '#142023'], [tile * .39, '#8b7859'], [tile * .34, '#314346'], [tile * .29, '#52605a']]) {
        c.fillStyle = color; c.beginPath(); c.arc(mid, mid, radius, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = '#a69a735e'; c.lineWidth = 2; c.beginPath(); c.arc(mid, mid, tile * .32, Math.PI, Math.PI * 1.75); c.stroke();
    // Small scuffs remain inside the circular lid rather than its square bounds.
    weathering(c, mid - tile * .19, mid - tile * .19, tile * .38, tile * .38, 93);
    c.fillStyle = '#17292c'; c.beginPath(); c.arc(mid + tile * .14, mid - tile * .12, tile * .07, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#897153'; c.fillRect(mid - 3, 5, 6, 4); c.fillRect(mid - 3, tile - 9, 6, 4);
}
// Fixed screen-down depth. Rotating only the plan details avoids sideways legs,
// highlights and shadows; no skewed ground plane or extra collision footprint.
function volume(c, type, w, h, facing, tile) {
    const vehicleType=type==='car'||type==='van';
    if(vehicleType){drawVehicle(c,w,h,facing,type==='van',tile);return;}
    const depth=Math.min(h*.4, type==='barrel'?25:type==='table'?24:25);
    const topH=h-depth, bottom=h-5;
    c.fillStyle='#08101366';c.fillRect(5,topH+4,w-10,depth-5);
    if(type==='table') {
        for(const x of [10,w-17])panel(c,x,topH-3,7,depth+1,'#352d26','#1c2020');
        panel(c,7,topH-6,w-14,8,'#503b2b','#241e1b');
    } else if(type==='barrel') {
        c.fillStyle='#344144';c.beginPath();c.ellipse(w/2,bottom-5,w*.37,6,0,0,Math.PI*2);c.fill();
        c.fillRect(w*.13,topH*.45,w*.74,bottom-5-topH*.45);
        for(const y of [topH+2,bottom-8])line(c,w*.15,y,w*.85,y,'#8c8164',3);
        line(c,w*.21,topH*.7,w*.21,bottom-8,'#8f927554',3);
    } else {
        panel(c,7,topH-5,w-14,depth,type==='counter'?'#49372b':'#424c4c','#242f32');
        const stride=type==='counter'?tile:Math.max(18,w/2);
        for(let x=12;x<w-12;x+=stride)line(c,x,topH-2,x,bottom-7,'#8b88604d',2);
        if(type==='crate')panel(c,w/2-5,topH-3,10,8,'#ad8d4d','#3c3c30');
    }
    c.save();c.scale(1,topH/h);
    if(facing===90){c.translate(w,0);c.rotate(Math.PI/2);}
    else if(facing===180){c.translate(w,h);c.rotate(Math.PI);}
    else if(facing===270){c.translate(0,h);c.rotate(-Math.PI/2);}
    const vertical=facing===90||facing===270,tw=vertical?h:w,th=vertical?w:h;
    if(type==='crate')crate(c,tile);
    else if(type==='barrel')barrel(c,tile);
    else furniture(c,tw,th,type==='counter');
    c.restore();
    // One consistent camera-facing edge, independent of orientation.
    if(type!=='barrel')line(c,10,topH-4,w-10,topH-4,'#b2ac8466',2);
}
// The tabletop is now an upright face with braces, within the new collision edge.
function overturnedTable(c,w,h,facing) {
    c.fillStyle='#070f1370';c.fillRect(4,8,w-8,h-12);
    const vertical=facing===0||facing===180,back=facing===0||facing===270;
    const x=vertical?Math.max(5,w*.18):5,y=vertical?5:Math.max(4,h*.1);
    const bw=vertical?w*.62:w-10,bh=vertical?h-10:h*.7;
    panel(c,x,y,bw,bh,back?'#58452f':'#80603e','#292921');
    c.fillStyle='#a78352';c.fillRect(x+2,y+2,bw-4,3);
    c.fillStyle='#392f27';c.fillRect(x+bw-6,y+4,5,bh-5);
    weathering(c,x+5,y+6,bw-12,bh-12,191,true);
    if(back){line(c,x+7,y+8,x+bw-8,y+bh-8,'#302b24',5);line(c,x+bw-8,y+8,x+7,y+bh-8,'#a68a59',4);}
    else for(let n=12;n<bh-8;n+=12)line(c,x+6,y+n,x+bw-8,y+n,'#342b2580',1);
    for(const t of [.18,.82]){
        if(vertical)panel(c,back?x+bw-2:Math.max(2,x-7),y+bh*t,9,7,'#4f4433','#202827');
        else panel(c,x+bw*t,y+bh-2,7,Math.max(7,h-y-bh-3),'#4f4433','#202827');
    }
}
export function drawGridProp(c, prop, tile = 64) {
    const bounds=propPixelBounds(prop,tile),facing=propFacing(prop);
    c.save();c.translate(bounds.x,bounds.y);
    c.beginPath();c.rect(1,1,bounds.w-2,bounds.h-2);c.clip();
    if(prop.type==='table'&&prop.flipped===true)overturnedTable(c,bounds.w,bounds.h,facing);
    else if(prop.type==='crate'||prop.type==='barrel') {
        for(let y=0;y<prop.h;y++)for(let x=0;x<prop.w;x++){
            c.save();c.translate(x*tile,y*tile);volume(c,prop.type,tile,tile,facing,tile);c.restore();
        }
    } else volume(c,prop.type,bounds.w,bounds.h,facing,tile);
    c.restore();
}
