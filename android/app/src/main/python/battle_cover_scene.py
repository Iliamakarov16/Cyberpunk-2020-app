"""Pure, explicitly configured scenery protection and table-flip geometry.

The CP2020 SP combination belongs exclusively to ``battle_cover``. This module
does not choose material SP, coverage, opacity, HP/SDP, destruction or wear.
Those protection values are explicit GM choices; opacity and ballistic body
coverage remain independent. Missing profiles preserve legacy scenery.

The bounded grid flip is an application convention: one action pushes an
unflipped, configured movable table onto its far edge inside its current
footprint. Horizontal tables can flip north/south, vertical ones east/west,
and square tables in all four cardinal directions. A one-cell-thick table can
retain its footprint while changing its actual coverage and opacity. No
fictional translation is added to force a visual movement.

The original footprint is the swept area. It and the resulting edge must be
free of nonfloor tiles, other props, live actors and devices. Rejecting illegal
legacy overlaps is an explicit application safety boundary, not a printed
CP2020 strength, weight or furniture rule. The caller owns turn, status,
authorization and action accounting; this module never mutates any input.
"""

import copy

import battle_cover
import battle_vision


ZONES = ('head', 'torso', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg')
FACINGS = (0, 90, 180, 270)
PROP_PROFILE_FIELDS = frozenset(('material', 'sp', 'coveredZones', 'blocksVision',
                                 'movable', 'flippedCoveredZones',
                                 'flippedBlocksVision'))
TILE_PROFILE_FIELDS = frozenset(('material', 'sp'))


def _integer(value, name, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError('%s must be an integer in [%s, %s]' % (name, minimum, maximum))
    return value


def _text(value, name):
    if type(value) is not str or not value.strip() or len(value) > 100:
        raise ValueError(name + ' must be a nonblank string of at most 100 characters')
    return value


def _boolean(value, name):
    if type(value) is not bool:
        raise ValueError(name + ' must be a boolean')
    return value


def _zones(value, name):
    if (type(value) is not list or len(value) > len(ZONES) or
            any(type(zone) is not str or zone not in ZONES for zone in value) or
            len(set(value)) != len(value)):
        raise ValueError(name + ' must be a list of unique existing body zones')
    return list(value)


def _profile(profile, fields):
    if type(profile) is not dict or set(profile) != fields:
        raise ValueError('protection must contain exactly ' + ', '.join(sorted(fields)))
    return dict(material=_text(profile['material'], 'material'),
                sp=_integer(profile['sp'], 'sp', 0, battle_cover.MAX_SP))


def validate_prop_protection(profile):
    """Return a detached strict profile; no material or coverage defaults exist."""
    result = _profile(profile, PROP_PROFILE_FIELDS)
    for name in ('coveredZones', 'flippedCoveredZones'):
        result[name] = _zones(profile[name], name)
    for name in ('blocksVision', 'movable', 'flippedBlocksVision'):
        result[name] = _boolean(profile[name], name)
    return result


def validate_tile_protection(profile):
    """Validate wall/door material and SP; the caller checks the tile's kind.

    An open door keeps its stored profile, but supplies no ballistic layer.
    This function only validates configuration; it never traces an attack.
    """
    return _profile(profile, TILE_PROFILE_FIELDS)


def validate_prop_state(prop):
    """Validate optional protection/flip fields and return the full prop copy.

    The caller still validates the existing base prop schema and geometry.
    Explicit ``flipped=False`` is valid without a profile. Only configured
    movable tables may be flipped; other protected scenery must be immovable.
    A persisted flipped table must have its declared edge-shaped footprint.
    """
    if type(prop) is not dict:
        raise ValueError('prop must be an object')
    flipped = _boolean(prop.get('flipped', False), 'flipped')
    profile = (validate_prop_protection(prop['protection'])
               if 'protection' in prop else None)
    if profile is not None and profile['movable'] and prop.get('type') != 'table':
        raise ValueError('only tables may have movable protection')
    if flipped:
        if prop.get('type') != 'table' or profile is None or not profile['movable']:
            raise ValueError('only a configured movable table may be flipped')
        facing = prop.get('facing')
        if type(facing) is not int or facing not in FACINGS:
            raise ValueError('a flipped table needs a cardinal facing')
        thickness = prop.get('w') if facing in (0, 180) else prop.get('h')
        if type(thickness) is not int or thickness != 1:
            raise ValueError('a flipped table must occupy a one-cell-thick edge')
    result = copy.deepcopy(prop)
    if profile is not None:
        result['protection'] = profile
    return result


def active_prop_protection(prop):
    """Return a detached current material/SP/coverage/opacity, or None.

    The legacy ``cover`` flag does not override an explicit protection profile.
    SP zero remains configured zero protection; it does not remove the prop or
    override its independently configured visibility blocking.
    """
    state = validate_prop_state(prop)
    profile = state.get('protection')
    if profile is None:
        return None
    flipped = state.get('flipped', False)
    return dict(material=profile['material'], sp=profile['sp'],
                coveredZones=list(profile['flippedCoveredZones' if flipped else 'coveredZones']),
                blocksVision=profile['flippedBlocksVision' if flipped else 'blocksVision'])


def _rectangle(prop, width, height):
    if type(prop) is not dict:
        raise ValueError('prop must be an object')
    x = _integer(prop.get('x'), 'prop.x', 0, width - 1)
    y = _integer(prop.get('y'), 'prop.y', 0, height - 1)
    w = _integer(prop.get('w'), 'prop.w', 1, width - x)
    h = _integer(prop.get('h'), 'prop.h', 1, height - y)
    return dict(x=x, y=y, w=w, h=h)


def _point(point, width, height, name):
    if type(point) is not dict:
        raise ValueError(name + ' must be an object')
    return (_integer(point.get('x'), name + '.x', 0, width - 1),
            _integer(point.get('y'), name + '.y', 0, height - 1))


def _cells(rectangle):
    return frozenset((x, y)
                     for y in range(rectangle['y'], rectangle['y'] + rectangle['h'])
                     for x in range(rectangle['x'], rectangle['x'] + rectangle['w']))


def _scene_geometry(scene):
    if type(scene) is not dict:
        raise ValueError('scene must be an object')
    width = _integer(scene.get('width'), 'width', 1, battle_vision.MAX_MAP_SIZE)
    height = _integer(scene.get('height'), 'height', 1, battle_vision.MAX_MAP_SIZE)
    tiles = scene.get('tiles')
    if (type(tiles) is not list or len(tiles) != height or
            any(type(row) is not list or len(row) != width for row in tiles)):
        raise ValueError('tiles must match the bounded map dimensions')
    for row in tiles:
        for tile in row:
            if type(tile) is not dict or tile.get('type') not in ('floor', 'wall', 'door'):
                raise ValueError('tile must be floor, wall or door')
            if tile['type'] == 'door':
                _boolean(tile.get('open'), 'door.open')
    props = scene.get('props', [])
    if type(props) is not list or len(props) > 200:
        raise ValueError('props must be a list of at most 200 objects')
    ids = set()
    for prop in props:
        _rectangle(prop, width, height)
        identifier = _text(prop.get('id'), 'prop.id')
        if identifier in ids:
            raise ValueError('prop IDs must be unique')
        ids.add(identifier)
    for name, maximum in (('actors', 20), ('devices', 40)):
        values = scene.get(name, [])
        if type(values) is not list or len(values) > maximum:
            raise ValueError('%s must be a list of at most %s objects' % (name, maximum))
        for item in values:
            _point(item, width, height, name)
    return width, height, props


def preview_flip(scene, actor, propId, facing):
    """Return ``{propId,before,after,footprint,actionCost:1}`` without mutation.

    Push headings are 0=east, 90=south, 180=west and 270=north. The actor
    must stand immediately on the opposite side, with orthogonal contact at
    one table cell. A malformed scene or an illegal flip raises ValueError.
    Actor identity, active status, current turn and permissions are deliberately
    left to the authoritative caller, as are committing the returned copy and
    charging its single action.
    """
    width, height, props = _scene_geometry(scene)
    ax, ay = _point(actor, width, height, 'actor')
    _text(propId, 'propId')
    if type(facing) is not int or facing not in FACINGS:
        raise ValueError('facing must be 0, 90, 180 or 270')
    original = next((prop for prop in props if prop['id'] == propId), None)
    if original is None:
        raise ValueError('table is unavailable')
    before = validate_prop_state(original)
    if (before.get('type') != 'table' or 'protection' not in before or
            not before['protection']['movable']):
        raise ValueError('flip requires a configured movable table')
    if before.get('flipped', False):
        raise ValueError('table is already flipped')
    x, y, w, h = (before[key] for key in ('x', 'y', 'w', 'h'))
    if w > h and facing not in (90, 270) or h > w and facing not in (0, 180):
        raise ValueError('push must be perpendicular to the long table edge')

    if facing == 0:
        adjacent = ax == x - 1 and y <= ay < y + h
        contact = (x, ay)
        footprint = dict(x=x + w - 1, y=y, w=1, h=h)
    elif facing == 90:
        adjacent = ay == y - 1 and x <= ax < x + w
        contact = (ax, y)
        footprint = dict(x=x, y=y + h - 1, w=w, h=1)
    elif facing == 180:
        adjacent = ax == x + w and y <= ay < y + h
        contact = (x + w - 1, ay)
        footprint = dict(x=x, y=y, w=1, h=h)
    else:
        adjacent = ay == y + h and x <= ax < x + w
        contact = (ax, y + h - 1)
        footprint = dict(x=x, y=y, w=w, h=1)
    if not adjacent:
        raise ValueError('stand directly adjacent on the opposite side of the push')
    if (scene['tiles'][ay][ax]['type'] != 'floor' or
            scene['tiles'][contact[1]][contact[0]]['type'] != 'floor' or
            contact not in battle_vision.visible_cells(scene, actor)):
        raise ValueError('table contact requires clear reach from a floor cell')

    swept = _cells(before)
    if any(scene['tiles'][cy][cx]['type'] != 'floor' for cx, cy in swept):
        raise ValueError('table swept area must be floor without walls or doors')
    if any(prop is not original and swept & _cells(prop) for prop in props):
        raise ValueError('table swept area overlaps another prop')
    if any((item['x'], item['y']) in swept and item.get('status') != 'dead'
           for item in scene.get('actors', [])):
        raise ValueError('table swept area overlaps a live actor')
    if any((item['x'], item['y']) in swept for item in scene.get('devices', [])):
        raise ValueError('table swept area overlaps a device')

    after = copy.deepcopy(before)
    after.update(footprint, flipped=True, facing=facing)
    return dict(propId=propId, before=before, after=after,
                footprint=dict(footprint), actionCost=1)
