/* Crew campaign adapter. Auth and membership are exclusively server-owned.
 * Drafts and secrets stay in memory, never local/session storage or messages.
 * Load this in Crew instead of campaign.js; standalone campaign.js is unchanged.
 */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  if (params.get('crew') !== '1') return;
  const api = window.NightCityAtlas;
  if (!api || window.NC_CREW_CAMPAIGN) return;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const campaignId = Number(params.get('campaignId'));
  const validId = /^[1-9]\d*$/.test(params.get('campaignId') || '') && Number.isSafeInteger(campaignId);
  const base = '/api/campaigns/' + campaignId + '/atlas';
  const rawOpen = api.openModal.bind(api);
  const rawClose = () => { $('modal').close?.(); $('modal').removeAttribute('open'); };
  const kinds = {location:'Место',mission:'Задание',danger:'Опасность',home:'База',contact:'Контакт'};
  const subscribers = new Set();
  let campaign = null, confirmedGM = false, loading = false, busy = false;
  let editor = null, placing = false, placementSeed = null, moveStart = null;
  let ownedModal = '', openedMarkerId = null, error = '', generation = 0, readController = null, disposed = false;
  let desiredView = params.get('mode') === 'gm' ? 'gm' : 'player';
  let internalMode = false, lastState = '', hashOpened = false;

  const mapId = state => state.map === 'sector' ? 'sector:' + state.plan : state.map === 'synthesis' ? 'city2020' : state.map === 'legacyv4' ? 'synthesis' : state.map;
  const clone = value => JSON.parse(JSON.stringify(value));
  const canEdit = () => !!campaign?.canManage && confirmedGM && desiredView === 'gm';
  const dirty = () => !!editor && (!editor.markerId || JSON.stringify(editor.draft) !== editor.baseline || !!editor.command);
  const getState = () => ({dirty:dirty() || !!api.hasUnsavedLocalNotes?.(), busy:busy || loading});
  function publish() {
    const state = getState(), serialized = JSON.stringify(state);
    if (serialized === lastState) return;
    lastState = serialized;
    for (const fn of subscribers) fn(state);
    window.dispatchEvent(new CustomEvent('nc-atlas:campaign-state', {detail:state}));
  }
  function open(title, html, owner = '') { ownedModal = owner; if (owner !== 'marker') openedMarkerId = null; rawOpen(title, html); }
  function close() { ownedModal = ''; openedMarkerId = null; rawClose(); $('modal-body').replaceChildren(); $('modal-title').textContent = ''; }
  function setMode(master) {
    if (api.getContext().master === master) return;
    internalMode = true;
    try { if (api.setMode) api.setMode(master); else $('view-mode')?.click(); }
    finally { internalMode = false; }
  }
  function update() {
    api.setLocalNotesScope?.(canEdit() && campaign?.viewer ? {userId:campaign.viewer.id,username:campaign.viewer.username,campaignId} : null);
    window.NC_CAMPAIGN.locked = !confirmedGM;
    if ($('add-marker')) $('add-marker').hidden = !canEdit();
    if ($('view-mode')) $('view-mode').hidden = !confirmedGM;
    if ($('campaign-status')) {
      $('campaign-status').hidden = false;
      $('campaign-status').textContent = campaign
        ? `${campaign.name} · ${canEdit() ? 'ГМ' : 'игрок'} · ${campaign.markers.length} меток${error ? ' · обновление недоступно' : ''}`
        : loading ? 'Подключаю карту кампании…' : error || 'Карта кампании недоступна';
    }
    api.refresh(); publish();
  }
  function cancelPlacement({restore = true} = {}) {
    if (!placing) return false;
    placing = false; placementSeed = null;
    $('placement-hint').hidden = true; $('map').classList.remove('placing');
    if (editor && moveStart) editor.draft = {...editor.draft, ...moveStart};
    moveStart = null;
    if (restore && editor) renderEditor();
    publish(); return true;
  }
  function clearPrivate(reason) {
    generation++; readController?.abort(); readController = null;
    campaign = null; confirmedGM = false; editor = null; loading = false;
    cancelPlacement({restore:false});
    // A private marker may be open in a detail dialog when access is revoked.
    if (ownedModal) close();
    window.NC_CAMPAIGN.locked = true;
    desiredView = 'player'; setMode(false);
    error = reason; update();
  }
  class RequestError extends Error {
    constructor(message, status = 0, uncertain = false) { super(message); this.status = status; this.uncertain = uncertain; }
  }
  async function request(path, {method = 'GET', body, signal, view = desiredView, viewerId, viewerUsername} = {}) {
    const controller = new AbortController();
    const relay = () => controller.abort();
    signal?.addEventListener('abort', relay, {once:true});
    if (signal?.aborted) controller.abort();
    let timedOut = false, mutationSent = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
    try {
      const url = new URL(base + path, location.origin);
      url.searchParams.set('view', view);
      const headers = {Accept:'application/json','Content-Type':'application/json'};
      if (method !== 'GET') {
        // Crew binds CSRF to its current cookie session. Never cache or message it.
        const sessionResponse = await fetch(new URL('/api/me', location.origin).href, {credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
        let session;
        try { session = await sessionResponse.json(); }
        catch { throw new RequestError('Не удалось проверить сеанс Crew. Обнови подключение и повтори сохранение.', sessionResponse.status, false); }
        if (!sessionResponse.ok) throw new RequestError(typeof session?.error === 'string' ? session.error : 'Сеанс Crew недоступен.', sessionResponse.status);
        if (!Number.isSafeInteger(viewerId) || viewerId < 1 || session.id !== viewerId || session.username !== viewerUsername) throw new RequestError('Аккаунт Crew изменился. Прежний черновик закрыт; сохранение не отправлено. Открой карту заново в нужном аккаунте.', 403, false);
        if (typeof session.csrf !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(session.csrf)) throw new RequestError('Сервер не подтвердил защиту сеанса Crew. Сохранение не отправлено.', 0, false);
        headers['X-CSRF-Token'] = session.csrf;
        mutationSent = true;
      }
      const response = await fetch(url.href, {method, credentials:'same-origin', cache:'no-store', signal:controller.signal,
        headers,
        ...(body === undefined ? {} : {body:JSON.stringify(body)})});
      let result;
      try { result = await response.json(); }
      catch { throw new RequestError('Сервер вернул непонятный ответ. Результат сохранения не подтверждён.', response.status, method !== 'GET' && (response.ok || response.status >= 500)); }
      if (!response.ok) throw new RequestError(typeof result?.error === 'string' ? result.error : 'Не удалось выполнить запрос к кампании.', response.status, method !== 'GET' && response.status >= 500);
      return result;
    } catch (e) {
      if (e instanceof RequestError) throw e;
      if (signal?.aborted && !timedOut) throw new RequestError('Загрузка отменена.', -1);
      throw new RequestError(timedOut ? 'Сервер не ответил вовремя. Результат сохранения не подтверждён.' : 'Не удалось связаться с сервером. Проверь соединение.', 0, mutationSent);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', relay); }
  }
  function normalizeProjection(value, view) {
    if (!value || value.id !== campaignId || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.markers) || typeof value.name !== 'string' || typeof value.canManage !== 'boolean' || !['gm','player'].includes(value.role)) {
      throw new RequestError('Сервер вернул повреждённые данные карты.', 0);
    }
    const gm = view === 'gm' && value.role === 'gm' && value.canManage === true;
    const markers = value.markers.filter(m => m && (gm || m.revealed === true)).map(m => {
      if (typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.map !== 'string' || !Number.isFinite(m.x) || !Number.isFinite(m.y)) throw new RequestError('Сервер вернул повреждённую метку.', 0);
      const clean = {...m, color:/^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#f0cd66'};
      if (!gm) delete clean.secret;
      return clean;
    });
    const viewer = Number.isSafeInteger(value.viewer?.id) && value.viewer.id > 0 && typeof value.viewer.username === 'string' && value.viewer.username.length <= 120
      ? {id:value.viewer.id,username:value.viewer.username} : null;
    return {...value, viewer, canManage:gm, role:gm ? 'gm' : 'player', markers};
  }
  function accept(value, view) {
    const next = normalizeProjection(value, view);
    if (campaign && (campaign.viewer?.id !== next.viewer?.id || campaign.viewer?.username !== next.viewer?.username)) {
      editor = null; cancelPlacement({restore:false}); if (ownedModal) close();
      api.setLocalNotesScope?.(null); confirmedGM = false;
    }
    if (view === 'gm') confirmedGM = next.canManage;
    if (!next.canManage && view === 'gm') {
      editor = null; cancelPlacement({restore:false});
      if (ownedModal) close();
      desiredView = 'player'; setMode(false);
    }
    campaign = next; error = ''; update();
    if (ownedModal === 'marker' && openedMarkerId) {
      const latest = campaign.markers.find(marker => marker.id === openedMarkerId);
      if (latest) showMarker(latest); else close();
    }
  }
  async function load({showError = false, preserve = false} = {}) {
    if (!validId || disposed) return false;
    readController?.abort();
    const controller = new AbortController(); readController = controller;
    const stamp = ++generation, requestedView = desiredView;
    loading = true; update();
    try {
      const value = await request('', {signal:controller.signal, view:requestedView});
      if (disposed || stamp !== generation || requestedView !== desiredView) return false;
      accept(value, requestedView);
      if (!hashOpened && !editor && !placing) {
        hashOpened = true;
        const hash = location.hash.slice(1);
        if (hash.startsWith('mark-')) {
          const marker = campaign.markers.find(m => m.id === hash.slice(5));
          if (marker) showMarker(marker, true);
        }
      }
      if (ownedModal === 'panel' && !preserve) panel();
      return true;
    } catch (e) {
      if (stamp !== generation || requestedView !== desiredView || e.status === -1) return false;
      if ([401,403,404].includes(e.status)) clearPrivate(e.message);
      else { error = e.message; update(); }
      if (showError) api.notify(e.message);
      return false;
    } finally {
      if (readController === controller) { readController = null; loading = false; update(); }
      else if (!readController) { loading = false; publish(); }
    }
  }
  function publicMarkers() { return campaign?.markers.filter(m => m.revealed).map(({secret, ...m}) => ({...m})) || []; }
  function visibleMarkers(state) { return campaign?.markers.filter(m => m.map === mapId(state) && (canEdit() && state.master || m.revealed)) || []; }
  function overlay(el, state) {
    const markers = visibleMarkers(state);
    if (!markers.length) return;
    el.insertAdjacentHTML('beforeend', `<g id="campaign-layer">${markers.map(m => `<g class="campaign-marker${m.revealed ? ' revealed' : ' hidden-marker'}" data-campaign-marker="${esc(m.id)}" transform="translate(${m.x} ${m.y})" role="button" tabindex="0" aria-label="${esc(m.name)}${m.revealed ? '' : ' · скрыто от игроков'}" style="--marker-color:${m.color}"><circle class="campaign-hit" r="10"/><path class="campaign-symbol" d="M0 -9L7 -2 0 9 -7 -2Z"/><text x="10" y="2">${esc(m.name)}</text><title>${esc(m.name)}</title></g>`).join('')}</g>`);
  }
  function scale(unit) {
    document.querySelectorAll('.campaign-marker').forEach(g => {
      g.querySelector('.campaign-hit').setAttribute('r', 22 * unit);
      g.querySelector('.campaign-symbol').setAttribute('transform', `scale(${unit})`);
      const text = g.querySelector('text'); text.style.fontSize = 14 * unit + 'px'; text.style.strokeWidth = 3 * unit + 'px';
      text.setAttribute('x', 12 * unit); text.setAttribute('y', 4 * unit); text.style.display = unit > .5 ? 'none' : '';
    });
  }
  function pick(event, {point, unit, state}) {
    if (placing) {
      if (!canEdit()) { cancelPlacement({restore:false}); return true; }
      if (['reference2077','legacyv4','red'].includes(state.map)) { api.notify('Для метки открой карту 2020 или исходный план.'); return true; }
      const seed = placementSeed || {};
      placing = false; placementSeed = null; moveStart = null;
      $('placement-hint').hidden = true; $('map').classList.remove('placing');
      if (editor) { editor.draft = {...editor.draft, x:point[0], y:point[1], map:mapId(state)}; renderEditor(); }
      else startEditor({...seed, x:point[0], y:point[1], map:mapId(state)});
      publish(); return true;
    }
    if (editor || busy) return false;
    const near = visibleMarkers(state).map(m => ({m,d:Math.hypot(m.x - point[0],m.y - point[1])})).sort((a,b) => a.d - b.d)[0];
    if (!near || near.d > 22 * unit) return false;
    showMarker(near.m); return true;
  }
  function place(seed = null) {
    if (!canEdit() || busy) return;
    if (['reference2077','synthesis','red'].includes(api.getContext().map)) { api.notify('Для метки открой карту 2020 или исходный план.'); return; }
    if (editor?.uncertain) { api.notify('Сначала проверь результат предыдущего сохранения повтором.'); return; }
    if (editor) { readDraft(); moveStart = {x:editor.draft.x,y:editor.draft.y,map:editor.draft.map}; }
    placing = true; placementSeed = seed; close(); api.closePanels?.();
    $('placement-hint').hidden = false; $('map').classList.add('placing');
    api.notify('Выбери точку на карте. Отмена вернёт черновик.'); publish();
  }
  function playerLink(marker) {
    const url = new URL('/atlas/index.html', location.origin);
    url.searchParams.set('crew','1'); url.searchParams.set('campaignId',String(campaignId)); url.searchParams.set('mode','player');
    if (marker) url.hash = 'mark-' + marker.id;
    return url.href;
  }
  async function share(marker) {
    if (!campaign || marker && !marker.revealed) { api.notify('Сначала открой метку игрокам и сохрани её.'); return; }
    if (!['http:','https:'].includes(location.protocol) || /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/i.test(location.hostname)) {
      open('Как открыть карту игрокам', '<p>Открытые места автоматически появляются на карте этой кампании у одобренных игроков.</p><p>Этот адрес работает только на устройстве ведущего. Адрес сервера для игроков указан на экране сервера Night City Crew. Попроси их подключиться к нему и открыть карту своей кампании.</p>', 'share');
      return;
    }
    try {
      const url = playerLink(marker);
      if (navigator.share) await navigator.share({title:marker?.name || campaign.name,text:'Карта Night City Crew. Нужен вход на этот сервер и одобренный доступ к кампании.',url});
      else await api.copy(url);
      api.notify('Ссылка для участников: нужен вход в Crew и одобренный доступ к этой кампании.');
    } catch (e) { if (e.name !== 'AbortError') api.notify('Не удалось отправить ссылку. Попробуй ещё раз.'); }
  }
  function showMarker(marker, focus = false) {
    if (!marker || (!canEdit() && !marker.revealed)) return;
    if (editor) { tryDismiss('replace'); return; }
    if (focus) api.focusMap([marker.x,marker.y],marker.map);
    openedMarkerId = marker.id;
    open(marker.name, `<div class="badges"><span class="badge">${marker.placeId ? 'Метка у каноничного места' : 'Место кампании'}</span><span class="badge ${marker.revealed ? '' : 'author'}">${marker.revealed ? 'Открыто игрокам' : 'Только ГМ'}</span></div><p class="marker-description">${esc(marker.description || 'Описание пока не добавлено.')}</p>${marker.placeId ? `<button data-canonical="${esc(marker.placeId)}">Карточка в справочнике</button><p class="source-line">Точку выбрал мастер. Точность привязки сверяй с источником.</p>` : ''}${canEdit() ? `<section class="secret-note"><h3>Скрыто от игроков</h3><p class="marker-description">${esc(marker.secret || 'Скрытых заметок нет.')}</p></section><div class="detail-actions"><button data-marker-edit="${esc(marker.id)}">Изменить</button><button data-marker-share="${esc(marker.id)}" ${marker.revealed ? '' : 'disabled'}>Отправить игрокам</button></div>` : ''}<button data-marker-focus="${esc(marker.id)}">Показать на карте</button>`, 'marker');
  }
  function markerValues(value) {
    return {name:value.name || '',description:value.description || '',secret:value.secret || '',kind:kinds[value.kind] ? value.kind : 'location',color:/^#[0-9a-f]{6}$/i.test(value.color) ? value.color : '#f0cd66',x:value.x,y:value.y,map:value.map,placeId:value.placeId || null,revealed:value.revealed === true};
  }
  function startEditor(marker = {}) {
    if (!canEdit() || busy) return;
    if (editor) { tryDismiss('replace'); return; }
    const draft = markerValues(marker);
    editor = {markerId:marker.id || null,viewerId:campaign.viewer?.id || null,viewerUsername:campaign.viewer?.username || null,draft,baseline:JSON.stringify(draft),baseVersion:campaign.revision,command:null,uncertain:false,conflict:false,screen:'form',message:''};
    renderEditor(); publish();
  }
  function readDraft() {
    if (!editor || !$('marker-form') || editor.uncertain) return;
    const before = JSON.stringify(editor.draft);
    editor.draft = {...editor.draft,name:$('marker-name').value,description:$('marker-description').value,secret:$('marker-secret').value,kind:$('marker-kind').value,color:$('marker-color').value,revealed:$('marker-revealed').checked};
    // A definite rejection can be edited; an ambiguous request must be replayed unchanged.
    if (editor.command && !editor.uncertain && JSON.stringify(editor.draft) !== before) editor.command = null;
    publish();
  }
  function renderEditor() {
    if (!editor || !canEdit()) return;
    editor.screen = 'form'; const m = editor.draft;
    open(editor.markerId ? 'Изменить метку' : 'Новое место кампании', `<form id="marker-form" class="marker-form"><label>Название<input id="marker-name" required maxlength="120" value="${esc(m.name)}"></label><div class="form-row"><label>Тип<select id="marker-kind">${Object.entries(kinds).map(([key,label]) => `<option value="${key}" ${m.kind === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Цвет<input id="marker-color" type="color" value="${esc(m.color)}"></label></div><label>Описание для игроков<textarea id="marker-description" maxlength="5000">${esc(m.description)}</textarea></label><label class="secret-note">Скрытые заметки ГМ<textarea id="marker-secret" maxlength="5000">${esc(m.secret)}</textarea></label><label class="reveal-check"><input id="marker-revealed" type="checkbox" ${m.revealed ? 'checked' : ''}> Открыть это место игрокам</label><p class="source-line">Скрытые метки и заметки доступны только ведущему. Ссылка не даёт доступ к кампании.</p><div id="marker-error" role="alert">${esc(editor.message)}</div><div class="detail-actions"><button type="submit" id="marker-save">${editor.uncertain ? (editor.command?.method === 'DELETE' ? 'Повторить и проверить удаление' : 'Повторить и проверить') : editor.removed ? 'Сохранить как новую метку' : editor.conflict ? 'Сохранить черновик поверх актуальной метки' : 'Сохранить'}</button><button type="button" id="marker-move">Выбрать другую точку</button>${editor.markerId && !editor.removed ? '<button type="button" id="marker-delete" class="danger-button">Удалить</button>' : ''}<button type="button" id="marker-cancel">Закрыть</button></div></form>`, 'editor');
    $('marker-form').addEventListener('input', readDraft); $('marker-form').addEventListener('change', readDraft);
    $('marker-form').onsubmit = event => { event.preventDefault(); save(); };
    $('marker-move').onclick = () => place(); $('marker-cancel').onclick = () => tryDismiss('close');
    if ($('marker-delete')) $('marker-delete').onclick = confirmDelete;
    setFormBusy();
  }
  function setFormBusy() {
    if (!$('marker-form') || !editor) return;
    $('marker-form').querySelectorAll('input,textarea,select').forEach(el => { el.disabled = busy || editor.uncertain; });
    for (const id of ['marker-save','marker-move','marker-delete','marker-cancel']) if ($(id)) $(id).disabled = busy || editor.uncertain && ['marker-move','marker-delete'].includes(id);
  }
  function commandId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2,'0')).join('');
  }
  function validateDraft() {
    if (!editor.draft.name.trim()) { editor.message = 'Укажи название метки.'; renderEditor(); $('marker-name').focus(); return false; }
    return true;
  }
  async function save({dismiss = false} = {}) {
    if (!editor || busy || !canEdit()) return false;
    readDraft();
    if (editor.command?.method === 'DELETE') return mutate('DELETE', dismiss);
    if (!validateDraft()) return false;
    if (editor.removed && !editor.command) { editor.markerId = null; editor.removed = false; }
    const method = editor.markerId ? 'PUT' : 'POST';
    return mutate(method, dismiss);
  }
  async function mutate(method, dismiss = false) {
    if (!editor || busy || !canEdit()) return false;
    const active = editor, stamp = generation, view = desiredView;
    if (!active.command) active.command = {method,path:'/markers' + (active.markerId ? '/' + encodeURIComponent(active.markerId) : ''),body:{id:commandId(),expectedVersion:active.baseVersion,...(method === 'DELETE' ? {} : {marker:clone(active.draft)})}};
    const command = active.command;
    busy = true; active.message = ''; setFormBusy(); publish();
    try {
      const result = await request(command.path, {method:command.method,body:command.body,view,viewerId:active.viewerId,viewerUsername:active.viewerUsername});
      if (disposed || editor !== active || stamp !== generation || desiredView !== view) return false;
      // A response without a matching receipt cannot establish whether a write committed.
      if (result?.receipt?.commandId !== command.body.id || !result.receipt.markerId || result.receipt.type !== ({POST:'create',PUT:'update',DELETE:'delete'}[command.method])) throw new RequestError('Сервер не подтвердил эту команду. Повтори её, чтобы проверить результат.', 0, true);
      if (result?.viewer?.id !== active.viewerId || result?.viewer?.username !== active.viewerUsername) throw new RequestError('Аккаунт Crew изменился. Прежний черновик закрыт. Открой карту заново в нужном аккаунте.', 403, false);
      try { normalizeProjection(result, view); } catch (e) { e.uncertain = true; throw e; }
      editor = null; accept(result, view); close();
      const marker = campaign?.markers.find(m => m.id === result.receipt.markerId);
      if (!dismiss && marker) showMarker(marker);
      else if (!dismiss && command.method === 'DELETE') panel();
      api.notify(command.method === 'DELETE' ? 'Метка удалена.' : 'Метка сохранена в кампании Crew.');
      return true;
    } catch (e) {
      if (editor !== active || disposed) return false;
      if ([401,403].includes(e.status)) { clearPrivate(e.message); api.notify(e.message); return false; }
      active.uncertain = e.uncertain;
      active.message = e.message;
      if (e.status === 404) {
        active.command = null; active.uncertain = false;
        const refreshed = await load({preserve:true});
        if (editor !== active) return false;
        if (refreshed && !campaign.markers.some(marker => marker.id === active.markerId)) {
          active.removed = true; active.baseVersion = campaign.revision;
          active.message = 'Метка была удалена. Твой черновик сохранён: можно сохранить его как новую метку.';
        }
      } else if (e.status === 409) {
        active.conflict = true; active.uncertain = false;
        const refreshed = await load({preserve:true});
        if (editor !== active) return false;
        if (refreshed) {
          active.baseVersion = campaign.revision; active.command.body.expectedVersion = campaign.revision;
          active.message = 'Карта изменилась на другом устройстве. Черновик сохранён. Проверь его: повторное сохранение заменит актуальные поля метки этим черновиком.';
        } else {
          active.message = 'Карта изменилась, но обновить её не удалось. Черновик сохранён. Повтори попытку после восстановления связи.';
        }
      if (command.method === 'DELETE') active.command = null;
      } else if (!active.uncertain) active.command = null;
      if (editor === active) renderEditor();
      return false;
    } finally { busy = false; setFormBusy(); publish(); }
  }
  function confirmDelete() {
    if (!editor || busy || editor.uncertain) return;
    readDraft(); editor.screen = 'delete';
    open('Удалить метку?', `<p>${esc(editor.draft.name)} исчезнет из кампании и карты игроков. Несохранённые правки этой метки будут отброшены.</p><div class="detail-actions"><button id="confirm-marker-delete" class="danger-button">Удалить метку</button><button id="keep-marker">Оставить</button></div>`, 'editor');
    $('keep-marker').onclick = renderEditor;
    $('confirm-marker-delete').onclick = () => { if (busy) return; editor.command = null; mutate('DELETE'); };
  }
  function askDismiss() {
    readDraft(); editor.screen = 'dismiss';
    open('Сохранить изменения?', `<p>В метке остались несохранённые изменения.</p>${editor.uncertain ? '<p>Предыдущий запрос мог сохраниться. «Сохранить» повторит ту же команду без дубликата; «Отбросить» закроет черновик без проверки результата.</p>' : ''}<div class="detail-actions"><button id="crew-save-draft">Сохранить</button><button id="crew-discard-draft" class="danger-button">Отбросить</button><button id="crew-keep-draft">Продолжить редактирование</button></div>`, 'editor');
    $('crew-save-draft').onclick = () => save({dismiss:true});
    $('crew-discard-draft').onclick = () => { if (busy) return; editor = null; cancelPlacement({restore:false}); close(); publish(); };
    $('crew-keep-draft').onclick = renderEditor;
  }
  function tryDismiss(reason = 'back') {
    if (busy) { api.notify('Проверяю сохранение. Подожди ответа сервера.'); return true; }
    if (placing) {
      if ($('modal').open || $('modal').hasAttribute('open')) { close(); return true; }
      if (api.handleBack?.()) return true;
      cancelPlacement(); return true;
    }
    if (editor) {
      readDraft();
      if (editor.screen === 'dismiss' || editor.screen === 'delete') { renderEditor(); return true; }
      if (dirty()) askDismiss();
      else { editor = null; close(); publish(); }
      return true;
    }
    if ($('modal').open || $('modal').hasAttribute('open')) { close(); return true; }
    return false;
  }
  function panel() {
    if (editor || placing) { tryDismiss('replace'); return; }
    if (!campaign) {
      open('Карта кампании Crew', `<p>${esc(error || 'Подключаю карту кампании…')}</p><p>Нужен вход на этот сервер Crew и одобренный доступ к выбранной кампании. Открой нужную кампанию в Crew.</p><button id="campaign-refresh">Повторить</button>`, 'panel');
    } else {
      open('Карта кампании', `<h3>${esc(campaign.name)}</h3><p>${canEdit() ? 'Метки сохраняются в этой кампании Crew. Игроки видят только открытые места.' : 'Места, которые открыл вашей кампании ведущий.'}</p><div class="detail-actions">${canEdit() ? '<button id="campaign-new-pin">Добавить место</button>' : ''}<button id="campaign-share">Отправить карту участнику</button><button id="campaign-refresh">Обновить</button></div><div class="campaign-marker-list">${campaign.markers.map(m => `<button data-marker-open="${esc(m.id)}"><i style="background:${m.color}"></i><span>${esc(m.name)}<small>${m.revealed ? 'Открыто игрокам' : 'Только ГМ'} · ${m.map === 'city2020' ? 'Карта 2020' : m.map.startsWith('sector:') ? 'Исходный план района' : 'Исходный план'}</small></span></button>`).join('') || '<p class="empty">Мест пока нет.</p>'}</div><p class="source-line">Ссылка требует входа на этот сервер Crew и одобренного доступа к кампании. Она не добавляет участников и не передаёт права ведущего.</p>`, 'panel');
      if ($('campaign-new-pin')) $('campaign-new-pin').onclick = () => place();
      $('campaign-share').onclick = () => share();
    }
    $('campaign-refresh').onclick = async () => { await load({showError:true}); if (ownedModal === 'panel') panel(); };
  }

  window.NC_CAMPAIGN = {overlay,scale,pick,locked:true,getPlayerMarkers:publicMarkers};
  window.NC_CREW_CAMPAIGN = {getState,tryDismiss,subscribe(fn) { subscribers.add(fn); fn(getState()); return () => subscribers.delete(fn); },
    refresh:() => busy ? Promise.resolve(false) : load({showError:true,preserve:true}), get isEditing() { return !!editor || placing; },
    dispose() { disposed = true; generation++; readController?.abort(); clearInterval(poll); subscribers.clear(); }};
  // No role-bearing response has arrived yet: suppress GM presentation immediately.
  setMode(false); update();
  $('campaign-open').onclick = panel; $('add-marker').onclick = () => place();
  $('cancel-placement').onclick = () => cancelPlacement();
  document.addEventListener('click', event => {
    const target = event.target.closest?.('button,a'); if (!target) return;
    if (target.id === 'view-mode' && (editor || placing || busy)) { event.preventDefault(); event.stopImmediatePropagation(); tryDismiss('mode'); }
  }, true);
  document.addEventListener('click', event => {
    const hit = attr => event.target.closest?.('[' + attr + ']');
    const markerFor = node => campaign?.markers.find(m => m.id === node.getAttribute(node.hasAttribute('data-marker-open') ? 'data-marker-open' : node.hasAttribute('data-marker-edit') ? 'data-marker-edit' : node.hasAttribute('data-marker-share') ? 'data-marker-share' : 'data-marker-focus'));
    const opened = hit('data-marker-open'); if (opened) { showMarker(markerFor(opened), true); return; }
    const edit = hit('data-marker-edit'); if (edit) { const marker = markerFor(edit); if (marker) startEditor(marker); return; }
    const shared = hit('data-marker-share'); if (shared) { share(markerFor(shared)); return; }
    const focus = hit('data-marker-focus'); if (focus) { const marker = markerFor(focus); if (marker) { api.focusMap([marker.x,marker.y],marker.map); close(); } return; }
    const canonical = hit('data-canonical'); if (canonical) { try { api.selectLocation(canonical.dataset.canonical); close(); $('show-card').click(); } catch { api.notify('Это место больше не найдено в справочнике.'); } return; }
    if (hit('data-action')?.dataset.action === 'campaign-mark') {
      if (!canEdit()) { panel(); return; }
      const context = api.getContext(), seed = {placeId:context.selected,name:context.name,description:context.description};
      if (context.point) startEditor({...seed,x:context.point[0],y:context.point[1],map:context.map}); else place(seed);
    }
  });
  $('map').addEventListener('keydown', event => {
    const node = event.target.closest?.('[data-campaign-marker]');
    if (node && ['Enter',' '].includes(event.key)) { event.preventDefault(); showMarker(campaign?.markers.find(m => m.id === node.dataset.campaignMarker)); }
  });
  window.addEventListener('nc-atlas:mode', () => {
    if (internalMode) return;
    desiredView = api.getContext().master ? 'gm' : 'player';
    generation++; readController?.abort();
    // Remove all private objects and DOM synchronously, before the player request.
    if (desiredView === 'player') {
      if (campaign) campaign = {...campaign,role:'player',canManage:false,markers:publicMarkers()};
      editor = null; cancelPlacement({restore:false}); if (ownedModal) close(); update();
    }
    load({showError:true});
  });
  window.addEventListener('nc-atlas:local-notes-state', publish);
  const poll = setInterval(() => { if (!document.hidden && !editor && !placing && !busy && !loading) load(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !editor && !placing && !busy && !loading) load(); });
  window.addEventListener('pagehide', () => window.NC_CREW_CAMPAIGN.dispose(), {once:true});
  if (!validId) { error = 'Не указан номер кампании Crew. Открой карту из своей кампании.'; update(); }
  else load({showError:true}).then(ok => { if (ok && canEdit()) setMode(true); });
})();
