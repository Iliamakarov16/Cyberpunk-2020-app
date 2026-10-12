/* Same-origin Crew navigation bridge. No campaign data crosses postMessage. */
(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('crew') !== '1' || window.NC_CREW_BRIDGE) return;
  const api = window.NightCityAtlas, campaign = window.NC_CREW_CAMPAIGN;
  if (!api || !campaign) return;
  const $ = id => document.getElementById(id);
  let exited = false, installed = false, unsubscribe;
  const downloads = new Map();
  function releaseDownload(url) {
    if (!downloads.has(url)) return;
    clearTimeout(downloads.get(url)); downloads.delete(url); URL.revokeObjectURL(url);
  }
  function download(blob, filename) {
    if (window.parent === window || !(blob instanceof Blob) || blob.size > 4 * 1024 * 1024 || !/^NightCity_Atlas_2020(?:_Player)?\.json$/.test(filename) || !URL.createObjectURL) return false;
    const url = URL.createObjectURL(blob);
    if (!url.startsWith('blob:' + location.origin + '/')) { URL.revokeObjectURL(url); return false; }
    downloads.set(url, setTimeout(() => releaseDownload(url), 60000));
    try { window.parent.postMessage({type:'nc-atlas:download',version:1,url,filename}, location.origin); return true; }
    catch { releaseDownload(url); return false; }
  }
  function send(type) {
    if (window.parent === window) return;
    window.parent.postMessage({type,version:1,...campaign.getState()}, location.origin);
  }
  function back({exit = true, acknowledge = false} = {}) {
    if (exited) { if (acknowledge) send('nc-atlas:back-handled'); return; }
    if (campaign.tryDismiss('back')) { send('nc-atlas:state'); if (acknowledge) send('nc-atlas:back-handled'); return; }
    if (api.handleBack?.()) { send('nc-atlas:state'); if (acknowledge) send('nc-atlas:back-handled'); return; }
    if (acknowledge) send('nc-atlas:back-handled');
    if (!exit) return;
    if (api.flushLocalNotes?.() === false) { api.showLocalNoteRecovery?.(() => back()); send('nc-atlas:state'); return; }
    exited = true; send('nc-atlas:exit');
    if (window.parent === window) location.assign('/');
  }
  function install() {
    if (installed) return; installed = true;
    const originalOpen = api.openModal.bind(api), originalClose = api.closeModal.bind(api);
    api.tryDismiss = reason => campaign.tryDismiss(reason);
    api.openModal = (title, html) => {
      if (campaign.isEditing) { campaign.tryDismiss('replace'); return false; }
      originalOpen(title, html); return true;
    };
    api.closeModal = () => { if (!campaign.tryDismiss('close')) originalClose(); };
    $('crew-exit')?.addEventListener('click', event => { event.preventDefault(); back(); });
    // Brand navigation is an exit, too, and must not discard a draft.
    document.querySelector('.brand')?.addEventListener('click', event => { event.preventDefault(); back(); });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation(); back({exit:false});
    }, true);
    $('modal')?.addEventListener('cancel', event => {
      event.preventDefault(); campaign.tryDismiss('cancel'); send('nc-atlas:state');
    });
    // Capturing protects against later onclick assignments by ordinary atlas scripts.
    document.addEventListener('click', event => {
      if (!event.target.closest?.('#modal-close')) return;
      event.preventDefault(); event.stopImmediatePropagation(); campaign.tryDismiss('close'); send('nc-atlas:state');
    }, true);
    window.addEventListener('beforeunload', event => {
      const state = campaign.getState();
      if (state.dirty || state.busy) { event.preventDefault(); event.returnValue = ''; }
    });
    unsubscribe = campaign.subscribe(() => send('nc-atlas:state'));
    send('nc-atlas:ready');
  }
  window.addEventListener('message', event => {
    if (window.parent === window || event.source !== window.parent || event.origin !== location.origin) return;
    if (event.data?.version !== 1) return;
    if (event.data?.type === 'nc-crew:resume') { api.resizeMap?.(); send('nc-atlas:state'); return; }
    if (event.data?.type === 'nc-crew:download-complete' && typeof event.data.url === 'string') { releaseDownload(event.data.url); return; }
    if (event.data?.type === 'nc-crew:back') back({acknowledge:true});
  });
  window.addEventListener('pagehide', () => { api.flushLocalNotes?.(); unsubscribe?.(); for (const url of downloads.keys()) releaseDownload(url); }, {once:true});
  window.NC_CREW_BRIDGE = {back,download,version:1};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
  else install();
})();
