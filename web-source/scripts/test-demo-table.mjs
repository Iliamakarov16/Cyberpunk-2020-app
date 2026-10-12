import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ts=createRequire(import.meta.url)(path.join(project,'node_modules/typescript'));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'nightcity-demo-table-'));
try{
 for(const name of ['battle','campaign-demo']){
  const source=fs.readFileSync(path.join(project,'lib',name+'.ts'),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText.replaceAll('require("@/lib/battle")','require("./battle.cjs")');
  fs.writeFileSync(path.join(temporary,name+'.cjs'),compiled);
 }
 const {createDemoState,demoSnapshot,applyDemoCommand}=createRequire(import.meta.url)(path.join(temporary,'campaign-demo.cjs'));
 let state=createDemoState(),sequence=0;
 const run=(role,command,args={})=>{const result=applyDemoCommand(state,role,{version:state.version,requestId:`test-${++sequence}`,command,...args});state=result.state;return result.response;};
 const fails=(role,command,args,status)=>assert.throws(()=>run(role,command,args),error=>error.status===status);
 const original=createDemoState(),gm=demoSnapshot(original,'gm'),player=demoSnapshot(original,'player');
 assert.equal(gm.is_gm,true);assert.equal(player.is_gm,false);
 assert.equal(player.characters.length,1);assert.equal(player.characters[0].name,'Вега');
 assert.equal(gm.data.scene.board.pieces.length,6);
 assert(player.data.scene.board.tiles.includes('unknown'));
 assert(!player.data.scene.board.pieces.some(p=>p.targetId==='turret'));
 assert(!player.data.scene.targets.some(t=>t.id==='turret'));
 assert.equal(player.data.contacts[0].notes,'');
 assert(!JSON.stringify(player).includes('Мара скрывает'));
 assert(!JSON.stringify(player).includes('Турель за стеной'));
 fails('player','battle.move',{id:'pawn-guard',x:4,y:5},403);
 fails('player','battle.save',{board:original.data.scene.board,targets:original.data.scene.targets},403);
 fails('player','action.submit',{characterId:102,targetId:'guard',kind:'other',description:'Подойти',tool:''},403);
 fails('player','action.submit',{characterId:101,targetId:'turret',kind:'attack',description:'Выстрелить',tool:''},403);
 fails('player','action.submit',{characterId:101,targetId:'guard',kind:'attack',description:'Выстрелить',tool:'',roll:20},400);
 fails('player','action.submit',{characterId:101,targetId:'guard',kind:'other',description:'Идти',tool:'',movement:{fromX:2,fromY:6,x:3,y:6}},400);
 run('player','action.submit',{characterId:101,targetId:'guard',kind:'other',description:'Попрошу пропустить меня к мастерской',tool:''});
 let action=state.data.scene.actions[0];assert.equal(action.status,'submitted');
 fails('player','action.roll',{id:action.id,roll:14,damage:null},409);
 fails('player','action.approve',{id:action.id},403);
 run('gm','action.approve',{id:action.id});
 run('player','action.roll',{id:action.id,roll:14,damage:null});
 run('gm','action.resolve',{id:action.id,result:'Охранник просит показать пропуск.'});
 action=state.data.scene.actions[0];assert.equal(action.status,'resolved');assert.equal(action.roll,14);assert.equal(state.data.scene.log.length,1);
 assert.equal(demoSnapshot(state,'player').data.scene.actions[0].result,'Охранник просит показать пропуск.');
 run('gm','action.undo',{id:action.id});assert.equal(state.data.scene.actions[0].status,'approved');assert.equal(state.data.scene.log.length,0);
 run('gm','action.reject',{id:action.id,result:'Без пропуска входа нет.'});
 run('gm','action.undo',{id:action.id});assert.equal(state.data.scene.actions[0].status,'approved');

 state=createDemoState();run('player','battle.requestMove',{characterId:101,x:3,y:6});
 const move=state.data.scene.actions[0];assert.deepEqual(move.movement,{fromX:2,fromY:6,x:3,y:6});
 assert.equal(state.data.scene.board.pieces.find(p=>p.characterId===101).x,2);
 run('gm','action.approve',{id:move.id});run('gm','action.resolve',{id:move.id,result:'Вега подходит ближе.'});
 assert.equal(state.data.scene.board.pieces.find(p=>p.characterId===101).x,3);
 run('gm','action.undo',{id:move.id});assert.equal(state.data.scene.board.pieces.find(p=>p.characterId===101).x,2);
 run('gm','battle.move',{id:'pawn-nix',x:3,y:6});
 const version=state.version;fails('gm','action.resolve',{id:move.id,result:'Вега подходит ближе.'},409);assert.equal(state.version,version);assert.equal(state.data.scene.actions[0].status,'approved');
 fails('player','battle.requestMove',{characterId:101,x:8,y:6},403);
 fails('player','battle.requestMove',{characterId:101,x:5,y:6},400);
 const removed=state.data.scene.targets.filter(t=>t.id!=='guard');fails('gm','scene.save',{name:'Другая сцена',active:true,targets:removed},400);
 const snapshot=state.data.scene.board;run('gm','scene.save',{name:'Имя изменено',active:true,targets:state.data.scene.targets});assert.deepEqual(state.data.scene.board,snapshot);
 const payload={version:state.version,requestId:'repeat-safe',command:'message.reply',contactId:'mara',characterId:101,body:'Принято.'};
 const result=applyDemoCommand(state,'player',payload);state=result.state;const duplicate=applyDemoCommand(state,'player',payload);assert.equal(duplicate.response.duplicate,true);assert.equal(duplicate.state.data.messages.length,state.data.messages.length);
 assert.throws(()=>applyDemoCommand(state,'player',{...payload,body:'Другое сообщение'}),error=>error.status===409);
 console.log('Учебный стол: роли, скрытые данные, полный маршрут заявки, движение после решения, откат и повтор запроса — пройдены.');
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
