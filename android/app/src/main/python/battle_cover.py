"""Pure Cyberpunk 2020 ordinary armor/cover protection, before BTM or wounds.

Primary source: CP2020 core, printed pp. 101–103, especially the proportional
armor rule (p. 101) and its difference/bonus table (p. 102). Verified scans:
https://www.scribd.com/document/1041450615/Cyberpunk-2020-TTRPG-Rulebook

``combine_sp(inner, outer)`` returns the larger SP plus the table bonus.
``resolve_protection(raw_damage, armor_sp, cover_layers)`` returns a detached
JSON receipt. Each cover layer is exactly ``{id: str, sp: int}``; its position
in the list is its physical order from inside to outside. Starting at armor,
combine each successive layer with the previous combined SP. Do not sort the
layers or add their SPs. The caller supplies the already-resolved armor SP for
the struck location and only the covers that protect that location and attack.

SP zero is absent protection, including an exhausted material: it contributes
no proportional bonus. This explicit representation convention avoids treating
an unarmored target as another protective layer. Page 102 states that armor
reduced to zero no longer stops damage. A zero-SP layer is kept in the receipt
as a no-op so that the supplied order remains auditable.

Input bounds are application validation limits, not printed equipment limits:
individual SP 0..1000, raw damage 0..1000000, at most 16 cover layers. Internal
combined SP can exceed 1000. All numbers must be actual integers, never bools,
numeric strings or floats. Inputs are never modified; output is fresh JSON
data, not an immutable Python object or an alias of input data.

Only ordinary SP reduction is supported. AP rounds, edged/special weapons and
other armor exceptions must be gated by the caller before using this kernel;
raw damage and SP alone cannot identify those attack types. This module does
not infer materials, target coverage, cover direction, visibility, geometry,
HP/SDP, destruction or damage to individual layers. Staged armor penetration
is optional (p. 102); this receipt neither applies it nor invents cover wear.
``penetration`` is damage remaining before BTM and location effects, not final
wound damage. Equality stops the attack; a stopped attack causes zero damage.
"""


RULES_VERSION = 'cp2020-core-cover-v1'
SOURCE_PAGES = (101, 102, 103)
MAX_SP = 1000
MAX_RAW_DAMAGE = 1000000
MAX_COVER_LAYERS = 16


def _integer(value, name, upper):
    if type(value) is not int or not 0 <= value <= upper:
        raise ValueError('%s must be an integer in [0, %s]' % (name, upper))
    return value


def _combination(inner, outer):
    """Calculate one already-validated pair; accumulated inner SP is unbounded.

    The external bounds apply to individual supplied protection values, not to
    the result of a prior pair. Keep this helper private to prevent bypassing
    input validation through the public API.
    """
    difference = abs(inner - outer)
    bonus = 0
    if inner and outer:
        for upper, addition in ((4, 5), (8, 4), (14, 3), (20, 2), (26, 1)):
            if difference <= upper:
                bonus = addition
                break
    return difference, bonus, max(inner, outer) + bonus


def combine_sp(inner, outer):
    """Combine two individual, nonnegative integer SPs using core p. 102.

    Either zero value is absent protection. Each input is limited to MAX_SP;
    the result may exceed it. Use resolve_protection for ordered layer stacks
    so that a valid accumulated result is not mistaken for an individual SP.
    """
    _integer(inner, 'inner', MAX_SP)
    _integer(outer, 'outer', MAX_SP)
    return _combination(inner, outer)[2]


def resolve_protection(raw_damage, armor_sp, cover_layers):
    """Validate an ordinary attack and return its ordered protection receipt.

    Layer objects must have exactly id/sp fields. IDs are unique, nonblank
    strings and are preserved verbatim. Empty cover lists and zero damage are
    valid. Invalid/unsupported inputs raise ValueError rather than coercing,
    clamping, dropping a layer, or applying another damage system silently.
    """
    _integer(raw_damage, 'raw_damage', MAX_RAW_DAMAGE)
    _integer(armor_sp, 'armor_sp', MAX_SP)
    if type(cover_layers) is not list or len(cover_layers) > MAX_COVER_LAYERS:
        raise ValueError('cover_layers must be a list of at most %s layers' % MAX_COVER_LAYERS)

    layers = []
    ids = set()
    for index, layer in enumerate(cover_layers):
        label = 'cover_layers[%s]' % index
        if type(layer) is not dict or set(layer) != {'id', 'sp'}:
            raise ValueError(label + ' must contain exactly id and sp')
        layer_id = layer['id']
        if type(layer_id) is not str or not layer_id.strip():
            raise ValueError(label + '.id must be a nonblank string')
        if layer_id in ids:
            raise ValueError(label + '.id must be unique')
        ids.add(layer_id)
        sp = _integer(layer['sp'], label + '.sp', MAX_SP)
        layers.append((layer_id, sp))

    effective_sp = armor_sp
    steps = []
    for layer_id, sp in layers:
        difference, bonus, combined = _combination(effective_sp, sp)
        steps.append(dict(layerId=layer_id, innerSP=effective_sp, outerSP=sp,
                          difference=difference, bonus=bonus, effectiveSP=combined))
        effective_sp = combined

    penetration = max(0, raw_damage - effective_sp)
    return dict(rulesVersion=RULES_VERSION, sourcePages=list(SOURCE_PAGES),
                damageStage='before-btm-and-location-effects',
                rawDamage=raw_damage, armorSP=armor_sp, effectiveSP=effective_sp,
                penetration=penetration, penetrated=penetration > 0, steps=steps)
