#!/usr/bin/env python3
"""Small-group, self-hosted character tracker. Python 3.11+; no dependencies."""
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import shared_battle
import crew_atlas
import time
import uuid
from decimal import Decimal
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit, parse_qs

ROOT = Path(__file__).resolve().parent
DATA = Path(os.getenv('DATA_DIR', str(ROOT / 'data')))
DB = DATA / 'tracker.sqlite3'
ORIGIN = os.getenv('PUBLIC_ORIGIN', '').rstrip('/')
SECURE = ORIGIN.startswith('https://')
COOKIE = 'nightcity_session'
STATS = ['INT', 'REF', 'TECH', 'COOL', 'ATTR', 'LUCK', 'MA', 'BODY', 'EMP']
ZONES = ['head', 'torso', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']
ITEM_SLOTS = ['head', 'eyes', 'inner', 'outer', 'legs', 'feet', 'hands',
              'accessory', 'body', 'mainHand', 'offHand', 'implant', 'bag']
ITEM_ICONS = ['shirt', 'jacket', 'helmet', 'glasses', 'pants', 'boots', 'gloves',
              'armor', 'weapon', 'cyber', 'ammo', 'gear', 'radio', 'medical', 'pistol', 'deck', 'trauma',
              'revolver', 'smg', 'rifle', 'shotgun', 'sniper', 'heavyweapon', 'knife', 'katana',
              'baton', 'grenade', 'cybereye', 'cyberarm', 'cyberleg', 'tools', 'chip']
SESSION_SECONDS = 7 * 86400
DEFAULT_PLAYER_SETTINGS = {'hints': True, 'tutorial': True, 'animations': True, 'ambient': 'quiet'}
APP_VERSION = '0.17.7'
API_VERSION = 1

# The frontend build copies public files into static/. Keep supplementary styles and
# scripts public by type, rather than maintaining a second list of HTML dependencies.
# JSON and arbitrary directories remain private except declared public catalogs and Atlas cartography.
PUBLIC_ROOT_TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json',
}
PUBLIC_ASSET_TYPES = {
    'art': {'.webp': 'image/webp', '.png': 'image/png'},
    'icons': {'.png': 'image/png'},
    'fonts': {'.woff2': 'font/woff2', '.woff': 'font/woff', '.otf': 'font/otf',
              '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8'},
    'style-textures': {'.png': 'image/png', '.webp': 'image/webp'},
    'catalog': {},
    # Build output only: canonical maps, reference catalog and same-origin editor.
    # Campaign notes are authenticated API data and are never stored in static/.
    'atlas': {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
              '.css': 'text/css; charset=utf-8', '.json': 'application/json',
              '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg',
              '.png': 'image/png', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8'},
}
PUBLIC_JSON_ASSETS = {'catalog/equipment-v1.json', 'art/paperdoll-v2/manifest.json'}


def backup_database(destination=None, reason='manual'):
    """Snapshot the live WAL database using SQLite's consistent backup API."""
    if not DB.is_file():
        raise APIError(404, 'База данных ещё не создана.')
    backup_dir = DATA / 'backups'
    backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = Path(destination) if destination else backup_dir / (
        f'{reason}-{time.strftime("%Y%m%d-%H%M%S")}-{secrets.token_hex(3)}.sqlite3')
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if target.resolve() == DB.resolve() or target.exists():
        raise APIError(400, 'Выбери новый файл для резервной копии.')
    temporary = target.with_name(target.name + '.tmp-' + secrets.token_hex(4))
    try:
        fd=os.open(temporary,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        os.close(fd)
        with sqlite3.connect(DB, timeout=10) as source, sqlite3.connect(temporary) as copy:
            source.backup(copy)
            if copy.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise sqlite3.DatabaseError('Backup integrity check failed')
        os.chmod(temporary, 0o600)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    if destination is None:
        backups = sorted(backup_dir.glob(f'{reason}-*.sqlite3'), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in backups[7:]:
            old.unlink()
    return target


def empty_workspace():
    return {'schemaVersion': 1, 'contacts': [], 'messages': [], 'places': [], 'assets': [],
            'scene': {'id': str(uuid.uuid4()), 'name': 'Новая сцена', 'active': False,
                      'targets': [], 'actions': [], 'log': []}}


def canonical(value):
    """Sorted-key JSON with ECMAScript-compatible finite number spelling."""
    if value is None or isinstance(value, (str, bool)):
        return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not (-float('inf') < value < float('inf')):
            raise APIError(400, 'Архив содержит некорректное число.')
        if value == 0:
            return '0'
        if value.is_integer() and abs(value) < 1e21:
            return str(int(value))
        spelling = repr(value)
        if 1e-6 <= abs(value) < 1e21:
            return format(Decimal(spelling), 'f').rstrip('0').rstrip('.') if '.' in format(Decimal(spelling), 'f') else format(Decimal(spelling), 'f')
        return re.sub(r'e([+-]?)0+(\d+)', r'e\1\2', spelling)
    if isinstance(value, list):
        return '[' + ','.join(canonical(x) for x in value) + ']'
    if isinstance(value, dict):
        return '{' + ','.join(canonical(k) + ':' + canonical(value[k]) for k in sorted(value)) + '}'
    raise APIError(400, 'Некорректные данные архива.')


def content_fingerprint(content):
    return hashlib.sha256(canonical(content).encode()).hexdigest()


def stable_uuid(value):
    value=entity_id(value)
    if not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',value,re.I):
        raise APIError(400, 'Повреждён постоянный идентификатор архива.')
    return value


def convert_workspace(raw, convert):
    if not isinstance(raw,dict):
        raise APIError(400,'Повреждён терминал в архиве.')
    for key in ['contacts','messages','places','assets']:
        if not isinstance(raw.get(key),list) or any(not isinstance(v,dict) for v in raw[key]):
            raise APIError(400,'Повреждены записи терминала в архиве.')
    if not isinstance(raw.get('scene'),dict) or not isinstance(raw['scene'].get('actions'),list) or any(not isinstance(v,dict) for v in raw['scene']['actions']):
        raise APIError(400,'Повреждена сцена в архиве.')
    for key,fields in [('contacts',['recipients']),('messages',['characterId']),('places',['recipients']),
                       ('assets',['ownerCharacterId','access'])]:
        if any(any(field not in v for field in fields) for v in raw[key]):
            raise APIError(400,'В терминале отсутствуют ссылки на персонажей.')
    if any('characterId' not in v for v in raw['scene']['actions']):
        raise APIError(400,'В действии отсутствует персонаж.')
    result = json.loads(json.dumps(raw, ensure_ascii=False))
    for contact in result.get('contacts', []):
        contact['recipients'] = [convert(cid) for cid in contact['recipients']]
    for message in result.get('messages', []):
        message['characterId'] = convert(message['characterId'])
    for place in result.get('places', []):
        place['recipients'] = [convert(cid) for cid in place['recipients']]
    for asset in result.get('assets', []):
        if asset['ownerCharacterId'] is not None:
            asset['ownerCharacterId'] = convert(asset['ownerCharacterId'])
        asset['access'] = [convert(cid) for cid in asset['access']]
    for action in result.get('scene', {}).get('actions', []):
        action['characterId'] = convert(action['characterId'])
    board = result['scene'].get('board')
    if board is not None:
        if not isinstance(board,dict) or not isinstance(board.get('pieces'),list):
            raise APIError(400,'Повреждено поле боя в архиве.')
        for piece in board['pieces']:
            if not isinstance(piece,dict) or 'characterId' not in piece:
                raise APIError(400,'Повреждена пешка поля боя в архиве.')
            if piece['characterId'] is not None:
                piece['characterId'] = convert(piece['characterId'])
    return result


def validate_archive(raw):
    if not isinstance(raw, dict) or len(json.dumps(raw, ensure_ascii=False,separators=(',',':')).encode()) > 3145728:
        raise APIError(400, 'Архив повреждён или превышает 3 МБ.')
    exact_payload(raw, ['format','formatVersion','apiVersion','campaignUuid','exportedAt','fingerprint','ancestors','content'])
    if raw['format'] != 'night-city-campaign' or type(raw['formatVersion']) is not int or raw['formatVersion'] != 1 or type(raw['apiVersion']) is not int or raw['apiVersion'] != API_VERSION:
        raise APIError(400, 'Эта версия приложения не поддерживает формат архива.')
    stable_uuid(raw['campaignUuid'])
    number(raw['exportedAt'], 'Дата экспорта', 0, 10**12)
    if not isinstance(raw['fingerprint'], str) or not re.fullmatch('[a-f0-9]{64}', raw['fingerprint']):
        raise APIError(400, 'Повреждена контрольная сумма архива.')
    ancestors = raw['ancestors']
    if not isinstance(ancestors,list) or len(ancestors)>128 or any(not isinstance(a,str) or not re.fullmatch('[a-f0-9]{64}',a) for a in ancestors) or len(set(ancestors)) != len(ancestors):
        raise APIError(400, 'Повреждена история переносов.')
    content = raw['content']
    if not isinstance(content,dict):
        raise APIError(400, 'Повреждено содержимое архива.')
    exact_payload(content,['campaign','owners','members','characters','workspace'] + (['atlas'] if 'atlas' in content else []))
    if 'atlas' in content:
        crew_atlas.validate_archive(content['atlas'])
    campaign = content['campaign']
    if not isinstance(campaign,dict):
        raise APIError(400, 'Проверь кампанию в архиве.')
    exact_payload(campaign,['name','description','gm_notes','ledger','gmOwnerKey'])
    for key,limit in [('name',100),('description',3000),('gm_notes',24000),('ledger',16000)]:
        text(campaign[key],key,limit,key=='name')
    stable_uuid(campaign['gmOwnerKey'])
    owners = content['owners']
    if not isinstance(owners,list) or len(owners)>100:
        raise APIError(400, 'Слишком много владельцев в архиве.')
    for owner in owners:
        if not isinstance(owner,dict):
            raise APIError(400, 'Проверь владельца в архиве.')
        exact_payload(owner,['key','label'])
        stable_uuid(owner['key']); text(owner['label'],'Имя владельца',100,True)
    owner_keys={o['key'] for o in owners}
    if len(owner_keys)!=len(owners) or campaign['gmOwnerKey'] not in owner_keys:
        raise APIError(400, 'Архив ссылается на неизвестного владельца.')
    members=content['members']
    if not isinstance(members,list) or len(members)>100 or not all(isinstance(m,str) for m in members) or len(set(members))!=len(members) or not set(members)<=owner_keys:
        raise APIError(400, 'Повреждён состав участников.')
    sheets=content['characters']
    if not isinstance(sheets,list) or len(sheets)>30:
        raise APIError(400, 'В переносимой кампании может быть до 30 листов.')
    count, seen=0,set()
    for sheet in sheets:
        if not isinstance(sheet,dict):
            raise APIError(400, 'Повреждён лист в архиве.')
        exact_payload(sheet,['uuid','ownerKey','status','data','revisions'])
        stable_uuid(sheet['uuid']); stable_uuid(sheet['ownerKey'])
        if sheet['uuid'] in seen or sheet['ownerKey'] not in owner_keys or sheet['status'] not in ['pending','active','reserve']:
            raise APIError(400, 'Повреждены идентификаторы или статус листа.')
        seen.add(sheet['uuid'])
        if canonical(validate_character(sheet['data'])) != canonical(sheet['data']):
            raise APIError(400, 'Обнови формат листа и экспортируй кампанию актуальной версией.')
        if not isinstance(sheet['revisions'],list):
            raise APIError(400, 'Повреждена история листа.')
        count += len(sheet['revisions'])
        if count>300:
            raise APIError(400, 'В архиве слишком много ревизий; история не будет обрезана.')
        for revision in sheet['revisions']:
            if not isinstance(revision,dict):
                raise APIError(400, 'Повреждена ревизия.')
            exact_payload(revision,['version','reason','created','actorKey','actorLabel','data'])
            number(revision['version'],'Версия листа',1,10**9); number(revision['created'],'Дата ревизии',0,10**12)
            text(revision['reason'],'Причина',300,True); text(revision['actorLabel'],'Автор',100,True)
            stable_uuid(revision['actorKey'])
            if revision['actorKey'] not in owner_keys or canonical(validate_character(revision['data'])) != canonical(revision['data']):
                raise APIError(400, 'Повреждён автор или формат ревизии.')
    ids={s['uuid']:index+1 for index,s in enumerate(sheets)}
    def resolve(ref):
        if not isinstance(ref,str) or ref not in ids:
            raise APIError(400, 'Терминал ссылается на лист, отсутствующий в архиве.')
        return ids[ref]
    normalized=convert_workspace(content['workspace'],resolve)
    checked=validate_workspace(normalized,set(ids.values()),{ids[s['uuid']] for s in sheets if s['status'] in ['active','reserve']})
    back=convert_workspace(checked,lambda ref:sheets[ref-1]['uuid'])
    if canonical(back)!=canonical(content['workspace']):
        raise APIError(400, 'Терминал в архиве требует обновления формата.')
    if content_fingerprint(content)!=raw['fingerprint']:
        raise APIError(400, 'Архив повреждён: контрольная сумма не совпала.')
    return raw


def entity_id(value, label='ID'):
    value = text(value, label, 80, True)
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', value):
        raise APIError(400, 'Некорректный идентификатор записи.')
    return value


def id_list(value, allowed=None):
    if not isinstance(value, list) or len(value) > 30:
        raise APIError(400, 'Проверь список персонажей.')
    result = [number(x, 'Персонаж', 1, 10**9) for x in value]
    if len(set(result)) != len(result) or (allowed is not None and not set(result) <= set(allowed)):
        raise APIError(400, 'Выбери принятых персонажей этой кампании.')
    return result


def workspace_contact(raw, approved=None):
    if not isinstance(raw, dict):
        raise APIError(400, 'Проверь контакт.')
    return {'id': entity_id(raw.get('id')), 'name': text(raw.get('name'), 'Имя контакта', 100, True),
            'phone': text(raw.get('phone', ''), 'Номер', 80),
            'description': text(raw.get('description', ''), 'Описание контакта', 3000),
            'notes': text(raw.get('notes', ''), 'Заметки ведущего', 6000),
            'recipients': id_list(raw.get('recipients', []), approved)}


def workspace_place(raw, approved=None):
    if not isinstance(raw, dict):
        raise APIError(400, 'Проверь место.')
    return {'id': entity_id(raw.get('id')), 'name': text(raw.get('name'), 'Название места', 100, True),
            'address': text(raw.get('address', ''), 'Адрес', 200),
            'description': text(raw.get('description', ''), 'Описание места', 3000),
            'x': number(raw.get('x', 50), 'Координата X', 0, 100, False),
            'y': number(raw.get('y', 50), 'Координата Y', 0, 100, False),
            'recipients': id_list(raw.get('recipients', []), approved)}


def workspace_asset(raw, approved=None):
    if not isinstance(raw, dict) or raw.get('kind') not in ['vehicle', 'property']:
        raise APIError(400, 'Проверь имущество.')
    owner = raw.get('ownerCharacterId')
    if owner is not None:
        owner = number(owner, 'Владелец', 1, 10**9)
        if approved is not None and owner not in approved:
            raise APIError(400, 'Владелец должен участвовать в кампании.')
    return {'id': entity_id(raw.get('id')), 'kind': raw['kind'],
            'name': text(raw.get('name'), 'Название имущества', 100, True), 'ownerCharacterId': owner,
            'access': id_list(raw.get('access', []), approved),
            'location': text(raw.get('location', ''), 'Расположение', 200),
            'condition': text(raw.get('condition', ''), 'Состояние', 1000),
            'cost': number(raw.get('cost', 0), 'Стоимость', 0, 10**12, False),
            'upkeep': number(raw.get('upkeep', 0), 'Расходы', 0, 10**12, False),
            'notes': text(raw.get('notes', ''), 'Описание имущества', 3000),
            'contents': text(raw.get('contents', ''), 'Содержимое', 6000)}


def workspace_targets(raw):
    if not isinstance(raw, list) or len(raw) > 40:
        raise APIError(400, 'В сцене может быть до 40 целей.')
    result = []
    for target in raw:
        if not isinstance(target, dict) or target.get('kind') not in ['person', 'device', 'program'] or type(target.get('visible')) is not bool:
            raise APIError(400, 'Проверь цель сцены.')
        result.append({'id': entity_id(target.get('id')), 'name': text(target.get('name'), 'Название цели', 100, True),
            'kind': target['kind'], 'description': text(target.get('description', ''), 'Описание цели', 2000),
            'visible': target['visible']})
    if len({t['id'] for t in result}) != len(result):
        raise APIError(400, 'ID целей должны различаться.')
    return result


def optional_roll(value, label, maximum=10000):
    return None if value is None else number(value, label, 0, maximum)


BATTLE_ANCHOR = {'id':'battle-floor','name':'Поле боя','kind':'device',
                 'description':'Перемещение по полю','visible':True}


def battle_position(board, x, y):
    return (number(x,'Клетка X',0,board['width']-1), number(y,'Клетка Y',0,board['height']-1))


def battle_blocked(board, x, y):
    return board['tiles'][y*board['width']+x] in ['wall','door']


def battle_destination(board, piece, x, y, accepted=None):
    x,y=battle_position(board,x,y)
    if piece['kind']=='character' and accepted is not None and piece['characterId'] not in accepted:
        raise APIError(409,'Персонаж больше не участвует в кампании. Исправь состав поля боя.')
    if battle_blocked(board,x,y):
        raise APIError(409,'Эта клетка закрыта стеной или дверью.')
    if piece['kind']!='loot' and any(p['id']!=piece['id'] and p['kind']!='loot' and p['x']==x and p['y']==y for p in board['pieces']):
        raise APIError(409,'Эта клетка занята другой пешкой.')
    return x,y


def validate_battle_board(raw, targets, accepted=None):
    if not isinstance(raw,dict):
        raise APIError(400,'Проверь поле боя.')
    exact_payload(raw,['schemaVersion','width','height','cellMeters','vision','tiles','pieces','turnPieceId'])
    if type(raw['schemaVersion']) is not int or raw['schemaVersion']!=1:
        raise APIError(400,'Неизвестный формат поля боя.')
    board={'schemaVersion':1,'width':number(raw['width'],'Ширина поля',6,24),
           'height':number(raw['height'],'Высота поля',6,24),
           'cellMeters':number(raw['cellMeters'],'Метров в клетке',.5,10,False),
           'vision':number(raw['vision'],'Дальность обзора',1,24),'tiles':[],'pieces':[],'turnPieceId':None}
    if not isinstance(raw['tiles'],list) or len(raw['tiles'])!=board['width']*board['height'] or any(t not in ['floor','wall','door','cover'] for t in raw['tiles']):
        raise APIError(400,'Проверь клетки поля боя.')
    board['tiles']=list(raw['tiles'])
    if not isinstance(raw['pieces'],list) or len(raw['pieces'])>60:
        raise APIError(400,'На поле может быть до 60 пешек.')
    target_ids={t['id'] for t in targets}
    seen_ids,seen_chars,seen_targets,occupied=set(),set(),set(),set()
    for raw_piece in raw['pieces']:
        if not isinstance(raw_piece,dict):
            raise APIError(400,'Проверь пешку поля боя.')
        exact_payload(raw_piece,['id','kind','x','y','characterId','targetId','name','description','hidden','initiative'])
        if raw_piece['kind'] not in ['character','target','loot','vehicle'] or type(raw_piece['hidden']) is not bool:
            raise APIError(400,'Проверь вид и видимость пешки.')
        x,y=battle_position(board,raw_piece['x'],raw_piece['y'])
        piece={'id':entity_id(raw_piece['id']),'kind':raw_piece['kind'],'x':x,'y':y,
               'characterId':None,'targetId':None,'name':text(raw_piece['name'],'Название пешки',100,True),
               'description':text(raw_piece['description'],'Описание пешки',1500),
               'hidden':raw_piece['hidden'],'initiative':None}
        if raw_piece['initiative'] is not None:
            piece['initiative']=number(raw_piece['initiative'],'Инициатива',-9007199254740991,9007199254740991)
        if piece['id'] in seen_ids:
            raise APIError(400,'ID пешек должны различаться.')
        seen_ids.add(piece['id'])
        if piece['kind']=='character':
            cid=number(raw_piece['characterId'],'Персонаж пешки',1,10**9)
            if raw_piece['targetId'] is not None or cid in seen_chars or (accepted is not None and cid not in accepted):
                raise APIError(400,'Пешка должна ссылаться на одного принятого персонажа этой кампании.')
            piece['characterId']=cid; seen_chars.add(cid)
        elif raw_piece['characterId'] is not None:
            raise APIError(400,'Только пешка персонажа может ссылаться на лист.')
        if piece['kind']=='target':
            tid=entity_id(raw_piece['targetId'])
            if tid not in target_ids or tid in seen_targets:
                raise APIError(400,'Пешка должна ссылаться на одну существующую цель сцены.')
            piece['targetId']=tid; seen_targets.add(tid)
        elif raw_piece['targetId'] is not None:
            raise APIError(400,'Только пешка цели может ссылаться на цель сцены.')
        if piece['kind']!='loot':
            if battle_blocked(board,x,y) or (x,y) in occupied:
                raise APIError(400,'Пешки не могут стоять в стене, закрытой двери или на одной клетке.')
            occupied.add((x,y))
        board['pieces'].append(piece)
    if raw['turnPieceId'] is not None:
        board['turnPieceId']=entity_id(raw['turnPieceId'])
        if board['turnPieceId'] not in seen_ids:
            raise APIError(400,'Выбери существующую пешку для текущего хода.')
    return board


def battle_line_visible(board, from_x, from_y, to_x, to_y):
    """Ray between cell centres; walls are visible, but block everything behind them."""
    if from_x==to_x and from_y==to_y:
        return True
    dx,dy=to_x-from_x,to_y-from_y
    step_x,step_y=(1 if dx>0 else -1),(1 if dy>0 else -1)
    delta_x=1/abs(dx) if dx else float('inf')
    delta_y=1/abs(dy) if dy else float('inf')
    next_x,next_y=delta_x/2,delta_y/2
    x,y=from_x,from_y
    while x!=to_x or y!=to_y:
        if abs(next_x-next_y)<1e-10:
            if battle_blocked(board,x+step_x,y) and battle_blocked(board,x,y+step_y):
                return False
            x+=step_x; y+=step_y; next_x+=delta_x; next_y+=delta_y
        elif next_x<next_y:
            x+=step_x; next_x+=delta_x
        else:
            y+=step_y; next_y+=delta_y
        if x==to_x and y==to_y:
            return True
        if battle_blocked(board,x,y):
            return False
    return True


def battle_visible_cells(board, pawn):
    result=[]
    radius=board['vision']
    for y in range(max(0,pawn['y']-radius),min(board['height'],pawn['y']+radius+1)):
        for x in range(max(0,pawn['x']-radius),min(board['width'],pawn['x']+radius+1)):
            if (x-pawn['x'])**2+(y-pawn['y'])**2<=radius**2 and battle_line_visible(board,pawn['x'],pawn['y'],x,y):
                result.append(y*board['width']+x)
    return result


def battle_actor_pawn(board, cid):
    return next((p for p in board['pieces'] if p['kind']=='character' and p['characterId']==cid),None)


def battle_target_visible(scene, cid, target_id, accepted):
    target=next((t for t in scene['targets'] if t['id']==target_id and t['visible']),None)
    if target is None or cid not in accepted:
        return False
    board=scene.get('board')
    if board is None:
        return True
    pawn=battle_actor_pawn(board,cid)
    if target_id=='battle-floor':
        return pawn is not None
    target_piece=next((p for p in board['pieces'] if p['kind']=='target' and p['targetId']==target_id),None)
    if target_piece is None:
        return True
    return pawn is not None and not target_piece['hidden'] and target_piece['y']*board['width']+target_piece['x'] in battle_visible_cells(board,pawn)


def project_battle_board(board, own, accepted, visible_target_ids):
    views=[{'characterId':p['characterId'],'visible':battle_visible_cells(board,p)} for p in board['pieces']
           if p['kind']=='character' and p['characterId'] in own and p['characterId'] in accepted]
    visible=set(i for view in views for i in view['visible'])
    pieces=[]
    for piece in board['pieces']:
        if piece['kind']=='character' and piece['characterId'] not in accepted:
            continue
        is_own=piece['kind']=='character' and piece['characterId'] in own
        if not is_own and (piece['hidden'] or piece['y']*board['width']+piece['x'] not in visible):
            continue
        if piece['kind']=='target' and piece['targetId'] not in visible_target_ids:
            continue
        pieces.append(dict(piece))
    return dict(board,tiles=[tile if i in visible else 'unknown' for i,tile in enumerate(board['tiles'])],
                pieces=pieces,turnPieceId=board['turnPieceId'] if any(p['id']==board['turnPieceId'] for p in pieces) else None,views=views)


def validate_battle_movement(raw, board=None):
    if not isinstance(raw,dict):
        raise APIError(400,'Проверь перемещение.')
    exact_payload(raw,['fromX','fromY','x','y'])
    maximum_x=board['width']-1 if board is not None else 23
    maximum_y=board['height']-1 if board is not None else 23
    result={key:number(raw[key],'Координаты перемещения',0,maximum_x if key in ['fromX','x'] else maximum_y)
            for key in ['fromX','fromY','x','y']}
    return result


def battle_apply_movement(scene, action, accepted, undo=False):
    board=scene.get('board')
    pawn=battle_actor_pawn(board,action['characterId']) if board is not None else None
    movement=action['movement']
    from_x,from_y=(movement['x'],movement['y']) if undo else (movement['fromX'],movement['fromY'])
    to_x,to_y=(movement['fromX'],movement['fromY']) if undo else (movement['x'],movement['y'])
    if pawn is None or pawn['characterId'] not in accepted or pawn['x']!=from_x or pawn['y']!=from_y:
        raise APIError(409,'Положение персонажа уже изменилось. Проверь поле перед подтверждением или отменой перемещения.')
    x,y=battle_destination(board,pawn,to_x,to_y,accepted)
    pawn.update(x=x,y=y)


def battle_preserve_history(scene, targets):
    ids={t['id'] for t in targets}
    required={a['targetId'] for a in scene['actions']}|{e['targetId'] for e in scene['log'] if 'targetId' in e}
    if scene.get('board') is not None:
        required|={p['targetId'] for p in scene['board']['pieces'] if p['kind']=='target'}|{'battle-floor'}
    if not required<=ids:
        raise APIError(400,'Сохрани цели, на которые ссылаются поле и история действий; их можно скрыть.')


def validate_workspace(raw, linked=None, accepted=None):
    """Validate whole trusted-GM transfer snapshots; API mutations use narrow commands."""
    if not isinstance(raw, dict) or type(raw.get('schemaVersion')) is not int or raw.get('schemaVersion') != 1:
        raise APIError(400, 'Неизвестный формат терминала кампании.')
    result = {'schemaVersion': 1}
    limits = {'contacts': 100, 'messages': 1000, 'places': 100, 'assets': 100}
    for key, limit in limits.items():
        if not isinstance(raw.get(key), list) or len(raw[key]) > limit:
            raise APIError(400, 'Слишком много записей терминала.')
    result['contacts'] = [workspace_contact(c, linked) for c in raw['contacts']]
    result['places'] = [workspace_place(p, linked) for p in raw['places']]
    result['assets'] = [workspace_asset(a, linked) for a in raw['assets']]
    contacts = {c['id'] for c in result['contacts']}
    result['messages'] = []
    for m in raw['messages']:
        if not isinstance(m, dict) or m.get('sender') not in ['npc', 'character']:
            raise APIError(400, 'Проверь переписку.')
        contact = entity_id(m.get('contactId'))
        cid = number(m.get('characterId'), 'Персонаж', 1, 10**9)
        if contact not in contacts or (linked is not None and cid not in linked):
            raise APIError(400, 'Переписка ссылается на отсутствующую запись.')
        result['messages'].append({'id': entity_id(m.get('id')), 'contactId': contact,
            'characterId': cid, 'sender': m['sender'], 'body': text(m.get('body'), 'Сообщение', 3000, True),
            'created': number(m.get('created'), 'Время', 0, 10**12)})
    scene = raw.get('scene')
    if not isinstance(scene, dict) or type(scene.get('active')) is not bool:
        raise APIError(400, 'Проверь сцену.')
    result['scene'] = {'id': entity_id(scene.get('id')), 'name': text(scene.get('name', ''), 'Название сцены', 100, True),
                       'active': scene['active'], 'targets': workspace_targets(scene.get('targets'))}
    if 'board' in scene:
        result['scene']['board']=validate_battle_board(scene['board'],result['scene']['targets'],accepted if accepted is not None else linked)
    if not isinstance(scene.get('actions'), list) or len(scene['actions']) > 200 or not isinstance(scene.get('log'), list) or len(scene['log']) > 300:
        raise APIError(400, 'Слишком много действий в сцене.')
    target_ids = {t['id'] for t in result['scene']['targets']}
    result['scene']['actions'] = []
    for a in scene['actions']:
        if not isinstance(a, dict) or a.get('kind') not in ['attack', 'program', 'other'] or a.get('status') not in ['submitted', 'approved', 'resolved', 'rejected']:
            raise APIError(400, 'Проверь действие.')
        cid = number(a.get('characterId'), 'Персонаж', 1, 10**9)
        target = entity_id(a.get('targetId'))
        if target not in target_ids or (linked is not None and cid not in linked):
            raise APIError(400, 'Действие ссылается на отсутствующую запись.')
        action={'id': entity_id(a.get('id')), 'characterId': cid, 'targetId': target,
            'kind': a['kind'], 'description': text(a.get('description'), 'Действие', 2000, True),
            'tool': text(a.get('tool', ''), 'Оружие или программа', 200), 'roll': optional_roll(a.get('roll'), 'Бросок'),
            'damage': optional_roll(a.get('damage'), 'Урон'), 'status': a['status'],
            'result': text(a.get('result', ''), 'Результат', 3000), 'created': number(a.get('created'), 'Время', 0, 10**12),
            'resolvedAt': optional_roll(a.get('resolvedAt'), 'Время результата', 10**12)}
        if 'movement' in a:
            if a['kind']!='other' or target!='battle-floor':
                raise APIError(400,'Перемещение должно быть отдельным действием на поле боя.')
            action['movement']=validate_battle_movement(a['movement'],result['scene'].get('board'))
        result['scene']['actions'].append(action)
    result['scene']['log'] = []
    for event in scene['log']:
        if not isinstance(event, dict):
            raise APIError(400, 'Проверь журнал сцены.')
        entry = {'id': entity_id(event.get('id')), 'text': text(event.get('text'), 'Событие', 3500, True),
                 'created': number(event.get('created'), 'Время', 0, 10**12)}
        if event.get('targetId') is not None:
            entry['targetId'] = entity_id(event['targetId'])
            if entry['targetId'] not in target_ids:
                raise APIError(400, 'Событие ссылается на отсутствующую цель.')
        result['scene']['log'].append(entry)
    for array in [result['contacts'], result['messages'], result['places'], result['assets'],
                  result['scene']['actions'], result['scene']['log']]:
        if len({x['id'] for x in array}) != len(array):
            raise APIError(400, 'ID записей должны различаться.')
    if len(json.dumps(result, ensure_ascii=False,separators=(',',':')).encode()) > 1700000:
        raise APIError(413, 'Терминал кампании слишком большой.')
    return result


class APIError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def connect():
    db = sqlite3.connect(DB, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    return db


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    derived = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return f'{salt}:{derived}'


def check_password(password, encoded):
    return hmac.compare_digest(password_hash(password, encoded.split(':')[0]), encoded)


def text(value, name, limit=1000, required=False):
    if not isinstance(value, str) or len(value) > limit:
        raise APIError(400, f'Проверь поле «{name}».')
    value = value.strip()
    if required and not value:
        raise APIError(400, f'Заполни поле «{name}».')
    return value


def password_value(value):
    # Passwords are exact byte sequences: preserve leading/trailing spaces.
    if not isinstance(value, str) or not value or len(value) > 256:
        raise APIError(400, 'Проверь пароль.')
    return value


def number(value, name, minimum=0, maximum=10000, integral=True):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise APIError(400, f'В поле «{name}» нужно число.')
    if not minimum <= value <= maximum or (integral and int(value) != value):
        raise APIError(400, f'Проверь число в поле «{name}».')
    return int(value) if integral else value


def default_value(raw, key, default):
    """Match JSON null/missing defaults in the hosted API for new schema fields."""
    value = raw.get(key)
    return default if value is None else value


def player_settings(raw):
    """Read existing preference JSON without requiring a database migration."""
    saved = raw if isinstance(raw, dict) else {}
    boolean_keys = ('hints', 'tutorial', 'animations')
    settings = {key: saved[key] if type(saved.get(key)) is bool else DEFAULT_PLAYER_SETTINGS[key]
                for key in boolean_keys}
    settings['ambient'] = (saved.get('ambient') if saved.get('ambient') in ('quiet', 'vivid', 'off')
                           else DEFAULT_PLAYER_SETTINGS['ambient'])
    return settings


def validate_player_settings(raw, current=None):
    boolean_keys = ('hints', 'tutorial', 'animations')
    if (not isinstance(raw, dict) or set(raw) - set(DEFAULT_PLAYER_SETTINGS)
            or any(type(raw.get(key)) is not bool for key in boolean_keys)
            or ('ambient' in raw and raw['ambient'] not in ('quiet', 'vivid', 'off'))):
        raise APIError(400, 'Проверь настройки интерфейса.')
    # Older clients submit only the original booleans; keep the account's selected background.
    return {key: raw[key] for key in boolean_keys} | {
        'ambient': raw['ambient'] if 'ambient' in raw else player_settings(current)['ambient']}


def validate_portrait_frame(raw):
    """Keep optional visual settings bounded and stable in portable archives."""
    keys = {'fit', 'x', 'y', 'zoom', 'height', 'effect'}
    if (not isinstance(raw, dict) or set(raw) != keys
            or raw['fit'] not in ('contain', 'cover')
            or raw['effect'] not in ('off', 'foil', 'scan', 'pulse', 'tilt')):
        raise APIError(400, 'Проверь настройки кадрирования портрета.')
    result = {'fit': raw['fit'], 'effect': raw['effect']}
    for key, minimum, maximum in [('x', 0, 100), ('y', 0, 100),
                                  ('zoom', 100, 300), ('height', 220, 520)]:
        result[key] = number(raw[key], 'Кадрирование портрета', minimum, maximum, integral=True)
    return {key: result[key] for key in ('fit', 'x', 'y', 'zoom', 'height', 'effect')}


def validate_character(raw):
    if not isinstance(raw, dict):
        raise APIError(400, 'Некорректный лист персонажа.')
    out = {k: text(raw.get(k, ''), label, limit, required) for k, label, limit, required in [
        ('name', 'Имя', 80, True), ('role', 'Роль', 80, True),
        ('special', 'Особый навык', 80, False), ('notes', 'Заметки', 12000, False),
        ('condition', 'Состояние', 2000, False), ('background', 'Предыстория', 6000, False)]}
    for key, label, maximum in [('cash', 'Евродоллары', 10**12), ('humanity', 'Человечность', 10000),
                                ('wounds', 'Ранения', 40), ('armorPenalty', 'EV брони', 20),
                                ('specialRank', 'Уровень особого навыка', 10)]:
        out[key] = number(raw.get(key, 0), label, maximum=maximum)
    stats = raw.get('stats', {})
    if not isinstance(stats, dict):
        raise APIError(400, 'Некорректные характеристики.')
    out['stats'] = {k: number(stats.get(k, 0), k, maximum=20) for k in STATS}
    armor = raw.get('armor', {})
    if not isinstance(armor, dict):
        raise APIError(400, 'Некорректная броня.')
    out['armor'] = {k: number(armor.get(k, 0), 'SP брони', maximum=200) for k in ZONES}
    skills = raw.get('skills', [])
    items = raw.get('items', [])
    if not isinstance(skills, list) or len(skills) > 150 or not isinstance(items, list) or len(items) > 250:
        raise APIError(400, 'Слишком много строк в листе.')
    out['skills'], out['items'] = [], []
    for skill in skills:
        if not isinstance(skill, dict):
            raise APIError(400, 'Некорректная строка навыка.')
        stat = skill.get('stat', 'INT')
        if stat not in STATS:
            raise APIError(400, 'Неизвестная характеристика навыка.')
        out['skills'].append({'name': text(skill.get('name', ''), 'Название навыка', 100, True),
            'stat': stat, 'rank': number(skill.get('rank', 0), 'Ранг навыка', maximum=10),
            'ip': number(skill.get('ip', 0), 'IP навыка', maximum=100000),
            'multiplier': number(skill.get('multiplier', 1), 'Множитель IP', 1, 10)})
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise APIError(400, 'Некорректная строка снаряжения.')
        category = item.get('category', 'gear')
        if category not in ['gear', 'weapon', 'armor', 'cyber', 'ammo', 'clothing']:
            raise APIError(400, 'Неизвестный тип вещи.')
        equipped = item.get('equipped', False)
        if not isinstance(equipped, bool):
            raise APIError(400, 'Некорректный статус снаряжения.')
        default_slot = {'armor': 'outer', 'clothing': 'inner', 'weapon': 'mainHand',
                        'cyber': 'implant'}.get(category, 'bag')
        slot = default_value(item, 'slot', default_slot)
        icon = default_value(item, 'icon', 'shirt' if category == 'clothing' else category)
        if slot not in ITEM_SLOTS or icon not in ITEM_ICONS:
            raise APIError(400, 'Проверь слот и иконку вещи.')
        item_id = text(default_value(item, 'id', f'legacy-{index}'), 'ID вещи', 64, True)
        if not re.fullmatch(r'[a-zA-Z0-9_-]+', item_id):
            raise APIError(400, 'Некорректный ID вещи.')
        item_armor = item.get('armor')
        if item_armor is not None:
            if not isinstance(item_armor, dict) or item_armor.get('type') not in ['soft', 'hard', 'skinweave', 'implant']:
                raise APIError(400, 'Проверь тип брони.')
            coverage = default_value(item_armor, 'coverage', {})
            if not isinstance(coverage, dict):
                raise APIError(400, 'Проверь зоны брони.')
            item_armor = {'type': item_armor['type'],
                'coverage': {k: number(default_value(coverage, k, 0), 'SP слоя', maximum=200) for k in ZONES},
                'ev': number(default_value(item_armor, 'ev', 0), 'EV вещи', maximum=20),
                'order': number(default_value(item_armor, 'order', 20), 'Порядок слоёв', maximum=100)}
        raw_modifiers = default_value(item, 'modifiers', [])
        if not isinstance(raw_modifiers, list) or len(raw_modifiers) > 20:
            raise APIError(400, 'Слишком много эффектов вещи.')
        modifiers = []
        for modifier in raw_modifiers:
            if not isinstance(modifier, dict) or modifier.get('stat') not in STATS:
                raise APIError(400, 'Проверь характеристику эффекта.')
            modifiers.append({'stat': modifier['stat'],
                'value': number(modifier.get('value'), 'Модификатор', -20, 20),
                'label': text(modifier.get('label'), 'Эффект', 160, True),
                'source': text(modifier.get('source'), 'Правило эффекта', 250, True)})
        out['items'].append({'id': item_id, 'name': text(item.get('name', ''), 'Название вещи', 100, True),
            'category': category, 'quantity': number(item.get('quantity', 1), 'Количество', maximum=100000),
            'weight': number(item.get('weight', 0), 'Вес', maximum=10000, integral=False),
            'equipped': equipped, 'description': text(item.get('description', ''), 'Описание вещи', 3000),
            'slot': slot, 'icon': icon, 'armor': item_armor, 'modifiers': modifiers,
            'source': text(default_value(item, 'source', ''), 'Источник вещи', 250)})
        if 'visibility' in item:
            if item['visibility'] not in ['auto', 'visible', 'hidden']:
                raise APIError(400, 'Проверь видимость вещи для других игроков.')
            out['items'][-1]['visibility'] = item['visibility']
    if len({item['id'] for item in out['items']}) != len(out['items']):
        raise APIError(400, 'У вещей должны быть разные ID.')
    out['schemaVersion'] = 2
    out['armorMode'] = default_value(raw, 'armorMode', 'manual')
    if out['armorMode'] not in ['manual', 'equipment']:
        raise APIError(400, 'Проверь режим расчёта брони.')
    out['evAdjustment'] = number(default_value(raw, 'evAdjustment', 0), 'Поправка EV', -20, 20)
    appearance = default_value(raw, 'appearance', {})
    if not isinstance(appearance, dict):
        raise APIError(400, 'Проверь внешний вид персонажа.')
    accent = default_value(appearance, 'accent', 'rust')
    if accent not in ['rust', 'teal', 'blue', 'violet']:
        raise APIError(400, 'Проверь цвет персонажа.')
    out['appearance'] = {'accent': accent}
    portrait = appearance.get('portrait')
    if portrait is not None and portrait != '':
        if (not isinstance(portrait, str) or len(portrait) > 100000
                or not re.fullmatch(r'data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}', portrait)):
            raise APIError(400, 'Портрет должен быть небольшим изображением PNG, JPEG или WebP.')
        out['appearance']['portrait'] = portrait
    if 'portraitFrame' in appearance:
        out['appearance']['portraitFrame'] = validate_portrait_frame(appearance['portraitFrame'])
    return out


def exact_payload(raw, keys):
    if set(raw) != set(keys):
        raise APIError(400, 'Проверь поля запроса.')


def mode_value(raw):
    if raw not in ['gm', 'player']:
        raise APIError(400, 'Выбери режим: ведущий или игрок.')
    return raw


def campaign_version(raw):
    if type(raw) is not int:
        raise APIError(400, 'Нужна текущая целая версия кампании.')
    return number(raw, 'Версия кампании', 1, 10**9)


def campaign_summary(row, user_id):
    return {key: row[key] for key in ['id', 'name', 'description', 'gm_id', 'gm',
            'version', 'updated', 'transfer_to']} | {
        'is_gm': row['gm_id'] == user_id, 'is_member': bool(row['is_member'])}


def character_management(db, user_id, row, edit=False):
    if row['owner_id'] == user_id:
        return True
    statuses = "'active','reserve'" if edit else "'pending','active','reserve'"
    return bool(db.execute(f'''SELECT 1 FROM campaign_characters cc
        JOIN campaigns p ON p.id=cc.campaign_id
        WHERE cc.character_id=? AND p.gm_id=? AND cc.status IN ({statuses}) LIMIT 1''',
        (row['id'], user_id)).fetchone())


def character_access(db, user_id, row):
    """Sharing grants reading only, never management or revision history."""
    if row['owner_id'] == user_id:
        return 'owner'
    if character_management(db, user_id, row):
        return 'gm'
    grants = db.execute('''SELECT s.mode,s.recipients FROM character_sharing s
        JOIN campaign_characters source ON source.campaign_id=s.campaign_id
            AND source.character_id=s.character_id
        WHERE s.character_id=? AND source.status IN ('active','reserve')
        AND EXISTS(SELECT 1 FROM campaign_characters viewer JOIN characters c ON c.id=viewer.character_id
            WHERE viewer.campaign_id=s.campaign_id AND c.owner_id=? AND viewer.status IN ('active','reserve'))''',
        (row['id'], user_id))
    for grant in grants:
        if grant['mode'] == 'party' or (grant['mode'] == 'selected' and user_id in json.loads(grant['recipients'])):
            return 'shared'
    return None


def character_permission(db, user_id, row, edit=False):
    return character_management(db, user_id, row, True) if edit else character_access(db, user_id, row) is not None


def character_view(db, user_id, row, owner=None):
    access = character_access(db, user_id, row)
    if owner is None:
        owner = db.execute('SELECT username FROM users WHERE id=?', (row['owner_id'],)).fetchone()['username']
    return {'id': row['id'], 'owner_id': row['owner_id'], 'owner': owner,
            'version': row['version'], 'updated': row['updated'], 'data': json.loads(row['data']),
            'access': access, 'can_history': access in ['owner', 'gm'],
            'can_edit': character_management(db, user_id, row, True), 'can_delete': access == 'owner'}


def character_exterior(character_id, data):
    """A bounded public DTO; never copy the inventory objects or mechanical fields."""
    appearance = {'accent': data.get('appearance', {}).get('accent', 'rust')}
    portrait = data.get('appearance', {}).get('portrait')
    if portrait:
        appearance['portrait'] = portrait
    if 'portraitFrame' in data.get('appearance', {}):
        appearance['portraitFrame'] = validate_portrait_frame(data['appearance']['portraitFrame'])
    worn = [item for item in data.get('items', [])
            if item.get('equipped') and item.get('quantity', 1) > 0]
    def slot_for(item):
        return item.get('slot') or {'armor': 'outer', 'clothing': 'inner',
                                   'weapon': 'mainHand', 'cyber': 'implant'}.get(item.get('category'), 'bag')
    covered = set()
    if any(slot_for(item) == 'body' for item in worn):
        covered.update(['inner', 'outer', 'legs'])
    if any(slot_for(item) == 'outer' for item in worn):
        covered.add('inner')
    visible = []
    for item in worn:
        visibility = item.get('visibility', 'auto')
        slot = slot_for(item)
        if visibility == 'hidden':
            continue
        if visibility != 'visible' and (slot in ['bag', 'implant'] or slot in covered
                                        or item.get('category') in ['ammo', 'cyber']):
            continue
        visible.append({'name': item.get('name', ''), 'slot': slot,
                        'icon': item.get('icon', 'shirt' if item.get('category') == 'clothing' else item.get('category', 'gear'))})
    return {'character_id': character_id, 'name': data.get('name', ''),
            'appearance': appearance, 'items': visible}


def initialize():
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    if DB.is_file():
        backup_dir = DATA / 'backups'
        today = time.strftime('%Y%m%d')
        if not list(backup_dir.glob(f'daily-{today}-*.sqlite3')):
            backup_database(reason='daily')
        with connect() as existing:
            has_meta = existing.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tracker_meta'").fetchone()
            marker = existing.execute("SELECT value FROM tracker_meta WHERE key='portable_schema_version'").fetchone() if has_meta else None
        if not marker or marker['value'] != APP_VERSION:
            backup_database(reason='migration')
    with connect() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('gm','player')));
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
          csrf TEXT NOT NULL, expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS characters (
          id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
          data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(owner_id);
        CREATE TABLE IF NOT EXISTS revisions (
          id INTEGER PRIMARY KEY, character_id INTEGER NOT NULL REFERENCES characters(id),
          actor_id INTEGER NOT NULL REFERENCES users(id), data TEXT NOT NULL,
          version INTEGER NOT NULL, reason TEXT NOT NULL, created INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_revisions_character ON revisions(character_id, id);
        CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, started INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS user_modes (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          mode TEXT NOT NULL CHECK(mode IN ('gm','player')));
        CREATE TABLE IF NOT EXISTS campaigns (
          id INTEGER PRIMARY KEY, gm_id INTEGER NOT NULL REFERENCES users(id),
          name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
          invite_code TEXT NOT NULL UNIQUE, gm_notes TEXT NOT NULL DEFAULT '',
          ledger TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
          updated INTEGER NOT NULL, transfer_to INTEGER REFERENCES users(id));
        CREATE TABLE IF NOT EXISTS campaign_members (
          campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          PRIMARY KEY(campaign_id,user_id));
        CREATE TABLE IF NOT EXISTS campaign_characters (
          campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK(status IN ('pending','active','reserve')),
          created INTEGER NOT NULL, PRIMARY KEY(campaign_id,character_id));
        CREATE INDEX IF NOT EXISTS idx_campaign_characters_character ON campaign_characters(character_id);
        CREATE TABLE IF NOT EXISTS character_sharing (
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          mode TEXT NOT NULL DEFAULT 'private' CHECK(mode IN ('private','party','selected')),
          recipients TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1,
          updated INTEGER NOT NULL, PRIMARY KEY(character_id,campaign_id),
          FOREIGN KEY(campaign_id,character_id) REFERENCES campaign_characters(campaign_id,character_id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS tracker_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS campaign_workspaces (
          campaign_id INTEGER PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
          data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated INTEGER NOT NULL,
          recent_requests TEXT NOT NULL DEFAULT '[]');
        CREATE TABLE IF NOT EXISTS campaign_portability (
          campaign_id INTEGER PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
          uuid TEXT NOT NULL UNIQUE, gm_key TEXT NOT NULL, ancestors TEXT NOT NULL DEFAULT '[]', updated INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS character_portability (
          character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
          uuid TEXT NOT NULL UNIQUE, owner_key TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS user_portability (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, uuid TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS campaign_portable_owners (
          campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          owner_key TEXT NOT NULL, label TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          claim_hash TEXT, member INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(campaign_id,owner_key));
        CREATE TABLE IF NOT EXISTS campaign_transfer_previews (
          token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          campaign_uuid TEXT NOT NULL, source_fingerprint TEXT NOT NULL,
          target_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE, destination_fingerprint TEXT, expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS campaign_transfer_backups (
          id TEXT PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          created INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS campaign_transfer_guards (id TEXT PRIMARY KEY, passed INTEGER NOT NULL CHECK(passed=1));
        CREATE TABLE IF NOT EXISTS imported_revision_labels (
          revision_id INTEGER PRIMARY KEY REFERENCES revisions(id) ON DELETE CASCADE,
          actor_key TEXT NOT NULL, actor_label TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS player_settings (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          data TEXT NOT NULL, updated INTEGER NOT NULL);
        ''')
        db.executescript(shared_battle.SCHEMA)
        db.executescript(crew_atlas.SCHEMA)
        if not db.execute('SELECT 1 FROM users WHERE id=1').fetchone():
            username = os.getenv('ADMIN_USER', 'gm')
            password = os.getenv('ADMIN_PASSWORD', '')
            if not re.fullmatch(r'[A-Za-z0-9_.-]{2,40}', username) or len(password) < 12:
                raise SystemExit('Для первого запуска задай ADMIN_USER и ADMIN_PASSWORD (от 12 символов). См. README.')
            db.execute('INSERT INTO users(id,username,password,role) VALUES(1,?,?,?)',
                       (username, password_hash(password), 'gm'))
        # Never publish new private sheets on a later application restart.
        if not db.execute("SELECT 1 FROM tracker_meta WHERE key='campaigns_migrated'").fetchone():
            if db.execute('SELECT 1 FROM characters LIMIT 1').fetchone():
                now = int(time.time())
                db.execute('''INSERT INTO campaigns(id,gm_id,name,invite_code,updated)
                              VALUES(1,1,?,?,?)''',
                           ('Найт-Сити: первая группа', secrets.token_hex(10).upper(), now))
                db.execute('''INSERT INTO campaign_members(campaign_id,user_id)
                              SELECT DISTINCT 1,owner_id FROM characters''')
                db.execute('''INSERT INTO campaign_characters(campaign_id,character_id,status,created)
                              SELECT 1,id,'active',? FROM characters''', (now,))
            db.execute("INSERT INTO tracker_meta VALUES('campaigns_migrated','1')")
        db.execute("INSERT INTO tracker_meta VALUES('portable_schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (APP_VERSION,))
    os.chmod(DB, 0o600)


class Handler(BaseHTTPRequestHandler):
    server_version = 'NightCityTracker'

    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def log_message(self, fmt, *args):
        # No bodies, passwords, sessions, or API payloads are logged.
        print(f'{self.address_string()} {fmt % args}', flush=True)

    def respond(self, status, body, content_type='application/json; charset=utf-8', cookie=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        atlas_frame = status == 200 and content_type.startswith('text/html') and urlsplit(self.path).path.startswith('/atlas/')
        self.send_header('X-Frame-Options', 'SAMEORIGIN' if atlas_frame else 'DENY')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; frame-ancestors " + ("'self'" if atlas_frame else "'none'") + "; base-uri 'none'; form-action 'self'")
        if SECURE:
            self.send_header('Strict-Transport-Security', 'max-age=31536000')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            raise APIError(400, 'Некорректный запрос.')
        if size <= 0 or size > 6 * 1024 * 1024:
            raise APIError(413, 'Размер запроса превышен.')
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            raise APIError(415, 'Нужен JSON.')
        try:
            def invalid_constant(_):
                raise ValueError('Non-finite JSON number')
            value = json.loads(self.rfile.read(size),parse_constant=invalid_constant)
        except (ValueError, UnicodeError):
            raise APIError(400, 'Некорректный JSON.')
        if not isinstance(value, dict):
            raise APIError(400, 'Нужен объект JSON.')
        return value

    def session(self, db, mutate=False):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie', ''))
            token = cookie[COOKIE].value if COOKIE in cookie else ''
        except Exception:
            token = ''
        digest = hashlib.sha256(token.encode()).hexdigest()
        user = db.execute('''SELECT u.id,u.username,COALESCE(m.mode,u.role) AS role,s.csrf,s.token FROM sessions s
                            JOIN users u ON u.id=s.user_id LEFT JOIN user_modes m ON m.user_id=u.id
                            WHERE s.token=? AND s.expires>?''',
                          (digest, int(time.time()))).fetchone()
        if not user:
            raise APIError(401, 'Войди в свой аккаунт.')
        if mutate and not hmac.compare_digest(self.headers.get('X-CSRF-Token', ''), user['csrf']):
            raise APIError(403, 'Обнови страницу и повтори действие.')
        return user

    def same_origin(self):
        origin = self.headers.get('Origin')
        expected = ORIGIN or ('http://' + self.headers.get('Host', ''))
        if origin and origin != expected:
            raise APIError(403, 'Запрос с другого сайта отклонён.')

    def character(self, db, user, character_id, edit=False, own=False):
        row = db.execute('SELECT * FROM characters WHERE id=?', (character_id,)).fetchone()
        if not row or (own and row['owner_id'] != user['id']) or not character_permission(db, user['id'], row, edit):
            raise APIError(404, 'Персонаж не найден.')
        return row

    def character_access_api(self, db, user, character_id, method, payload):
        row = self.character(db, user, character_id)
        if row['owner_id'] != user['id']:
            raise APIError(403, 'Настройки доступа меняет только владелец персонажа.')

        def players(campaign_id, gm_id):
            return [dict(player) for player in db.execute('''SELECT DISTINCT u.id,u.username
                FROM campaign_characters cc JOIN characters c ON c.id=cc.character_id
                JOIN users u ON u.id=c.owner_id WHERE cc.campaign_id=?
                AND cc.status IN ('active','reserve') AND u.id NOT IN (?,?) ORDER BY u.id''',
                (campaign_id, user['id'], gm_id))]

        if method == 'GET':
            campaigns = []
            for link in db.execute('''SELECT p.id AS campaign_id,p.name,p.gm_id,cc.status,
                s.mode,s.recipients,s.version FROM campaign_characters cc JOIN campaigns p ON p.id=cc.campaign_id
                LEFT JOIN character_sharing s ON s.campaign_id=cc.campaign_id AND s.character_id=cc.character_id
                WHERE cc.character_id=? ORDER BY p.id''', (character_id,)):
                candidates = (players(link['campaign_id'], link['gm_id'])
                              if link['status'] in ['active', 'reserve'] else [])
                allowed = {player['id'] for player in candidates}
                campaigns.append({'campaign_id': link['campaign_id'], 'name': link['name'],
                    'status': link['status'], 'gm_id': link['gm_id'], 'version': link['version'] or 0,
                    'mode': link['mode'] or 'private',
                    'player_ids': [pid for pid in json.loads(link['recipients'] or '[]') if pid in allowed],
                    'players': candidates})
            return self.respond(200, {'campaigns': campaigns})
        if method == 'PUT':
            exact_payload(payload, ['campaign_id', 'version', 'mode', 'player_ids'])
            campaign_id = number(payload['campaign_id'], 'Кампания', 1, 10**9)
            version = number(payload['version'], 'Версия доступа', 0, 10**9)
            mode = payload['mode']
            recipients = payload['player_ids']
            if mode not in ['private', 'party', 'selected'] or not isinstance(recipients, list) or len(recipients) > 30:
                raise APIError(400, 'Проверь режим доступа и список игроков.')
            recipients = [number(pid, 'Игрок', 1, 10**9) for pid in recipients]
            if len(set(recipients)) != len(recipients):
                raise APIError(400, 'Игроки в списке доступа не должны повторяться.')
            db.execute('BEGIN IMMEDIATE')
            self.character(db, user, character_id, own=True)
            link = db.execute('''SELECT p.gm_id FROM campaign_characters cc JOIN campaigns p ON p.id=cc.campaign_id
                WHERE cc.campaign_id=? AND cc.character_id=? AND cc.status IN ('active','reserve')''',
                (campaign_id, character_id)).fetchone()
            if not link:
                raise APIError(403, 'Настройки доступа доступны после принятия персонажа в кампанию.')
            allowed = {player['id'] for player in players(campaign_id, link['gm_id'])}
            if any(pid not in allowed for pid in recipients):
                raise APIError(400, 'Выбери принятых игроков этой кампании.')
            recipients = sorted(recipients) if mode == 'selected' else []
            current = db.execute('SELECT version FROM character_sharing WHERE character_id=? AND campaign_id=?',
                                 (character_id, campaign_id)).fetchone()
            if (current['version'] if current else 0) != version:
                raise APIError(409, 'Настройки доступа уже изменены. Обнови их и повтори действие.')
            now = int(time.time())
            if current:
                changed = db.execute('''UPDATE character_sharing SET mode=?,recipients=?,version=version+1,updated=?
                    WHERE character_id=? AND campaign_id=? AND version=?''',
                    (mode, json.dumps(recipients), now, character_id, campaign_id, version))
                if changed.rowcount != 1:
                    raise APIError(409, 'Настройки доступа уже изменены. Обнови их и повтори действие.')
            else:
                db.execute('INSERT INTO character_sharing VALUES(?,?,?,?,?,?)',
                           (character_id, campaign_id, mode, json.dumps(recipients), 1, now))
            campaign_version = self.bump_campaign(db, campaign_id)
            db.commit()
            return self.respond(200, {'ok': True, 'version': version + 1, 'campaignVersion': campaign_version})
        raise APIError(404, 'Страница не найдена.')

    def campaign(self, db, user, campaign_id, gm=False):
        row = db.execute('''SELECT p.*,u.username AS gm,
            EXISTS(SELECT 1 FROM campaign_members m WHERE m.campaign_id=p.id AND m.user_id=?) AS is_member,
            EXISTS(SELECT 1 FROM campaign_characters cc JOIN characters c ON c.id=cc.character_id
                   WHERE cc.campaign_id=p.id AND c.owner_id=?) AS has_character
            FROM campaigns p JOIN users u ON u.id=p.gm_id WHERE p.id=?''',
            (user['id'], user['id'], campaign_id)).fetchone()
        if not row or (gm and row['gm_id'] != user['id']) or not (
                row['gm_id'] == user['id'] or row['is_member'] or row['has_character']
                or row['transfer_to'] == user['id']):
            raise APIError(404, 'Кампания не найдена.')
        return row

    def versioned_campaign(self, db, user, campaign_id, version, gm=True):
        db.execute('BEGIN IMMEDIATE')
        row = self.campaign(db, user, campaign_id, gm)
        if row['version'] != version:
            raise APIError(409, 'Кампания уже изменилась. Обнови её перед повторным действием.')
        return row

    def bump_campaign(self, db, campaign_id):
        db.execute('UPDATE campaigns SET version=version+1,updated=? WHERE id=?',
                   (int(time.time()), campaign_id))
        return db.execute('SELECT version FROM campaigns WHERE id=?', (campaign_id,)).fetchone()['version']

    def workspace_state(self, db, user, campaign_id):
        campaign = self.campaign(db, user, campaign_id)
        gm = campaign['gm_id'] == user['id']
        if not gm and not campaign['is_member']:
            raise APIError(404, 'Терминал доступен после принятия в кампанию.')
        roster = list(db.execute('''SELECT c.id,c.owner_id,c.data,cc.status FROM campaign_characters cc
            JOIN characters c ON c.id=cc.character_id WHERE cc.campaign_id=? AND cc.status IN ('active','reserve')
            ORDER BY c.id''', (campaign_id,)))
        if not gm and not any(r['owner_id']==user['id'] for r in roster):
            raise APIError(403,'Терминал доступен после принятия твоего персонажа в кампанию.')
        row = db.execute('SELECT * FROM campaign_workspaces WHERE campaign_id=?', (campaign_id,)).fetchone()
        if not row:
            data = empty_workspace()
            # A stable empty scene ID is required for repeated reads and transfer fingerprints.
            db.execute('INSERT OR IGNORE INTO campaign_workspaces VALUES(?,?,?,?,?)',
                       (campaign_id, json.dumps(data, ensure_ascii=False), 1, int(time.time()), '[]'))
            db.commit()
            row = db.execute('SELECT * FROM campaign_workspaces WHERE campaign_id=?', (campaign_id,)).fetchone()
        return campaign, roster, row, gm

    def workspace_response(self, db, user, campaign_id):
        campaign, roster, row, gm = self.workspace_state(db, user, campaign_id)
        data = json.loads(row['data'])
        own = {r['id'] for r in roster if r['owner_id'] == user['id']}
        approved = {r['id'] for r in roster}
        if not gm:
            data['contacts'] = [{k: v for k, v in c.items() if k != 'notes'} for c in data['contacts']
                                if own.intersection(c['recipients'])]
            contact_ids = {c['id'] for c in data['contacts']}
            data['messages'] = [m for m in data['messages'] if m['characterId'] in own and m['contactId'] in contact_ids]
            data['places'] = [p for p in data['places'] if own.intersection(p['recipients'])]
            data['assets'] = [a for a in data['assets'] if a['ownerCharacterId'] in own or own.intersection(a['access'])]
            # Don't disclose other recipients or owners through access lists.
            for c in data['contacts']:
                c['recipients'] = [cid for cid in c['recipients'] if cid in own]
            for p in data['places']:
                p['recipients'] = [cid for cid in p['recipients'] if cid in own]
            for a in data['assets']:
                a['access'] = [cid for cid in a['access'] if cid in approved]
                if a['ownerCharacterId'] not in approved:
                    a['ownerCharacterId'] = None
            visible = {t['id'] for t in data['scene']['targets'] if any(battle_target_visible(data['scene'],cid,t['id'],approved) for cid in own)}
            if data['scene'].get('board') is not None:
                data['scene']['board']=project_battle_board(data['scene']['board'],own,approved,visible)
            data['scene']['targets'] = [t for t in data['scene']['targets'] if t['id'] in visible]
            data['scene']['actions'] = [a for a in data['scene']['actions'] if a['characterId'] in own and a['targetId'] in visible]
            data['scene']['log'] = [e for e in data['scene']['log'] if e.get('targetId') in visible]
        characters = [{'id': r['id'], 'owner_id': r['owner_id'], 'status': r['status'],
                       'name': json.loads(r['data']).get('name', ''), 'role': json.loads(r['data']).get('role', '')}
                      for r in roster if gm or r['owner_id'] == user['id']]
        return {'version': row['version'], 'updated': row['updated'], 'is_gm': gm,
                'campaignVersion': campaign['version'], 'characters': characters, 'data': data}

    def workspace_api(self, db, user, campaign_id, method, payload):
        if method == 'GET':
            return self.respond(200, self.workspace_response(db, user, campaign_id))
        if method != 'POST':
            raise APIError(404, 'Страница не найдена.')
        # Establish metadata before acquiring the mutation lock; all permissions recheck below.
        self.workspace_state(db, user, campaign_id)
        db.execute('BEGIN IMMEDIATE')
        campaign, roster, row, gm = self.workspace_state(db, user, campaign_id)
        command = payload.get('command')
        keys = {
            'contact.save': ['contact'], 'contact.delete': ['id'], 'message.send': ['contactId','characterIds','body'],
            'message.reply': ['contactId','characterId','body'], 'place.save': ['place'], 'place.delete': ['id'],
            'asset.save': ['asset'], 'asset.delete': ['id'], 'scene.save': ['name','active','targets'],
            'battle.save': ['board','targets'], 'battle.move': ['id','x','y'], 'battle.requestMove': ['characterId','x','y'],
            'action.submit': ['characterId','targetId','kind','description','tool','roll','damage'],
            'action.roll': ['id','roll','damage'], 'action.approve': ['id'],
            'action.resolve': ['id','result'], 'action.reject': ['id','result'], 'action.undo': ['id']}
        if command not in keys:
            raise APIError(400, 'Неизвестное действие терминала.')
        expected = ['version', 'command'] + keys[command] + (['requestId'] if 'requestId' in payload else [])
        exact_payload(payload, expected)
        recent = json.loads(row['recent_requests'])
        request_id = text(payload['requestId'], 'ID запроса', 80, True) if 'requestId' in payload else None
        fingerprint = hashlib.sha256(json.dumps({k:v for k,v in payload.items() if k not in ['version','requestId']},
                    sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
        duplicate = next((r for r in recent if r['userId'] == user['id'] and r['id'] == request_id), None) if request_id else None
        if duplicate:
            if duplicate['fingerprint'] != fingerprint:
                raise APIError(409, 'Этот ID запроса уже использован для другого действия.')
            db.commit()
            return self.respond(200, dict(duplicate['response'], duplicate=True))
        if campaign_version(payload.get('version')) != row['version']:
            raise APIError(409, 'Терминал уже изменился. Обнови данные и повтори действие.')
        if command not in ['message.reply','action.submit','action.roll','battle.requestMove'] and not gm:
            raise APIError(403, 'Это действие доступно ведущему кампании.')
        data = json.loads(row['data'])
        approved = {r['id'] for r in roster}
        own = {r['id'] for r in roster if r['owner_id'] == user['id']}
        now, result_id = int(time.time()), None
        def find(array, item_id):
            found = next((x for x in array if x['id'] == item_id), None)
            if not found:
                raise APIError(404, 'Запись не найдена.')
            return found
        if command in ['contact.save','place.save','asset.save']:
            key, validator, limit = {'contact.save': ('contacts',workspace_contact,100),
                                    'place.save': ('places',workspace_place,100),
                                    'asset.save': ('assets',workspace_asset,100)}[command]
            singular = command.split('.')[0]
            item = validator(payload[singular], approved)
            previous = next((x for x in data[key] if x['id'] == item['id']), None)
            if previous:
                data[key][data[key].index(previous)] = item
            elif len(data[key]) < limit:
                data[key].append(item)
            else:
                raise APIError(400, 'Достигнут лимит записей.')
        elif command in ['contact.delete','place.delete','asset.delete']:
            key = {'contact.delete':'contacts','place.delete':'places','asset.delete':'assets'}[command]
            item_id = entity_id(payload['id'])
            found = find(data[key], item_id)
            data[key].remove(found)
            if key == 'contacts':
                data['messages'] = [m for m in data['messages'] if m['contactId'] != item_id]
        elif command in ['message.send','message.reply']:
            contact = find(data['contacts'], entity_id(payload['contactId']))
            recipients = id_list(payload['characterIds'], approved) if command == 'message.send' else [number(payload['characterId'], 'Персонаж', 1, 10**9)]
            if not recipients or not set(recipients) <= set(contact['recipients']) or (command == 'message.reply' and not set(recipients) <= own):
                raise APIError(403, 'Контакт недоступен выбранному персонажу.')
            body = text(payload['body'], 'Сообщение', 3000, True)
            if len(data['messages']) + len(recipients) > 1000:
                raise APIError(400, 'В кампании уже 1000 сообщений. Сохрани архив перед очисткой переписки.')
            for cid in recipients:
                result_id = str(uuid.uuid4())
                data['messages'].append({'id':result_id,'contactId':contact['id'],'characterId':cid,
                    'sender':'npc' if command == 'message.send' else 'character','body':body,'created':now})
        elif command == 'scene.save':
            if type(payload['active']) is not bool:
                raise APIError(400, 'Проверь состояние сцены.')
            targets = workspace_targets(payload['targets'])
            if data['scene'].get('board') is not None:
                targets=[t for t in targets if t['id']!='battle-floor']+[dict(BATTLE_ANCHOR)]
                targets=workspace_targets(targets)
            if payload['active'] and not any(t['visible'] for t in targets):
                raise APIError(400, 'Чтобы открыть сцену, покажи игрокам хотя бы одну цель.')
            battle_preserve_history(data['scene'],targets)
            if data['scene'].get('board') is not None:
                by_id={target['id']:target for target in targets}
                for piece in data['scene']['board']['pieces']:
                    if piece['kind']=='target':
                        target=by_id[piece['targetId']]
                        piece.update(name=target['name'],description=target['description'][:1500],hidden=not target['visible'])
            data['scene'].update(name=text(payload['name'], 'Название сцены', 100, True), active=payload['active'], targets=targets)
        elif command == 'battle.save':
            targets=workspace_targets(payload['targets'])
            targets=[t for t in targets if t['id']!='battle-floor']+[dict(BATTLE_ANCHOR)]
            targets=workspace_targets(targets)
            # Replacing a template may remove unused pawns, but must retain historical targets.
            required={act['targetId'] for act in data['scene']['actions']}|{e['targetId'] for e in data['scene']['log'] if 'targetId' in e}
            if not required<={t['id'] for t in targets}:
                raise APIError(400,'Сохрани цели, на которые ссылается история действий; их можно скрыть.')
            board=validate_battle_board(payload['board'],targets,approved)
            by_id={target['id']:target for target in targets}
            for piece in board['pieces']:
                if piece['kind']=='target':
                    target=by_id[piece['targetId']]
                    piece.update(name=target['name'],description=target['description'][:1500],hidden=not target['visible'])
            for action in data['scene']['actions']:
                if 'movement' in action:
                    validate_battle_movement(action['movement'],board)
            data['scene'].update(board=board,targets=targets)
        elif command == 'battle.move':
            board=data['scene'].get('board')
            if board is None:
                raise APIError(409,'Сначала подготовь поле боя.')
            piece=find(board['pieces'],entity_id(payload['id']))
            x,y=battle_destination(board,piece,payload['x'],payload['y'],approved)
            piece.update(x=x,y=y)
            result_id=piece['id']
        elif command == 'battle.requestMove':
            cid=number(payload['characterId'],'Персонаж',1,10**9)
            board=data['scene'].get('board')
            if cid not in own or not data['scene']['active'] or board is None:
                raise APIError(403,'Выбери своего принятого персонажа в открытой сцене с полем боя.')
            pawn=battle_actor_pawn(board,cid)
            if pawn is None:
                raise APIError(409,'Ведущий ещё не поставил твоего персонажа на поле.')
            x,y=battle_position(board,payload['x'],payload['y'])
            if y*board['width']+x not in battle_visible_cells(board,pawn):
                raise APIError(403,'Персонаж сейчас не видит эту клетку.')
            x,y=battle_destination(board,pawn,x,y,approved)
            if x==pawn['x'] and y==pawn['y']:
                raise APIError(400,'Выбери другую клетку для перемещения.')
            movement=validate_battle_movement({'fromX':pawn['x'],'fromY':pawn['y'],'x':x,'y':y},board)
            if len(data['scene']['actions'])>=200:
                raise APIError(400,'В сцене уже 200 действий.')
            if not any(t['id']=='battle-floor' for t in data['scene']['targets']):
                raise APIError(409,'Ведущий должен снова сохранить поле боя.')
            result_id=str(uuid.uuid4())
            data['scene']['actions'].append({'id':result_id,'characterId':cid,'targetId':'battle-floor',
                'kind':'other','description':f'Перемещение: ({pawn["x"]+1}, {pawn["y"]+1}) → ({x+1}, {y+1}).',
                'tool':'','roll':None,'damage':None,'status':'submitted','result':'','created':now,'resolvedAt':None,
                'movement':movement})
        elif command == 'action.submit':
            cid = number(payload['characterId'], 'Персонаж', 1, 10**9)
            target = find(data['scene']['targets'], entity_id(payload['targetId']))
            if cid not in own or not battle_target_visible(data['scene'],cid,target['id'],approved) or not data['scene']['active']:
                raise APIError(403, 'Выбери своего принятого персонажа и видимую цель активной сцены.')
            if payload['kind'] not in ['attack','program','other']:
                raise APIError(400, 'Проверь тип действия.')
            if len(data['scene']['actions']) >= 200:
                raise APIError(400, 'В сцене уже 200 действий.')
            if payload['roll'] is not None or payload['damage'] is not None:
                raise APIError(400, 'Сначала отправь намерение без кубиков и дождись разрешения ГМ.')
            result_id = str(uuid.uuid4())
            data['scene']['actions'].append({'id':result_id,'characterId':cid,'targetId':target['id'],
                'kind':payload['kind'],'description':text(payload['description'], 'Действие', 2000, True),
                'tool':text(payload['tool'],'Оружие или программа',200),
                'roll':optional_roll(payload['roll'],'Бросок'),'damage':optional_roll(payload['damage'],'Урон'),
                'status':'submitted','result':'','created':now,'resolvedAt':None})
        else:
            action = find(data['scene']['actions'], entity_id(payload['id']))
            result_id = action['id']
            if command == 'action.roll':
                if action['characterId'] not in own:
                    raise APIError(403, 'Бросок можно внести только в своё действие.')
                if action['status'] != 'approved':
                    raise APIError(409, 'Сначала дождись разрешения ГМ. Кубики вносятся в разрешённое действие.')
                if not battle_target_visible(data['scene'],action['characterId'],action['targetId'],approved):
                    raise APIError(403,'Цель сейчас недоступна.')
                action.update(roll=optional_roll(payload['roll'],'Бросок'),damage=optional_roll(payload['damage'],'Урон'))
            elif command == 'action.approve':
                if action['status'] != 'submitted':
                    raise APIError(409, 'Подтвердить можно только новое действие.')
                action['status'] = 'approved'
            elif command in ['action.resolve','action.reject']:
                allowed = ['approved'] if command == 'action.resolve' else ['submitted','approved']
                if action['status'] not in allowed:
                    raise APIError(409, 'Действие уже завершено или ещё не подтверждено.')
                result = text(payload['result'], 'Результат', 3000, command == 'action.resolve')
                if command=='action.resolve' and 'movement' in action:
                    battle_apply_movement(data['scene'],action,approved)
                action.update(status='resolved' if command == 'action.resolve' else 'rejected',result=result,resolvedAt=now)
                if command == 'action.resolve':
                    target=find(data['scene']['targets'],action['targetId'])
                    actor=next((json.loads(r['data']).get('name','Персонаж') for r in roster if r['id']==action['characterId']),'Персонаж')
                    data['scene']['log'].append({'id':action['id'],'text':actor+' → '+target['name']+': '+result,
                                               'targetId':action['targetId'],'created':now})
            elif command == 'action.undo':
                if action['status'] not in ['resolved','rejected']:
                    raise APIError(409, 'Отменить можно только завершённое действие.')
                if action['status']=='resolved' and 'movement' in action:
                    battle_apply_movement(data['scene'],action,approved,undo=True)
                action.update(status='approved',result='',resolvedAt=None)
                data['scene']['log'] = [e for e in data['scene']['log'] if e['id'] != action['id']]
        # Verify stored bounds after narrow mutation; historical sheet refs may remain intentionally.
        data = validate_workspace(data)
        response = {'ok': True, 'version': row['version'] + 1}
        if result_id:
            response['id'] = result_id
        if request_id:
            recent.append({'userId':user['id'],'id':request_id,'fingerprint':fingerprint,'response':response})
        changed=db.execute('UPDATE campaign_workspaces SET data=?,version=version+1,updated=?,recent_requests=? WHERE campaign_id=? AND version=?',
                   (json.dumps(data,ensure_ascii=False),now,json.dumps(recent[-100:]),campaign_id,row['version']))
        if changed.rowcount!=1:
            raise APIError(409,'Терминал уже изменился. Обнови данные и повтори действие.')
        changed=db.execute('UPDATE campaigns SET version=version+1,updated=? WHERE id=? AND version=?',
                           (now,campaign_id,campaign['version']))
        if changed.rowcount!=1:
            raise APIError(409,'Кампания уже изменилась. Обнови данные и повтори действие.')
        response['campaignVersion'] = campaign['version']+1
        db.commit()
        return self.respond(200, response)

    def sync_response(self, db, user):
        sheets = [[r['id'], r['version'], character_access(db, user['id'], r)]
                  for r in db.execute('SELECT id,owner_id,version FROM characters ORDER BY id')
                  if character_permission(db, user['id'], r)]
        exteriors = [list(r) for r in db.execute('''SELECT DISTINCT source.character_id,c.version
            FROM campaign_characters source JOIN characters c ON c.id=source.character_id
            WHERE source.status IN ('active','reserve') AND EXISTS
            (SELECT 1 FROM campaign_characters viewer JOIN characters mine ON mine.id=viewer.character_id
             WHERE viewer.campaign_id=source.campaign_id AND mine.owner_id=? AND viewer.status IN ('active','reserve'))
            ORDER BY source.character_id''', (user['id'],))]
        campaigns = [list(r) for r in db.execute('''SELECT p.id,p.version,COALESCE(w.version,0) FROM campaigns p
            LEFT JOIN campaign_workspaces w ON w.campaign_id=p.id WHERE p.gm_id=? OR p.transfer_to=? OR EXISTS
            (SELECT 1 FROM campaign_members m WHERE m.campaign_id=p.id AND m.user_id=?) OR EXISTS
            (SELECT 1 FROM campaign_characters cc JOIN characters c ON c.id=cc.character_id
             WHERE cc.campaign_id=p.id AND c.owner_id=?) ORDER BY p.id''', (user['id'],)*4)]
        mode=db.execute('SELECT mode FROM user_modes WHERE user_id=?',(user['id'],)).fetchone()
        signature = hashlib.sha256(json.dumps([sheets,campaigns,exteriors,mode['mode'] if mode else None],separators=(',',':')).encode()).hexdigest()
        return {'version':APP_VERSION,'apiVersion':API_VERSION,'signature':signature}

    def portability_user(self, db, user_id):
        db.execute('INSERT OR IGNORE INTO user_portability VALUES(?,?)',(user_id,str(uuid.uuid4())))
        return db.execute('SELECT uuid FROM user_portability WHERE user_id=?',(user_id,)).fetchone()['uuid']

    def capture_campaign(self, db, user, campaign_id):
        campaign = db.execute('SELECT * FROM campaigns WHERE id=? AND gm_id=?',(campaign_id,user['id'])).fetchone()
        if not campaign:
            raise APIError(403,'Архив доступен только ведущему этой кампании.')
        gm_user_key=self.portability_user(db,campaign['gm_id'])
        db.execute("INSERT OR IGNORE INTO campaign_portability VALUES(?,?,?,'[]',?)",
                   (campaign_id,str(uuid.uuid4()),gm_user_key,int(time.time())))
        portable=dict(db.execute('SELECT * FROM campaign_portability WHERE campaign_id=?',(campaign_id,)).fetchone())
        gm_binding=db.execute('SELECT user_id FROM campaign_portable_owners WHERE campaign_id=? AND owner_key=?',
                              (campaign_id,portable['gm_key'])).fetchone()
        if gm_binding and gm_binding['user_id']!=campaign['gm_id']:
            preferred_gm=db.execute('SELECT owner_key FROM campaign_portable_owners WHERE campaign_id=? AND user_id=? ORDER BY member DESC,owner_key LIMIT 1',
                                    (campaign_id,campaign['gm_id'])).fetchone()
            gm_user_key=preferred_gm['owner_key'] if preferred_gm else gm_user_key
            db.execute('UPDATE campaign_portability SET gm_key=?,updated=? WHERE campaign_id=?',
                       (gm_user_key,int(time.time()),campaign_id))
            portable['gm_key']=gm_user_key
        rows=[dict(r) for r in db.execute('''SELECT c.*,cc.status,u.username AS owner_label FROM campaign_characters cc
            JOIN characters c ON c.id=cc.character_id JOIN users u ON u.id=c.owner_id WHERE cc.campaign_id=? ORDER BY c.id''',(campaign_id,))]
        if len(rows)>30:
            raise APIError(400,'В переносимой кампании может быть до 30 листов.')
        stored_owners=[dict(o) for o in db.execute('SELECT * FROM campaign_portable_owners WHERE campaign_id=?',(campaign_id,))]
        by_key={o['owner_key']:o for o in stored_owners}
        owners={}
        def local_owner(user_id,label,preferred=None):
            existing=by_key.get(preferred) if preferred else next((o for o in stored_owners if o['user_id']==user_id),None)
            key=preferred or (existing['owner_key'] if existing else self.portability_user(db,user_id))
            owners[key]={'key':key,'label':existing['label'] if existing else label}
            if not existing:
                db.execute('INSERT OR IGNORE INTO campaign_portable_owners(campaign_id,owner_key,label,user_id) VALUES(?,?,?,?)',
                           (campaign_id,key,label,user_id))
            return key
        local_owner(campaign['gm_id'],user['username'],portable['gm_key'])
        members=list(db.execute('SELECT m.user_id,u.username FROM campaign_members m JOIN users u ON u.id=m.user_id WHERE m.campaign_id=? ORDER BY m.user_id',(campaign_id,)))
        member_keys=[]
        for member in members:
            bindings=[o for o in stored_owners if o['user_id']==member['user_id'] and o['member']==1]
            if bindings:
                for owner in bindings:
                    if owner['owner_key']!=portable['gm_key']:
                        member_keys.append(owner['owner_key'])
                    owners[owner['owner_key']]={'key':owner['owner_key'],'label':owner['label']}
            else:
                key=local_owner(member['user_id'],member['username'])
                if key!=portable['gm_key']:
                    member_keys.append(key)
                db.execute('UPDATE campaign_portable_owners SET member=1 WHERE campaign_id=? AND owner_key=?',(campaign_id,key))
        for owner in stored_owners:
            if owner['member']==1 and owner['user_id'] is None and owner['owner_key']!=portable['gm_key']:
                member_keys.append(owner['owner_key'])
                owners[owner['owner_key']]={'key':owner['owner_key'],'label':owner['label']}
        sheets,revision_count=[],0
        for row in rows:
            actual_key=self.portability_user(db,row['owner_id'])
            db.execute('INSERT OR IGNORE INTO character_portability VALUES(?,?,?)',(row['id'],str(uuid.uuid4()),actual_key))
            cp=db.execute('SELECT * FROM character_portability WHERE character_id=?',(row['id'],)).fetchone()
            binding=by_key.get(cp['owner_key'])
            if binding and binding['user_id'] is not None and binding['user_id']!=row['owner_id']:
                raise APIError(409,'Владелец переносимого листа изменился. Проверь привязку персонажа.')
            owner_key=local_owner(row['owner_id'],row['owner_label'],cp['owner_key'])
            revisions=list(db.execute('''SELECT r.*,u.username AS actor_label,l.actor_key AS imported_actor_key,
                l.actor_label AS imported_actor_label FROM revisions r JOIN users u ON u.id=r.actor_id
                LEFT JOIN imported_revision_labels l ON l.revision_id=r.id WHERE r.character_id=? ORDER BY r.id''',(row['id'],)))
            revision_count+=len(revisions)
            if revision_count>300:
                raise APIError(400,'Архив содержит больше 300 ревизий. История не будет обрезана: уменьши кампанию перед переносом.')
            history=[]
            for revision in revisions:
                actor_key=revision['imported_actor_key'] or self.portability_user(db,revision['actor_id'])
                actor_label=revision['imported_actor_label'] or revision['actor_label']
                owners[actor_key]={'key':actor_key,'label':actor_label}
                history.append({'version':revision['version'],'reason':revision['reason'],'created':revision['created'],
                    'actorKey':actor_key,'actorLabel':actor_label,'data':validate_character(json.loads(revision['data']))})
            row['uuid'],row['owner_key']=cp['uuid'],owner_key
            sheets.append({'uuid':cp['uuid'],'ownerKey':owner_key,'status':row['status'],
                           'data':validate_character(json.loads(row['data'])),'revisions':history})
        workspace=db.execute('SELECT * FROM campaign_workspaces WHERE campaign_id=?',(campaign_id,)).fetchone()
        raw=json.loads(workspace['data']) if workspace else empty_workspace()
        if not workspace:
            raw['scene']['id']=portable['uuid']
        checked=validate_workspace(raw,{r['id'] for r in rows},{r['id'] for r in rows if r['status'] in ['active','reserve']})
        refs={r['id']:r['uuid'] for r in rows}
        def convert(ref):
            if ref not in refs:
                raise APIError(400,'Терминал ссылается на персонажа вне состава. Верни его в состав перед переносом для сохранения истории.')
            return refs[ref]
        content={'campaign':{k:campaign[k] for k in ['name','description','gm_notes','ledger']}|{'gmOwnerKey':portable['gm_key']},
                 'owners':sorted(owners.values(),key=lambda o:o['key']),'members':sorted(set(member_keys)),
                 'characters':sorted(sheets,key=lambda s:s['uuid']),'workspace':convert_workspace(checked,convert)}
        if db.execute('SELECT 1 FROM crew_atlas_state WHERE campaign_id=?', (campaign_id,)).fetchone():
            content['atlas'] = crew_atlas.capture(db, campaign_id)
        fingerprint=content_fingerprint(content)
        ancestors=[a for a in json.loads(portable['ancestors']) if isinstance(a,str) and re.fullmatch('[a-f0-9]{64}',a) and a!=fingerprint][-128:]
        archive={'format':'night-city-campaign','formatVersion':1,'apiVersion':API_VERSION,'campaignUuid':portable['uuid'],
                 'exportedAt':int(time.time()),'fingerprint':fingerprint,'ancestors':ancestors,'content':content}
        if len(json.dumps(archive,ensure_ascii=False,separators=(',',':')).encode())>3145728:
            raise APIError(413,'Архив кампании превышает 3 МБ. Полная история не будет обрезана.')
        return {'archive':archive,'campaign':campaign,'workspace':workspace,'rows':rows,'owners':stored_owners}

    def transfer_plan(self, db, user, archive):
        target=db.execute('SELECT campaign_id FROM campaign_portability WHERE uuid=?',(archive['campaignUuid'],)).fetchone()
        current=self.capture_campaign(db,user,target['campaign_id']) if target else None
        conflicts=[]
        if current:
            if current['archive']['content']['campaign']['gmOwnerKey']!=archive['content']['campaign']['gmOwnerKey']:
                conflicts.append('В архиве другой ведущий. Сначала передай кампанию через обычную передачу ведущего.')
            if archive['fingerprint']!=current['archive']['fingerprint'] and current['archive']['fingerprint'] not in archive['ancestors']:
                conflicts.append('На этом сервере есть изменения, которых нет в истории архива. Сохрани обе версии; автоматического объединения нет.')
            incoming={s['uuid']:s for s in archive['content']['characters']}
            exported={s['uuid']:s for s in current['archive']['content']['characters']}
            for row in current['rows']:
                if row['uuid'] not in incoming or canonical(incoming[row['uuid']])!=canonical(exported[row['uuid']]):
                    other=db.execute('SELECT p.name FROM campaign_characters cc JOIN campaigns p ON p.id=cc.campaign_id WHERE cc.character_id=? AND cc.campaign_id<>? LIMIT 1',
                                     (row['id'],current['campaign']['id'])).fetchone()
                    if other:
                        conflicts.append(f'Лист «{exported[row["uuid"]]["data"]["name"]}» используется также в кампании «{other["name"]}». Изменение или вывод заблокированы.')
        current_ids={r['id'] for r in current['rows']} if current else set()
        for sheet in archive['content']['characters']:
            local=db.execute('SELECT character_id FROM character_portability WHERE uuid=?',(sheet['uuid'],)).fetchone()
            if local and local['character_id'] not in current_ids:
                conflicts.append(f'Лист «{sheet["data"]["name"]}» уже существует вне этой кампании. Импорт не меняет чужую коллекцию.')
        mode='conflict' if conflicts else 'new' if not current else 'unchanged' if current['archive']['fingerprint']==archive['fingerprint'] else 'update'
        return current,mode,conflicts

    def apply_archive(self, db, user, archive, token):
        # Take a consistent whole-server backup before entering the write transaction.
        db.commit()
        backup_database(reason='import')
        db.execute('BEGIN IMMEDIATE')
        now=int(time.time())
        token_hash=hashlib.sha256(token.encode()).hexdigest()
        preview=db.execute('SELECT * FROM campaign_transfer_previews WHERE token_hash=? AND user_id=? AND expires>?',
                           (token_hash,user['id'],now)).fetchone()
        if not preview or preview['campaign_uuid']!=archive['campaignUuid'] or preview['source_fingerprint']!=archive['fingerprint']:
            raise APIError(409,'Предпросмотр истёк или относится к другому файлу. Загрузи архив заново.')
        current,mode,conflicts=self.transfer_plan(db,user,archive)
        if conflicts:
            raise APIError(409,' '.join(conflicts))
        campaign_id=current['campaign']['id'] if current else None
        fingerprint=current['archive']['fingerprint'] if current else None
        if campaign_id!=preview['target_id'] or fingerprint!=preview['destination_fingerprint']:
            raise APIError(409,'Кампания изменилась после предпросмотра. Обнови проверку архива.')
        if mode=='unchanged':
            db.execute('DELETE FROM campaign_transfer_previews WHERE token_hash=?',(token_hash,))
            db.commit()
            return {'id':campaign_id,'mode':mode,'claimCodes':[]}
        c=archive['content']['campaign']
        ancestors=list(dict.fromkeys(archive['ancestors']+[archive['fingerprint']]))[-128:]
        if current:
            db.execute('INSERT INTO campaign_transfer_backups VALUES(?,?,?,?)',
                       (str(uuid.uuid4()),campaign_id,now,json.dumps(current['archive'],ensure_ascii=False,separators=(',',':'))))
            db.execute('''UPDATE campaigns SET name=?,description=?,gm_notes=?,ledger=?,invite_code=?,transfer_to=NULL,
                version=version+1,updated=? WHERE id=?''',(c['name'],c['description'],c['gm_notes'],c['ledger'],secrets.token_hex(10).upper(),now,campaign_id))
        else:
            cur=db.execute('INSERT INTO campaigns(gm_id,name,description,invite_code,gm_notes,ledger,updated) VALUES(?,?,?,?,?,?,?)',
                (user['id'],c['name'],c['description'],secrets.token_hex(10).upper(),c['gm_notes'],c['ledger'],now))
            campaign_id=cur.lastrowid
            db.execute('INSERT INTO campaign_portability VALUES(?,?,?,?,?)',
                       (campaign_id,archive['campaignUuid'],c['gmOwnerKey'],json.dumps(ancestors),now))
        old_bindings={o['owner_key']:dict(o) for o in db.execute('SELECT * FROM campaign_portable_owners WHERE campaign_id=?',(campaign_id,))}
        claim_codes,mapped_user=[],{}
        db.execute('UPDATE campaign_portable_owners SET member=0 WHERE campaign_id=?',(campaign_id,))
        for owner in archive['content']['owners']:
            old=old_bindings.get(owner['key'])
            local=old['user_id'] if old else None
            if owner['key']==c['gmOwnerKey']:
                local=user['id']
            has_sheets=any(s['ownerKey']==owner['key'] for s in archive['content']['characters'])
            member=owner['key'] in archive['content']['members']
            code=None; claim_hash=old['claim_hash'] if old else None
            if local is None and (has_sheets or member):
                code=secrets.token_hex(20).upper()
                claim_hash=hashlib.sha256(code.encode()).hexdigest()
                claim_codes.append({'ownerKey':owner['key'],'label':owner['label'],'code':code,
                    'characters':[s['data']['name'] for s in archive['content']['characters'] if s['ownerKey']==owner['key']]})
            mapped_user[owner['key']]=local
            db.execute('''INSERT INTO campaign_portable_owners(campaign_id,owner_key,label,user_id,claim_hash,member) VALUES(?,?,?,?,?,?)
                ON CONFLICT(campaign_id,owner_key) DO UPDATE SET label=excluded.label,user_id=excluded.user_id,
                claim_hash=excluded.claim_hash,member=excluded.member''',
                (campaign_id,owner['key'],owner['label'],local,claim_hash,int(member)))
        old_rows={r['uuid']:r for r in current['rows']} if current else {}
        old_sheets={s['uuid']:s for s in current['archive']['content']['characters']} if current else {}
        id_by_uuid={}
        for sheet in archive['content']['characters']:
            old=old_rows.get(sheet['uuid'])
            if old and old['owner_key']!=sheet['ownerKey']:
                raise APIError(409,'Архив пытается изменить владельца существующего персонажа. Перенос отменён.')
            incoming_version=max([1]+[r['version'] for r in sheet['revisions']])
            if old:
                cid=old['id']
                if canonical(old_sheets[sheet['uuid']])==canonical(sheet):
                    id_by_uuid[sheet['uuid']]=cid
                    continue
                db.execute('UPDATE characters SET data=?,version=?,updated=? WHERE id=?',
                           (json.dumps(sheet['data'],ensure_ascii=False),max(old['version']+1,incoming_version),now,cid))
            else:
                owner_id=mapped_user.get(sheet['ownerKey']) or user['id']
                cur=db.execute('INSERT INTO characters(owner_id,data,version,updated) VALUES(?,?,?,?)',
                               (owner_id,json.dumps(sheet['data'],ensure_ascii=False),incoming_version,now))
                cid=cur.lastrowid
                db.execute('INSERT INTO character_portability VALUES(?,?,?)',(cid,sheet['uuid'],sheet['ownerKey']))
            id_by_uuid[sheet['uuid']]=cid
            db.execute('DELETE FROM imported_revision_labels WHERE revision_id IN(SELECT id FROM revisions WHERE character_id=?)',(cid,))
            db.execute('DELETE FROM revisions WHERE character_id=?',(cid,))
            for revision in sheet['revisions']:
                actor=mapped_user.get(revision['actorKey']) or user['id']
                cur=db.execute('INSERT INTO revisions(character_id,actor_id,data,version,reason,created) VALUES(?,?,?,?,?,?)',
                    (cid,actor,json.dumps(revision['data'],ensure_ascii=False),revision['version'],revision['reason'],revision['created']))
                db.execute('INSERT INTO imported_revision_labels VALUES(?,?,?)',(cur.lastrowid,revision['actorKey'],revision['actorLabel']))
        db.execute('DELETE FROM campaign_characters WHERE campaign_id=?',(campaign_id,))
        for sheet in archive['content']['characters']:
            db.execute('INSERT INTO campaign_characters VALUES(?,?,?,?)',
                       (campaign_id,id_by_uuid[sheet['uuid']],sheet['status'],now))
        workspace=convert_workspace(archive['content']['workspace'],lambda ref:id_by_uuid[ref])
        validate_workspace(workspace,set(id_by_uuid.values()),{id_by_uuid[s['uuid']] for s in archive['content']['characters'] if s['status'] in ['active','reserve']})
        db.execute('''INSERT INTO campaign_workspaces(campaign_id,data,version,updated,recent_requests) VALUES(?,?,1,?,'[]')
            ON CONFLICT(campaign_id) DO UPDATE SET data=excluded.data,version=campaign_workspaces.version+1,
            updated=excluded.updated,recent_requests='[]' ''',(campaign_id,json.dumps(workspace,ensure_ascii=False),now))
        if 'atlas' in archive['content']:
            crew_atlas.restore_archive(db, campaign_id, crew_atlas.validate_archive(archive['content']['atlas']))
        db.execute('DELETE FROM campaign_members WHERE campaign_id=?',(campaign_id,))
        members={user['id']}
        for key in archive['content']['members']:
            if mapped_user.get(key) is not None:
                members.add(mapped_user[key])
        for sheet in archive['content']['characters']:
            if sheet['status']!='pending':
                local=old_rows.get(sheet['uuid'],{}).get('owner_id') or mapped_user.get(sheet['ownerKey'])
                if local:
                    members.add(local)
        for member in members:
            db.execute('INSERT OR IGNORE INTO campaign_members VALUES(?,?)',(campaign_id,member))
        db.execute('UPDATE campaign_portability SET gm_key=?,ancestors=?,updated=? WHERE campaign_id=?',
                   (c['gmOwnerKey'],json.dumps(ancestors),now,campaign_id))
        db.execute('DELETE FROM campaign_transfer_previews WHERE token_hash=?',(token_hash,))
        db.execute('''DELETE FROM campaign_transfer_backups WHERE campaign_id=? AND id NOT IN
            (SELECT id FROM campaign_transfer_backups WHERE campaign_id=? ORDER BY created DESC,id DESC LIMIT 10)''',(campaign_id,campaign_id))
        db.commit()
        return {'id':campaign_id,'mode':mode,'claimCodes':claim_codes}

    def claim_campaign(self, db, user, payload):
        exact_payload(payload,['campaignUuid','code'])
        campaign_uuid=stable_uuid(payload['campaignUuid'])
        code=re.sub(r'[\s-]','',text(payload['code'],'Код восстановления',100,True)).upper()
        now=int(time.time()); key=f'campaign-claim:{user["id"]}'
        db.execute('DELETE FROM attempts WHERE started<?',(now-900,))
        attempt=db.execute('SELECT count FROM attempts WHERE key=?',(key,)).fetchone()
        if attempt and attempt['count']>=20:
            raise APIError(429,'Слишком много попыток восстановления. Попробуй через 15 минут.')
        db.execute('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',(key,now))
        db.commit()
        db.execute('BEGIN IMMEDIATE')
        binding=db.execute('''SELECT o.*,c.gm_id FROM campaign_portable_owners o JOIN campaign_portability p ON p.campaign_id=o.campaign_id
            JOIN campaigns c ON c.id=o.campaign_id WHERE p.uuid=? AND o.claim_hash=? AND o.user_id IS NULL''',
            (campaign_uuid,hashlib.sha256(code.encode()).hexdigest())).fetchone()
        if not binding:
            raise APIError(404,'Код не найден, уже использован или относится к другой кампании.')
        rows=list(db.execute('''SELECT c.id,c.owner_id,cc.status FROM character_portability cp JOIN characters c ON c.id=cp.character_id
            JOIN campaign_characters cc ON cc.character_id=c.id WHERE cc.campaign_id=? AND cp.owner_key=?''',
            (binding['campaign_id'],binding['owner_key'])))
        # The importing GM may have handed the campaign to another member before every
        # player claims their sheets. The unclaimed binding is authoritative; this
        # locked transaction preserves the exact existing rows until reassignment.
        db.execute('UPDATE campaign_portable_owners SET user_id=?,claim_hash=NULL WHERE campaign_id=? AND owner_key=?',
                   (user['id'],binding['campaign_id'],binding['owner_key']))
        for row in rows:
            # A recovered sheet belongs to a new local account. Any temporary
            # grants chosen by its importing owner must not carry across consent.
            db.execute('DELETE FROM character_sharing WHERE character_id=?', (row['id'],))
            db.execute('UPDATE characters SET owner_id=?,version=version+1,updated=? WHERE id=?',(user['id'],now,row['id']))
        if binding['member']==1 or any(row['status'] in ['active','reserve'] for row in rows):
            db.execute('INSERT OR IGNORE INTO campaign_members VALUES(?,?)',(binding['campaign_id'],user['id']))
        self.bump_campaign(db,binding['campaign_id'])
        db.execute('DELETE FROM attempts WHERE key=?',(key,))
        db.commit()
        return {'ok':True,'id':binding['campaign_id'],'characterIds':[row['id'] for row in rows]}

    def portability_api(self, db, user, path, method, payload):
        export=re.fullmatch(r'/api/campaigns/(\d+)/export',path)
        if export and method=='GET':
            db.execute('BEGIN IMMEDIATE')
            state=self.capture_campaign(db,user,int(export[1]))
            ancestors=list(dict.fromkeys(state['archive']['ancestors']+[state['archive']['fingerprint']]))[-128:]
            db.execute('UPDATE campaign_portability SET ancestors=?,updated=? WHERE campaign_id=?',
                       (json.dumps(ancestors),int(time.time()),state['campaign']['id']))
            db.commit()
            return self.respond(200,state['archive'])
        if path=='/api/campaigns/import/preview' and method=='POST':
            exact_payload(payload,['archive'])
            archive=validate_archive(payload['archive'])
            db.execute('BEGIN IMMEDIATE')
            current,mode,conflicts=self.transfer_plan(db,user,archive)
            token=secrets.token_hex(20).upper(); now=int(time.time())
            db.execute('DELETE FROM campaign_transfer_previews WHERE expires<=?',(now,))
            db.execute('INSERT INTO campaign_transfer_previews VALUES(?,?,?,?,?,?,?)',
                (hashlib.sha256(token.encode()).hexdigest(),user['id'],archive['campaignUuid'],archive['fingerprint'],
                 current['campaign']['id'] if current else None,current['archive']['fingerprint'] if current else None,now+900))
            db.commit()
            owners=[dict(o,characters=[s['data']['name'] for s in archive['content']['characters'] if s['ownerKey']==o['key']])
                for o in archive['content']['owners'] if o['key'] in archive['content']['members'] or any(s['ownerKey']==o['key'] for s in archive['content']['characters'])]
            return self.respond(200,{'token':token,'campaignId':current['campaign']['id'] if current else None,'mode':mode,
                'name':archive['content']['campaign']['name'],'characters':len(archive['content']['characters']),'owners':owners,
                'atlasMarkers':len(archive['content'].get('atlas',{}).get('markers',[])),
                'conflicts':conflicts,'sourceFingerprint':archive['fingerprint'],
                'destinationFingerprint':current['archive']['fingerprint'] if current else None})
        if path=='/api/campaigns/import' and method=='POST':
            exact_payload(payload,['archive','token'])
            archive=validate_archive(payload['archive'])
            return self.respond(200,self.apply_archive(db,user,archive,text(payload['token'],'Предпросмотр',100,True)))
        if path=='/api/campaigns/claim' and method=='POST':
            return self.respond(200,self.claim_campaign(db,user,payload))
        reissue=re.fullmatch(r'/api/campaigns/(\d+)/portable/reissue-claims',path)
        if reissue and method=='POST':
            exact_payload(payload,['version'])
            version=campaign_version(payload['version'])
            campaign_id=int(reissue[1])
            db.execute('BEGIN IMMEDIATE')
            campaign=db.execute('SELECT * FROM campaigns WHERE id=? AND gm_id=?',(campaign_id,user['id'])).fetchone()
            if not campaign:
                raise APIError(403,'Коды восстановления доступны только текущему ведущему кампании.')
            if campaign['version']!=version:
                raise APIError(409,'Кампания уже изменилась. Обнови данные перед перевыпуском кодов.')
            gm_key=self.portability_user(db,user['id'])
            db.execute("INSERT OR IGNORE INTO campaign_portability VALUES(?,?,?,'[]',?)",
                       (campaign_id,str(uuid.uuid4()),gm_key,int(time.time())))
            portable=db.execute('SELECT uuid FROM campaign_portability WHERE campaign_id=?',(campaign_id,)).fetchone()
            owners=list(db.execute('''SELECT o.* FROM campaign_portable_owners o WHERE o.campaign_id=? AND o.user_id IS NULL
                AND (o.member=1 OR EXISTS(SELECT 1 FROM character_portability cp JOIN campaign_characters cc
                    ON cc.character_id=cp.character_id WHERE cc.campaign_id=o.campaign_id AND cp.owner_key=o.owner_key))
                ORDER BY o.owner_key''',(campaign_id,)))
            claim_codes=[]
            for owner in owners:
                code=secrets.token_hex(20).upper()
                changed=db.execute('''UPDATE campaign_portable_owners SET claim_hash=? WHERE campaign_id=? AND owner_key=?
                    AND user_id IS NULL AND claim_hash IS ?''',
                    (hashlib.sha256(code.encode()).hexdigest(),campaign_id,owner['owner_key'],owner['claim_hash']))
                if changed.rowcount!=1:
                    raise APIError(409,'Владелец уже восстановил доступ. Обнови данные кампании.')
                characters=[json.loads(r['data']).get('name','Персонаж') for r in db.execute('''SELECT c.data FROM characters c
                    JOIN character_portability cp ON cp.character_id=c.id JOIN campaign_characters cc ON cc.character_id=c.id
                    WHERE cc.campaign_id=? AND cp.owner_key=? ORDER BY c.id''',(campaign_id,owner['owner_key']))]
                claim_codes.append({'ownerKey':owner['owner_key'],'label':owner['label'],'code':code,'characters':characters})
            if owners:
                changed=db.execute('UPDATE campaigns SET version=version+1,updated=? WHERE id=? AND gm_id=? AND version=?',
                                   (int(time.time()),campaign_id,user['id'],version))
                if changed.rowcount!=1:
                    raise APIError(409,'Кампания уже изменилась. Обнови данные перед перевыпуском кодов.')
                version+=1
            db.commit()
            return self.respond(200,{'id':campaign_id,'campaignUuid':portable['uuid'],'version':version,'claimCodes':claim_codes})
        backup=re.fullmatch(r'/api/campaigns/(\d+)/backups(?:/([a-fA-F0-9-]+))?',path)
        if backup and method=='GET':
            campaign_id=int(backup[1])
            if not db.execute('SELECT 1 FROM campaigns WHERE id=? AND gm_id=?',(campaign_id,user['id'])).fetchone():
                raise APIError(403,'Резервные копии доступны только ведущему.')
            if backup[2]:
                row=db.execute('SELECT data FROM campaign_transfer_backups WHERE id=? AND campaign_id=?',(stable_uuid(backup[2]),campaign_id)).fetchone()
                if not row:
                    raise APIError(404,'Резервная копия не найдена.')
                return self.respond(200,json.loads(row['data']))
            rows=list(db.execute('SELECT id,created,data FROM campaign_transfer_backups WHERE campaign_id=? ORDER BY created DESC,id DESC LIMIT 10',(campaign_id,)))
            return self.respond(200,[{'id':r['id'],'created':r['created'],'name':json.loads(r['data'])['content']['campaign']['name'],
                                      'fingerprint':json.loads(r['data'])['fingerprint']} for r in rows])
        return False

    def authentication_attempt(self, db, key):
        now = int(time.time())
        db.execute('DELETE FROM attempts WHERE started<?', (now - 900,))
        row = db.execute('SELECT count FROM attempts WHERE key=?', (key,)).fetchone()
        if row and row['count'] >= 8:
            raise APIError(429, 'Слишком много попыток. Попробуй через 15 минут.')
        db.execute('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', (key, now))
        db.commit()
        return now

    def issue_session(self, db, account_id, now):
        db.execute('DELETE FROM sessions WHERE expires<?', (now,))
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        db.execute('INSERT INTO sessions VALUES(?,?,?,?)',
                   (hashlib.sha256(token.encode()).hexdigest(), account_id, csrf, now + SESSION_SECONDS))
        db.commit()
        return token

    def campaign_api(self, db, user, path, method, payload):
        atlas_match = re.fullmatch(r'/api/campaigns/(\d+)/atlas(?:/markers(?:/([a-fA-F0-9-]{36}))?)?', path)
        if atlas_match:
            atlas = crew_atlas.api(self, db, user, int(atlas_match[1]), method, payload,
                marker_id=atlas_match[2], markers='/markers' in path,
                player_view='player' in parse_qs(urlsplit(self.path).query).get('view', []))
            # Bind device-local notes to the identity that authorized this exact response.
            # This is ordinary own-account metadata; never expose CSRF/session credentials.
            atlas['viewer'] = {'id': user['id'], 'username': user['username']}
            return self.respond(200, atlas)
        battle_match = re.fullmatch(r'/api/campaigns/(\d+)/battle(/training)?(/commands|/preview)?', path)
        if battle_match:
            return self.respond(200, shared_battle.api(self, db, user, int(battle_match[1]), method,
                                                      payload, battle_match[3] == '/commands', training=bool(battle_match[2]), preview=battle_match[3] == '/preview', viewer_actor_id=(parse_qs(urlsplit(self.path).query,keep_blank_values=True).get('viewerActorId') or [None])[0]))
        portable=self.portability_api(db,user,path,method,payload)
        if portable is not False:
            return portable
        workspace_match = re.fullmatch(r'/api/campaigns/(\d+)/workspace', path)
        if workspace_match:
            return self.workspace_api(db, user, int(workspace_match[1]), method, payload)
        if path == '/api/campaigns':
            if method == 'GET':
                rows = db.execute('''SELECT p.id,p.name,p.description,p.gm_id,u.username AS gm,
                    p.version,p.updated,p.transfer_to,
                    EXISTS(SELECT 1 FROM campaign_members m WHERE m.campaign_id=p.id AND m.user_id=?) AS is_member
                    FROM campaigns p JOIN users u ON u.id=p.gm_id
                    WHERE p.gm_id=? OR p.transfer_to=?
                    OR EXISTS(SELECT 1 FROM campaign_members m WHERE m.campaign_id=p.id AND m.user_id=?)
                    OR EXISTS(SELECT 1 FROM campaign_characters cc JOIN characters c ON c.id=cc.character_id
                              WHERE cc.campaign_id=p.id AND c.owner_id=?) ORDER BY p.id''',
                    (user['id'],) * 5)
                return self.respond(200, [campaign_summary(row, user['id']) for row in rows])
            if method == 'POST':
                exact_payload(payload, ['name', 'description'])
                name = text(payload.get('name'), 'Название кампании', 100, True)
                description = text(payload.get('description'), 'Описание кампании', 3000)
                cur = db.execute('''INSERT INTO campaigns(gm_id,name,description,invite_code,updated)
                                    VALUES(?,?,?,?,?)''',
                                 (user['id'], name, description, secrets.token_hex(10).upper(), int(time.time())))
                db.commit()
                return self.respond(201, {'id': cur.lastrowid})
        if path == '/api/campaigns/join' and method == 'POST':
            exact_payload(payload, ['code', 'character_id'])
            code = re.sub(r'[\s-]', '', text(payload.get('code'), 'Код приглашения', 80, True)).upper()
            cid = number(payload.get('character_id'), 'Персонаж', 1, 10**9)
            db.execute('BEGIN IMMEDIATE')
            self.character(db, user, cid, own=True)
            campaign = db.execute('SELECT id,name FROM campaigns WHERE invite_code=?', (code,)).fetchone()
            if not re.fullmatch(r'[A-F0-9]{20}', code) or not campaign:
                raise APIError(404, 'Приглашение не найдено. Проверь код у ведущего.')
            try:
                db.execute('INSERT INTO campaign_characters VALUES(?,?,?,?)',
                           (campaign['id'], cid, 'pending', int(time.time())))
            except sqlite3.IntegrityError:
                raise APIError(409, 'Этот персонаж уже подал заявку или участвует в кампании.')
            version = self.bump_campaign(db, campaign['id'])
            db.commit()
            return self.respond(201, {'id': campaign['id'], 'name': campaign['name'], 'version': version})
        match = re.fullmatch(r'/api/campaigns/(\d+)(/roster|/withdraw|/invite|/transfer|/transfer/accept)?', path)
        if not match:
            raise APIError(404, 'Страница не найдена.')
        campaign_id, action = int(match[1]), match[2]
        if not action and method == 'GET':
            row = self.campaign(db, user, campaign_id)
            gm = row['gm_id'] == user['id']
            out = campaign_summary(row, user['id'])
            roster = db.execute('''SELECT c.id AS character_id,c.owner_id,c.data,u.username AS owner,cc.status
                FROM campaign_characters cc JOIN characters c ON c.id=cc.character_id
                JOIN users u ON u.id=c.owner_id WHERE cc.campaign_id=?
                AND (? OR c.owner_id=? OR (? AND cc.status IN ('active','reserve')))
                ORDER BY c.id''', (campaign_id, gm, user['id'], row['is_member']))
            accepted_viewer = bool(db.execute('''SELECT 1 FROM campaign_characters cc JOIN characters c ON c.id=cc.character_id
                WHERE cc.campaign_id=? AND c.owner_id=? AND cc.status IN ('active','reserve') LIMIT 1''',
                (campaign_id, user['id'])).fetchone())
            out['roster'] = []
            for r in roster:
                data = json.loads(r['data'])
                character_row = {'id': r['character_id'], 'owner_id': r['owner_id']}
                entry = {'character_id': r['character_id'], 'owner_id': r['owner_id'], 'owner': r['owner'],
                    'name': data.get('name', ''), 'role': data.get('role', ''), 'status': r['status'],
                    'can_open': character_permission(db, user['id'], character_row)}
                if gm or r['owner_id'] == user['id'] or (accepted_viewer and r['status'] in ['active', 'reserve']):
                    entry['exterior'] = character_exterior(r['character_id'], data)
                out['roster'].append(entry)
            if gm:
                out.update({key: row[key] for key in ['invite_code', 'gm_notes', 'ledger']})
                out['members'] = [dict(r) for r in db.execute('''SELECT u.id,u.username FROM campaign_members m
                    JOIN users u ON u.id=m.user_id WHERE m.campaign_id=? ORDER BY u.id''', (campaign_id,))]
            return self.respond(200, out)
        if not action and method == 'PUT':
            exact_payload(payload, ['version', 'name', 'description', 'gm_notes', 'ledger'])
            version = campaign_version(payload.get('version'))
            fields = [text(payload.get(key), label, limit, required) for key, label, limit, required in [
                ('name', 'Название кампании', 100, True), ('description', 'Описание кампании', 3000, False),
                ('gm_notes', 'Записи ведущего', 24000, False), ('ledger', 'Учёт кампании', 16000, False)]]
            self.versioned_campaign(db, user, campaign_id, version)
            db.execute('UPDATE campaigns SET name=?,description=?,gm_notes=?,ledger=? WHERE id=?', fields + [campaign_id])
            version = self.bump_campaign(db, campaign_id)
            db.commit()
            return self.respond(200, {'ok': True, 'version': version})
        if action == '/roster' and method == 'POST':
            exact_payload(payload, ['version', 'character_id', 'status'])
            version = campaign_version(payload.get('version'))
            cid = number(payload.get('character_id'), 'Персонаж', 1, 10**9)
            status = payload.get('status')
            if status not in ['active', 'reserve', 'remove']:
                raise APIError(400, 'Проверь статус персонажа в кампании.')
            self.versioned_campaign(db, user, campaign_id, version)
            linked = db.execute('''SELECT c.owner_id FROM campaign_characters cc
                JOIN characters c ON c.id=cc.character_id WHERE cc.campaign_id=? AND cc.character_id=?''',
                (campaign_id, cid)).fetchone()
            if not linked:
                raise APIError(404, 'Персонаж не найден в кампании.')
            if status == 'remove':
                db.execute('DELETE FROM campaign_characters WHERE campaign_id=? AND character_id=?', (campaign_id, cid))
            else:
                db.execute('UPDATE campaign_characters SET status=? WHERE campaign_id=? AND character_id=?',
                           (status, campaign_id, cid))
                db.execute('INSERT OR IGNORE INTO campaign_members VALUES(?,?)', (campaign_id, linked['owner_id']))
            version = self.bump_campaign(db, campaign_id)
            db.commit()
            return self.respond(200, {'ok': True, 'version': version})
        if action == '/withdraw' and method == 'POST':
            exact_payload(payload, ['character_id'])
            cid = number(payload.get('character_id'), 'Персонаж', 1, 10**9)
            db.execute('BEGIN IMMEDIATE')
            self.character(db, user, cid, own=True)
            self.campaign(db, user, campaign_id)
            if db.execute('DELETE FROM campaign_characters WHERE campaign_id=? AND character_id=?',
                          (campaign_id, cid)).rowcount != 1:
                raise APIError(404, 'Персонаж не найден в кампании.')
            version = self.bump_campaign(db, campaign_id)
            db.commit()
            return self.respond(200, {'ok': True, 'version': version})
        if action == '/invite' and method == 'POST':
            exact_payload(payload, ['version'])
            self.versioned_campaign(db, user, campaign_id, campaign_version(payload.get('version')))
            code = secrets.token_hex(10).upper()
            db.execute('UPDATE campaigns SET invite_code=? WHERE id=?', (code, campaign_id))
            version = self.bump_campaign(db, campaign_id)
            db.commit()
            return self.respond(200, {'ok': True, 'version': version, 'invite_code': code})
        if action == '/transfer' and method == 'POST':
            exact_payload(payload, ['version', 'user_id'])
            version = campaign_version(payload.get('version'))
            target = payload.get('user_id')
            if target is not None:
                target = number(target, 'Новый ведущий', 1, 10**9)
            self.versioned_campaign(db, user, campaign_id, version)
            if target is not None and (target == user['id'] or not db.execute(
                    'SELECT 1 FROM campaign_members WHERE campaign_id=? AND user_id=?', (campaign_id, target)).fetchone()):
                raise APIError(400, 'Выбери другого участника кампании.')
            db.execute('UPDATE campaigns SET transfer_to=? WHERE id=?', (target, campaign_id))
            version = self.bump_campaign(db, campaign_id)
            db.commit()
            return self.respond(200, {'ok': True, 'version': version})
        if action == '/transfer/accept' and method == 'POST':
            exact_payload(payload, ['version'])
            row = self.versioned_campaign(db, user, campaign_id, campaign_version(payload.get('version')), gm=False)
            if row['transfer_to'] != user['id'] or not row['is_member']:
                raise APIError(404, 'Предложение передачи кампании не найдено.')
            db.execute('INSERT OR IGNORE INTO campaign_members VALUES(?,?)', (campaign_id, row['gm_id']))
            db.execute('UPDATE campaigns SET gm_id=?,transfer_to=NULL WHERE id=?', (user['id'], campaign_id))
            version = self.bump_campaign(db, campaign_id)
            db.commit()
            return self.respond(200, {'ok': True, 'version': version})
        raise APIError(404, 'Страница не найдена.')

    def cookie(self, token='', age=SESSION_SECONDS):
        return f'{COOKIE}={token}; Path=/; Max-Age={age}; HttpOnly; SameSite=Strict' + ('; Secure' if SECURE else '')

    def do_GET(self):
        self.handle_request('GET')

    def do_POST(self):
        self.handle_request('POST')

    def do_PUT(self):
        self.handle_request('PUT')

    def do_DELETE(self):
        self.handle_request('DELETE')

    def public_asset(self, path):
        """Resolve only declared frontend resources, without crossing static/ boundaries."""
        decoded = unquote(path)
        relative = 'index.html' if decoded == '/' else decoded.removeprefix('/')
        candidate = Path(relative)
        if ('\x00' in relative or '\\' in relative or candidate.is_absolute()
                or '..' in candidate.parts):
            raise APIError(404, 'Файл не найден.')
        if not candidate.parts:
            return None
        directory = candidate.parts[0]
        if len(candidate.parts) == 1 and candidate.suffix.lower() in PUBLIC_ROOT_TYPES:
            mime = PUBLIC_ROOT_TYPES[candidate.suffix.lower()]
            folder = ''
        elif directory in PUBLIC_ASSET_TYPES:
            if relative in PUBLIC_JSON_ASSETS:
                mime = 'application/json'
            else:
                mime = PUBLIC_ASSET_TYPES[directory].get(candidate.suffix.lower())
            if len(candidate.parts) < 2 or mime is None:
                raise APIError(404, 'Файл не найден.')
            folder = directory
        else:
            return None
        static_root = (ROOT / 'static').resolve()
        asset_root = static_root / folder
        asset = (static_root / relative).resolve()
        # Resolve symlinks before containment checks; a public-looking suffix alone
        # must never publish a backup, host database, or file outside its asset folder.
        if (any((static_root / Path(*candidate.parts[:count])).is_symlink()
                for count in range(1, len(candidate.parts) + 1))
                or not asset.is_relative_to(asset_root) or not asset.is_relative_to(static_root)
                or not asset.is_file()):
            raise APIError(404, 'Файл не найден.')
        return asset, mime

    def handle_request(self, method):
        try:
            path = urlsplit(self.path).path
            if method == 'GET':
                asset = self.public_asset(path)
                if asset is not None:
                    file, mime = asset
                    return self.respond(200, file.read_bytes(), mime)
            with connect() as db:
                if method != 'GET':
                    self.same_origin()
                    if self.headers.get('X-Client-API') is not None and self.headers['X-Client-API']!=str(API_VERSION):
                        raise APIError(409,'Версия клиента несовместима. Обновите приложение.')
                    payload = self.body()
                if path == '/api/version' and method == 'GET':
                    return self.respond(200, {'version':APP_VERSION,'apiVersion':API_VERSION})
                if path in ['/api/login', '/api/register'] and method == 'POST':
                    username = text(payload.get('username', ''), 'Логин', 40, True)
                    password = password_value(payload.get('password'))
                    selected_mode = mode_value(payload['mode']) if 'mode' in payload else 'player'
                    registration = path == '/api/register'
                    # An IP-only registration bucket cannot be evaded by rotating usernames.
                    bucket = 'register:' + self.client_address[0] if registration else self.client_address[0] + ':' + username.lower()
                    key = hashlib.sha256(bucket.encode()).hexdigest()
                    now = self.authentication_attempt(db, key)
                    if registration:
                        if not re.fullmatch(r'[A-Za-z0-9_.-]{3,40}', username) or len(password) < 12:
                            raise APIError(400, 'Логин: 3–40 латинских букв, цифр, _, -, .; пароль: от 12 символов.')
                        try:
                            cur = db.execute('INSERT INTO users(username,password,role) VALUES(?,?,?)',
                                             (username, password_hash(password), 'player'))
                        except sqlite3.IntegrityError:
                            raise APIError(409, 'Такой логин уже существует.')
                        account_id = cur.lastrowid
                        db.execute('INSERT INTO user_modes VALUES(?,?)', (account_id, selected_mode))
                    else:
                        account = db.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
                        encoded = account['password'] if account else self.server.dummy_hash
                        if not check_password(password, encoded) or not account:
                            raise APIError(401, 'Неверный логин или пароль.')
                        account_id = account['id']
                        db.execute('DELETE FROM attempts WHERE key=?', (key,))
                        if 'mode' in payload:
                            db.execute('INSERT INTO user_modes VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode',
                                       (account_id, selected_mode))
                    token = self.issue_session(db, account_id, now)
                    return self.respond(201 if registration else 200, {'ok': True}, cookie=self.cookie(token))
                user = self.session(db, method != 'GET')
                if path == '/api/battles/active':
                    if method != 'GET':
                        raise APIError(405, 'Команда не поддерживается.')
                    return self.respond(200, shared_battle.active_battles(db, user))
                if path == '/api/sync' and method == 'GET':
                    return self.respond(200, self.sync_response(db, user))
                if path == '/api/campaigns' or path.startswith('/api/campaigns/'):
                    return self.campaign_api(db, user, path, method, payload if method != 'GET' else None)
                if path == '/api/me' and method == 'GET':
                    return self.respond(200, {k: user[k] for k in ['id', 'username', 'role', 'csrf']} | {'admin': user['id'] == 1})
                if path == '/api/mode' and method == 'POST':
                    exact_payload(payload, ['mode'])
                    mode = mode_value(payload.get('mode'))
                    db.execute('INSERT INTO user_modes VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode',
                               (user['id'], mode))
                    db.commit()
                    return self.respond(200, {'mode': mode})
                if path == '/api/settings':
                    if method == 'GET':
                        row = db.execute('SELECT data FROM player_settings WHERE user_id=?', (user['id'],)).fetchone()
                        return self.respond(200, player_settings(json.loads(row['data']) if row else None))
                    if method == 'PUT':
                        row = db.execute('SELECT data FROM player_settings WHERE user_id=?', (user['id'],)).fetchone()
                        settings = validate_player_settings(payload, json.loads(row['data']) if row else None)
                        db.execute('''INSERT INTO player_settings(user_id,data,updated) VALUES(?,?,?)
                                      ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated=excluded.updated''',
                                   (user['id'], json.dumps(settings), int(time.time())))
                        db.commit()
                        return self.respond(200, settings)
                if path == '/api/logout' and method == 'POST':
                    db.execute('DELETE FROM sessions WHERE token=?', (user['token'],))
                    db.commit()
                    return self.respond(200, {'ok': True}, cookie=self.cookie(age=0))
                if path == '/api/password' and method == 'POST':
                    old = password_value(payload.get('old'))
                    new = password_value(payload.get('new'))
                    account = db.execute('SELECT password FROM users WHERE id=?', (user['id'],)).fetchone()
                    if not check_password(old, account['password']) or len(new) < 12:
                        raise APIError(400, 'Проверь текущий пароль. Новый пароль — от 12 символов.')
                    db.execute('UPDATE users SET password=? WHERE id=?', (password_hash(new), user['id']))
                    db.execute('DELETE FROM sessions WHERE user_id=? AND token!=?', (user['id'], user['token']))
                    db.commit()
                    return self.respond(200, {'ok': True})
                if path == '/api/users':
                    if user['id'] != 1:
                        raise APIError(403, 'Доступ только для администратора сервера.')
                    if method == 'GET':
                        return self.respond(200, [dict(r) for r in db.execute("SELECT u.id,u.username,COALESCE(m.mode,u.role) AS role FROM users u LEFT JOIN user_modes m ON m.user_id=u.id ORDER BY u.id")])
                    if method == 'POST':
                        username = text(payload.get('username', ''), 'Логин', 40, True)
                        password = password_value(payload.get('password'))
                        if not re.fullmatch(r'[A-Za-z0-9_.-]{3,40}', username) or len(password) < 12:
                            raise APIError(400, 'Логин: 3–40 латинских букв, цифр, _, -, .; пароль: от 12 символов.')
                        try:
                            db.execute('INSERT INTO users(username,password,role) VALUES(?,?,?)',
                                       (username, password_hash(password), 'player'))
                        except sqlite3.IntegrityError:
                            raise APIError(409, 'Такой логин уже существует.')
                        db.commit()
                        return self.respond(201, {'ok': True})
                match = re.fullmatch(r'/api/users/(\d+)/password', path)
                if match and method == 'POST':
                    if user['id'] != 1:
                        raise APIError(403, 'Доступ только для администратора сервера.')
                    target = int(match[1])
                    new = password_value(payload.get('password'))
                    if target == user['id'] or len(new) < 12:
                        raise APIError(400, 'Для своего аккаунта используй смену пароля; новый пароль — от 12 символов.')
                    changed = db.execute('UPDATE users SET password=? WHERE id=?', (password_hash(new), target))
                    if changed.rowcount != 1:
                        raise APIError(404, 'Игрок не найден.')
                    db.execute('DELETE FROM sessions WHERE user_id=?', (target,))
                    db.commit()
                    return self.respond(200, {'ok': True})
                if path == '/api/characters':
                    if method == 'GET':
                        rows = db.execute('SELECT c.*,u.username FROM characters c JOIN users u ON u.id=c.owner_id ORDER BY c.id')
                        return self.respond(200, [character_view(db, user['id'], r, r['username']) for r in rows
                                                  if character_permission(db, user['id'], r)])
                    if method == 'POST':
                        owner = user['id']
                        data = validate_character(payload.get('data'))
                        now = int(time.time())
                        encoded = json.dumps(data, ensure_ascii=False)
                        cur = db.execute('INSERT INTO characters(owner_id,data,updated) VALUES(?,?,?)', (owner, encoded, now))
                        cid = cur.lastrowid
                        db.execute('INSERT INTO revisions(character_id,actor_id,data,version,reason,created) VALUES(?,?,?,?,?,?)',
                                   (cid, user['id'], encoded, 1, 'Создание персонажа', now))
                        db.commit()
                        return self.respond(201, {'id': cid, 'version': 1})
                access_match = re.fullmatch(r'/api/characters/(\d+)/access', path)
                if access_match:
                    return self.character_access_api(db, user, int(access_match[1]), method,
                                                     payload if method != 'GET' else None)
                match = re.fullmatch(r'/api/characters/(\d+)(/history)?', path)
                if match:
                    cid = int(match[1])
                    row = self.character(db, user, cid)
                    if not match[2] and method == 'GET':
                        return self.respond(200, character_view(db, user['id'], row))
                    if not match[2] and method == 'DELETE':
                        self.character(db, user, cid, own=True)
                        if set(payload) != {'version'} or type(payload.get('version')) is not int or payload['version'] <= 0:
                            raise APIError(400, 'Для удаления нужна текущая версия листа: положительное целое число.')
                        version = payload['version']
                        # Lock writers before rechecking access and version. This also prevents a save
                        # from racing between history cleanup and removal of the character itself.
                        db.execute('BEGIN IMMEDIATE')
                        row = self.character(db, user, cid, own=True)
                        if row['version'] != version:
                            raise APIError(409, 'Лист уже изменён с другого устройства. Обнови лист перед удалением.')
                        db.execute('''UPDATE campaigns SET version=version+1,updated=? WHERE id IN
                                      (SELECT campaign_id FROM campaign_characters WHERE character_id=?)''',
                                   (int(time.time()), cid))
                        db.execute('''DELETE FROM revisions WHERE character_id=? AND EXISTS
                                      (SELECT 1 FROM characters WHERE id=? AND version=?)''',
                                   (cid, cid, version))
                        removed = db.execute('DELETE FROM characters WHERE id=? AND version=?', (cid, version))
                        if removed.rowcount != 1:
                            raise APIError(409, 'Лист уже изменён с другого устройства. Обнови лист перед удалением.')
                        db.commit()
                        return self.respond(200, {'ok': True})
                    if match[2] and method == 'GET':
                        if not character_management(db, user['id'], row):
                            raise APIError(403, 'История изменений доступна владельцу и ведущему кампании.')
                        rows = db.execute('''SELECT r.version,r.reason,r.created,COALESCE(l.actor_label,u.username) AS username FROM revisions r
                                  JOIN users u ON u.id=r.actor_id LEFT JOIN imported_revision_labels l ON l.revision_id=r.id
                                  WHERE character_id=? ORDER BY r.id DESC LIMIT 50''', (cid,))
                        return self.respond(200, [dict(r) for r in rows])
                    if not match[2] and method == 'PUT':
                        self.character(db, user, cid, edit=True)
                        version = number(payload.get('version'), 'Версия', 1, 10**9)
                        data = validate_character(payload.get('data'))
                        reason = text(payload.get('reason', ''), 'Описание изменения', 180) or 'Лист обновлён'
                        encoded = json.dumps(data, ensure_ascii=False)
                        now = int(time.time())
                        db.execute('BEGIN IMMEDIATE')
                        self.character(db, user, cid, edit=True)
                        cur = db.execute('UPDATE characters SET data=?,version=version+1,updated=? WHERE id=? AND version=?',
                                         (encoded, now, cid, version))
                        if cur.rowcount != 1:
                            raise APIError(409, 'Лист уже изменён с другого устройства. Скачай свой черновик, затем загрузи свежую версию.')
                        db.execute('INSERT INTO revisions(character_id,actor_id,data,version,reason,created) VALUES(?,?,?,?,?,?)',
                                   (cid, user['id'], encoded, version + 1, reason, now))
                        db.commit()
                        return self.respond(200, {'id': cid, 'version': version + 1, 'updated': now})
                raise APIError(404, 'Страница не найдена.')
        except (APIError, shared_battle.BattleError, crew_atlas.AtlasError) as e:
            self.respond(e.status, {'error': e.message})
        except (sqlite3.Error, OSError):
            self.log_error('Storage unavailable')
            self.respond(503, {'error': 'Не удалось прочитать или сохранить данные. Черновик остаётся на экране. Попробуй ещё раз.'})
        except Exception:
            self.log_error('Unexpected application error')
            self.respond(500, {'error': 'Ошибка приложения. Черновик остаётся на экране.'})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default=os.getenv('HOST', '127.0.0.1'))
    parser.add_argument('--port', type=int, default=int(os.getenv('PORT', '8080')))
    parser.add_argument('--backup', nargs='?', const='', help='Create consistent database backup, optionally at this new file path')
    args = parser.parse_args()
    if ORIGIN and (urlsplit(ORIGIN).scheme not in ('http', 'https') or not urlsplit(ORIGIN).netloc
                   or urlsplit(ORIGIN).path not in ('', '/')):
        raise SystemExit('PUBLIC_ORIGIN должен иметь вид https://example.com без пути.')
    if args.backup is not None:
        try:
            print(backup_database(args.backup or None))
        except APIError as error:
            raise SystemExit(error.message)
        raise SystemExit(0)
    initialize()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.dummy_hash = password_hash(secrets.token_urlsafe(32))
    print(f'Night City Tracker listening on {args.host}:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
