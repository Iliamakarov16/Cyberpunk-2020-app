import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../lib/portrait-frame.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {getPortraitLayout,movePortraitFrame,getPortraitDragFrame}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const frame={imageWidth:600,imageHeight:900,width:300,height:300,fit:'contain',x:50,y:50,zoom:100};
const close=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-8,`${message}: ${actual} ≠ ${expected}`);
const checkLayout=(actual,expected)=>{for(const key of ['width','height','left','top'])close(actual[key],expected[key],key);};

// A portrait keeps its aspect ratio while the fit choice changes crop/gaps.
const contained=getPortraitLayout(frame);
checkLayout(contained,{width:200,height:300,left:50,top:0});
const covered=getPortraitLayout({...frame,fit:'cover'});
checkLayout(covered,{width:300,height:450,left:0,top:-75});
for(const fit of ['contain','cover'])for(const zoom of [100,150,300])for(const [imageWidth,imageHeight] of [[600,900],[1200,600],[1,1],[4032,3024]]){
 const layout=getPortraitLayout({...frame,imageWidth,imageHeight,fit,zoom});
 close(layout.width/layout.height,imageWidth/imageHeight,'Original aspect ratio');
 const base=getPortraitLayout({...frame,imageWidth,imageHeight,fit,zoom:100});
 close(layout.width,base.width*zoom/100,'Zoom scales width');
 close(layout.height,base.height*zoom/100,'Zoom scales height');
 assert.ok(Object.values(layout).every(Number.isFinite));
}
checkLayout(getPortraitLayout({...frame,fit:'cover',zoom:300,x:0,y:0}),{width:900,height:1350,left:0,top:0});
checkLayout(getPortraitLayout({...frame,fit:'cover',zoom:300,x:100,y:100}),{width:900,height:1350,left:-600,top:-1050});
assert.deepEqual(getPortraitLayout({...frame,x:0}),{...contained,left:0});
assert.deepEqual(getPortraitLayout({...frame,x:100}),{...contained,left:100});

// Drag offsets should move actual image pixels with the pointer, on either side of fit.
for(const fit of ['contain','cover']){
 const initial={...frame,fit};
 const layout=getPortraitLayout(initial);
 const next=movePortraitFrame({x:50,y:50,width:layout.width,height:layout.height,containerWidth:300,containerHeight:300},10,15);
 const moved=getPortraitLayout({...initial,...next});
 if(Math.abs(300-layout.width)>=1)close(moved.left-layout.left,10,'Horizontal pointer movement');
 else assert.equal(next.x,50,'A full-width image cannot move horizontally');
 if(Math.abs(300-layout.height)>=1)close(moved.top-layout.top,15,'Vertical pointer movement');
 else assert.equal(next.y,50,'A full-height image cannot move vertically');
}
const overflow={x:50,y:50,width:600,height:600,containerWidth:300,containerHeight:300};
assert.deepEqual(movePortraitFrame(overflow,60,-60),{x:30,y:70});
assert.deepEqual(movePortraitFrame(overflow,1000,-1000),{x:0,y:100});
assert.deepEqual(movePortraitFrame({...overflow,width:200,height:200},1000,-1000),{x:100,y:0});
assert.deepEqual(movePortraitFrame({...overflow,x:49.4,y:50.6,width:299.5,height:300.5},100,-100),{x:49,y:51},'Subpixel gaps leave each axis unchanged');
assert.deepEqual(movePortraitFrame({...overflow,width:299,height:301},1,1),{x:100,y:0},'A one-pixel gap remains movable');
assert.deepEqual(movePortraitFrame(overflow,1,-1),{x:50,y:50},'Returned percentages are integers');

// Ordinary drags retain the saved frame math; a deliberate fitted-axis drag opens a crop.
for(const fit of ['contain','cover']){
 const ordinary={...frame,fit,zoom:175,x:30,y:60};
 const layout=getPortraitLayout(ordinary);
 assert.deepEqual(getPortraitDragFrame(ordinary,9,-12),{...movePortraitFrame({x:ordinary.x,y:ordinary.y,width:layout.width,height:layout.height,containerWidth:ordinary.width,containerHeight:ordinary.height},9,-12),zoom:175});
}
assert.deepEqual(getPortraitDragFrame(frame,10,0),{x:60,y:50,zoom:100},'Movement on an unfitted axis does not autozoom');
assert.deepEqual(getPortraitDragFrame(frame,0,3),{x:50,y:50,zoom:100},'Small fitted-axis pointer noise does not autozoom');
assert.equal(getPortraitDragFrame(frame,0,3.01).zoom,110,'The threshold is greater than three pixels');
for(const [fit,dx,dy] of [['contain',5,6],['cover',6,4]]){
 const initialFrame={...frame,fit};
 const initial=getPortraitLayout(initialFrame);
 const dragged=getPortraitDragFrame(initialFrame,dx,dy);
 assert.equal(dragged.zoom,110,'Fitted-axis drag adds ten percentage points');
 const next=getPortraitLayout({...initialFrame,...dragged});
 for(const [axis,offset,size,delta] of [['x','left','width',dx],['y','top','height',dy]]){
  const error=Math.abs((next[offset]+next[size]/2)-(initial[offset]+initial[size]/2+delta));
  assert.ok(error<=Math.abs(initialFrame[size]-next[size])/200+1e-8,`${fit}/${axis} image center follows the pointer within integer-percentage rounding`);
 }
 const sticky=getPortraitDragFrame(initialFrame,0,0,dragged.zoom);
 assert.equal(sticky.zoom,110,'Autozoom stays raised when the pointer returns below the threshold');
 const centered=getPortraitLayout({...initialFrame,...sticky});
 close(centered.left+centered.width/2,initial.left+initial.width/2,'Sticky zoom preserves horizontal center');
 close(centered.top+centered.height/2,initial.top+initial.height/2,'Sticky zoom preserves vertical center');
}
assert.equal(getPortraitDragFrame({...frame,zoom:295},0,6,999).zoom,300,'The floor is bounded by maximum zoom');
assert.equal(getPortraitDragFrame({...frame,imageWidth:300,imageHeight:885,width:900,height:900,zoom:295},6,0).zoom,300,'Automatic zoom adds only the space remaining below maximum');
assert.equal(getPortraitDragFrame(frame,0,0,90).zoom,100,'The floor cannot reduce initial zoom');
assert.deepEqual(getPortraitDragFrame(frame,0,0,NaN),{x:50,y:50,zoom:100});
const fittedAtLimit={...frame,imageWidth:300,imageHeight:900,zoom:300,width:900,height:900};
assert.deepEqual(getPortraitDragFrame(fittedAtLimit,12,0),{x:50,y:50,zoom:300},'A fitted axis at maximum zoom remains finite and cannot grow');

// Scaling the complete preview and pointer coordinates does not change the persisted frame.
const savedViewport={...frame,width:222.8,height:340};
const savedDrag=getPortraitDragFrame(savedViewport,6,-4);
const previewScale=.75;
const previewViewport={...savedViewport,width:savedViewport.width*previewScale,height:savedViewport.height*previewScale};
assert.deepEqual(getPortraitDragFrame(previewViewport,6*previewScale,-4*previewScale),savedDrag);
const savedLayout=getPortraitLayout({...savedViewport,...savedDrag});
const previewLayout=getPortraitLayout({...previewViewport,...savedDrag});
for(const key of ['width','height','left','top'])close(previewLayout[key],savedLayout[key]*previewScale,'Scaled preview matches saved portrait geometry');

// Invalid and extreme values cannot create nonfinite CSS geometry or position values.
const zero={width:0,height:0,left:0,top:0};
for(const key of ['imageWidth','imageHeight','width','height'])for(const invalid of [0,-1,NaN,Infinity,-Infinity]){
 assert.deepEqual(getPortraitLayout({...frame,[key]:invalid}),zero,`${key} rejects ${invalid}`);
 assert.deepEqual(getPortraitDragFrame({...frame,[key]:invalid},30,30,150),{x:50,y:50,zoom:100},'Invalid geometry never moves or zooms');
}
assert.deepEqual(getPortraitLayout({...frame,x:NaN,y:Infinity,zoom:NaN}),contained);
assert.deepEqual(getPortraitLayout({...frame,x:-10,y:120,zoom:0}),{...contained,left:0});
assert.deepEqual(getPortraitLayout({...frame,imageWidth:Number.MIN_VALUE,imageHeight:Number.MIN_VALUE,width:Number.MAX_VALUE,height:Number.MAX_VALUE,fit:'cover'}),zero);
assert.deepEqual(movePortraitFrame({...overflow,x:NaN,y:Infinity},NaN,Infinity),{x:50,y:50});
assert.deepEqual(movePortraitFrame({...overflow,x:-5,y:105,width:0,height:Infinity},20,20),{x:0,y:100});
assert.deepEqual(movePortraitFrame(overflow,Number.MAX_VALUE,-Number.MAX_VALUE),{x:0,y:100});
assert.deepEqual(movePortraitFrame({...overflow,containerWidth:0,containerHeight:NaN},30,30),{x:50,y:50});
for(const [dx,dy] of [[NaN,5],[5,Infinity],[-Infinity,5]])assert.deepEqual(getPortraitDragFrame(frame,dx,dy,150),{x:50,y:50,zoom:100},'Invalid pointer coordinates do not move');
assert.deepEqual(getPortraitDragFrame({...frame,x:NaN,y:Infinity,zoom:NaN},30,30),{x:50,y:50,zoom:100});
assert.deepEqual(getPortraitDragFrame({...frame,imageWidth:Number.MIN_VALUE,imageHeight:Number.MIN_VALUE,width:Number.MAX_VALUE,height:Number.MAX_VALUE,fit:'cover'},30,30),{x:50,y:50,zoom:100});
const hugeDrag=getPortraitDragFrame(frame,Number.MAX_VALUE,-Number.MAX_VALUE);
assert.ok(Object.values(hugeDrag).every(Number.isFinite));assert.equal(hugeDrag.zoom,110);assert.ok(hugeDrag.x>=0&&hugeDrag.x<=100&&hugeDrag.y>=0&&hugeDrag.y<=100);

console.log('Portrait framing: legacy geometry, aspect ratio, anchored edges, ordinary drag, fitted-axis autozoom, sticky zoom, center compensation, scaled preview equivalence and finite degenerate geometry passed.');
