/* Campaign portability. Schema migrations must be applied before these routes. */
export type PortableContext={db:any;user:{id:number;username:string};path:string;method:string;payload:any;validateCharacter:(data:any)=>any;workspaceValidate:(data:any,characterIds:number[],acceptedCharacterIds?:number[])=>any};
class TransferFailure extends Error {constructor(public status:number,message:string){super(message)}}
const MAX_BYTES=1800000,MAX_SHEETS=30,MAX_REVISIONS=300;
const stamp=()=>Math.floor(Date.now()/1000),uid=()=>crypto.randomUUID(),hex=(v:ArrayBuffer|Uint8Array)=>[...new Uint8Array(v)].map(x=>x.toString(16).padStart(2,'0')).join('');
const secret=()=>hex(crypto.getRandomValues(new Uint8Array(20))).toUpperCase();
const digest=async(v:string)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));
export function canonical(value:any):string {if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}'}
const answer=(v:any,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message:string,status=400):never=>{throw new TransferFailure(status,message)};
function text(v:any,label:string,max:number,required=false){if(typeof v!=='string'||v.length>max||(required&&!v.trim()))fail(`Проверь поле «${label}» в архиве.`);return v}
function integer(v:any,label:string,min=0,max=1e12){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)fail(`Проверь число «${label}» в архиве.`);return v}
function uuid(v:any){if(typeof v!=='string'||!/^([a-f0-9]{8}-){1}[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v))fail('В архиве повреждён постоянный идентификатор.');return v.toLowerCase()}
function array(v:any,max:number,label:string):any[]{if(!Array.isArray(v)||v.length>max)fail(`Слишком много записей: ${label}.`);return v}
function distinct(values:any[],label:string){if(new Set(values).size!==values.length)fail(`Повторяются идентификаторы: ${label}.`)}
function object(v:any,keys:string[],label:string){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))fail(`Неизвестный формат: ${label}.`)}
const emptyWorkspace=()=>({schemaVersion:1,contacts:[],messages:[],places:[],assets:[],scene:{id:uid(),name:'Новая сцена',active:false,targets:[],actions:[],log:[]}});
function convertWorkspace(raw:any,convert:(ref:any)=>any){const data=JSON.parse(JSON.stringify(raw));
 const list=(values:any)=>{if(!Array.isArray(values))fail('В архиве повреждены права доступа.');return values.map(convert)};
 for(const contact of data.contacts??[])contact.recipients=list(contact.recipients);
 for(const message of data.messages??[])message.characterId=convert(message.characterId);
 for(const place of data.places??[])place.recipients=list(place.recipients);
 for(const asset of data.assets??[]){asset.ownerCharacterId=asset.ownerCharacterId===null?null:convert(asset.ownerCharacterId);asset.access=list(asset.access)}
 for(const action of data.scene?.actions??[])action.characterId=convert(action.characterId);
 for(const piece of data.scene?.board?.pieces??[])if(piece.characterId!==null)piece.characterId=convert(piece.characterId);
 return data;
}
type Archive={format:'night-city-campaign';formatVersion:1;apiVersion:1;campaignUuid:string;exportedAt:number;fingerprint:string;ancestors:string[];content:any};
type Capture={archive:Archive;campaign:any;workspace:any;rows:any[];members:number[];owners:any[]};
async function ensureUser(db:any,id:number){await db.prepare('INSERT OR IGNORE INTO user_portability(user_id,uuid) VALUES(?,?)').bind(id,uid()).run();return (await db.prepare('SELECT uuid FROM user_portability WHERE user_id=?').bind(id).first()).uuid}
async function capture(ctx:PortableContext,id:number):Promise<Capture>{const {db,user}=ctx;
 const campaign=await db.prepare('SELECT * FROM campaigns WHERE id=? AND gm_id=?').bind(id,user.id).first();if(!campaign)fail('Архив доступен только ведущему этой кампании.',403);
 const userKeyCache=new Map<number,string>();const localUserKey=async(id:number)=>{if(!userKeyCache.has(id))userKeyCache.set(id,await ensureUser(db,id));return userKeyCache.get(id)!};const gmUserKey=await localUserKey(campaign.gm_id);
 await db.prepare("INSERT OR IGNORE INTO campaign_portability(campaign_id,uuid,gm_key,ancestors,updated) VALUES(?,?,?,'[]',?)").bind(id,uid(),gmUserKey,stamp()).run();
 let portable=await db.prepare('SELECT * FROM campaign_portability WHERE campaign_id=?').bind(id).first();
 const gmBinding=await db.prepare('SELECT user_id FROM campaign_portable_owners WHERE campaign_id=? AND owner_key=?').bind(id,portable.gm_key).first();
 if(gmBinding&&gmBinding.user_id!==campaign.gm_id){const knownNewGM=await db.prepare('SELECT owner_key FROM campaign_portable_owners WHERE campaign_id=? AND user_id=? ORDER BY member DESC,owner_key LIMIT 1').bind(id,campaign.gm_id).first();const newGMKey=knownNewGM?.owner_key??gmUserKey;await db.prepare('UPDATE campaign_portability SET gm_key=?,updated=? WHERE campaign_id=?').bind(newGMKey,stamp(),id).run();portable={...portable,gm_key:newGMKey}}
 const rows=(await db.prepare('SELECT c.*,cc.status,cc.created AS linked_at,u.username AS owner_label FROM campaign_characters cc JOIN characters c ON c.id=cc.character_id JOIN users u ON u.id=c.owner_id WHERE cc.campaign_id=? ORDER BY c.id').bind(id).all()).results;
 if(rows.length>MAX_SHEETS)fail(`В переносимой кампании может быть не более ${MAX_SHEETS} листов.`);
 const ownerMap=new Map<string,any>();
 const storedOwners=(await db.prepare('SELECT * FROM campaign_portable_owners WHERE campaign_id=?').bind(id).all()).results;
 const ownerByKey=new Map<string,any>(storedOwners.map((v:any)=>[v.owner_key,v]));
 async function localOwner(userId:number,label:string,preferred?:string){const existing=preferred?ownerByKey.get(preferred):storedOwners.find((v:any)=>v.user_id===userId);
  const key=preferred??existing?.owner_key??await localUserKey(userId);const name=existing?.label??label;
  ownerMap.set(key,{key,label:name});if(!existing)await db.prepare('INSERT OR IGNORE INTO campaign_portable_owners(campaign_id,owner_key,label,user_id) VALUES(?,?,?,?)').bind(id,key,name,userId).run();return key;
 }
 await localOwner(campaign.gm_id,user.username,portable.gm_key);
 const members=(await db.prepare('SELECT m.user_id,u.username FROM campaign_members m JOIN users u ON u.id=m.user_id WHERE m.campaign_id=? ORDER BY m.user_id').bind(id).all()).results;
 const memberKeys:string[]=[];for(const member of members){const bindings=storedOwners.filter((o:any)=>o.user_id===member.user_id&&o.member===1);if(bindings.length){for(const owner of bindings){if(owner.owner_key!==portable.gm_key)memberKeys.push(owner.owner_key);ownerMap.set(owner.owner_key,{key:owner.owner_key,label:owner.label})}}else{const memberKey=await localOwner(member.user_id,member.username);if(memberKey!==portable.gm_key)memberKeys.push(memberKey);await db.prepare('UPDATE campaign_portable_owners SET member=1 WHERE campaign_id=? AND owner_key=?').bind(id,memberKey).run()}}for(const owner of storedOwners){if(owner.member===1&&owner.user_id===null&&owner.owner_key!==portable.gm_key){memberKeys.push(owner.owner_key);ownerMap.set(owner.owner_key,{key:owner.owner_key,label:owner.label})}}
 const sheets:any[]=[];let revisionCount=0;
 for(const row of rows){const actualUserKey=await localUserKey(row.owner_id);await db.prepare('INSERT OR IGNORE INTO character_portability(character_id,uuid,owner_key) VALUES(?,?,?)').bind(row.id,uid(),actualUserKey).run();
  const cp=await db.prepare('SELECT * FROM character_portability WHERE character_id=?').bind(row.id).first();const binding=ownerByKey.get(cp.owner_key);
  const ownerKey=await localOwner(row.owner_id,row.owner_label,cp.owner_key);
  // Unclaimed imported characters deliberately remain GM-owned until their code is used.
  if(binding&&binding.user_id!==null&&binding.user_id!==row.owner_id)fail('Владелец переносимого листа изменился. Проверь привязку персонажа.',409);
  const revisions=(await db.prepare('SELECT r.*,u.username AS actor_label,l.actor_key AS imported_actor_key,l.actor_label AS imported_actor_label FROM revisions r JOIN users u ON u.id=r.actor_id LEFT JOIN imported_revision_labels l ON l.revision_id=r.id WHERE r.character_id=? ORDER BY r.id').bind(row.id).all()).results;
  revisionCount+=revisions.length;if(revisionCount>MAX_REVISIONS)fail(`Архив содержит больше ${MAX_REVISIONS} ревизий. Полная история не будет обрезана: уменьши кампанию перед переносом.`);
  const history=[];for(const revision of revisions){const actorKey=revision.imported_actor_key??await localUserKey(revision.actor_id);const actorLabel=revision.imported_actor_label??revision.actor_label;ownerMap.set(actorKey,{key:actorKey,label:actorLabel});history.push({version:revision.version,reason:revision.reason,created:revision.created,actorKey,actorLabel,data:ctx.validateCharacter(JSON.parse(revision.data))})}
  row.uuid=cp.uuid;row.owner_key=ownerKey;sheets.push({uuid:cp.uuid,ownerKey,status:row.status,data:ctx.validateCharacter(JSON.parse(row.data)),revisions:history});
 }
 let workspace=await db.prepare('SELECT * FROM campaign_workspaces WHERE campaign_id=?').bind(id).first();
 // A missing workspace has a deterministic empty scene id, so read/export do not fabricate changing state.
 const rawWorkspace=workspace?JSON.parse(workspace.data):{...emptyWorkspace(),scene:{id:portable.uuid,name:'Новая сцена',active:false,targets:[],actions:[],log:[]}};
 const checked=ctx.workspaceValidate(rawWorkspace,rows.map((r:any)=>r.id),rows.filter((r:any)=>['active','reserve'].includes(r.status)).map((r:any)=>r.id));
 const refs=new Map(rows.map((r:any)=>[r.id,r.uuid]));const portableWorkspace=convertWorkspace(checked,ref=>{const key=refs.get(ref);if(!key)fail('Терминал ссылается на персонажа вне состава кампании. Верни его в состав перед переносом, чтобы сохранить историю.');return key});
 const content={campaign:{name:campaign.name,description:campaign.description,gm_notes:campaign.gm_notes,ledger:campaign.ledger,gmOwnerKey:portable.gm_key},owners:[...ownerMap.values()].sort((a,b)=>a.key.localeCompare(b.key)),members:[...new Set(memberKeys)].sort(),characters:sheets.sort((a,b)=>a.uuid.localeCompare(b.uuid)),workspace:portableWorkspace};
 const fingerprint=await digest(canonical(content));const ancestors=JSON.parse(portable.ancestors).filter((v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)&&v!==fingerprint).slice(-128);
 const verifiedRows=(await db.prepare('SELECT c.id,c.owner_id,c.version,c.data,cc.status FROM campaign_characters cc JOIN characters c ON c.id=cc.character_id WHERE cc.campaign_id=? ORDER BY c.id').bind(id).all()).results;if(verifiedRows.length!==rows.length||verifiedRows.some((r:any,i:number)=>{const original=rows[i];return r.id!==original.id||r.owner_id!==original.owner_id||r.version!==original.version||r.data!==original.data||r.status!==original.status}))fail('Листы изменились во время сохранения кампании. Повтори экспорт после завершения действий игроков.',409);
 const verifiedCampaign=await db.prepare('SELECT gm_id,version FROM campaigns WHERE id=?').bind(id).first();if(!verifiedCampaign||verifiedCampaign.gm_id!==user.id)fail('Право ведущего изменилось во время переноса. Обнови кампанию.',403);if(verifiedCampaign.version!==campaign.version)fail('Кампания изменилась во время сохранения. Повтори экспорт после завершения действий игроков.',409);
 const archive:Archive={format:'night-city-campaign',formatVersion:1,apiVersion:1,campaignUuid:portable.uuid,exportedAt:stamp(),fingerprint,ancestors,content};if(new TextEncoder().encode(JSON.stringify(archive)).byteLength>MAX_BYTES)fail('Полная кампания превышает размер переносимого архива 1,8 МБ. Данные и история не обрезаны.');
 return {archive,campaign,workspace,rows,members:members.map((v:any)=>v.user_id),owners:(await db.prepare('SELECT * FROM campaign_portable_owners WHERE campaign_id=?').bind(id).all()).results};
}
async function validateArchive(ctx:PortableContext,raw:any):Promise<Archive>{
 if(new TextEncoder().encode(JSON.stringify(raw)).byteLength>MAX_BYTES)fail('Архив больше 1,8 МБ.');
 object(raw,['format','formatVersion','apiVersion','campaignUuid','exportedAt','fingerprint','ancestors','content'],'архив');
 if(raw.format!=='night-city-campaign'||raw.formatVersion!==1||raw.apiVersion!==1)fail('Эта версия приложения не поддерживает формат архива.');
 uuid(raw.campaignUuid);integer(raw.exportedAt,'Дата экспорта');if(typeof raw.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(raw.fingerprint))fail('В архиве повреждена контрольная сумма.');
 const ancestors=array(raw.ancestors,128,'история переносов');if(ancestors.some(v=>typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v)))fail('Повреждена история переносов.');distinct(ancestors,'история переносов');
 object(raw.content,['campaign','owners','members','characters','workspace'],'содержимое');const c=raw.content;
 object(c.campaign,['name','description','gm_notes','ledger','gmOwnerKey'],'кампания');text(c.campaign.name,'Название',100,true);text(c.campaign.description,'Описание',3000);text(c.campaign.gm_notes,'Записи ведущего',24000);text(c.campaign.ledger,'Учёт',16000);uuid(c.campaign.gmOwnerKey);
 const owners=array(c.owners,100,'владельцы');for(const owner of owners){object(owner,['key','label'],'владелец');uuid(owner.key);text(owner.label,'Имя владельца',100,true)}distinct(owners.map(o=>o.key),'владельцы');const ownerKeys=new Set(owners.map(o=>o.key));
 const refsOwner=(ref:any)=>{uuid(ref);if(!ownerKeys.has(ref))fail('Архив ссылается на неизвестного владельца.');return ref};refsOwner(c.campaign.gmOwnerKey);
 const members=array(c.members,100,'участники');members.forEach(refsOwner);distinct(members,'участники');
 const sheets=array(c.characters,MAX_SHEETS,'листы');distinct(sheets.map(s=>s.uuid),'листы');let count=0;
 for(const sheet of sheets){object(sheet,['uuid','ownerKey','status','data','revisions'],'лист');uuid(sheet.uuid);refsOwner(sheet.ownerKey);if(!['pending','active','reserve'].includes(sheet.status))fail('Неизвестный статус персонажа.');
  if(canonical(ctx.validateCharacter(sheet.data))!==canonical(sheet.data))fail('Лист в архиве требует обновления формата. Экспортируй его актуальной версией приложения.');
  const history=array(sheet.revisions,MAX_REVISIONS,'ревизии');count+=history.length;if(count>MAX_REVISIONS)fail('В архиве слишком много ревизий.');
  for(const revision of history){object(revision,['version','reason','created','actorKey','actorLabel','data'],'ревизия');integer(revision.version,'Версия листа',1,1e9);integer(revision.created,'Дата ревизии');text(revision.reason,'Причина',300,true);refsOwner(revision.actorKey);text(revision.actorLabel,'Автор',100,true);if(canonical(ctx.validateCharacter(revision.data))!==canonical(revision.data))fail('Ревизия в архиве имеет неподдерживаемый формат.')}
 }
 const idByUuid=new Map(sheets.map((s,index)=>[s.uuid,index+1]));const normalized=convertWorkspace(c.workspace,ref=>{uuid(ref);const id=idByUuid.get(ref);if(id===undefined)fail('Архив терминала ссылается на лист, который не включён в перенос.');return id});
 const validated=ctx.workspaceValidate(normalized,sheets.map((_,i)=>i+1),sheets.flatMap((s,i)=>['active','reserve'].includes(s.status)?[i+1]:[]));const back=convertWorkspace(validated,ref=>sheets[ref-1]?.uuid??fail('Повреждены ссылки терминала.'));
 if(canonical(back)!==canonical(c.workspace))fail('Терминал в архиве требует обновления формата.');
 if(await digest(canonical(c))!==raw.fingerprint)fail('Архив повреждён: контрольная сумма не совпала.');return raw;
}
async function plan(ctx:PortableContext,archive:Archive){const target=await ctx.db.prepare('SELECT campaign_id FROM campaign_portability WHERE uuid=?').bind(archive.campaignUuid).first();
 let current:Capture|null=null;const conflicts:string[]=[];
 if(target){current=await capture(ctx,target.campaign_id);if(archive.fingerprint!==current.archive.fingerprint&&!archive.ancestors.includes(current.archive.fingerprint))conflicts.push('На этом сервере есть изменения, которых нет в истории архива. Сохрани обе версии; автоматическое объединение не выполняется.');
  if(archive.content.campaign.gmOwnerKey!==current.archive.content.campaign.gmOwnerKey)conflicts.push('В архиве указан другой ведущий. Сначала согласуй передачу кампании на этом сервере; импорт не меняет права ведущего автоматически.');
  const incoming=new Map(archive.content.characters.map((s:any)=>[s.uuid,s]));
  for(const row of current.rows){const exported=current.archive.content.characters.find((s:any)=>s.uuid===row.uuid),next:any=incoming.get(row.uuid);if(next&&next.ownerKey!==row.owner_key)conflicts.push(`Архив меняет владельца листа «${exported.data.name}». Перенос не передаёт существующие листы другому пользователю.`);if(!next||canonical(next)!==canonical(exported)){
    const other=await ctx.db.prepare('SELECT k.name FROM campaign_characters cc JOIN campaigns k ON k.id=cc.campaign_id WHERE cc.character_id=? AND cc.campaign_id<>? LIMIT 1').bind(row.id,current.campaign.id).first();if(other)conflicts.push(`Лист «${exported.data.name}» используется также в кампании «${other.name}». Его изменение или вывод требует отдельного переноса.`);
   }}
 }
 for(const sheet of archive.content.characters){const local=await ctx.db.prepare('SELECT cp.character_id FROM character_portability cp WHERE cp.uuid=?').bind(sheet.uuid).first();if(local&&!current?.rows.some((r:any)=>r.id===local.character_id))conflicts.push(`Лист «${sheet.data.name}» уже существует вне этой кампании. Импорт не будет менять чужую коллекцию.`)}
 const mode=conflicts.length?'conflict':!current?'new':archive.fingerprint===current.archive.fingerprint?'unchanged':'update';
 return {current,mode,conflicts};
}
function bindStateGuard(ctx:PortableContext,current:Capture|null,archive:Archive,preview:any){const clauses:{sql:string,values:any[]}[]=[];
 const add=(sql:string,...values:any[])=>clauses.push({sql,values});
 add('EXISTS(SELECT 1 FROM campaign_transfer_previews WHERE token_hash=? AND user_id=? AND source_fingerprint=? AND expires>?)',preview.token_hash,ctx.user.id,archive.fingerprint,stamp());
 if(!current)add('NOT EXISTS(SELECT 1 FROM campaign_portability WHERE uuid=?)',archive.campaignUuid);
 else {const c=current.campaign;add('EXISTS(SELECT 1 FROM campaigns WHERE id=? AND gm_id=? AND version=? AND name=? AND description=? AND gm_notes=? AND ledger=? AND invite_code=? AND transfer_to IS ?)',c.id,ctx.user.id,c.version,c.name,c.description,c.gm_notes,c.ledger,c.invite_code,c.transfer_to);
  add('(SELECT COUNT(*) FROM campaign_characters WHERE campaign_id=?)=?',c.id,current.rows.length);
  for(const row of current.rows)add('EXISTS(SELECT 1 FROM characters c JOIN campaign_characters cc ON cc.character_id=c.id WHERE c.id=? AND c.owner_id=? AND c.version=? AND c.data=? AND cc.campaign_id=? AND cc.status=?)',row.id,row.owner_id,row.version,row.data,c.id,row.status);
  if(current.workspace)add('EXISTS(SELECT 1 FROM campaign_workspaces WHERE campaign_id=? AND version=? AND data=?)',c.id,current.workspace.version,current.workspace.data);else add('NOT EXISTS(SELECT 1 FROM campaign_workspaces WHERE campaign_id=?)',c.id);
  add('(SELECT COUNT(*) FROM campaign_members WHERE campaign_id=?)=?',c.id,current.members.length);for(const member of current.members)add('EXISTS(SELECT 1 FROM campaign_members WHERE campaign_id=? AND user_id=?)',c.id,member);
  const ownerCount=current.owners.length;add('(SELECT COUNT(*) FROM campaign_portable_owners WHERE campaign_id=?)=?',c.id,ownerCount);
  for(const row of current.owners)add('EXISTS(SELECT 1 FROM campaign_portable_owners WHERE campaign_id=? AND owner_key=? AND user_id IS ? AND claim_hash IS ? AND member=?)',c.id,row.owner_key,row.user_id,row.claim_hash,row.member);
 }
 for(const sheet of archive.content.characters){const row=current?.rows.find((r:any)=>r.uuid===sheet.uuid);if(!row)add('NOT EXISTS(SELECT 1 FROM character_portability WHERE uuid=?)',sheet.uuid);else {
  const before=current!.archive.content.characters.find((s:any)=>s.uuid===sheet.uuid);if(canonical(before)!==canonical(sheet))add('NOT EXISTS(SELECT 1 FROM campaign_characters WHERE character_id=? AND campaign_id<>?)',row.id,current!.campaign.id);
 }}
 if(current){for(const row of current.rows){if(!archive.content.characters.some((s:any)=>s.uuid===row.uuid))add('NOT EXISTS(SELECT 1 FROM campaign_characters WHERE character_id=? AND campaign_id<>?)',row.id,current.campaign.id)}}
 const guardId=uid(),statements:any[]=[];let sql:string[]=[],params:any[]=[];
 const flush=()=>{if(!sql.length)return;statements.push(ctx.db.prepare(`INSERT INTO campaign_transfer_guards(id,passed) VALUES(?,CASE WHEN ${sql.join(' AND ')} THEN 1 ELSE 0 END)`).bind(`${guardId}-${statements.length}`,...params));sql=[];params=[]};
 for(const clause of clauses){if(params.length+clause.values.length>70)flush();sql.push(clause.sql);params.push(...clause.values)}flush();return {guardId,statements};
}
async function applyArchive(ctx:PortableContext,archive:Archive,token:string){const {db,user}=ctx;const tokenHash=await digest(token);const preview=await db.prepare('SELECT * FROM campaign_transfer_previews WHERE token_hash=? AND user_id=? AND expires>?').bind(tokenHash,user.id,stamp()).first();
 if(!preview||preview.campaign_uuid!==archive.campaignUuid||preview.source_fingerprint!==archive.fingerprint)fail('Предпросмотр истёк или относится к другому файлу. Загрузи архив заново.',409);
 const planned=await plan(ctx,archive);if(planned.conflicts.length)fail(planned.conflicts.join(' '),409);
 const current=planned.current;if((current?.campaign.id??null)!==preview.target_id||(current?.archive.fingerprint??null)!==preview.destination_fingerprint)fail('Кампания изменилась после предпросмотра. Обнови проверку архива.',409);
 if(planned.mode==='unchanged'){await db.prepare('DELETE FROM campaign_transfer_previews WHERE token_hash=?').bind(tokenHash).run();return {id:current!.campaign.id,mode:'unchanged',claimCodes:[]}}
 const guard=bindStateGuard(ctx,current,archive,preview),statements:any[]=[...guard.statements];const now=stamp(),c=archive.content.campaign;
 const campaignId=current?.campaign.id??null;const campaignRef=campaignId===null?'(SELECT campaign_id FROM campaign_portability WHERE uuid=?)':'?';const campaignArgs=()=>campaignId===null?[archive.campaignUuid]:[campaignId];
 if(current){statements.push(db.prepare('INSERT INTO campaign_transfer_backups(id,campaign_id,created,data) VALUES(?,?,?,?)').bind(uid(),campaignId,now,JSON.stringify(current.archive)));
  statements.push(db.prepare('UPDATE campaigns SET name=?,description=?,gm_notes=?,ledger=?,invite_code=?,transfer_to=NULL,version=version+1,updated=? WHERE id=?').bind(c.name,c.description,c.gm_notes,c.ledger,secret().slice(0,20),now,campaignId));
 }else {statements.push(db.prepare('INSERT INTO campaigns(gm_id,name,description,invite_code,gm_notes,ledger,updated) VALUES(?,?,?,?,?,?,?)').bind(user.id,c.name,c.description,secret().slice(0,20),c.gm_notes,c.ledger,now));statements.push(db.prepare('INSERT INTO campaign_portability(campaign_id,uuid,gm_key,ancestors,updated) VALUES(last_insert_rowid(),?,?,?,?)').bind(archive.campaignUuid,c.gmOwnerKey,JSON.stringify([...new Set([...archive.ancestors,archive.fingerprint])].slice(-128)),now))}
 if(current)statements.push(db.prepare('UPDATE campaign_portable_owners SET member=0 WHERE campaign_id=?').bind(campaignId));
 const oldBindings=new Map<string,any>(current?.owners.map((o:any)=>[o.owner_key,o])??[]);const claimCodes:any[]=[];const mappedUser=new Map<string,number|null>();
 for(const owner of archive.content.owners){const old=oldBindings.get(owner.key);let local=old?.user_id??null;if(owner.key===c.gmOwnerKey)local=user.id;const hasSheets=archive.content.characters.some((s:any)=>s.ownerKey===owner.key);const isMember=archive.content.members.includes(owner.key);
  let code:string|null=null,hash:string|null=old?.claim_hash??null;if(local===null&&(hasSheets||isMember)){code=secret();hash=await digest(code);claimCodes.push({ownerKey:owner.key,label:owner.label,code,characters:archive.content.characters.filter((s:any)=>s.ownerKey===owner.key).map((s:any)=>s.data.name)})}
  mappedUser.set(owner.key,local);statements.push(db.prepare(`INSERT INTO campaign_portable_owners(campaign_id,owner_key,label,user_id,claim_hash,member) VALUES(${campaignRef},?,?,?,?,?) ON CONFLICT(campaign_id,owner_key) DO UPDATE SET label=excluded.label,user_id=excluded.user_id,claim_hash=excluded.claim_hash,member=excluded.member`).bind(...campaignArgs(),owner.key,owner.label,local,hash,isMember?1:0));
 }
 const oldRows=new Map<string,any>(current?.rows.map((r:any)=>[r.uuid,r])??[]);const idByUuid=new Map<string,any>();
 // IDs allocated explicitly under the atomic guard so all cross references can be remapped before batch submission.
 const maxRow=await db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM characters').first();let nextId=maxRow.id+1;
 for(const sheet of archive.content.characters){const old=oldRows.get(sheet.uuid);idByUuid.set(sheet.uuid,old?.id??nextId++)}
 if(nextId>maxRow.id+1){statements.unshift(db.prepare('INSERT INTO campaign_transfer_guards(id,passed) VALUES(?,CASE WHEN (SELECT COALESCE(MAX(id),0) FROM characters)=? THEN 1 ELSE 0 END)').bind(guard.guardId+'-allocation',maxRow.id))}
 for(const sheet of archive.content.characters){const old=oldRows.get(sheet.uuid),id=idByUuid.get(sheet.uuid),localOwner=old?.owner_id??mappedUser.get(sheet.ownerKey)??user.id;const oldArchive=current?.archive.content.characters.find((s:any)=>s.uuid===sheet.uuid);const importedVersion=Math.max(old?old.version+1:1,...sheet.revisions.map((r:any)=>r.version));
  if(old&&old.owner_key!==sheet.ownerKey)fail('Архив пытается изменить владельца существующего персонажа. Перенос отменён.',409);
  if(old&&canonical(oldArchive)===canonical(sheet))continue;
  if(old)statements.push(db.prepare('UPDATE characters SET data=?,version=?,updated=? WHERE id=?').bind(JSON.stringify(sheet.data),importedVersion,now,id));
  else {statements.push(db.prepare('INSERT INTO characters(id,owner_id,data,version,updated) VALUES(?,?,?,?,?)').bind(id,localOwner,JSON.stringify(sheet.data),importedVersion,now));statements.push(db.prepare('INSERT INTO character_portability(character_id,uuid,owner_key) VALUES(?,?,?)').bind(id,sheet.uuid,sheet.ownerKey))}
  statements.push(db.prepare('DELETE FROM imported_revision_labels WHERE revision_id IN(SELECT id FROM revisions WHERE character_id=?)').bind(id));statements.push(db.prepare('DELETE FROM revisions WHERE character_id=?').bind(id));
  for(const revision of sheet.revisions){const actor=mappedUser.get(revision.actorKey)??user.id;statements.push(db.prepare('INSERT INTO revisions(character_id,actor_id,data,version,reason,created) VALUES(?,?,?,?,?,?)').bind(id,actor,JSON.stringify(revision.data),revision.version,revision.reason,revision.created));statements.push(db.prepare('INSERT INTO imported_revision_labels(revision_id,actor_key,actor_label) VALUES(last_insert_rowid(),?,?)').bind(revision.actorKey,revision.actorLabel))}
 }
 statements.push(db.prepare(`DELETE FROM campaign_characters WHERE campaign_id=${campaignRef}`).bind(...campaignArgs()));
 for(const sheet of archive.content.characters)statements.push(db.prepare(`INSERT INTO campaign_characters(campaign_id,character_id,status,created) VALUES(${campaignRef},?,?,?)`).bind(...campaignArgs(),idByUuid.get(sheet.uuid),sheet.status,now));
 const workspace=convertWorkspace(archive.content.workspace,ref=>idByUuid.get(ref)??fail('Повреждена ссылка на персонажа.'));ctx.workspaceValidate(workspace,[...idByUuid.values()]);
 statements.push(db.prepare(`INSERT INTO campaign_workspaces(campaign_id,data,version,updated,recent_requests) VALUES(${campaignRef},?,1,?,'[]') ON CONFLICT(campaign_id) DO UPDATE SET data=excluded.data,version=campaign_workspaces.version+1,updated=excluded.updated,recent_requests='[]'`).bind(...campaignArgs(),JSON.stringify(workspace),now));
 statements.push(db.prepare(`DELETE FROM campaign_members WHERE campaign_id=${campaignRef}`).bind(...campaignArgs()));const localMembers=new Set<number>([user.id]);for(const key of archive.content.members){const local=mappedUser.get(key);if(local!==null&&local!==undefined)localMembers.add(local)}for(const sheet of archive.content.characters){if(sheet.status!=='pending'){const local=oldRows.get(sheet.uuid)?.owner_id??mappedUser.get(sheet.ownerKey);if(local!==null&&local!==undefined)localMembers.add(local)}}for(const member of localMembers)statements.push(db.prepare(`INSERT OR IGNORE INTO campaign_members(campaign_id,user_id) VALUES(${campaignRef},?)`).bind(...campaignArgs(),member));
 statements.push(db.prepare(`UPDATE campaign_portability SET gm_key=?,ancestors=?,updated=? WHERE campaign_id=${campaignRef}`).bind(c.gmOwnerKey,JSON.stringify([...new Set([...archive.ancestors,archive.fingerprint])].slice(-128)),now,...campaignArgs()));
 statements.push(db.prepare('DELETE FROM campaign_transfer_previews WHERE token_hash=?').bind(tokenHash));statements.push(db.prepare('DELETE FROM campaign_transfer_guards WHERE id LIKE ?').bind(guard.guardId+'-%'));
 statements.push(db.prepare(`DELETE FROM campaign_transfer_backups WHERE campaign_id=${campaignRef} AND id NOT IN(SELECT id FROM campaign_transfer_backups WHERE campaign_id=${campaignRef} ORDER BY created DESC,id DESC LIMIT 10)`).bind(...campaignArgs(),...campaignArgs()));
 try{await db.batch(statements)}catch(error){if(String(error).includes('CHECK constraint')||String(error).includes('UNIQUE constraint'))fail('Данные изменились во время переноса. Ничего не применено; обнови предпросмотр.',409);throw error}
 const resulting=await db.prepare('SELECT campaign_id FROM campaign_portability WHERE uuid=?').bind(archive.campaignUuid).first();return {id:resulting.campaign_id,campaignUuid:archive.campaignUuid,mode:planned.mode,claimCodes};
}
async function claim(ctx:PortableContext){const {db,user,payload}=ctx;const campaignUuid=uuid(payload.campaignUuid),code=text(payload.code,'Код восстановления',100,true).replace(/[\s-]/g,'').toUpperCase(),hash=await digest(code),now=stamp(),key=`campaign-claim:${user.id}`;
 await db.prepare('DELETE FROM attempts WHERE started<?').bind(now-900).run();const attempt=await db.prepare('SELECT count FROM attempts WHERE key=?').bind(key).first();if(attempt?.count>=20)fail('Слишком много попыток восстановления. Попробуй через 15 минут.',429);await db.prepare('INSERT INTO attempts(key,count,started) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').bind(key,now).run();
 const binding=await db.prepare('SELECT o.*,k.gm_id FROM campaign_portable_owners o JOIN campaign_portability p ON p.campaign_id=o.campaign_id JOIN campaigns k ON k.id=o.campaign_id WHERE p.uuid=? AND o.claim_hash=? AND o.user_id IS NULL').bind(campaignUuid,hash).first();if(!binding)fail('Код не найден, уже использован или относится к другой кампании.',404);
 const rows=(await db.prepare('SELECT c.id,c.owner_id,c.version,cp.uuid FROM character_portability cp JOIN characters c ON c.id=cp.character_id JOIN campaign_characters cc ON cc.character_id=c.id WHERE cc.campaign_id=? AND cp.owner_key=?').bind(binding.campaign_id,binding.owner_key).all()).results;
 const guardId=uid();const statements:any[]=[db.prepare('INSERT INTO campaign_transfer_guards(id,passed) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM campaign_portable_owners WHERE campaign_id=? AND owner_key=? AND user_id IS NULL AND claim_hash=?) AND (SELECT COUNT(*) FROM character_portability cp JOIN campaign_characters cc ON cc.character_id=cp.character_id WHERE cc.campaign_id=? AND cp.owner_key=?)=? THEN 1 ELSE 0 END)').bind(guardId+'-binding',binding.campaign_id,binding.owner_key,hash,binding.campaign_id,binding.owner_key,rows.length)];
 for(const row of rows)statements.push(db.prepare('INSERT INTO campaign_transfer_guards(id,passed) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM characters c JOIN character_portability cp ON cp.character_id=c.id JOIN campaign_characters cc ON cc.character_id=c.id WHERE cc.campaign_id=? AND cp.owner_key=? AND c.id=? AND c.owner_id=? AND c.version=? AND cp.uuid=?) THEN 1 ELSE 0 END)').bind(guardId+'-'+row.id,binding.campaign_id,binding.owner_key,row.id,row.owner_id,row.version,row.uuid));
 statements.push(db.prepare('UPDATE campaign_portable_owners SET user_id=?,claim_hash=NULL WHERE campaign_id=? AND owner_key=?').bind(user.id,binding.campaign_id,binding.owner_key));
 for(const row of rows)statements.push(db.prepare('DELETE FROM character_sharing WHERE character_id=?').bind(row.id));
 for(const row of rows)statements.push(db.prepare('UPDATE characters SET owner_id=?,version=version+1,updated=? WHERE id=?').bind(user.id,now,row.id));
 statements.push(db.prepare("INSERT OR IGNORE INTO campaign_members(campaign_id,user_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM campaign_portable_owners WHERE campaign_id=? AND owner_key=? AND member=1) OR EXISTS(SELECT 1 FROM campaign_characters cc JOIN character_portability cp ON cp.character_id=cc.character_id WHERE cc.campaign_id=? AND cp.owner_key=? AND cc.status IN ('active','reserve'))").bind(binding.campaign_id,user.id,binding.campaign_id,binding.owner_key,binding.campaign_id,binding.owner_key),db.prepare('UPDATE campaigns SET version=version+1,updated=? WHERE id=?').bind(now,binding.campaign_id),db.prepare('DELETE FROM attempts WHERE key=?').bind(key),db.prepare('DELETE FROM campaign_transfer_guards WHERE id LIKE ?').bind(guardId+'-%'));
 try{await db.batch(statements)}catch(error){if(String(error).includes('CHECK constraint'))fail('Код уже использован или состав изменился. Перенос владения не выполнен.',409);throw error}return {ok:true,id:binding.campaign_id,characterIds:rows.map((r:any)=>r.id)};
}
async function reissueClaims(ctx:PortableContext,id:number){const {db,user,payload}=ctx;const version=integer(payload.version,'Версия кампании',1,1e9);
 const campaign=await db.prepare('SELECT id,gm_id,version FROM campaigns WHERE id=? AND gm_id=?').bind(id,user.id).first();if(!campaign)fail('Коды восстановления доступны только ведущему кампании.',403);if(campaign.version!==version)fail('Кампания уже изменилась. Обнови её перед выдачей кодов.',409);
 const existing=await db.prepare('SELECT uuid FROM campaign_portability WHERE campaign_id=?').bind(id).first();if(!existing){await db.prepare("INSERT OR IGNORE INTO campaign_portability(campaign_id,uuid,gm_key,ancestors,updated) VALUES(?,?,?,'[]',?)").bind(id,uid(),await ensureUser(db,user.id),stamp()).run()}
 const identity=await db.prepare('SELECT uuid FROM campaign_portability WHERE campaign_id=?').bind(id).first();
 const eligible="o.campaign_id=? AND o.user_id IS NULL AND (o.member=1 OR EXISTS(SELECT 1 FROM campaign_characters cc JOIN character_portability cp ON cp.character_id=cc.character_id WHERE cc.campaign_id=o.campaign_id AND cp.owner_key=o.owner_key))";
 const owners=(await db.prepare(`SELECT o.* FROM campaign_portable_owners o WHERE ${eligible} ORDER BY o.owner_key`).bind(id).all()).results;
 if(!owners.length)return {id,campaignUuid:identity.uuid,version,claimCodes:[]};
 const guardId=uid(),now=stamp();const statements:any[]=[db.prepare(`INSERT INTO campaign_transfer_guards(id,passed) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM campaigns WHERE id=? AND gm_id=? AND version=?) AND (SELECT COUNT(*) FROM campaign_portable_owners o WHERE ${eligible})=? THEN 1 ELSE 0 END)`).bind(guardId+'-campaign',id,user.id,version,id,owners.length)];
 const claimCodes:any[]=[];
 for(const owner of owners){const code=secret();const rows=(await db.prepare('SELECT c.data FROM campaign_characters cc JOIN character_portability cp ON cp.character_id=cc.character_id JOIN characters c ON c.id=cc.character_id WHERE cc.campaign_id=? AND cp.owner_key=? ORDER BY c.id').bind(id,owner.owner_key).all()).results;
  claimCodes.push({ownerKey:owner.owner_key,label:owner.label,code,characters:rows.map((r:any)=>JSON.parse(r.data).name)});
  statements.push(db.prepare('INSERT INTO campaign_transfer_guards(id,passed) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM campaign_portable_owners WHERE campaign_id=? AND owner_key=? AND user_id IS NULL AND claim_hash IS ?) THEN 1 ELSE 0 END)').bind(guardId+'-'+owner.owner_key,id,owner.owner_key,owner.claim_hash));
 }
 for(const code of claimCodes)statements.push(db.prepare('UPDATE campaign_portable_owners SET claim_hash=? WHERE campaign_id=? AND owner_key=? AND user_id IS NULL').bind(await digest(code.code),id,code.ownerKey));
 statements.push(db.prepare('UPDATE campaigns SET version=version+1,updated=? WHERE id=?').bind(now,id),db.prepare('DELETE FROM campaign_transfer_guards WHERE id LIKE ?').bind(guardId+'-%'));
 try{await db.batch(statements)}catch(error){if(String(error).includes('CHECK constraint'))fail('Кампания или владельцы изменились во время выдачи кодов. Новые коды не применены; обнови кампанию.',409);throw error}
 return {id,campaignUuid:identity.uuid,version:version+1,claimCodes};
}
export async function portableRoutes(ctx:PortableContext):Promise<Response|null>{const {path,method,payload,db,user}=ctx;
 if(!/^\/api\/campaigns\/(?:\d+\/(?:export|backups|portable\/reissue-claims)|import(?:\/preview)?$|claim$)/.test(path))return null;
 try {
  const reissue=path.match(/^\/api\/campaigns\/(\d+)\/portable\/reissue-claims$/);if(reissue&&method==='POST')return answer(await reissueClaims(ctx,Number(reissue[1])));
  const download=path.match(/^\/api\/campaigns\/(\d+)\/export$/);if(download&&method==='GET'){const state=await capture(ctx,Number(download[1]));await db.prepare('UPDATE campaign_portability SET ancestors=?,updated=? WHERE campaign_id=?').bind(JSON.stringify([...new Set([...state.archive.ancestors,state.archive.fingerprint])].slice(-128)),stamp(),state.campaign.id).run();if(new TextEncoder().encode(JSON.stringify(state.archive)).byteLength>MAX_BYTES)fail('Полный архив превышает 1,8 МБ. История не обрезана; перенеси меньшую кампанию.');return answer(state.archive)}
  if(path==='/api/campaigns/import/preview'&&method==='POST'){const archive=await validateArchive(ctx,payload.archive),planned=await plan(ctx,archive),token=secret(),tokenHash=await digest(token);await db.prepare('DELETE FROM campaign_transfer_previews WHERE expires<=?').bind(stamp()).run();await db.prepare('INSERT INTO campaign_transfer_previews(token_hash,user_id,campaign_uuid,source_fingerprint,target_id,destination_fingerprint,expires) VALUES(?,?,?,?,?,?,?)').bind(tokenHash,user.id,archive.campaignUuid,archive.fingerprint,planned.current?.campaign.id??null,planned.current?.archive.fingerprint??null,stamp()+900).run();return answer({token,campaignId:planned.current?.campaign.id??null,mode:planned.mode,name:archive.content.campaign.name,characters:archive.content.characters.length,owners:archive.content.owners.filter((o:any)=>archive.content.members.includes(o.key)||archive.content.characters.some((s:any)=>s.ownerKey===o.key)).map((o:any)=>({...o,characters:archive.content.characters.filter((s:any)=>s.ownerKey===o.key).map((s:any)=>s.data.name)})),conflicts:planned.conflicts,sourceFingerprint:archive.fingerprint,destinationFingerprint:planned.current?.archive.fingerprint??null})}
  if(path==='/api/campaigns/import'&&method==='POST'){const archive=await validateArchive(ctx,payload.archive);return answer(await applyArchive(ctx,archive,text(payload.token,'Предпросмотр',100,true)))}
  if(path==='/api/campaigns/claim'&&method==='POST')return answer(await claim(ctx));
  const backups=path.match(/^\/api\/campaigns\/(\d+)\/backups(?:\/([a-f0-9-]+))?$/i);if(backups&&method==='GET'){const id=Number(backups[1]);if(!await db.prepare('SELECT 1 FROM campaigns WHERE id=? AND gm_id=?').bind(id,user.id).first())fail('Резервные копии доступны только ведущему.',403);if(backups[2]){const row=await db.prepare('SELECT data FROM campaign_transfer_backups WHERE id=? AND campaign_id=?').bind(uuid(backups[2]),id).first();if(!row)fail('Резервная копия не найдена.',404);return answer(JSON.parse(row.data))}const rows=(await db.prepare('SELECT id,created,data FROM campaign_transfer_backups WHERE campaign_id=? ORDER BY created DESC,id DESC LIMIT 10').bind(id).all()).results;return answer(rows.map((r:any)=>{const a=JSON.parse(r.data);return {id:r.id,created:r.created,name:a.content.campaign.name,fingerprint:a.fingerprint}}))}
  return null;
 }catch(error:any){if(typeof error?.status==='number')return answer({error:error.message},error.status);throw error}
}
