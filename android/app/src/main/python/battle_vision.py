"""Pure, single-observer visibility for the server's bounded tactical grid.

Geometry remains centre-to-centre line of sight across the whole map. Walls
and closed doors are opaque; the first opaque target cell is visible. Touching
an opaque cell's corner also blocks sight. Open doors and low cover do not.
``actor_visible_cells`` intersects that geometry with the forward shoulder
half-plane (dot product >= 0), a bounded 180-degree interpretation of CP2020
LOS/Facing. Eight grid headings and exact boundary inclusion are application
conventions, not extra perception, range, lighting or stealth mechanics.
``visible_cells`` deliberately remains geometric for unoriented NET cameras.

The caller must choose exactly one authorized observer and enforce any actor
status policy. This module neither chooses an actor nor combines party eyes.
It does not modify the scene, preserve explored cells, access accounts or keep
sessions. The only cache contains immutable geometry and immutable results.
"""

from functools import lru_cache


MAX_MAP_SIZE = 60
VISIBILITY_CACHE_SIZE = 32
_EMPTY = frozenset()
HEADING_VECTORS = {0: (1, 0), 45: (1, 1), 90: (0, 1), 135: (-1, 1),
                   180: (-1, 0), 225: (-1, -1), 270: (0, -1), 315: (1, -1)}


def actor_heading(actor):
    """Explicit headings are strict; old horizontal sprite facing is inferred."""
    if not isinstance(actor, dict):
        return None
    if 'heading' in actor:
        value = actor['heading']
        return value if type(value) is int and value in HEADING_VECTORS else None
    facing = actor.get('facing', 1)
    return (180 if facing == -1 else 0) if type(facing) is int and facing in (-1, 1) else None


def actor_visible_cells(scene, observer):
    """One actor's LOS intersected with its authoritative forward half-plane.

    No scene or actor data are changed, and no party eyes are combined. A
    malformed explicit heading fails closed rather than widening the view.
    Geometry is cached independently, so turning never repeats raycasts.
    """
    heading = actor_heading(observer)
    if heading is None:
        return _EMPTY
    cells = visible_cells(scene, observer)
    if not cells:
        return _EMPTY
    dx, dy = HEADING_VECTORS[heading]
    ox, oy = observer['x'], observer['y']
    return frozenset((x, y) for x, y in cells if (x - ox) * dx + (y - oy) * dy >= 0)



def visible_cells(scene, observer):
    """Return a frozenset of visible ``(x, y)`` integer cell coordinates.

    ``scene`` supplies the existing ``width``, ``height`` and ``tiles`` keys;
    ``observer`` is one dict with integer ``x`` and ``y`` coordinates. Other
    fields are intentionally ignored. A missing/malformed/off-map observer,
    an observer inside an opaque tile, or malformed map fails closed with an
    empty set. Bounds are checked before iterating the map. Valid older scenes
    need no vision fields, migration, identity or version in their cache key.
    """
    if not isinstance(scene, dict) or not isinstance(observer, dict):
        return _EMPTY
    width, height = scene.get('width'), scene.get('height')
    if (type(width) is not int or type(height) is not int or
            not 1 <= width <= MAX_MAP_SIZE or not 1 <= height <= MAX_MAP_SIZE):
        return _EMPTY
    x, y = observer.get('x'), observer.get('y')
    if type(x) is not int or type(y) is not int or not (0 <= x < width and 0 <= y < height):
        return _EMPTY
    tiles = scene.get('tiles')
    if not isinstance(tiles, (list, tuple)) or len(tiles) != height:
        return _EMPTY
    opaque = bytearray()
    for row in tiles:
        if not isinstance(row, (list, tuple)) or len(row) != width:
            return _EMPTY
        for tile in row:
            if not isinstance(tile, dict):
                return _EMPTY
            kind = tile.get('type')
            if kind == 'door':
                if type(tile.get('open')) is not bool:
                    return _EMPTY
                opaque.append(not tile['open'])
            elif kind in ('floor', 'wall'):
                opaque.append(kind == 'wall')
            else:
                return _EMPTY
    # Explicit GM-configured prop opacity is independent of ballistic SP.
    # Legacy low cover remains transparent; flipped posture selects its own flag.
    props=scene.get('props',[])
    if not isinstance(props,list):return _EMPTY
    # Runtime import avoids the geometry helper's reach-check dependency cycle.
    from battle_cover_scene import active_prop_protection, validate_prop_state
    for prop in props:
        if not isinstance(prop,dict):return _EMPTY
        if 'protection' not in prop and 'flipped' not in prop:continue
        try:
            validate_prop_state(prop)
            profile=active_prop_protection(prop)
        except (ValueError,TypeError,KeyError):return _EMPTY
        if profile is None:continue
        px,py,pw,ph=(prop.get(k) for k in ('x','y','w','h'))
        if any(type(v) is not int for v in (px,py,pw,ph)) or pw<1 or ph<1 or px<0 or py<0 or px+pw>width or py+ph>height:return _EMPTY
        if not profile['blocksVision']:continue
        for yy in range(py,py+ph):
            for xx in range(px,px+pw):opaque[yy*width+xx]=1
    if opaque[y * width + x]:
        return _EMPTY
    return _visible_cells(width, height, bytes(opaque), x, y)


@lru_cache(maxsize=VISIBILITY_CACHE_SIZE)
def _visible_cells(width, height, opaque, ox, oy):
    # At most 60*60 rays with at most 59+59 boundary crossings each. The cache
    # holds no scene/actor dictionaries and is bounded independently of users,
    # battles and requests. A wall edit or door toggle changes the value key;
    # changing names, versions, stats or owners cannot affect geometry.
    return frozenset((x, y) for y in range(height) for x in range(width)
                     if _clear_line(width, opaque, ox, oy, x, y))


def _clear_line(width, opaque, x, y, tx, ty):
    """Integer supercover traversal; no floats, angular sampling or epsilon.

    Boundary distances from a cell centre are odd multiples of half a cell.
    Cross-multiplying the next x/y distances orders crossings exactly. At a
    tie, both side cells touched at that corner must also be transparent.
    The target is checked before opacity, exposing the first blocking tile.
    """
    dx, dy = abs(tx - x), abs(ty - y)
    sx, sy = (1 if tx > x else -1), (1 if ty > y else -1)
    next_x, next_y = dy, dx
    while (x, y) != (tx, ty):
        if next_x < next_y:
            x += sx
            next_x += 2 * dy
        elif next_y < next_x:
            y += sy
            next_y += 2 * dx
        else:
            # A diagonal step cannot leave the map while both endpoints are
            # in bounds. Its two corner-touching side cells are in bounds too.
            if opaque[y * width + x + sx] or opaque[(y + sy) * width + x]:
                return False
            x += sx
            y += sy
            next_x += 2 * dy
            next_y += 2 * dx
        if (x, y) == (tx, ty):
            return True
        if opaque[y * width + x]:
            return False
    return True
