/* Appearance bridge only. Never reads campaign data or authentication.
   App appearance is inherited; Atlas palette preferences use a separate key. */
(() => {
  'use strict';
  const KEY = 'nc20.interface.v1';
  const LEGACY_KEY = 'nc20.dossier.appearance.v1';
  const ATLAS_KEY = 'nc20.atlas.appearance.v1';
  const palettes = ['carmine', 'ultraviolet', 'amber', 'maelstrom', 'original'];
  const names = {carmine:'Кармин',ultraviolet:'Ультрафиолет',amber:'Янтарь',maelstrom:'Мальстрём',original:'Оригинал'};
  const treatments = ['clean', 'printed', 'raw'];
  const root = document.documentElement;
  const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalize = value => ({
    palette: palettes.includes(value?.palette) ? value.palette : 'carmine',
    treatment: treatments.includes(value?.treatment) ? value.treatment : 'printed',
    digital: typeof value?.digital === 'boolean' ? value.digital : true,
  });
  const normalizePreferences = value => {
    const raw = record(value);
    return {
      theme: palettes.includes(raw.theme) ? raw.theme : 'app',
      separate: raw.separate === true,
      ui: palettes.includes(raw.ui) ? raw.ui : 'theme',
      map: palettes.includes(raw.map) ? raw.map : 'theme',
    };
  };
  let saved = {};
  let preferences = normalizePreferences();
  let unsavedPreferences = false;
  let parentAppearance = null;
  function read() {
    try {
      // A present but invalid current key must not revive stale legacy values.
      const current = localStorage.getItem(KEY);
      saved = record(JSON.parse(current === null ? (localStorage.getItem(LEGACY_KEY) ?? '{}') : current));
    } catch { saved = {}; }
    return normalize(saved);
  }
  function readPreferences() {
    try { return normalizePreferences(JSON.parse(localStorage.getItem(ATLAS_KEY) ?? '{}')); }
    catch { return normalizePreferences(); }
  }
  let appAppearance = read();
  preferences = readPreferences();
  function liveParentAppearance() {
    try {
      if (window.parent !== window && window.parent.location.origin === location.origin) {
        const parent = window.parent.document.documentElement.dataset;
        // Effects-off is an inherited runtime switch, never an Atlas setting.
        if (parent.playerMotion === 'off' || parent.playerMotion === 'on') root.dataset.playerMotion = parent.playerMotion;
        else delete root.dataset.playerMotion;
        if (palettes.includes(parent.palette)) return normalize({palette:parent.palette,treatment:parent.treatment,digital:parent.digital !== 'off'});
      }
    } catch { /* Cross-origin embeds require an explicitly pinned message. */ }
    return null;
  }
  function apply() {
    const theme = preferences.theme === 'app' ? appAppearance.palette : preferences.theme;
    const ui = preferences.separate && preferences.ui !== 'theme' ? preferences.ui : theme;
    const map = preferences.separate && preferences.map !== 'theme' ? preferences.map : theme;
    root.dataset.palette = ui;
    root.dataset.appPalette = appAppearance.palette;
    root.dataset.mapPalette = map;
    root.dataset.treatment = appAppearance.treatment;
    root.dataset.digital = appAppearance.digital ? 'on' : 'off';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = {carmine:'#080406',ultraviolet:'#07060a',amber:'#080a08',maelstrom:'#080909',original:'#03080c'}[ui];
    for (const [id,value] of [['atlas-palette',preferences.theme],['atlas-ui-palette',preferences.ui],['atlas-map-palette',preferences.map],['atlas-treatment',appAppearance.treatment]]) {
      const input = document.getElementById(id);
      if (input) input.value = value;
    }
    const digital = document.getElementById('atlas-digital');
    if (digital) digital.checked = appAppearance.digital;
    const separate = document.getElementById('atlas-separate');
    if (separate) separate.checked = preferences.separate;
    const overrides = document.getElementById('atlas-palette-overrides');
    if (overrides) overrides.hidden = !preferences.separate;
    const status = document.getElementById('atlas-palette-status');
    if (status) status.textContent = `Приложение: ${names[appAppearance.palette]}. Интерфейс: ${names[ui]}. Карта: ${names[map]}.${unsavedPreferences ? ' Не сохранено на устройстве.' : ''}`;
    // Compatibility: detail.palette is the effective MAP palette. Consumers
    // painting interface chrome use uiPalette (or root.dataset.palette).
    window.dispatchEvent(new CustomEvent('nc-atlas:appearance', {detail:{
      palette:map, mapPalette:map, uiPalette:ui, appPalette:appAppearance.palette,
      themePalette:theme, treatment:appAppearance.treatment, digital:appAppearance.digital,
      preferences:{...preferences},
    }}));
  }
  function inherit() {
    appAppearance = liveParentAppearance() || parentAppearance || read();
    apply();
  }
  function savePreferences(next) {
    preferences = normalizePreferences(next);
    try {
      localStorage.setItem(ATLAS_KEY, JSON.stringify(preferences));
      unsavedPreferences = false;
    } catch {
      unsavedPreferences = true;
      window.NightCityAtlas?.notify('Палитра изменена, но не сохранилась на этом устройстве');
    }
    apply();
  }
  inherit();
  window.addEventListener('storage', event => {
    if (![KEY, LEGACY_KEY, ATLAS_KEY, null].includes(event.key)) return;
    if (event.key === ATLAS_KEY || event.key === null) {
      preferences = readPreferences();
      unsavedPreferences = false;
    }
    inherit();
  });
  let parentObserver;
  function observeParent() {
    try {
      if (window.parent !== window && window.parent.location.origin === location.origin) {
        parentObserver ||= new MutationObserver(inherit);
        parentObserver.observe(window.parent.document.documentElement, {attributes:true,attributeFilter:['data-palette','data-treatment','data-digital','data-player-motion']});
      }
    } catch {}
  }
  observeParent();
  // Back/Forward may restore this document without rerunning its scripts.
  // Keep an unsaved local choice in memory, rather than silently losing it.
  window.addEventListener('pagehide', () => parentObserver?.disconnect());
  function restore() {
    if (!unsavedPreferences) preferences = readPreferences();
    observeParent();
    inherit();
  }
  window.addEventListener('pageshow', restore);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) restore(); });
  const parentOrigin = new URLSearchParams(location.search).get('parentOrigin');
  window.addEventListener('message', event => {
    if (window.parent === window || event.source !== window.parent) return;
    if (event.origin !== location.origin && (!parentOrigin || event.origin !== parentOrigin)) return;
    if (event.data?.version !== 1) return;
    let value;
    if (event.data.type === 'nc-crew:theme') {
      if (event.origin !== location.origin) return;
      if (event.data.settings === null) { parentAppearance = null; inherit(); return; }
      if (typeof event.data.settings !== 'string' || event.data.settings.length > 10000) return;
      try { value = JSON.parse(event.data.settings); } catch { return; }
    } else if (event.data.type === 'nc-atlas:theme') value = event.data.appearance;
    else return;
    if (!value || !palettes.includes(value.palette) || !treatments.includes(value.treatment) || typeof value.digital !== 'boolean') return;
    parentAppearance = normalize(value);
    inherit();
  });
  document.addEventListener('DOMContentLoaded', () => {
    inherit();
    for (const [id,field] of [['atlas-palette','theme'],['atlas-ui-palette','ui'],['atlas-map-palette','map']]) {
      document.getElementById(id)?.addEventListener('change', event => savePreferences({...preferences,[field]:event.target.value}));
    }
    document.getElementById('atlas-separate')?.addEventListener('change', event => savePreferences({...preferences,separate:event.target.checked}));
    document.getElementById('atlas-palette-reset')?.addEventListener('click', () => savePreferences(normalizePreferences()));
    for (const field of ['treatment','digital']) {
      document.getElementById('atlas-' + field)?.addEventListener('change', event => {
        const value = field === 'digital' ? event.target.checked : event.target.value;
        // Preserve shared app settings and the actual inherited base palette.
        // An Atlas override must never be written into the app's palette key.
        read();
        try { localStorage.setItem(KEY, JSON.stringify({...saved,...appAppearance,[field]:value})); }
        catch { window.NightCityAtlas?.notify('Оформление изменено, но не сохранилось на этом устройстве'); }
        appAppearance = normalize({...appAppearance,[field]:value});
        apply();
      });
    }
  }, {once:true});
})();
