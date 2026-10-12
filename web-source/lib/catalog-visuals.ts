// Visual/search classification only. Does not change book statistics or item rules.
import type {CatalogEntry} from './catalog';

export const CATALOG_VISUALS = [
 'pistol','revolver','smg','rifle','shotgun','sniper','heavyweapon',
 'knife','katana','baton','grenade','ammo','armor','jacket',
 'shirt','pants','boots','helmet','glasses','deck','radio',
 'cybereye','cyberarm','cyberleg','trauma','tools','chip','gear',
] as const;
export type CatalogVisual = typeof CATALOG_VISUALS[number];

const normalize=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[^\p{L}\p{N}+]+/gu,' ').trim();
const stringFact=(entry:CatalogEntry,key:string)=>typeof entry.facts[key]==='string'?normalize(entry.facts[key] as string):'';

// A shape can differ from the broad printed weapon type (e.g. revolvers are P).
// These overrides identify models, not additional combat mechanics.
const VISUAL_OVERRIDES:Record<string,CatalogVisual>={
 'core-s-w-combat-magnum':'revolver',
 'core-llama-commanche':'revolver',
 'core-colt-45-peacemaker':'revolver',
 'core-colt-38-detective':'revolver',
 'core-winchester-m70':'sniper',
 'core-barrett-arasaka-light-20mm':'sniper',
 'cb2-militech-cyborg-rifle':'sniper',
 'cb2-militech-am-3-anti-matter-rifle':'sniper',
 'cb4-shock-touch-gloves':'tools',
 'cb4-stun-knuks':'baton',
};

export function catalogIsProgram(entry:CatalogEntry):boolean {
 const {facts}=entry;
 return entry.category==='gear'&&(stringFact(entry,'kind')==='software'||stringFact(entry,'subtype')==='software'||stringFact(entry,'subtype')==='net program'||Array.isArray(facts.programClass));
}
export function catalogIsDeck(entry:CatalogEntry):boolean {
 if(entry.category!=='gear')return false;
 const name=normalize(entry.name);
 if(/\b(battery|accessory|accessories|upgrade|trode|trodes|printer|chipreader|scanner|vox box|security system|datawalls|code gates)\b/.test(name)||stringFact(entry,'subtype')==='cybermodem accessory')return false;
 return stringFact(entry,'kind')==='cyberdeck'||stringFact(entry,'kind')==='cybermodem'||stringFact(entry,'subtype')==='cyberdeck'||Object.hasOwn(entry.facts,'deckSpeed')||/\b(cyberdeck|cybermodem)\b/.test(name)||(/\bdeck\b/.test(name)&&stringFact(entry,'family')==='netgear'&&!/upgrade|trode|printer|reader|vox|scanner/.test(name));
}

export function catalogVisualIcon(entry:CatalogEntry):CatalogVisual {
 const name=normalize(entry.name),type=stringFact(entry,'type'),group=stringFact(entry,'group'),family=stringFact(entry,'family');
 if(VISUAL_OVERRIDES[entry.id])return VISUAL_OVERRIDES[entry.id];
 if(entry.category==='ammo')return 'ammo';
 if(entry.category==='weapon') {
  if(/\b(revolver|super chief)\b/.test(name))return 'revolver';
  if(/\b(grenade|grenades|mine|explosive|explosives|det card)\b/.test(name)&&!/\b(launcher|layer)\b/.test(name))return 'grenade';
  if(/\b(monokatana|katana|sword|powersword|mono two|naginata)\b/.test(name))return 'katana';
  if(/\b(knife|monoknife|chainknife|switchblade|spawnblade|spring knife|monowhip)\b/.test(name))return 'knife';
  if(/\b(club|baton|tonfa|nunchaku|knuckles|sledgehammer|battleglove)\b/.test(name))return 'baton';
  if(type==='p'||type==='mp')return 'pistol';
  if(type.startsWith('smg'))return 'smg';
  if(type==='sht'||type==='shg')return 'shotgun';
  if(type==='rif')return /\b(sniper|marksman)\b/.test(name)?'sniper':'rifle';
  if(type==='grn'||type==='rgrn')return 'grenade';
  if(type==='hvy'||type==='lmg'||type==='mrl'||type.startsWith('mgl'))return 'heavyweapon';
  if(type==='m'||type==='mel'||type==='melee')return 'baton';
  if(/\b(pistol|handgun|derringer|taser)\b/.test(name))return 'pistol';
  if(/submachine|sub machine|\bsmg\b/.test(name))return 'smg';
  if(/shotgun/.test(name))return 'shotgun';
  if(/rifle/.test(name))return 'rifle';
  return 'heavyweapon';
 }
 if(entry.category==='cyber') {
  if(Object.hasOwn(entry.facts,'chipType')||/\b(chip|chipware|chipslot|chipslots)\b/.test(name))return 'chip';
  if(group==='cyberoptics'||/cyberopt|\b(eye|eyes|optic|optics|teleoptics|telescopics|microscopics|thermograph|infrared|low lite|anti dazzle)\b/.test(name))return 'cybereye';
  if(group==='feet'||/cyberleg|\b(leg|legs|foot|feet|heel)\b/.test(name))return 'cyberleg';
  return 'cyberarm';
 }
 if(entry.category==='clothing'||entry.category==='armor') {
  if(/\b(helmet|hat|cap|beret|hood)\b/.test(name)||entry.slot==='head')return 'helmet';
  if(/\b(glasses|goggles|sunglasses|visor|lenses)\b/.test(name)||entry.slot==='eyes'||entry.slot==='face')return 'glasses';
  if(/\b(boot|boots|halfboots|shoe|shoes|sneaker|sneakers)\b/.test(name)||entry.slot==='feet'||entry.slot==='foot')return 'boots';
  if(/\b(pants|jeans|trousers|leggings|skirt|miniskirt|shorts)\b/.test(name)||entry.slot==='legs')return 'pants';
  if(/\b(jacket|duster|coat|cape|vest|topcoat)\b/.test(name)||entry.slot==='outer'||entry.slot==='outerTorso'||entry.slot==='outerwear')return 'jacket';
  if(/\b(shirt|blouse|t shirt|sweater|tunic|bra|tank)\b/.test(name)||entry.slot==='inner'||entry.slot==='innerTorso')return 'shirt';
  if(entry.category==='armor'||/\b(armor|armour|metalgear)\b/.test(name))return 'armor';
  if(/\b(glove|gloves)\b/.test(name)||entry.slot==='hands'||entry.slot==='hand')return 'tools';
  return 'gear';
 }
 if(catalogIsProgram(entry)||Object.hasOwn(entry.facts,'chipType')||/\b(chip|chipware|memory compression)\b/.test(name))return 'chip';
 if(catalogIsDeck(entry))return 'deck';
 if(family==='communications'||/\b(radio|phone|telephone|cellular|communicator|transceiver|communications|walkie)\b/.test(name))return 'radio';
 if(family==='medical'||family==='fictional drug'||/\b(medkit|med kit|first aid|trauma|medical|medtech|surgical|surgery|diagnostic|diagnostics)\b/.test(name))return 'trauma';
 if(family==='tools'||/\b(tool|tools|toolkit|tool kit|repair kit|welding|torch|welder|scalpel)\b/.test(name))return 'tools';
 if(/\b(glasses|goggles|sunglasses|binoculars)\b/.test(name))return 'glasses';
 return 'gear';
}

const CATEGORY_ALIASES:Record<string,string>={
 weapon:'оружие вооружение',ammo:'боеприпасы патроны пули снаряды',cyber:'кибернетика киберимплант имплант хром',
 clothing:'одежда гардероб',armor:'броня бронежилет защита',gear:'снаряжение оборудование вещь вещи',
 vehicle:'транспорт машина автомобиль',service:'услуга сервис',
};
const VISUAL_ALIASES:Record<CatalogVisual,string>={
 pistol:'пистолет пистолеты пистолетный',revolver:'револьвер револьверы',smg:'пистолет пулемет пп автоматическое',
 rifle:'винтовка винтовки автомат штурмовая',shotgun:'дробовик дробовики ружье дробь',sniper:'винтовка снайперская снайпер дальнобойная',heavyweapon:'тяжелое оружие пулемет гранатомет ракетомет',
 knife:'нож ножи клинок лезвие мононить',katana:'катана меч мечи моно катана',baton:'ближний бой дубинка рукопашное кастет',grenade:'граната гранаты взрывчатка взрывное мина',ammo:'боеприпасы патроны пули',
 armor:'броня бронежилет бронекостюм',jacket:'куртка куртки пальто плащ жилет верхняя одежда',shirt:'рубашка футболка блузка свитер майка',pants:'брюки штаны джинсы юбка шорты',boots:'обувь ботинки сапоги кроссовки',helmet:'шлем головной убор шапка шляпа',glasses:'очки оптика визор бинокль',
 deck:'кибердека дека кибермодем нетраннер нетраннинг сеть',radio:'связь радио телефон коммуникатор рация',cybereye:'киберглаз киберглаза кибероптика зрение глаза',cyberarm:'имплант',cyberleg:'кибернога киберноги стопа ноги',trauma:'медицина аптечка меднабор лечение лекарство',tools:'инструменты инструмент ремонт технабор',chip:'чип чипы чипвер программное обеспечение',gear:'снаряжение оборудование',
};
const BRANDS:[RegExp,string][]=[
 [/militech/i,'милитех милитек'],[/arasaka/i,'арасака'],[/kendachi/i,'кендачи'],[/zetatech/i,'зетатех'],[/raven/i,'рейвен'],
 [/budget ?arms/i,'бюджет армс'],[/malorian/i,'малориан'],[/techtronica/i,'техтроника'],[/dai lung/i,'дай лунг'],
 [/federated arms/i,'федератед армс'],[/sternmeyer/i,'штернмейер'],[/tsunami/i,'цунами'],[/dynalar/i,'диналар'],
];
const PROGRAM_ALIASES:Record<string,string>={
 'anti ic':'против программ защита лед', 'anti system':'против систем система', 'anti personnel':'против человека атака человека',
 'detection':'обнаружение поиск', 'alarm':'сигнализация', 'intrusion':'взлом проникновение', 'decryption':'расшифровка дешифровка',
 'encryption':'шифрование', 'controller':'контроллер управление устройством', 'protection':'защита', 'evasion':'уклонение', 'utility':'утилита',
 'demon':'демон', 'daemon':'даймон демон', 'ai':'искусственный интеллект ии',
};

export function catalogSearchAliases(entry:CatalogEntry):string {
 const aliases=[CATEGORY_ALIASES[entry.category]??'',VISUAL_ALIASES[catalogVisualIcon(entry)]];
 const bookNumber=/^cb([1-4])$/.exec(entry.source.bookId)?.[1];
 if(bookNumber)aliases.push(`хромбук хромбук${bookNumber} хромбуки ${bookNumber}`);
 else if(entry.source.bookId==='core')aliases.push('основная книга базовая книга киберпанк cyberpunk 2020');
 if(entry.id==='core-stripwire-binders')aliases.push('striptape binders наручники');
 if(entry.id.startsWith('cb1-goncz-taurus-pistol'))aliases.push('goncz tarus гонц таурус');
 for(const [test,alias] of BRANDS)if(test.test(entry.name))aliases.push(alias);
 if(catalogIsProgram(entry)) {
  aliases.push('программа программы софт нетраннинг нетраннер кибердека');
  const classes=normalize(`${entry.facts.class??''} ${Array.isArray(entry.facts.programClass)?entry.facts.programClass.join(' '):entry.facts.programClass??''}`);
  for(const [term,alias] of Object.entries(PROGRAM_ALIASES))if(classes.includes(term))aliases.push(alias);
 }
 const group=stringFact(entry,'group'),kind=stringFact(entry,'kind'),name=normalize(entry.name);
 if(entry.category==='cyber'&&(group==='hands'||/cyberarm|\b(arm|arms|hand|hands|shoulder)\b/.test(name)))aliases.push('киберрука киберруки рука руки киберконечность');
 if(group==='neuralware'||/neural|processor|reflex/.test(name)&&entry.category==='cyber')aliases.push('нейропроцессор нейронный рефлексы нейро');
 if(group==='cyberaudio'||/cyberaudio/.test(name))aliases.push('кибераудио слух ухо');
 if(group==='bioware')aliases.push('биотехнология биомодификация биовар');
 if(group==='fashionware')aliases.push('внешность косметика стиль фэшн');
 if(kind.startsWith('animal cyberware'))aliases.push('животное животные питомец питомцы киберживотное');
 if(kind==='full body conversion'||entry.facts.fullBodyConversion===true)aliases.push('полная конверсия киборг борг');
 if(/\b(bow|crossbow|c bow|x bow)\b/.test(name)&&entry.category==='weapon')aliases.push('лук арбалет');
 if(entry.category==='weapon'&&/kalishnikov|kalashnikov|\bakr 20\b|\bak 47\b/.test(name))aliases.push('калашников калаш ак47 ак 47');
 if(/\b(glove|gloves)\b/.test(name))aliases.push('перчатки');
 if(/\b(dress|jumpsuit)\b/.test(name))aliases.push('платье комбинезон');
 return aliases.join(' ');
}

export function catalogMatchesQuery(entry:CatalogEntry,query:string,sourceLabel=''):boolean {
 const tokens=normalize(query).split(/\s+/).filter(Boolean);
 if(!tokens.length)return true;
 // Numeric book facts stay searchable; Russian aliases do not invent translated mechanics.
 const haystack=normalize(`${entry.name} ${entry.id} ${sourceLabel} ${JSON.stringify(entry.facts)} ${catalogSearchAliases(entry)}`);
 return tokens.every(token=>haystack.includes(token));
}

export function catalogVariantLabel(entry:CatalogEntry):string {
 const labels:string[]=[];
 if(stringFact(entry,'kind').startsWith('animal cyberware'))labels.push('Для животных');
 if(catalogIsProgram(entry))labels.push(/daemon example/i.test(String(entry.facts.class??''))?'Пример Daemon':'NET-программа');
 if(catalogIsDeck(entry))labels.push('Кибердека / кибермодем');
 const visualVariants:Record<string,string>={'retractable':'Выдвижная версия','standard':'Стандарт','higher quality':'Повышенное качество','manual':'Ручное управление','cyber':'Киберуправление','high style':'High style','Arms (both)':'Обе руки','Legs (both)':'Обе ноги','Head':'Голова','Shoulders/Upper chest':'Плечи / верх груди'};
 if(typeof entry.facts.variant==='string')labels.push(visualVariants[entry.facts.variant]??entry.facts.variant);
 if(typeof entry.facts.grade==='string')labels.push(visualVariants[entry.facts.grade]??entry.facts.grade);
 if(typeof entry.facts.control==='string')labels.push(visualVariants[entry.facts.control]??entry.facts.control);
 if(typeof entry.facts.area==='string')labels.push(visualVariants[entry.facts.area]??entry.facts.area);
 if(typeof entry.facts.flavors==='number')labels.push(`${entry.facts.flavors} вкусов`);
 if(typeof entry.facts.style==='string')labels.push(visualVariants[entry.facts.style]??entry.facts.style);
 if(typeof entry.facts.chipType==='string')labels.push(entry.facts.chipType);
 if(typeof entry.facts.kind==='string'&&entry.facts.kind==='full-body conversion')labels.push('Полная конверсия');
 return labels.join(' · ');
}
