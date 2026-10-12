'use client';
import React, { useEffect, useRef, useState } from 'react';
import { TRAINING_RULING_FIELDS, trainingLoadoutGroups, trainingLoadoutDemoChoices, trainingLoadoutRequiredRulings, trainingLoadoutSetupError } from '@/lib/firefight/training-loadout.mjs';

const touch = { minHeight: 44, minWidth: 0 };
const fieldTouch = { ...touch, width: '100%' };
const checkTouch = { ...touch, display: 'flex', alignItems: 'center', gap: 10 };
const modes = [['single', 'Одиночные'], ['burst', 'Очередь из трёх'], ['auto', 'Автоогонь']];
const classLabel = value => value === 'automatic' ? 'автоматический' : value === 'nonautomatic' ? 'неавтоматический' : 'не выбран';
const numberDraft = value => value.trim() === '' ? '' : Number(value);

/** Training/GM authority and dialog navigation belong to the caller. This form
 * submits one pinned batch and never edits sheets, magazines or readiness. */
export default function TrainingLoadoutSetup({ scene, onConfirm, onCancel, onDirty, disabled = false }) {
    const [snapshot] = useState(() => JSON.parse(JSON.stringify(scene)));
    const [grouping] = useState(() => trainingLoadoutGroups(snapshot));
    const [choices, setChoices] = useState(() => grouping.groups.map(group => ({ weaponId: group.weaponId, fireModes: [], singleActionCap: '', fumbleClass: '' })));
    const [rulings, setRulings] = useState(() => ({ ...snapshot.settings?.cp2020Rulings }));
    const [baseline] = useState(() => JSON.stringify({ choices, rulings }));
    const [reviewed, setReviewed] = useState(false), [sending, setSending] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('');
    const submitting = useRef(false), committed = useRef(false), dirtyRef = useRef(onDirty);
    const stale = scene.id !== snapshot.id || scene.version !== snapshot.version;
    const currentError = trainingLoadoutGroups(scene).error;
    const locked = disabled || sending || saved || stale || !!currentError || !!grouping.error;
    const dirty = !saved && (reviewed || JSON.stringify({ choices, rulings }) !== baseline);
    useEffect(() => { dirtyRef.current = onDirty; }, [onDirty]);
    useEffect(() => { dirtyRef.current?.(dirty); }, [dirty]);
    useEffect(() => () => { dirtyRef.current?.(false); }, []);
    const validation = trainingLoadoutSetupError(snapshot, choices, rulings);
    const required = trainingLoadoutRequiredRulings(snapshot, choices);
    const fields = TRAINING_RULING_FIELDS.filter(field => required.includes(field.key) || Object.hasOwn(rulings, field.key));
    const changed = () => { setReviewed(false); setError(''); };
    const patchChoice = (weaponId, patch) => { if (!locked) { setChoices(previous => previous.map(choice => choice.weaponId === weaponId ? { ...choice, ...patch } : choice)); changed(); } };
    const patchRuling = (key, value) => {
        if (locked) return;
        setRulings(previous => { const next = { ...previous }; if (value === '') delete next[key]; else next[key] = value; return next; }); changed();
    };
    const chooseDemo = () => {
        if (locked) return;
        const next = trainingLoadoutDemoChoices(grouping.groups);
        setChoices(next);
        // A click explicitly accepts the displayed demo proposal. Keep all prior
        // rulings, including any deliberately different saved agreements.
        setRulings(previous => ({
            ...previous,
            ...(trainingLoadoutRequiredRulings(snapshot, next).includes('nonautomaticFumbleAmmo') && !Object.hasOwn(previous, 'nonautomaticFumbleAmmo') ? { nonautomaticFumbleAmmo: 'consume-attempted' } : {}),
            ...(trainingLoadoutRequiredRulings(snapshot, next).includes('jamAmmo') && !Object.hasOwn(previous, 'jamAmmo') ? { jamAmmo: 'consume-declared' } : {}),
        }));
        changed();
    };
    const confirm = async () => {
        if (locked || submitting.current || committed.current || !reviewed || validation || typeof onConfirm !== 'function') return;
        submitting.current = true; setSending(true); setError('');
        try {
            const result = await onConfirm({ type: 'prepare-training-loadouts', battleId: snapshot.id, expectedVersion: snapshot.version, choices: choices.map(choice => ({ ...choice, fireModes: [...choice.fireModes] })), rulings: { ...rulings } });
            if (!result || result.ok === false || result.error) setError(result?.error || 'Подготовка не подтверждена. Проверь связь и состояние сцены.');
            else { committed.current = true; setSaved(true); }
        } catch (failure) { setError(failure?.message || 'Не удалось подтвердить подготовку. Попробуй снова после проверки связи.'); }
        finally { submitting.current = false; setSending(false); }
    };
    return <section className="training-loadout-setup combat-adjudication" aria-label="Учебное оружие и соглашения" data-training-loadout-draft={dirty ? 'true' : 'false'} style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
        <p className="adjudication-help">Подтверди учебное оружие сцены одним действием. Числа из источника уже сверены; режимы и класс ошибки выбираешь ты как ГМ. Реальные листы, текущие магазины и общий запас не меняются.</p>
        {grouping.error || currentError ? <p role="alert" className="adjudication-warning">{grouping.error || currentError}</p> : null}
        {stale && <p role="alert" className="adjudication-warning">Сцена изменилась. Закрой и снова открой подготовку, чтобы проверить свежие данные. Текущий черновик не отправлен.</p>}
        {!!grouping.groups.length && <>
            <div className="training-demo-proposal">
                <strong>Учебный вариант, требующий твоего решения</strong>
                <p className="adjudication-help">Оба типа: только одиночные, 1 выстрел за действие. Colt: неавтоматический класс ошибки; Ronin: автоматический. При обычной ошибке списываются предпринятые выстрелы, при задержке автоматики — все объявленные. Это выбор для демо, а не вывод о режимах из таблицы core.</p>
                <button type="button" className="small-button" style={touch} disabled={locked} onClick={chooseDemo}>Выбрать учебный вариант</button>
            </div>
            {grouping.groups.map(group => {
                const choice = choices.find(row => row.weaponId === group.weaponId);
                return <fieldset className="training-weapon-group" key={group.weaponId} disabled={locked} style={{ minWidth: 0 }}>
                    <legend>{group.name} · {group.actors.length} участника</legend>
                    <p className="training-weapon-source">{group.source} · {group.damageDice}d6{group.damageBonus ? '+' + group.damageBonus : ''} · WA {group.accuracy >= 0 ? '+' : ''}{group.accuracy} · {group.range} м · ROF {group.rof} · магазин {group.magazine} · {group.reliability}</p>
                    <ul>{group.actors.map(actor => <li key={actor.id}>{actor.name}: заряжено {actor.loaded}/{group.magazine}, всего {actor.total} · {group.skillName} {actor.skillRank}</li>)}</ul>
                    <p className="adjudication-help">Режимы: {choice.fireModes.length ? modes.filter(([mode]) => choice.fireModes.includes(mode)).map(([, label]) => label).join(', ') : 'не выбраны'}. Одиночных за действие: {choice.singleActionCap === '' ? 'не выбрано' : choice.singleActionCap}. Класс ошибки: {classLabel(choice.fumbleClass)}.</p>
                    <details><summary style={touch}>Изменить выбор · {group.name}</summary>
                        <div role="group" aria-label={'Режимы · ' + group.name}>{modes.map(([mode, label]) => <label className="adjudication-check" key={mode} style={checkTouch}><input type="checkbox" aria-label={group.name + ' · ' + label} checked={choice.fireModes.includes(mode)} disabled={locked || mode === 'burst' && group.rof < 3} onChange={event => {
                            const fireModes = modes.map(([id]) => id).filter(id => id === mode ? event.target.checked : choice.fireModes.includes(id));
                            patchChoice(group.weaponId, { fireModes, singleActionCap: fireModes.includes('single') ? (choice.fireModes.includes('single') ? choice.singleActionCap : '') : 0 });
                        }}/><span>{label}{mode === 'burst' && group.rof < 3 ? ' · нужен ROF ≥ 3' : ''}</span></label>)}</div>
                        {choice.fireModes.includes('single') && <label className="adjudication-field"><span>Предел одиночных за действие · 1–{group.rof}</span><input type="number" inputMode="numeric" min={1} max={group.rof} step={1} style={fieldTouch} disabled={locked} aria-label={group.name + ' · одиночных за действие'} value={choice.singleActionCap} onChange={event => patchChoice(group.weaponId, { singleActionCap: numberDraft(event.target.value) })}/></label>}
                        <label className="adjudication-field"><span>Класс оружия для критической ошибки</span><select style={fieldTouch} disabled={locked} aria-label={group.name + ' · класс ошибки'} value={choice.fumbleClass} onChange={event => patchChoice(group.weaponId, { fumbleClass: event.target.value })}><option value="">Выбери явно</option><option value="nonautomatic">Неавтоматическое · обычная таблица ошибки</option><option value="automatic">Автоматическое · проверка задержки по VR</option></select></label>
                    </details>
                </fieldset>;
            })}
            {!!grouping.preserved.length && <p className="adjudication-help">Сохранённые профили остаются без изменений: {grouping.preserved.map(actor => actor.name || actor.id).join(', ')}.</p>}
            <fieldset className="training-rulings" disabled={locked} style={{ minWidth: 0 }}><legend>Проверь соглашения сцены</legend>
                <p className="adjudication-help">Явные решения для неоднозначных мест CP2020. Показаны нужные выбранным режимам и уже сохранённые соглашения.</p>
                {!fields.length && <p className="adjudication-help">После выбора режимов и класса ошибки здесь появятся применимые решения.</p>}
                {fields.map(field => <label className="adjudication-field" key={field.key}><span>{field.label}{required.includes(field.key) ? ' · обязательно' : ' · сохранено'}</span>{field.choices ? <select style={fieldTouch} disabled={locked} aria-label={field.label} value={rulings[field.key] ?? ''} onChange={event => patchRuling(field.key, event.target.value)}><option value="">Не выбрано</option>{field.choices.map(([choice, label]) => <option key={choice} value={choice}>{label}</option>)}</select> : <input type="number" inputMode="text" min={field.min} max={field.max} step={1} style={fieldTouch} disabled={locked} aria-label={field.label} value={rulings[field.key] ?? ''} onChange={event => patchRuling(field.key, numberDraft(event.target.value))}/>}<small className="adjudication-help">{field.help}</small></label>)}
            </fieldset>
            {validation && <p role="status" className="adjudication-help">{validation}</p>}
            <label className="adjudication-check training-loadout-review" style={checkTouch}><input type="checkbox" style={{ width: 22, height: 22, flexShrink: 0 }} aria-label="Подтверждение учебных профилей ГМом" checked={reviewed} disabled={locked || !!validation} onChange={event => { if (!locked) setReviewed(event.target.checked); }}/><span>Как ГМ проверил источник, режимы, предел за действие, классы ошибки и соглашения. Подтверждаю для всех перечисленных участников.</span></label>
        </>}
        {!grouping.error && !grouping.groups.length && <p role="status" className="adjudication-help">Учебное оружие уже подготовлено. Существующие профили сохранены.</p>}
        {error && <p role="alert" className="adjudication-warning">{error}</p>}
        {saved && <p role="status" className="adjudication-help">Учебная подготовка подтверждена.</p>}
        <div className="adjudication-actions training-loadout-actions"><button type="button" className="small-button" style={touch} disabled={disabled || sending} onClick={() => { if (!disabled && !sending) onCancel?.(); }}>Назад</button><button type="button" className="primary-button" style={touch} disabled={locked || !reviewed || !!validation || typeof onConfirm !== 'function'} onClick={confirm}>{sending ? 'Подтверждаем…' : 'Подтвердить учебное оружие'}</button></div>
    </section>;
}
