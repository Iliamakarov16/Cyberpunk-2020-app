import { LOCATIONS } from './scene.mjs';
import { adjacent, controllerFor, deviceActions } from './net.mjs';
export const RULESET = 'cyberpunk-2020-core-subset-v1';
export const clone = value => JSON.parse(JSON.stringify(value));
export const activeActor = state => state.actors.find(a => a.id === state.order[state.index]) || null;
export const locationName = id => LOCATIONS.find(l => l.id === id)?.label || id;
export const d10 = (rng = Math.random) => Math.min(10, Math.max(1, Math.floor(rng() * 10) + 1));
export function woundInfo(wounds = 0) {
    if (wounds === 0)
        return { label: 'Без ранений', band: 0, stun: 0, mortal: -1 };
    if (wounds <= 4)
        return { label: 'Лёгкое', band: 1, stun: 0, mortal: -1 };
    if (wounds <= 8)
        return { label: 'Серьёзное', band: 2, stun: 1, mortal: -1 };
    if (wounds <= 12)
        return { label: 'Критическое', band: 3, stun: 2, mortal: -1 };
    const level = Math.floor((wounds - 13) / 4);
    return { label: 'Смертельное ' + level, band: 4 + level, stun: 3 + level, mortal: level };
}
export function effectiveRef(a) {
    const band = woundInfo(a.wounds).band;
    return band >= 4 ? Math.ceil(a.stats.ref / 3) : band === 3 ? Math.ceil(a.stats.ref / 2) : band === 2 ? Math.max(0, a.stats.ref - 2) : a.stats.ref;
}
export function bodyModifier(body) { return body <= 2 ? 0 : body <= 4 ? 1 : body <= 7 ? 2 : body <= 9 ? 3 : body === 10 ? 4 : 5; }
export const actionPenalty = a => -3 * a.actions;
export const distanceMeters = (s, a, b) => Math.hypot(a.x - b.x, a.y - b.y) * s.tileMeters;
export function rangeDifficulty(d, r) { return d <= 1 ? 10 : d <= r / 4 ? 15 : d <= r / 2 ? 20 : d <= r ? 25 : d <= r * 2 ? 30 : Infinity; }
export function hitChance(base, difficulty) {
    let chance = 0;
    for (let roll = 2; roll <= 9; roll++)
        if (base + roll >= difficulty)
            chance += .1;
    for (let bonus = 1; bonus <= 10; bonus++)
        if (base + 10 + bonus >= difficulty)
            chance += .01;
    return Math.min(.9, Math.max(0, chance));
}
export function propAt(s, x, y) { return s.props.find(p => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h); }
export function inBounds(s, x, y) { return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < s.width && y < s.height; }
export function walkable(s, x, y, exclude) {
    if (!inBounds(s, x, y))
        return false;
    const t = s.tiles[y][x];
    if (t.type === 'wall' || (t.type === 'door' && !t.open) || propAt(s, x, y))
        return false;
    return !s.actors.some(a => a.id !== exclude && a.x === x && a.y === y && a.status !== 'dead');
}
export function findPath(s, a, to) {
    if (!walkable(s, to.x, to.y, a.id))
        return null;
    const key = (x, y) => x + ',' + y, start = key(a.x, a.y), goal = key(to.x, to.y);
    const open = [{ x: a.x, y: a.y, cost: 0 }], costs = new Map([[start, 0]]), prev = new Map();
    let found = false;
    while (open.length) {
        open.sort((a, b) => a.cost - b.cost);
        const cur = open.shift(), ck = key(cur.x, cur.y);
        if (cur.cost > costs.get(ck))
            continue;
        if (ck === goal) {
            found = true;
            break;
        }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const x = cur.x + dx, y = cur.y + dy, nk = key(x, y);
            if (!walkable(s, x, y, a.id))
                continue;
            if (dx && dy && (!walkable(s, cur.x + dx, cur.y, a.id) || !walkable(s, cur.x, cur.y + dy, a.id)))
                continue;
            const cost = cur.cost + Math.hypot(dx, dy) * s.tileMeters;
            if (cost < (costs.get(nk) ?? Infinity)) {
                costs.set(nk, cost);
                prev.set(nk, ck);
                open.push({ x, y, cost });
            }
        }
    }
    if (!found)
        return null;
    const path = [];
    let current = goal;
    while (current !== start) {
        const [x, y] = current.split(',').map(Number);
        path.unshift({ x, y });
        current = prev.get(current);
    }
    return { path, distance: costs.get(goal) };
}
export function rayCells(a, b) {
    const cells = [], seen = new Set(), steps = Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) * 12);
    for (let i = 1; i < steps; i++) {
        const x = Math.floor(a.x + .5 + (b.x - a.x) * i / steps), y = Math.floor(a.y + .5 + (b.y - a.y) * i / steps), k = x + ',' + y;
        if (!seen.has(k) && !(x === a.x && y === a.y) && !(x === b.x && y === b.y)) {
            seen.add(k);
            cells.push({ x, y });
        }
    }
    return cells;
}
export function lineOfFire(s, a, b) {
    const cells = rayCells(a, b);
    const wall = cells.find(c => s.tiles[c.y]?.[c.x]?.type === 'wall' || (s.tiles[c.y]?.[c.x]?.type === 'door' && !s.tiles[c.y][c.x].open));
    const cover = cells.map(c => propAt(s, c.x, c.y)).find(p => p?.cover && Math.max(Math.abs(b.x - Math.max(p.x, Math.min(b.x, p.x + p.w - 1))), Math.abs(b.y - Math.max(p.y, Math.min(b.y, p.y + p.h - 1)))) <= 1);
    return { blocked: !!wall, wall, cover: cover || null, exposed: cover ? LOCATIONS.filter(l => !l.id.includes('Leg')).map(l => l.id) : LOCATIONS.map(l => l.id) };
}
function gm(c) {
    if (c.role !== 'gm')
        throw new Error('Это действие доступно ГМу.');
}
function actorPermission(s, a, c) {
    if (!a)
        throw new Error('Персонаж не найден.');
    if (c.role !== 'gm' && a.id !== c.controlledId)
        throw new Error('Ты управляешь только своим персонажем.');
    if (s.phase !== 'combat')
        throw new Error(s.phase === 'paused' ? 'Бой на паузе.' : 'Сначала начни бой.');
    if (activeActor(s)?.id !== a.id)
        throw new Error('Сейчас очередь другого персонажа.');
    if (a.status === 'dead')
        throw new Error('Персонаж погиб.');
    if (a.status === 'stunned')
        throw new Error('Персонаж оглушён. Заверши его ход для проверки восстановления.');
}
export function previewCommand(s, cmd, c = { role: 'gm' }) {
    try {
        const a = s.actors.find(a => a.id === cmd.actorId);
        if (cmd.type === 'place') {
            gm(c);
            if (!['preparation', 'ended'].includes(s.phase))
                throw new Error('Расстановка доступна до или после боя.');
            if (!a)
                throw new Error('Выбери персонажа.');
            if (!walkable(s, cmd.x, cmd.y, a.id))
                throw new Error('Клетка занята или непроходима.');
            return { ok: true, actor: a, to: { x: cmd.x, y: cmd.y }, text: 'Разместить' };
        }
        if (cmd.type === 'start') {
            gm(c);
            if (!['preparation', 'ended'].includes(s.phase))
                throw new Error('Бой уже начат.');
            if (s.actors.filter(a => a.status !== 'dead').length < 2)
                throw new Error('Добавь хотя бы двух участников.');
            for (const a of s.actors.filter(a => a.status !== 'dead'))
                if (!walkable(s, a.x, a.y, a.id))
                    throw new Error('Проверь позицию ' + a.name + '.');
            return { ok: true, text: 'Начать бой' };
        }
        if (['pause', 'resume', 'finish', 'hide', 'paint', 'door', 'add'].includes(cmd.type)) {
            gm(c);
            if (cmd.type === 'pause' && s.phase !== 'combat')
                throw new Error('Бой не идёт.');
            if (cmd.type === 'resume' && s.phase !== 'paused')
                throw new Error('Бой не на паузе.');
            if (cmd.type === 'finish' && !['combat', 'paused'].includes(s.phase))
                throw new Error('Бой ещё не начат.');
            if (['paint', 'add'].includes(cmd.type) && !['preparation', 'ended'].includes(s.phase))
                throw new Error('Изменяй сцену до или после боя.');
            if (cmd.type === 'paint') {
                if (!inBounds(s, cmd.x, cmd.y))
                    throw new Error('Клетка за пределами карты.');
                if (!['floor', 'wall', 'crate', 'door'].includes(cmd.paint))
                    throw new Error('Неизвестный инструмент.');
                if (s.actors.some(a => a.x === cmd.x && a.y === cmd.y))
                    throw new Error('Сначала перемести персонажа.');
            }
            if (cmd.type === 'door' && s.tiles[cmd.y]?.[cmd.x]?.type !== 'door')
                throw new Error('Здесь нет двери.');
            if (cmd.type === 'door' && s.tiles[cmd.y][cmd.x].open && s.actors.some(a => a.x === cmd.x && a.y === cmd.y))
                throw new Error('В проёме стоит персонаж.');
            if (cmd.type === 'hide' && !a)
                throw new Error('Выбери персонажа.');
            if (cmd.type === 'hide' && a.team === 'crew')
                throw new Error('Скрывать можно НПС.');
            if (cmd.type === 'add' && s.actors.length >= 20)
                throw new Error('В сцене уже 20 участников.');
            return { ok: true, text: 'Изменить сцену' };
        }
        if (cmd.type === 'end') {
            if (!a)
                throw new Error('Персонаж не найден.');
            if (c.role !== 'gm' && a.id !== c.controlledId)
                throw new Error('Это не твоя очередь.');
            if (s.phase !== 'combat' || activeActor(s)?.id !== a.id)
                throw new Error('Это не текущий ход.');
            return { ok: true, actor: a, text: 'Завершить ход' };
        }
        actorPermission(s, a, c);
        const penalty = actionPenalty(a);
        if (['connect', 'disconnect', 'scan', 'control'].includes(cmd.type)) {
            if (!a.net?.deck || !(a.stats.interface > 0))
                throw new Error('Нужны дека и навык Interface.');
            const port = (s.devices || []).find(d => d.id === a.net.linkedPortId && d.type === 'port');
            if (cmd.type === 'connect') {
                const target = (s.devices || []).find(d => d.id === cmd.deviceId && d.type === 'port');
                if (!target || !adjacent(a, target))
                    throw new Error('Подойди к порту деки: нужна соседняя клетка.');
                if (a.net.linkedPortId === target.id)
                    throw new Error('Дека уже подключена.');
                return { ok: true, actor: a, device: target, text: 'Подключить деку' };
            }
            if (!port || !adjacent(a, port))
                throw new Error('Сначала подключи деку к соседнему порту.');
            if (cmd.type === 'disconnect')
                return { ok: true, actor: a, device: port, text: 'Отключить деку' };
            if (cmd.type === 'scan')
                return { ok: true, actor: a, device: port, text: 'Найти устройства' };
            const device = (s.devices || []).find(d => d.id === cmd.deviceId && d.type !== 'port');
            if (!device || device.networkId !== port.networkId || !a.net.knownDeviceIds.includes(device.id))
                throw new Error('Устройство ещё не найдено или недоступно.');
            if (a.net.controlUsed)
                throw new Error('Одна попытка управления за раунд — ограничение этой версии.');
            const program = controllerFor(a, device);
            if (!program)
                throw new Error('В деке нет подходящей Controller-программы.');
            const option = deviceActions(device, s).find(o => o.id === cmd.operation);
            if (!option)
                throw new Error('Устройство не поддерживает такую команду.');
            if (device.type === 'door' && s.tiles[device.y]?.[device.x]?.type !== 'door')
                throw new Error('Дверь больше не существует.');
            if (cmd.operation === 'close' && s.actors.some(b => b.x === device.x && b.y === device.y && b.status !== 'dead'))
                throw new Error('В проёме стоит персонаж.');
            return { ok: true, actor: a, device, program, chance: program.strength / 10, text: option.label };
        }
        if (cmd.type === 'move') {
            if (a.moved)
                throw new Error('Перемещение уже выполнено в этом раунде.');
            const route = findPath(s, a, { x: cmd.x, y: cmd.y });
            if (!route || !route.path.length)
                throw new Error('Нет свободного пути к этой клетке.');
            if (route.distance > a.stats.ma * 3 + .00001)
                throw new Error('Слишком далеко: предел ' + a.stats.ma * 3 + ' м за раунд.');
            return { ok: true, actor: a, ...route, penalty, to: { x: cmd.x, y: cmd.y }, text: 'Переместиться' };
        }
        if (cmd.type === 'shoot') {
            const b = s.actors.find(a => a.id === cmd.targetId);
            if (!b || b.id === a.id || b.status === 'dead')
                throw new Error('Выбери живую цель.');
            if (c.role !== 'gm' && b.hidden)
                throw new Error('Цель недоступна.');
            if (a.weapon.ammo < 1)
                throw new Error('Магазин пуст. Перезаряди оружие.');
            if (a.shots >= a.weapon.rof)
                throw new Error('Скорострельность за раунд исчерпана.');
            const line = lineOfFire(s, a, b);
            if (line.blocked)
                throw new Error('Линию огня перекрывает стена или закрытая дверь.');
            const location = cmd.location || 'random';
            if (location !== 'random' && !LOCATIONS.some(l => l.id === location))
                throw new Error('Неизвестная часть тела.');
            if (location !== 'random' && !line.exposed.includes(location))
                throw new Error('Эту часть тела закрывает укрытие.');
            const distance = distanceMeters(s, a, b), difficulty = rangeDifficulty(distance, a.weapon.range);
            if (!Number.isFinite(difficulty))
                throw new Error('Цель вне дальности оружия.');
            const called = location === 'random' ? 0 : -4;
            const base = effectiveRef(a) + (a.stats[a.weapon.skill] || 0) + a.weapon.accuracy + penalty + called;
            return { ok: true, actor: a, target: b, line, distance, difficulty, penalty, called, base, chance: hitChance(base, difficulty), location, text: 'Выстрелить' };
        }
        if (cmd.type === 'reload') {
            if (a.weapon.ammo >= a.weapon.magazine)
                throw new Error('Магазин уже полон.');
            if (a.weapon.reserve <= 0)
                throw new Error('Запасных патронов нет.');
            return { ok: true, actor: a, penalty, text: 'Перезарядить', count: Math.min(a.weapon.magazine - a.weapon.ammo, a.weapon.reserve) };
        }
        if (cmd.type === 'interact') {
            const t = s.tiles[cmd.y]?.[cmd.x];
            if (t?.type !== 'door')
                throw new Error('Выбери дверь.');
            if (Math.max(Math.abs(a.x - cmd.x), Math.abs(a.y - cmd.y)) > 1)
                throw new Error('Подойди к двери.');
            if (t.open && s.actors.some(a => a.x === cmd.x && a.y === cmd.y))
                throw new Error('Проём занят.');
            return { ok: true, actor: a, penalty, text: t.open ? 'Закрыть дверь' : 'Открыть дверь' };
        }
        throw new Error('Неизвестное действие.');
    }
    catch (e) {
        return { ok: false, error: e.message };
    }
}
function log(s, text, actorIds = [], details = {}) {
    const e = { id: 'event-' + (s.version + 1) + '-' + s.log.length, round: s.round, text, actorIds, ...details };
    s.log.push(e);
    if (s.log.length > 150)
        s.log.shift();
    return e;
}
function initiative(s, rng) {
    for (const a of s.actors) {
        a.actions = 0;
        if (a.net)
            a.net.controlUsed = false;
        a.shots = 0;
        a.moved = false;
        if (a.status !== 'dead')
            a.initiative = d10(rng) + effectiveRef(a) + a.stats.combatSense;
    }
    s.order = s.actors.filter(a => a.status !== 'dead').sort((a, b) => b.initiative - a.initiative || b.stats.combatSense - a.stats.combatSense || effectiveRef(b) - effectiveRef(a) || a.id.localeCompare(b.id)).map(a => a.id);
    s.index = 0;
}
function saveCheck(s, a, rng, recovery = false) {
    if (a.status === 'dead')
        return;
    const info = woundInfo(a.wounds);
    if (!recovery && info.mortal >= 0 && !a.stabilized) {
        const roll = d10(rng), limit = a.stats.body - info.mortal;
        if (roll > limit) {
            a.status = 'dead';
            log(s, a.name + ': смертельный шок, ' + roll + ' > ' + limit + '.', [a.id], { kind: 'death' });
            return;
        }
    }
    if (recovery && a.status === 'stunned') {
        const roll = d10(rng), limit = a.stats.body - info.stun;
        if (roll <= limit) {
            a.status = 'active';
            log(s, a.name + ' приходит в себя: ' + roll + ' ≤ ' + limit + '.', [a.id], { kind: 'recovery' });
        }
        else
            log(s, a.name + ' остаётся оглушён: ' + roll + ' > ' + limit + '.', [a.id], { kind: 'stun' });
    }
}
function nextTurn(s, rng) {
    const outgoing = activeActor(s);
    if (outgoing)
        saveCheck(s, outgoing, rng);
    let loops = 0;
    do {
        s.index++;
        if (s.index >= s.order.length) {
            s.round++;
            initiative(s, rng);
            log(s, 'Раунд ' + s.round + '. Новая инициатива.', [], { kind: 'round' });
        }
        if (!s.order.length) {
            s.phase = 'ended';
            log(s, 'В сцене не осталось живых участников.');
            return;
        }
        const a = activeActor(s);
        if (a?.status !== 'dead') {
            if (a.status === 'stunned')
                saveCheck(s, a, rng, true);
            if (a.status !== 'dead')
                return;
        }
    } while (++loops < 50);
}
export function resolveHit(target, rawDamage, location, settings = { stagedPenetration: true }, rng = Math.random) {
    const sp = target.armor[location] || 0, penetration = Math.max(0, rawDamage - sp), btm = bodyModifier(target.stats.body);
    if (!penetration)
        return { rawDamage, sp, penetration, btm, damage: 0, location, stunRoll: null, stunLimit: null, targetStatus: target.status, deathCause: null };
    const damage = Math.max(1, penetration - btm) * (location === 'head' ? 2 : 1);
    target.wounds += damage;
    if (settings.stagedPenetration && sp > 0)
        target.armor[location] = sp - 1;
    let immediateDeathRoll = null, deathCause = null;
    if (location === 'head' && damage > 8) {
        target.status = 'dead';
        deathCause = 'head';
    }
    else if (location !== 'torso' && damage > 8) {
        if (!target.destroyed.includes(location))
            target.destroyed.push(location);
        immediateDeathRoll = d10(rng);
        if (immediateDeathRoll > target.stats.body) {
            target.status = 'dead';
            deathCause = 'limb-shock';
        }
    }
    const info = woundInfo(target.wounds), stunLimit = target.stats.body - info.stun, stunRoll = target.status === 'dead' ? null : d10(rng);
    if (stunRoll !== null && stunRoll > stunLimit)
        target.status = 'stunned';
    return { rawDamage, sp, penetration, btm, damage, location, stunRoll, stunLimit, immediateDeathRoll, targetStatus: target.status, deathCause };
}
export function applyCommand(input, cmd, c = { role: 'gm' }, rng = Math.random) {
    if (typeof cmd.id !== 'string' || !cmd.id || cmd.id.length > 100)
        throw new Error('Команда должна иметь уникальный идентификатор.');
    if (input.appliedCommandIds.includes(cmd.id))
        return { state: input, event: null, duplicate: true };
    if (cmd.expectedVersion !== undefined && cmd.expectedVersion !== input.version)
        throw new Error('Сцена изменилась. Выбери действие ещё раз.');
    const p = previewCommand(input, cmd, c);
    if (!p.ok)
        throw new Error(p.error);
    const s = clone(input), a = s.actors.find(a => a.id === cmd.actorId);
    let event;
    if (cmd.type === 'start') {
        s.phase = 'combat';
        s.round++;
        initiative(s, rng);
        const first = activeActor(s);
        if (first?.status === 'stunned')
            saveCheck(s, first, rng, true);
        event = log(s, 'Бой начат. Раунд ' + s.round + '.', [], { kind: 'start' });
    }
    if (cmd.type === 'pause') {
        s.phase = 'paused';
        event = log(s, 'ГМ поставил бой на паузу.', [], { kind: 'pause' });
    }
    if (cmd.type === 'resume') {
        s.phase = 'combat';
        event = log(s, 'Бой продолжается.', [], { kind: 'resume' });
    }
    if (cmd.type === 'finish') {
        s.phase = 'ended';
        event = log(s, 'Бой завершён. Все последствия сохранены.', [], { kind: 'finish' });
    }
    if (cmd.type === 'place') {
        const from = { x: a.x, y: a.y };
        a.x = cmd.x;
        a.y = cmd.y;
        event = log(s, a.name + ': стартовая позиция изменена.', [a.id], { kind: 'place', from, to: { x: a.x, y: a.y } });
    }
    if (cmd.type === 'hide') {
        a.hidden = !a.hidden;
        event = log(s, a.name + (a.hidden ? ' скрыт от игроков.' : ' показан игрокам.'), [a.id], { kind: 'visibility' });
    }
    if (cmd.type === 'paint') {
        s.devices = (s.devices || []).filter(d => !(d.type === 'door' && d.x === cmd.x && d.y === cmd.y && cmd.paint !== 'door'));
        s.props = s.props.filter(p => !(cmd.x >= p.x && cmd.x < p.x + p.w && cmd.y >= p.y && cmd.y < p.y + p.h));
        s.tiles[cmd.y][cmd.x] = { type: cmd.paint === 'crate' ? 'floor' : cmd.paint, zone: 'bar', ...(cmd.paint === 'door' ? { open: false } : {}) };
        if (cmd.paint === 'crate')
            s.props.push({ id: cmd.id, type: 'crate', x: cmd.x, y: cmd.y, w: 1, h: 1, cover: true, label: 'Ящик' });
        event = log(s, 'ГМ изменил карту.', [], { kind: 'paint' });
    }
    if (cmd.type === 'door' || cmd.type === 'interact') {
        const t = s.tiles[cmd.y][cmd.x];
        t.open = !t.open;
        if (a && cmd.type === 'interact')
            a.actions++;
        event = log(s, (cmd.type === 'interact' ? a.name + ': ' : 'ГМ: ') + (t.open ? 'дверь открыта.' : 'дверь закрыта.'), a ? [a.id] : [], { kind: 'door', at: { x: cmd.x, y: cmd.y } });
    }
    if (cmd.type === 'add') {
        const template = clone(s.actors.find(a => a.team === 'hostile') || s.actors[0]), id = 'npc-' + (s.version + 1), pos = [];
        for (let y = 1; y < s.height; y++)
            for (let x = 1; x < s.width; x++)
                if (walkable(s, x, y))
                    pos.push({ x, y });
        if (!pos.length)
            throw new Error('На карте нет свободного места.');
        s.actors.push({ ...template, id, characterId: id, name: 'Охранник ' + (s.actors.filter(a => a.team === 'hostile').length + 1), team: 'hostile', sprite: 2, hidden: true, status: 'active', wounds: 0, destroyed: [], actions: 0, shots: 0, moved: false, ...pos[Math.floor(pos.length / 2)] });
        event = log(s, 'Добавлен скрытый НПС.', [id], { kind: 'add' });
    }
    if (cmd.type === 'move') {
        const from = { x: a.x, y: a.y };
        a.x = cmd.x;
        a.y = cmd.y;
        a.facing = cmd.x < from.x ? -1 : 1;
        a.moved = true;
        a.actions++;
        if (a.net?.linkedPortId) {
            const port = (s.devices || []).find(d => d.id === a.net.linkedPortId);
            if (!port || !adjacent(a, port)) {
                a.net.linkedPortId = null;
                a.net.knownDeviceIds = [];
            }
        }
        event = log(s, a.name + ': перемещение ' + p.distance.toFixed(1) + ' м.', [a.id], { kind: 'move', from, to: { x: a.x, y: a.y }, path: p.path });
    }
    if (['connect', 'disconnect', 'scan', 'control'].includes(cmd.type)) {
        a.actions++;
        if (cmd.type === 'connect') {
            a.net.linkedPortId = p.device.id;
            a.net.knownDeviceIds = [];
            event = log(s, a.name + ': дека подключена к порту.', [a.id], { kind: 'connect', at: { x: p.device.x, y: p.device.y } });
        }
        if (cmd.type === 'disconnect') {
            a.net.linkedPortId = null;
            a.net.knownDeviceIds = [];
            event = log(s, a.name + ': дека отключена.', [a.id], { kind: 'disconnect' });
        }
        if (cmd.type === 'scan') {
            const found = (s.devices || []).filter(d => d.type !== 'port' && d.networkId === p.device.networkId && distanceMeters(s, a, d) <= 400);
            a.net.knownDeviceIds = found.map(d => d.id);
            event = log(s, a.name + ': Locate Remote, найдено устройств: ' + found.length + '.', [a.id], { kind: 'scan', count: found.length });
        }
        if (cmd.type === 'control') {
            a.net.controlUsed = true;
            const roll = d10(rng), success = roll <= p.program.strength;
            let revealed = [];
            const device = s.devices.find(d => d.id === p.device.id);
            if (success) {
                if (device.type === 'door')
                    s.tiles[device.y][device.x].open = cmd.operation === 'open';
                if (device.type === 'speaker')
                    device.active = cmd.operation === 'on';
                if (device.type === 'camera') {
                    device.active = true;
                    revealed = s.actors.filter(b => b.hidden && b.status !== 'dead' && distanceMeters(s, device, b) <= device.range && !lineOfFire(s, device, b).blocked);
                    for (const b of revealed)
                        b.hidden = false;
                }
            }
            event = log(s, a.name + ': ' + p.program.name + ' → ' + device.name + ', d10 ' + roll + ' / STR ' + p.program.strength + ' — ' + (success ? 'команда выполнена.' : 'сбой управления.') + (revealed.length ? ' Камера обнаружила ' + revealed.length + ' участника.' : ''), [a.id, ...revealed.map(b => b.id)], { kind: 'control', at: { x: device.x, y: device.y }, roll, strength: p.program.strength, success, operation: cmd.operation, deviceType: device.type, program: p.program.name });
        }
    }
    if (cmd.type === 'reload') {
        a.weapon.ammo += p.count;
        a.weapon.reserve -= p.count;
        a.actions++;
        event = log(s, a.name + ': перезарядка, ' + a.weapon.ammo + ' патронов в магазине.', [a.id], { kind: 'reload' });
    }
    if (cmd.type === 'shoot') {
        const b = s.actors.find(a => a.id === cmd.targetId), roll = d10(rng), bonus = roll === 10 ? d10(rng) : 0, total = p.base + roll + bonus;
        a.weapon.ammo--;
        a.shots++;
        a.actions++;
        a.facing = b.x < a.x ? -1 : 1;
        const hit = roll !== 1 && total >= p.difficulty, details = { kind: 'shoot', base: p.base, targetStatus: b.status, pointBlank: p.distance <= 1, from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y }, roll, bonus, total, difficulty: p.difficulty, hit };
        if (hit) {
            let location = cmd.location || 'random';
            if (location === 'random') {
                const faces = LOCATIONS.filter(l => p.line.exposed.includes(l.id)).flatMap(l => l.die.map(() => l.id));
                location = faces[Math.min(faces.length - 1, Math.floor(rng() * faces.length))];
            }
            const damageRolls = p.distance <= 1 ? [] : Array.from({ length: a.weapon.damageDice }, () => Math.min(6, Math.max(1, Math.floor(rng() * 6) + 1)));
            const rawDamage = p.distance <= 1 ? a.weapon.damageDice * 6 + a.weapon.damageBonus : damageRolls.reduce((a, b) => a + b, 0) + a.weapon.damageBonus;
            const damage = resolveHit(b, rawDamage, location, s.settings, rng);
            event = log(s, a.name + ' → ' + b.name + ': ' + locationName(location).toLowerCase() + ', ' + (damage.damage ? damage.damage + ' урона.' : 'броня остановила пулю.') + (b.status === 'dead' ? ' Цель погибла.' : b.status === 'stunned' ? ' Цель оглушена.' : ''), [a.id, b.id], { ...details, ...damage, damageRolls });
        }
        else
            event = log(s, a.name + ' → ' + b.name + ': ' + (roll === 1 ? 'критический промах. Последствия определяет ГМ.' : 'промах.') + ' Проверка ' + total + ' / ' + p.difficulty + '.', [a.id, b.id], details);
    }
    if (cmd.type === 'end') {
        event = log(s, a.name + ' завершает ход.', [a.id], { kind: 'end' });
        nextTurn(s, rng);
    }
    s.version++;
    s.appliedCommandIds.push(cmd.id);
    if (s.appliedCommandIds.length > 1000)
        s.appliedCommandIds.shift();
    return { state: s, event, duplicate: false };
}
export function viewFor(s, role = 'gm', controlledId = 'ray') {
    const visible = new Set(s.actors.filter(a => role === 'gm' || !a.hidden || a.id === controlledId).map(a => a.id)), view = clone(s);
    view.actors = view.actors.filter(a => visible.has(a.id)).map(a => role === 'gm' || a.id === controlledId ? a : { id: a.id, characterId: a.characterId, name: a.name, team: a.team, sprite: a.sprite, x: a.x, y: a.y, hidden: false, facing: a.facing, status: a.status });
    const owner = s.actors.find(a => a.id === controlledId);
    view.devices = view.devices?.filter(d => role === 'gm' || d.type === 'port' || owner?.net?.knownDeviceIds?.includes(d.id)) || [];
    const current = s.order[s.index];
    view.order = view.order.filter(id => visible.has(id));
    view.index = visible.has(current) ? view.order.indexOf(current) : -1;
    view.currentActorId = visible.has(current) ? current : null;
    view.gmTurn = !!current && !visible.has(current) && ['combat', 'paused'].includes(s.phase);
    view.log = view.log.filter(e => e.actorIds.every(id => visible.has(id))).map(e => {
        if (role === 'gm' || e.actorIds.every(id => id === controlledId))
            return e;
        const publicEvent = { id: e.id, round: e.round, text: e.text, actorIds: e.actorIds, kind: e.kind, from: e.from, to: e.to, hit: e.hit, damage: e.damage, location: e.location, targetStatus: e.targetStatus, deathCause: e.deathCause, success: e.success, operation: e.operation, deviceType: e.deviceType };
        if (e.kind === 'control' && e.actorIds[0] !== controlledId)
            publicEvent.text = (s.actors.find(a => a.id === e.actorIds[0])?.name || 'Нетраннер') + ': контроль устройства — ' + (e.success ? 'команда выполнена.' : 'управление не удалось.');
        if (e.actorIds[0] === controlledId)
            Object.assign(publicEvent, { roll: e.roll, bonus: e.bonus, total: e.total, base: e.base, difficulty: e.difficulty, rawDamage: e.rawDamage, damageRolls: e.damageRolls, pointBlank: e.pointBlank, strength: e.strength, success: e.success, program: e.program });
        return publicEvent;
    });
    delete view.appliedCommandIds;
    return view;
}
export function validateSnapshot(v) {
    if (!v || v.schemaVersion !== 1 || typeof v.name !== 'string' || v.name.length > 100 || typeof v.subtitle !== 'string' || v.subtitle.length > 150)
        throw new Error('Неподдерживаемый файл сцены.');
    if (!Number.isInteger(v.width) || !Number.isInteger(v.height) || v.width < 4 || v.height < 4 || v.width > 60 || v.height > 60)
        throw new Error('Некорректный размер карты.');
    if (!Array.isArray(v.tiles) || v.tiles.length !== v.height || v.tiles.some(row => !Array.isArray(row) || row.length !== v.width || row.some(t => !['floor', 'wall', 'door'].includes(t?.type) || (t.type === 'door' && typeof t.open !== 'boolean'))))
        throw new Error('Некорректные клетки карты.');
    if (!Array.isArray(v.actors) || v.actors.length < 1 || v.actors.length > 20 || v.actors.some(a => !a || typeof a !== 'object') || new Set(v.actors.map(a => a.id)).size !== v.actors.length)
        throw new Error('Некорректные участники.');
    if (!Number.isFinite(v.tileMeters) || v.tileMeters <= 0 || v.tileMeters > 10)
        throw new Error('Некорректный масштаб карты.');
    for (const a of v.actors) {
        if (typeof a.id !== 'string' || !a.id || a.id.length > 100 || typeof a.name !== 'string' || a.name.length > 100 || !Number.isInteger(a.sprite) || a.sprite < 0 || a.sprite > 3 || !['crew', 'hostile'].includes(a.team) || typeof a.hidden !== 'boolean' || !inBounds(v, a.x, a.y) || !['active', 'stunned', 'dead'].includes(a.status) || !Number.isInteger(a.wounds) || a.wounds < 0 || a.wounds > 1000 || ![-1, 1].includes(a.facing) || typeof a.moved !== 'boolean' || typeof a.stabilized !== 'boolean')
            throw new Error('Некорректный персонаж.');
        for (const k of ['ref', 'ma', 'body', 'combatSense', 'handgun', 'rifle'])
            if (!Number.isInteger(a.stats?.[k]) || a.stats[k] < 0 || a.stats[k] > 30)
                throw new Error('Некорректные характеристики.');
        if (a.stats.interface !== undefined && (!Number.isInteger(a.stats.interface) || a.stats.interface < 0 || a.stats.interface > 30))
            throw new Error('Некорректный Interface.');
        if (a.net && (!a.net.deck || !Array.isArray(a.net.programIds) || a.net.programIds.length > 20 || a.net.programIds.some(id => typeof id !== 'string') || !Array.isArray(a.net.knownDeviceIds) || a.net.knownDeviceIds.length > 40 || a.net.knownDeviceIds.some(id => typeof id !== 'string') || (a.net.linkedPortId !== null && typeof a.net.linkedPortId !== 'string') || typeof a.net.controlUsed !== 'boolean'))
            throw new Error('Некорректная дека.');
        for (const k of ['ammo', 'reserve', 'magazine', 'rof', 'range', 'damageDice', 'damageBonus', 'accuracy'])
            if (!Number.isFinite(a.weapon?.[k]) || Math.abs(a.weapon[k]) > 10000)
                throw new Error('Некорректное оружие.');
        if (typeof a.weapon.name !== 'string' || a.weapon.name.length > 80 || !Number.isInteger(a.weapon.ammo) || !Number.isInteger(a.weapon.reserve) || !Number.isInteger(a.weapon.damageDice) || !Number.isInteger(a.weapon.damageBonus) || !Number.isInteger(a.weapon.accuracy) || !Number.isInteger(a.weapon.magazine) || !Number.isInteger(a.weapon.rof) || a.weapon.rof < 1 || a.weapon.range <= 0 || a.weapon.ammo < 0 || a.weapon.reserve < 0 || a.weapon.magazine < 1 || a.weapon.ammo > a.weapon.magazine || a.weapon.damageDice < 1 || a.weapon.damageDice > 20 || !['handgun', 'rifle'].includes(a.weapon.skill))
            throw new Error('Некорректные параметры оружия.');
        for (const l of LOCATIONS)
            if (!Number.isInteger(a.armor?.[l.id]) || a.armor[l.id] < 0 || a.armor[l.id] > 100)
                throw new Error('Некорректная броня.');
        for (const k of ['actions', 'shots', 'initiative'])
            if (!Number.isInteger(a[k]) || a[k] < 0 || a[k] > 1000)
                throw new Error('Некорректное состояние персонажа.');
        if (!Array.isArray(a.destroyed) || a.destroyed.some(l => !LOCATIONS.some(x => x.id === l)))
            throw new Error('Некорректные травмы.');
    }
    if (!Array.isArray(v.props) || v.props.length > 500 || v.props.some(p => !p || !['table', 'counter', 'barrel', 'crate'].includes(p.type) || !inBounds(v, p.x, p.y) || !Number.isInteger(p.w) || !Number.isInteger(p.h) || p.w < 1 || p.h < 1 || p.x + p.w > v.width || p.y + p.h > v.height))
        throw new Error('Некорректные объекты карты.');
    if (v.devices !== undefined && (!Array.isArray(v.devices) || v.devices.length > 40 || v.devices.some(d => !d || typeof d.id !== 'string' || !d.id || typeof d.name !== 'string' || d.name.length > 100 || typeof d.networkId !== 'string' || !['port', 'door', 'camera', 'speaker'].includes(d.type) || !inBounds(v, d.x, d.y) || (d.type === 'door' && v.tiles[d.y][d.x].type !== 'door') || (d.type === 'camera' && (!Number.isFinite(d.range) || d.range < 1 || d.range > 400)) || (['speaker', 'camera'].includes(d.type) && typeof d.active !== 'boolean')) || new Set(v.devices.map(d => d.id)).size !== v.devices.length))
        throw new Error('Некорректные сетевые устройства.');
    if (v.actors.some(a => a.net?.linkedPortId && !v.devices?.some(d => d.id === a.net.linkedPortId && d.type === 'port')))
        throw new Error('Дека подключена к несуществующему порту.');
    if (!['preparation', 'combat', 'paused', 'ended'].includes(v.phase) || !Array.isArray(v.order) || v.order.some(id => !v.actors.some(a => a.id === id)) || new Set(v.order).size !== v.order.length)
        throw new Error('Некорректная очередь боя.');
    if (!Number.isInteger(v.index) || v.index < 0 || v.index >= Math.max(1, v.order.length) || !Number.isInteger(v.round) || v.round < 0 || !Number.isInteger(v.version) || v.version < 0)
        throw new Error('Некорректное состояние боя.');
    if (!Array.isArray(v.log) || !Array.isArray(v.appliedCommandIds) || v.log.length > 150 || v.appliedCommandIds.length > 1000)
        throw new Error('Некорректная история сцены.');
    for (const e of v.log) {
        if (!e || typeof e.id !== 'string' || typeof e.text !== 'string' || e.text.length > 2000 || !Number.isInteger(e.round) || e.round < 0 || !Array.isArray(e.actorIds) || e.actorIds.length > 20 || e.actorIds.some(id => typeof id !== 'string') || (e.kind !== undefined && typeof e.kind !== 'string'))
            throw new Error('Некорректная запись журнала.');
        if (e.location !== undefined && !LOCATIONS.some(l => l.id === e.location))
            throw new Error('Некорректное место попадания в журнале.');
        for (const k of ['program', 'operation', 'deviceType', 'deathCause'])
            if (e[k] !== undefined && e[k] !== null && typeof e[k] !== 'string')
                throw new Error('Некорректный результат в журнале.');
        if (e.kind === 'control' && typeof e.success !== 'boolean')
            throw new Error('Некорректный результат управления.');
        for (const k of ['roll', 'bonus', 'total', 'difficulty', 'rawDamage', 'sp', 'btm', 'damage', 'stunRoll', 'stunLimit', 'immediateDeathRoll', 'strength', 'base'])
            if (e[k] !== undefined && e[k] !== null && !Number.isFinite(e[k]))
                throw new Error('Некорректные расчёты в журнале.');
    }
    if (['combat', 'paused'].includes(v.phase) && !v.order.length)
        throw new Error('В бою нет очереди участников.');
    if (v.appliedCommandIds.some(id => typeof id !== 'string' || id.length > 100))
        throw new Error('Некорректные идентификаторы команд.');
    return { ...clone(v), devices: clone(v.devices || []), settings: { stagedPenetration: v.settings?.stagedPenetration === true } };
}
