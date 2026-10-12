import {sharedReadScope} from './character-access';
import {APP_VERSION,API_VERSION} from '@/lib/app-version';
import { validateBattleBoard, validateMovement, visibleBattleCells, projectBattleBoard, targetVisibleToActor, canOccupyBattleCell, movementFloorTarget } from '../../../lib/battle';
type DB=D1Database;
type User={id:number;username:string};
class WorkspaceFailure extends Error{constructor(public status:number,message:string){super(message);}}
const fail=(status:number,message:string):never=>{throw new WorkspaceFailure(status,message);};
const stamp=()=>Math.floor(Date.now()/1000);
const uid=()=>crypto.randomUUID();
const json=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function text(v:any,label:string,max=2000,required=false){if(typeof v!=='string'||v.length>max)fail(400,'Проверь поле «'+label+'».');const s=v.trim();if(required&&!s)fail(400,'Заполни поле «'+label+'».');return s;}
function number(v:any,label:string,min=0,max=1e9){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail(400,'Проверь число «'+label+'».');return v;}
function integer(v:any,label:string,min=0,max=1e9){const n=number(v,label,min,max);if(!Number.isInteger(n))fail(400,'Проверь число «'+label+'».');return n;}
function id(v:any){const s=text(v,'ID',80,true);if(!/^[a-zA-Z0-9_-]+$/.test(s))fail(400,'Некорректный ID.');return s;}
function ids(v:any):number[]{if(!Array.isArray(v)||v.length>30)fail(400,'Выбери персонажей кампании.');return [...new Set<number>(v.map((x:any)=>integer(x,'Персонаж',1)))];}
function array(v:any,max:number):any[]{if(!Array.isArray(v)||v.length>max)fail(400,'Слишком много записей. Сохрани архив кампании.');if(v.some((x:any)=>!x||typeof x!=='object'||Array.isArray(x)))fail(400,'Проверь формат записи.');return v;}
function bool(v:any){if(typeof v!=='boolean')fail(400,'Проверь переключатель.');return v;}
function enumOf(v:any,values:string[]){if(!values.includes(v))fail(400,'Проверь выбранный вариант.');return v;}
function object(v:any){if(!v||typeof v!=='object'||Array.isArray(v))fail(400,'Проверь формат записи.');return v;}
function contact(v:any){return {id:id(v.id),name:text(v.name,'Имя контакта',100,true),phone:text(v.phone??'','Номер',80),description:text(v.description??'','Описание',3000),notes:text(v.notes??'','Заметки ГМ',6000),recipients:ids(v.recipients??[])};}
function place(v:any){return {id:id(v.id),name:text(v.name,'Название места',100,true),address:text(v.address??'','Адрес',200),description:text(v.description??'','Описание места',3000),x:number(v.x??50,'X',0,100),y:number(v.y??50,'Y',0,100),recipients:ids(v.recipients??[])};}
function asset(v:any){return {id:id(v.id),kind:enumOf(v.kind,['vehicle','property']),name:text(v.name,'Название имущества',100,true),ownerCharacterId:v.ownerCharacterId==null?null:integer(v.ownerCharacterId,'Владелец',1),access:ids(v.access??[]),location:text(v.location??'','Расположение',200),condition:text(v.condition??'','Состояние',1000),cost:number(v.cost??0,'Стоимость',0,1e12),upkeep:number(v.upkeep??0,'Расходы',0,1e12),notes:text(v.notes??'','Заметки',3000),contents:text(v.contents??'','Содержимое',6000)};}
function target(v:any){return {id:id(v.id),name:text(v.name,'Цель',100,true),kind:enumOf(v.kind,['person','device','program']),description:text(v.description??'','Описание цели',2000),visible:bool(v.visible??true)};}
function syncBoardTargets(board:ReturnType<typeof validateBattleBoard>,targets:ReturnType<typeof target>[]){return {...board,pieces:board.pieces.map(p=>{const linked=p.kind==='target'?targets.find(t=>t.id===p.targetId):undefined;return linked?{...p,name:linked.name,description:linked.description.slice(0,1500),hidden:!linked.visible}:p;})};}
function roll(v:any){return v==null?null:integer(v,'Результат броска',0,10000);}
function action(v:any){return {id:id(v.id),characterId:integer(v.characterId,'Персонаж',1),targetId:id(v.targetId),kind:enumOf(v.kind,['attack','program','other']),description:text(v.description,'Действие',2000,true),tool:text(v.tool??'','Оружие / программа',200),roll:roll(v.roll),damage:roll(v.damage),status:enumOf(v.status,['submitted','approved','resolved','rejected']),result:text(v.result??'','Результат',3000),created:integer(v.created,'Время',0,1e12),resolvedAt:v.resolvedAt==null?null:integer(v.resolvedAt,'Время',0,1e12),...(Object.prototype.hasOwnProperty.call(v,'movement')?{movement:validateMovement(v.movement)}:{})};}
export function emptyWorkspace(){return {schemaVersion:1,contacts:[],messages:[],places:[],assets:[],scene:{id:uid(),name:'Новая сцена',active:false,targets:[],actions:[],log:[]}};}
export function validateWorkspace(raw:any,characterIds?:number[],acceptedCharacterIds?:number[]){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||(raw.schemaVersion??1)!==1)fail(400,'Неизвестный формат терминала.');
 const scene=object(raw.scene??{id:uid(),name:'Новая сцена',active:false,targets:[],actions:[],log:[]});
 const out={schemaVersion:1,
 contacts:array(raw.contacts??[],100).map(contact),
 messages:array(raw.messages??[],1000).map(v=>({id:id(v.id),contactId:id(v.contactId),characterId:integer(v.characterId,'Персонаж',1),sender:enumOf(v.sender,['npc','character']),body:text(v.body,'Сообщение',3000,true),created:integer(v.created,'Время',0,1e12)})),
 places:array(raw.places??[],100).map(place),assets:array(raw.assets??[],100).map(asset),
 scene:{id:id(scene.id),name:text(scene.name,'Сцена',100,true),active:bool(scene.active),targets:array(scene.targets??[],40).map(target),actions:array(scene.actions??[],200).map(action),log:array(scene.log??[],300).map(v=>({id:id(v.id),text:text(v.text,'Событие',3500,true),created:integer(v.created,'Время',0,1e12),...(v.targetId?{targetId:id(v.targetId)}:{})})),...(Object.prototype.hasOwnProperty.call(scene,'board')?{board:validateBattleBoard(scene.board,acceptedCharacterIds?new Set(acceptedCharacterIds):characterIds?new Set(characterIds):undefined,new Set<string>(array(scene.targets??[],40).map(v=>id(v.id))))}:{})}};
 for(const rows of [out.contacts,out.messages,out.places,out.assets,out.scene.targets,out.scene.actions,out.scene.log])if(new Set(rows.map(v=>v.id)).size!==rows.length)fail(400,'ID записей должны различаться.');
 const contacts=new Set(out.contacts.map(v=>v.id)),targets=new Set(out.scene.targets.map(v=>v.id));
 if(out.messages.some(v=>!contacts.has(v.contactId))||out.scene.actions.some(v=>!targets.has(v.targetId))||out.scene.log.some(v=>v.targetId&&!targets.has(v.targetId)))fail(400,'Запись ссылается на удалённый контакт или цель.');
 for(const a of out.scene.actions)if(a.movement){validateMovement(a.movement,out.scene.board);if(a.kind!=='other'||a.targetId!=='battle-floor')fail(400,'Перемещение должно относиться к полю боя.');}
 if(new TextEncoder().encode(JSON.stringify(out)).length>1700000)fail(413,'Терминал слишком большой. Сохрани архив и сократи старые записи.');
 return out;
}
function replace(rows:any[],entry:any){const i=rows.findIndex(v=>v.id===entry.id);if(i<0)rows.push(entry);else rows[i]=entry;}
function hasOwn(list:number[],own:Set<number>){return list.some(i=>own.has(i));}
function project(data:any,own:Set<number>,approved:Set<number>,gm:boolean){
 if(gm)return data;
 const contacts=data.contacts.filter((v:any)=>hasOwn(v.recipients,own)).map((v:any)=>({id:v.id,name:v.name,phone:v.phone,description:v.description,recipients:v.recipients.filter((i:number)=>own.has(i))}));
 const board=data.scene.board?projectBattleBoard(data.scene.board,own,approved,new Set<string>(data.scene.targets.filter((v:any)=>v.visible).map((v:any)=>v.id))):null;
 const targetShown=(targetId:string,characterId?:number)=>!data.scene.board||(characterId!==undefined?targetVisibleToActor(data.scene.board,targetId,characterId):[...own].some(i=>targetVisibleToActor(data.scene.board,targetId,i)));
 const known=new Set(contacts.map((v:any)=>v.id)),targets=data.scene.targets.filter((v:any)=>v.visible&&targetShown(v.id)),visible=new Set(targets.map((v:any)=>v.id));
 return {...data,contacts,messages:data.messages.filter((v:any)=>own.has(v.characterId)&&known.has(v.contactId)),
 places:data.places.filter((v:any)=>hasOwn(v.recipients,own)).map((v:any)=>({...v,recipients:v.recipients.filter((i:number)=>own.has(i))})),
 assets:data.assets.filter((v:any)=>own.has(v.ownerCharacterId)||hasOwn(v.access,own)).map((v:any)=>({...v,access:v.access.filter((i:number)=>approved.has(i)),ownerCharacterId:approved.has(v.ownerCharacterId)?v.ownerCharacterId:null})),
 scene:{...data.scene,...(board?{board}:{}),targets,actions:data.scene.actions.filter((v:any)=>own.has(v.characterId)&&visible.has(v.targetId)&&targetShown(v.targetId,v.characterId)),log:data.scene.log.filter((v:any)=>v.targetId&&visible.has(v.targetId))}};
}
export async function workspaceRoutes(db:DB,user:User,path:string,method:string,payload:any):Promise<Response|null>{
 const match=path.match(/^\/api\/campaigns\/(\d+)\/workspace$/);if(!match)return null;
 const cid=Number(match[1]),campaign=await db.prepare('SELECT * FROM campaigns WHERE id=?').bind(cid).first<any>();
 if(!campaign)fail(404,'Кампания не найдена.');
 const gm=campaign.gm_id===user.id;
 const rows=(await db.prepare("SELECT c.id,c.owner_id,c.data,cc.status FROM characters c JOIN campaign_characters cc ON cc.character_id=c.id WHERE cc.campaign_id=? AND cc.status IN ('active','reserve') ORDER BY c.id").bind(cid).all<any>()).results;
 const own=new Set<number>(rows.filter(v=>v.owner_id===user.id).map(v=>v.id)),approved=new Set<number>(rows.map(v=>v.id));
 if(!gm&&!own.size)fail(403,'Терминал доступен после принятия твоего персонажа в кампанию.');
 let stored=await db.prepare('SELECT * FROM campaign_workspaces WHERE campaign_id=?').bind(cid).first<any>();
 if(!stored){await db.prepare('INSERT OR IGNORE INTO campaign_workspaces(campaign_id,data,version,updated) VALUES(?,?,1,?)').bind(cid,JSON.stringify(emptyWorkspace()),stamp()).run();stored=await db.prepare('SELECT * FROM campaign_workspaces WHERE campaign_id=?').bind(cid).first<any>();}
 const data=validateWorkspace(JSON.parse(stored.data));
 if(method==='GET')return json({version:stored.version,updated:stored.updated,is_gm:gm,characters:rows.filter(v=>gm||own.has(v.id)).map(v=>{const d=JSON.parse(v.data);return {id:v.id,owner_id:v.owner_id,name:d.name,role:d.role,status:v.status};}),data:project(data,own,approved,gm)});
 if(method!=='POST')fail(405,'Метод не поддерживается.');
 const requestId=payload.requestId==null?null:id(payload.requestId),recent=JSON.parse(stored.recent_requests||'[]');
 const bodyHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({...payload,version:undefined}))))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const duplicate=requestId?recent.find((v:any)=>v.id===requestId&&v.userId===user.id):null;
 if(duplicate){if(duplicate.hash!==bodyHash)fail(409,'Этот запрос уже использован для другого действия.');return json({version:stored.version,updated:stored.updated,duplicate:true});}
 const version=integer(payload.version,'Версия',1);
 if(version!==stored.version)fail(409,'Терминал изменился. Обнови данные; твой текст останется в форме.');
 const command=text(payload.command,'Команда',50,true),time=stamp();
 const requireGM=()=>{if(!gm)fail(403,'Это действие доступно ведущему кампании.');};
 const checked=(values:number[])=>{if(values.some(v=>!approved.has(v)))fail(400,'Выбери принятых персонажей этой кампании.');return values;};
 const getContact=()=>{const entry=data.contacts.find(v=>v.id===payload.contactId);if(!entry)fail(404,'Контакт не найден.');return entry!;};
 const preserveTargets=(targets:any[])=>{const used=new Set(data.scene.actions.map(v=>v.targetId));data.scene.log.forEach(v=>{if(v.targetId)used.add(v.targetId);});if([...used].some(v=>!targets.some(t=>t.id===v)))fail(400,'Цель с историей действий можно скрыть, сохранив её запись.');};
 const actorTargetVisible=(targetId:string,characterId:number)=>!data.scene.board||targetVisibleToActor(data.scene.board,targetId,characterId);
 const movePawn=(a:any,undo=false)=>{
  const board=data.scene.board??fail(409,'Поле боя изменилось. Проверь перемещение перед подтверждением.');
  const pawn=board.pieces.find(p=>p.kind==='character'&&p.characterId===a.characterId)??fail(409,'Пешка персонажа отсутствует на поле.');if(!approved.has(a.characterId))fail(409,'Пешка персонажа отсутствует в принятом составе.');
  const m=validateMovement(a.movement,board),fromX=undo?m.x:m.fromX,fromY=undo?m.y:m.fromY,x=undo?m.fromX:m.x,y=undo?m.fromY:m.y;
  if(pawn.x!==fromX||pawn.y!==fromY)fail(409,'Пешка уже переместилась. Обнови поле и проверь действие.');
  if(!canOccupyBattleCell(board,pawn,x,y))fail(409,'Клетка перемещения теперь занята или закрыта. Проверь поле.');
  pawn.x=x;pawn.y=y;
 };
 let actorCharacter:number|null=null;
 if(command==='contact.save'){requireGM();const v=contact(object(payload.contact));checked(v.recipients);replace(data.contacts,v);}
 else if(command==='contact.delete'){requireGM();const key=id(payload.id);data.contacts=data.contacts.filter(v=>v.id!==key);data.messages=data.messages.filter(v=>v.contactId!==key);}
 else if(command==='message.send'){
  requireGM();const c=getContact(),recipients=checked(ids(payload.characterIds)),body=text(payload.body,'Сообщение',3000,true);
  if(!recipients.length||recipients.some(v=>!c.recipients.includes(v)))fail(400,'Сначала выдай контакт выбранным персонажам.');
  for(const characterId of recipients)data.messages.push({id:uid(),contactId:c.id,characterId,sender:'npc',body,created:time});
 }else if(command==='message.reply'){
  const c=getContact(),characterId=integer(payload.characterId,'Персонаж',1);actorCharacter=characterId;
  if(!own.has(characterId)||!c.recipients.includes(characterId))fail(403,'Этот контакт не доступен твоему персонажу.');
  data.messages.push({id:uid(),contactId:c.id,characterId,sender:'character',body:text(payload.body,'Сообщение',3000,true),created:time});
 }else if(command==='place.save'){requireGM();const v=place(object(payload.place));checked(v.recipients);replace(data.places,v);}
 else if(command==='place.delete'){requireGM();data.places=data.places.filter(v=>v.id!==id(payload.id));}
 else if(command==='asset.save'){requireGM();const v=asset(object(payload.asset));checked(v.access);if(v.ownerCharacterId!=null)checked([v.ownerCharacterId]);replace(data.assets,v);}
 else if(command==='asset.delete'){requireGM();data.assets=data.assets.filter(v=>v.id!==id(payload.id));}
 else if(command==='battle.save'){
  requireGM();const targets=array(payload.targets,40).map(target),floor=movementFloorTarget();replace(targets,floor);array(targets,40);preserveTargets(targets);
  const board=syncBoardTargets(validateBattleBoard(payload.board,approved,new Set(targets.map(t=>t.id))),targets);
  data.scene={...data.scene,targets,board};
 }else if(command==='battle.move'){
  requireGM();const board=data.scene.board??fail(400,'Сначала создай поле боя.');
  const pawn=board.pieces.find(p=>p.id===payload.id)??fail(404,'Пешка не найдена.');
  if(pawn.characterId!==null&&!approved.has(pawn.characterId))fail(400,'Верни персонажа в принятый состав или исправь поле.');
  const x=integer(payload.x,'X',0,board.width-1),y=integer(payload.y,'Y',0,board.height-1);if(!canOccupyBattleCell(board,pawn,x,y))fail(400,'Клетка занята, находится в стене или за закрытой дверью.');
  pawn.x=x;pawn.y=y;
 }else if(command==='battle.requestMove'){
  if(!data.scene.active)fail(400,'Ведущий ещё не открыл сцену.');
  const characterId=integer(payload.characterId,'Персонаж',1);actorCharacter=characterId;if(!own.has(characterId))fail(403,'Выбери своего персонажа.');
  const board=data.scene.board??fail(400,'Ведущий ещё не создал поле боя.');
  const pawn=board.pieces.find(p=>p.kind==='character'&&p.characterId===characterId)??fail(400,'Твоего персонажа ещё нет на поле боя.');
  const x=integer(payload.x,'X',0,board.width-1),y=integer(payload.y,'Y',0,board.height-1);
  if(!visibleBattleCells(board,pawn).includes(y*board.width+x))fail(403,'Персонаж не видит эту клетку.');
  if(x===pawn.x&&y===pawn.y)fail(400,'Персонаж уже стоит в этой клетке.');
  if(!canOccupyBattleCell(board,pawn,x,y))fail(400,'В эту клетку сейчас нельзя переместиться.');
  const floor=data.scene.targets.find(t=>t.id==='battle-floor'&&t.visible)??fail(409,'Обнови поле боя: отсутствует цель для перемещения.');
  data.scene.actions.push(action({id:uid(),characterId,targetId:floor.id,kind:'other',description:'Переместиться из клетки ('+(pawn.x+1)+', '+(pawn.y+1)+') в клетку ('+(x+1)+', '+(y+1)+').',tool:'',roll:null,damage:null,status:'submitted',result:'',created:time,resolvedAt:null,movement:{fromX:pawn.x,fromY:pawn.y,x,y}}));
 }else if(command==='scene.save'){
  requireGM();const targets=array(payload.targets,40).map(target);if(data.scene.board){replace(targets,movementFloorTarget());array(targets,40);}preserveTargets(targets);
  if(data.scene.board)data.scene.board=syncBoardTargets(validateBattleBoard(data.scene.board,undefined,new Set(targets.map(t=>t.id))),targets);
  const active=bool(payload.active);if(active&&!targets.some(t=>t.visible))fail(400,'Чтобы открыть сцену, покажи игрокам хотя бы одну цель.');
  data.scene={...data.scene,name:text(payload.name,'Сцена',100,true),active,targets};
 }else if(command==='action.submit'){
  if(!data.scene.active)fail(400,'Ведущий ещё не открыл сцену.');
  const characterId=integer(payload.characterId,'Персонаж',1);actorCharacter=characterId;
  if(!own.has(characterId))fail(403,'Выбери своего персонажа.');
  const t=data.scene.targets.find(v=>v.id===payload.targetId&&v.visible&&actorTargetVisible(v.id,characterId));if(!t)fail(404,'Цель сейчас не видна этому персонажу.');
  if(Object.prototype.hasOwnProperty.call(payload,'movement'))fail(400,'Перемещение отправляется отдельным действием с поля боя.');
  if(payload.roll!=null||payload.damage!=null)fail(400,'Сначала отправь намерение без кубиков и дождись разрешения ГМ.');
  data.scene.actions.push(action({id:uid(),characterId,targetId:t!.id,kind:payload.kind,description:payload.description,tool:payload.tool,roll:payload.roll,damage:payload.damage,status:'submitted',result:'',created:time,resolvedAt:null}));
 }else if(command.startsWith('action.')){
  const a=data.scene.actions.find(v=>v.id===payload.id);if(!a)fail(404,'Действие не найдено.');
  if(command==='action.roll'){
   actorCharacter=a!.characterId;if(!own.has(a!.characterId))fail(403,'Бросок можно внести только в своё действие.');
   if(a!.status!=='approved')fail(409,'Сначала дождись разрешения ГМ. Кубики вносятся в разрешённое действие.');
   if(!data.scene.targets.some(v=>v.id===a!.targetId&&v.visible&&actorTargetVisible(v.id,a!.characterId)))fail(403,'Цель сейчас недоступна этому персонажу.');
   a!.roll=roll(payload.roll);a!.damage=roll(payload.damage);
  }else{
   requireGM();
   if(command==='action.approve'){if(a!.status!=='submitted')fail(409,'Действие уже рассмотрено.');a!.status='approved';}
   else if(command==='action.resolve'){
    if(a!.status!=='approved')fail(409,'Сначала подтверди действие.');
    const result=text(payload.result,'Описание результата',3000,true);if(a!.movement)movePawn(a!);
    a!.status='resolved';a!.result=result;a!.resolvedAt=time;
    const t=data.scene.targets.find(v=>v.id===a!.targetId)!;const name=rows.find(v=>v.id===a!.characterId);const actor=name?JSON.parse(name.data).name:'Персонаж';
    replace(data.scene.log,{id:a!.id,targetId:t.id,text:actor+' → '+t.name+': '+a!.result,created:time});
   }else if(command==='action.reject'){if(!['submitted','approved'].includes(a!.status))fail(409,'Действие уже завершено.');a!.status='rejected';a!.result=text(payload.result??'Действие отклонено','Причина',3000,true);a!.resolvedAt=time;}
   else if(command==='action.undo'){if(!['resolved','rejected'].includes(a!.status))fail(409,'Нет завершённого результата для отмены.');if(a!.status==='resolved'&&a!.movement)movePawn(a!,true);a!.status='approved';a!.result='';a!.resolvedAt=null;data.scene.log=data.scene.log.filter(v=>v.id!==a!.id);}
   else fail(400,'Неизвестная команда.');
  }
 }else fail(400,'Неизвестная команда.');
 const encoded=JSON.stringify(validateWorkspace(data)),requests=JSON.stringify(requestId?[...recent,{id:requestId,userId:user.id,hash:bodyHash}].slice(-100):recent);
 const permission=gm?'k.gm_id=?':"EXISTS(SELECT 1 FROM campaign_characters cc JOIN characters c ON c.id=cc.character_id WHERE cc.campaign_id=k.id AND cc.status IN ('active','reserve') AND c.owner_id=? AND c.id=?)";
 const authValues=gm?[user.id]:[user.id,actorCharacter];
 const guardId=uid();let result:any[];
 try{result=await db.batch([
  db.prepare('UPDATE campaign_workspaces SET data=?,version=version+1,updated=?,recent_requests=? WHERE campaign_id=? AND version=? AND EXISTS(SELECT 1 FROM campaigns k WHERE k.id=? AND k.version=? AND '+permission+')').bind(encoded,time,requests,cid,version,cid,campaign.version,...authValues),
  db.prepare('UPDATE campaigns SET version=version+1,updated=? WHERE id=? AND version=? AND changes()=1').bind(time,cid,campaign.version),
  db.prepare('INSERT INTO campaign_transfer_guards(id,passed) VALUES(?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)').bind(guardId),
  db.prepare('DELETE FROM campaign_transfer_guards WHERE id=?').bind(guardId),
 ]);}catch(error){if(error instanceof Error&&error.message.includes('campaign_transfer_guard'))fail(409,'Кампания уже изменилась. Обнови данные; твой черновик сохранён в форме.');throw error;}
 if(result[0].meta.changes!==1||result[1].meta.changes!==1)fail(409,'Кампания уже изменилась. Обнови данные; твой черновик сохранён в форме.');
 return json({version:version+1,updated:time});
}
export async function syncView(db:DB,user:User){
 const sheets=(await db.prepare(`SELECT c.id,c.version,c.owner_id FROM characters c WHERE c.owner_id=? OR EXISTS(SELECT 1 FROM campaign_characters cc JOIN campaigns k ON k.id=cc.campaign_id WHERE cc.character_id=c.id AND k.gm_id=?) OR ${sharedReadScope} ORDER BY c.id`).bind(user.id,user.id,user.id,user.id).all()).results;
 const campaigns=(await db.prepare("SELECT k.id,k.version,k.gm_id,COALESCE(w.version,0) AS workspace_version FROM campaigns k LEFT JOIN campaign_workspaces w ON w.campaign_id=k.id WHERE k.gm_id=? OR k.transfer_to=? OR EXISTS(SELECT 1 FROM campaign_members m WHERE m.campaign_id=k.id AND m.user_id=?) OR EXISTS(SELECT 1 FROM campaign_characters cc JOIN characters c ON c.id=cc.character_id WHERE cc.campaign_id=k.id AND c.owner_id=?) ORDER BY k.id").bind(user.id,user.id,user.id,user.id).all()).results;
 const exterior=(await db.prepare("SELECT DISTINCT c.id,c.version FROM characters c JOIN campaign_characters cc ON cc.character_id=c.id WHERE cc.status IN ('active','reserve') AND EXISTS(SELECT 1 FROM campaign_characters vc JOIN characters v ON v.id=vc.character_id WHERE vc.campaign_id=cc.campaign_id AND vc.status IN ('active','reserve') AND v.owner_id=?) ORDER BY c.id").bind(user.id).all()).results;
 const mode=await db.prepare('SELECT mode FROM user_modes WHERE user_id=?').bind(user.id).first();
 const bits=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({sheets,campaigns,exterior,mode})));
 return {version:APP_VERSION,apiVersion:API_VERSION,signature:[...new Uint8Array(bits)].map(v=>v.toString(16).padStart(2,'0')).join('')};
}
