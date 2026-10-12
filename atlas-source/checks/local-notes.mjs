import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
function boot(campaignId){
 const dom=new JSDOM(read('public/index.html'),{url:'https://atlas.example/?mode=gm'+(campaignId?'&crew=1&campaignId='+campaignId:''),runScripts:'outside-only'}),w=dom.window,d=w.document;
 w.matchMedia=()=>({matches:true});w.HTMLElement.prototype.getBoundingClientRect=w.SVGElement.prototype.getBoundingClientRect=()=>({width:390,height:850,left:0,top:0});
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};
 let clipboard='';Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{clipboard=text}}});
 for(const name of ['data.js','streets-data.js','world-data.js','transit-data.js','cartography.js','app.js','transit.js'])w.eval(read('public/'+name));
 const api=w.NightCityAtlas;api.selectLocation('core-01');
 const type=text=>{const f=d.getElementById('local-notes');assert(f);f.value=text;f.dispatchEvent(new w.Event('input',{bubbles:true}))};
 return {dom,w,d,api,type,clipboard:()=>clipboard};
}
// Per-location drafts remain readable while storage is full, including a quick
// A→B→A, and recovery can retry or explicitly discard without trapping Back.
{
 const {dom,w,d,api,type,clipboard}=boot();const original=w.Storage.prototype.setItem;
 w.Storage.prototype.setItem=()=>{throw new w.DOMException('Full','QuotaExceededError')};
 type('Unsaved A');assert(api.hasUnsavedLocalNotes());api.selectLocation('core-39');type('Unsaved B');api.selectLocation('core-01');assert.equal(d.getElementById('local-notes').value,'Unsaved A');
 let continued=0;assert(api.showLocalNoteRecovery(()=>continued++));d.getElementById('notes-copy').click();await new Promise(r=>setTimeout(r,0));assert(clipboard().includes('Unsaved A'));assert(clipboard().includes('Unsaved B'));
 d.getElementById('notes-retry').click();assert.equal(continued,0);assert(d.getElementById('modal').open);
 d.getElementById('notes-keep').click();assert(!d.getElementById('modal').open);assert(api.hasUnsavedLocalNotes());
 w.Storage.prototype.setItem=original;api.showLocalNoteRecovery(()=>continued++);d.getElementById('notes-retry').click();assert.equal(continued,1);assert.equal(w.localStorage.getItem('nc-atlas:note:core-01'),'Unsaved A');assert.equal(w.localStorage.getItem('nc-atlas:note:core-39'),'Unsaved B');assert(!api.hasUnsavedLocalNotes());
 w.Storage.prototype.setItem=()=>{throw new Error('Full')};type('Discard only this unsaved change');api.showLocalNoteRecovery(()=>continued++);d.getElementById('notes-discard').click();assert.equal(continued,2);assert.equal(d.getElementById('local-notes').value,'Unsaved A');assert(!api.hasUnsavedLocalNotes());dom.window.close();
}
// Crew requires a server-verified scope. Changing identity/campaign can neither
// display, persist, copy nor discard a different identity's failed buffer.
for(const campaignId of [10,20]){
 const {dom,w,d,api,type,clipboard}=boot(campaignId);const original=w.Storage.prototype.setItem;
 w.localStorage.setItem('nc-atlas:note:core-01','Legacy shared secret');assert.equal(d.getElementById('local-notes'),null);
 const scopeA={userId:1,username:'gm-a',campaignId},scopeB={userId:2,username:'gm-b',campaignId};
 api.setLocalNotesScope({...scopeA,campaignId:campaignId+1});assert.equal(d.getElementById('local-notes'),null);
 api.setLocalNotesScope(scopeA);assert.equal(d.getElementById('local-notes').value,'');type('A saved '+campaignId);
 const keyA=`nc-atlas:crew-note:v1:1:gm-a:${campaignId}:core-01`;assert.equal(w.localStorage.getItem(keyA),'A saved '+campaignId);
 const same=d.getElementById('local-notes');api.setLocalNotesScope(scopeA);assert.equal(d.getElementById('local-notes'),same,'Polling must not replace the active textarea');
 w.Storage.prototype.setItem=()=>{throw new Error('Full')};type('A buffer '+campaignId);api.showLocalNoteRecovery();const staleCopy=d.getElementById('notes-copy'),staleDiscard=d.getElementById('notes-discard');
 api.setLocalNotesScope(null);assert.equal(d.getElementById('local-notes'),null);assert(!d.getElementById('modal').open);assert(!api.hasUnsavedLocalNotes());assert(api.flushLocalNotes());assert.equal(api.showLocalNoteRecovery(),false);
 api.setLocalNotesScope(scopeB);assert.equal(d.getElementById('local-notes').value,'');assert(!api.hasUnsavedLocalNotes());staleCopy.click();staleDiscard.click();await new Promise(r=>setTimeout(r,0));assert.equal(clipboard(),'');
 type('B buffer '+campaignId);api.showLocalNoteRecovery();d.getElementById('notes-copy').click();await new Promise(r=>setTimeout(r,0));assert(!clipboard().includes('A buffer'));assert(clipboard().includes('B buffer'));d.getElementById('notes-discard').click();assert(!api.hasUnsavedLocalNotes());
 api.setLocalNotesScope(scopeA);assert.equal(d.getElementById('local-notes').value,'A buffer '+campaignId);assert(api.hasUnsavedLocalNotes());api.setMode(false);assert.equal(d.getElementById('local-notes'),null);api.setMode(true);assert.equal(d.getElementById('local-notes').value,'A buffer '+campaignId);
 let rejectClipboard;w.navigator.clipboard.writeText=()=>new Promise((resolve,reject)=>{rejectClipboard=reject});api.showLocalNoteRecovery();d.getElementById('notes-copy').click();api.setLocalNotesScope(scopeB);rejectClipboard(new Error('Unavailable'));await new Promise(r=>setTimeout(r,0));assert.equal(d.getElementById('copy-text'),null,'A delayed clipboard failure cannot reveal a former account note');
 api.setLocalNotesScope(scopeA);w.navigator.clipboard.writeText=async()=>{throw new Error('Unavailable')};api.showLocalNoteRecovery();d.getElementById('notes-copy').click();await new Promise(r=>setTimeout(r,0));assert(d.getElementById('copy-text').value.includes('A buffer'));api.setLocalNotesScope(scopeB);assert.equal(d.getElementById('copy-text'),null,'An already-open private copy fallback clears on account change');
 api.setLocalNotesScope(scopeA);w.Storage.prototype.setItem=original;assert(api.flushLocalNotes());assert.equal(w.localStorage.getItem(keyA),'A buffer '+campaignId);assert.equal(w.localStorage.getItem('nc-atlas:note:core-01'),'Legacy shared secret');dom.window.close();
}
console.log('Local notes: verified account+campaign isolation, no legacy migration, idempotent scope, quota-safe multi-location drafts, copy/retry/discard recovery and stale-account guards passed.');
