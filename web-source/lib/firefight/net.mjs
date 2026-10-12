// CP2020 core pp140,150,153: Controllers succeed on d10 <= program STR.
export const CONTROLLERS = {
    genie: { id: 'genie', name: 'Genie', strength: 5, type: 'door' },
    crystalBall: { id: 'crystalBall', name: 'Crystal Ball', strength: 4, type: 'camera' },
    soundmachine: { id: 'soundmachine', name: 'Soundmachine', strength: 4, type: 'speaker' },
};
export function deviceActions(device, scene) {
    if(device.remoteOnly&&device.type==='door')return [{id:'open',label:'Открыть дверь'},{id:'close',label:'Закрыть дверь'}];
    if(device.remoteOnly&&device.type==='speaker')return [{id:'on',label:'Включить тревогу'},{id:'off',label:'Выключить объявление'}];
    if (device.type === 'door')
        return [{ id: scene.tiles[device.y]?.[device.x]?.open ? 'close' : 'open', label: scene.tiles[device.y]?.[device.x]?.open ? 'Закрыть дверь' : 'Открыть дверь' }];
    if (device.type === 'camera')
        return [{ id: 'observe', label: 'Посмотреть через камеру' }];
    if (device.type === 'speaker')
        return [{ id: device.active ? 'off' : 'on', label: device.active ? 'Выключить объявление' : 'Включить тревогу' }];
    return [];
}
export function controllerFor(actor, device) { return Object.values(CONTROLLERS).find(p => p.type === device.type && actor.net?.programIds?.includes(p.id)) || null; }
export const adjacent = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;
