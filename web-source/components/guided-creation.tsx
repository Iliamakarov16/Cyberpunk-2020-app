'use client';
import {useBackEvent} from '@/lib/native-navigation';

import React, {useEffect, useId, useRef, useState} from 'react';
import {blank, STATS, STAT_LABELS, type CharacterData, type Stat} from '../lib/tracker';
import {
  CAREER_POINTS, CORE_SKILLS, CREATION_ROLES, MARTIAL_SKILL_IDS, SKILL_BY_ID, WIZARD_STEPS,
  availablePickupSkills, buildCreatedCharacter, careerSkillIds, careerSpent, creationDraft,
  distributeStats, pickupBudget, pickupSpent, selectedRole, statTotal, transferErrors,
  validateCreationStep, type CreationDraft, type CreationUser,
} from '../lib/character-creation';
import {usePlayerSettings,HelpHint} from './player-help';
import {topicForLabel} from '../lib/player-help';

export type GuidedCreationProps = {
  users:CreationUser[];
  isGM:boolean;
  submit:(data:CharacterData,ownerId?:number)=>Promise<void>;
};

const displayNumber = (number:number) => Number.isFinite(number)?String(number):'';
const points = (number:number) => Number.isFinite(number)?String(number):'—';
const inputNumber = (value:string) => value.trim()===''?NaN:Number(value);

function Field({id,label,children,hint}:{id:string;label:string;children:React.ReactNode;hint?:string}){
  const topic=/бюджет/i.test(label)?'method':/стартовые деньги/i.test(label)?'cash':/Родной язык|предыстори/i.test(label)?'lifepath':/Владелец/i.test(label)?'account':topicForLabel(label);
  return <div className="wizard-field"><div className="wizard-field-label"><label htmlFor={id}>{label}</label><HelpHint topic={topic} label={label}/></div>{children}{hint&&<small id={id+'-hint'} className="wizard-field-hint">{hint}</small>}</div>;
}

function OwnerField({id,ownerId,users,setOwner}:{id:string;ownerId?:number;users:CreationUser[];setOwner:(id:number|undefined)=>void}){
  return <Field id={id} label="Владелец листа" hint="Игрок будет видеть и редактировать назначенный ему лист.">
    <select id={id} value={ownerId??''} onChange={event=>setOwner(event.target.value?Number(event.target.value):undefined)} aria-describedby={id+'-hint'}>
      <option value="">Мой аккаунт</option>{users.map(user=><option key={user.id} value={user.id}>{user.username}{user.role==='gm'?' · ведущий':''}</option>)}
    </select>
  </Field>;
}

/** All six steps operate on a local draft; only the final async submit creates a sheet. */
export default function GuidedCreation({users,isGM,submit}:GuidedCreationProps){
  const id=useId();
  const {tutorial}=usePlayerSettings();
  const [mode,setMode]=useState<'guided'|'transfer'>('guided');
  const [step,setStep]=useState(0);
  const [draft,setDraft]=useState<CreationDraft>(creationDraft);
  const [pickupId,setPickupId]=useState('');
  const [roleNotice,setRoleNotice]=useState('');
  const [transferName,setTransferName]=useState('');
  const [transferRole,setTransferRole]=useState('');
  const [transferOwner,setTransferOwner]=useState<number|undefined>();
  const [errors,setErrors]=useState<string[]>([]);
  const [pending,setPending]=useState(false);
  const [finished,setFinished]=useState(false);
  const pendingRef=useRef(false);
  const mountedRef=useRef(true);
  const headingRef=useRef<HTMLHeadingElement>(null);
  const errorRef=useRef<HTMLDivElement>(null);
  const context={users,isGM};
  const role=selectedRole(draft);
  const careerIds=careerSkillIds(draft);
  const usedCareer=careerSpent(draft);
  const usedPickup=pickupSpent(draft);
  const requiredPickup=pickupBudget(draft);

  useEffect(()=>{mountedRef.current=true;return ()=>{mountedRef.current=false;};},[]);
  useEffect(()=>{headingRef.current?.focus();},[step,mode]);
  useEffect(()=>{if(errors.length)errorRef.current?.focus();},[errors]);

  function change(patch:Partial<CreationDraft>){setDraft(current=>({...current,...patch}));setErrors([]);}
  function updateDraft(changeDraft:(current:CreationDraft)=>CreationDraft){setDraft(changeDraft);setErrors([]);}
  useBackEvent('nightcity-form-back',()=>{if(pendingRef.current||finished)return true;if(step>0){navigate(step-1);return true;}return false;});
  function navigate(index:number){if(pendingRef.current||finished)return;setStep(index);setErrors([]);}
  function changeMode(next:'guided'|'transfer'){if(pendingRef.current||finished)return;setMode(next);setErrors([]);}
  function changeRole(roleId:string){
    if(roleId===draft.roleId)return;
    setRoleNotice(draft.roleId&&(careerSpent(draft)>0||draft.pickup.length)?'Роль изменена: карьерные и дополнительные очки нужно распределить заново.':'' );
    change({roleId,careerRanks:{},careerDetails:{},soloCombat:'brawling',techChoices:['','',''],pickup:[]});
    setPickupId('');
  }
  async function save(data:CharacterData,ownerId?:number){
    if(pendingRef.current||finished)return;
    pendingRef.current=true;
    setPending(true);setErrors([]);
    try{
      await submit(data,ownerId);
      if(mountedRef.current)setFinished(true);
    }catch(error){
      if(mountedRef.current)setErrors([error instanceof Error?error.message:'Не удалось создать лист. Данные мастера остались здесь; попробуй ещё раз.']);
    }finally{
      pendingRef.current=false;
      if(mountedRef.current)setPending(false);
    }
  }
  async function handleSubmit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(pendingRef.current||finished)return;
    if(mode==='transfer'){
      const found=transferErrors(transferName,transferRole,transferOwner,context);
      if(found.length){setErrors(found);return;}
      await save(blank(transferName.trim(),transferRole.trim()),isGM?transferOwner:undefined);
      return;
    }
    const found=validateCreationStep(draft,step,context);
    if(found.length){setErrors(found);return;}
    if(step<5){navigate(step+1);return;}
    try{await save(buildCreatedCharacter(draft,context),isGM?draft.ownerId:undefined);}
    catch(error){setErrors([error instanceof Error?error.message:'Проверь данные персонажа.']);}
  }
  function changeCareerChoice(index:number,value:string){
    updateDraft(current=>{
      const choices=[...current.techChoices],old=choices[index];choices[index]=value;
      const ranks={...current.careerRanks};if(old)delete ranks[old];
      return {...current,techChoices:choices,careerRanks:ranks};
    });
  }
  function changeCombat(value:string){
    updateDraft(current=>{
      const ranks={...current.careerRanks};delete ranks[current.soloCombat];
      return {...current,soloCombat:value,careerRanks:ranks};
    });
  }
  function setCareerRank(skillId:string,rank:number){
    updateDraft(current=>({...current,careerRanks:{...current.careerRanks,[skillId]:rank}}));
  }
  function addPickup(){
    if(!pickupId||pendingRef.current)return;
    const chosen=SKILL_BY_ID[pickupId];
    if(!chosen||!availablePickupSkills(draft).some(skill=>skill.id===pickupId))return;
    if(!chosen.detailLabel&&draft.pickup.some(item=>item.skillId===pickupId))return;
    updateDraft(current=>({...current,pickup:[...current.pickup,{skillId:pickupId,rank:1,detail:''}]}));
    setPickupId('');
  }
  function updatePickup(index:number,patch:{rank?:number;detail?:string}){
    updateDraft(current=>({...current,pickup:current.pickup.map((item,row)=>row===index?{...item,...patch}:item)}));
  }
  const available=availablePickupSkills(draft).filter(skill=>skill.detailLabel||!draft.pickup.some(item=>item.skillId===skill.id));
  const reviewErrors=step===5?validateCreationStep(draft,5,context):[];

  return <div className="wizard-root">
    <div className="wizard-modes" role="group" aria-label="Способ создания листа">
      <button type="button" aria-pressed={mode==='guided'} disabled={pending||finished} onClick={()=>changeMode('guided')}>Создать с подсказками</button>
      <button type="button" aria-pressed={mode==='transfer'} disabled={pending||finished} onClick={()=>changeMode('transfer')}>Перенести готовый лист</button>
    </div>

    {errors.length>0&&<div className="wizard-errors" role="alert" tabIndex={-1} ref={errorRef}><strong>Проверь перед продолжением</strong><ul>{errors.map((error,index)=><li key={index}>{error}</li>)}</ul></div>}
    {finished&&<p className="wizard-success" role="status">Лист создан. Можно открыть его и добавить экипировку.</p>}

    <form className="wizard-form" onSubmit={handleSubmit} noValidate>
      <fieldset className="wizard-fields" disabled={pending||finished}>
      {mode==='transfer'?<>
        <h2 className="wizard-step-title" ref={headingRef} tabIndex={-1}>Перенести готовый лист</h2>
        <p className="wizard-required">Создадим пустой лист: перенеси в него данные готового персонажа после создания. Стартовые лимиты мастера к готовому листу не применяются.</p>
        <div className="wizard-grid">
          <Field id={id+'-transfer-name'} label="Имя или позывной"><input id={id+'-transfer-name'} value={transferName} maxLength={80} autoComplete="off" onChange={event=>{setTransferName(event.target.value);setErrors([]);}} /></Field>
          <Field id={id+'-transfer-role'} label="Роль"><input id={id+'-transfer-role'} value={transferRole} maxLength={80} placeholder="Например, Соло" autoComplete="off" onChange={event=>{setTransferRole(event.target.value);setErrors([]);}} /></Field>
          {isGM&&<OwnerField id={id+'-transfer-owner'} ownerId={transferOwner} users={users} setOwner={ownerId=>{setTransferOwner(ownerId);setErrors([]);}}/>}
        </div>
        <p className="wizard-source">Этот режим не импортирует файл и не заменяет существующего персонажа.</p>
      </>:<>
        <ol className="wizard-progress" aria-label="Шаги создания персонажа">{WIZARD_STEPS.map((title,index)=><li key={title} className={index===step?'wizard-current':index<step?'wizard-complete':''}>
          <button type="button" onClick={()=>navigate(index)} disabled={index>=step||pending||finished} aria-current={index===step?'step':undefined} aria-label={`Шаг ${index+1}: ${title}${index<step?' — вернуться':''}`}><span>{String(index+1).padStart(2,'0')}</span><small>{title}</small></button>
        </li>)}</ol>
        <div className="wizard-step-heading"><span className="wizard-step-count">Шаг {step+1} / 6</span><h2 className="wizard-step-title" ref={headingRef} tabIndex={-1}>{WIZARD_STEPS[step]}</h2></div>

        {step===0&&<section className="wizard-step" aria-label="Личность персонажа">
          <p className="wizard-required">Начнём с позывного и того, чем персонаж занимается. Роль определит десять карьерных навыков.</p>
          <div className="wizard-grid">
            <Field id={id+'-name'} label="Имя или позывной"><input id={id+'-name'} value={draft.name} maxLength={80} autoComplete="off" onChange={event=>change({name:event.target.value})}/></Field>
            <Field id={id+'-role'} label="Роль персонажа" hint="Смена роли сбросит распределение карьерных и дополнительных навыков.">
              <select id={id+'-role'} value={draft.roleId} onChange={event=>changeRole(event.target.value)} aria-describedby={id+'-role-hint'}><option value="">Выбери роль</option>{CREATION_ROLES.map(item=><option key={item.id} value={item.id}>{item.label} · {item.english}</option>)}</select>
            </Field>
            {isGM&&<OwnerField id={id+'-owner'} ownerId={draft.ownerId} users={users} setOwner={ownerId=>change({ownerId})}/>}
          </div>
          {role&&<div className="wizard-role-summary"><strong>{role.label}</strong><p>{role.summary}</p><span>Особая способность: {role.ability.name} ({role.ability.english})</span></div>}
          {roleNotice&&<p className="wizard-change-notice" role="status">{roleNotice}</p>}
          {tutorial&&<div className="wizard-tutorial"><p>Роль — основная профессия. Она не запрещает учиться другим навыкам: для них позже будут отдельные Pickup Points. Специальная способность принадлежит выбранной роли.</p><p>Если персонаж уже создан по другим правилам, воспользуйся «Перенести готовый лист».</p></div>}
          <p className="wizard-source">Core 2020, стр. 43–46.</p>
        </section>}

        {step===1&&<section className="wizard-step" aria-label="Распределение характеристик">
          <p className="wizard-required">Введи бюджет, который утвердил ведущий. Каждая базовая STAT — целое число от 2 до 10. Нужна точная сумма бюджета.</p>
          <div className="wizard-grid">
            <Field id={id+'-budget'} label="Общий бюджет STAT" hint="Бюджет вводится явно; приложение не выбирает его за вашу группу."><input id={id+'-budget'} type="number" inputMode="numeric" min={18} max={90} step={1} value={draft.budget===null?'':displayNumber(draft.budget)} placeholder="Названный ведущим бюджет" onChange={event=>change({budget:event.target.value===''?null:inputNumber(event.target.value),budgetConfirmed:false})} aria-describedby={id+'-budget-hint'}/></Field>
            <div className="wizard-budget-actions"><button type="button" disabled={draft.budget===null||!Number.isInteger(draft.budget)||draft.budget<18||draft.budget>90} onClick={()=>{if(draft.budget!==null)change({stats:distributeStats(draft.budget)});}}>Заполнить равномерно</button><small>Затем можно перераспределить очки.</small></div>
          </div>
          <label className="wizard-checkbox"><input type="checkbox" checked={draft.budgetConfirmed} onChange={event=>change({budgetConfirmed:event.target.checked})}/><span>{isGM?'Я утвердил этот бюджет для кампании.':'Ведущий утвердил этот бюджет.'}</span></label>
          <div className="wizard-points" aria-live="polite"><strong>STAT {points(statTotal(draft))} / {draft.budget===null?'бюджет не задан':points(draft.budget)}</strong><span>Осталось {draft.budget===null?'—':points(draft.budget-statTotal(draft))}</span></div>
          <div className="wizard-stat-grid">{STATS.map(stat=><Field key={stat} id={id+'-stat-'+stat} label={`${stat} · ${STAT_LABELS[stat]}`}><input id={id+'-stat-'+stat} type="number" inputMode="numeric" min={2} max={10} step={1} value={displayNumber(draft.stats[stat])} onChange={event=>updateDraft(current=>({...current,stats:{...current.stats,[stat]:inputNumber(event.target.value)}}))}/></Field>)}</div>
          {tutorial&&<div className="wizard-tutorial"><p>STAT показывает базовую способность, а навык — подготовку. INT помогает разбираться в информации; REF — двигаться и стрелять; TECH — работать с техникой; COOL — выдерживать давление; ATTR — производить впечатление; LUCK — влиять на броски; MA — перемещаться; BODY — переносить нагрузки; EMP — понимать людей.</p><p>Core предлагает сумму 9d10, девять отдельных d10 с перебросом 1–2 или бюджет ведущего. Для кинематографических персонажей указаны 50, 60, 70, 75 и 80 очков; способ выбирает ведущий.</p></div>}
          <p className="wizard-source">Core 2020, стр. 25–29. Пределы относятся к созданию персонажа до кибернетики.</p>
        </section>}

        {step===2&&<section className="wizard-step" aria-label="Карьерные навыки">
          <p className="wizard-required">Распредели ровно 40 Career Points между специальной способностью и девятью навыками роли. Каждый ранг от 0 до 10; один ранг стоит одно стартовое очко.</p>
          <div className="wizard-points" aria-live="polite"><strong>Career {points(usedCareer)} / {CAREER_POINTS}</strong><span>Осталось {points(CAREER_POINTS-usedCareer)}</span></div>
          {role?.id==='solo'&&<Field id={id+'-combat'} label="Карьерный рукопашный навык Solo"><select id={id+'-combat'} value={draft.soloCombat} onChange={event=>changeCombat(event.target.value)}>{['brawling',...MARTIAL_SKILL_IDS].map(skillId=><option key={skillId} value={skillId}>{SKILL_BY_ID[skillId].name} · {SKILL_BY_ID[skillId].english}</option>)}</select></Field>}
          {role?.id==='techie'&&<div className="wizard-tech-choices"><p>Выбери три разных дополнительных TECH-навыка:</p>{[0,1,2].map(index=><Field key={index} id={id+'-tech-'+index} label={`TECH-навык ${index+1}`}><select id={id+'-tech-'+index} value={draft.techChoices[index]??''} onChange={event=>changeCareerChoice(index,event.target.value)}><option value="">Выбери навык</option>{CORE_SKILLS.filter(skill=>skill.stat==='TECH'&&!role.career.includes(skill.id)).map(skill=><option key={skill.id} value={skill.id} disabled={draft.techChoices.some((chosen,other)=>other!==index&&chosen===skill.id)}>{skill.name}</option>)}</select></Field>)}</div>}
          <div className="wizard-skills">{careerIds.map(skillId=>{
            const skill=SKILL_BY_ID[skillId];if(!skill)return null;
            const rankId=id+'-career-'+skillId;
            return <div className={'wizard-skill-row'+(skill.special?' wizard-special':'')} key={skillId}>
              <Field id={rankId} label={skill.name} hint={`${skill.english} · ${skill.special?'особая способность':skill.stat} · IP ×${skill.multiplier}`}><input id={rankId} className="wizard-rank" type="number" inputMode="numeric" min={0} max={10} step={1} value={displayNumber(draft.careerRanks[skillId]??0)} onChange={event=>setCareerRank(skillId,inputNumber(event.target.value))} aria-describedby={rankId+'-hint'}/></Field>
              {skill.detailLabel&&<Field id={rankId+'-detail'} label={skill.detailLabel}><input id={rankId+'-detail'} maxLength={60} value={draft.careerDetails[skillId]??''} onChange={event=>updateDraft(current=>({...current,careerDetails:{...current.careerDetails,[skillId]:event.target.value}}))}/></Field>}
            </div>;
          })}</div>
          {tutorial&&<div className="wizard-tutorial"><p>Не обязательно вкладывать очки в каждый навык, но оставшийся без подготовки навык будет слабее. Вклад в Special Ability входит в эти же 40 очков.</p><p>IP ×2, ×3 и ×4 — стоимость последующего обучения за IP. Этот множитель не увеличивает стоимость ранга при стартовом распределении Core.</p></div>}
          <p className="wizard-source">Core 2020, стр. 43–44, 46, 51–54.</p>
        </section>}

        {step===3&&<section className="wizard-step" aria-label="Дополнительные навыки">
          <p className="wizard-required">Pickup Points = базовые INT + REF. Потрать их на навыки вне карьерного набора: они не повышают Career Skills.</p>
          <div className="wizard-points" aria-live="polite"><strong>Pickup {points(usedPickup)} / {points(requiredPickup)}</strong><span>Осталось {points(requiredPickup-usedPickup)}</span></div>
          <div className="wizard-add-skill"><Field id={id+'-pickup-choice'} label="Дополнительный навык"><select id={id+'-pickup-choice'} value={pickupId} onChange={event=>setPickupId(event.target.value)}><option value="">Выбери навык</option>{STATS.map(stat=>{const group=available.filter(skill=>skill.stat===stat);return group.length?<optgroup key={stat} label={`${stat} · ${STAT_LABELS[stat]}`}>{group.map(skill=><option key={skill.id} value={skill.id}>{skill.name} · IP ×{skill.multiplier}</option>)}</optgroup>:null;})}</select></Field><button type="button" disabled={!pickupId||draft.pickup.length>=30} onClick={addPickup}>Добавить навык</button></div>
          {!draft.pickup.length&&<p className="wizard-empty">Добавь навыки из жизни вне профессии: вождение, первую помощь, язык или другую подготовку.</p>}
          <div className="wizard-skills">{draft.pickup.map((item,index)=>{
            const skill=SKILL_BY_ID[item.skillId];if(!skill)return null;
            const rankId=id+'-pickup-'+index;
            return <div className="wizard-skill-row" key={index}>
              <Field id={rankId} label={skill.name} hint={`${skill.english} · ${skill.stat} · IP ×${skill.multiplier}`}><input id={rankId} className="wizard-rank" type="number" inputMode="numeric" min={1} max={10} step={1} value={displayNumber(item.rank)} onChange={event=>updatePickup(index,{rank:inputNumber(event.target.value)})} aria-describedby={rankId+'-hint'}/></Field>
              {skill.detailLabel&&<Field id={rankId+'-detail'} label={skill.detailLabel}><input id={rankId+'-detail'} maxLength={60} value={item.detail} onChange={event=>updatePickup(index,{detail:event.target.value})}/></Field>}
              <button type="button" className="wizard-remove" aria-label={`Убрать дополнительный навык «${skill.name}»`} onClick={()=>updateDraft(current=>({...current,pickup:current.pickup.filter((_,row)=>row!==index)}))}>Убрать</button>
            </div>;
          })}</div>
          {tutorial&&<div className="wizard-tutorial"><p>Для языка, экспертных знаний и инструмента укажи конкретную область. Разные языки — отдельные навыки. Родной язык бесплатно даётся на +8 на следующем шаге, поэтому не трать на него очки здесь.</p><p>Карьерные навыки скрыты в списке. Чтобы их улучшить при создании, вернись на шаг «Профессия».</p></div>}
          <p className="wizard-source">Core 2020, стр. 34, 46–53.</p>
        </section>}

        {step===4&&<section className="wizard-step" aria-label="История персонажа и ресурсы">
          <p className="wizard-required">Родной язык даётся на +8 без расхода очков. Деньги введи по договорённости с ведущим. Начальная Humanity будет EMP × 10 = {points(draft.stats.EMP*10)}.</p>
          <div className="wizard-grid">
            <Field id={id+'-language'} label="Родной язык"><input id={id+'-language'} value={draft.nativeLanguage} maxLength={60} placeholder="Например, русский" onChange={event=>change({nativeLanguage:event.target.value})}/></Field>
            <Field id={id+'-cash'} label="Согласованные стартовые деньги, eb"><input id={id+'-cash'} type="number" inputMode="numeric" min={0} max={1e12} step={1} value={draft.cash===null?'':displayNumber(draft.cash)} placeholder="Сумма от ведущего" onChange={event=>change({cash:event.target.value===''?null:inputNumber(event.target.value),cashConfirmed:false})}/></Field>
          </div>
          <label className="wizard-checkbox"><input type="checkbox" checked={draft.cashConfirmed} onChange={event=>change({cashConfirmed:event.target.checked})}/><span>{isGM?'Я утвердил эту стартовую сумму.':'Эту стартовую сумму согласовали с ведущим.'}</span></label>
          <Field id={id+'-history'} label="Основа предыстории" hint="Происхождение, семья, важный человек, ценности и событие, которое привело персонажа к команде."><textarea id={id+'-history'} value={draft.history} maxLength={6000} rows={6} onChange={event=>change({history:event.target.value})} aria-describedby={id+'-history-hint'}/></Field>
          <label className="wizard-checkbox"><input type="checkbox" checked={draft.historyLater} onChange={event=>change({historyLater:event.target.checked})}/><span>Я допишу предысторию с ведущим позже.</span></label>
          {tutorial&&<div className="wizard-tutorial"><p>Lifepath помогает придумать прошлое: стиль и происхождение, семью, мотивы, затем события по годам после 16. Streetslang персонаж знает автоматически.</p><p>По Core начальные деньги зависят от роли, ранга Special Ability и броска d6. Мы оставляем итоговую сумму ведущему: мастер не бросает деньги, не покупает вещи и не устанавливает импланты.</p><p>Каждые полные 10 накопленных потерь Humanity уменьшают EMP на 1. Покупка импланта сама по себе здесь ничего не списывает.</p></div>}
          <p className="wizard-source">Core 2020, стр. 29, 33–40, 58–59, 73–75.</p>
        </section>}

        {step===5&&<section className="wizard-step" aria-label="Проверка перед созданием">
          <p className="wizard-required">Проверь лист. «Создать персонажа» сохранит его для выбранного владельца. Экипировку и импланты добавляют после создания.</p>
          {reviewErrors.length>0&&<div className="wizard-review-warning"><strong>Есть незавершённые шаги</strong><ul>{reviewErrors.map((error,index)=><li key={index}>{error}</li>)}</ul><p>Вернись по кнопкам шагов и исправь поля.</p></div>}
          <dl className="wizard-review-summary"><div><dt>Позывной</dt><dd>{draft.name||'—'}</dd></div><div><dt>Роль</dt><dd>{role?.label??'—'}</dd></div><div><dt>Владелец</dt><dd>{draft.ownerId===undefined?'Мой аккаунт':users.find(user=>user.id===draft.ownerId)?.username??'Неизвестен'}</dd></div><div><dt>Special Ability</dt><dd>{role?.ability.name??'—'} · {role?points(draft.careerRanks[role.ability.id]??0):'—'}</dd></div><div><dt>STAT</dt><dd>{points(statTotal(draft))} / {draft.budget===null?'—':points(draft.budget)}</dd></div><div><dt>Career / Pickup</dt><dd>{points(usedCareer)} / 40 · {points(usedPickup)} / {points(requiredPickup)}</dd></div><div><dt>Начальная Humanity</dt><dd>{points(draft.stats.EMP*10)}</dd></div><div><dt>Стартовые деньги</dt><dd>{draft.cash===null?'—':points(draft.cash)} eb</dd></div><div><dt>Родной язык</dt><dd>{draft.nativeLanguage||'—'} +8</dd></div></dl>
          <div className="wizard-review-stats">{STATS.map(stat=><span key={stat}>{stat}<strong>{points(draft.stats[stat])}</strong></span>)}</div>
          <details className="wizard-review-details"><summary>Посмотреть навыки</summary><ul>{careerIds.filter(skillId=>!SKILL_BY_ID[skillId]?.special).map(skillId=><li key={'career-'+skillId}>{SKILL_BY_ID[skillId]?.name}{draft.careerDetails[skillId]?': '+draft.careerDetails[skillId]:''}: {points(draft.careerRanks[skillId]??0)}</li>)}{draft.pickup.map((item,index)=><li key={'pickup-'+index}>{SKILL_BY_ID[item.skillId]?.name}{item.detail?': '+item.detail:''}: {points(item.rank)}</li>)}<li>Родной язык: {draft.nativeLanguage||'—'}: +8</li></ul></details>
          {draft.history.trim()&&<details className="wizard-review-details"><summary>Посмотреть предысторию</summary><p className="wizard-history-preview">{draft.history}</p></details>}
          {role&&(draft.careerRanks[role.ability.id]??0)===0&&<p className="wizard-review-warning">Special Ability осталась на 0. В Core таблица окладов начинается с ранга 1–5; стартовые деньги для такого персонажа отдельно согласуй с ведущим.</p>}
          {tutorial&&<div className="wizard-tutorial"><p>Общего «уровня героя» здесь нет. После игры ведущий выдаёт IP для отдельных навыков. Броня, модификаторы и временные эффекты относятся к игровому листу, а не к этому стартовому распределению.</p><p>Обучение можно отключить в настройках; обязательные проверки и предупреждения останутся.</p></div>}
        </section>}
      </>}
      </fieldset>
      <div className="wizard-footer">
        {mode==='guided'&&step>0&&<button type="button" disabled={pending||finished} onClick={()=>navigate(step-1)}>Назад</button>}
        <button className="primary wizard-next" type="submit" disabled={pending||finished} aria-busy={pending}>{pending?'Сохраняю…':finished?'Лист создан':mode==='transfer'?'Создать пустой лист':step===5?'Создать персонажа':'Далее'}</button>
      </div>
      {pending&&<p className="wizard-pending" role="status">Сохраняем лист. Подожди завершения.</p>}
    </form>
  </div>;
}
