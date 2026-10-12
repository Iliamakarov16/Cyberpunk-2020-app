export const LOCATIONS = [
    { id: 'head', label: 'Голова', short: 'Голова', die: [1] },
    { id: 'torso', label: 'Корпус', short: 'Корпус', die: [2, 3, 4] },
    { id: 'rightArm', label: 'Правая рука', short: 'П. рука', die: [5] },
    { id: 'leftArm', label: 'Левая рука', short: 'Л. рука', die: [6] },
    { id: 'rightLeg', label: 'Правая нога', short: 'П. нога', die: [7, 8] },
    { id: 'leftLeg', label: 'Левая нога', short: 'Л. нога', die: [9, 10] },
];
export const PISTOL = { id: 'colt-amt2000', name: 'Colt AMT 2000', category: 'Пистолет', skill: 'handgun', accuracy: 0, damageDice: 4, damageBonus: 1, magazine: 8, rof: 1, range: 50, ammo: 8, reserve: 32 };
export const RIFLE = { id: 'militech-ronin', name: 'Militech Ronin', category: 'Винтовка', skill: 'rifle', accuracy: 1, damageDice: 5, damageBonus: 0, magazine: 35, rof: 30, range: 400, ammo: 35, reserve: 70 };
function actor(id, name, team, sprite, x, y, overrides = {}) {
    return { id, characterId: id, name, team, sprite, x, y, hidden: false, status: 'active', wounds: 0, destroyed: [], facing: 1,
        stats: { ref: 7, ma: 5, body: 8, combatSense: 2, handgun: 4, rifle: 4, interface: 0 },
        armor: { head: 0, torso: 18, rightArm: 16, leftArm: 16, rightLeg: 14, leftLeg: 14 }, weapon: { ...PISTOL },
        actions: 0, shots: 0, moved: false, initiative: 0, stabilized: false, ...overrides };
}
export function createDemoScene() {
    const width = 24, height = 16;
    const tiles = Array.from({ length: height }, (_, y) => Array.from({ length: width }, () => ({ type: 'floor', zone: y >= 13 ? 'street' : 'bar' })));
    const wall = (x, y) => { tiles[y][x] = { type: 'wall', zone: 'bar' }; };
    for (let x = 2; x <= 21; x++) {
        wall(x, 2);
        wall(x, 12);
    }
    for (let y = 2; y <= 12; y++) {
        wall(2, y);
        wall(21, y);
    }
    for (let x = 17; x <= 20; x++)
        wall(x, 6);
    for (let y = 3; y <= 5; y++)
        wall(17, y);
    tiles[6][18] = { type: 'door', open: false, zone: 'bar' };
    tiles[12][7] = { type: 'door', open: true, zone: 'bar' };
    for (let y = 3; y <= 5; y++)
        for (let x = 18; x <= 20; x++)
            tiles[y][x].zone = 'office';
    const props = [
        { id: 'table-1', type: 'table', x: 6, y: 5, w: 2, h: 1, cover: true, label: 'Стол' },
        { id: 'table-2', type: 'table', x: 7, y: 8, w: 2, h: 1, cover: true, label: 'Стол' },
        { id: 'table-3', type: 'table', x: 12, y: 9, w: 2, h: 1, cover: true, label: 'Стол' },
        { id: 'table-4', type: 'table', x: 18, y: 10, w: 2, h: 1, cover: true, label: 'Стол' },
        { id: 'bar-1', type: 'counter', x: 11, y: 4, w: 5, h: 1, cover: true, label: 'Барная стойка' },
        { id: 'crate-1', type: 'crate', x: 10, y: 8, w: 1, h: 1, cover: true, label: 'Ящик' },
        { id: 'crate-2', type: 'crate', x: 19, y: 3, w: 1, h: 1, cover: true, label: 'Ящик' },
        { id: 'barrel-1', type: 'barrel', x: 3, y: 4, w: 1, h: 1, cover: true, label: 'Бочка' },
        { id: 'barrel-2', type: 'barrel', x: 20, y: 11, w: 1, h: 1, cover: true, label: 'Бочка' },
    ];
    return { schemaVersion: 1, id: 'last-stop-bar', demoRevision: 2, name: 'Последняя остановка', subtitle: 'Бар · Найт-Сити · 2020', version: 0, phase: 'preparation', round: 0, index: 0, order: [], tileMeters: 1, width, height, tiles, props,
        actors: [actor('ray', 'Рэй', 'crew', 0, 6, 10), actor('mira', 'Мира', 'crew', 1, 8, 10, { stats: { ref: 6, ma: 6, body: 6, combatSense: 0, handgun: 4, rifle: 2, interface: 4 }, net: { deck: true, programIds: ['genie', 'crystalBall', 'soundmachine'], linkedPortId: null, knownDeviceIds: [], controlUsed: false } }),
            actor('guard-1', 'Охранник', 'hostile', 2, 16, 8, { stats: { ref: 5, ma: 4, body: 7, combatSense: 0, handgun: 4, rifle: 3, interface: 0 }, armor: { head: 10, torso: 14, rightArm: 14, leftArm: 14, rightLeg: 12, leftLeg: 12 }, weapon: { ...RIFLE } }),
            actor('guard-2', 'Охранник у подсобки', 'hostile', 2, 19, 5, { hidden: true, stats: { ref: 6, ma: 4, body: 7, combatSense: 0, handgun: 4, rifle: 3, interface: 0 }, armor: { head: 10, torso: 14, rightArm: 14, leftArm: 14, rightLeg: 12, leftLeg: 12 }, weapon: { ...RIFLE } })],
        devices: [
            { id: 'bar-port', name: 'Порт деки', type: 'port', networkId: 'bar-network', x: 9, y: 10 },
            { id: 'office-door', name: 'Дверь подсобки', type: 'door', networkId: 'bar-network', x: 18, y: 6 },
            { id: 'entrance-door', name: 'Входная дверь', type: 'door', networkId: 'bar-network', x: 7, y: 12 },
            { id: 'office-camera', name: 'Камера подсобки', type: 'camera', networkId: 'bar-network', x: 20, y: 4, range: 6, active: true },
            { id: 'bar-speaker', name: 'Громкая связь', type: 'speaker', networkId: 'bar-network', x: 12, y: 3, active: false },
        ],
        settings: { stagedPenetration: true }, log: [], appliedCommandIds: [] };
}
export const SPRITE_BOUNDS = [
    [125, 51, 232, 376], [594, 54, 189, 376], [1033, 47, 201, 380], [1476, 47, 168, 380],
    [145, 527, 160, 283], [529, 541, 260, 254], [950, 527, 350, 297], [1472, 473, 191, 355],
];
export const PROP_BOUNDS = [[70, 275, 491, 296], [646, 269, 522, 307], [1275, 144, 256, 480], [1734, 144, 214, 480]];
