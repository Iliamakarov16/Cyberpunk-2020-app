'use client';
import React, { useEffect, useRef, useState } from 'react';

export const COVER_ZONE_OPTIONS = Object.freeze([
    ['head', 'Голова'], ['torso', 'Торс'], ['leftArm', 'Левая рука'],
    ['rightArm', 'Правая рука'], ['leftLeg', 'Левая нога'], ['rightLeg', 'Правая нога'],
].map(option => Object.freeze(option)));
const PROP_LABELS = { table: 'Стол', counter: 'Стойка', barrel: 'Бочка', crate: 'Ящик', car: 'Машина', van: 'Фургон' };
const BASE_FIELDS = ['material', 'sp'];
const PROP_FIELDS = [...BASE_FIELDS, 'coveredZones', 'blocksVision', 'movable', 'flippedCoveredZones', 'flippedBlocksVision'];
const touch = { minHeight: 44, minWidth: 44 };
const fieldTouch = { minHeight: 44, minWidth: 0, width: '100%', boxSizing: 'border-box' };
const checkTouch = { minHeight: 44, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 };
const checkBox = { width: 22, height: 22, flexShrink: 0 };
const groupStyle = { minWidth: 0, margin: '12px 0', padding: 12 };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const integer = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
const isTile = target => record(target) && !Object.hasOwn(target, 'propId') && ['wall', 'door'].includes(target.type);
const numericDraft = value => value.trim() === '' ? '' : Number.isFinite(Number(value)) ? Number(value) : value;
const fingerprint = value => JSON.stringify(value, (_, item) => record(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const targetIdentity = target => !record(target) ? null : Object.hasOwn(target, 'propId') ? [target.propId, target.type] : [target.x, target.y, target.type];

function targetError(target) {
    if (isTile(target)) return integer(target.x, 0, Number.MAX_SAFE_INTEGER) && integer(target.y, 0, Number.MAX_SAFE_INTEGER) ? null : 'Выбери клетку стены или двери.';
    return record(target) && typeof target.propId === 'string' && !!target.propId.trim() && Object.hasOwn(PROP_LABELS, target.type) ? null : 'Выбери предмет, стену или дверь для настройки.';
}

/** Only validates the explicit GM profile; the server still checks authority,
 * scene version and the target. Vision is independent from ballistic SP. */
export function coverProfileError(target, profile) {
    const invalidTarget = targetError(target);
    if (invalidTarget) return invalidTarget;
    const fields = isTile(target) ? BASE_FIELDS : PROP_FIELDS;
    if (!record(profile) || fields.some(key => !Object.hasOwn(profile, key)) || Object.keys(profile).some(key => !fields.includes(key))) return 'Профиль должен содержать только поля материала и выбранного типа укрытия.';
    if (typeof profile.material !== 'string' || !profile.material.trim() || profile.material.length > 100) return 'Укажи материал: от 1 до 100 символов.';
    if (!integer(profile.sp, 0, 1000)) return 'Укажи SP материала целым числом от 0 до 1000. Ноль тоже нужно выбрать явно.';
    if (isTile(target)) return null;
    for (const key of ['coveredZones', 'flippedCoveredZones']) {
        const zones = profile[key];
        if (!Array.isArray(zones) || new Set(zones).size !== zones.length || zones.some(zone => !COVER_ZONE_OPTIONS.some(([id]) => id === zone))) return 'Выбери зоны тела из списка, без повторов.';
    }
    if (['blocksVision', 'movable', 'flippedBlocksVision'].some(key => typeof profile[key] !== 'boolean')) return 'Явно проверь видимость и возможность перемещения предмета.';
    if (profile.movable && target.type !== 'table') return 'Двигать и опрокидывать разрешается только стол.';
    return null;
}

function initialDraft(target, profile) {
    if (profile != null) return copy(profile);
    const base = { material: '', sp: '' };
    return isTile(target) ? base : { ...base, coveredZones: [], blocksVision: false, movable: false, flippedCoveredZones: [], flippedBlocksVision: false };
}

function ZoneChoices({ label, value, disabled, onChange }) {
    const selected = Array.isArray(value) ? value : [];
    return <div role="group" aria-label={label} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0 12px' }}>
        {COVER_ZONE_OPTIONS.map(([zone, name]) => <label className="adjudication-check" style={checkTouch} key={zone}>
            <input type="checkbox" style={checkBox} aria-label={label + ' · ' + name} checked={selected.includes(zone)} disabled={disabled} onChange={event => onChange(COVER_ZONE_OPTIONS.map(([id]) => id).filter(id => id === zone ? event.target.checked : selected.includes(id)))}/><span>{name}</span>
        </label>)}
    </div>;
}

/** Caller owns navigation, dirty-discard confirmation, GM access and versioned
 * transport. onConfirm receives { target, profile }; target is a pinned copy,
 * including display type/name. Strip those when forming the server command.
 * A remount is required after the target or its source profile changes. */
export default function CoverProfileEditor({ target, profile, onConfirm, onCancel, onDirty, disabled = false }) {
    const [snapshot] = useState(() => ({ target: copy(target), profile: copy(profile ?? null) }));
    const [draft, setDraft] = useState(() => initialDraft(snapshot.target, snapshot.profile));
    const [baseline] = useState(() => fingerprint(draft));
    const [reviewed, setReviewed] = useState(false), [sending, setSending] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('');
    const submitting = useRef(false), committed = useRef(false), mounted = useRef(false), dirtyRef = useRef(onDirty), live = useRef(null);
    const tile = isTile(snapshot.target), table = !tile && snapshot.target?.type === 'table';
    const stale = !saved && (fingerprint(targetIdentity(target)) !== fingerprint(targetIdentity(snapshot.target)) || fingerprint(profile ?? null) !== fingerprint(snapshot.profile));
    const validation = coverProfileError(snapshot.target, draft);
    const locked = disabled || sending || saved || stale || !!targetError(snapshot.target);
    const dirty = !saved && (reviewed || fingerprint(draft) !== baseline);
    const title = tile ? (snapshot.target.type === 'wall' ? 'Стена' : 'Дверь') + ' · ' + snapshot.target.x + ', ' + snapshot.target.y : snapshot.target?.name || PROP_LABELS[snapshot.target?.type] || 'Укрытие';
    useEffect(() => { live.current = { locked, reviewed, validation, draft, onConfirm, onCancel, disabled }; });
    useEffect(() => { dirtyRef.current = onDirty; }, [onDirty]);
    useEffect(() => { dirtyRef.current?.(dirty); }, [dirty]);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; dirtyRef.current?.(false); }; }, []);
    const patch = change => {
        if (live.current?.locked || submitting.current || committed.current || !mounted.current) return;
        live.current.reviewed = false;
        setDraft(previous => ({ ...previous, ...change })); setReviewed(false); setError('');
    };
    const confirm = async () => {
        const current = live.current;
        if (!mounted.current || !current || current.locked || submitting.current || committed.current || !current.reviewed || current.validation || typeof current.onConfirm !== 'function') return;
        submitting.current = true; setSending(true); setError('');
        try {
            const result = await current.onConfirm({ target: copy(snapshot.target), profile: copy(current.draft) });
            if (!mounted.current) return;
            if (!result || result.ok === false || result.error) setError(typeof result?.error === 'string' ? result.error : 'Сохранение не подтверждено. Проверь связь и состояние сцены.');
            else { committed.current = true; setSaved(true); }
        } catch (failure) {
            if (mounted.current) setError(failure?.message || 'Не удалось сохранить профиль. Черновик остаётся здесь.');
        } finally { submitting.current = false; if (mounted.current) setSending(false); }
    };
    return <section className="cover-profile-editor combat-adjudication" aria-label="Профиль укрытия" data-cover-profile-draft={dirty ? 'true' : 'false'} style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
        <strong>{title}</strong>
        <p className="adjudication-help">ГМ задаёт физическую модель укрытия: материал и его SP. Значения не выводятся из названия или картинки предмета.</p>
        {stale && <p role="alert" className="adjudication-warning">Предмет или его профиль изменился. Закрой и снова открой редактор, чтобы проверить свежие данные. Черновик не отправлен.</p>}
        <fieldset disabled={locked} style={groupStyle}><legend>Материал и защита</legend>
            <label className="adjudication-field"><span>Материал · обязательно</span><input type="text" aria-label="Материал укрытия" maxLength={100} required style={fieldTouch} disabled={locked} value={draft?.material ?? ''} onChange={event => patch({ material: event.target.value })}/></label>
            <label className="adjudication-field"><span>SP материала · целое число 0–1000</span><input type="number" inputMode="numeric" aria-label="SP материала" min={0} max={1000} step={1} required style={fieldTouch} disabled={locked} value={draft?.sp ?? ''} onChange={event => patch({ sp: numericDraft(event.target.value) })}/></label>
            <p className="adjudication-help">SP отвечает за баллистическую защиту. Преграда для обзора задаётся отдельно и сама по себе не означает защиту от пули.</p>
        </fieldset>
        {!tile && <>
            <fieldset disabled={locked} style={groupStyle}><legend>Обычное положение</legend>
                <p className="adjudication-help">Отметь реально закрытые зоны тела. Пустой список означает, что предмет не защищает ни одну зону.</p>
                <ZoneChoices label="Закрытые зоны" value={draft?.coveredZones} disabled={locked} onChange={coveredZones => patch({ coveredZones })}/>
                <label className="adjudication-check" style={checkTouch}><input type="checkbox" style={checkBox} aria-label="Преграждает обзор" checked={draft?.blocksVision === true} disabled={locked} onChange={event => patch({ blocksVision: event.target.checked })}/><span>Преграждает обзор</span></label>
            </fieldset>
            {table ? <fieldset disabled={locked} style={groupStyle}><legend>Перемещение и опрокидывание стола</legend>
                <label className="adjudication-check" style={checkTouch}><input type="checkbox" style={checkBox} aria-label="Стол можно двигать и опрокидывать" checked={draft?.movable === true} disabled={locked} onChange={event => patch({ movable: event.target.checked })}/><span>Стол можно двигать и опрокидывать</span></label>
                <p className="adjudication-help">Отдельно задай результат опрокидывания: закрытые зоны и преграду для обзора. Эти настройки применяются, если перемещение разрешено. Сохранение профиля не опрокидывает стол.</p>
                <ZoneChoices label="После опрокидывания" value={draft?.flippedCoveredZones} disabled={locked} onChange={flippedCoveredZones => patch({ flippedCoveredZones })}/>
                <label className="adjudication-check" style={checkTouch}><input type="checkbox" style={checkBox} aria-label="После опрокидывания преграждает обзор" checked={draft?.flippedBlocksVision === true} disabled={locked} onChange={event => patch({ flippedBlocksVision: event.target.checked })}/><span>После опрокидывания преграждает обзор</span></label>
            </fieldset> : <p className="adjudication-help">Этот предмет неподвижен. Перемещение и опрокидывание доступны только столу.</p>}
        </>}
        {tile && <p className="adjudication-help">Для клетки сохраняются только материал и SP. Обзор зависит от стены или состояния двери; этот профиль его не меняет.</p>}
        <p className="adjudication-help">HP и автоматическое снижение SP укрытия не задаются. Опциональный износ брони персонажа настраивается отдельно.</p>
        {validation && <p role="status" className="adjudication-help">{validation}</p>}
        <label className="adjudication-check" style={checkTouch}><input type="checkbox" style={checkBox} aria-label="Подтверждение профиля укрытия ГМом" checked={reviewed} disabled={locked || !!validation} onChange={event => {
            if (!live.current?.locked && !live.current?.validation && !submitting.current && !committed.current && mounted.current) { live.current.reviewed = event.target.checked; setReviewed(event.target.checked); }
        }}/><span>Как ГМ проверил материал, SP{tile ? '' : ', закрытые зоны, обзор и подвижность'}. Подтверждаю эту модель укрытия.</span></label>
        {error && <p role="alert" className="adjudication-warning">{error}</p>}
        {saved && <p role="status" className="adjudication-help">Профиль укрытия сохранён.</p>}
        <div className="adjudication-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="small-button" style={touch} disabled={disabled || sending} onClick={() => { if (mounted.current && !live.current?.disabled && !submitting.current) live.current?.onCancel?.(); }}>Назад</button>
            <button type="button" className="primary-button" style={touch} disabled={locked || !reviewed || !!validation || typeof onConfirm !== 'function'} onClick={confirm}>{sending ? 'Сохраняем…' : 'Сохранить профиль укрытия'}</button>
        </div>
    </section>;
}
