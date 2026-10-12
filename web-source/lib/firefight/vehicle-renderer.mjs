// One shared-vertex low-poly model per vehicle, rotated on the ground before a
// fixed elevated camera projects it. No separate plan drawing or detached band.
export function vehicleMesh(van=false, tile=64) {
    const L=(van?4.7:3.7)*tile,W=1.65*tile,belt=.375*tile,sill=.14*tile,roof=(van?.84:.72)*tile;
    const faces=[];
    const face=(points,color,outward,stroke='#18262a',overlay=false)=>{
        const a=points[1].map((v,i)=>v-points[0][i]),b=points[2].map((v,i)=>v-points[0][i]);
        let normal=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
        const sign=normal.reduce((n,v,i)=>n+v*outward[i],0)<0?-1:1,mag=Math.hypot(...normal)||1;
        normal=normal.map(v=>v*sign/mag);faces.push({points,color,normal,stroke,overlay});
    };
    const box=(u0,u1,v0,v1,z0,z1,color,top=color)=>{
        face([[u0,v0,z1],[u1,v0,z1],[u1,v1,z1],[u0,v1,z1]],top,[0,0,1]);
        face([[u0,v1,z0],[u1,v1,z0],[u1,v1,z1],[u0,v1,z1]],color,[0,1,0]);
        face([[u1,v0,z0],[u0,v0,z0],[u0,v0,z1],[u1,v0,z1]],color,[0,-1,0]);
        face([[u1,v1,z0],[u1,v0,z0],[u1,v0,z1],[u1,v1,z1]],color,[1,0,0]);
        face([[u0,v0,z0],[u0,v1,z0],[u0,v1,z1],[u0,v0,z1]],color,[-1,0,0]);
    };
    const bodyColor=van?'#56644f':'#3c555d',topColor=van?'#929782':'#829891';
    const outline=[[.02*L,-.36*W],[.065*L,-.5*W],[.91*L,-.5*W],[.98*L,-.36*W],[.98*L,.36*W],[.91*L,.5*W],[.065*L,.5*W],[.02*L,.36*W]];
    // Wheels are volumes at the same axles in every facing. Side rims appear
    // only on the side visible to this fixed camera, never as a second axle set.
    for(const u of [.21*L,.79*L])for(const sign of [-1,1]){
        const v=sign*(W*.48);box(u-13,u+13,v-6,v+6,0,22,'#11191e','#202a2c');
        const points=Array.from({length:16},(_,i)=>{const a=i*Math.PI/8;return [u+8*Math.cos(a),sign*(W*.48+6.3),11+8*Math.sin(a)];});
        face(points,'#4e5d5c',[0,sign,0],'#0b151a',true);
    }
    face(outline.map(([u,v])=>[u,v,belt]),topColor,[0,0,1]);
    for(let i=0;i<outline.length;i++){
        const a=outline[i],b=outline[(i+1)%outline.length],dx=b[0]-a[0],dy=b[1]-a[1],norm=Math.hypot(dx,dy);
        face([[a[0],a[1],sill],[b[0],b[1],sill],[b[0],b[1],belt],[a[0],a[1],belt]],bodyColor,[dy/norm,-dx/norm,0]);
    }
    const rear=van?.64*L:.20*L,roofRear=van?.65*L:.29*L,roofFront=van?.80*L:.57*L,front=van?.9*L:.70*L;
    const rv=.34*W,bv=.48*W;
    // Roof, both windscreens and side glass share the exact roof/belt vertices.
    face([[roofRear,-rv,roof],[roofFront,-rv,roof],[roofFront,rv,roof],[roofRear,rv,roof]],van?'#a2a68f':'#97aaa0',[0,0,1]);
    face([[roofFront,-rv,roof],[front,-bv,belt],[front,bv,belt],[roofFront,rv,roof]],'#233e48',[1,0,.8],'#92aaa2');
    if(!van)face([[rear,bv,belt],[rear,-bv,belt],[roofRear,-rv,roof],[roofRear,rv,roof]],'#29444b',[-1,0,.8],'#829d96');
    for(const sign of [-1,1]){
        face([[rear,sign*bv,belt],[front,sign*bv,belt],[roofFront,sign*rv,roof],[roofRear,sign*rv,roof]],'#263f47',[0,sign,.5],'#7c9790');
        const t=.53,br=rear+(front-rear)*t,rr=roofRear+(roofFront-roofRear)*t;
        face([[br-2,sign*bv,belt],[br+2,sign*bv,belt],[rr+2,sign*rv,roof],[rr-2,sign*rv,roof]],bodyColor,[0,sign,.5],bodyColor);
        // A small handle and the door seam belong to the belt-side surface.
        const side=sign*(W*.5+.1);face([[br-10,side,belt-4],[br+1,side,belt-4],[br+1,side,belt-2],[br-10,side,belt-2]],'#b4b5a0',[0,sign,0],'#b4b5a0',true);
        face([[br,side,sill+2],[br+1.5,side,sill+2],[br+1.5,side,belt],[br,side,belt]],'#2b4247',[0,sign,0],'#2b4247',true);
    }
    if(van){
        box(.06*L,.65*L,-.46*W,.46*W,belt,roof,'#68735f','#929982');
        // Cargo roof meets the narrower cab at these exact shared vertices.
        const cargoRoof=faces[faces.length-5];cargoRoof.points.splice(2,0,[.65*L,-rv,roof],[.65*L,rv,roof]);
        // Cargo door seams are on that same solid side, not another panel below it.
        for(const sign of [-1,1])for(const u of [.22*L,.49*L])face([[u,sign*.461*W,belt+4],[u+1.5,sign*.461*W,belt+4],[u+1.5,sign*.461*W,roof-4],[u,sign*.461*W,roof-4]],'#455648',[0,sign,0],'#455648',true);
    }
    for(const [u,normal,frontEnd] of [[.981*L,[1,0,0],true],[.019*L,[-1,0,0],false]]){
        const z0=sill+3,z1=belt-4;
        for(const sign of [-1,1])face([[u,sign*.18*W,z0],[u,sign*.34*W,z0],[u,sign*.34*W,z1],[u,sign*.18*W,z1]],frontEnd?'#d7c590':'#a1574e',normal,'#39433b',true);
        face([[u,-.13*W,z0],[u,.13*W,z0],[u,.13*W,z1-2],[u,-.13*W,z1-2]],frontEnd?'#172b31':bodyColor,normal,'#17262a',true);
    }
    // Surface details are attached to exposed planes and drawn after their
    // parent solid. They cannot disappear behind a lower centroid-sorted face.
    const scuffs=(u0,u1,v0,v1,z,count)=>{for(let i=0;i<count;i++){
        const u=u0+(u1-u0)*((i*37%101)/101),v=v0+(v1-v0)*((i*61%97)/97),len=Math.min(9,u1-u);
        face([[u,v,z],[u+len,v,z],[u+len,v+.65,z],[u,v+.65,z]],i%3?'#c7cfb43a':'#243b3d33',[0,0,1],'transparent',true);
    }};
    if(van){
        scuffs(.1*L,.59*L,-.35*W,.35*W,roof+.03,24);
        face([[.059*L,-1,belt+3],[.059*L,1,belt+3],[.059*L,1,roof-3],[.059*L,-1,roof-3]],'#34483d',[-1,0,0],'#34483d',true);
    }else{
        scuffs(.73*L,.91*L,-.32*W,.32*W,belt+.03,14);
        scuffs(.07*L,.19*L,-.31*W,.31*W,belt+.03,8);
        scuffs(.37*L,.56*L,-.25*W,.25*W,roof+.03,13);
        for(const u of [.175*L,.715*L])face([[u,-.43*W,belt+.02],[u+1,-.43*W,belt+.02],[u+1,.43*W,belt+.02],[u,.43*W,belt+.02]],'#425b5c',[0,0,1],'#425b5c',true);
    }
    return {faces,L,W,roof};
}
export function projectVehicleMesh(mesh,facing,w,h){
    const turn=([u,v,z])=>facing===90?[-v,u,z]:facing===180?[-u,-v,z]:facing===270?[v,-u,z]:[u,v,z];
    const groundY=.78,elevation=.76;
    const project=([x,y,z])=>[x,groundY*y-elevation*z];
    const all=mesh.faces.flatMap(f=>f.points.map(p=>project(turn(p))));
    const loX=Math.min(...all.map(p=>p[0])),hiX=Math.max(...all.map(p=>p[0])),loY=Math.min(...all.map(p=>p[1])),hiY=Math.max(...all.map(p=>p[1]));
    const scale=Math.min(1,(w-10)/(hiX-loX),(h-10)/(hiY-loY));
    const ox=(w-(hiX-loX)*scale)/2-loX*scale,oy=(h-(hiY-loY)*scale)/2-loY*scale;
    return mesh.faces.map(f=>{const normal=turn(f.normal),world=f.points.map(turn);return {...f,visible:normal[1]*elevation+normal[2]*groundY>0.01,depth:world.reduce((sum,p)=>sum+p[1]*elevation+p[2]*groundY,0)/world.length,points:world.map(p=>{const [x,y]=project(p);return [ox+x*scale,oy+y*scale];})};}).filter(f=>f.visible).sort((a,b)=>Number(a.overlay)-Number(b.overlay)||a.depth-b.depth);
}
export function drawVehicle(c,w,h,facing,van,tile){
    c.fillStyle='#050a104d';c.beginPath();c.ellipse(w/2,h/2+Math.min(20,h*.15),w/2-9,h*.24,0,0,Math.PI*2);c.fill();
    for(const face of projectVehicleMesh(vehicleMesh(van,tile),facing,w,h)){
        c.beginPath();c.moveTo(...face.points[0]);for(const point of face.points.slice(1))c.lineTo(...point);c.closePath();
        c.fillStyle=face.color;c.fill();c.strokeStyle=face.stroke;c.lineWidth=1.4;c.stroke();
    }
}
