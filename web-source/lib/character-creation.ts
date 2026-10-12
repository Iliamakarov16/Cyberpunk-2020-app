import {blank, STATS, STAT_LABELS, type CharacterData, type Skill, type Stat} from './tracker';

/** Core 2020, pp. 25–29, 43–54. These constraints apply to new, unaugmented characters only. */
export const CAREER_POINTS = 40;
export const WIZARD_STEPS = ['Личность', 'Характеристики', 'Профессия', 'Другие навыки', 'История и деньги', 'Проверка'] as const;
export type CreationUser = {id:number; username:string; role:string};
export type SkillDefinition = {id:string; name:string; english:string; stat:Stat; multiplier:number; detailLabel?:string; special?:boolean};
const definition = (id:string, name:string, english:string, stat:Stat, multiplier=1, detailLabel?:string):SkillDefinition => ({id,name,english,stat,multiplier,...(detailLabel?{detailLabel}:{})});
export const CORE_SKILLS:SkillDefinition[] = [
  definition('grooming','Уход за собой','Personal Grooming','ATTR'),
  definition('style','Гардероб и стиль','Wardrobe & Style','ATTR'),
  definition('endurance','Выносливость','Endurance','BODY'),
  definition('strength','Силовое усилие','Strength Feat','BODY'),
  definition('swimming','Плавание','Swimming','BODY'),
  definition('interrogation','Допрос','Interrogation','COOL'),
  definition('intimidate','Устрашение','Intimidate','COOL'),
  definition('oratory','Ораторское искусство','Oratory','COOL'),
  definition('resist','Сопротивление пыткам и наркотикам','Resist Torture/Drugs','COOL'),
  definition('streetwise','Знание улицы','Streetwise','COOL'),
  definition('perception','Понимание людей','Human Perception','EMP'),
  definition('interview','Интервью','Interview','EMP'),
  definition('leadership','Лидерство','Leadership','EMP'),
  definition('seduction','Соблазнение','Seduction','EMP'),
  definition('social','Этикет','Social','EMP'),
  definition('persuasion','Убеждение','Persuasion & Fast Talk','EMP'),
  definition('perform','Выступление','Perform','EMP'),
  definition('accounting','Бухгалтерия','Accounting','INT'),
  definition('anthropology','Антропология','Anthropology','INT'),
  definition('notice','Внимательность','Awareness/Notice','INT'),
  definition('biology','Биология','Biology','INT'),
  definition('botany','Ботаника','Botany','INT'),
  definition('chemistry','Химия','Chemistry','INT'),
  definition('composition','Сочинительство','Composition','INT'),
  definition('diagnose','Диагностика болезней','Diagnose Illness','INT'),
  definition('education','Образование и общие знания','Education & General Knowledge','INT'),
  definition('expert','Экспертные знания','Expert','INT',1,'Область знаний'),
  definition('gamble','Азартные игры','Gamble','INT'),
  definition('geology','Геология','Geology','INT'),
  definition('evade','Скрыть следы','Hide/Evade','INT'),
  definition('history','История','History','INT'),
  definition('language','Язык','Know Language','INT',1,'Какой язык'),
  definition('library','Поиск информации','Library Search','INT'),
  definition('mathematics','Математика','Mathematics','INT'),
  definition('physics','Физика','Physics','INT'),
  definition('programming','Программирование','Programming','INT'),
  definition('tracking','Выслеживание','Shadow/Track','INT'),
  definition('stocks','Фондовый рынок','Stock Market','INT'),
  definition('systems','Знание систем Сети','System Knowledge','INT'),
  definition('teaching','Обучение','Teaching','INT'),
  definition('survival','Выживание в дикой местности','Wilderness Survival','INT'),
  definition('zoology','Зоология','Zoology','INT'),
  definition('archery','Стрельба из лука','Archery','REF'),
  definition('athletics','Атлетика','Athletics','REF'),
  definition('brawling','Драка','Brawling','REF'),
  definition('dance','Танец','Dance','REF'),
  definition('dodge','Уклонение и освобождение','Dodge & Escape','REF'),
  definition('driving','Вождение','Driving','REF'),
  definition('fencing','Фехтование','Fencing','REF'),
  definition('handgun','Пистолеты','Handgun','REF'),
  definition('heavyweapons','Тяжёлое оружие','Heavy Weapons','REF'),
  definition('aikido','Айкидо','Aikido','REF',3),
  definition('animal-kung-fu','Звериное кунг-фу','Animal Kung Fu','REF',3,'Стиль, например тигр'),
  definition('boxing','Бокс','Boxing','REF'),
  definition('capoeira','Капоэйра','Capoeira','REF',3),
  definition('choi-li-fut','Чой Ли Фут','Choi Li Fut','REF',3),
  definition('judo','Дзюдо','Judo','REF'),
  definition('karate','Карате','Karate','REF',2),
  definition('tae-kwon-do','Тхэквондо','Tae Kwon Do','REF',3),
  definition('thai-boxing','Тайский бокс','Thai Kick Boxing','REF',4),
  definition('wrestling','Борьба','Wrestling','REF'),
  definition('melee','Ближний бой с оружием','Melee','REF'),
  definition('motorcycle','Мотоцикл','Motorcycle','REF'),
  definition('machinery','Тяжёлая техника','Operate Heavy Machinery','REF'),
  definition('pilot-gyro','Пилотирование вертолёта','Pilot Gyro','REF',3),
  definition('pilot-wing','Пилотирование самолёта','Pilot Fixed Wing','REF',2),
  definition('pilot-airship','Пилотирование дирижабля','Pilot Dirigible','REF',2),
  definition('pilot-av','Пилотирование AV','Pilot Vectored Thrust Vehicle','REF',3),
  definition('rifle','Винтовки и ружья','Rifle','REF'),
  definition('stealth','Скрытность','Stealth','REF',2),
  definition('smg','Пистолеты-пулемёты','Submachinegun','REF'),
  definition('aerotech','Авиационная техника','Aero Tech','TECH',2),
  definition('avtech','Обслуживание AV','AV Tech','TECH',3),
  definition('basictech','Базовая техника','Basic Tech','TECH',2),
  definition('cryotank','Работа с криокамерами','Cryotank Operation','TECH'),
  definition('deckdesign','Проектирование кибердек','Cyberdeck Design','TECH',2),
  definition('cybertech','Кибертехника','CyberTech','TECH',2),
  definition('demolitions','Взрывное дело','Demolitions','TECH',2),
  definition('disguise','Маскировка','Disguise','TECH'),
  definition('electronics','Электроника','Electronics','TECH'),
  definition('security','Электронная безопасность','Electronic Security','TECH',2),
  definition('firstaid','Первая помощь','First Aid','TECH'),
  definition('forgery','Подделка документов','Forgery','TECH'),
  definition('gyrotech','Обслуживание вертолётов','Gyro Tech','TECH',3),
  definition('painting','Рисование','Paint or Draw','TECH'),
  definition('photography','Фото и видео','Photography & Film','TECH'),
  definition('pharmaceuticals','Фармакология','Pharmaceuticals','TECH',2),
  definition('picklock','Взлом замков','Pick Lock','TECH'),
  definition('pickpocket','Карманные кражи','Pick Pocket','TECH'),
  definition('instrument','Музыкальный инструмент','Play Instrument','TECH',1,'Какой инструмент'),
  definition('weaponsmith','Оружейное дело','Weaponsmith','TECH',2),
];
export const MARTIAL_SKILL_IDS = ['aikido','animal-kung-fu','boxing','capoeira','choi-li-fut','judo','karate','tae-kwon-do','thai-boxing','wrestling'] as const;
type RoleDefinition = {id:string; label:string; english:string; ability:SkillDefinition; career:string[]; summary:string};
const ability = (id:string,name:string,english:string,stat:Stat):SkillDefinition => ({...definition(id,name,english,stat),special:true});
export const CREATION_ROLES:RoleDefinition[] = [
  {id:'solo',label:'Соло',english:'Solo',ability:ability('combat-sense','Боевое чутьё','Combat Sense','INT'),career:['notice','handgun','$combat','melee','weaponsmith','rifle','athletics','smg','stealth'],summary:'Бой, сопровождение и защита. Combat Sense даёт бонус к внимательности и инициативе.'},
  {id:'rockerboy',label:'Рокербой',english:'Rockerboy',ability:ability('charismatic-leadership','Харизматическое лидерство','Charismatic Leadership','COOL'),career:['notice','perform','style','composition','brawling','instrument','streetwise','persuasion','seduction'],summary:'Артист и голос улицы. Special Ability позволяет влиять на толпу от десяти человек.'},
  {id:'netrunner',label:'Нетраннер',english:'Netrunner',ability:ability('interface','Интерфейс','Interface','INT'),career:['notice','basictech','education','systems','cybertech','deckdesign','composition','electronics','programming'],summary:'Специалист по Сети и взлому. Interface нужен для специальных функций Net Menu.'},
  {id:'techie',label:'Техник',english:'Techie',ability:ability('jury-rig','Временный ремонт','Jury Rig','TECH'),career:['notice','basictech','cybertech','teaching','education','electronics','$tech1','$tech2','$tech3'],summary:'Ремонт и изготовление. Jury Rig позволяет временно починить или переделать устройство.'},
  {id:'medtechie',label:'Медтехник',english:'Medtechie',ability:ability('medical-tech','Медицинская техника','Medical Tech','TECH'),career:['notice','basictech','diagnose','education','cryotank','library','pharmaceuticals','zoology','perception'],summary:'Лечение и хирургия. Medical Tech открывает серьёзные медицинские процедуры.'},
  {id:'media',label:'Медиа',english:'Media',ability:ability('credibility','Достоверность','Credibility','INT'),career:['notice','composition','education','persuasion','perception','social','streetwise','photography','interview'],summary:'Журналист и расследователь. Credibility помогает добиться доверия к сведениям.'},
  {id:'cop',label:'Коп',english:'Cop',ability:ability('authority','Власть закона','Authority','COOL'),career:['notice','handgun','perception','athletics','education','brawling','melee','interrogation','streetwise'],summary:'Представитель закона. Authority работает через положение и реальные полномочия.'},
  {id:'corporate',label:'Корпорат',english:'Corporate',ability:ability('resources','Ресурсы','Resources','INT'),career:['notice','perception','education','library','social','persuasion','stocks','style','grooming'],summary:'Корпоративный сотрудник. Resources показывает доступ к ресурсам компании, не личный кошелёк.'},
  {id:'fixer',label:'Фиксер',english:'Fixer',ability:ability('streetdeal','Уличные сделки','Streetdeal','COOL'),career:['notice','forgery','handgun','brawling','melee','picklock','pickpocket','intimidate','persuasion'],summary:'Контакты, информация и сделки. Streetdeal помогает найти людей, слухи и нужные товары.'},
  {id:'nomad',label:'Кочевник',english:'Nomad',ability:ability('family','Семья','Family','INT'),career:['notice','endurance','melee','rifle','driving','basictech','survival','brawling','athletics'],summary:'Участник кочевого клана. Family позволяет обращаться за помощью к большой семье.'},
];
export const SKILL_BY_ID = Object.fromEntries([...CORE_SKILLS,...CREATION_ROLES.map(role=>role.ability)].map(skill=>[skill.id,skill])) as Record<string,SkillDefinition>;
export type PickupAllocation = {skillId:string; rank:number; detail:string};
export type CreationDraft = {
  name:string; roleId:string; ownerId?:number; budget:number|null; budgetConfirmed:boolean;
  stats:Record<Stat,number>; careerRanks:Record<string,number>; careerDetails:Record<string,string>;
  soloCombat:string; techChoices:string[]; pickup:PickupAllocation[];
  nativeLanguage:string; history:string; historyLater:boolean; cash:number|null; cashConfirmed:boolean;
};
export type CreationContext = {isGM:boolean; users:CreationUser[]};
export function creationDraft():CreationDraft {
  return {name:'',roleId:'',budget:null,budgetConfirmed:false,stats:Object.fromEntries(STATS.map(stat=>[stat,2])) as Record<Stat,number>,careerRanks:{},careerDetails:{},soloCombat:'brawling',techChoices:['','',''],pickup:[],nativeLanguage:'',history:'',historyLater:false,cash:null,cashConfirmed:false};
}
export const selectedRole = (draft:CreationDraft) => CREATION_ROLES.find(role=>role.id===draft.roleId);
export function careerSkillIds(draft:CreationDraft):string[] {
  const role=selectedRole(draft);
  if(!role)return [];
  return [role.ability.id,...role.career.map(id=>id==='$combat'?draft.soloCombat:id.startsWith('$tech')?draft.techChoices[Number(id.slice(-1))-1]??'':id)].filter(Boolean);
}
export const statTotal = (draft:CreationDraft) => STATS.reduce((sum,stat)=>sum+draft.stats[stat],0);
export const careerSpent = (draft:CreationDraft) => careerSkillIds(draft).reduce((sum,id)=>sum+(draft.careerRanks[id]??0),0);
export const pickupBudget = (draft:CreationDraft) => draft.stats.INT+draft.stats.REF;
export const pickupSpent = (draft:CreationDraft) => draft.pickup.reduce((sum,item)=>sum+item.rank,0);
const integerIn = (value:number|null,min:number,max:number):value is number => typeof value==='number'&&Number.isInteger(value)&&value>=min&&value<=max;
const normalizedText = (value:string) => value.trim().normalize('NFKC').toLocaleLowerCase('ru');
const skillIdentity = (item:PickupAllocation) => item.skillId+'|'+normalizedText(item.detail);
function ownerErrors(ownerId:number|undefined,context:CreationContext):string[] {
  if(ownerId===undefined)return [];
  if(!context.isGM)return ['Игрок создаёт лист для своего аккаунта.'];
  return Number.isInteger(ownerId)&&context.users.some(user=>user.id===ownerId)?[]:['Выбери существующего владельца листа.'];
}
export function transferErrors(name:string,role:string,ownerId:number|undefined,context:CreationContext):string[] {
  const errors=ownerErrors(ownerId,context);
  if(!name.trim()||name.length>80)errors.push('Введи имя персонажа: от 1 до 80 символов.');
  if(!role.trim()||role.length>80)errors.push('Введи роль: от 1 до 80 символов.');
  return errors;
}
export function distributeStats(budget:number):Record<Stat,number> {
  if(!integerIn(budget,18,90))throw new Error('Бюджет девяти базовых STAT должен быть целым числом от 18 до 90.');
  const base=Math.floor(budget/STATS.length),extra=budget%STATS.length;
  return Object.fromEntries(STATS.map((stat,index)=>[stat,base+(index<extra?1:0)])) as Record<Stat,number>;
}
export function availablePickupSkills(draft:CreationDraft):SkillDefinition[] {
  const career=new Set(careerSkillIds(draft));
  return CORE_SKILLS.filter(skill=>!career.has(skill.id));
}
export function validateCreationStep(draft:CreationDraft,step:number,context:CreationContext):string[] {
  const errors:string[]=[];
  if(step===0){
    if(!draft.name.trim()||draft.name.length>80)errors.push('Введи имя персонажа: от 1 до 80 символов.');
    if(!selectedRole(draft))errors.push('Выбери одну из десяти ролей Core.');
    errors.push(...ownerErrors(draft.ownerId,context));
  } else if(step===1){
    if(!integerIn(draft.budget,18,90))errors.push('Введи согласованный с ведущим целый бюджет STAT от 18 до 90.');
    if(!draft.budgetConfirmed)errors.push('Подтверди, что этот бюджет утвердил ведущий.');
    for(const stat of STATS)if(!integerIn(draft.stats[stat],2,10))errors.push(`${stat} (${STAT_LABELS[stat]}): базовое значение при создании должно быть целым от 2 до 10.`);
    if(integerIn(draft.budget,18,90)&&statTotal(draft)!==draft.budget)errors.push(`Распредели ровно ${draft.budget} очков STAT; сейчас ${Number.isFinite(statTotal(draft))?statTotal(draft):'есть пустые значения'}.`);
  } else if(step===2){
    const role=selectedRole(draft),ids=careerSkillIds(draft);
    if(!role)errors.push('Сначала выбери роль.');
    if(role?.id==='solo'&&!['brawling',...MARTIAL_SKILL_IDS].includes(draft.soloCombat))errors.push('Для Solo выбери драку или конкретный стиль боевых искусств.');
    if(role?.id==='techie'){
      const fixed=new Set(role.career.filter(id=>!id.startsWith('$')));
      if(draft.techChoices.length!==3||draft.techChoices.some(id=>!id||!SKILL_BY_ID[id]||SKILL_BY_ID[id].stat!=='TECH'||SKILL_BY_ID[id].special||fixed.has(id))||new Set(draft.techChoices).size!==3)errors.push('Для техника выбери три разных дополнительных TECH-навыка, которых нет в основном наборе.');
    }
    if(ids.length!==10||new Set(ids).size!==10)errors.push('Карьерный набор должен включать специальную способность и девять разных навыков.');
    for(const id of ids){
      const skill=SKILL_BY_ID[id];
      if(!skill){errors.push('В карьерном наборе есть неизвестный навык.');continue;}
      const rank=draft.careerRanks[id]??0;
      if(!integerIn(rank,0,10))errors.push(`${skill.name}: ранг должен быть целым от 0 до 10.`);
      if(rank>0&&skill.detailLabel&&!(draft.careerDetails[id]??'').trim())errors.push(`${skill.name}: укажи ${skill.detailLabel.toLocaleLowerCase('ru')}.`);
      if((draft.careerDetails[id]??'').length>60)errors.push(`${skill.name}: уточнение не длиннее 60 символов.`);
    }
    if(careerSpent(draft)!==CAREER_POINTS)errors.push(`Распредели ровно ${CAREER_POINTS} Career Points; сейчас ${Number.isFinite(careerSpent(draft))?careerSpent(draft):'есть пустые значения'}.`);
  } else if(step===3){
    const career=new Set(careerSkillIds(draft)),seen=new Set<string>();
    if(draft.pickup.length>30)errors.push('Слишком много дополнительных навыков.');
    for(const item of draft.pickup){
      const skill=SKILL_BY_ID[item.skillId];
      if(!skill||skill.special){errors.push('Выбери обычный навык Core для каждого дополнительного навыка.');continue;}
      if(career.has(item.skillId))errors.push(`${skill.name}: Career Skills нельзя повышать за Pickup Points.`);
      if(!integerIn(item.rank,1,10))errors.push(`${skill.name}: дополнительный навык должен иметь целый ранг от 1 до 10.`);
      if(skill.detailLabel&&!item.detail.trim())errors.push(`${skill.name}: укажи ${skill.detailLabel.toLocaleLowerCase('ru')}.`);
      if(item.detail.length>60)errors.push(`${skill.name}: уточнение не длиннее 60 символов.`);
      const identity=skillIdentity({...item,detail:skill.detailLabel?item.detail:''});
      if(seen.has(identity))errors.push(`${skill.name}: одинаковый навык уже есть в списке.`);
      seen.add(identity);
      if(item.skillId==='language'&&draft.nativeLanguage.trim()&&normalizedText(item.detail)===normalizedText(draft.nativeLanguage))errors.push('Родной язык уже даётся на +8: не трать на него Pickup Points.');
    }
    if(pickupSpent(draft)!==pickupBudget(draft))errors.push(`Распредели ровно INT + REF = ${pickupBudget(draft)} Pickup Points; сейчас ${Number.isFinite(pickupSpent(draft))?pickupSpent(draft):'есть пустые значения'}.`);
  } else if(step===4){
    if(!draft.nativeLanguage.trim()||draft.nativeLanguage.length>60)errors.push('Укажи родной язык: от 1 до 60 символов. Он даётся на +8 без расхода очков.');
    if(draft.history.length>6000)errors.push('Предыстория не должна быть длиннее 6000 символов.');
    if(!draft.history.trim()&&!draft.historyLater)errors.push('Напиши основу предыстории или отметь, что допишешь её позже.');
    if(!integerIn(draft.cash,0,1e12))errors.push('Введи согласованную стартовую сумму: целое число от 0 до 1 000 000 000 000 eb.');
    if(!draft.cashConfirmed)errors.push('Подтверди, что стартовую сумму согласовали с ведущим.');
    if(draft.pickup.some(item=>item.skillId==='language'&&normalizedText(item.detail)===normalizedText(draft.nativeLanguage)&&draft.nativeLanguage.trim()))errors.push('Родной язык уже даётся на +8; убери его из Pickup-навыков и перераспредели очки.');
  } else if(step===5){
    for(let previous=0;previous<5;previous++)errors.push(...validateCreationStep(draft,previous,context));
  } else errors.push('Неизвестный шаг создания.');
  return [...new Set(errors)];
}
function modelSkill(id:string,rank:number,detail=''):Skill {
  const skill=SKILL_BY_ID[id];
  if(!skill)throw new Error('Неизвестный навык создания.');
  return {name:skill.name+(skill.detailLabel&&detail.trim()?': '+detail.trim():''),stat:skill.stat,rank,ip:0,multiplier:skill.multiplier};
}
export function buildCreatedCharacter(draft:CreationDraft,context:CreationContext):CharacterData {
  const errors=validateCreationStep(draft,5,context);
  if(errors.length)throw new Error(errors[0]);
  const role=selectedRole(draft)!;
  const data=blank(draft.name.trim(),role.label);
  data.stats={...draft.stats};
  data.special=role.ability.name;
  data.specialRank=draft.careerRanks[role.ability.id]??0;
  data.humanity=draft.stats.EMP*10;
  data.cash=draft.cash!;
  data.background=draft.history.trim();
  data.skills=[
    ...careerSkillIds(draft).filter(id=>id!==role.ability.id).map(id=>modelSkill(id,draft.careerRanks[id]??0,draft.careerDetails[id]??'')),
    ...draft.pickup.map(item=>modelSkill(item.skillId,item.rank,item.detail)),
    modelSkill('language',8,draft.nativeLanguage),
  ];
  data.notes=`Создание: Core 2020. Бюджет STAT ${draft.budget} утверждён ведущим; Career 40; Pickup ${pickupBudget(draft)}.\nРодной язык: ${draft.nativeLanguage.trim()} +8. Streetslang известен автоматически.\nСтартовые деньги ${draft.cash} eb согласованы с ведущим.${draft.historyLater&&!draft.history.trim()?'\nПредысторию предстоит дописать.':''}\nПокупки, установка имплантов, Humanity Loss и условные бонусы учитываются отдельно.`;
  return data;
}
