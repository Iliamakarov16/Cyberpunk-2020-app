# Shared battle rules reference

`engine.mjs`, `scene.mjs`, and `net.mjs` are unmodified snapshots of the accepted
CP2020 firefight module, pinned by SHA-256 in `test_shared_battle_parity.py`.
They are test inputs only. Android's production server uses only Python and
Python's standard library; Node is required for development parity checks.

`runner.mjs` executes identical deterministic fixtures in the JS engine. Tests
compare Python shot previews, actor mutations, damage/hit/save mechanics and RNG
consumption against it. Event prose differs; authoritative numerical results do
not. Cases cover misses/critical misses, exploding d10, point-blank maximum
damage, called/random locations, range bands, cover and blocked legs, walls and
doors, armor/SP/BTM, minimum penetrating damage, stun, head death, limb shock,
initiative, new rounds, recovery, and mortal checks. Runtime staged armor
penetration is explicitly disabled, although the lower-level damage helper is
also parity-tested with it enabled.

Run from the Android bundle root:

    python3 -m unittest discover -s tests -p 'test_shared_battle*.py' -v

## HTTP contract under test

Authenticated same-origin requests use existing session cookies and X-CSRF-Token.
Campaign GM identity comes from `campaigns.gm_id`; the UI mode is never authority.
Players also need current campaign membership and an accepted active/reserve
character. Control is the actual sheet owner, not an actor ID provided as a role.

- GET `/api/campaigns/:id/battle`: current role-specific state and GM preparation
  options. No side effects.
- POST same path: prepare a new scene with an idempotent command ID, expected
  battle version, name, dimensions/scale, explicit actors and optional tiles/props.
- POST `/api/campaigns/:id/battle/commands`: place, start, end, finish,
  declare-shot, confirm, reject.

Response: `{role, controlledActorIds, battle, options:{characters}, rulesNote}`.
A battle contains `{id, version, phase, scene, pending, log}`. The scene conforms
to the combat renderer's projected shape. A mutation adds `{duplicate, receipt}`.
A receipt records commandId/type/version/battleId and an optional role-filtered
event. Retry uses the exact same ID and payload; only expectedVersion may change
without constituting a new command. The original effect is never repeated.
Scene versions increase monotonically, including new preparations; battle IDs
change for each new scene. Command IDs are durable per campaign, including after
new preparation and restart.

Preparation actor:

    {characterId, version, x, y, team, hidden, sprite, weapon, armor, combatSense}

The character must be accepted in this campaign or owned by its GM. It must be
at the submitted sheet version. `armor` is a GM-confirmed object with all six SP
zones (0–200). `combatSense` is 0 or the explicitly designated actual special
skill rank. Effective REF/MA/BODY come from the actual sheet including equipped
item stat modifiers and EV with the existing tracker semantics.

`weapon:null` means an unarmed participant. A configured firearm requires:

    {weaponId, ammoItemId, skillName, skillRank,
     damageDice, damageBonus, accuracy, range, rof}

Weapon/ammo IDs are verified against separate real inventory rows with weapon
and ammo categories. The weapon must have positive quantity. A nonempty skill
must match exactly one actual REF-based skill and its rank. Empty skillName with
rank 0 is untrained. The GM explicitly confirms weapon statistics, which are
not inferred from prose or item names. Ammo is a linked inventory quantity;
this bounded slice does not model a separate loaded magazine/reload workflow.

All commands have `{id,battleId,expectedVersion,type}`. Additional fields:

- place: actorId,x,y (GM, preparation only)
- start: none (GM, preparation only)
- end: actorId (GM, current turn only)
- finish: none (GM, no pending declaration)
- declare-shot: actorId,targetId,location (owner or GM, current turn)
- confirm/reject: declarationId (GM only)

A declaration consumes no ammo and rolls no dice. It exposes a preview only to
its owner and GM. Confirmation rolls on the server, applies the validated
single shot, updates the actual linked ammo row and actual target sheet wounds,
writes sheet revisions, saves the scene, and records an idempotency receipt in
one BEGIN IMMEDIATE transaction. All relevant sheet versions are checked before
rolling and updated by CAS; the scene also uses CAS. Unexpected storage failure
rolls back all effects, revisions and receipts.

## Explicit boundaries

- Armor wear is disabled; no equipment coverage or armor mode is rewritten.
- Sheet wound boxes cap at the existing schema limit of 40. Full uncapped battle
  wounds, damage and status remain in the persisted battle and command audit.
- Stun/death/destroyed-location state is battle-local. The free-text sheet
  condition is preserved. Starting a new scene reinitializes these battle states.
- Only the bounded firearm/turn flow is present: no movement, reload, burst,
  physical dice, netrunning, undo or arbitrary full-scene state writes.
- A changed linked sheet blocks approval with 409, preserving the pending
  declaration. GM rejects it, finishes the old scene, then prepares from fresh
  sheets. Re-preparation during preparation is also allowed.
- The current battle and durable receipts are part of the host SQLite database
  and whole-host backups. Existing portable campaign JSON does not carry them.
- No external server deployment or APK rebuilding is part of these tests.
