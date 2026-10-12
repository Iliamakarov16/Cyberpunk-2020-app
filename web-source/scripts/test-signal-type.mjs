import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const source=await readFile(new URL('../components/signal-type.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
const module={exports:{}};
vm.runInNewContext(code,{module,exports:module.exports,require},{filename:'signal-type.js'});
const SignalType=module.exports.default;
const label='Вход в систему';
const element=SignalType({children:label});
const children=element.props.children;
const primary=children.find(child=>child.props.className==='nc-type-source');
const decorative=children.find(child=>child.props.className==='nc-type-fragment');
assert.equal(primary.props.children,label);
assert.equal(primary.props.hidden,undefined,'The readable source remains visible without styles.');
assert.equal(decorative.props.hidden,true,'The duplicate is hidden by HTML even when CSS delivery fails.');
assert.equal(decorative.props['aria-hidden'],'true','The decorative copy never creates a second accessible title.');
const visibleText=children.filter(child=>!child.props.hidden).map(child=>child.props.children).join('');
assert.equal(visibleText,label,'The unstyled title contains exactly one visible copy.');
const html=renderToStaticMarkup(element);
assert.match(html,/class="nc-type-fragment" hidden="" aria-hidden="true"/,'The shipped DOM includes a native hiding attribute.');

// Parse the real stylesheet, including media guards, rather than simulating a browser.
const postcss=createRequire(require.resolve('vite/package.json'))('postcss');
const baseCSS=postcss.parse(await readFile(new URL('../public/style.css',import.meta.url),'utf8'));
let hiddenGuard;
baseCSS.walkRules(rule=>{
 if(rule.selector==='[hidden]:not(.nc-type-fragment)')hiddenGuard=rule.nodes.find(node=>node.prop==='display');
 assert(!(rule.selector==='[hidden]'&&rule.nodes.some(node=>node.prop==='display'&&node.important)),'A general important hidden rule must not block the intentionally clipped title fragment.');
});
assert.equal(hiddenGuard?.value,'none');assert(hiddenGuard.important,'Other hidden interface elements remain protected.');
const css=postcss.parse(await readFile(new URL('../public/dossier-theme.css',import.meta.url),'utf8'));
const declarations=rule=>Object.fromEntries(rule.nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node]));
let base,active,print,motion;
css.walkRules(rule=>{
 if(rule.selector==='.nc-type-fragment'&&rule.parent.type!=='atrule')base=declarations(rule);
 if(rule.selector===':root[data-digital="on"] .nc-signal-type>.nc-type-fragment[hidden]')active=declarations(rule);
 if(rule.selector==='.nc-type-fragment'&&rule.parent.name==='media'&&rule.parent.params==='print')print=declarations(rule);
 if(rule.parent.name==='media'&&rule.parent.params.includes('prefers-reduced-motion:reduce')&&declarations(rule).animation?.important)motion=declarations(rule);
});
assert.equal(base.display.value,'none','Digital off keeps the HTML-hidden decoration off.');
assert.equal(base.position.value,'absolute','The decoration cannot create another text line.');
assert.equal(base['pointer-events'].value,'none');
assert.equal(active.display.value,'block','Only the enabled theme intentionally overrides HTML hidden.');
assert.match(active['clip-path'].value,/calc\(\.37em \+ 2px\)/,'Enabled cut print shows only its narrow fragment.');
assert.equal(print.display.value,'none');assert(print.display.important,'Printing keeps one readable source.');
assert.equal(motion.animation.value,'none','Reduced motion retains static typography.');
console.log('PASS: actual SignalType DOM stays readable once without CSS; enabled digital cuts remain clipped/noninteractive, off/print hide clones, and reduced motion is static.');
