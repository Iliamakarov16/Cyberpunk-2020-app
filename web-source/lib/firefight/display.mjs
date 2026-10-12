import { LOCATIONS } from './scene.mjs';
export const locationName = id => LOCATIONS.find(l => l.id === id)?.label || id;
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
export const actionPenalty = a => -3 * a.actions;
