import React from 'react';
import { Cable, ScanLine, Camera, DoorOpen, Volume2, Check } from 'lucide-react';
import { controllerFor, deviceActions, adjacent } from '@/lib/firefight/net.mjs';
export default function NetControls({ actor, scene, command, preview, busy, onStage, onSend }) {
    if (!actor?.net?.deck)
        return <p className="local-note">У этого персонажа нет деки.</p>;
    const port = scene.devices.find(d => d.id === actor.net.linkedPortId && d.type === 'port'), connected = port && adjacent(actor, port);
    const available = scene.devices.filter(d => d.type === 'port' && adjacent(actor, d));
    const known = scene.devices.filter(d => actor.net.knownDeviceIds.includes(d.id));
    return <div className="net-controls">
    <div className="net-summary"><Cable size={23}/><div><strong>Дека · {actor.name}</strong><span>{connected ? 'Кабель подключён' : 'Дека не подключена'} · Interface {actor.stats.interface}</span></div></div>
    <p className="local-note">Controller выполняет обычные функции устройства. Попасть в импланты охранника отсюда нельзя.</p>
    {!connected ? <>{available.length ? available.map(d => <button key={d.id} className="small-button wide" disabled={busy} onClick={() => onSend({ type: 'connect', actorId: actor.id, deviceId: d.id })}><Cable size={17}/>Подключить к порту · 1 действие</button>) : <p className="net-help">Подойди к порту деки на карте. Для подключения нужна соседняя клетка.</p>}</> : <>
      <div className="net-toolbar"><button className="small-button" disabled={busy} onClick={() => onSend({ type: 'scan', actorId: actor.id })}><ScanLine size={17}/>Найти устройства</button><button className="text-button" disabled={busy} onClick={() => onSend({ type: 'disconnect', actorId: actor.id })}>Отключить</button></div>
      <p className="net-budget">{actor.net.controlUsed ? 'Попытка управления потрачена. Следующая — в новом раунде.' : 'Одна попытка управления доступна в этом раунде.'}</p>
      {!known.length && <p className="net-help">Locate Remote найдёт доступные устройства. Поиск расходует действие.</p>}
      <div className="net-device-list">{known.map(d => { const program = controllerFor(actor, d), Icon = d.type === 'door' ? DoorOpen : d.type === 'camera' ? Camera : Volume2; return <article className="net-device" key={d.id}><div><Icon size={20}/><span><strong>{d.name}</strong><small>{program ? program.name + ' · STR ' + program.strength : 'Нет Controller в деке'} · {d.remoteOnly ? 'найдено декой · вне прямого обзора' : d.type === 'door' ? (scene.tiles[d.y][d.x].open ? 'открыта' : 'закрыта') : d.type === 'speaker' ? (d.active ? 'тревога включена' : 'тихо') : 'просмотр помещения'}</small></span></div>{deviceActions(d, scene).map(o => <button className="small-button" key={o.id} disabled={busy || actor.net.controlUsed || !program} onClick={() => onStage({ type: 'control', actorId: actor.id, deviceId: d.id, operation: o.id })}>{o.label}</button>)}</article>; })}</div>
    </>}
    {command?.type === 'control' && <div className="net-confirm">{preview?.ok ? <><strong>{preview.text}</strong><p>{preview.program.name}: d10 ≤ {preview.program.strength}. Шанс {Math.round(preview.chance * 100)}%. Одна попытка; неудача тоже расходует её.</p>{preview.device.type === 'speaker' && <p>{command.operation === 'on' ? 'Тревога включится' : 'Тревога выключится'} в помещении. Реакцию НПС определяет ГМ.</p>}<button className="primary-button" disabled={busy} onClick={() => onSend(command)}><Check size={17}/>Выполнить команду</button></> : <p className="intent-error">{preview?.error}</p>}</div>}
    {actor.net.cameraIntel&&<section className="net-camera-intel" aria-label="Личный снимок камеры"><strong>{actor.net.cameraIntel.deviceName} · снимок раунда {actor.net.cameraIntel.round}</strong><p>Только эта дека. Позиции на момент наблюдения; это не общий и не постоянно обновляемый обзор.</p>{actor.net.cameraIntel.actors.length?<ul>{actor.net.cameraIntel.actors.map(a=><li key={a.id}>{a.name} · клетка {a.x+1}, {a.y+1}</li>)}</ul>:<p>В поле камеры никого не обнаружено.</p>}</section>}
    <p className="net-rule-note">Упрощения прототипа: порт и короткий кабель, локальная сеть, одна попытка управления за физический раунд. Полное погружение в Net и MicroNET пока не реализованы.</p>
  </div>;
}
