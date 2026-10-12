import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../package.json',import.meta.url));
const ts=require('typescript');
const source=fs.readFileSync(new URL('../components/tutorial-model.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {TUTORIALS,getTutorial,readCompleted,markCompleted,tutorialStorageKey,resolveTutorialLayout}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const inside=(a,b)=>a.left>=b.left&&a.top>=b.top&&a.left+a.width<=b.left+b.width+.001&&a.top+a.height<=b.top+b.height+.001;
const intersects=(a,b)=>a.left<b.left+b.width&&a.left+a.width>b.left&&a.top<b.top+b.height&&a.top+a.height>b.top;

// Every step names a real integration destination and fixed selector-safe anchor.
const destinations=new Set(['home','training-ip','personal','campaigns','sheet','equipment','skills','campaign-party','campaign-play','campaign-settings','campaign-notes','campaign-messages','campaign-scene','training-combat','training-net','training-table']);
assert.equal(TUTORIALS.length,10);assert.equal(new Set(TUTORIALS.map(t=>t.id)).size,10);
for(const tour of TUTORIALS){assert.ok(tour.steps.length>1);for(const step of tour.steps){assert.ok(destinations.has(step.destination));assert.match(step.anchor,/^[a-z0-9-]+$/);assert.ok(step.missing.length>15);}}
assert.equal(getTutorial('bad-selector"]'),undefined);
assert.notEqual(tutorialStorageKey(1),tutorialStorageKey(2));
assert.deepEqual(readCompleted(null),[]);assert.deepEqual(readCompleted('{bad'),[]);assert.deepEqual(readCompleted('[]'),[]);
assert.deepEqual(readCompleted(JSON.stringify({version:2,completed:['combat']})),[]);
assert.deepEqual(readCompleted(JSON.stringify({version:1,completed:['combat','unknown','combat',7,'net']})),['combat','net']);
assert.deepEqual(markCompleted(['combat'],'combat'),['combat']);

// On desktop the guide must sit beside the live control, while the four panels leave its full hole clear.
const desktop={left:0,top:0,width:1440,height:900},control={left:480,top:240,width:200,height:48};
const layout=resolveTutorialLayout(control,desktop,290);assert.ok(inside(layout.card,desktop));assert.equal(layout.overlapsTarget,false);assert.ok(layout.spotlight);
for(const panel of layout.panels){assert.ok(inside(panel,desktop));assert.equal(intersects(panel,layout.spotlight),false);}
const panelArea=layout.panels.reduce((sum,p)=>sum+p.width*p.height,0),holeArea=layout.spotlight.width*layout.spotlight.height;
assert.equal(panelArea+holeArea,desktop.width*desktop.height);

// Mobile: a bottom action should remain exposed with the guide above it.
const mobile={left:0,top:0,width:390,height:720},bottomButton={left:30,top:644,width:180,height:46};
const small=resolveTutorialLayout(bottomButton,mobile,260);assert.ok(inside(small.card,mobile));assert.equal(small.overlapsTarget,false);assert.ok(small.card.top+small.card.height<bottomButton.top);

// A visual viewport shrunk and shifted by the software keyboard still contains the card and the hole.
const keyboard={left:0,top:95,width:390,height:325};
const keyboardLayout=resolveTutorialLayout({left:24,top:110,width:200,height:44},keyboard,240);
assert.ok(inside(keyboardLayout.card,keyboard));assert.ok(inside(keyboardLayout.spotlight,keyboard));

// Missing/offscreen targets have no fictional highlight or blocking dim panels.
const missing=resolveTutorialLayout(null,mobile,260);assert.equal(missing.spotlight,null);assert.deepEqual(missing.panels,[]);assert.ok(inside(missing.card,mobile));
const outside=resolveTutorialLayout({left:0,top:900,width:100,height:50},mobile,260);assert.equal(outside.spotlight,null);assert.deepEqual(outside.panels,[]);

// A whole-screen target cannot avoid overlap; report it so UI suggests minimizing rather than hiding the problem.
const whole=resolveTutorialLayout(mobile,mobile,300);assert.equal(whole.overlapsTarget,true);assert.ok(inside(whole.card,mobile));
for(const viewport of [{left:0,top:0,width:320,height:568},{left:0,top:0,width:568,height:320},{left:20,top:50,width:280,height:200}]){
  for(const target of [{left:viewport.left,top:viewport.top,width:80,height:30},{left:viewport.left+viewport.width-85,top:viewport.top+viewport.height-35,width:80,height:30},viewport]){
    const result=resolveTutorialLayout(target,viewport,320);assert.ok(inside(result.card,viewport));if(result.spotlight)assert.ok(inside(result.spotlight,viewport));
  }
}
console.log('Tutorial model: scopes, malformed progress, honest missing targets and responsive spotlight layout passed.');
