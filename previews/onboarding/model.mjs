/** Pure, local-only onboarding preview. No fetch, auth, storage access or timers. */
import {STATS, STAT_LABELS, CORE_SKILLS, CREATION_ROLES, SKILL_BY_ID, MARTIAL_SKILL_IDS, GEAR_OPTIONS, GEAR_BY_ID, SALARY_TABLE, CASH_RULE, CREATION_STEPS, PREPARED_HEROES} from './data.mjs';
export * from './data.mjs';
export const SCHEMA_VERSION = 1;
export const CAREER_POINTS = 40;
export const DEFAULT_CONTEXT = Object.freeze({identityId:'demo-player',campaignId:'night-city-demo'});
export const SIMULATION_NOTICE = 'Локальная симуляция: ничего не отправляется на сервер или настоящему ведущему.';
const PLAYER_SCREENS = ['invitation','choose','create','review','lobby','scene','action'];
const HOST_SCREENS = ['hostSetup','hostReview','hostInvite','hostLobby'];
const SCREENS = [...PLAYER_SCREENS,'paths',...HOST_SCREENS];
const STEPS = CREATION_STEPS.map(step=>step.id);
const own = (obj,key) => Object.hasOwn(obj,key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value,limit=10000) => typeof value === 'string' ? value.slice(0,limit) : '';
const number = (value,fallback=null) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const integerIn = (value,min,max) => typeof value === 'number' && Number.isInteger(value) && value>=min && value<=max;
const clone = value => JSON.parse(JSON.stringify(value));
const cleanContext = context => ({identityId:text(context?.identityId,120)||DEFAULT_CONTEXT.identityId,campaignId:text(context?.campaignId,120)||DEFAULT_CONTEXT.campaignId});
const normalizedText = value => text(value).trim().normalize('NFKC').toLocaleLowerCase('ru');
const unique = array => [...new Set(array)];
export const storageKey = context => {const c=cleanContext(context);return `nc-crew-preview:v${SCHEMA_VERSION}:${encodeURIComponent(c.identityId)}:${encodeURIComponent(c.campaignId)}`;};
export function distributeStats(budget=60) {
  if(!integerIn(budget,18,90))throw new RangeError('Бюджет STAT: целое число от 18 до 90.');
  const base=Math.floor(budget/9),remainder=budget%9;
  return Object.fromEntries(STATS.map((id,index)=>[id,base+(index<remainder?1:0)]));
}
export function newDraft() {
  return {schemaVersion:SCHEMA_VERSION,name:'',roleId:'',budget:60,budgetConfirmed:true,
    budgetNote:'Учебная кампания: ведущий заранее утвердил 60 очков. Это не универсальный бюджет Core.',
    stats:distributeStats(60),careerRanks:{},careerDetails:{},soloCombat:'brawling',techChoices:['firstaid','security','weaponsmith'],pickup:[],
    nativeLanguage:'',history:'',historyLater:false,
    lifepath:{origin:'',style:'',family:'',motivation:'',contact:'',age:'',events:''},
    cash:{mode:'unresolved',salary:null,roleId:'',specialRank:null,cashRoll:null,employmentRoll:null,rounding:'core-months-down-min-one',manualAmount:null,manualConfirmed:false,stale:false,provenance:CASH_RULE.source},
    gear:[],gearSkipped:false};
}
/** Only known fields survive. Invalid numeric inputs stay invalid, never become valid silently. */
export function normalizeDraft(raw) {
  const base=newDraft();if(!record(raw))return base;
  const draft={...base};
  for(const key of ['name','roleId','budgetNote','soloCombat','nativeLanguage','history'])if(own(raw,key))draft[key]=text(raw[key]);
  if(own(raw,'budget'))draft.budget=number(raw.budget);
  for(const key of ['budgetConfirmed','historyLater','gearSkipped'])if(own(raw,key))draft[key]=raw[key]===true;
  if(record(raw.stats))for(const stat of STATS)if(own(raw.stats,stat))draft.stats[stat]=number(raw.stats[stat]);
  for(const key of ['careerRanks','careerDetails'])if(record(raw[key]))draft[key]=Object.fromEntries(Object.keys(SKILL_BY_ID).filter(id=>own(raw[key],id)).map(id=>[id,key==='careerRanks'?number(raw[key][id]):text(raw[key][id],1000)]));
  if(Array.isArray(raw.techChoices))draft.techChoices=raw.techChoices.slice(0,6).map(id=>text(id,100));
  if(Array.isArray(raw.pickup))draft.pickup=raw.pickup.slice(0,100).map(item=>({skillId:text(item?.skillId,100),rank:number(item?.rank),detail:text(item?.detail,1000)}));
  if(record(raw.lifepath))for(const key of Object.keys(draft.lifepath))draft.lifepath[key]=text(raw.lifepath[key],2000);
  if(record(raw.cash)){
    const c=raw.cash;draft.cash={mode:['unresolved','core','manual'].includes(c.mode)?c.mode:'unresolved',salary:number(c.salary),roleId:text(c.roleId,100),specialRank:number(c.specialRank),cashRoll:number(c.cashRoll),employmentRoll:number(c.employmentRoll),rounding:['unresolved','exact','down','nearest','up'].includes(c.rounding)?c.rounding:'core-months-down-min-one',manualAmount:number(c.manualAmount),manualConfirmed:c.manualConfirmed===true,stale:c.stale===true,provenance:CASH_RULE.source};
  }
  if(Array.isArray(raw.gear))draft.gear=raw.gear.slice(0,100).map(item=>({itemId:text(item?.itemId,100),quantity:number(item?.quantity),installed:item?.installed===true,humanityLoss:number(item?.humanityLoss),installationConfirmed:item?.installationConfirmed===true}));
  if(draft.cash.mode==='core'&&(draft.cash.roleId!==draft.roleId||draft.cash.specialRank!==specialRank(draft)))draft.cash.stale=true;
  return draft;
}
export const selectedRole = draft => CREATION_ROLES.find(role=>role.id===draft.roleId);
export function careerSkillIds(draft) {const role=selectedRole(draft);return role?[role.ability.id,...role.career.map(id=>id==='$combat'?draft.soloCombat:id.startsWith('$tech')?draft.techChoices[Number(id.slice(-1))-1]||'':id)].filter(Boolean):[];}
export const specialRank = draft => draft.careerRanks[selectedRole(draft)?.ability.id]??0;
export const statTotal = draft => STATS.reduce((sum,id)=>sum+(typeof draft.stats[id]==='number'?draft.stats[id]:NaN),0);
export const careerSpent = draft => careerSkillIds(draft).reduce((sum,id)=>sum+(own(draft.careerRanks,id)?typeof draft.careerRanks[id]==='number'?draft.careerRanks[id]:NaN:0),0);
export const pickupBudget = draft => typeof draft.stats.INT==='number'&&typeof draft.stats.REF==='number'?draft.stats.INT+draft.stats.REF:NaN;
export const pickupSpent = draft => draft.pickup.reduce((sum,item)=>sum+(typeof item.rank==='number'?item.rank:NaN),0);
export const availablePickupSkills = draft => {const career=new Set(careerSkillIds(draft));return CORE_SKILLS.filter(skill=>!career.has(skill.id));};
export const techChoiceSkills = draft => {const fixed=new Set(CREATION_ROLES.find(role=>role.id==='techie').career.filter(id=>!id.startsWith('$')));return CORE_SKILLS.filter(skill=>skill.stat==='TECH'&&!fixed.has(skill.id));};
export function salaryFor(roleId,rank){const role=CREATION_ROLES.find(role=>role.id===roleId);if(!role||!integerIn(rank,1,10))return null;return SALARY_TABLE[role.english][rank<=5?0:rank-5];}
/** Deliberate user action captures the role, SA rank and BOTH independent rolls. */
export function quoteCash(draft,{cashRoll,employmentRoll,rounding='core-months-down-min-one'}={}) {
  return {mode:'core',salary:salaryFor(draft.roleId,specialRank(draft)),roleId:draft.roleId,specialRank:specialRank(draft),cashRoll:number(cashRoll),employmentRoll:number(employmentRoll),rounding,manualAmount:null,manualConfirmed:false,stale:false,provenance:CASH_RULE.source};
}
export function cashQuote(draft) {
  const c=draft.cash,base={amount:null,numerator:null,denominator:1,formatted:'Не согласовано',salary:c.salary,unemployed:null,stale:c.stale,source:CASH_RULE.source};
  if(c.mode==='manual')return {...base,amount:integerIn(c.manualAmount,0,1e12)&&c.manualConfirmed?c.manualAmount:null,numerator:c.manualAmount,formatted:c.manualAmount===null?'Не согласовано':`${c.manualAmount} eb`,manual:true};
  if(c.mode!=='core'||c.stale||c.roleId!==draft.roleId||c.specialRank!==specialRank(draft)||c.salary!==salaryFor(draft.roleId,specialRank(draft))||!integerIn(c.cashRoll,1,6)||!integerIn(c.employmentRoll,1,6)||c.salary===null)return base;
  if(CASH_RULE.status!=='verified')return {...base,formatted:'Порядок округления уточняется',unemployed:c.employmentRoll>4};
  // Core p.25 applies to the month factor from p.59, before multiplying salary.
  const months=Math.max(1,Math.floor(c.cashRoll/3)),amount=c.salary*months;
  return {...base,amount,numerator:amount,denominator:1,months,formatted:`${amount} eb`,unemployed:c.employmentRoll>4,rounding:'core-months-down-min-one'};
}
export const gearTotal = draft => draft.gear.reduce((sum,item)=>{const price=GEAR_BY_ID[item.itemId]?.price.value;return sum+(typeof price==='number'&&integerIn(item.quantity,1,99)?price*item.quantity:NaN);},0);
export const remainingCash = draft => {const amount=cashQuote(draft).amount;return amount===null?null:amount-gearTotal(draft);};
export function humanitySummary(draft) {const originalEMP=draft.stats.EMP,initial=typeof originalEMP==='number'?originalEMP*10:null;const totalLoss=draft.gear.reduce((sum,item)=>sum+(item.installed&&GEAR_BY_ID[item.itemId]?.category==='cyber'&&typeof item.humanityLoss==='number'?item.humanityLoss*item.quantity:0),0);return {initial,totalLoss,remaining:initial===null?null:initial-totalLoss,currentEMP:initial===null?null:originalEMP-Math.floor(totalLoss/10)};}
export function validHumanityLoss(entry,loss){const formula=String(entry?.facts?.humanityLoss??'');if(/^\d+(\.\d+)?$/.test(formula))return loss===Number(formula);const dice=formula.match(/^(\d+)D6(?:\/(\d+))?$/i);if(!dice||typeof loss!=='number')return false;const count=Number(dice[1]),div=Number(dice[2]||1);return integerIn(loss*div,count,count*6);}
const safeTotal = value => Number.isFinite(value)?value:'есть пустое значение';
export function validateStep(input,step) {
  const d=normalizeDraft(input),errors=[],role=selectedRole(d),ids=careerSkillIds(d);
  if(typeof step==='number')step=STEPS[step]??(step===6?'review':step);
  if(step==='identity'){
    if(!d.name.trim()||d.name.length>80)errors.push('Введи имя персонажа от 1 до 80 символов.');
    if(!role)errors.push('Выбери одну из десяти ролей Core.');
  }else if(step==='stats'){
    if(!integerIn(d.budget,18,90))errors.push('Бюджет STAT должен быть целым от 18 до 90.');
    if(!d.budgetConfirmed)errors.push('Ведущий должен утвердить бюджет STAT.');
    for(const stat of STATS)if(!integerIn(d.stats[stat],2,10))errors.push(`${stat} (${STAT_LABELS[stat]}): целое значение от 2 до 10.`);
    if(statTotal(d)!==d.budget)errors.push(`Распредели ровно ${d.budget} очков STAT; сейчас ${safeTotal(statTotal(d))}.`);
  }else if(step==='career'){
    if(!role)errors.push('Сначала выбери роль.');
    if(role?.id==='solo'&&!['brawling',...MARTIAL_SKILL_IDS].includes(d.soloCombat))errors.push('Соло: выбери драку или один стиль боевых искусств.');
    if(role?.id==='techie'){
      const allowed=new Set(techChoiceSkills(d).map(skill=>skill.id));
      if(d.techChoices.length!==3||new Set(d.techChoices).size!==3||d.techChoices.some(id=>!allowed.has(id)))errors.push('Техник: выбери три разных TECH-навыка вне фиксированного карьерного набора.');
    }
    if(ids.length!==10||new Set(ids).size!==10)errors.push('Карьерный набор: Special Ability и девять разных навыков.');
    for(const id of ids){const skill=SKILL_BY_ID[id],rank=own(d.careerRanks,id)?d.careerRanks[id]:0;if(!skill){errors.push('Неизвестный карьерный навык.');continue;}if(!integerIn(rank,0,10))errors.push(`${skill.name}: ранг от 0 до 10.`);if(rank>0&&skill.detailLabel&&!d.careerDetails[id]?.trim())errors.push(`${skill.name}: укажи «${skill.detailLabel}».`);if((d.careerDetails[id]??'').length>60)errors.push(`${skill.name}: уточнение до 60 символов.`);}
    if(careerSpent(d)!==CAREER_POINTS)errors.push(`Распредели ровно 40 Career Points; сейчас ${safeTotal(careerSpent(d))}.`);
  }else if(step==='pickup'){
    if(d.pickup.length>30)errors.push('Не больше 30 дополнительных навыков.');const seen=new Set();
    for(const item of d.pickup){const skill=SKILL_BY_ID[item.skillId];if(!skill||skill.special){errors.push('Выбери обычный навык Core.');continue;}if(ids.includes(item.skillId))errors.push(`${skill.name}: нельзя тратить Pickup Points на Career Skill.`);if(!integerIn(item.rank,1,10))errors.push(`${skill.name}: ранг от 1 до 10.`);if(skill.detailLabel&&!item.detail.trim())errors.push(`${skill.name}: укажи «${skill.detailLabel}».`);if(item.detail.length>60)errors.push(`${skill.name}: уточнение до 60 символов.`);const identity=item.skillId+'|'+(skill.detailLabel?normalizedText(item.detail):'');if(seen.has(identity))errors.push(`${skill.name}: одинаковый навык добавлен дважды.`);seen.add(identity);if(item.skillId==='language'&&normalizedText(item.detail)===normalizedText(d.nativeLanguage)&&d.nativeLanguage.trim())errors.push('Родной язык уже даётся на +8 без Pickup Points.');}
    if(pickupSpent(d)!==pickupBudget(d))errors.push(`Распредели ровно INT + REF = ${safeTotal(pickupBudget(d))} Pickup Points; сейчас ${safeTotal(pickupSpent(d))}.`);
  }else if(step==='lifepath'){
    if(!d.nativeLanguage.trim()||d.nativeLanguage.length>60)errors.push('Укажи родной язык от 1 до 60 символов: он даётся на +8.');
    if(d.history.length>6000)errors.push('Предыстория: не больше 6000 символов.');
    if(!d.history.trim()&&!Object.values(d.lifepath).some(value=>value.trim())&&!d.historyLater)errors.push('Добавь основу истории или явно выбери «Допишу позже».');
    if(d.pickup.some(item=>item.skillId==='language'&&normalizedText(item.detail)===normalizedText(d.nativeLanguage)&&d.nativeLanguage.trim()))errors.push('Родной язык уже даётся на +8; перераспредели Pickup Points.');
  }else if(step==='gear'){
    const quote=cashQuote(d),total=gearTotal(d);
    if(d.cash.mode==='unresolved')errors.push('Выбери способ определения стартовых денег.');
    else if(d.cash.mode==='manual'&&(!d.cash.manualConfirmed||!integerIn(d.cash.manualAmount,0,1e12)))errors.push('Укажи целую сумму от 0 до 1 000 000 000 000 eb и подтверди согласование с ведущим.');
    else if(d.cash.mode==='core'){
      if(d.cash.stale)errors.push('Роль или Special Ability изменились: пересчитай деньги явным действием.');
      if(d.cash.salary===null||specialRank(d)===0)errors.push('Для Special Ability 0 таблица не задаёт оклад: согласуй сумму с ведущим.');
      if(!integerIn(d.cash.cashRoll,1,6)||!integerIn(d.cash.employmentRoll,1,6))errors.push('Нужны два отдельных результата d6 от 1 до 6: деньги и занятость.');
      if(CASH_RULE.status!=='verified')errors.push(CASH_RULE.note);
      if(quote.amount===null)errors.push('Расчёт денег не завершён.');
    }
    if(!d.gear.length&&!d.gearSkipped)errors.push('Выбери вещи или явно отложи покупки.');
    if(d.gear.length&&d.gearSkipped)errors.push('Нельзя одновременно выбрать вещи и отметить, что покупки отложены.');
    const seen=new Set();for(const item of d.gear){const entry=GEAR_BY_ID[item.itemId];if(!entry){errors.push('В списке есть неизвестная вещь.');continue;}if(seen.has(item.itemId))errors.push(`${entry.label}: используй количество вместо дублирования.`);seen.add(item.itemId);if(!integerIn(item.quantity,1,99))errors.push(`${entry.label}: количество от 1 до 99.`);if(entry.category==='cyber'&&item.quantity!==1)errors.push(`${entry.label}: в учебном наборе один имплант такого вида.`);if(item.installed){if(entry.category!=='cyber')errors.push('Отметка установки относится только к кибернетике.');else {if(!item.installationConfirmed)errors.push(`${entry.label}: согласуй установку с ведущим.`);if(!validHumanityLoss(entry,item.humanityLoss))errors.push(`${entry.label}: внеси согласованную потерю Humanity (${entry.facts.humanityLoss}).`);}}}
    if(quote.amount!==null&&Number.isFinite(total)&&total>quote.amount)errors.push(`Не хватает денег: вещи стоят ${total} eb, доступно ${quote.formatted}.`);
    if(humanitySummary(d).currentEMP<=0&&d.gear.some(item=>item.installed))errors.push('EMP ≤ 0: требуется отдельное решение ведущего; учебный лист пока не готов.');
  }else if(step==='review')for(const id of STEPS)errors.push(...validateStep(d,id));else errors.push('Неизвестный шаг.');
  return unique(errors);
}
export const validateDraft = draft => validateStep(draft,'review');
export function prepareHero(id) {
  if(!PREPARED_HEROES.some(hero=>hero.id===id))return newDraft();
  const d=newDraft();d.name=id==='ray'?'Рэй':'Вега';d.roleId=id==='ray'?'solo':'techie';d.nativeLanguage='Английский';
  d.stats=id==='ray'?{INT:6,REF:9,TECH:5,COOL:7,ATTR:5,LUCK:6,MA:7,BODY:8,EMP:7}:{INT:8,REF:6,TECH:9,COOL:6,ATTR:5,LUCK:6,MA:6,BODY:7,EMP:7};
  d.careerRanks=id==='ray'?{'combat-sense':6,notice:5,handgun:6,brawling:4,melee:2,weaponsmith:2,rifle:5,athletics:4,smg:3,stealth:3}:{'jury-rig':6,notice:4,basictech:6,cybertech:5,teaching:1,education:3,electronics:6,firstaid:3,security:3,weaponsmith:3};
  d.pickup=(id==='ray'?[['driving',5],['streetwise',4],['firstaid',3],['perception',3]]:[['handgun',4],['driving',4],['streetwise',3],['persuasion',3]]).map(([skillId,rank])=>({skillId,rank,detail:''}));
  d.history=id==='ray'?'Бывший охранник каравана. Ищет пропавшего напарника и старается никого не бросать.':'Техник из маленькой мастерской. Ищет редкую деталь и бережёт людей, которые доверяют её работе.';
  d.lifepath.origin=id==='ray'?'Кочевой караван':'Найт-Сити';d.lifepath.motivation=id==='ray'?'Вернуть напарника':'Сохранить мастерскую';d.lifepath.contact=id==='ray'?'Джун, механик каравана':'Марко, сосед по мастерской';d.lifepath.age='27';
  d.cash=quoteCash(d,{cashRoll:3,employmentRoll:2});
  d.gear=(id==='ray'?['core-militech-arms-avenger','core-light-armor-jacket','core-first-aid-kit']:['core-tech-toolkit','core-electronics-toolkit','core-first-aid-kit']).map(itemId=>({itemId,quantity:1,installed:false,humanityLoss:null,installationConfirmed:false}));
  return d;
}
function emptyLobby(){return {application:'none',ready:false,scenePrepared:false,turn:'waiting'};}
function emptyAction(){return {kind:'move',status:'idle',from:{x:1,y:2},to:null,position:{x:1,y:2}};}
// Additive v1 fields preserve the 0.1.1 storage key and every player draft/receipt.
export function newHostDraft(){return {name:'',premise:'',budget:60};}
function normalizeHost(raw){const draft=record(raw?.draft)?raw.draft:{};return {draft:{name:own(draft,'name')?text(draft.name,10000):'',premise:own(draft,'premise')?text(draft.premise,10000):'',budget:own(draft,'budget')?number(draft.budget):60},invitationPrepared:raw?.invitationPrepared===true,lobbyEntered:raw?.lobbyEntered===true,playerSimulated:raw?.playerSimulated===true};}
export function validateHost(draft){const errors=[];if(!draft.name.trim()||draft.name.length>80)errors.push('Назови кампанию: от 1 до 80 символов.');if(!draft.premise.trim()||draft.premise.length>1200)errors.push('Добавь завязку: от 1 до 1200 символов.');if(!integerIn(draft.budget,18,90))errors.push('Бюджет STAT: целое число от 18 до 90, по решению ведущего.');return errors;}
function safeLocation(s,location){
  let screen=location.screen,step=STEPS.includes(location.step)?location.step:'identity';
  if(PLAYER_SCREENS.includes(screen)){
    if(!s.invitationAccepted)screen='invitation';
    else if(['lobby','scene','action'].includes(screen)&&(!s.savedSignature||s.lobby.application==='none'))screen='review';
    else if(['scene','action'].includes(screen)&&!s.lobby.scenePrepared)screen='lobby';
    else if(screen==='action'&&s.lobby.turn!=='active')screen='scene';
  }else if(HOST_SCREENS.includes(screen)){
    if(validateHost(s.host.draft).length)screen='hostSetup';
    else if(['hostInvite','hostLobby'].includes(screen)&&!s.host.invitationPrepared)screen='hostReview';
    else if(screen==='hostLobby'&&!s.host.lobbyEntered)screen='hostInvite';
  }else screen='invitation';
  return {screen,step};
}
function rememberLocation(s){if(PLAYER_SCREENS.includes(s.screen))s.playerLocation={screen:s.screen,step:s.step};else if(HOST_SCREENS.includes(s.screen))s.hostScreen=s.screen;}
function openPaths(s){rememberLocation(s);if(s.screen!=='paths')s.pathOrigin={screen:s.screen,step:s.step};s.screen='paths';}
export function newSession(context={}) {return {schemaVersion:SCHEMA_VERSION,guide:{preference:'unanswered',collapsed:false},rolePicker:{mode:'cards',previewRoleId:CREATION_ROLES[0].id},flow:'player',playerLocation:{screen:'invitation',step:'identity'},hostScreen:'hostSetup',pathOrigin:null,host:normalizeHost(null),...cleanContext(context),screen:'invitation',step:'identity',invitationAccepted:false,activeDraftKey:'new',newDraftNumber:1,draft:newDraft(),drafts:{},savedHeroes:[],unlockedStep:0,savedSignature:null,lobby:emptyLobby(),firstAction:emptyAction(),resetPending:false,revision:0,errors:[]};}
const signature = draft => JSON.stringify(normalizeDraft(draft));
export function normalizeSession(raw,context=raw) {
  const base=newSession(context);if(!record(raw)||raw.schemaVersion!==SCHEMA_VERSION||raw.identityId!==base.identityId||raw.campaignId!==base.campaignId)return base;
  const s={...base};s.invitationAccepted=raw.invitationAccepted===true;s.screen=SCREENS.includes(raw.screen)?raw.screen:'invitation';s.step=STEPS.includes(raw.step)?raw.step:'identity';s.activeDraftKey=/^(new|ray|vega|saved-[a-z0-9-]+|archived-[0-9]+)$/.test(raw.activeDraftKey)?raw.activeDraftKey:'new';s.newDraftNumber=integerIn(raw.newDraftNumber,1,1e9)?raw.newDraftNumber:1;s.draft=raw.draft?.schemaVersion===SCHEMA_VERSION?normalizeDraft(raw.draft):newDraft();s.unlockedStep=integerIn(raw.unlockedStep,0,6)?raw.unlockedStep:0;s.revision=integerIn(raw.revision,0,1e9)?raw.revision:0;
  if(record(raw.drafts))for(const key of Object.keys(raw.drafts).slice(0,30))if(/^(new|ray|vega|saved-[a-z0-9-]+|archived-[0-9]+)$/.test(key)&&raw.drafts[key]?.schemaVersion===SCHEMA_VERSION)s.drafts[key]=normalizeDraft(raw.drafts[key]);
  if(Array.isArray(raw.savedHeroes))s.savedHeroes=raw.savedHeroes.slice(0,30).filter(item=>record(item)&&/^saved-[a-z0-9-]+$/.test(item.id)&&item.draft?.schemaVersion===SCHEMA_VERSION).map(item=>({id:item.id,name:text(item.name,80),draft:normalizeDraft(item.draft)})).filter(item=>!validateDraft(item.draft).length);
  if(typeof raw.savedSignature==='string'&&raw.savedSignature===signature(s.draft)&&!validateDraft(s.draft).length)s.savedSignature=raw.savedSignature;
  if(s.savedSignature&&record(raw.lobby)&&['none','pending','accepted'].includes(raw.lobby.application)){
    s.lobby.application=raw.lobby.application;s.lobby.ready=raw.lobby.application==='accepted'&&raw.lobby.ready===true;s.lobby.scenePrepared=s.lobby.ready&&raw.lobby.scenePrepared===true;s.lobby.turn=s.lobby.scenePrepared&&raw.lobby.turn==='active'?'active':'waiting';
  }
  if(s.lobby.turn==='active'&&record(raw.firstAction)){
    const action=raw.firstAction;const point=p=>record(p)&&integerIn(p.x,0,5)&&integerIn(p.y,0,4)?{x:p.x,y:p.y}:null;
    s.firstAction.from=point(action.from)||{x:1,y:2};s.firstAction.to=point(action.to);s.firstAction.status=['idle','declared','preview','submitted','confirmed'].includes(action.status)&&((action.status==='idle')||s.firstAction.to)?action.status:'idle';s.firstAction.position=s.firstAction.status==='confirmed'?s.firstAction.to:s.firstAction.from;
  }
  s.rolePicker={mode:raw.rolePicker?.mode==='list'?'list':'cards',previewRoleId:CREATION_ROLES.some(r=>r.id===raw.rolePicker?.previewRoleId)?raw.rolePicker.previewRoleId:CREATION_ROLES.some(r=>r.id===s.draft.roleId)?s.draft.roleId:CREATION_ROLES[0].id};
  s.guide={preference:['enabled','skipped','familiar'].includes(raw.guide?.preference)?raw.guide.preference:'unanswered',collapsed:raw.guide?.collapsed===true};
  s.flow=raw.flow==='host'?'host':'player';
  s.playerLocation={screen:PLAYER_SCREENS.includes(raw.playerLocation?.screen)?raw.playerLocation.screen:'invitation',step:STEPS.includes(raw.playerLocation?.step)?raw.playerLocation.step:'identity'};
  s.host=normalizeHost(raw.host);s.hostScreen=HOST_SCREENS.includes(raw.hostScreen)?raw.hostScreen:'hostSetup';
  if(validateHost(s.host.draft).length){s.host.invitationPrepared=false;s.host.lobbyEntered=false;s.host.playerSimulated=false;if(s.hostScreen!=='hostSetup')s.hostScreen='hostSetup';if(HOST_SCREENS.includes(s.screen))s.screen='hostSetup';}
  if(!s.host.invitationPrepared){s.host.lobbyEntered=false;s.host.playerSimulated=false;if(['hostInvite','hostLobby'].includes(s.hostScreen))s.hostScreen='hostReview';if(['hostInvite','hostLobby'].includes(s.screen))s.screen='hostReview';}
  if(!s.host.lobbyEntered){s.host.playerSimulated=false;if(s.hostScreen==='hostLobby')s.hostScreen='hostInvite';if(s.screen==='hostLobby')s.screen='hostInvite';}
  if(record(raw.pathOrigin)&&SCREENS.includes(raw.pathOrigin.screen)&&raw.pathOrigin.screen!=='paths')s.pathOrigin={screen:raw.pathOrigin.screen,step:STEPS.includes(raw.pathOrigin.step)?raw.pathOrigin.step:'identity'};
  if(PLAYER_SCREENS.includes(s.screen)&&!s.invitationAccepted)s.screen='invitation';
  else if(['lobby','scene','action'].includes(s.screen)&&(!s.savedSignature||s.lobby.application==='none'))s.screen='review';
  else if(['scene','action'].includes(s.screen)&&!s.lobby.scenePrepared)s.screen='lobby';
  else if(s.screen==='action'&&s.lobby.turn!=='active')s.screen='scene';
  s.playerLocation=safeLocation(s,s.playerLocation);if(s.pathOrigin)s.pathOrigin=safeLocation(s,s.pathOrigin);
  if(HOST_SCREENS.includes(s.screen))s.flow='host';else if(PLAYER_SCREENS.includes(s.screen))s.flow='player';
  rememberLocation(s);
  return s;
}
export function serializeSession(state) {const normalized=normalizeSession(state,state);normalized.drafts[normalized.activeDraftKey]=normalizeDraft(normalized.draft);return JSON.stringify(normalized);}
export function restoreSession(serialized,context={}) {
  const fallback=reason=>({state:newSession(context),recovered:false,reason});
  if(serialized===null||serialized===undefined||serialized==='')return fallback('empty');
  if(typeof serialized!=='string'||serialized.length>1_000_000)return fallback('invalid-storage');
  let raw;try{raw=JSON.parse(serialized);}catch{return fallback('invalid-json');}
  if(!record(raw)||raw.schemaVersion!==SCHEMA_VERSION)return fallback('unsupported-schema');
  const c=cleanContext(context);if(raw.identityId!==c.identityId||raw.campaignId!==c.campaignId)return fallback('context-mismatch');
  return {state:normalizeSession(raw,c),recovered:true,reason:null};
}
function mergeDraft(draft,patch) {
  if(!record(patch))return normalizeDraft(draft);const merged={...draft};
  for(const key of Object.keys(newDraft()))if(own(patch,key))merged[key]=['stats','careerRanks','careerDetails','lifepath','cash'].includes(key)&&record(patch[key])?{...draft[key],...patch[key]}:patch[key];
  const next=normalizeDraft(merged);if(draft.cash.mode==='core'&&(next.roleId!==draft.roleId||specialRank(next)!==specialRank(draft)))next.cash.stale=true;return next;
}
function invalidate(s) {s.savedSignature=null;s.lobby=emptyLobby();s.firstAction=emptyAction();if(['lobby','scene','action'].includes(s.screen))s.screen='review';}
function saveSlot(s){s.drafts[s.activeDraftKey]=clone(s.draft);}
/** Explicit actions model all network/GM transitions. Invalid transitions return errors without advancing. */
export function reduceSession(state,action={}) {
  const s=normalizeSession(state,state);s.errors=[];s.resetPending=state.resetPending===true;
  const reject=(...errors)=>({...s,errors:errors.flat()});
  const requireSaved=()=>s.savedSignature===signature(s.draft)&&!validateDraft(s.draft).length;
  switch(action.type){
    case 'ROLE_PICKER_MODE':
      if(!['cards','list'].includes(action.mode))return reject('Выбери вид ролей.');
      s.rolePicker.mode=action.mode;break;
    case 'PREVIEW_ROLE':
      if(!CREATION_ROLES.some(r=>r.id===action.roleId))return reject('Выбери одну из десяти ролей Core.');
      s.rolePicker.previewRoleId=action.roleId;break;
    case 'GUIDE_REPLY':
      if(!['enabled','skipped','familiar'].includes(action.preference))return reject('Выбери ответ Анри.');
      s.guide={preference:action.preference,collapsed:false};if(action.preference==='enabled')openPaths(s);break;
    case 'GUIDE_REPLAY':s.guide={preference:'unanswered',collapsed:false};break;
    case 'GUIDE_TOGGLE':s.guide={preference:s.guide.preference==='enabled'?'skipped':'enabled',collapsed:false};break;
    case 'GUIDE_COLLAPSE':s.guide.collapsed=!s.guide.collapsed;break;
    case 'OPEN_PATHS':openPaths(s);break;
    case 'SELECT_FLOW':
      if(!['host','player'].includes(action.flow))return reject('Выбери: ведущий или игрок.');
      rememberLocation(s);s.flow=action.flow;
      if(s.flow==='host')s.screen=s.hostScreen;else {s.screen=s.playerLocation.screen;s.step=s.playerLocation.step;}break;
    case 'PATCH_HOST':{
      if(s.flow!=='host')return reject('Сначала открой путь ведущего.');
      const next=normalizeHost({draft:{...s.host.draft,...(record(action.patch)?action.patch:{})}}).draft;
      if(JSON.stringify(next)!==JSON.stringify(s.host.draft)){s.host={draft:next,invitationPrepared:false,lobbyEntered:false,playerSimulated:false};s.screen='hostSetup';s.hostScreen='hostSetup';}break;
    }
    case 'REVIEW_HOST':{if(s.flow!=='host')return reject('Сначала открой путь ведущего.');const errors=validateHost(s.host.draft);if(errors.length)return reject(errors);s.screen='hostReview';break;}
    case 'PREPARE_HOST_INVITE':{if(s.flow!=='host'||s.screen!=='hostReview')return reject('Сначала проверь учебную кампанию.');const errors=validateHost(s.host.draft);if(errors.length)return reject(errors);s.host.invitationPrepared=true;s.screen='hostInvite';break;}
    case 'OPEN_HOST_LOBBY':if(s.flow!=='host'||!s.host.invitationPrepared)return reject('Сначала подготовь учебное приглашение.');s.host.lobbyEntered=true;s.screen='hostLobby';break;
    case 'SIMULATE_HOST_PLAYER':if(s.flow!=='host'||s.screen!=='hostLobby'||!s.host.lobbyEntered)return reject('Сначала открой учебное лобби.');s.host.playerSimulated=true;break;
    case 'ACCEPT_INVITE':s.invitationAccepted=true;s.screen='choose';break;
    case 'OPEN_CHOOSER':if(!s.invitationAccepted)return reject('Сначала прими учебное приглашение.');saveSlot(s);s.screen='choose';break;
    case 'NEW_DRAFT':{
      if(!s.invitationAccepted)return reject('Сначала прими учебное приглашение.');
      if(action.confirmed!==true)return reject('Подтверди начало нового черновика.');
      saveSlot(s);if(s.drafts.new)s.drafts[`archived-${s.revision}`]=clone(s.drafts.new);
      s.newDraftNumber+=1;s.activeDraftKey='new';s.draft=newDraft();s.rolePicker.previewRoleId=CREATION_ROLES[0].id;s.drafts.new=clone(s.draft);s.screen='create';s.step='identity';s.unlockedStep=0;invalidate(s);break;
    }
    case 'CHOOSE_HERO':{
      if(!s.invitationAccepted)return reject('Сначала прими учебное приглашение.');
      const id=action.heroId;if(!['new','ray','vega'].includes(id)&&!s.savedHeroes.some(hero=>hero.id===id)&&!(/^archived-[0-9]+$/.test(id)&&own(s.drafts,id)))return reject('Выбери существующий учебный лист.');
      saveSlot(s);s.activeDraftKey=id;s.draft=s.drafts[id]?clone(s.drafts[id]):['ray','vega'].includes(id)?prepareHero(id):id==='new'?newDraft():clone(s.savedHeroes.find(hero=>hero.id===id).draft);s.rolePicker.previewRoleId=s.draft.roleId||CREATION_ROLES[0].id;s.screen=id==='new'||id.startsWith('archived-')?'create':'review';s.step='identity';const firstInvalid=STEPS.findIndex(step=>validateStep(s.draft,step).length);s.unlockedStep=firstInvalid<0?6:firstInvalid;invalidate(s);break;
    }
    case 'PATCH_DRAFT':{
      if(!s.invitationAccepted)return reject('Сначала прими учебное приглашение.');
      const d=mergeDraft(s.draft,action.patch);if(signature(d)!==signature(s.draft)){if(d.roleId!==s.draft.roleId&&CREATION_ROLES.some(r=>r.id===d.roleId))s.rolePicker.previewRoleId=d.roleId;s.draft=d;invalidate(s);saveSlot(s);}break;
    }
    case 'QUOTE_CASH':if(!s.invitationAccepted)return reject('Сначала прими учебное приглашение.');s.draft=mergeDraft(s.draft,{cash:quoteCash(s.draft,action)});invalidate(s);saveSlot(s);break;
    case 'GO_STEP':{
      const index=STEPS.indexOf(action.step);if(index<0)return reject('Неизвестный шаг.');
      if(!s.invitationAccepted)return reject('Сначала прими учебное приглашение.');
      if(index>s.unlockedStep)return reject('Сначала заверши предыдущие шаги.');s.step=action.step;s.screen='create';break;
    }
    case 'NEXT':{
      if(s.screen==='invitation')return reject('Прими приглашение, чтобы продолжить.');
      if(s.screen!=='create')return reject('Выбери героя или шаг создания.');
      const errors=validateStep(s.draft,s.step);if(errors.length)return reject(errors);const index=STEPS.indexOf(s.step);s.unlockedStep=Math.max(s.unlockedStep,index+1);if(index===STEPS.length-1)s.screen='review';else s.step=STEPS[index+1];break;
    }
    case 'BACK':
      if(s.screen==='paths'){const origin=s.pathOrigin||s.playerLocation;s.screen=origin.screen;s.step=origin.step;}
      else if(s.screen==='hostSetup')openPaths(s);
      else if(s.screen==='hostReview')s.screen='hostSetup';
      else if(s.screen==='hostInvite')s.screen='hostReview';
      else if(s.screen==='hostLobby')s.screen='hostInvite';
      else if(s.screen==='create'){const index=STEPS.indexOf(s.step);if(index>0)s.step=STEPS[index-1];else s.screen='choose';}
      else if(s.screen==='review'){s.screen='create';s.step='gear';s.unlockedStep=6;}
      else if(s.screen==='choose')s.screen='invitation';
      else if(s.screen==='lobby')s.screen='review';
      else if(s.screen==='scene')s.screen='lobby';
      else if(s.screen==='action')s.screen='scene';break;
    case 'SAVE_HERO':{
      if(!s.invitationAccepted)return reject('Сначала прими учебное приглашение.');const errors=validateDraft(s.draft);if(errors.length)return reject(errors);
      const id=s.activeDraftKey.startsWith('saved-')?s.activeDraftKey:s.activeDraftKey==='new'?`saved-new-${s.newDraftNumber}`:`saved-${s.activeDraftKey}`;const entry={id,name:s.draft.name.trim(),draft:clone(s.draft)};s.savedHeroes=[...s.savedHeroes.filter(hero=>hero.id!==id),entry];s.savedSignature=signature(s.draft);s.screen='review';saveSlot(s);break;
    }
    case 'APPLY_TO_CAMPAIGN':
      if(!requireSaved())return reject('Сначала исправь и сохрани проверенный лист.');
      if(s.lobby.application==='none')s.lobby.application='pending';s.screen='lobby';break;
    case 'SIMULATE_ACCEPT':if(s.lobby.application!=='pending'||!requireSaved())return reject('Сначала отправь учебную заявку.');s.lobby.application='accepted';break;
    case 'TOGGLE_READY':if(s.lobby.application!=='accepted')return reject('Дождись принятия заявки ведущим.');s.lobby.ready=!s.lobby.ready;s.lobby.scenePrepared=false;s.lobby.turn='waiting';s.firstAction=emptyAction();s.screen='lobby';break;
    case 'SIMULATE_PREPARE_SCENE':if(s.lobby.application!=='accepted'||!s.lobby.ready)return reject('Лист должен быть принят, а игрок готов.');s.lobby.scenePrepared=true;s.screen='scene';break;
    case 'SIMULATE_START_TURN':if(!s.lobby.scenePrepared||!s.lobby.ready)return reject('Сначала ведущий должен подготовить сцену.');s.lobby.turn='active';s.screen='action';break;
    case 'DECLARE_ACTION':{
      if(s.lobby.turn!=='active')return reject('Сначала дождись своего учебного хода.');
      if(['submitted','confirmed'].includes(s.firstAction.status))return reject('Эта заявка уже отправлена.');
      if(action.kind!=='move'||!integerIn(action.x,0,5)||!integerIn(action.y,0,4))return reject('Выбери клетку на учебной карте.');
      if(action.x===s.firstAction.position.x&&action.y===s.firstAction.position.y)return reject('Выбери другую клетку.');
      s.firstAction={...s.firstAction,kind:'move',from:{...s.firstAction.position},to:{x:action.x,y:action.y},status:'declared'};s.screen='action';break;
    }
    case 'PREVIEW_ACTION':if(s.firstAction.status!=='declared')return reject('Сначала выбери действие и цель.');s.firstAction.status='preview';break;
    case 'SEND_ACTION':if(s.firstAction.status!=='preview')return reject('Сначала проверь предварительный просмотр.');s.firstAction.status='submitted';break;
    case 'SIMULATE_CONFIRM_ACTION':if(s.firstAction.status!=='submitted')return reject('Сначала отправь учебную заявку ведущему.');s.firstAction.status='confirmed';s.firstAction.position={...s.firstAction.to};break;
    case 'REQUEST_RESET':s.resetPending=true;break;
    case 'CANCEL_RESET':s.resetPending=false;break;
    case 'CONFIRM_RESET':if(!s.resetPending)return reject('Сначала запроси и подтверди сброс.');return newSession(s);
    default:return reject('Неизвестное действие.');
  }
  rememberLocation(s);if(HOST_SCREENS.includes(s.screen))s.flow='host';else if(PLAYER_SCREENS.includes(s.screen))s.flow='player';
  s.revision+=1;return s;
}
