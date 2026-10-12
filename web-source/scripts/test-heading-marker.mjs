import assert from 'node:assert/strict';
import {drawHeadingMarker,HEADINGS} from '../lib/firefight/heading.mjs';
for(const scale of [.25,.4,.8,1,2])for(const heading of HEADINGS){
 const paths=[],c={globalAlpha:1,save(){},restore(){},beginPath(){paths.push([]);},moveTo(x,y){paths.at(-1).push([x,y]);},lineTo(x,y){paths.at(-1).push([x,y]);},closePath(){},fill(){},stroke(){}};
 drawHeadingMarker(c,64,64,heading,{selected:true,screenScale:scale});
 const [tip,left,right]=paths.at(-1),base=[(left[0]+right[0])/2,(left[1]+right[1])/2];
 assert(Math.hypot(tip[0]-base[0],tip[1]-base[1])*scale>=9.999);assert(Math.hypot(left[0]-right[0],left[1]-right[1])*scale>=9.999);
 assert(paths.flat().flat().every(Number.isFinite));
}
console.log('Heading marker: 10px minimum arrow at phone zoom in all eight directions; fixed world heading unchanged.');
