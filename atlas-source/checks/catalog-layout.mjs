import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

// Structural CSS contracts only. Actual overflow/card visibility is checked in
// the deployed browser iframe at 844x390, 667x375 and short narrow viewports.
const root=new URL('../public/',import.meta.url),read=file=>fs.readFileSync(new URL(file,root),'utf8');
const dom=new JSDOM(read('index.html'),{url:'https://atlas.example/'});
const d=dom.window.document,style=d.createElement('style');style.textContent=read('style.css');d.head.append(style);
const rules=[...style.sheet.cssRules],media=text=>rules.find(rule=>rule.media?.mediaText===text);
const short=media('(max-height:500px)'),wide=media('(max-height:500px) and (min-width:600px)'),narrow=media('(max-height:500px) and (max-width:599px)');
assert(short&&wide&&narrow,'Short viewports have wide and narrow responsive fallbacks');
const rule=(media,selector)=>[...media.cssRules].find(rule=>rule.selectorText===selector)?.style;
const panel=rule(wide,'#catalog-panel');assert.equal(panel.display,'grid');assert.equal(panel.getPropertyValue('grid-template-rows'),'auto minmax(0,1fr)');assert.equal(panel.top,'84px');
assert.equal(rule(wide,'.embedded #catalog-panel').top,'16px','Embedded catalog retains its own top inset');
assert.equal(rule(wide,'#catalog-panel>.panel-heading').getPropertyValue('grid-column'),'1/-1');
assert.equal(rule(wide,'#catalog-panel>.catalog-head').overflow,'auto');
assert.equal(rule(wide,'#catalog-panel>.results').overflow,'auto');
assert.equal(rule(wide,'#catalog-panel>.results').getPropertyValue('min-height'),'0');
assert.equal(rule(narrow,'#catalog-panel').overflow,'auto');assert.equal(rule(narrow,'#catalog-panel>.results').flex,'none');assert.equal(rule(narrow,'#catalog-panel>.results').overflow,'visible');
assert([...short.cssRules].some(rule=>rule.selectorText.includes('.segmented button')&&rule.style.getPropertyValue('min-height')==='44px'),'Control targets stay at least 44px');
assert(d.querySelector('#catalog-panel>.panel-heading')&&d.querySelector('#catalog-panel>.catalog-head')&&d.querySelector('#catalog-panel>.results'),'Grid children match actual catalog markup');
assert.equal(d.getElementById('catalog-close').getAttribute('aria-label'),'Закрыть поиск');
dom.window.close();
console.log('Catalog CSS contracts: short landscape has independent controls/results columns; short narrow view scrolls the whole catalog; embedded inset and 44px targets preserved. Physical layout requires browser verification.');
