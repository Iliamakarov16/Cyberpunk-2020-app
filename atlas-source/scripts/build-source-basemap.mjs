import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Keep the visible source drawing unchanged. Cleanup is restricted to the
// printed annotation windows, in the original 1536 × 1207 coordinate frame.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p));
const world=JSON.parse(read('public/world-data.json'));
const cleanup=JSON.parse(read('docs/geography/cleanup-regions.json'));
const jpeg=read('public/assets/geography-2020/draken-original-v7.jpg').toString('base64');
const png=read('public/assets/geography-2020/draken-cleaning-v7.png').toString('base64');
const p=world.projection,s=p.scale,tx=p.offsetX-p.crop[0]*s;
const source='<image href="data:image/jpeg;base64,'+jpeg+'" width="1536" height="1207"/>';
const header='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">';
const crop='<clipPath id="source-crop-v7"><rect x="442" y="0" width="1094" height="1207"/></clipPath>';
const wrapper=body=>header+'<defs>'+crop+'</defs><rect width="1024" height="1024" fill="#0a1c2a"/><g transform="matrix('+s+' 0 0 '+s+' '+tx+' 0)" clip-path="url(#source-crop-v7)">'+body+'</g></svg>';
fs.writeFileSync(path.join(root,'public',(world.assets.printBasemapSource||world.assets.printBasemap)),wrapper(source));
const blur='<filter id="patch-blend-v7"><feGaussianBlur stdDeviation="0.65"/></filter>';
// Group equal registrations so rasterizers decode/render each transform once.
const groups=new Map();
for(const r of cleanup.regions){const shift=r.generatedRegistration?.sourceFrameShift||[0,0],key=shift.join(',');if(!groups.has(key))groups.set(key,{shift,regions:[]});groups.get(key).regions.push(r)}
const entries=[...groups.values()];
const rects=regions=>regions.map(r=>{const [x,y,x1,y1]=r.bbox;return '<rect x="'+x+'" y="'+y+'" width="'+(x1-x)+'" height="'+(y1-y)+'"/>'}).join('');
const clips=entries.map((g,i)=>'<clipPath id="cleanup-clip-'+i+'">'+rects(g.regions)+'</clipPath><mask id="cleanup-mask-'+i+'" maskUnits="userSpaceOnUse" x="442" y="0" width="1094" height="1207"><g fill="white" filter="url(#patch-blend-v7)">'+rects(g.regions)+'</g></mask>').join('');
const cleaned='<image id="cleaned-raster-v7" href="data:image/png;base64,'+png+'" width="1536" height="1207" preserveAspectRatio="none"/>';
const patches=entries.map((g,i)=>{const [dx,dy]=g.shift;return '<g clip-path="url(#cleanup-clip-'+i+')"><g mask="url(#cleanup-mask-'+i+')"><use href="#cleaned-raster-v7" x="'+(-dx)+'" y="'+(-dy)+'"/></g></g>'}).join('');
fs.writeFileSync(path.join(root,'public',(world.assets.cleanBasemapSource||world.assets.cleanBasemap)),wrapper('<defs>'+blur+cleaned+clips+'</defs>'+source+patches));
console.log('Source basemap: '+cleanup.regions.length+' annotation windows; '+cleanup.stats.originalGeometryRetainedOutsideWindowsPercent+'% of original crop outside cleanup windows.');
