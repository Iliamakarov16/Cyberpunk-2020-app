'use client';
import React, { useRef, useState } from 'react';

// Match shared_battle.validate_melee_ruling / battle_ranged.RULING_CHOICES.
// These controls collect GM decisions. They never roll, infer a best skill,
// calculate damage, or mutate the scene themselves.
const DEFENSE_KINDS = ['melee', 'fencing', 'martialArts', 'dodge', 'athletics'];
const MELEE_REQUIRED = ['defenseSkillName', 'defenseSkillKind', 'defenderAware', 'attackModifier', 'defenseModifier'];
const MELEE_OPTIONAL = ['punchRounding', 'attackTechniqueBonus', 'defenseTechniqueBonus'];
const touch = { minHeight: 44, minWidth: 0 };
const fieldTouch = { ...touch, width: '100%' };
const checkTouch = { ...touch, display: 'flex', alignItems: 'center', gap: 8 };
const integer = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const numericDraft = value => value.trim() === '' ? '' : Number.isFinite(Number(value)) ? Number(value) : value;
const skillKey = skill => JSON.stringify([skill.kind, skill.name]);

function attackSkill(actor, technique, skillName) {
    if (!actor || !['punch', 'kick', 'weapon'].includes(technique)) return null;
    const name = skillName ?? (technique === 'weapon' ? actor.weapon?.skillName : '');
    if (typeof name !== 'string' || name.length > 100) return null;
    if (technique === 'weapon' && (actor.weapon?.kind !== 'melee' || name !== actor.weapon.skillName)) return null;
    const kinds = technique === 'weapon' ? ['melee', 'fencing', 'martialArts'] : ['brawling', 'martialArts'];
    if (name === '') {
        const kind = technique === 'weapon' ? actor.weapon?.skillKind : 'brawling';
        return kinds.includes(kind) && kind !== 'martialArts' ? { kind, name, rank: 0 } : null;
    }
    const matches = (actor.meleeSkills || []).filter(skill => skill.name === name);
    return matches.length === 1 && kinds.includes(matches[0].kind) && integer(matches[0].rank, 0, 10) && (technique !== 'weapon' || matches[0].kind === actor.weapon.skillKind) ? matches[0] : null;
}

/** Validate only the explicit ruling and selected attack skill. The authoritative
 * preview must still validate the actual defender, reach, state, and command. */
export function meleeRulingReady(value, actor, technique, skillName) {
    if (!record(value) || MELEE_REQUIRED.some(key => !has(value, key)) || Object.keys(value).some(key => !MELEE_REQUIRED.includes(key) && !MELEE_OPTIONAL.includes(key))) return false;
    if (typeof value.defenseSkillName !== 'string' || value.defenseSkillName.length > 100 || !DEFENSE_KINDS.includes(value.defenseSkillKind) || value.defenderAware !== true) return false;
    if (value.defenseSkillName !== '' && !value.defenseSkillName.trim() || value.defenseSkillKind === 'martialArts' && !value.defenseSkillName.trim()) return false;
    if (!integer(value.attackModifier, -30, 30) || !integer(value.defenseModifier, -30, 30)) return false;
    if (has(value, 'punchRounding') && !['down', 'up'].includes(value.punchRounding) || technique === 'punch' && !['down', 'up'].includes(value.punchRounding)) return false;
    const selected = attackSkill(actor, technique, skillName);
    if (!selected) return false;
    for (const [key, kind] of [['attackTechniqueBonus', selected.kind], ['defenseTechniqueBonus', value.defenseSkillKind]]) {
        if (kind === 'martialArts' ? !integer(value[key], 0, 4) : has(value, key)) return false;
    }
    return true;
}

function NumberField({ label, value, onChange, min, max, disabled = false, hint }) {
    return <label className="adjudication-field"><span>{label}</span><input type="number" inputMode={min < 0 ? 'text' : 'numeric'} step="1" min={min} max={max} value={value ?? ''} aria-label={label} aria-invalid={value !== undefined && value !== '' && !integer(value, min, max)} disabled={disabled} style={fieldTouch} onChange={event => onChange(numericDraft(event.target.value))}/>{hint && <small className="adjudication-help">{hint}</small>}</label>;
}

/** skillName is the attack's explicit selected skill, never its highest skill. */
export function MeleeRuling({ actor, target, technique, value, onChange, skillName, disabled = false }) {
    const ruling = record(value) ? value : {};
    const selectedAttack = attackSkill(actor, technique, skillName);
    const skills = (target?.meleeSkills || []).filter(skill => DEFENSE_KINDS.includes(skill.kind) && typeof skill.name === 'string' && skill.name.trim() && skill.name.length <= 100 && integer(skill.rank, 0, 10) && target.meleeSkills.filter(other => other.name === skill.name).length === 1);
    const defenses = [{ kind: 'dodge', name: '', rank: 0 }, ...skills];
    const defense = defenses.find(skill => skill.kind === ruling.defenseSkillKind && skill.name === ruling.defenseSkillName);
    const update = patch => { if (!disabled) onChange({ ...ruling, ...patch }); };
    const chooseDefense = key => {
        if (disabled) return;
        const next = { ...ruling };
        delete next.defenseTechniqueBonus;
        const choice = defenses.find(skill => skillKey(skill) === key);
        if (choice) { next.defenseSkillName = choice.name; next.defenseSkillKind = choice.kind; }
        else { delete next.defenseSkillName; delete next.defenseSkillKind; }
        onChange(next);
    };
    return <fieldset className="combat-adjudication melee-ruling" disabled={disabled}>
        <legend>Рукопашная · решение ГМа</legend>
        <label className="adjudication-field"><span>Защита: {target?.name || 'цель'}</span><select aria-label="Навык защиты" style={fieldTouch} value={defense ? skillKey(defense) : ''} onChange={event => chooseDefense(event.target.value)}>
            <option value="">Выбери защиту явно</option>
            {defenses.map(skill => <option key={skillKey(skill)} value={skillKey(skill)}>{skill.name ? skill.name + ' · ' + skill.rank : 'Без навыка · только REF'}</option>)}
        </select></label>
        <label className="adjudication-check" style={checkTouch}><input type="checkbox" checked={ruling.defenderAware === true} onChange={event => update({ defenderAware: event.target.checked })}/><span>Защитник осознаёт атаку</span></label>
        <div className="adjudication-fields">
            <NumberField label="Модификатор атаки" value={ruling.attackModifier} min={-30} max={30} onChange={attackModifier => update({ attackModifier })}/>
            <NumberField label="Модификатор защиты" value={ruling.defenseModifier} min={-30} max={30} onChange={defenseModifier => update({ defenseModifier })}/>
        </div>
        <button type="button" className="small-button" style={touch} onClick={() => update({ attackModifier: 0, defenseModifier: 0 })}>Обычные условия · 0 / 0</button>
        {technique === 'punch' && <label className="adjudication-field"><span>Удар рукой · округление d6/2</span><select aria-label="Округление удара рукой" value={ruling.punchRounding || ''} style={fieldTouch} onChange={event => {
            if (disabled) return;
            const next = { ...ruling };
            if (event.target.value) next.punchRounding = event.target.value; else delete next.punchRounding;
            onChange(next);
        }}><option value="">Соглашение не выбрано</option><option value="down">Вниз</option><option value="up">Вверх</option></select><small className="adjudication-help">В core указан d6/2 без направления округления. Нужен явный выбор.</small></label>}
        {selectedAttack?.kind === 'martialArts' && <NumberField label={'Бонус приёма атаки · ' + selectedAttack.name} value={ruling.attackTechniqueBonus} min={0} max={4} onChange={attackTechniqueBonus => update({ attackTechniqueBonus })} hint="Проверь бонус конкретного приёма этого стиля; 0 тоже нужно подтвердить."/>}
        {defense?.kind === 'martialArts' && <NumberField label={'Бонус приёма защиты · ' + defense.name} value={ruling.defenseTechniqueBonus} min={0} max={4} onChange={defenseTechniqueBonus => update({ defenseTechniqueBonus })} hint="Бонус выбранного стиля: 0–4. Сам стиль не включает парирование предметом."/>}
        <details><summary style={touch}>Границы этой проверки</summary><p className="adjudication-help">REF + выбранный навык + d10 с обеих сторон; ничья в пользу защитника. Штраф за предыдущие действия атакующего считает сервер. Здесь укажи только дополнительные модификаторы.</p><p className="adjudication-help">Засада, активное уклонение, парирование предметом и особые приёмы требуют отдельного разбора. Эта форма не включает их автоматически.</p></details>
        {(!defense || !meleeRulingReady(ruling, actor, technique, skillName)) && <small className="adjudication-help" role="status">До броска выбери защиту и подтверди все применимые поля.</small>}
        <button type="button" className="small-button" style={touch} onClick={() => { if (!disabled) onChange(null); }}>Сбросить решение</button>
    </fieldset>;
}

export function throughRulingReady(value) {return record(value)&&value.throughTargetKnown===true&&integer(value.throughModifier,-30,30);}
export function ThroughCoverRuling({value,onChange,disabled=false}) {
    const ruling=record(value)?value:{};
    return <fieldset className="combat-adjudication" disabled={disabled}><legend>Прострел · решение ГМа</legend>
      <label style={checkTouch}><input type="checkbox" checked={ruling.throughTargetKnown===true} onChange={e=>onChange({...ruling,throughTargetKnown:e.target.checked})}/><span>Подтверждаю допустимость атаки и известное стрелку положение цели</span></label>
      <NumberField label="Модификатор обстоятельств прострела" value={ruling.throughModifier} min={-30} max={30} disabled={disabled} onChange={throughModifier=>onChange({...ruling,throughModifier})}/>
      <button type="button" className="small-button" style={touch} onClick={()=>onChange({...ruling,throughModifier:0})}>Подтвердить отсутствие дополнительного штрафа · 0</button>
      <small className="adjudication-help">Единого штрафа для любого невидимого противника core не задаёт. Проверь осведомлённость и обстоятельства; это не автоматическая засада. Материальный SP считается отдельно.</small>
    </fieldset>;
}
export function ProtectionReview({value,actors=[]}) {return value?.length?<details className="combat-adjudication"><summary style={touch}>Защита по траектории · проверка ГМа</summary>{value.map(target=><div key={target.targetId}><strong>{actors.find(a=>a.id===target.targetId)?.name||'Цель'}</strong>{target.zones.map(zone=><p key={zone.location}>{({head:'Голова',torso:'Торс',rightArm:'Правая рука',leftArm:'Левая рука',rightLeg:'Правая нога',leftLeg:'Левая нога'})[zone.location]}: броня {zone.armorSP}{zone.steps.map(step=>' → укрытие '+step.outerSP).join('')} → итоговый SP {zone.effectiveSP}</p>)}</div>)}</details>:null;}

const RULES = [
    {key:'coverArmorWear',label:'Броня за укрытием · необязательный износ',choices:[['none','Не списывать SP носимой брони автоматически'],['body','При пробитии суммарной защиты списать 1 SP носимой брони']],help:'Core не уточняет износ компонентов пропорциональной защиты. Это явное соглашение при включённом Staged Penetration; SP укрытия автоматически не меняется.'},
    { key: 'burstHitRounding', label: 'Очередь · округление попаданий d6/2', choices: [['floor', 'Вниз'], ['ceil', 'Вверх']], help: 'Core печатает 1d6/2 попаданий для трёхпатронной очереди, не задавая округление.' },
    { key: 'autoTenRoundGroups', label: 'Автоогонь · неполные десятки патронов', choices: [['floor', 'Считать только полные десятки'], ['ceil', 'Неполную десятку считать полной']], help: 'Для неполной группы из 10 патронов направление округления модификатора требует соглашения.' },
    { key: 'autoModifierBasis', label: 'Автоогонь · база модификатора по нескольким целям', choices: [['allocated', 'Патроны, выделенные каждой цели'], ['declared', 'Все объявленные патроны']], help: 'Текст не уточняет однозначно, считать модификатор от всей очереди или от доли конкретной цели.' },
    { key: 'autoReducedRounds', label: 'Автоогонь · уменьшенная очередь', choices: [['allow-declared', 'Разрешить объявленное число патронов']], help: 'Явно разрешает очередь короче оставшегося ROF, в том числе из неполного магазина; это соглашение сцены.' },
    { key: 'autoAllocationRemainder', label: 'Автоогонь · остаток при делении между целями', choices: [['consume-unallocated', 'Списать нераспределённый остаток']], help: 'Цели получают равные доли с округлением вниз. Это соглашение задаёт расход оставшихся объявленных патронов.' },
    { key: 'jamAmmo', label: 'Задержка автоматики · расход патронов', choices: [['consume-declared', 'Списать все объявленные патроны']], help: 'Core не задаёт точное число патронов, выпущенных до задержки. Списание всей заявки является явным соглашением, не числом реально сделанных выстрелов.' },
    { key: 'nonautomaticFumbleAmmo', label: 'Обычная критическая ошибка · расход патронов', choices: [['consume-attempted', 'Списать только предпринятые выстрелы']], help: 'При результате таблицы 5–10 действие прерывается. Дополнительный случайный выстрел и его патрон требуют отдельного разбора ГМа.' },
    { key: 'punchRounding', label: 'Удар рукой · округление d6/2', choices: [['down', 'Вниз'], ['up', 'Вверх']], help: 'Core указывает урон d6/2, но не направление округления. Сохранённое соглашение применяется к следующим ударам рукой.' },
];

export function rulesProfileReady(value) {
    return record(value) && Object.entries(value).every(([key, choice]) => key === 'autoPointBlankModifier' ? integer(choice, -100, 100) : RULES.some(rule => rule.key === key && rule.choices.some(([option]) => option === choice)));
}

/** Controlled scene.settings.cp2020Rulings draft; persistence is the caller's job. */
export function RulesProfileEditor({ value, onChange, disabled = false }) {
    const profile = record(value) ? value : {};
    const update = (key, choice) => {
        if (disabled) return;
        const next = { ...profile };
        if (choice === '') delete next[key]; else next[key] = choice;
        onChange(next);
    };
    return <details className="combat-adjudication rules-profile-editor"><summary style={touch}>Соглашения CP2020 · {Object.keys(profile).length} выбрано</summary>
        <p className="adjudication-help">Это явные решения ГМа для неоднозначных мест core, а не правила по умолчанию. Незаполненное поле остаётся неопределённым. Сохрани профиль сцены; применимые соглашения попадут в запись следующего броска.</p>
        <fieldset disabled={disabled}><legend>Профиль этой сцены</legend>
            {RULES.map(rule => <label className="adjudication-field" key={rule.key}><span>{rule.label}</span><select style={fieldTouch} aria-label={rule.label} value={profile[rule.key] ?? ''} aria-invalid={has(profile, rule.key) && !rule.choices.some(([choice]) => choice === profile[rule.key])} onChange={event => update(rule.key, event.target.value)}><option value="">Не выбрано</option>{rule.choices.map(([choice, label]) => <option key={choice} value={choice}>{label}</option>)}</select><small className="adjudication-help">{rule.help}</small></label>)}
            <NumberField label="Автоогонь в упор · модификатор" value={profile.autoPointBlankModifier} min={-100} max={100} onChange={choice => update('autoPointBlankModifier', choice)} hint="Core не задаёт этот модификатор. Не подставляется бонус ближней дистанции. Пустое поле означает «не выбрано»; 0 — отдельное явное решение."/>
            {!rulesProfileReady(profile) && <p role="alert" className="adjudication-warning">Проверь соглашения: допустимы только перечисленные варианты и целый модификатор от −100 до 100.</p>}
            <button type="button" className="small-button" style={touch} onClick={() => { if (!disabled) onChange({}); }}>Сбросить соглашения</button>
        </fieldset>
    </details>;
}

const FUMBLE_LABELS = {
    'dropped-weapon': 'выпадение оружия', 'accidental-discharge': 'случайный выстрел',
    'jam-or-embedded': 'заклинило или застряло', 'self-injury': 'ранение себя',
    'ally-injury': 'ранение союзника', jam: 'задержка оружия', none: 'без дополнительных последствий',
};

function FumbleReceipt({ entry, actors }) {
    const receipt = entry?.receipt || {};
    const fumbles = receipt.fumbles || receipt.resolution?.fumbles || [];
    return <div className="fumble-receipt" aria-label="Сохранённый результат критической ошибки"><strong>Результат броска сохранён</strong>
        {fumbles.length ? <ul>{fumbles.map((fumble, index) => {
            const roll = fumble.fumbleTableRoll ?? fumble.roll;
            const side = fumble.side === 'attack' ? 'Атака' : fumble.side === 'defense' ? 'Защита' : actors.find(actor => actor.id === fumble.targetId)?.name || 'Огневое действие';
            return <li key={index}>{side}{roll != null ? ' · таблица d10: ' + roll : fumble.reliabilityRoll != null ? ' · надёжность d10: ' + fumble.reliabilityRoll : ' · натуральная 1'}{fumble.effectCode && FUMBLE_LABELS[fumble.effectCode] ? ' · ' + FUMBLE_LABELS[fumble.effectCode] : ''}{fumble.side && roll >= 5 ? ' · нужен разбор ГМа' : ''}</li>;
        })}</ul> : <p className="adjudication-help">Подробности таблицы в этой записи отсутствуют. Проверь исходный бросок перед решением.</p>}
        {Number.isInteger(receipt.bulletsSpent) && <small className="adjudication-help">Уже списано патронов: {receipt.bulletsSpent}{Number.isInteger(receipt.unexecutedRounds) && receipt.unexecutedRounds > 0 ? ' · не выполнено: ' + receipt.unexecutedRounds : ''}</small>}
    </div>;
}

function effectsReady(effects, actors) {
    return effects.length <= 20 && new Set(effects.map(effect => effect.actorId)).size === effects.length && effects.every(effect => actors.some(actor => actor.id === effect.actorId) && integer(effect.finalDamage, 0, 1000) && integer(effect.additionalActions, 0, 10) && typeof effect.dropWeapon === 'boolean' && (!has(effect, 'finalStatus') || ['stunned', 'dead'].includes(effect.finalStatus)));
}

function FumbleReviewForm({ entry, actors, onResolve, disabled }) {
    const [note, setNote] = useState(''), [effects, setEffects] = useState([]), [sending, setSending] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('');
    const sendingRef = useRef(false);
    const locked = disabled || sending || saved;
    const ready = typeof entry.commandId === 'string' && !!entry.commandId.trim() && note.trim().length > 0 && note.length <= 1000 && effectsReady(effects, actors);
    const changeEffect = (index, patch) => { if (!locked) setEffects(previous => previous.map((effect, at) => at === index ? { ...effect, ...patch } : effect)); };
    const resolve = async () => {
        if (locked || sendingRef.current || !ready || typeof onResolve !== 'function') return;
        sendingRef.current = true; setSending(true); setError('');
        try {
            const result = await onResolve({ type: 'resolve-fumble', sourceCommandId: entry.commandId, note: note.trim(), effects: effects.map(effect => ({ ...effect })) });
            if (result === false || result === null || result?.ok === false || result?.error) setError(result?.error || 'Решение не сохранено. Проверь связь и состояние сцены.');
            else if (result !== undefined) setSaved(true);
        } catch (failure) {
            setError(failure?.message || 'Решение не сохранено. Проверь связь и попробуй снова.');
        } finally { sendingRef.current = false; setSending(false); }
    };
    return <section className="combat-adjudication fumble-review" aria-label="Разбор критической ошибки">
        <FumbleReceipt entry={entry} actors={actors}/>
        <p className="adjudication-warning">Последствия ожидают решения ГМа. Дополнительные выстрелы, расход патронов, поломки и другие неподдержанные изменения нельзя закрыть одной заметкой: оставь разбор открытым либо отмени исходное действие.</p>
        <fieldset disabled={locked}><legend>Подтверждённые последствия</legend>
            <label className="adjudication-field"><span>Решение ГМа · обязательно</span><textarea aria-label="Решение ГМа" rows={2} maxLength={1000} style={fieldTouch} value={note} onChange={event => { if (!locked) setNote(event.target.value); }} placeholder="Что произошло и какие последствия проверены"/></label>
            <small className="adjudication-help">Без численных последствий можно оставить список пустым, явно объяснив решение. Никакие эффекты не выбираются по таблице автоматически.</small>
            {effects.map((effect, index) => <fieldset className="fumble-effect" key={index}><legend>Последствие {index + 1}</legend>
                <label className="adjudication-field"><span>Участник</span><select aria-label={'Участник последствия ' + (index + 1)} style={fieldTouch} value={effect.actorId} onChange={event => changeEffect(index, { actorId: event.target.value })}><option value="">Выбери участника</option>{actors.map(actor => <option key={actor.id} value={actor.id} disabled={effects.some((other, at) => at !== index && other.actorId === actor.id)}>{actor.name || actor.id}</option>)}</select></label>
                <div className="adjudication-fields">
                    <NumberField label={'Итоговые ранения · ' + (index + 1)} min={0} max={1000} value={effect.finalDamage} onChange={finalDamage => changeEffect(index, { finalDamage })}/>
                    <NumberField label={'Дополнительные действия · ' + (index + 1)} min={0} max={10} value={effect.additionalActions} onChange={additionalActions => changeEffect(index, { additionalActions })} hint="Добавляется к уже потраченным действиям и усиливает штраф следующих."/>
                </div>
                <small className="adjudication-help">Ранения уже после брони, BTM и множителя зоны. Они прибавятся к текущим; приложение не угадывает броню и не вычитает её повторно. Проверку оглушения выполнит сервер.</small>
                <label className="adjudication-check" style={checkTouch}><input type="checkbox" checked={effect.dropWeapon} onChange={event => changeEffect(index, { dropWeapon: event.target.checked })}/><span>Выпало текущее оружие</span></label>
                <label className="adjudication-field"><span>Итоговое состояние</span><select aria-label={'Итоговое состояние · ' + (index + 1)} style={fieldTouch} value={effect.finalStatus || ''} onChange={event => {
                    if (locked) return;
                    const status = event.target.value;
                    setEffects(previous => previous.map((current, at) => { if (at !== index) return current; const next = { ...current }; if (status) next.finalStatus = status; else delete next.finalStatus; return next; }));
                }}><option value="">Без отдельного решения</option><option value="stunned">Оглушён</option><option value="dead">Мёртв</option></select></label>
                <button type="button" className="small-button" style={touch} aria-label={'Убрать последствие ' + (index + 1)} onClick={() => { if (!locked) setEffects(previous => previous.filter((_, at) => at !== index)); }}>Убрать последствие</button>
            </fieldset>)}
            <button type="button" className="small-button" style={touch} disabled={locked || effects.length >= Math.min(20, actors.length)} onClick={() => { if (!locked && effects.length < Math.min(20, actors.length)) setEffects(previous => [...previous, { actorId: '', finalDamage: 0, dropWeapon: false, additionalActions: 0 }]); }}>Добавить последствие</button>
        </fieldset>
        {error && <p role="alert" className="adjudication-warning">{error}</p>}
        {saved && <p role="status" className="adjudication-help">Решение записано; ожидаем обновление сцены.</p>}
        <div className="adjudication-actions"><button type="button" className="primary-button" style={touch} disabled={locked || !ready || typeof onResolve !== 'function'} onClick={resolve}>{sending ? 'Записываем…' : 'Записать решение ГМа'}</button></div>
    </section>;
}

/** A different pending command gets a fresh draft, never another roll's effects. */
export function FumbleReview({ entry, actors = [], onResolve, disabled = false }) {
    return entry ? <FumbleReviewForm key={entry.commandId} entry={entry} actors={actors} onResolve={onResolve} disabled={disabled}/> : null;
}
