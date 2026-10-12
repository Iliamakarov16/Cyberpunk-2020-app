import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {fixture,expect,blank,root,snapshot} from './network-fixture.mjs';
const ts=createRequire(join(root,'package.json'))('typescript');
const shared=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(readFileSync(join(root,'lib/battle.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const {validateBattleBoard,visibleBattleCells,projectBattleBoard}=shared;
const base={schemaVersion:1,width:8,height:8,cellMeters:2,vision:3,tiles:Array(64).fill('floor'),pieces:[],turnPieceId:null};
const piece=(id,kind,x,y,ref=null,extra={})=>({id,kind,x,y,characterId:kind==='character'?ref:null,targetId:kind==='target'?ref:null,name:id,description:id+' description',hidden:false,initiative:null,...extra});
const corner=structuredClone(base);corner.tiles[1]='wall';corner.tiles[8]='door';
assert(visibleBattleCells(corner,{x:0,y:0}).includes(1),'Wall endpoint visible');
assert(!visibleBattleCells(corner,{x:0,y:0}).includes(9),'Cannot see through two blocking corner neighbours');
corner.tiles[8]='floor';assert(visibleBattleCells(corner,{x:0,y:0}).includes(9),'Single corner obstacle does not create a two-wall block');
const horizontal=structuredClone(base);horizontal.tiles[2]='door';
assert(visibleBattleCells(horizontal,{x:0,y:0}).includes(2));assert(!visibleBattleCells(horizontal,{x:0,y:0}).includes(3));
assert.throws(()=>validateBattleBoard({...base,width:8.2}));
assert.throws(()=>validateBattleBoard({...base,cellMeters:Infinity}));
assert.throws(()=>validateBattleBoard({...base,secret:true}));
assert.throws(()=>validateBattleBoard({...base,pieces:[piece('bad','character',0,0,1,{hidden:'false'})]}));
assert.throws(()=>validateBattleBoard({...base,pieces:[piece('same','character',0,0,1),piece('same2','character',1,0,1)]}));
assert.throws(()=>validateBattleBoard({...base,pieces:[piece('a','character',0,0,1),piece('b','target',0,0,'enemy')]}));
assert.doesNotThrow(()=>validateBattleBoard({...horizontal,pieces:[piece('stash','loot',2,0)]}));

const t=await fixture();const {owner,request,read,write,db}=t;
const alice=await t.register('battle_alice'),bob=await t.register('battle_bob'),pending=await t.register('battle_pending');
const a1=(await write('/api/characters','POST',{data:blank('Alice One')},alice,201)).id;
const a2=(await write('/api/characters','POST',{data:blank('Alice Two')},alice,201)).id;
const b=(await write('/api/characters','POST',{data:blank('Bob')},bob,201)).id;
const p=(await write('/api/characters','POST',{data:blank('Pending')},pending,201)).id;
const campaign=await write('/api/campaigns','POST',{name:'Battle regression'},owner,201),path='/api/campaigns/'+campaign.id,wsPath=path+'/workspace';
let game=await read(path);
for(const [character_id,account]of [[a1,alice],[a2,alice],[b,bob],[p,pending]])await write('/api/campaigns/join','POST',{code:game.invite_code,character_id},account,201);
for(const character_id of [a1,a2,b]){game=await read(path);await write(path+'/roster','POST',{version:game.version,character_id,status:'active'});}
async function cmd(command,fields={},account=owner,status=200){const ws=await read(wsPath,account);return write(wsPath,'POST',{version:ws.version,command,...fields},account,status);}
const legacy=await read(wsPath);assert(!Object.hasOwn(legacy.data.scene,'board'),'Legacy scene has no invented board');
const legacyArchive=await read(path+'/export');assert(!Object.hasOwn(legacyArchive.content.workspace.scene,'board'));
assert.equal((await read(path+'/export')).fingerprint,legacyArchive.fingerprint,'Legacy fingerprints remain stable');
const targets=[{id:'left',name:'LEFT ENEMY',kind:'person',description:'Left target',visible:true},{id:'right',name:'RIGHT ENEMY',kind:'person',description:'Right target',visible:true},{id:'hidden',name:'SECRET HIDDEN TARGET',kind:'person',description:'SECRET description',visible:false}];
const board=structuredClone(base);for(let y=0;y<7;y++)board.tiles[y*8+3]='wall';
board.pieces=[piece('a1','character',1,1,a1,{hidden:true}),piece('a2','character',6,6,a2),piece('bob','character',5,1,b),piece('left-pawn','target',2,1,'left'),piece('right-pawn','target',6,5,'right'),piece('secret-pawn','target',4,1,'hidden'),piece('secret-loot','loot',1,2,null,{hidden:true,name:'SECRET LOOT',description:'SECRET stash',initiative:88})];board.turnPieceId='secret-pawn';
await cmd('battle.save',{board,targets});
let gm=await read(wsPath),player=await read(wsPath,alice);
assert.equal(gm.data.scene.active,false,'Board save does not open the scene');
assert.equal(gm.data.scene.board.pieces.length,7);
assert.equal(player.data.scene.board.views.length,2);assert(player.data.scene.board.pieces.some(p=>p.id==='a1'),'Hidden own pawn stays visible');
assert.equal(player.data.scene.board.tiles[12],'unknown','Unseen terrain absent');
assert.equal(player.data.scene.board.turnPieceId,null,'Hidden current-turn ID absent');
assert(!JSON.stringify(player).includes('SECRET'),'Hidden terrain/pieces/targets leak no names or description');
assert(player.data.scene.targets.some(t=>t.id==='right'),'Union of own character views can show shared target list');
assert(player.data.scene.targets.some(t=>t.id==='battle-floor'),'Placed own pawn receives movement anchor');
expect(await request(wsPath,'GET',undefined,pending),403,'Pending character cannot read battle');
const denied=await request(wsPath,'POST',{version:gm.version,command:'battle.save',board,targets},alice);expect(denied,403,'Player cannot edit field');
for(const broken of [
 {...board,pieces:[...board.pieces,piece('pending','character',0,4,p)]},
 {...board,pieces:[...board.pieces,piece('outside','character',0,4,99999)]},
 {...board,pieces:[...board.pieces,piece('duplicate','target',0,4,'left')]},
 {...board,pieces:board.pieces.map(p=>p.id==='a1'?{...p,x:3}:p)},
]){const before=await read(wsPath);await cmd('battle.save',{board:broken,targets},owner,400);assert.equal((await read(wsPath)).version,before.version);}
await cmd('scene.save',{name:'Active field',active:true,targets});
assert((await read(wsPath)).data.scene.targets.some(t=>t.id==='battle-floor'),'Scene editor preserves canonical movement anchor');
const hiddenLeft=targets.map(t=>t.id==='left'?{...t,name:'Renamed left',description:'x'.repeat(1800),visible:false}:t);
await cmd('scene.save',{name:'Active field',active:true,targets:hiddenLeft});
let linkedPawn=(await read(wsPath)).data.scene.board.pieces.find(p=>p.targetId==='left');assert.equal(linkedPawn.name,'Renamed left');assert.equal(linkedPawn.hidden,true);assert.equal(linkedPawn.description.length,1500);assert.equal((await read(wsPath)).data.scene.targets.find(t=>t.id==='left').description.length,1800,'Full target description retained');
assert(!(await read(wsPath,alice)).data.scene.board.pieces.some(p=>p.targetId==='left'),'Explicit hide synchronizes pawn');
await cmd('scene.save',{name:'Active field',active:true,targets});assert.equal((await read(wsPath)).data.scene.board.pieces.find(p=>p.targetId==='left').hidden,false,'Explicit show synchronizes pawn but LOS still applies');
await cmd('scene.save',{name:'Active field',active:true,targets:targets.filter(t=>t.id!=='left')},owner,400);
const actionFields={characterId:a1,targetId:'right',kind:'attack',description:'Shoot',tool:'Pistol',roll:null,damage:null};
await cmd('action.submit',actionFields,alice,404);
await cmd('action.submit',{...actionFields,characterId:a2,movement:{fromX:6,fromY:6,x:6,y:5}},alice,400);
await cmd('action.submit',{...actionFields,characterId:a2},alice);
let attack=(await read(wsPath)).data.scene.actions.at(-1);await cmd('action.approve',{id:attack.id});
await cmd('battle.move',{id:'a2',x:7,y:0});await cmd('battle.move',{id:'a1',x:6,y:7});
await cmd('action.roll',{id:attack.id,roll:8,damage:10},alice,403);
assert(!(await read(wsPath,alice)).data.scene.actions.some(a=>a.id===attack.id),'Actor-specific visibility hides action despite another own view');
await cmd('battle.move',{id:'a1',x:1,y:1});await cmd('battle.move',{id:'a2',x:6,y:6});await cmd('action.roll',{id:attack.id,roll:8,damage:10},alice);await cmd('action.resolve',{id:attack.id,result:'A hit before armour.'});
const historyBoard=structuredClone((await read(wsPath)).data.scene.board);historyBoard.pieces=historyBoard.pieces.filter(p=>p.targetId!=='right');await cmd('battle.save',{board:historyBoard,targets:targets.filter(t=>t.id!=='right')},owner,400);
await cmd('battle.requestMove',{characterId:a1,x:4,y:1},alice,403);
await cmd('battle.requestMove',{characterId:a1,x:2,y:1},alice,400);
await cmd('battle.requestMove',{characterId:a1,x:3,y:1},alice,400);
await cmd('battle.requestMove',{characterId:a1,x:1,y:1},alice,400);
await cmd('battle.requestMove',{characterId:b,x:5,y:2},alice,403);
gm=await read(wsPath);const movePayload={version:gm.version,command:'battle.requestMove',characterId:a1,x:1,y:2,requestId:crypto.randomUUID()};
expect(await request(wsPath,'POST',movePayload,alice),200,'Request own visible move');
let move=(await read(wsPath)).data.scene.actions.at(-1);assert.deepEqual(move.movement,{fromX:1,fromY:1,x:1,y:2});assert.equal(move.roll,null);assert.equal((await read(wsPath)).data.scene.board.pieces.find(p=>p.id==='a1').y,1,'Request leaves pawn in place');
expect(await request(wsPath,'POST',movePayload,alice),200,'Retry is idempotent');assert.equal((await read(wsPath)).data.scene.actions.filter(a=>a.id===move.id).length,1);
await cmd('action.approve',{id:move.id});await cmd('battle.move',{id:'a1',x:2,y:2});
const beforeResolve=snapshot(db,['campaigns','campaign_workspaces']);await cmd('action.resolve',{id:move.id,result:'Moves.'},owner,409);assert.equal(snapshot(db,['campaigns','campaign_workspaces']),beforeResolve,'Conflicting movement resolution changes nothing');
await cmd('battle.move',{id:'a1',x:1,y:1});await cmd('action.resolve',{id:move.id,result:'Moves.'});
assert.equal((await read(wsPath)).data.scene.board.pieces.find(p=>p.id==='a1').y,2);
await cmd('battle.move',{id:'bob',x:1,y:1});const beforeUndo=snapshot(db,['campaigns','campaign_workspaces']);await cmd('action.undo',{id:move.id},owner,409);assert.equal(snapshot(db,['campaigns','campaign_workspaces']),beforeUndo);
await cmd('battle.move',{id:'bob',x:5,y:1});await cmd('action.undo',{id:move.id});assert.equal((await read(wsPath)).data.scene.board.pieces.find(p=>p.id==='a1').y,1);
await cmd('action.reject',{id:move.id,result:'Stay here.'});await cmd('battle.move',{id:'a1',x:2,y:2});await cmd('action.undo',{id:move.id});assert.equal((await read(wsPath)).data.scene.board.pieces.find(p=>p.id==='a1').x,2,'Undo rejected movement never moves pawn');
const archive=await read(path+'/export');assert.equal((await read(path+'/export')).fingerprint,archive.fingerprint,'Board and movement archive stable');
const archivePiece=archive.content.workspace.scene.board.pieces.find(p=>p.id==='a1');assert.match(archivePiece.characterId,/^[a-f0-9-]{36}$/);assert.equal(archive.content.workspace.scene.board.turnPieceId,'secret-pawn');assert(archive.content.workspace.scene.actions.some(a=>a.movement));
game=await read(path);await write(path+'/roster','POST',{version:game.version,character_id:a1,status:'remove'});
assert(!(await read(wsPath,alice)).data.scene.board.pieces.some(p=>p.id==='a1'),'Removed character pawn ignored by player projection');
assert((await read(wsPath)).data.scene.board.pieces.some(p=>p.id==='a1'),'GM sees stale pawn to repair');
await cmd('battle.save',{board:(await read(wsPath)).data.scene.board,targets:(await read(wsPath)).data.scene.targets},owner,400);

// Import into a distinct server with different local numeric IDs.
const destination=await fixture();await destination.write('/api/characters','POST',{data:blank('Unrelated local sheet')},destination.owner,201);
const preview=await destination.write('/api/campaigns/import/preview','POST',{archive});assert.equal(preview.mode,'new');
const imported=await destination.write('/api/campaigns/import','POST',{archive,token:preview.token});
const importedWorkspace=await destination.read('/api/campaigns/'+imported.id+'/workspace');const importedA=importedWorkspace.data.scene.board.pieces.find(p=>p.id==='a1');
assert.notEqual(importedA.characterId,a1,'Pawn character ID remapped to destination');
assert.equal(importedWorkspace.data.scene.board.turnPieceId,'secret-pawn','Piece turn ID unchanged');
assert(importedWorkspace.data.scene.actions.some(a=>a.movement&&a.characterId===importedA.characterId),'Movement action remaps actor with pawn');
assert.equal((await destination.read('/api/campaigns/'+imported.id+'/export')).fingerprint,archive.fingerprint,'Full board+movement archive round-trip retains fingerprint');
console.log('Battle validation, LOS, privacy, actor authorization, movement resolve/undo, history and portable remapping tests passed.');
