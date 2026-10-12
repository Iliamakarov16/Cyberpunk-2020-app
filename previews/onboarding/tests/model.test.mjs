import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as M from '../model.mjs';
const context={identityId:'tester-a',campaignId:'demo-a'};
const act=(state,type,payload={})=>M.reduceSession(state,{type,...payload});
const accepted=()=>act(M.newSession(context),'ACCEPT_INVITE');
const chosen=(heroId='ray')=>act(accepted(),'CHOOSE_HERO',{heroId});
const saved=()=>act(chosen(),'SAVE_HERO');
const joined=()=>act(act(saved(),'APPLY_TO_CAMPAIGN'),'SIMULATE_ACCEPT');
const active=()=>act(act(act(joined(),'TOGGLE_READY'),'SIMULATE_PREPARE_SCENE'),'SIMULATE_START_TURN');
const roundtrip=state=>M.restoreSession(M.serializeSession(state),context).state;
const deepClone=value=>JSON.parse(JSON.stringify(value));

test('catalogue covers ten roles, all 91 core skills and all nine stats',()=>{
  assert.equal(M.CREATION_ROLES.length,10);assert.equal(M.CORE_SKILLS.length,91);assert.equal(M.STATS.length,9);
  assert.equal(new Set(M.CORE_SKILLS.map(s=>s.id)).size,91);assert.ok(M.GEAR_OPTIONS.length>=12);
  for(const item of M.GEAR_OPTIONS){assert.equal(item.verification,'text-and-page');assert.equal(item.source.bookId,'core');assert.ok(Number.isInteger(item.price.value));}
});
test('new draft labels 60 as a campaign decision and allocates exactly 60',()=>{
  const d=M.newDraft();assert.equal(d.budget,60);assert.equal(d.budgetConfirmed,true);assert.match(d.budgetNote,/не универсальный/);assert.equal(M.statTotal(d),60);assert.ok(M.STATS.every(s=>d.stats[s]>=2&&d.stats[s]<=10));
  assert.equal(M.validateStep(d,'stats').length,0);assert.ok(M.validateDraft(d).length>0);
});
test('prepared synthetic heroes are complete legal starting examples',()=>{
  for(const id of ['ray','vega']){const d=M.prepareHero(id);assert.deepEqual(M.validateDraft(d),[],id);assert.equal(M.statTotal(d),60);assert.equal(M.careerSpent(d),40);assert.equal(M.pickupSpent(d),M.pickupBudget(d));assert.equal(M.careerSkillIds(d).length,10);assert.ok(d.history);assert.ok(d.gear.length);assert.equal(d.cash.mode,'core');assert.equal(d.cash.cashRoll,3);assert.equal(d.cash.employmentRoll,2);}
});
test('no navigation or send is permitted before an invitation is accepted',()=>{
  const s=M.newSession(context);for(const type of ['CHOOSE_HERO','GO_STEP','SAVE_HERO','APPLY_TO_CAMPAIGN'])assert.ok(act(s,type,{heroId:'ray',step:'identity'}).errors.length);
});
test('all valid stat budgets distribute exactly; invalid budgets reject',()=>{
  for(let n=18;n<=90;n++){const stats=M.distributeStats(n);assert.equal(Object.values(stats).reduce((a,b)=>a+b,0),n);assert.ok(Object.values(stats).every(v=>v>=2&&v<=10));}
  for(const n of [17,91,60.5,NaN,null])assert.throws(()=>M.distributeStats(n),RangeError);
});
test('exact allocations reject under, over, fractions, out of range and empty inputs',()=>{
  const ray=M.prepareHero('ray');
  for(const value of [null,'7',NaN,7.5,1,11]){const d=deepClone(ray);d.stats.INT=value;assert.ok(M.validateStep(d,'stats').length);}
  for(const value of [null,'6',NaN,6.5,-1,11,5,7]){const d=deepClone(ray);d.careerRanks['combat-sense']=value;assert.ok(M.validateStep(d,'career').length);}
  for(const rank of [0,4,6,11,3.5,null]){const d=deepClone(ray);d.pickup[0].rank=rank;assert.ok(M.validateStep(d,'pickup').length);}
});
test('point multipliers affect later IP, not initial allocations',()=>{
  const d=M.prepareHero('ray');assert.equal(M.SKILL_BY_ID.stealth.multiplier,2);assert.equal(M.careerSpent(d),40);
  d.pickup=[{skillId:'aikido',rank:10,detail:''},{skillId:'driving',rank:5,detail:''}];assert.equal(M.pickupSpent(d),15);assert.deepEqual(M.validateStep(d,'pickup'),[]);
});
test('career alternatives, TECH uniqueness, detail skills and pickup exclusions validate',()=>{
  const solo=M.prepareHero('ray');solo.soloCombat='driving';assert.ok(M.validateStep(solo,'career').length);
  const tech=M.prepareHero('vega');tech.techChoices=['basictech','firstaid','firstaid'];assert.ok(M.validateStep(tech,'career').length);
  const rock=M.prepareHero('ray');rock.roleId='rockerboy';rock.careerRanks=Object.fromEntries(M.careerSkillIds(rock).map(id=>[id,4]));assert.ok(M.validateStep(rock,'career').some(e=>e.includes('Какой инструмент')));rock.careerDetails.instrument='Синтезатор';assert.deepEqual(M.validateStep(rock,'career'),[]);
  solo.soloCombat='brawling';solo.pickup=[{skillId:'handgun',rank:10,detail:''},{skillId:'driving',rank:5,detail:''}];assert.ok(M.validateStep(solo,'pickup').some(e=>e.includes('Career')));
});
test('all ten roles can receive a valid exact 40-point career allocation',()=>{
  for(const role of M.CREATION_ROLES){const d=M.newDraft();d.roleId=role.id;d.careerRanks=Object.fromEntries(M.careerSkillIds(d).map(id=>[id,4]));for(const id of M.careerSkillIds(d))if(M.SKILL_BY_ID[id]?.detailLabel)d.careerDetails[id]='Учебный вариант';assert.deepEqual(M.validateStep(d,'career'),[],role.id);}
});
test('native language +8 is not purchased; repeated language details normalize safely',()=>{
  const d=M.prepareHero('ray');d.pickup=[{skillId:'language',rank:8,detail:' Английский '},{skillId:'driving',rank:7,detail:''}];assert.ok(M.validateStep(d,'pickup').some(e=>e.includes('Родной язык')));
  d.pickup=[{skillId:'language',rank:8,detail:'Русский'},{skillId:'language',rank:7,detail:' русский '}];assert.ok(M.validateStep(d,'pickup').some(e=>e.includes('дважды')));
  d.pickup=[{skillId:'language',rank:8,detail:'Русский'},{skillId:'language',rank:7,detail:'Японский'}];assert.deepEqual(M.validateStep(d,'pickup'),[]);
});
test('history can be explicitly deferred, without forcing random lifepath choices',()=>{
  const d=M.prepareHero('ray');d.history='';d.lifepath=Object.fromEntries(Object.keys(d.lifepath).map(k=>[k,'']));assert.ok(M.validateStep(d,'lifepath').length);d.historyLater=true;assert.deepEqual(M.validateStep(d,'lifepath'),[]);
});
test('step completion, Back, interruption and reload retain entered data',()=>{
  let s=act(accepted(),'CHOOSE_HERO',{heroId:'new'});s=act(s,'PATCH_DRAFT',{patch:{name:'Нова',roleId:'solo',lifepath:{contact:'Алия'}}});
  s=act(s,'NEXT');assert.equal(s.step,'stats');s=act(s,'PATCH_DRAFT',{patch:{stats:{INT:8,REF:6}}});const expected=deepClone(s.draft);
  s=act(s,'BACK');assert.equal(s.step,'identity');s=roundtrip(s);assert.deepEqual(s.draft,expected);s=act(s,'NEXT');assert.equal(s.step,'stats');
  assert.equal(s.draft.lifepath.contact,'Алия');assert.equal(s.identityId,context.identityId);
});
test('switching between new, prepared and edited hero drafts loses no fields',()=>{
  let s=act(accepted(),'CHOOSE_HERO',{heroId:'new'});s=act(s,'PATCH_DRAFT',{patch:{name:'Мой черновик',roleId:'media',history:'Сохранить'}});
  s=act(s,'CHOOSE_HERO',{heroId:'ray'});s=act(s,'PATCH_DRAFT',{patch:{name:'Мой Рэй'}});s=act(s,'CHOOSE_HERO',{heroId:'vega'});s=roundtrip(s);
  s=act(s,'CHOOSE_HERO',{heroId:'new'});assert.equal(s.draft.name,'Мой черновик');assert.equal(s.draft.history,'Сохранить');s=act(s,'CHOOSE_HERO',{heroId:'ray'});assert.equal(s.draft.name,'Мой Рэй');
});
test('changing roles does not destroy earlier allocations or details',()=>{
  let s=chosen();const original=deepClone(s.draft.careerRanks);s=act(s,'PATCH_DRAFT',{patch:{roleId:'rockerboy',careerDetails:{instrument:'Бас'}}});s=act(s,'PATCH_DRAFT',{patch:{roleId:'solo'}});assert.deepEqual(s.draft.careerRanks,original);assert.equal(s.draft.careerDetails.instrument,'Бас');
});
test('storage is scoped to demo identity and campaign',()=>{
  const raw=M.serializeSession(chosen());assert.notEqual(M.storageKey(context),M.storageKey({...context,campaignId:'demo-b'}));
  assert.equal(M.restoreSession(raw,{...context,identityId:'tester-b'}).reason,'context-mismatch');assert.equal(M.restoreSession(raw,{...context,campaignId:'demo-b'}).reason,'context-mismatch');
});
test('invalid storage, unsupported schemas and huge payloads safely recover empty',()=>{
  for(const [raw,reason] of [[null,'empty'],['','empty'],['{','invalid-json'],['null','unsupported-schema'],['[]','unsupported-schema'],['1','unsupported-schema'],['{"schemaVersion":999}','unsupported-schema'],['x'.repeat(1_000_001),'invalid-storage']]){const r=M.restoreSession(raw,context);assert.equal(r.recovered,false);assert.equal(r.reason,reason);assert.equal(r.state.screen,'invitation');assert.equal(r.state.draft.name,'');}
});
test('untrusted storage cannot inject unknown fields or prototypes',()=>{
  const raw=JSON.parse('{"name":"Безопасный","stats":{"INT":8,"hack":999},"__proto__":{"polluted":true},"secret":"password"}');const d=M.normalizeDraft(raw);assert.equal(d.name,'Безопасный');assert.equal(d.stats.INT,8);assert.equal(d.secret,undefined);assert.equal(d.stats.hack,undefined);assert.equal({}.polluted,undefined);assert.ok(!JSON.stringify(d).includes('password'));
});
test('invalid restored draft schema cannot keep a saved signature',()=>{
  const raw=JSON.parse(M.serializeSession(saved()));raw.draft.schemaVersion=99;const s=M.restoreSession(JSON.stringify(raw),context).state;assert.equal(s.draft.name,'');assert.equal(s.savedSignature,null);
});
test('reducer does not mutate its previous state',()=>{
  const s=chosen(),before=JSON.stringify(s);const next=act(s,'PATCH_DRAFT',{patch:{stats:{INT:10},name:'Иное имя'}});assert.equal(JSON.stringify(s),before);assert.notEqual(next.draft.name,s.draft.name);
});
test('saving rejects any unresolved field and only joins an exact validated sheet',()=>{
  let s=chosen();s=act(s,'PATCH_DRAFT',{patch:{stats:{INT:7}}});assert.ok(act(s,'SAVE_HERO').errors.length);assert.ok(act(s,'APPLY_TO_CAMPAIGN').errors.length);s=act(s,'PATCH_DRAFT',{patch:{stats:{INT:6}}});s=act(s,'SAVE_HERO');assert.deepEqual(s.errors,[]);assert.equal(s.savedHeroes.length,1);assert.ok(s.savedSignature);s=act(s,'SAVE_HERO');assert.equal(s.savedHeroes.length,1);s=roundtrip(s);assert.ok(s.savedSignature);
});
test('saved hero route loads a complete editable copy',()=>{
  let s=saved();s=act(s,'CHOOSE_HERO',{heroId:s.savedHeroes[0].id});assert.equal(s.screen,'review');assert.deepEqual(M.validateDraft(s.draft),[]);assert.equal(s.draft.name,'Рэй');assert.equal(s.savedSignature,null);
});
test('editing a joined hero invalidates previous acceptance and readiness',()=>{
  let s=active();s=act(s,'PATCH_DRAFT',{patch:{name:'Рэй после редактирования'}});assert.equal(s.savedSignature,null);assert.equal(s.lobby.application,'none');assert.equal(s.lobby.ready,false);assert.equal(s.lobby.turn,'waiting');assert.equal(s.firstAction.status,'idle');assert.equal(s.screen,'review');assert.ok(act(s,'APPLY_TO_CAMPAIGN').errors.length);
});
test('full new creation can be completed step by step and saved',()=>{
  let s=act(accepted(),'CHOOSE_HERO',{heroId:'new'});s=act(s,'PATCH_DRAFT',{patch:M.prepareHero('vega')});for(const step of M.CREATION_STEPS){assert.equal(s.step,step.id);s=act(s,'NEXT');assert.deepEqual(s.errors,[]);}assert.equal(s.screen,'review');s=act(s,'SAVE_HERO');assert.ok(s.savedSignature);
});
test('verified core money rounds month factor down to minimum one; employment is independent',()=>{
  const d=M.prepareHero('ray');assert.equal(M.CASH_RULE.status,'verified');assert.equal(M.salaryFor('solo',6),3000);
  for(let cashRoll=1;cashRoll<=6;cashRoll++)for(let employmentRoll=1;employmentRoll<=6;employmentRoll++){d.cash=M.quoteCash(d,{cashRoll,employmentRoll});const q=M.cashQuote(d);assert.equal(q.months,cashRoll===6?2:1);assert.equal(q.amount,cashRoll===6?6000:3000);assert.equal(q.unemployed,employmentRoll>4);assert.equal(d.cash.cashRoll,cashRoll);assert.equal(d.cash.employmentRoll,employmentRoll);assert.match(d.cash.provenance,/25/);assert.deepEqual(M.validateStep(d,'gear'),[]);}
});
test('SA zero has no salary and requires an explicit manual GM amount',()=>{
  const d=M.prepareHero('ray');d.careerRanks['combat-sense']=0;assert.equal(M.salaryFor('solo',0),null);d.cash=M.quoteCash(d,{cashRoll:6,employmentRoll:1});assert.equal(M.cashQuote(d).amount,null);assert.ok(M.validateStep(d,'gear').some(e=>e.includes('Special Ability 0')));
  d.cash={...d.cash,mode:'manual',manualAmount:1000,manualConfirmed:true};assert.deepEqual(M.validateStep(d,'gear'),[]);
});
test('changing role or special rank marks quote stale without rerolling',()=>{
  let s=act(chosen(),'QUOTE_CASH',{cashRoll:6,employmentRoll:5});assert.equal(M.cashQuote(s.draft).amount,6000);s=act(s,'PATCH_DRAFT',{patch:{careerRanks:{'combat-sense':7}}});assert.equal(s.draft.cash.stale,true);assert.equal(s.draft.cash.cashRoll,6);assert.equal(s.draft.cash.employmentRoll,5);assert.equal(M.cashQuote(s.draft).amount,null);assert.ok(M.validateStep(s.draft,'gear').some(e=>e.includes('пересчитай')));
  s=act(s,'QUOTE_CASH',{cashRoll:6,employmentRoll:5});assert.equal(s.draft.cash.stale,false);assert.equal(M.cashQuote(s.draft).amount,9000);s=act(s,'PATCH_DRAFT',{patch:{roleId:'fixer'}});assert.equal(s.draft.cash.stale,true);
});
test('a mismatched or tampered salary receipt cannot be saved',()=>{
  const d=M.prepareHero('ray');d.cash=M.quoteCash(d,{cashRoll:4,employmentRoll:3});d.cash.salary=99999;assert.equal(M.cashQuote(d).amount,null);assert.ok(M.validateStep(d,'gear').length);
});
test('exact catalogue prices deduct; affordability and explicit purchase deferral validate',()=>{
  const d=M.prepareHero('ray');assert.equal(M.gearTotal(d),410);assert.equal(M.remainingCash(d),2590);d.cash={...d.cash,mode:'manual',manualAmount:409,manualConfirmed:true};assert.ok(M.validateStep(d,'gear').some(e=>e.includes('Не хватает')));
  d.gear=[];d.gearSkipped=false;assert.ok(M.validateStep(d,'gear').some(e=>e.includes('отложи')));d.gearSkipped=true;assert.deepEqual(M.validateStep(d,'gear'),[]);
});
test('unknown items, duplicate entries and invalid quantities are rejected',()=>{
  const d=M.prepareHero('ray');d.gear=[{itemId:'not-in-catalogue',quantity:1}];assert.ok(M.validateStep(d,'gear').length);
  d.gear=[{itemId:'core-first-aid-kit',quantity:0}];assert.ok(M.validateStep(d,'gear').length);d.gear=[{itemId:'core-first-aid-kit',quantity:1},{itemId:'core-first-aid-kit',quantity:1}];assert.ok(M.validateStep(d,'gear').some(e=>e.includes('дублирования')));
});
test('installed cyberware requires explicit installation agreement and sourced HL',()=>{
  const d=M.prepareHero('vega');d.gear=[{itemId:'core-synthskins',quantity:1,installed:true,humanityLoss:null,installationConfirmed:false}];assert.ok(M.validateStep(d,'gear').length);d.gear[0].humanityLoss=7;d.gear[0].installationConfirmed=true;assert.ok(M.validateStep(d,'gear').some(e=>e.includes('Humanity')));d.gear[0].humanityLoss=4;assert.deepEqual(M.validateStep(d,'gear'),[]);assert.deepEqual(M.humanitySummary(d),{initial:70,totalLoss:4,remaining:66,currentEMP:7});
  d.gear.push({itemId:'core-biomonitor',quantity:1,installed:true,humanityLoss:1,installationConfirmed:true});assert.equal(M.humanitySummary(d).totalLoss,5);
});
test('partial humanity decades reduce EMP by loss, not by remaining-humanity rounding',()=>{
  const d=M.prepareHero('vega');d.stats.EMP=8;d.gear=[{itemId:'core-synthskins',quantity:1,installed:true,humanityLoss:6,installationConfirmed:true}];assert.equal(M.humanitySummary(d).remaining,74);assert.equal(M.humanitySummary(d).currentEMP,8);
});
test('pending application is not accepted roster, ready is not scene prepared',()=>{
  let s=act(saved(),'APPLY_TO_CAMPAIGN');assert.equal(s.lobby.application,'pending');assert.equal(s.lobby.ready,false);assert.ok(act(s,'TOGGLE_READY').errors.length);assert.ok(act(s,'SIMULATE_PREPARE_SCENE').errors.length);s=roundtrip(s);assert.equal(s.lobby.application,'pending');s=act(s,'SIMULATE_ACCEPT');assert.equal(s.lobby.application,'accepted');assert.equal(s.lobby.ready,false);s=act(s,'TOGGLE_READY');assert.equal(s.lobby.ready,true);assert.equal(s.lobby.scenePrepared,false);assert.ok(act(s,'SIMULATE_START_TURN').errors.length);
});
test('first action declaration, preview and send never move the token; explicit GM confirm does',()=>{
  let s=active();const position={...s.firstAction.position};assert.ok(act(s,'SEND_ACTION').errors.length);assert.ok(act(s,'SIMULATE_CONFIRM_ACTION').errors.length);
  s=act(s,'DECLARE_ACTION',{kind:'move',x:2,y:2});assert.equal(s.firstAction.status,'declared');assert.deepEqual(s.firstAction.position,position);s=act(s,'PREVIEW_ACTION');assert.equal(s.firstAction.status,'preview');assert.deepEqual(s.firstAction.position,position);s=act(s,'SEND_ACTION');assert.equal(s.firstAction.status,'submitted');assert.deepEqual(s.firstAction.position,position);
  s=roundtrip(s);assert.equal(s.firstAction.status,'submitted');assert.deepEqual(s.firstAction.position,position);assert.ok(act(s,'DECLARE_ACTION',{kind:'move',x:3,y:2}).errors.length);s=act(s,'SIMULATE_CONFIRM_ACTION');assert.equal(s.firstAction.status,'confirmed');assert.deepEqual(s.firstAction.position,{x:2,y:2});assert.deepEqual(roundtrip(s).firstAction.position,{x:2,y:2});
});
test('repeated submissions never create an extra application or movement',()=>{
  let s=act(saved(),'APPLY_TO_CAMPAIGN');s=act(s,'APPLY_TO_CAMPAIGN');assert.equal(s.lobby.application,'pending');s=active();s=act(s,'DECLARE_ACTION',{kind:'move',x:2,y:2});s=act(s,'PREVIEW_ACTION');s=act(s,'SEND_ACTION');const duplicate=act(s,'SEND_ACTION');assert.ok(duplicate.errors.length);assert.deepEqual(duplicate.firstAction,s.firstAction);
});
test('reset requires a requested explicit confirmation; cancel and reload do not reset',()=>{
  let s=chosen();assert.ok(act(s,'CONFIRM_RESET').errors.length);s=act(s,'REQUEST_RESET');assert.equal(s.resetPending,true);assert.equal(s.draft.name,'Рэй');assert.equal(roundtrip(s).resetPending,false);s=act(s,'CANCEL_RESET');assert.equal(s.resetPending,false);assert.equal(s.draft.name,'Рэй');s=act(s,'REQUEST_RESET');s=act(s,'CONFIRM_RESET');assert.equal(s.screen,'invitation');assert.equal(s.draft.name,'');assert.equal(s.identityId,context.identityId);
});
test('the pure model contains no live network, auth or localStorage side effects',()=>{
  const source=readFileSync(new URL('../model.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\s*\(|localStorage\s*\.|sessionStorage\s*\./);
});

test('one-step chooser keeps current draft and readiness unchanged',()=>{
  let s=joined();const before=deepClone(s.draft);s=act(s,'OPEN_CHOOSER');assert.equal(s.screen,'choose');assert.deepEqual(s.draft,before);assert.equal(s.lobby.application,'accepted');assert.deepEqual(s.drafts.ray,before);
});
test('explicitly confirmed fresh drafts create distinct saved heroes',()=>{
  let s=act(accepted(),'CHOOSE_HERO',{heroId:'new'});s=act(s,'PATCH_DRAFT',{patch:M.prepareHero('ray')});s=act(s,'SAVE_HERO');const first=s.savedHeroes[0].id;assert.equal(s.savedHeroes.length,1);assert.ok(act(s,'NEW_DRAFT').errors.length);assert.equal(act(s,'NEW_DRAFT').draft.name,'Рэй');
  s=act(s,'NEW_DRAFT',{confirmed:true});assert.equal(s.draft.name,'');assert.equal(s.savedHeroes.length,1);assert.ok(Object.keys(s.drafts).some(key=>key.startsWith('archived-')));s=roundtrip(s);s=act(s,'PATCH_DRAFT',{patch:{...M.prepareHero('vega'),name:'Новый герой'}});s=act(s,'SAVE_HERO');assert.equal(s.savedHeroes.length,2);assert.notEqual(s.savedHeroes[1].id,first);s=act(s,'CHOOSE_HERO',{heroId:first});assert.equal(s.draft.name,'Рэй');
});

test('nested unsupported schemas and unsafe slot keys do not enter restored state',()=>{
  const raw=JSON.parse(M.serializeSession(saved()));raw.activeDraftKey='__proto__';raw.savedHeroes[0].draft.schemaVersion=99;raw.drafts.ray.schemaVersion=99;const s=M.restoreSession(JSON.stringify(raw),context).state;assert.equal(s.activeDraftKey,'new');assert.equal(s.savedHeroes.length,0);assert.equal(s.drafts.ray,undefined);assert.doesNotThrow(()=>M.serializeSession(s));
});

test('archived drafts remain discoverable, selectable and editable after starting a new hero',()=>{
  let s=act(accepted(),'CHOOSE_HERO',{heroId:'new'});s=act(s,'PATCH_DRAFT',{patch:{name:'Верни меня',roleId:'solo',history:'Недописанная история',stats:{INT:8,REF:6}}});const original=deepClone(s.draft);s=act(s,'NEW_DRAFT',{confirmed:true});s=roundtrip(s);const id=Object.keys(s.drafts).find(key=>key.startsWith('archived-'));assert.ok(id);s=act(s,'CHOOSE_HERO',{heroId:id});assert.deepEqual(s.errors,[]);assert.equal(s.screen,'create');assert.equal(s.step,'identity');assert.deepEqual(s.draft,original);assert.equal(s.unlockedStep,2);s=roundtrip(s);assert.equal(s.activeDraftKey,id);assert.deepEqual(s.draft,original);assert.ok(act(s,'CHOOSE_HERO',{heroId:'archived-999999'}).errors.length);
});
