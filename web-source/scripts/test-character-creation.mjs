import assert from 'node:assert/strict';
import {createTestModuleLoader} from './test-ts-loader.mjs';

// Read the existing model without writing or changing the Site checkout.
const modules=createTestModuleLoader();
const {blank}=await modules.load('lib/tracker.ts');
const creation=await modules.load('lib/character-creation.ts');
const {creationDraft,validateCreationStep,buildCreatedCharacter,distributeStats,careerSkillIds,availablePickupSkills,CORE_SKILLS,SKILL_BY_ID,CREATION_ROLES,transferErrors}=creation;
const context={isGM:true,users:[{id:1,username:'GM',role:'gm'},{id:2,username:'Player',role:'player'}]};
function validSolo(){
  return {...creationDraft(),name:'Тестовый Соло',roleId:'solo',budget:54,budgetConfirmed:true,stats:distributeStats(54),
    careerRanks:{'combat-sense':6,notice:4,handgun:6,brawling:4,melee:4,weaponsmith:3,rifle:4,athletics:3,smg:3,stealth:3},
    pickup:[{skillId:'driving',rank:6,detail:''},{skillId:'firstaid',rank:6,detail:''}],
    nativeLanguage:'Русский',history:'Бывший охранник, который ищет работу.',cash:1000,cashConfirmed:true};
}
const solo=validSolo();
for(let step=0;step<6;step++)assert.deepEqual(validateCreationStep(solo,step,context),[],`valid step ${step}`);
assert.ok(validateCreationStep(creationDraft(),0,context).length>=2);
assert.ok(validateCreationStep({...solo,budget:null,budgetConfirmed:false},1,context).length>=2);
assert.ok(validateCreationStep({...solo,budgetConfirmed:false},1,context).some(error=>error.includes('утвердил')));
for(let budget=18;budget<=90;budget++){
  const stats=distributeStats(budget);
  assert.equal(Object.values(stats).reduce((sum,value)=>sum+value,0),budget);
  assert.ok(Object.values(stats).every(value=>Number.isInteger(value)&&value>=2&&value<=10));
}
for(const invalid of [17,91,54.5,NaN,Infinity])assert.throws(()=>distributeStats(invalid));
assert.ok(validateCreationStep({...solo,budget:53},1,context).some(error=>error.includes('ровно')));
for(const invalid of [0,1,11,6.5,NaN])assert.ok(validateCreationStep({...solo,stats:{...solo.stats,EMP:invalid}},1,context).some(error=>error.startsWith('EMP')));
assert.ok(validateCreationStep({...solo,careerRanks:{...solo.careerRanks,handgun:5}},2,context).some(error=>error.includes('ровно 40')));
assert.ok(validateCreationStep({...solo,careerRanks:{...solo.careerRanks,handgun:7}},2,context).some(error=>error.includes('ровно 40')));
assert.ok(validateCreationStep({...solo,careerRanks:{...solo.careerRanks,handgun:NaN}},2,context).some(error=>error.includes('ранг')));
assert.ok(!availablePickupSkills(solo).some(skill=>skill.id==='handgun'));
assert.ok(availablePickupSkills(solo).some(skill=>skill.id==='driving'));
const invalidPickup={...solo,pickup:[{skillId:'handgun',rank:6,detail:''},{skillId:'firstaid',rank:6,detail:''}]};
assert.ok(validateCreationStep(invalidPickup,3,context).some(error=>error.includes('Career Skills')));
assert.throws(()=>buildCreatedCharacter(invalidPickup,context));
assert.ok(validateCreationStep({...solo,pickup:[{skillId:'interface',rank:6,detail:''},{skillId:'firstaid',rank:6,detail:''}]},3,context).some(error=>error.includes('обычный')));
assert.ok(validateCreationStep({...solo,pickup:[{skillId:'driving',rank:6,detail:''},{skillId:'driving',rank:6,detail:''}]},3,context).some(error=>error.includes('уже есть')));
const languages={...solo,pickup:[{skillId:'language',rank:6,detail:'Французский'},{skillId:'language',rank:6,detail:'Немецкий'}]};
assert.deepEqual(validateCreationStep(languages,3,context),[]);
assert.ok(validateCreationStep({...languages,pickup:[{skillId:'language',rank:6,detail:' Русский '},{skillId:'language',rank:6,detail:'Немецкий'}]},3,context).some(error=>error.includes('Родной язык')));
assert.ok(validateCreationStep({...languages,pickup:[{skillId:'language',rank:6,detail:''},{skillId:'language',rank:6,detail:'Немецкий'}]},3,context).some(error=>error.includes('укажи')));
assert.ok(validateCreationStep({...solo,pickup:[{skillId:'driving',rank:5,detail:''},{skillId:'firstaid',rank:6,detail:''}]},3,context).some(error=>error.includes('ровно INT + REF')));
for(const bad of [NaN,0,11,3.5])assert.ok(validateCreationStep({...solo,pickup:[{skillId:'driving',rank:bad,detail:''}]},3,context).some(error=>error.includes('ранг')));
assert.ok(validateCreationStep({...solo,cash:null},4,context).some(error=>error.includes('сумму')));
assert.ok(validateCreationStep({...solo,cash:1.5},4,context).some(error=>error.includes('сумму')));
assert.ok(validateCreationStep({...solo,cashConfirmed:false},4,context).some(error=>error.includes('Подтверди')));
assert.ok(validateCreationStep({...solo,nativeLanguage:''},4,context).some(error=>error.includes('родной язык')));
assert.ok(validateCreationStep({...solo,history:'',historyLater:false},4,context).some(error=>error.includes('предыстории')));
assert.deepEqual(validateCreationStep({...solo,history:'',historyLater:true},4,context),[]);
assert.ok(validateCreationStep({...solo,ownerId:2},0,{...context,isGM:false}).some(error=>error.includes('своего аккаунта')));
assert.ok(validateCreationStep({...solo,ownerId:999},0,context).some(error=>error.includes('существующего')));
assert.deepEqual(validateCreationStep({...solo,ownerId:2},0,context),[]);

// Solo has a real choice of one martial art, with the correct future IP multiplier.
const karate={...solo,soloCombat:'karate',careerRanks:{...solo.careerRanks,karate:solo.careerRanks.brawling}};
assert.deepEqual(validateCreationStep(karate,2,context),[]);
assert.ok(!availablePickupSkills(karate).some(skill=>skill.id==='karate'));
assert.equal(buildCreatedCharacter(karate,context).skills.find(skill=>skill.name==='Карате').multiplier,2);
assert.ok(validateCreationStep({...solo,soloCombat:'handgun'},2,context).length>0);

// Techie chooses three additional TECH skills, not repetitions or a fixed career skill.
const techie={...solo,roleId:'techie',techChoices:['aerotech','avtech','pharmaceuticals']};
techie.careerRanks=Object.fromEntries(careerSkillIds(techie).map(skillId=>[skillId,4]));
assert.deepEqual(validateCreationStep(techie,2,context),[]);
for(const techChoices of [['aerotech','aerotech','pharmaceuticals'],['basictech','avtech','pharmaceuticals'],['driving','avtech','pharmaceuticals'],['','','']]){
  assert.ok(validateCreationStep({...techie,techChoices},2,context).some(error=>error.includes('три разных')));
}
assert.equal(SKILL_BY_ID.programming.stat,'INT');assert.equal(SKILL_BY_ID.programming.multiplier,1);
assert.equal(SKILL_BY_ID.cryotank.stat,'TECH');assert.equal(SKILL_BY_ID.cryotank.multiplier,1);
assert.equal(SKILL_BY_ID.weaponsmith.stat,'TECH');assert.equal(SKILL_BY_ID.weaponsmith.multiplier,2);
assert.equal(SKILL_BY_ID.stealth.multiplier,2);assert.equal(SKILL_BY_ID['thai-boxing'].multiplier,4);
assert.equal(new Set(CORE_SKILLS.map(skill=>skill.id)).size,CORE_SKILLS.length);
for(const role of CREATION_ROLES){
  const sheet={...solo,roleId:role.id,techChoices:role.id==='techie'?['aerotech','avtech','pharmaceuticals']:['','','']};
  const ids=careerSkillIds(sheet);
  assert.equal(ids.length,10,role.id);assert.equal(new Set(ids).size,10,role.id);
  assert.ok(ids.every(skillId=>SKILL_BY_ID[skillId]),role.id);
}

// Building preserves the draft, initializes only verified resources, and never buys/installs items.
const before=JSON.stringify(solo);
const result=buildCreatedCharacter(solo,context);
assert.equal(JSON.stringify(solo),before);
assert.equal(result.humanity,60);assert.equal(result.cash,1000);assert.equal(result.specialRank,6);
assert.equal(result.skills.find(skill=>skill.name==='Язык: Русский').rank,8);
assert.equal(result.skills.find(skill=>skill.name==='Оружейное дело').multiplier,2);
assert.ok(result.skills.every(skill=>skill.ip===0));assert.deepEqual(result.items,[]);assert.equal(result.wounds,0);
result.stats.EMP=9;assert.equal(solo.stats.EMP,6);
assert.throws(()=>buildCreatedCharacter({...solo,budgetConfirmed:false},context));

// Transfer validates only identity/ownership and deliberately does not apply initial STAT limits.
assert.deepEqual(transferErrors('Готовый киборг','Соло',undefined,context),[]);
const transferred=blank('Готовый киборг','Соло');
assert.equal(transferred.stats.EMP,0);assert.deepEqual(transferred.skills,[]);assert.deepEqual(transferred.items,[]);
assert.ok(transferErrors('','Соло',undefined,context).length>0);
assert.ok(transferErrors('x'.repeat(81),'Соло',undefined,context).length>0);
assert.ok(transferErrors('Имя','',undefined,context).length>0);
console.log('Character creation: valid six-step flow; all 73 budgets; finite/range checks; strict Career/Pickup allocation; ownership; native languages; Solo/Techie choices; verified IP multipliers; immutable build; empty transfer passed.');
