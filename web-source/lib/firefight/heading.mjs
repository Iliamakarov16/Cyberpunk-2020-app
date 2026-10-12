// Eight table-facing directions. These are display/input helpers, not an
// authority for visibility: the shared server returns the actual private view.
export const HEADINGS = Object.freeze([0,45,90,135,180,225,270,315]);
export const HEADING_LABELS = Object.freeze(['Вправо →','Вниз-вправо ↘','Вниз ↓','Вниз-влево ↙','Влево ←','Вверх-влево ↖','Вверх ↑','Вверх-вправо ↗']);
export function actorHeading(actor) {
    return Number.isInteger(actor?.heading) && HEADINGS.includes(actor.heading) ? actor.heading : actor?.facing < 0 ? 180 : 0;
}
export function headingLabel(heading) { return HEADING_LABELS[HEADINGS.indexOf(heading)] || 'Направление не выбрано'; }
export function headingToward(actor,cell) {
    const dx=cell.x-actor.x,dy=cell.y-actor.y;
    return dx===0&&dy===0 ? actorHeading(actor) : (Math.round(Math.atan2(dy,dx)/(Math.PI/4))*45+360)%360;
}
export function interpolateHeading(from,to,progress) {
    const delta=((to-from+540)%360)-180,t=Math.max(0,Math.min(1,progress));
    return (from+delta*(1-Math.pow(1-t,3))+360)%360;
}
export function drawHeadingMarker(c,x,y,heading,{selected=false,preview=false,alpha=1,screenScale=1}={}) {
    // Keep direction readable at the normal phone zoom. These are screen-pixel
    // minima, not additional world geometry or a different visibility sector.
    const scale=Number.isFinite(screenScale)&&screenScale>0?screenScale:1;
    const angle=heading*Math.PI/180,dx=Math.cos(angle),dy=Math.sin(angle);
    const len=Math.max(selected?12:10,10/scale),wide=Math.max(selected?7:5,5/scale),r=Math.max(selected?33:27,len+6/scale);
    const tx=x+dx*r,ty=y+dy*r,bx=tx-dx*len,by=ty-dy*len,color=preview?'#f4c879':selected?'#c7fff0':'#c1ded6';
    c.save();c.globalAlpha*=alpha;
    c.beginPath();c.moveTo(bx-dx*5/scale,by-dy*5/scale);c.lineTo(bx,by);c.strokeStyle='#071216';c.lineWidth=4/scale;c.stroke();c.strokeStyle=color;c.lineWidth=2/scale;c.stroke();
    c.beginPath();c.moveTo(tx,ty);c.lineTo(bx-dy*wide,by+dx*wide);c.lineTo(bx+dy*wide,by-dx*wide);c.closePath();
    c.fillStyle=color;c.strokeStyle='#071216';c.lineWidth=Math.max(2,1.5/scale);c.fill();c.stroke();c.restore();
}
