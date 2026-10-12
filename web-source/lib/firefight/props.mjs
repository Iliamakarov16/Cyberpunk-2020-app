/** Square-grid scenery contract. Coordinates are the top-left occupied cell.
 * w/h are collision dimensions, not sprite dimensions. Vehicles are stationary
 * cover with the original prop rules, not actors or drivable vehicles.
 * Existing scenes may use custom furniture footprints; new placements use these
 * defaults. Only vehicles have fixed, validated sizes. Rotation is encoded by
 * swapping w/h; optional facing preserves all four directions in newer files.
 */
export const PROP_CATALOG = Object.freeze({
    table: Object.freeze({ w: 2, h: 1, label: 'Стол' }),
    counter: Object.freeze({ w: 5, h: 1, label: 'Стойка' }),
    barrel: Object.freeze({ w: 1, h: 1, label: 'Бочка' }),
    crate: Object.freeze({ w: 1, h: 1, label: 'Ящик' }),
    car: Object.freeze({ w: 4, h: 2, label: 'Машина' }),
    van: Object.freeze({ w: 5, h: 2, label: 'Фургон' }),
});
export function propFootprint(type, orientation = 'horizontal') {
    const entry = Object.hasOwn(PROP_CATALOG, type) ? PROP_CATALOG[type] : null;
    if (!entry || !['horizontal', 'vertical', 0, 90, 180, 270].includes(orientation)) return null;
    return ['vertical',90,270].includes(orientation) ? { w: entry.h, h: entry.w } : { w: entry.w, h: entry.h };
}
export function isVehicleFootprint(prop) {
    if (!['car', 'van'].includes(prop.type)) return false;
    const entry = PROP_CATALOG[prop.type];
    return prop.w === entry.w && prop.h === entry.h || prop.w === entry.h && prop.h === entry.w;
}
/** Exact occupied pixel rectangle, shared by paint previews and scenery art. */
export function propPixelBounds(prop, tile = 64) {
    return { x: prop.x * tile, y: prop.y * tile, w: prop.w * tile, h: prop.h * tile };
}

/** Legacy files keep their old axis; no load-time footprint resizing. */
export function propFacing(prop) { return [0,90,180,270].includes(prop.facing) ? prop.facing : prop.h > prop.w ? 90 : 0; }
