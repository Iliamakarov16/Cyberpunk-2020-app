type DB=D1Database;
type User={id:number};
class AccessFailure extends Error {constructor(public status:number,message:string){super(message);}}
const fail=(status:number,message:string):never=>{throw new AccessFailure(status,message);};
const json=(data:any)=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});

// Two bindings: recipient account, then the owner of an accepted party character.
export const sharedReadScope=`EXISTS(SELECT 1 FROM character_sharing s JOIN campaign_characters sc ON sc.character_id=s.character_id AND sc.campaign_id=s.campaign_id WHERE s.character_id=c.id AND sc.status IN ('active','reserve') AND (s.mode='party' OR (s.mode='selected' AND EXISTS(SELECT 1 FROM json_each(s.recipients) r WHERE r.value=?))) AND EXISTS(SELECT 1 FROM campaign_characters pc JOIN characters p ON p.id=pc.character_id WHERE pc.campaign_id=s.campaign_id AND pc.status IN ('active','reserve') AND p.owner_id=?))`;

export async function canShareRead(db:DB,userId:number,characterId:number){
 return !!await db.prepare(`SELECT 1 FROM characters c WHERE c.id=? AND ${sharedReadScope}`).bind(characterId,userId,userId).first();
}
export async function accessRoutes(db:DB,user:User,path:string,method:string,payload:any):Promise<Response|null>{
 const match=path.match(/^\/api\/characters\/(\d+)\/access$/);if(!match)return null;
 const id=Number(match[1]),row=await db.prepare('SELECT owner_id FROM characters WHERE id=?').bind(id).first<any>();
 if(!row)fail(404,'Персонаж не найден.');
 if(row.owner_id!==user.id)fail(403,'Доступом к листу распоряжается его владелец.');
 const campaigns=(await db.prepare(`SELECT k.id AS campaign_id,k.name,k.gm_id,cc.status,COALESCE(s.version,0) AS version,COALESCE(s.mode,'private') AS mode,COALESCE(s.recipients,'[]') AS recipients FROM campaign_characters cc JOIN campaigns k ON k.id=cc.campaign_id LEFT JOIN character_sharing s ON s.character_id=cc.character_id AND s.campaign_id=cc.campaign_id WHERE cc.character_id=? ORDER BY k.id`).bind(id).all<any>()).results;
 const players=async(cid:number,gmId:number)=>(await db.prepare("SELECT DISTINCT u.id,u.username FROM users u JOIN characters c ON c.owner_id=u.id JOIN campaign_characters cc ON cc.character_id=c.id WHERE cc.campaign_id=? AND cc.status IN ('active','reserve') AND u.id<>? AND u.id<>? ORDER BY u.username").bind(cid,user.id,gmId).all<any>()).results;
 if(method==='GET')return json({campaigns:await Promise.all(campaigns.map(async(c:any)=>{const eligible=['active','reserve'].includes(c.status)?await players(c.campaign_id,c.gm_id):[];return {campaign_id:c.campaign_id,name:c.name,gm_id:c.gm_id,status:c.status,version:c.version,mode:c.mode,player_ids:JSON.parse(c.recipients).filter((id:number)=>eligible.some((p:any)=>p.id===id)),players:eligible};}))});
 if(method!=='PUT')fail(405,'Метод не поддерживается.');
 if(Object.keys(payload).sort().join(',')!=='campaign_id,mode,player_ids,version')fail(400,'Проверь поля запроса.');
 if(!Number.isInteger(payload.campaign_id)||!Number.isInteger(payload.version)||payload.version<0||!['private','party','selected'].includes(payload.mode)||!Array.isArray(payload.player_ids)||payload.player_ids.length>30||payload.player_ids.some((v:any)=>!Number.isInteger(v)||v<=0))fail(400,'Проверь настройки доступа.');
 const c=campaigns.find((c:any)=>c.campaign_id===payload.campaign_id);
 if(!c||!['active','reserve'].includes(c.status))fail(403,'Настройки доступны после принятия персонажа в кампанию.');
 const eligible=await players(c.campaign_id,c.gm_id),selected=[...new Set<number>(payload.player_ids)].sort((a,b)=>a-b);
 if(selected.length!==payload.player_ids.length)fail(400,'Игроки в списке доступа не должны повторяться.');
 if(selected.some(id=>!eligible.some((p:any)=>p.id===id)))fail(400,'Выбери действующих игроков этой кампании.');
 const recipients=payload.mode==='selected'?selected:[],stamp=Math.floor(Date.now()/1000);
 const guard="EXISTS(SELECT 1 FROM characters c JOIN campaign_characters cc ON cc.character_id=c.id WHERE c.id=? AND c.owner_id=? AND cc.campaign_id=? AND cc.status IN ('active','reserve'))";
 const change=payload.version===0?
  db.prepare(`INSERT INTO character_sharing(character_id,campaign_id,mode,recipients,version,updated) SELECT ?,?,?,?,1,? WHERE ${guard} ON CONFLICT(character_id,campaign_id) DO NOTHING`).bind(id,c.campaign_id,payload.mode,JSON.stringify(recipients),stamp,id,user.id,c.campaign_id):
  db.prepare(`UPDATE character_sharing SET mode=?,recipients=?,version=version+1,updated=? WHERE character_id=? AND campaign_id=? AND version=? AND ${guard}`).bind(payload.mode,JSON.stringify(recipients),stamp,id,c.campaign_id,payload.version,id,user.id,c.campaign_id);
 const changed=await db.batch([change,db.prepare('UPDATE campaigns SET version=version+1,updated=? WHERE id=? AND changes()=1').bind(stamp,c.campaign_id)]);
 if(changed[0].meta.changes!==1)fail(409,'Доступ уже изменился. Обнови настройки и проверь выбранных игроков.');
 return json({ok:true,version:payload.version+1});
}
