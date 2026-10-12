import { SPRITE_BOUNDS } from './scene.mjs';

// Static local allowlist. An actor supplies only a numeric appearance ID, never a URL or crop.
// Artwork is cosmetic: this registry deliberately contains no equipment or combat rules.
export const ACTOR_HEIGHT = 108;
export const ACTOR_FOOT_ANCHOR = Object.freeze([.5, .86]);
export const FALLBACK_APPEARANCE_ID = 2;
const originalLabels = ['Рэй · исходный облик', 'Мира · исходный облик', 'Охранник · исходный облик', 'Боец · исходный облик'];
const original = originalLabels.map((label, id) => ({
    id, label, url: '/art/combat-atlas.png', dimensions: [1774, 887], sourceRect: [...SPRITE_BOUNDS[id]], original: true,
}));
const added = [
    {"id": 4, "label": "Бандит в красном жилете", "url": "/art/enemies-v1/04-gang-enforcer.png", "dimensions": [1184, 1328], "sourceRect": [308, 41, 558, 1236], "original": false},
    {"id": 5, "label": "Стрелок в фиолетовом", "url": "/art/enemies-v1/05-glam-pistolier.png", "dimensions": [1225, 1284], "sourceRect": [320, 84, 614, 1125], "original": false},
    {"id": 6, "label": "Охранник со щитом", "url": "/art/enemies-v1/06-riot-security.png", "dimensions": [1136, 1385], "sourceRect": [184, 95, 756, 1200], "original": false},
    {"id": 7, "label": "Боец в жёлтом плаще", "url": "/art/enemies-v1/07-dock-shotgunner.png", "dimensions": [1101, 1429], "sourceRect": [118, 114, 836, 1223], "original": false},
    {"id": 8, "label": "Уличный боец в бирюзовом", "url": "/art/enemies-v1/08-razor-runner.png", "dimensions": [1141, 1379], "sourceRect": [251, 85, 642, 1203], "original": false},
    {"id": 9, "label": "Корпоративный оперативник", "url": "/art/enemies-v1/09-corporate-operative.png", "dimensions": [1024, 1536], "sourceRect": [204, 100, 648, 1346], "original": false},
    {"id": 10, "label": "Тяжёлый боец в рабочей броне", "url": "/art/enemies-v1/10-salvage-heavy.png", "dimensions": [1216, 1294], "sourceRect": [132, 105, 898, 1107], "original": false},
    {"id": 11, "label": "Охранница в синем", "url": "/art/enemies-v1/11-security-carbine.png", "dimensions": [1145, 1374], "sourceRect": [275, 92, 584, 1201], "original": false},
];
export const ACTOR_APPEARANCES = Object.freeze([...original, ...added].map(entry => Object.freeze({
    ...entry, dimensions: Object.freeze(entry.dimensions), sourceRect: Object.freeze(entry.sourceRect),
})));
export function isActorAppearanceId(id) {
    return Number.isInteger(id) && id >= 0 && id < ACTOR_APPEARANCES.length;
}
export function actorAppearance(id) {
    return ACTOR_APPEARANCES[isActorAppearanceId(id) ? id : FALLBACK_APPEARANCE_ID];
}
export function appearanceImageReady(image, appearance) {
    if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return false;
    const [x, y, width, height] = appearance.sourceRect;
    return image.naturalWidth === appearance.dimensions[0] && image.naturalHeight === appearance.dimensions[1]
        && x >= 0 && y >= 0 && width > 0 && height > 0
        && x + width <= image.naturalWidth && y + height <= image.naturalHeight;
}
