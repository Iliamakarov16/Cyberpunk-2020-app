import {APP_VERSION,API_VERSION} from '@/lib/app-version';
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { workspaceRoutes, syncView, validateWorkspace } from './workspace';
import { portableRoutes } from './portable-routes';
import {accessRoutes,sharedReadScope,canShareRead} from './character-access';
import {exteriorCard} from '@/lib/character-appearance';
import {normalize} from '@/lib/tracker';

export const dynamic = 'force-dynamic';
const STATS = ['INT','REF','TECH','COOL','ATTR','LUCK','MA','BODY','EMP'];
const COOKIE = 'nightcity_session';
const DAYS = 7 * 86400;
const encoder = new TextEncoder();
class Failure extends Error {
  constructor(public status: number, message: string) { super(message); }
}
type DB = D1Database;
type Account = {id:number;username:string;role:string;csrf:string;token?:string;platform?:boolean};
const now = () => Math.floor(Date.now()/1000);
const hex = (data: ArrayBuffer|Uint8Array) => [...new Uint8Array(data)].map(x=>x.toString(16).padStart(2,'0')).join('');
const token = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = async (value:string) => hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
function str(value:unknown, label:string, max=1000, required=false):string {
  if(typeof value !== 'string' || value.length>max) throw new Failure(400,`Проверь поле «${label}».`);
  const out=value.trim(); if(required&&!out)throw new Failure(400,`Заполни поле «${label}».`);return out;
}
function password(value:unknown):string {
  if(typeof value!=='string'||!value||value.length>256)throw new Failure(400,'Проверь пароль.');return value;
}
function num(value:unknown,label:string,min=0,max=10000,integer=true):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))throw new Failure(400,`Проверь число в поле «${label}».`);
  return value;
}
function validate(raw:any) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Failure(400,'Некорректный лист персонажа.');
  const out:any={};
  for(const [key,label,max,required] of [['name','Имя',80,true],['role','Роль',80,true],['special','Особый навык',80,false],['notes','Заметки',12000,false],['condition','Состояние',2000,false],['background','Предыстория',6000,false]] as const)out[key]=str(raw[key]??'',label,max,required);
  for(const [key,label,max] of [['cash','Евродоллары',1e12],['humanity','Человечность',10000],['wounds','Ранения',40],['armorPenalty','EV брони',20],['specialRank','Особый навык',10]] as const)out[key]=num(raw[key]??0,label,0,max);
  out.stats=Object.fromEntries(STATS.map(k=>[k,num(raw.stats?.[k]??0,k,0,20)]));
  out.armor=Object.fromEntries(['head','torso','rightArm','leftArm','rightLeg','leftLeg'].map(k=>[k,num(raw.armor?.[k]??0,'SP брони',0,200)]));
  if(!Array.isArray(raw.skills??[])||(raw.skills??[]).length>150||!Array.isArray(raw.items??[])||(raw.items??[]).length>250)throw new Failure(400,'Слишком много строк в листе.');
  out.skills=(raw.skills??[]).map((skill:any)=>{
    if(!skill||!STATS.includes(skill.stat))throw new Failure(400,'Проверь характеристику навыка.');
    return {name:str(skill.name,'Навык',100,true),stat:skill.stat,rank:num(skill.rank??0,'Ранг',0,10),ip:num(skill.ip??0,'IP',0,100000),multiplier:num(skill.multiplier??1,'Множитель',1,10)};
  });
  out.items=(raw.items??[]).map((item:any)=>{
    if(!item||!['gear','weapon','armor','cyber','ammo','clothing'].includes(item.category)||typeof item.equipped!=='boolean')throw new Failure(400,'Проверь строку снаряжения.');
    const slot=item.slot??(item.category==='armor'?'outer':item.category==='clothing'?'inner':item.category==='weapon'?'mainHand':item.category==='cyber'?'implant':'bag');
    const icon=item.icon??(item.category==='clothing'?'shirt':item.category);
    if(!['head','eyes','inner','outer','legs','feet','hands','accessory','body','mainHand','offHand','implant','bag'].includes(slot)||!['shirt','jacket','helmet','glasses','pants','boots','gloves','armor','weapon','pistol','deck','cyber','ammo','gear','radio','medical','trauma','revolver','smg','rifle','shotgun','sniper','heavyweapon','knife','katana','baton','grenade','cybereye','cyberarm','cyberleg','tools','chip'].includes(icon))throw new Failure(400,'Проверь слот и иконку вещи.');
    const id=str(item.id??`legacy-${raw.items.indexOf(item)}`,'ID вещи',64,true);
    if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new Failure(400,'Некорректный ID вещи.');
    let armor=null;
    if(item.armor!=null){
      if(!['soft','hard','skinweave','implant'].includes(item.armor.type))throw new Failure(400,'Проверь тип брони.');
      if(item.armor.coverage!=null&&(typeof item.armor.coverage!=='object'||Array.isArray(item.armor.coverage)))throw new Failure(400,'Проверь зоны брони.');
      armor={type:item.armor.type,coverage:Object.fromEntries(['head','torso','rightArm','leftArm','rightLeg','leftLeg'].map(k=>[k,num(item.armor.coverage?.[k]??0,'SP слоя',0,200)])),ev:num(item.armor.ev??0,'EV вещи',0,20),order:num(item.armor.order??20,'Порядок слоёв',0,100)};
    }
    if(!Array.isArray(item.modifiers??[])||(item.modifiers??[]).length>20)throw new Failure(400,'Слишком много эффектов вещи.');
    const modifiers=(item.modifiers??[]).map((m:any)=>{
      if(!m||!STATS.includes(m.stat))throw new Failure(400,'Проверь характеристику эффекта.');
      return {stat:m.stat,value:num(m.value,'Модификатор',-20,20),label:str(m.label,'Эффект',160,true),source:str(m.source,'Правило эффекта',250,true)};
    });
    if(item.visibility!=null&&!['auto','visible','hidden'].includes(item.visibility))throw new Failure(400,'Проверь видимость вещи.');
    return {...(item.visibility!=null?{visibility:item.visibility}:{}),id,name:str(item.name,'Название вещи',100,true),category:item.category,quantity:num(item.quantity??1,'Количество',0,100000),weight:num(item.weight??0,'Вес',0,10000,false),equipped:item.equipped,description:str(item.description??'','Описание',3000),slot,icon,armor,modifiers,source:str(item.source??'','Источник вещи',250)};
  });
  if(new Set(out.items.map((i:any)=>i.id)).size!==out.items.length)throw new Failure(400,'У вещей должны быть разные ID.');
  out.schemaVersion=2;
  out.armorMode=raw.armorMode??'manual';
  if(!['manual','equipment'].includes(out.armorMode))throw new Failure(400,'Проверь режим расчёта брони.');
  out.evAdjustment=num(raw.evAdjustment??0,'Поправка EV',-20,20);
  if(raw.appearance!=null&&(typeof raw.appearance!=='object'||Array.isArray(raw.appearance)))throw new Failure(400,'Проверь внешний вид персонажа.');
  const accent=raw.appearance?.accent??'rust';
  if(!['rust','teal','blue','violet'].includes(accent))throw new Failure(400,'Проверь цвет персонажа.');
  const portrait=raw.appearance?.portrait;
  if(portrait!=null&&(typeof portrait!=='string'||portrait.length>100000||(portrait&&!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(portrait))))throw new Failure(400,'Портрет должен быть изображением PNG, JPEG или WebP до 100 КБ.');
  let portraitFrame;
  if(Object.hasOwn(raw.appearance??{},'portraitFrame')){
    const frame=raw.appearance.portraitFrame;
    const fields=['fit','x','y','zoom','height','effect'];
    if(!frame||typeof frame!=='object'||Array.isArray(frame)||Object.keys(frame).length!==fields.length||Object.keys(frame).some(key=>!fields.includes(key))||!['contain','cover'].includes(frame.fit)||!['off','foil','scan','pulse','tilt'].includes(frame.effect))throw new Failure(400,'Проверь кадрирование и эффект портрета.');
    portraitFrame={fit:frame.fit,x:num(frame.x,'Положение портрета по горизонтали',0,100),y:num(frame.y,'Положение портрета по вертикали',0,100),zoom:num(frame.zoom,'Масштаб портрета',100,300),height:num(frame.height,'Высота портрета',220,520),effect:frame.effect};
  }
  out.appearance={accent,...(portrait?{portrait}:{}),...(portraitFrame?{portraitFrame}:{})};return out;
}
async function hashPassword(value:string,salt=hex(crypto.getRandomValues(new Uint8Array(16)))) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(value),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},key,256);
  return `${salt}:${hex(bits)}`;
}
async function verify(value:string,encoded:string) {
  const candidate=await hashPassword(value,encoded.split(':')[0]);
  let mismatch=candidate.length^encoded.length;
  for(let i=0;i<candidate.length;i++)mismatch|=candidate.charCodeAt(i)^(encoded.charCodeAt(i)||0);
  return mismatch===0;
}
function parseCookie(request:Request,key:string) {
  return (request.headers.get('Cookie')??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(key+'='))?.slice(key.length+1)??'';
}
const sessionCookie=(value='',age=DAYS)=>`${COOKIE}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Strict; Secure`;
function response(body:any,status=200,cookies:string[]=[]) {
  const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  cookies.forEach(cookie=>headers.append('Set-Cookie',cookie));
  return new Response(JSON.stringify(body),{status,headers});
}
function sample(name:string,role:string,special:string,skills:any[],cash:number) {
  return {name,role,special,specialRank:5,cash,humanity:65,wounds:0,armorPenalty:1,
    stats:{INT:6,REF:7,TECH:6,COOL:6,ATTR:5,LUCK:5,MA:6,BODY:6,EMP:6},
    armor:{head:0,torso:12,rightArm:8,leftArm:8,rightLeg:0,leftLeg:0},skills,
    items:[{name:'Бронежилет',category:'armor',quantity:1,weight:3,equipped:true,description:'Пример вещи. Значения можно заменить.'},
      {name:'Карманный телефон',category:'gear',quantity:1,weight:.3,equipped:true,description:'Контакты команды и заказчика.'},
      {name:'Интерфейсные разъёмы',category:'cyber',quantity:1,weight:0,equipped:true,description:'Пример импланта для проверки интерфейса.'}],
    condition:'',background:'Тестовый персонаж. Можно изменить или создать собственного.',notes:'Первый заказ: вернуть фургон районной клиники. Здесь можно вести записи после сессии.'};
}
async function ownerAccount(db:DB,uid:string):Promise<Account|null> {
  const known=await db.prepare("SELECT value FROM meta WHERE key='owner_uid'").first<{value:string}>();
  if(!known) {
    const csrf=token(),hash=await hashPassword(token());
    const samples=[sample('Вега','Соло','Combat Sense',[{name:'Handgun',stat:'REF',rank:5,ip:6,multiplier:1},{name:'Awareness / Notice',stat:'INT',rank:4,ip:2,multiplier:1}],1200),
      sample('Глитч','Нетраннер','Interface',[{name:'Programming',stat:'INT',rank:5,ip:4,multiplier:1},{name:'Electronics',stat:'TECH',rank:4,ip:0,multiplier:1}],850),
      sample('Рэй','Медтехник','Medical Tech',[{name:'First Aid',stat:'TECH',rank:5,ip:3,multiplier:1},{name:'Human Perception',stat:'EMP',rank:4,ip:0,multiplier:1}],600)];
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO meta(key,value) VALUES('owner_uid',?)").bind(uid),
      db.prepare("INSERT OR IGNORE INTO meta(key,value) VALUES('owner_csrf',?)").bind(csrf),
      db.prepare("INSERT OR IGNORE INTO users(id,username,password,role) VALUES(1,'gm',?,'gm')").bind(hash),
      ...samples.flatMap((data,i)=>[
        db.prepare('INSERT OR IGNORE INTO characters(id,owner_id,data,version,updated) VALUES(?,1,?,1,?)').bind(i+1,JSON.stringify(data),now()),
        db.prepare('INSERT OR IGNORE INTO revisions(id,character_id,actor_id,data,version,reason,created) VALUES(?,?,1,?,1,?,?)').bind(i+1,i+1,JSON.stringify(data),'Тестовый персонаж',now()),
      ])
    ]);
  }
  const actual=await db.prepare("SELECT value FROM meta WHERE key='owner_uid'").first<{value:string}>();
  if(actual?.value!==uid)return null;
  const csrf=await db.prepare("SELECT value FROM meta WHERE key='owner_csrf'").first<{value:string}>();
  return {id:1,username:'gm',role:'gm',csrf:csrf!.value,platform:true};
}
async function authorize(db:DB,request:Request,owner:Account|null,mutate:boolean):Promise<Account> {
  const raw=parseCookie(request,COOKIE);
  let account:Account|null=null;
  if(raw)account=await db.prepare('SELECT u.id,u.username,u.role,s.csrf,s.token FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').bind(await digest(raw),now()).first<Account>();
  if(!account&&!raw&&parseCookie(request,'nightcity_signed_out')!=='1')account=owner;
  if(!account)throw new Failure(401,'Войди в свой аккаунт.');
  if(mutate&&request.headers.get('X-CSRF-Token')!==account.csrf)throw new Failure(403,'Обнови страницу и повтори действие.');
  return account;
}
async function character(db:DB,user:Account,id:number) {
  const row=await db.prepare(`SELECT c.*,u.username FROM characters c JOIN users u ON u.id=c.owner_id WHERE c.id=? AND (${readScope})`).bind(id,user.id,user.id,user.id,user.id).first<any>();
  if(!row)throw new Failure(404,'Персонаж не найден.');return row;
}
const manageScope=`c.owner_id=? OR EXISTS (SELECT 1 FROM campaign_characters cc JOIN campaigns k ON k.id=cc.campaign_id WHERE cc.character_id=c.id AND k.gm_id=?)`;
const readScope=`${manageScope} OR ${sharedReadScope}`;
const editScope=`owner_id=? OR EXISTS (SELECT 1 FROM campaign_characters cc JOIN campaigns k ON k.id=cc.campaign_id WHERE cc.character_id=characters.id AND k.gm_id=? AND cc.status IN ('active','reserve'))`;
const inviteCode=()=>hex(crypto.getRandomValues(new Uint8Array(10))).toUpperCase();
const isAdmin=(user:Account)=>user.id===1;
async function characterView(db:DB,user:Account,row:any){
  const editable=row.owner_id===user.id||!!await db.prepare("SELECT 1 FROM campaign_characters cc JOIN campaigns k ON k.id=cc.campaign_id WHERE cc.character_id=? AND k.gm_id=? AND cc.status IN ('active','reserve')").bind(row.id,user.id).first();
  return {id:row.id,owner_id:row.owner_id,owner:row.username,version:row.version,updated:row.updated,data:JSON.parse(row.data),can_edit:editable,can_delete:row.owner_id===user.id,can_history:row.owner_id===user.id||!!await db.prepare('SELECT 1 FROM campaign_characters cc JOIN campaigns k ON k.id=cc.campaign_id WHERE cc.character_id=? AND k.gm_id=?').bind(row.id,user.id).first(),access:row.owner_id===user.id?'owner':await db.prepare('SELECT 1 FROM campaign_characters cc JOIN campaigns k ON k.id=cc.campaign_id WHERE cc.character_id=? AND k.gm_id=?').bind(row.id,user.id).first()?'gm':'shared'};
}
async function ensureCampaignMigration(db:DB){
  if(await db.prepare("SELECT 1 FROM meta WHERE key='campaign_migrated'").first())return;
  const guard="NOT EXISTS (SELECT 1 FROM meta WHERE key='campaign_migrated')";
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO campaigns(id,gm_id,name,description,invite_code,updated) SELECT 1,1,?,?,?,? WHERE ${guard} AND EXISTS (SELECT 1 FROM characters) AND EXISTS (SELECT 1 FROM users WHERE id=1)`).bind('Найт-Сити: первая группа','Прежние листы перенесены сюда. Новые персонажи создаются в личной коллекции.',inviteCode(),now()),
    db.prepare(`INSERT OR IGNORE INTO campaign_members(campaign_id,user_id) SELECT 1,owner_id FROM characters WHERE ${guard} AND EXISTS(SELECT 1 FROM campaigns WHERE id=1 AND gm_id=1)`),
    db.prepare(`INSERT OR IGNORE INTO campaign_characters(campaign_id,character_id,status,created) SELECT 1,id,'active',? FROM characters WHERE ${guard} AND EXISTS(SELECT 1 FROM campaigns WHERE id=1 AND gm_id=1)`).bind(now()),
    db.prepare("INSERT OR IGNORE INTO meta(key,value) VALUES('campaign_migrated','1')"),
  ]);
}
async function campaign(db:DB,user:Account,id:number){
 const row=await db.prepare(`SELECT k.*,u.username AS gm FROM campaigns k JOIN users u ON u.id=k.gm_id WHERE k.id=? AND (k.gm_id=? OR k.transfer_to=? OR EXISTS(SELECT 1 FROM campaign_members m WHERE m.campaign_id=k.id AND m.user_id=?) OR EXISTS(SELECT 1 FROM campaign_characters cc JOIN characters c ON c.id=cc.character_id WHERE cc.campaign_id=k.id AND c.owner_id=?))`).bind(id,user.id,user.id,user.id,user.id).first<any>();
 if(!row)throw new Failure(404,'Кампания не найдена.');return row;
}
async function campaignView(db:DB,user:Account,row:any){
 return {id:row.id,name:row.name,description:row.description,gm_id:row.gm_id,gm:row.gm,version:row.version,updated:row.updated,transfer_to:row.transfer_to,is_gm:row.gm_id===user.id,is_member:!!await db.prepare('SELECT 1 FROM campaign_members WHERE campaign_id=? AND user_id=?').bind(row.id,user.id).first()};
}
async function throttle(db:DB,key:string,limit=20){
 const stamp=now();await db.prepare('DELETE FROM attempts WHERE started<?').bind(stamp-900).run();
 const attempt=await db.prepare('SELECT count FROM attempts WHERE key=?').bind(key).first<{count:number}>();
 if(attempt&&attempt.count>=limit)throw new Failure(429,'Слишком много попыток. Попробуй через 15 минут.');
 await db.prepare('INSERT INTO attempts(key,count,started) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').bind(key,stamp).run();
}
function mode(value:unknown){if(value!=='gm'&&value!=='player')throw new Failure(400,'Выбери режим ГМ или игрока.');return value;}
async function campaignRoutes(db:DB,user:Account,path:string,method:string,payload:any):Promise<Response|null>{
 if(path==='/api/campaigns'){
  if(method==='GET'){
   const rows=(await db.prepare(`SELECT k.*,u.username AS gm FROM campaigns k JOIN users u ON u.id=k.gm_id WHERE k.gm_id=? OR k.transfer_to=? OR EXISTS(SELECT 1 FROM campaign_members m WHERE m.campaign_id=k.id AND m.user_id=?) OR EXISTS(SELECT 1 FROM campaign_characters cc JOIN characters c ON c.id=cc.character_id WHERE cc.campaign_id=k.id AND c.owner_id=?) ORDER BY k.updated DESC,k.id DESC`).bind(user.id,user.id,user.id,user.id).all<any>()).results;
   return response(await Promise.all(rows.map(r=>campaignView(db,user,r))));
  }
  if(method==='POST'){
   const name=str(payload.name,'Название кампании',100,true),description=str(payload.description??'','Описание кампании',3000);
   const row=await db.prepare('INSERT INTO campaigns(gm_id,name,description,invite_code,updated) VALUES(?,?,?,?,?) RETURNING id').bind(user.id,name,description,inviteCode(),now()).first<{id:number}>();return response({id:row!.id},201);
  }
 }
 if(path==='/api/campaigns/join'&&method==='POST'){
  const cid=num(payload.character_id,'Персонаж',1,1e9),code=str(payload.code,'Код приглашения',80,true).replace(/[\s-]/g,'').toUpperCase();
  const own=await db.prepare('SELECT 1 FROM characters WHERE id=? AND owner_id=?').bind(cid,user.id).first();if(!own)throw new Failure(404,'Выбери своего персонажа.');
  const key=`invite:${user.id}`;await throttle(db,key);
  const target=await db.prepare('SELECT id,name FROM campaigns WHERE invite_code=?').bind(code).first<any>();if(!target)throw new Failure(404,'Код не найден или уже заменён ведущим.');
  const result=await db.batch([
   db.prepare(`INSERT INTO campaign_characters(campaign_id,character_id,status,created) SELECT k.id,c.id,'pending',? FROM campaigns k,characters c WHERE k.id=? AND k.invite_code=? AND c.id=? AND c.owner_id=? ON CONFLICT(campaign_id,character_id) DO NOTHING`).bind(now(),target.id,code,cid,user.id),
   db.prepare('UPDATE campaigns SET version=version+1,updated=? WHERE id=? AND changes()=1').bind(now(),target.id),
  ]);
  if(result[0].meta.changes!==1)throw new Failure(409,'Заявка уже есть или приглашение изменилось. Обнови кампании.');
  await db.prepare('DELETE FROM attempts WHERE key=?').bind(key).run();return response({id:target.id,name:target.name},201);
 }
 const match=path.match(/^\/api\/campaigns\/(\d+)(?:\/(roster|withdraw|invite|transfer)(?:\/(accept))?)?$/);if(!match)return null;
 const id=Number(match[1]),row=await campaign(db,user,id),isGM=row.gm_id===user.id,action=match[2],accept=match[3];
 if(!action&&method==='GET'){
  const view:any=await campaignView(db,user,row);
  const roster=(await db.prepare('SELECT cc.character_id,cc.status,c.owner_id,c.data,u.username AS owner FROM campaign_characters cc JOIN characters c ON c.id=cc.character_id JOIN users u ON u.id=c.owner_id WHERE cc.campaign_id=? ORDER BY cc.created,cc.character_id').bind(id).all<any>()).results;
  const acceptedViewer=roster.some(r=>r.owner_id===user.id&&['active','reserve'].includes(r.status));
  view.roster=await Promise.all(roster.filter(r=>isGM||r.owner_id===user.id||(view.is_member&&r.status!=='pending')).map(async r=>{const d=normalize(JSON.parse(r.data));return {character_id:r.character_id,owner_id:r.owner_id,owner:r.owner,name:d.name,role:d.role,status:r.status,can_open:isGM||r.owner_id===user.id||await canShareRead(db,user.id,r.character_id),...((isGM||r.owner_id===user.id||(acceptedViewer&&['active','reserve'].includes(r.status)))?{exterior:exteriorCard(r.character_id,d)}:{})};}));
  view.members=isGM?(await db.prepare('SELECT u.id,u.username FROM campaign_members m JOIN users u ON u.id=m.user_id WHERE m.campaign_id=? ORDER BY u.username').bind(id).all()).results:[];
  if(isGM)Object.assign(view,{invite_code:row.invite_code,gm_notes:row.gm_notes,ledger:row.ledger});return response(view);
 }
 if(action==='withdraw'&&method==='POST'){
  const cid=num(payload.character_id,'Персонаж',1,1e9);
  const result=await db.batch([
   db.prepare('DELETE FROM campaign_characters WHERE campaign_id=? AND character_id=? AND EXISTS(SELECT 1 FROM characters WHERE id=? AND owner_id=?)').bind(id,cid,cid,user.id),
   db.prepare('UPDATE campaigns SET version=version+1,updated=? WHERE id=? AND changes()=1').bind(now(),id),
  ]);if(result[0].meta.changes!==1)throw new Failure(404,'Твой персонаж в этой кампании не найден.');return response({ok:true});
 }
 const version=num(payload.version,'Версия кампании',1,1e9);
 if(action==='transfer'&&accept==='accept'&&method==='POST'){
  if(row.transfer_to!==user.id)throw new Failure(403,'Передачу должен принять приглашённый ведущий.');
  const result=await db.batch([
   db.prepare('UPDATE campaigns SET gm_id=?,transfer_to=NULL,version=version+1,updated=? WHERE id=? AND version=? AND transfer_to=? AND EXISTS(SELECT 1 FROM campaign_members WHERE campaign_id=? AND user_id=?)').bind(user.id,now(),id,version,user.id,id,user.id),
   db.prepare('INSERT OR IGNORE INTO campaign_members(campaign_id,user_id) SELECT ?,? WHERE changes()=1').bind(id,row.gm_id),
  ]);if(result[0].meta.changes!==1)throw new Failure(409,'Передача изменилась. Обнови кампанию.');return response({ok:true});
 }
 if(!isGM)throw new Failure(403,'Это действие доступно ведущему этой кампании.');
 let result:any[];
 if(!action&&method==='PUT'){
  const name=str(payload.name,'Название кампании',100,true),description=str(payload.description??'','Описание',3000),notes=str(payload.gm_notes??'','Записи ведущего',24000),ledger=str(payload.ledger??'','Учёт кампании',16000);
  result=[await db.prepare('UPDATE campaigns SET name=?,description=?,gm_notes=?,ledger=?,version=version+1,updated=? WHERE id=? AND gm_id=? AND version=?').bind(name,description,notes,ledger,now(),id,user.id,version).run()];
 }else if(action==='invite'&&!accept&&method==='POST'){
  result=[await db.prepare('UPDATE campaigns SET invite_code=?,version=version+1,updated=? WHERE id=? AND gm_id=? AND version=?').bind(inviteCode(),now(),id,user.id,version).run()];
 }else if(action==='transfer'&&!accept&&method==='POST'){
  const target=payload.user_id===null?null:num(payload.user_id,'Новый ведущий',1,1e9);
  if(target===user.id)throw new Failure(400,'Ты уже ведёшь эту кампанию.');
  if(target!==null&&!await db.prepare('SELECT 1 FROM campaign_members WHERE campaign_id=? AND user_id=?').bind(id,target).first())throw new Failure(400,'Выбери принятого участника кампании.');
  result=[await db.prepare('UPDATE campaigns SET transfer_to=?,version=version+1,updated=? WHERE id=? AND gm_id=? AND version=? AND (? IS NULL OR EXISTS(SELECT 1 FROM campaign_members WHERE campaign_id=? AND user_id=?))').bind(target,now(),id,user.id,version,target,id,target).run()];
 }else if(action==='roster'&&!accept&&method==='POST'){
  const cid=num(payload.character_id,'Персонаж',1,1e9),status=payload.status;
  if(!['active','reserve','remove'].includes(status))throw new Failure(400,'Проверь состояние участия.');
  if(!await db.prepare('SELECT 1 FROM campaign_characters WHERE campaign_id=? AND character_id=?').bind(id,cid).first())throw new Failure(404,'Заявка или персонаж не найдены.');
  const guard='EXISTS(SELECT 1 FROM campaigns WHERE id=? AND gm_id=? AND version=?)';
  result=await db.batch([
   db.prepare('UPDATE campaigns SET version=version+1,updated=? WHERE id=? AND gm_id=? AND version=? AND EXISTS(SELECT 1 FROM campaign_characters WHERE campaign_id=? AND character_id=?)').bind(now(),id,user.id,version,id,cid),
   status==='remove'?db.prepare(`DELETE FROM campaign_characters WHERE campaign_id=? AND character_id=? AND changes()=1 AND ${guard}`).bind(id,cid,id,user.id,version+1):db.prepare(`UPDATE campaign_characters SET status=? WHERE campaign_id=? AND character_id=? AND changes()=1 AND ${guard}`).bind(status,id,cid,id,user.id,version+1),
   db.prepare(`INSERT OR IGNORE INTO campaign_members(campaign_id,user_id) SELECT ?,c.owner_id FROM characters c JOIN campaign_characters cc ON cc.character_id=c.id WHERE c.id=? AND cc.campaign_id=? AND cc.status IN ('active','reserve') AND changes()=1 AND ${guard}`).bind(id,cid,id,id,user.id,version+1),
  ]);
 }else return null;
 if(result[0].meta.changes!==1)throw new Failure(409,'Кампания уже изменилась. Обнови её, сохранив свой черновик.');return response({ok:true});
}
async function handler(request:Request) {
  try {
    const platform=await getChatGPTUser();
    if(!platform)throw new Failure(401,'Открой приложение, войдя в ChatGPT.');
    const db=(env as unknown as {DB:DB}).DB;
    if(!db)throw new Failure(503,'Хранилище ещё подключается. Попробуй чуть позже.');
    const path=new URL(request.url).pathname,method=request.method;
    if(method!=='GET'&&request.headers.has('X-Client-API')&&request.headers.get('X-Client-API')!=='1')throw new Failure(409,'Версия приложения несовместима с сервером. Сохрани черновик и обнови приложение.');
    let payload:any={};
    if(method!=='GET') {
      if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')throw new Failure(415,'Нужен JSON.');
      const length=Number(request.headers.get('Content-Length')||0);
      const maxBytes=path.startsWith('/api/campaigns/import')?1850000:262144;
      if(length>maxBytes)throw new Failure(413,'Размер запроса превышен.');
      const origin=request.headers.get('Origin');
      const expected=(env as unknown as {PUBLIC_ORIGIN?:string}).PUBLIC_ORIGIN||new URL(request.url).origin;
      if(origin&&origin!==expected)throw new Failure(403,'Запрос с другого сайта отклонён.');
      const body=await request.text();if(encoder.encode(body).length>maxBytes)throw new Failure(413,'Размер запроса превышен.');
      try{payload=JSON.parse(body);}catch{throw new Failure(400,'Некорректный JSON.');}
      if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Failure(400,'Нужен объект JSON.');
    }
    const owner=await ownerAccount(db,platform.userId);
    await ensureCampaignMigration(db);
    if(path==='/api/owner-login'&&method==='POST') {
      if(!owner)throw new Failure(403,'Режим ведущего доступен владельцу теста.');
      const raw=parseCookie(request,COOKIE);
      if(raw)await db.prepare('DELETE FROM sessions WHERE token=?').bind(await digest(raw)).run();
      return response({ok:true},200,[sessionCookie('',0),'nightcity_signed_out=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure']);
    }
    if(path==='/api/register'&&method==='POST'){
      await throttle(db,await digest(platform.userId+':register'),8);
      const username=str(payload.username,'Логин',40,true).toLowerCase(),pass=password(payload.password),selected=mode(payload.mode??'player');
      if(!/^[a-z0-9_.-]{3,40}$/.test(username)||pass.length<12)throw new Failure(400,'Логин — 3–40 латинских символов; пароль — от 12 символов.');
      if(await db.prepare('SELECT 1 FROM users WHERE username=?').bind(username).first())throw new Failure(409,'Такой логин уже существует.');
      const row=await db.prepare("INSERT INTO users(username,password,role) VALUES(?,?,'player') RETURNING id").bind(username,await hashPassword(pass)).first<{id:number}>();
      const raw=token(),csrf=token();
      await db.batch([db.prepare('INSERT INTO user_modes(user_id,mode) VALUES(?,?)').bind(row!.id,selected),db.prepare('INSERT INTO sessions(token,user_id,csrf,expires) VALUES(?,?,?,?)').bind(await digest(raw),row!.id,csrf,now()+DAYS)]);
      return response({ok:true},201,[sessionCookie(raw),'nightcity_signed_out=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure']);
    }
    if(path==='/api/login'&&method==='POST') {
      const username=str(payload.username,'Логин',40,true).toLowerCase(),pass=password(payload.password);
      const selected=payload.mode===undefined?undefined:mode(payload.mode);
      const key=await digest(platform.userId+':'+username),stamp=now();
      await db.prepare('DELETE FROM attempts WHERE started<?').bind(stamp-900).run();
      const attempt=await db.prepare('SELECT count FROM attempts WHERE key=?').bind(key).first<{count:number}>();
      if(attempt&&attempt.count>=8)throw new Failure(429,'Слишком много попыток. Попробуй через 15 минут.');
      await db.prepare('INSERT INTO attempts(key,count,started) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').bind(key,stamp).run();
      const row=await db.prepare('SELECT * FROM users WHERE username=?').bind(username).first<any>();
      if(!row||!await verify(pass,row.password))throw new Failure(401,'Неверный логин или пароль.');
      const raw=token(),csrf=token();
      await db.batch([db.prepare('DELETE FROM attempts WHERE key=?').bind(key),db.prepare('DELETE FROM sessions WHERE expires<?').bind(stamp),
        db.prepare('INSERT INTO sessions(token,user_id,csrf,expires) VALUES(?,?,?,?)').bind(await digest(raw),row.id,csrf,stamp+DAYS)]);
      if(selected)await db.prepare('INSERT INTO user_modes(user_id,mode) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode').bind(row.id,selected).run();
      return response({ok:true},200,[sessionCookie(raw),'nightcity_signed_out=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure']);
    }
    const user=await authorize(db,request,owner,method!=='GET');
    if(path==='/api/me'&&method==='GET'){
      const saved=await db.prepare('SELECT mode FROM user_modes WHERE user_id=?').bind(user.id).first<{mode:string}>();
      return response({id:user.id,username:user.username,role:saved?.mode??(user.role==='gm'?'gm':'player'),admin:isAdmin(user),csrf:user.csrf,platform:!!user.platform});
    }
    if(path==='/api/mode'&&method==='POST'){
      const selected=mode(payload.mode);await db.prepare('INSERT INTO user_modes(user_id,mode) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode').bind(user.id,selected).run();return response({mode:selected});
    }
    if(path==='/api/version'&&method==='GET')return response({version:APP_VERSION,apiVersion:API_VERSION});
    if(path==='/api/sync'&&method==='GET')return response(await syncView(db,user));
    if(path.startsWith('/api/campaigns')){const portableResult=await portableRoutes({db,user,path,method,payload,validateCharacter:validate,workspaceValidate:validateWorkspace});if(portableResult)return portableResult;const workspaceResult=await workspaceRoutes(db,user,path,method,payload);if(workspaceResult)return workspaceResult;const result=await campaignRoutes(db,user,path,method,payload);if(result)return result;}
    if(path==='/api/settings') {
      const defaults={hints:true,tutorial:true,animations:true,ambient:'quiet'};
      const booleanKeys=['hints','tutorial','animations'];
      const ambientValues=['quiet','vivid','off'];
      const readSettings=async()=>{
        const row=await db.prepare('SELECT data FROM player_settings WHERE user_id=?').bind(user.id).first<{data:string}>();
        const raw=row?JSON.parse(row.data):{};
        const saved=raw&&typeof raw==='object'?raw:{};
        return {hints:typeof saved.hints==='boolean'?saved.hints:defaults.hints,tutorial:typeof saved.tutorial==='boolean'?saved.tutorial:defaults.tutorial,animations:typeof saved.animations==='boolean'?saved.animations:defaults.animations,ambient:ambientValues.includes(saved.ambient)?saved.ambient:defaults.ambient};
      };
      if(method==='GET')return response(await readSettings());
      if(method==='PUT'){
        if(Object.keys(payload).some(key=>!Object.hasOwn(defaults,key))||booleanKeys.some(key=>typeof payload[key]!=='boolean')||(Object.hasOwn(payload,'ambient')&&!ambientValues.includes(payload.ambient)))throw new Failure(400,'Проверь настройки интерфейса.');
        // Older clients submit only the original booleans; keep the account's selected background.
        const ambient=Object.hasOwn(payload,'ambient')?payload.ambient:(await readSettings()).ambient;
        const settings={hints:payload.hints,tutorial:payload.tutorial,animations:payload.animations,ambient};
        await db.prepare('INSERT INTO player_settings(user_id,data,updated) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated=excluded.updated').bind(user.id,JSON.stringify(settings),now()).run();
        return response(settings);
      }
    }
    if(path==='/api/logout'&&method==='POST') {
      if(user.token)await db.prepare('DELETE FROM sessions WHERE token=?').bind(user.token).run();
      return response({ok:true},200,[sessionCookie('',0),'nightcity_signed_out=1; Path=/; Max-Age=604800; HttpOnly; SameSite=Strict; Secure']);
    }
    if(path==='/api/password'&&method==='POST') {
      if(user.platform)throw new Failure(400,'Для ведущего вход выполняется через ChatGPT.');
      const old=password(payload.old),fresh=password(payload.new);
      const row=await db.prepare('SELECT password FROM users WHERE id=?').bind(user.id).first<{password:string}>();
      if(fresh.length<12||!row||!await verify(old,row.password))throw new Failure(400,'Проверь текущий пароль. Новый — от 12 символов.');
      await db.batch([db.prepare('UPDATE users SET password=? WHERE id=?').bind(await hashPassword(fresh),user.id),
        db.prepare('DELETE FROM sessions WHERE user_id=? AND token!=?').bind(user.id,user.token)]);
      return response({ok:true});
    }
    if(path==='/api/users') {
      if(!isAdmin(user))throw new Failure(403,'Доступ только для администратора сервера.');
      if(method==='GET')return response((await db.prepare('SELECT id,username,role FROM users ORDER BY id').all()).results);
      if(method==='POST') {
        const username=str(payload.username,'Логин',40,true).toLowerCase(),pass=password(payload.password);
        if(!/^[a-z0-9_.-]{3,40}$/.test(username)||pass.length<12)throw new Failure(400,'Логин — 3–40 латинских символов; пароль — от 12 символов.');
        if(await db.prepare('SELECT id FROM users WHERE username=?').bind(username).first())throw new Failure(409,'Такой логин уже существует.');
        await db.prepare("INSERT INTO users(username,password,role) VALUES(?,?,'player')").bind(username,await hashPassword(pass)).run();
        return response({ok:true},201);
      }
    }
    let match=path.match(/^\/api\/users\/(\d+)\/password$/);
    if(match&&method==='POST') {
      if(!isAdmin(user))throw new Failure(403,'Доступ только для администратора сервера.');
      const id=Number(match[1]),fresh=password(payload.password);
      if(id===user.id||fresh.length<12)throw new Failure(400,'Новый пароль игрока — от 12 символов.');
      const row=await db.prepare("SELECT id FROM users WHERE id=? AND role='player'").bind(id).first();
      if(!row)throw new Failure(404,'Игрок не найден.');
      await db.batch([db.prepare('UPDATE users SET password=? WHERE id=?').bind(await hashPassword(fresh),id),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(id)]);
      return response({ok:true});
    }
    const accessResponse=await accessRoutes(db,user,path,method,payload);if(accessResponse)return accessResponse;
    if(path==='/api/characters') {
      if(method==='GET') {
        const query='SELECT c.*,u.username FROM characters c JOIN users u ON u.id=c.owner_id';
        const prepared=db.prepare(query+` WHERE ${readScope} ORDER BY c.id`).bind(user.id,user.id,user.id,user.id);
        const rows=(await prepared.all<any>()).results;
        return response(await Promise.all(rows.map(r=>characterView(db,user,r))));
      }
      if(method==='POST') {
        const id=user.id,data=validate(payload.data),stamp=now();
        if(!await db.prepare('SELECT id FROM users WHERE id=?').bind(id).first())throw new Failure(400,'Игрок не найден.');
        const inserted=await db.prepare('INSERT INTO characters(owner_id,data,version,updated) VALUES(?,?,1,?) RETURNING id').bind(id,JSON.stringify(data),stamp).first<{id:number}>();
        const cid=inserted!.id;
        await db.prepare('INSERT INTO revisions(character_id,actor_id,data,version,reason,created) VALUES(?,?,?,1,?,?)').bind(cid,user.id,JSON.stringify(data),'Создание персонажа',stamp).run();
        return response({id:cid,version:1},201);
      }
    }
    match=path.match(/^\/api\/characters\/(\d+)(\/history)?$/);
    if(match) {
      const id=Number(match[1]),row=await character(db,user,id);
      if(!match[2]&&method==='GET')return response(await characterView(db,user,row));
      if(match[2]&&method==='GET'&&!await db.prepare(`SELECT 1 FROM characters c WHERE c.id=? AND (${manageScope})`).bind(id,user.id,user.id).first())throw new Failure(403,'История листа доступна владельцу и ведущему.');
      if(match[2]&&method==='GET')return response((await db.prepare('SELECT r.version,r.reason,r.created,COALESCE(l.actor_label,u.username) AS username FROM revisions r JOIN users u ON u.id=r.actor_id LEFT JOIN imported_revision_labels l ON l.revision_id=r.id WHERE r.character_id=? ORDER BY r.id DESC LIMIT 50').bind(id).all()).results);
      if(!match[2]&&method==='DELETE') {
        if(row.owner_id!==user.id)throw new Failure(403,'Удалить личный лист может его владелец. Ведущий может вывести героя из кампании.');
        if(Object.keys(payload).length!==1||!Object.hasOwn(payload,'version')||!Number.isInteger(payload.version))throw new Failure(400,'Для удаления нужна текущая версия листа.');
        const version=num(payload.version,'Версия',1,1e9);
        // Both deletes have the same version/authorization guard. D1 batches roll back on errors.
        const result=await db.batch([
          db.prepare('UPDATE campaigns SET version=version+1,updated=? WHERE id IN (SELECT campaign_id FROM campaign_characters WHERE character_id=?) AND EXISTS(SELECT 1 FROM characters WHERE id=? AND version=? AND owner_id=?)').bind(now(),id,id,version,user.id),
          db.prepare('DELETE FROM revisions WHERE character_id=? AND EXISTS (SELECT 1 FROM characters WHERE id=? AND version=? AND owner_id=?)').bind(id,id,version,user.id),
          db.prepare('DELETE FROM characters WHERE id=? AND version=? AND owner_id=?').bind(id,version,user.id),
        ]);
        if(result[2].meta.changes!==1)throw new Failure(409,'Лист уже изменился. Обнови его в «История» и проверь перед удалением.');
        return response({ok:true});
      }
      if(!match[2]&&method==='PUT') {
        if(!(await characterView(db,user,row)).can_edit)throw new Failure(403,'Заявка пока доступна ведущему только для просмотра.');
        const version=num(payload.version,'Версия',1,1e9),data=validate(payload.data),reason=str(payload.reason??'','Описание изменения',180)||'Лист обновлён',stamp=now();
        const encoded=JSON.stringify(data);
        // This D1 batch is atomic; the history insert only records this exact successful version update.
        const result=await db.batch([
          db.prepare(`UPDATE characters SET data=?,version=version+1,updated=? WHERE id=? AND version=? AND (${editScope})`).bind(encoded,stamp,id,version,user.id,user.id),
          db.prepare('INSERT INTO revisions(character_id,actor_id,data,version,reason,created) SELECT ?,?,?,?, ?,? WHERE changes()=1').bind(id,user.id,encoded,version+1,reason,stamp),
        ]);
        if(result[0].meta.changes!==1)throw new Failure(409,'Лист уже изменён с другого устройства. Скачай черновик и загрузи свежую версию в «История».');
        return response({id,version:version+1,updated:stamp});
      }
    }
    throw new Failure(404,'Страница не найдена.');
  } catch(error) {
    if(error instanceof Error&&'status' in error&&Number.isInteger(error.status)&&Number(error.status)>=400&&Number(error.status)<500)return response({error:error.message},Number(error.status));
    if(error instanceof Failure)return response({error:error.message},error.status);
    console.error('Tracker request failed',error instanceof Error?error.message:'unknown error');
    return response({error:'Не удалось прочитать или сохранить данные. Изменения остаются на экране. Попробуй ещё раз.'},503);
  }
}
export const GET=handler;
export const POST=handler;
export const PUT=handler;

export const DELETE=handler;
