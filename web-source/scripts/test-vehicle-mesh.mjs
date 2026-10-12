import assert from 'node:assert/strict';
import test from 'node:test';
import {vehicleMesh,projectVehicleMesh} from '../lib/firefight/vehicle-renderer.mjs';
import {propFootprint} from '../lib/firefight/props.mjs';
test('one vehicle mesh has normalized face normals and shared cabin edges',()=>{
 for(const van of [false,true]){
  const mesh=vehicleMesh(van);assert(mesh.faces.length>35);
  const vertices=new Map();for(const face of mesh.faces){assert(Math.abs(Math.hypot(...face.normal)-1)<1e-8);for(const p of face.points){assert(p.every(Number.isFinite));const key=p.join(',');vertices.set(key,(vertices.get(key)||0)+1);}}
  const roof=mesh.faces.find(f=>f.color===(van?'#a2a68f':'#97aaa0'));
  assert(roof);assert(roof.points.every(p=>vertices.get(p.join(','))>=3),'Roof, glass and side surfaces share exact vertices');
 }
});
test('all four views are contained and centered without an empty collision row',()=>{
 for(const type of ['car','van'])for(const facing of [0,90,180,270]){
  const {w,h}=propFootprint(type,facing),faces=projectVehicleMesh(vehicleMesh(type==='van'),facing,w*64,h*64),points=faces.filter(f=>!f.overlay).flatMap(f=>f.points);
  for(const [x,y] of points){assert(x>=4&&x<=w*64-4);assert(y>=4&&y<=h*64-4);}
  const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0])),minY=Math.min(...points.map(p=>p[1])),maxY=Math.max(...points.map(p=>p[1]));
  assert(minX<=48&&maxX>=(w-1)*64+16&&minY<=48&&maxY>=(h-1)*64+16,'Every occupied outer row/column has at least 16px of solid body, readable at phone scale');
  assert(Math.abs(minX+maxX-w*64)<3&&Math.abs(minY+maxY-h*64)<3);
  const firstOverlay=faces.findIndex(f=>f.overlay);assert(firstOverlay>0);assert(faces.slice(firstOverlay).every(f=>f.overlay),'Attached lamps and markings cannot be painted under the body');
 }
});
test('front and rear lamp faces survive projection after body faces',()=>{
 for(const type of ['car','van']){
  const {w,h}=propFootprint(type,90);
  const front=projectVehicleMesh(vehicleMesh(type==='van'),90,w*64,h*64),rear=projectVehicleMesh(vehicleMesh(type==='van'),270,w*64,h*64);
  assert(front.some(f=>f.color==='#d7c590'&&f.overlay));assert(!front.some(f=>f.color==='#a1574e'));
  assert(rear.some(f=>f.color==='#a1574e'&&f.overlay));assert(!rear.some(f=>f.color==='#d7c590'));
  assert.notDeepEqual(front,rear);
 }
});
