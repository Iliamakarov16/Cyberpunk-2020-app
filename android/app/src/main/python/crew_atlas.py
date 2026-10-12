"""Campaign-bound Atlas markers using Crew authentication and SQLite storage.

This adapter deliberately creates no identities, campaigns, invitations, or
alternate authentication flow. The HTTP host checks the Crew session, CSRF and
origin before calling ``api``. All authorization is rechecked in its transaction.
Source-map coordinates and canonical place IDs are retained without conversion.
"""
import hashlib
import json
import math
import re
import time
import uuid


MAX_MARKERS = 1000
MAX_ATLAS_BYTES = 1000000
MAX_REVISION = 10**12
KINDS = frozenset(('location', 'mission', 'danger', 'home', 'contact'))
MAP_PATTERN = re.compile(r'(?:city2020|synthesis|legacy|buildings|core|region|sector:[A-Za-z0-9-]{1,32})\Z')
IDENTIFIER_PATTERN = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}\Z')
PUBLIC_COLUMNS = 'id,name,description,kind,color,x,y,map,place_id,revealed,updated'
SCHEMA = '''
CREATE TABLE IF NOT EXISTS crew_atlas_state (
 campaign_id INTEGER PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision >= 0), updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS crew_atlas_markers (
 id TEXT NOT NULL,
 campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 name TEXT NOT NULL, description TEXT NOT NULL, secret TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('location','mission','danger','home','contact')),
 color TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, map TEXT NOT NULL,
 place_id TEXT, revealed INTEGER NOT NULL CHECK(revealed IN (0,1)),
 updated INTEGER NOT NULL, PRIMARY KEY(campaign_id,id));
CREATE INDEX IF NOT EXISTS idx_crew_atlas_markers_campaign
 ON crew_atlas_markers(campaign_id,revealed,updated);
CREATE TABLE IF NOT EXISTS crew_atlas_commands (
 campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 command_id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
 request_hash TEXT NOT NULL, result TEXT NOT NULL, created INTEGER NOT NULL,
 PRIMARY KEY(campaign_id,command_id));
'''


class AtlasError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message
        super().__init__(message)


def fail(message, status=400):
    raise AtlasError(status, message)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True, allow_nan=False)


def exact(value, required, optional=()):
    if (not isinstance(value, dict) or set(required) - set(value)
            or set(value) - set(required) - set(optional)):
        fail('Проверь поля команды карты.')


def text(value, limit, label, required=False):
    if not isinstance(value, str) or len(value) > limit or '\x00' in value:
        fail('Проверь поле «' + label + '».')
    value = value.strip()
    if required and not value:
        fail('Заполни поле «' + label + '».')
    return value


def integer(value, maximum, label):
    if type(value) is not int or not 0 <= value <= maximum:
        fail('Проверь ' + label + '.')
    return value


def marker_uuid(value):
    try:
        if not isinstance(value, str) or len(value) != 36:
            raise ValueError()
        result = str(uuid.UUID(value))
    except (ValueError, AttributeError):
        fail('Метка не найдена.', 404)
    if value.lower() != result:
        fail('Метка не найдена.', 404)
    return result


def validate_marker(raw):
    """Validate a full marker without silently rounding, truncating or relocating."""
    exact(raw, ('name', 'x', 'y', 'map'),
          ('description', 'secret', 'kind', 'color', 'placeId', 'revealed'))
    map_id = raw['map']
    if not isinstance(map_id, str) or not MAP_PATTERN.fullmatch(map_id):
        fail('Неизвестная карта.')
    maximum = 1024 if map_id in ('city2020', 'synthesis') else 6000
    for axis in ('x', 'y'):
        value = raw[axis]
        if (type(value) not in (int, float) or not 0 <= value <= maximum
                or not math.isfinite(value)):
            fail('Точка вне карты.')
    kind = raw.get('kind', 'location')
    if not isinstance(kind, str) or kind not in KINDS:
        fail('Неизвестный тип метки.')
    color = raw.get('color', '#f0cd66')
    if not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
        fail('Проверь цвет метки.')
    revealed = raw.get('revealed', False)
    if type(revealed) is not bool:
        fail('Проверь доступность метки игрокам.')
    place_id = raw.get('placeId')
    if place_id in ('', None):
        place_id = None
    elif not isinstance(place_id, str) or not IDENTIFIER_PATTERN.fullmatch(place_id):
        fail('Проверь ссылку на каноническое место.')
    return dict(name=text(raw['name'], 120, 'Название', True),
                description=text(raw.get('description', ''), 5000, 'Описание'),
                secret=text(raw.get('secret', ''), 5000, 'Заметки ГМ'),
                x=raw['x'], y=raw['y'], map=map_id, kind=kind, color=color,
                placeId=place_id, revealed=revealed)


def role_context(handler, db, user, campaign_id):
    campaign = handler.campaign(db, user, campaign_id)
    gm = campaign['gm_id'] == user['id']
    # Match the Crew terminal and shared firefight: joining alone is not approval.
    if not gm:
        member = db.execute('SELECT 1 FROM campaign_members WHERE campaign_id=? AND user_id=?',
                            (campaign_id, user['id'])).fetchone()
        accepted = db.execute('''SELECT 1 FROM campaign_characters cc
            JOIN characters c ON c.id=cc.character_id
            WHERE cc.campaign_id=? AND c.owner_id=? AND cc.status IN ('active','reserve')''',
                              (campaign_id, user['id'])).fetchone()
        if not member or not accepted:
            fail('Карта кампании доступна после принятия твоего персонажа.', 403)
    return campaign, gm


def marker_dto(row, gm):
    result = dict(id=row['id'], name=row['name'], description=row['description'],
                  kind=row['kind'], color=row['color'], x=row['x'], y=row['y'],
                  map=row['map'], placeId=row['place_id'], revealed=bool(row['revealed']),
                  updated=row['updated'])
    if gm:
        result['secret'] = row['secret']
    return result


def projection(db, campaign, gm):
    cid = campaign['id']
    state = db.execute('SELECT revision,updated FROM crew_atlas_state WHERE campaign_id=?', (cid,)).fetchone()
    # A player's query never selects private notes, even on revealed markers.
    columns = PUBLIC_COLUMNS + (',secret' if gm else '')
    rows = db.execute('SELECT ' + columns + ' FROM crew_atlas_markers WHERE campaign_id=?'
                      + ('' if gm else ' AND revealed=1') + ' ORDER BY updated DESC,id', (cid,))
    revision = state['revision'] if state else 0
    return dict(id=cid, name=campaign['name'], role='gm' if gm else 'player', canManage=gm,
                revision=revision, version=revision, campaignVersion=campaign['version'],
                updated=state['updated'] if state else 0,
                markers=[marker_dto(row, gm) for row in rows])


def capture(db, campaign_id):
    """Private portable extension; the caller must authorize GM-only export.

    Timestamps, live revision, credentials and idempotency receipts are not
    portable content. UUIDs are campaign-scoped so imports can preserve links.
    """
    rows = db.execute('SELECT ' + PUBLIC_COLUMNS + ',secret FROM crew_atlas_markers'
                      ' WHERE campaign_id=? ORDER BY id', (campaign_id,))
    return dict(schemaVersion=1, markers=[
        {key: value for key, value in marker_dto(row, True).items() if key != 'updated'}
        for row in rows])


def validate_archive(raw):
    """Validate a present extension; callers leave an old absent key untouched."""
    exact(raw, ('schemaVersion', 'markers'))
    if type(raw['schemaVersion']) is not int or raw['schemaVersion'] != 1:
        fail('Неизвестная версия карты в архиве.')
    if not isinstance(raw['markers'], list) or len(raw['markers']) > MAX_MARKERS:
        fail('Слишком много меток в архиве.')
    seen, markers = set(), []
    for item in raw['markers']:
        exact(item, ('id', 'name', 'description', 'secret', 'x', 'y', 'map',
                     'kind', 'color', 'placeId', 'revealed'))
        try:
            identifier = marker_uuid(item['id'])
        except AtlasError:
            fail('Повреждён идентификатор метки в архиве.')
        if identifier in seen:
            fail('В архиве повторяется идентификатор метки.')
        seen.add(identifier)
        marker = dict(id=identifier, **validate_marker({k: v for k, v in item.items() if k != 'id'}))
        if marker != item:
            fail('Проверь формат метки в архиве.')
        markers.append(marker)
    result = dict(schemaVersion=1, markers=markers)
    if len(encoded(result).encode('utf-8')) > MAX_ATLAS_BYTES:
        fail('Карта кампании превышает 1 МБ.')
    return result


def restore_archive(db, campaign_id, validated):
    """Replace inside caller's authorized transfer transaction; never commit.

    Advance the local revision to invalidate old-device mutations. No receipt
    or imported revision is trusted. Existing SQLite backups cover all tables.
    """
    if not db.in_transaction:
        raise RuntimeError('Atlas restore requires the outer transfer transaction')
    validated = validate_archive(validated)
    row = db.execute('SELECT revision FROM crew_atlas_state WHERE campaign_id=?', (campaign_id,)).fetchone()
    revision = row['revision'] if row else 0
    if revision >= MAX_REVISION:
        fail('Достигнут предел версий карты.', 409)
    now = int(time.time() * 1000)
    db.execute('DELETE FROM crew_atlas_markers WHERE campaign_id=?', (campaign_id,))
    db.execute('DELETE FROM crew_atlas_commands WHERE campaign_id=?', (campaign_id,))
    for marker in validated['markers']:
        db.execute('''INSERT INTO crew_atlas_markers
            (name,description,secret,kind,color,x,y,map,place_id,revealed,updated,id,campaign_id)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',
            (marker['name'], marker['description'], marker['secret'], marker['kind'],
             marker['color'], marker['x'], marker['y'], marker['map'], marker['placeId'],
             int(marker['revealed']), now, marker['id'], campaign_id))
    db.execute('''INSERT INTO crew_atlas_state VALUES(?,?,?)
        ON CONFLICT(campaign_id) DO UPDATE SET revision=excluded.revision,updated=excluded.updated''',
        (campaign_id, revision + 1, now))


def api(handler, db, user, campaign_id, method, payload=None, marker_id=None,
        markers=False, player_view=False):
    """Return an Atlas response. Host maps AtlasError to HTTP and closes db.

    GET /atlas and GET /atlas/markers return the same filtered state. Mutations:
    POST /atlas/markers, PUT /atlas/markers/:uuid, DELETE /atlas/markers/:uuid.
    Body is {id: commandId, expectedVersion: revision, marker: fullMarker};
    DELETE omits marker. The response receipt identifies the affected marker.
    A retry returns current authorized state and the original minimal receipt.
    """
    if (method not in ('GET', 'POST', 'PUT', 'DELETE')
            or (method == 'GET' and marker_id is not None)
            or (method == 'POST' and (not markers or marker_id is not None))
            or (method in ('PUT', 'DELETE') and (not markers or marker_id is None))):
        fail('Команда карты не поддерживается.', 405)
    mutation = method != 'GET'
    db.execute('BEGIN IMMEDIATE' if mutation else 'BEGIN')
    campaign, actual_gm = role_context(handler, db, user, campaign_id)
    gm = actual_gm and not player_view
    if not mutation:
        return projection(db, campaign, gm)
    if not gm:
        fail('Только ведущий этой кампании может менять карту.', 403)
    exact(payload, ('id', 'expectedVersion') if method == 'DELETE'
          else ('id', 'expectedVersion', 'marker'))
    command_id = text(payload['id'], 100, 'ID команды', True)
    expected = integer(payload['expectedVersion'], MAX_REVISION, 'версию карты')
    if marker_id is not None:
        marker_id = marker_uuid(marker_id)
    marker = validate_marker(payload['marker']) if method != 'DELETE' else None
    # Include route and actor binding: an ID cannot be reused for another target,
    # method, campaign or actor. expectedVersion is excluded, like shared battle.
    request_hash = hashlib.sha256(encoded(dict(method=method, markerId=marker_id,
        payload={k: v for k, v in payload.items() if k != 'expectedVersion'})).encode()).hexdigest()
    prior = db.execute('SELECT * FROM crew_atlas_commands WHERE campaign_id=? AND command_id=?',
                       (campaign_id, command_id)).fetchone()
    if prior:
        if prior['user_id'] != user['id'] or prior['request_hash'] != request_hash:
            fail('Этот ID команды уже использован с другими данными.', 409)
        receipt = json.loads(prior['result'])
        out = projection(db, campaign, gm)
        out.update(duplicate=True, receipt=receipt, markerId=receipt['markerId'])
        return out
    state = db.execute('SELECT revision FROM crew_atlas_state WHERE campaign_id=?', (campaign_id,)).fetchone()
    revision = state['revision'] if state else 0
    if expected != revision:
        fail('Карта изменилась. Обнови её и повтори действие.', 409)
    if revision >= MAX_REVISION:
        fail('Достигнут предел версий карты.', 409)
    if method != 'POST' and not db.execute(
            'SELECT 1 FROM crew_atlas_markers WHERE id=? AND campaign_id=?',
            (marker_id, campaign_id)).fetchone():
        fail('Метка не найдена.', 404)
    now = int(time.time() * 1000)
    if method == 'DELETE':
        db.execute('DELETE FROM crew_atlas_markers WHERE id=? AND campaign_id=?', (marker_id, campaign_id))
    else:
        portable = capture(db, campaign_id)
        portable['markers'] = [m for m in portable['markers'] if m['id'] != marker_id]
        portable['markers'].append(dict(id=marker_id or str(uuid.uuid4()), **marker))
        if len(encoded(portable).encode('utf-8')) > MAX_ATLAS_BYTES:
            fail('Карта кампании превышает 1 МБ.', 409)
        if method == 'POST':
            count = db.execute('SELECT COUNT(*) FROM crew_atlas_markers WHERE campaign_id=?', (campaign_id,)).fetchone()[0]
            if count >= MAX_MARKERS:
                fail('Достигнут предел меток кампании.', 409)
            marker_id = str(uuid.uuid4())
        values = (marker['name'], marker['description'], marker['secret'], marker['kind'],
                  marker['color'], marker['x'], marker['y'], marker['map'], marker['placeId'],
                  int(marker['revealed']), now, marker_id, campaign_id)
        if method == 'POST':
            db.execute('''INSERT INTO crew_atlas_markers
                (name,description,secret,kind,color,x,y,map,place_id,revealed,updated,id,campaign_id)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''', values)
        else:
            db.execute('''UPDATE crew_atlas_markers SET name=?,description=?,secret=?,kind=?,color=?,
                x=?,y=?,map=?,place_id=?,revealed=?,updated=? WHERE id=? AND campaign_id=?''', values)
    if state:
        changed = db.execute('''UPDATE crew_atlas_state SET revision=revision+1,updated=?
            WHERE campaign_id=? AND revision=?''', (now, campaign_id, revision))
        if changed.rowcount != 1:
            fail('Карта изменилась одновременно с командой.', 409)
    else:
        db.execute('INSERT INTO crew_atlas_state VALUES(?,?,?)', (campaign_id, 1, now))
    receipt = dict(commandId=command_id, type={'POST': 'create', 'PUT': 'update', 'DELETE': 'delete'}[method],
                   markerId=marker_id, version=revision + 1)
    db.execute('INSERT INTO crew_atlas_commands VALUES(?,?,?,?,?,?)',
               (campaign_id, command_id, user['id'], request_hash, encoded(receipt), now))
    handler.bump_campaign(db, campaign_id)
    campaign = db.execute('SELECT * FROM campaigns WHERE id=?', (campaign_id,)).fetchone()
    out = projection(db, campaign, gm)
    out.update(duplicate=False, receipt=receipt, markerId=marker_id)
    db.commit()
    return out
