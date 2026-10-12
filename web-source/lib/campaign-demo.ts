import {battleCellIndex,canOccupyBattleCell,movementFloorTarget,projectBattleBoard,targetVisibleToActor,validateBattleBoard,validateMovement,visibleBattleCells,type BattleBoard,type BattleBoardView,type Movement} from '@/lib/battle';

/** A deliberately isolated teaching table. It never calls a campaign API or saves a sheet. */
export type DemoRole='gm'|'player';
export const DEMO_CAMPAIGN_ID=900099;
export const DEMO_ACCOUNTS={gm:{id:900,username:'Учебный ведущий'},player:{id:901,username:'Учебный игрок'}};
export type DemoCharacter={id:number;name:string;role:string;owner_id:number;status:'active'|'reserve'};
export type DemoTarget={id:string;name:string;kind:'person'|'device'|'program';description:string;visible:boolean};
export type DemoAction={id:string;characterId:number;targetId:string;kind:'attack'|'program'|'other';description:string;tool:string;roll:number|null;damage:number|null;status:'submitted'|'approved'|'resolved'|'rejected';result:string;created:number;resolvedAt:number|null;movement?:Movement};
type DemoContact={id:string;name:string;phone:string;description:string;notes:string;recipients:number[]};
type DemoMessage={id:string;contactId:string;characterId:number;sender:'npc'|'character';body:string;created:number};
type DemoPlace={id:string;name:string;address:string;description:string;x:number;y:number;recipients:number[]};
type DemoAsset={id:string;kind:'vehicle'|'property';name:string;ownerCharacterId:number|null;access:number[];location:string;condition:string;cost:number;upkeep:number;notes:string;contents:string};
export type DemoWorkspace={schemaVersion:1;contacts:DemoContact[];messages:DemoMessage[];places:DemoPlace[];assets:DemoAsset[];scene:{id:string;name:string;active:boolean;targets:DemoTarget[];actions:DemoAction[];log:{id:string;targetId?:string;text:string;created:number}[];board?:BattleBoard}};
export type DemoState={version:number;updated:number;characters:DemoCharacter[];data:DemoWorkspace;sequence:number;requests:Record<string,{fingerprint:string;account:number}>};
export type DemoSnapshot={version:number;updated:number;is_gm:boolean;characters:DemoCharacter[];data:Omit<DemoWorkspace,'scene'>&{scene:Omit<DemoWorkspace['scene'],'board'>&{board?:BattleBoard|BattleBoardView}}};
export class DemoFailure extends Error{constructor(public status:number,message:string){super(message);this.name='DemoFailure';}}
const fail=(status:number,message:string):never=>{throw new DemoFailure(status,message);};
const copy=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
const now=()=>Math.floor(Date.now()/1000);
const text=(v:unknown,label:string,max=2000,required=false)=>{if(typeof v!=='string'||v.length>max)fail(400,`Проверь поле «${label}».`);const value=(v as string).trim();if(required&&!value)fail(400,`Заполни поле «${label}».`);return value;};
const id=(v:unknown)=>{const value=text(v,'ID',80,true);if(!/^[a-zA-Z0-9_-]+$/.test(value))fail(400,'Проверь ID учебной записи.');return value;};
const number=(v:unknown,label:string,min=0,max=1e9)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail(400,`Проверь число «${label}».`);return v as number;};
const integer=(v:unknown,label:string,min=0,max=1e9)=>{const n=number(v,label,min,max);if(!Number.isSafeInteger(n))fail(400,`Проверь целое число «${label}».`);return n;};
const bool=(v:unknown)=>{if(typeof v!=='boolean')fail(400,'Проверь переключатель учебной сцены.');return v as boolean;};
const roll=(v:unknown)=>v==null?null:integer(v,'Результат кубиков',0,10000);
function values<T extends string>(v:unknown,list:readonly T[]):T{if(!list.includes(v as T))fail(400,'Выбери доступный вариант.');return v as T;}
function record(v:unknown):Record<string,any>{if(!v||typeof v!=='object'||Array.isArray(v))fail(400,'Проверь учебную запись.');return v as Record<string,any>;}
function replace<T extends {id:string}>(rows:T[],value:T){const index=rows.findIndex(row=>row.id===value.id);if(index<0)rows.push(value);else rows[index]=value;}
function targetList(raw:unknown):DemoTarget[]{if(!Array.isArray(raw)||raw.length>40)fail(400,'В сцене может быть до 40 целей.');const targets=(raw as unknown[]).map(entry=>{const v=record(entry);return{id:id(v.id),name:text(v.name,'Название цели',100,true),kind:values(v.kind,['person','device','program'] as const),description:text(v.description??'','Описание цели',2000),visible:bool(v.visible??true)};});if(new Set(targets.map(t=>t.id)).size!==targets.length)fail(400,'ID целей должны различаться.');return targets;}
function ownCharacters(state:DemoState,role:DemoRole){const account=DEMO_ACCOUNTS[role].id;return new Set(state.characters.filter(c=>c.owner_id===account).map(c=>c.id));}

export function createDemoState():DemoState{
 const width=12,height=10,tiles:BattleBoard['tiles']=Array(width*height).fill('floor');
 for(let y=0;y<height;y++)tiles[y*width+7]=y===5?'door':'wall';
 tiles[6*width+4]='cover';tiles[2*width+3]='cover';
 const board:BattleBoard={schemaVersion:1,width,height,cellMeters:2,vision:6,tiles,turnPieceId:'pawn-vega',pieces:[
  {id:'pawn-vega',kind:'character',characterId:101,targetId:null,name:'Вега',description:'Твой учебный персонаж. Его лист и настоящие персонажи не меняются.',x:2,y:6,hidden:false,initiative:15},
  {id:'pawn-nix',kind:'character',characterId:102,targetId:null,name:'Никс',description:'Второй участник учебной группы.',x:2,y:3,hidden:false,initiative:12},
  {id:'pawn-guard',kind:'target',characterId:null,targetId:'guard',name:'Охранник',description:'Пешка противника; характеристики и обстоятельства задаёт ведущий.',x:5,y:6,hidden:false,initiative:10},
  {id:'pawn-turret',kind:'target',characterId:null,targetId:'turret',name:'Турель за стеной',description:'Игрок не получает эту пешку и её данные, пока она вне обзора.',x:9,y:2,hidden:false,initiative:8},
  {id:'pawn-case',kind:'loot',characterId:null,targetId:null,name:'Кейс',description:'Учебный реквизит. Вещи выдаёт ГМ, инвентарь сам не меняется.',x:4,y:7,hidden:false,initiative:null},
  {id:'pawn-van',kind:'vehicle',characterId:null,targetId:null,name:'Фургон',description:'Пешка транспорта. Учёт владения доступен в разделе «Имущество».',x:1,y:8,hidden:false,initiative:null}
 ]};
 return{version:1,updated:now(),sequence:0,requests:{},characters:[{id:101,name:'Вега',role:'Соло',owner_id:901,status:'active'},{id:102,name:'Никс',role:'Нетраннер',owner_id:902,status:'active'}],data:{schemaVersion:1,
  contacts:[{id:'mara',name:'Мара',phone:'NC-555-0148',description:'Учебная связная. Этот номер работает только внутри истории.',notes:'Пример приватной записи ведущего: Мара скрывает заказчика.',recipients:[101,102]}],
  messages:[{id:'message-brief',contactId:'mara',characterId:101,sender:'npc',body:'Вега, кейс в переулке. Охранник не должен поднять тревогу. Решай, как действовать.',created:now()}],
  places:[{id:'alley',name:'Переулок у мастерской',address:'Условный учебный район',description:'Место встречи. Для работы с полем открой раздел действий.',x:35,y:55,recipients:[101,102]}],
  assets:[{id:'van',kind:'vehicle',name:'Учебный фургон',ownerCharacterId:101,access:[102],location:'В переулке',condition:'Исправен',cost:0,upkeep:0,notes:'Тестовая карточка; деньги не списываются.',contents:'Запись о грузе: коробка инструментов.'}],
  scene:{id:'demo-alley',name:'Учебный переулок',active:true,targets:[{id:'guard',name:'Охранник',kind:'person',description:'Ты видишь его перед собой. Опиши намерение и согласуй его с ГМ.',visible:true},{id:'turret',name:'Турель за стеной',kind:'device',description:'За закрытой дверью. Игрок не видит эту цель из стартовой позиции.',visible:true},movementFloorTarget()],actions:[],log:[],board}
 }};
}

/** Projection uses the same visibility rules as an actual campaign. */
export function demoSnapshot(state:DemoState,role:DemoRole):DemoSnapshot{
 const gm=role==='gm',data=copy(state.data),own=ownCharacters(state,role),accepted=new Set(state.characters.map(c=>c.id));
 if(gm)return{version:state.version,updated:state.updated,is_gm:true,characters:copy(state.characters),data};
 data.contacts=data.contacts.filter(c=>c.recipients.some(id=>own.has(id))).map(c=>({...c,notes:'',recipients:c.recipients.filter(id=>own.has(id))}));
 const known=new Set(data.contacts.map(c=>c.id));data.messages=data.messages.filter(m=>own.has(m.characterId)&&known.has(m.contactId));
 data.places=data.places.filter(p=>p.recipients.some(id=>own.has(id))).map(p=>({...p,recipients:p.recipients.filter(id=>own.has(id))}));
 data.assets=data.assets.filter(a=>(a.ownerCharacterId!==null&&own.has(a.ownerCharacterId))||a.access.some(id=>own.has(id))).map(a=>({...a,access:a.access.filter(id=>accepted.has(id)),ownerCharacterId:a.ownerCharacterId!==null&&accepted.has(a.ownerCharacterId)?a.ownerCharacterId:null}));
 const board=data.scene.board,targets=data.scene.targets.filter(t=>t.visible&&(!board||[...own].some(c=>targetVisibleToActor(board,t.id,c)))),visible=new Set(targets.map(t=>t.id));
 const scene={...data.scene,targets,actions:data.scene.actions.filter(a=>own.has(a.characterId)&&visible.has(a.targetId)),log:data.scene.log.filter(row=>!!row.targetId&&visible.has(row.targetId)),...(board?{board:projectBattleBoard(board,own,accepted,visible)}:{})};
 return{version:state.version,updated:state.updated,is_gm:false,characters:copy(state.characters.filter(c=>own.has(c.id))),data:{...data,scene}};
}

/** Transactional teaching commands: validate a copy, then return a new shared state. */
export function applyDemoCommand(current:DemoState,role:DemoRole,raw:unknown):{state:DemoState;response:{version:number;updated:number;duplicate?:boolean}}{
 const payload=record(raw),command=text(payload.command,'Команда',50,true),account=DEMO_ACCOUNTS[role].id,requestId=payload.requestId==null?null:id(payload.requestId),fingerprint=JSON.stringify({...payload,version:undefined});
 const previous=requestId?current.requests[requestId]:null;
 if(previous){if(previous.account!==account||previous.fingerprint!==fingerprint)fail(409,'Этот учебный запрос уже использован для другого действия.');return{state:current,response:{version:current.version,updated:current.updated,duplicate:true}};}
 if(integer(payload.version,'Версия',1)!==current.version)fail(409,'Учебный стол изменился. Обнови терминал и повтори действие.');
 const state=copy(current),data=state.data,scene=data.scene,own=ownCharacters(state,role),accepted=new Set(state.characters.map(c=>c.id)),time=now();
 const requireGM=()=>{if(role!=='gm')fail(403,'В учебной сцене это действие выполняет ведущий.');};
 const ids=(raw:unknown)=>{if(!Array.isArray(raw)||raw.length>30)fail(400,'Выбери учебных персонажей.');const result=[...new Set((raw as unknown[]).map(v=>integer(v,'Персонаж',1)))];if(result.some(v=>!accepted.has(v)))fail(400,'Персонаж не входит в учебную группу.');return result;};
 const key=()=>id(payload.id);
 const nextId=()=>`demo-${++state.sequence}`;
 const historyTargets=()=>new Set([...scene.actions.map(a=>a.targetId),...scene.log.map(row=>row.targetId).filter((id):id is string=>!!id),...(scene.board?.pieces.map(p=>p.targetId).filter((id):id is string=>!!id)||[])]);
 const keepHistory=(targets:DemoTarget[])=>{if([...historyTargets()].some(id=>!targets.some(t=>t.id===id)))fail(400,'Цель с пешкой или историей можно скрыть, сохранив её запись.');};
 const getContact=()=>{const c=data.contacts.find(c=>c.id===payload.contactId);if(!c)fail(404,'Учебный контакт не найден.');return c!;};
 if(command==='contact.save'){requireGM();const v=record(payload.contact);replace(data.contacts,{id:id(v.id),name:text(v.name,'Имя',100,true),phone:text(v.phone??'','Номер',80),description:text(v.description??'','Описание',3000),notes:text(v.notes??'','Записи ГМ',6000),recipients:ids(v.recipients??[])});}
 else if(command==='contact.delete'){requireGM();const target=key();data.contacts=data.contacts.filter(c=>c.id!==target);data.messages=data.messages.filter(m=>m.contactId!==target);}
 else if(command==='message.send'){requireGM();const c=getContact(),recipients=ids(payload.characterIds),body=text(payload.body,'Сообщение',3000,true);if(!recipients.length||recipients.some(id=>!c.recipients.includes(id)))fail(400,'Сначала выдай контакт получателям.');for(const characterId of recipients)data.messages.push({id:nextId(),contactId:c.id,characterId,sender:'npc',body,created:time});}
 else if(command==='message.reply'){const c=getContact(),characterId=integer(payload.characterId,'Персонаж',1);if(!own.has(characterId)||!c.recipients.includes(characterId))fail(403,'Этот контакт недоступен твоему персонажу.');data.messages.push({id:nextId(),contactId:c.id,characterId,sender:'character',body:text(payload.body,'Сообщение',3000,true),created:time});}
 else if(command==='place.save'){requireGM();const v=record(payload.place);replace(data.places,{id:id(v.id),name:text(v.name,'Место',100,true),address:text(v.address??'','Адрес',200),description:text(v.description??'','Описание',3000),x:number(v.x??50,'X',0,100),y:number(v.y??50,'Y',0,100),recipients:ids(v.recipients??[])});}
 else if(command==='place.delete'){requireGM();data.places=data.places.filter(p=>p.id!==key());}
 else if(command==='asset.save'){requireGM();const v=record(payload.asset),owner=v.ownerCharacterId==null?null:integer(v.ownerCharacterId,'Владелец',1);if(owner!==null&&!accepted.has(owner))fail(400,'Выбери владельца из учебной группы.');replace(data.assets,{id:id(v.id),kind:values(v.kind,['vehicle','property'] as const),name:text(v.name,'Имущество',100,true),ownerCharacterId:owner,access:ids(v.access??[]),location:text(v.location??'','Расположение',200),condition:text(v.condition??'','Состояние',1000),cost:number(v.cost??0,'Стоимость',0,1e12),upkeep:number(v.upkeep??0,'Расходы',0,1e12),notes:text(v.notes??'','Записи',3000),contents:text(v.contents??'','Содержимое',6000)});}
 else if(command==='asset.delete'){requireGM();data.assets=data.assets.filter(a=>a.id!==key());}
 else if(command==='scene.save'){requireGM();const targets=targetList(payload.targets);keepHistory(targets);const active=bool(payload.active);if(active&&!targets.some(t=>t.visible))fail(400,'Для открытой сцены нужна доступная цель.');scene.name=text(payload.name,'Сцена',100,true);scene.active=active;scene.targets=targets;}
 else if(command==='battle.save'){
  requireGM();const targets=targetList(payload.targets);if(!targets.some(t=>t.id==='battle-floor'))targets.push(movementFloorTarget());else targets[targets.findIndex(t=>t.id==='battle-floor')]=movementFloorTarget();if(targets.length>40)fail(400,'Для перемещений оставь одно место из 40 целей.');
  // A new layout may replace pawns; historic targets still remain in the scene.
  const used=new Set([...scene.actions.map(a=>a.targetId),...scene.log.map(row=>row.targetId).filter((v):v is string=>!!v)]);if([...used].some(id=>!targets.some(t=>t.id===id)))fail(400,'Сохрани цели с историей действий.');
  scene.board=validateBattleBoard(payload.board,accepted,new Set(targets.map(t=>t.id)));scene.targets=targets;
 }
 else if(command==='battle.move'){requireGM();const board=scene.board;if(!board)fail(400,'Сначала подготовь поле боя.');const pawn=board!.pieces.find(p=>p.id===key());if(!pawn)fail(404,'Пешка не найдена.');const x=integer(payload.x,'X',0,board!.width-1),y=integer(payload.y,'Y',0,board!.height-1);if(!canOccupyBattleCell(board!,pawn!,x,y))fail(400,'Выбери свободную проходимую клетку.');pawn!.x=x;pawn!.y=y;}
 else if(command==='battle.requestMove'){
  if(!scene.active)fail(400,'Ведущий закрыл приём действий.');const characterId=integer(payload.characterId,'Персонаж',1);if(!own.has(characterId))fail(403,'Выбери своего персонажа.');const board=scene.board,pawn=board?.pieces.find(p=>p.characterId===characterId);if(!board||!pawn)fail(400,'У персонажа нет пешки на поле.');
  const x=integer(payload.x,'X',0,board!.width-1),y=integer(payload.y,'Y',0,board!.height-1);if(pawn!.x===x&&pawn!.y===y)fail(400,'Пешка уже находится в этой клетке.');if(!visibleBattleCells(board!,pawn!).includes(battleCellIndex(board!,x,y)))fail(403,'Персонаж не видит эту клетку.');if(!canOccupyBattleCell(board!,pawn!,x,y))fail(400,'Клетка занята или непроходима.');
  if(!scene.targets.some(t=>t.id==='battle-floor'))scene.targets.push(movementFloorTarget());scene.actions.push({id:nextId(),characterId,targetId:'battle-floor',kind:'other',description:`Переместиться в клетку ${x+1}:${y+1}. Маршрут и возможность движения подтверждает ГМ.`,tool:'',roll:null,damage:null,status:'submitted',result:'',created:time,resolvedAt:null,movement:validateMovement({fromX:pawn!.x,fromY:pawn!.y,x,y},board!)});
 }
 else if(command==='action.submit'){
  if(!scene.active)fail(400,'Ведущий закрыл приём действий.');if('movement'in payload)fail(400,'Перемещение создаётся выбором клетки на поле.');const characterId=integer(payload.characterId,'Персонаж',1);if(!own.has(characterId))fail(403,'Выбери своего персонажа.');const target=scene.targets.find(t=>t.id===payload.targetId&&t.visible);if(!target||(scene.board&&!targetVisibleToActor(scene.board,target.id,characterId)))fail(403,'Персонаж сейчас не видит эту цель.');if(payload.roll!=null||payload.damage!=null)fail(400,'Кубики вносятся после разрешения ГМ.');
  scene.actions.push({id:nextId(),characterId,targetId:target!.id,kind:values(payload.kind,['attack','program','other'] as const),description:text(payload.description,'Намерение',2000,true),tool:text(payload.tool??'','Оружие / программа',200),roll:null,damage:null,status:'submitted',result:'',created:time,resolvedAt:null});
 }
 else if(command.startsWith('action.')){
  const action=scene.actions.find(a=>a.id===key());if(!action)fail(404,'Учебное действие не найдено.');const a=action!;
  if(command==='action.roll'){if(!own.has(a.characterId))fail(403,'Можно внести только свои кубики.');if(a.status!=='approved')fail(409,'Сначала дождись разрешения ГМ.');if(!scene.targets.some(t=>t.id===a.targetId&&t.visible)||(scene.board&&!targetVisibleToActor(scene.board,a.targetId,a.characterId)))fail(403,'Цель сейчас недоступна персонажу.');a.roll=roll(payload.roll);a.damage=roll(payload.damage);}
  else{
   requireGM();
   if(command==='action.approve'){if(a.status!=='submitted')fail(409,'Заявка уже рассмотрена.');a.status='approved';}
   else if(command==='action.resolve'){
    if(a.status!=='approved')fail(409,'Сначала разреши действие.');const result=text(payload.result,'Описание результата',3000,true);
    if(a.movement){const board=scene.board,pawn=board?.pieces.find(p=>p.characterId===a.characterId),m=a.movement;if(!board||!pawn||pawn.x!==m.fromX||pawn.y!==m.fromY||!canOccupyBattleCell(board,pawn,m.x,m.y))fail(409,'Положение пешек изменилось. Пересмотри заявку движения.');pawn!.x=m.x;pawn!.y=m.y;}
    a.status='resolved';a.result=result;a.resolvedAt=time;const target=scene.targets.find(t=>t.id===a.targetId),actor=state.characters.find(c=>c.id===a.characterId);replace(scene.log,{id:a.id,targetId:a.targetId,text:`${actor?.name||'Персонаж'} → ${target?.name||'Цель'}: ${result}`,created:time});
   }
   else if(command==='action.reject'){if(!['submitted','approved'].includes(a.status))fail(409,'Действие уже завершено.');a.status='rejected';a.result=text(payload.result??'Действие отклонено','Ответ ГМ',3000,true);a.resolvedAt=time;}
   else if(command==='action.undo'){
    if(!['resolved','rejected'].includes(a.status))fail(409,'Нет результата для отмены.');if(a.status==='resolved'&&a.movement){const board=scene.board,pawn=board?.pieces.find(p=>p.characterId===a.characterId),m=a.movement;if(!board||!pawn||pawn.x!==m.x||pawn.y!==m.y||!canOccupyBattleCell(board,pawn,m.fromX,m.fromY))fail(409,'Пешки изменились. Сначала восстанови положение вручную.');pawn!.x=m.fromX;pawn!.y=m.fromY;}a.status='approved';a.result='';a.resolvedAt=null;scene.log=scene.log.filter(row=>row.id!==a.id);
   }else fail(400,'Эта команда не входит в учебный стол.');
  }
 }else fail(400,'Эта команда не входит в учебный стол.');
 if(scene.board)validateBattleBoard(scene.board,accepted,new Set(scene.targets.map(t=>t.id)));
 if(scene.actions.length>200||data.messages.length>1000)fail(400,'Учебный стол заполнен. Начни его заново.');
 state.version++;state.updated=time;if(requestId)state.requests[requestId]={fingerprint,account};return{state,response:{version:state.version,updated:state.updated}};
}
