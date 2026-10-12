import React from 'react';
import { X, Crosshair, Cable } from 'lucide-react';
import { locationName } from '@/lib/firefight/display.mjs';
export default function CombatFeedback({ event, onClose }) {
    const net = event.kind === 'control', volley=event.effectSuppressed===true, melee=event.kind==='melee';
    const title = volley?'Огневое действие':melee?(event.hit?'Рукопашное попадание':'Атака отражена'):net ? (event.success ? 'Управление выполнено' : 'Управление не удалось') : !event.hit ? 'Промах' : event.targetStatus === 'dead' ? 'Смертельное ранение' : event.targetStatus === 'stunned' ? 'Попадание · оглушён' : event.damage ? 'Попадание' : 'Броня выдержала';
    return <aside className={'combat-feedback ' + (!net && event.targetStatus === 'dead' ? 'fatal' : '')} aria-label="Результат действия" aria-live="polite">
    <div className="feedback-heading">{net ? <Cable size={17}/> : <Crosshair size={17}/>}<strong>{title}</strong><button className="icon-button" onClick={onClose} aria-label="Закрыть результат"><X size={16}/></button></div>
    {volley&&<p>{event.rounds!==undefined?event.rounds+' патронов · ':''}{event.hits!==undefined?event.hits+' попаданий · ':''}{event.damage} ранений суммарно.</p>}
    {melee&&event.attackTotal!==undefined&&<p className="feedback-roll">Атака {event.attackTotal} против защиты {event.defenseTotal}. Ничья защищает цель.</p>}
    {event.requiresGmResolution&&<p className="adjudication-warning">Критическая ошибка сохранена. Бой ждёт решения ведущего.</p>}
    {event.roll !== undefined && <p className="feedback-roll">{net ? `d10: ${event.roll} · STR ${event.strength}` : `${event.base ?? 'База'} + d10(${event.roll})${event.bonus ? ' + ' + event.bonus : ''} = ${event.total} · сложность ${event.difficulty}`}</p>}
    {!net && !volley && event.hit && <p>{locationName(event.location)} · {event.rawDamage !== undefined ? <>{event.pointBlank ? 'В упор: максимум ' : 'Урон: '}{event.rawDamage}{event.sp !== undefined ? ' − SP ' + event.sp : ''}{event.btm !== undefined && event.penetration > 0 ? ' − BTM ' + event.btm : ''}{event.location === 'head' ? ' · голова ×2' : ''} → </> : null}<strong>{event.damage} ранений</strong></p>}
    {!net && !volley && event.armorWear && <p className={event.armorWear.requiresManualUpdate ? 'armor-wear-warning' : 'armor-wear-note'}>SP {event.armorWear.before} → {event.armorWear.after}. {event.armorWear.persisted ? 'Износ брони сохранён в листе.' : event.armorWear.requiresManualUpdate ? 'Нужна ручная правка брони в листе. ' + event.armorWear.reason : 'Износ брони сохранён в сцене.'}</p>}
    {!net && !volley && event.deathCause && <p className="feedback-cause">{event.deathCause === 'head' ? 'Голова: больше 8 урона — гибель.' : 'Уничтожена конечность; проверка смертельного шока провалена.'}</p>}
    {net && <p>{event.program || 'Контроль устройства'} · {event.success ? 'Устройство выполнило команду.' : 'Попытка потрачена; повтор — в следующем раунде.'}</p>}
    {!net && !volley && event.hit && event.targetStatus === 'stunned' && <p className="feedback-cause">Жив. Сейчас не может действовать; восстановление проверяется в его ход.</p>}
  </aside>;
}
