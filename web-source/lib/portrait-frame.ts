export type PortraitLayoutInput = {
 imageWidth:number;
 imageHeight:number;
 width:number;
 height:number;
 fit:'contain'|'cover';
 x:number;
 y:number;
 zoom:number;
};

export type PortraitLayout = {width:number;height:number;left:number;top:number};
export type PortraitMoveInput = {
 x:number;
 y:number;
 width:number;
 height:number;
 containerWidth:number;
 containerHeight:number;
};

const positive = (value:number) => Number.isFinite(value)&&value>0;
const bounded = (value:number,min:number,max:number,fallback:number) => Math.min(max,Math.max(min,Number.isFinite(value)?value:fallback));
const zeroLayout = ():PortraitLayout => ({width:0,height:0,left:0,top:0});

/** Pixel geometry shared by the portrait preview and saved portrait. */
export function getPortraitLayout({imageWidth,imageHeight,width,height,fit,x,y,zoom}:PortraitLayoutInput):PortraitLayout {
 if(![imageWidth,imageHeight,width,height].every(positive))return zeroLayout();
 const ratios=[width/imageWidth,height/imageHeight];
 const scale=(fit==='cover'?Math.max(...ratios):Math.min(...ratios))*(bounded(zoom,100,300,100)/100);
 const renderedWidth=imageWidth*scale;
 const renderedHeight=imageHeight*scale;
 const layout={
  width:renderedWidth,
  height:renderedHeight,
  left:(width-renderedWidth)*bounded(x,0,100,50)/100,
  top:(height-renderedHeight)*bounded(y,0,100,50)/100,
 };
 return Object.values(layout).every(Number.isFinite)&&renderedWidth>0&&renderedHeight>0?layout:zeroLayout();
}

/** Convert a pointer delta into position percentages without reversing the drag. */
export function movePortraitFrame({x,y,width,height,containerWidth,containerHeight}:PortraitMoveInput,dx:number,dy:number):{x:number;y:number} {
 const moveAxis=(position:number,imageSize:number,containerSize:number,delta:number) => {
  const start=bounded(position,0,100,50);
  const gap=containerSize-imageSize;
  if(!positive(imageSize)||!positive(containerSize)||!Number.isFinite(delta)||Math.abs(gap)<1)return Math.round(start);
  const moved=start+delta/gap*100;
  return Math.round(Math.min(100,Math.max(0,moved)));
 };
 return {x:moveAxis(x,width,containerWidth,dx),y:moveAxis(y,height,containerHeight,dy)};
}

/** Open a small crop on a fitted axis, keeping the initial image center under the pointer. */
export function getPortraitDragFrame(input:PortraitLayoutInput,dx:number,dy:number,zoomFloor?:number):{x:number;y:number;zoom:number} {
 const zoom=bounded(input.zoom,100,300,100);
 const unchanged={x:Math.round(bounded(input.x,0,100,50)),y:Math.round(bounded(input.y,0,100,50)),zoom};
 if(![input.imageWidth,input.imageHeight,input.width,input.height].every(positive)||
  ![input.x,input.y,input.zoom,dx,dy].every(Number.isFinite)||!['contain','cover'].includes(input.fit))return unchanged;
 const initial=getPortraitLayout({...input,zoom});
 if(!initial.width)return unchanged;
 const fittedDrag=(Math.abs(input.width-initial.width)<=1&&Math.abs(dx)>3)||
  (Math.abs(input.height-initial.height)<=1&&Math.abs(dy)>3);
 const nextZoom=Math.max(zoom,bounded(zoomFloor??zoom,100,300,zoom),fittedDrag?Math.min(300,zoom+10):zoom);
 if(nextZoom===zoom)return {...movePortraitFrame({x:input.x,y:input.y,width:initial.width,height:initial.height,containerWidth:input.width,containerHeight:input.height},dx,dy),zoom};
 const next=getPortraitLayout({...input,zoom:nextZoom});
 if(!next.width)return unchanged;
 const position=(start:number,offset:number,oldSize:number,newSize:number,container:number,delta:number)=>{
  const gap=container-newSize;
  if(Math.abs(gap)<1)return Math.round(bounded(start,0,100,50));
  const desired=offset+delta-(newSize-oldSize)/2;
  return Math.round(Math.min(100,Math.max(0,desired/gap*100)));
 };
 return {
  x:position(input.x,initial.left,initial.width,next.width,input.width,dx),
  y:position(input.y,initial.top,initial.height,next.height,input.height,dy),
  zoom:nextZoom,
 };
}
