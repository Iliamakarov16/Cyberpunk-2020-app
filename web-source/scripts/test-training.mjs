import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json',import.meta.url));
const ts = require('typescript');
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText;

// A small, explicit hook harness. It executes the actual component and its event handlers.
// It is not a browser layout, assistive-technology or physical-device test.
const state = new Map();
let scope;
globalThis.__trainingReact = {
  createElement(type, props, ...children) { return { type, props: { ...(props || {}), children } }; },
  useState(initial) {
    const values = state.get(scope.key) || [];
    state.set(scope.key, values);
    const index = scope.cursor++;
    if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
    return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }];
  },
  useRef(initial) { return this.useState({ current: initial })[0]; },
  useId() { return this.useState('training-test-id')[0]; },
  useEffect() {},
};
const fakeReact = url('const r=globalThis.__trainingReact; export default r; export const useState=r.useState.bind(r),useRef=r.useRef.bind(r),useId=r.useId.bind(r),useEffect=r.useEffect.bind(r);');
const icons = ['ArrowLeft','ArrowRight','Check','CheckCircle2','ChevronRight','Cpu','Dice5','FileText','KeyRound','LockKeyhole','Radio','RotateCcw','Shield','Target','X'];
const fakeIcons = url(icons.map(name => `export const ${name} = props => ({type:'svg',props:{...props,children:[]}});`).join('\n'));
const fakeSettings = url('export const usePlayerSettings = () => ({tutorial:true,hints:true,animations:false});');
const dice = url(transpile(await readFile(new URL('../lib/dice.ts',import.meta.url), 'utf8')));
let source = await readFile(new URL('../components/training-lab.tsx', import.meta.url), 'utf8');
source = source.replace("from 'react'", `from '${fakeReact}'`).replace("from 'lucide-react'", `from '${fakeIcons}'`).replace("from '@/lib/dice'", `from '${dice}'`).replace("from '@/components/player-help'", `from '${fakeSettings}'`);
const { TrainingLab } = await import(url(transpile(source)));
let topic = 'combat';
let closed = 0;
let tree;
let fetches = 0;
globalThis.fetch = () => { fetches++; throw new Error('Training must not make requests'); };
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Training must not persist private state'); } });

function materialize(node, path = 'root') {
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((item, index) => materialize(item, path + '/' + index));
  if (typeof node.type === 'function') {
    const previous = scope;
    scope = { key: path + '/' + node.type.name + ':' + (node.props.key || ''), cursor: 0 };
    const rendered = node.type(node.props);
    scope = previous;
    return materialize(rendered, path + '/content');
  }
  return { ...node, props: { ...node.props, children: materialize(node.props.children, path + '/children') } };
}
function render() {
  tree = materialize({ type: TrainingLab, props: { topic, onClose: () => { closed++; }, children: [] } });
  return tree;
}
function all(node = tree, result = []) {
  if (node == null || typeof node !== 'object') return result;
  if (Array.isArray(node)) { for (const item of node) all(item, result); return result; }
  result.push(node);
  all(node.props.children, result);
  return result;
}
function text(node = tree) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  return text(node.props.children);
}
function button(label) { return all().find(node => node.type === 'button' && (text(node).includes(label) || node.props['aria-label'] === label)); }
function click(label) { const node = button(label); assert(node, `Missing button: ${label}`); assert(!node.props.disabled, `Disabled: ${label}`); node.props.onClick(); render(); }
function step(expected) { assert(text().replace(/\s+/g, ' ').includes('ШАГ ' + String(expected).padStart(2, '0')), `Expected step ${expected}: ${text()}`); }
function manualDie(value) {
  const input = all().find(node => node.type === 'input');
  assert(input);
  input.props.onChange({ target: { value: String(value) } });
  render();
  click('Принять');
}
function startCombat() {
  topic = 'combat'; state.clear(); render(); step(1);
  assert.equal(tree.props['data-tour'], 'training-combat');
  click('Охранник у двери'); step(2);
  const textarea = all().find(node => node.type === 'textarea');
  textarea.props.onChange({ target: { value: '   ' } }); render();
  assert(button('Готово, дальше').props.disabled);
  all().find(node => node.type === 'textarea').props.onChange({ target: { value: 'Стреляю в охранника.' } }); render();
  click('Готово, дальше'); step(3);
  click('Отправить действие'); step(4);
  assert(text().includes('НЕ СМЕНА РОЛИ'));
  click('Показать ответ ГМа'); step(5);
  const input = all().find(node => node.type === 'input');
  input.props.onChange({ target: { value: '0' } }); render(); assert(button('Принять').props.disabled);
}

for (const [first, extra, outcome] of [[5, null, 'достигает'], [2, null, 'прошёл рядом'], [1, 4, 'сорвался'], [10, 10, 'достигает']]) {
  startCombat(); manualDie(first);
  if (extra !== null) { step(5); manualDie(extra); }
  step(6); assert(!button('Принять'), 'No third die after one extra roll');
  click('Показать описание ГМа'); step(7);
  assert(text().includes(outcome));
  if (first === 10) assert(text().includes('Итог: 30'));
  click('Пройти ещё раз'); step(1);
}

for (const [value, expected] of [[1, 'дверь открывается'], [10, 'Дверь остаётся закрытой']]) {
  topic = 'net'; state.clear(); render(); step(1);
  assert.equal(tree.props['data-tour'], 'training-net');
  click('Подключиться'); step(2);
  click('Расписание смен'); assert(button('Работать с дверью').props.disabled); assert(text().includes('READ'));
  click('Watchdog'); assert(button('Работать с дверью').props.disabled); assert(text().includes('Anti-IC'));
  click('Дверь склада'); click('Работать с дверью'); step(3);
  click('Codecracker'); assert(button('Подготовить заявку').props.disabled);
  click('Open Sesame'); click('Подготовить заявку'); step(4);
  click('Отправить заявку'); step(5); click('Показать ответ ГМа'); step(6);
  manualDie(value); step(7); assert(!button('Принять'), 'Controller uses its own check, no extra die for 1 or 10');
  click('Показать описание ГМа'); step(8);
  click('Активировать Imp'); step(9);
  click('Codecracker'); step(9);
  click('Open Sesame'); step(10);
  assert(text().includes(expected));
  assert(text().includes('выбрана одна подпрограмма'));
  // Switching topic on an existing mount must start clean instead of indexing a shorter lesson.
  topic = 'combat'; render(); step(1);
  assert(!text().includes('ОТВЕТ СИСТЕМЫ'));
}
click('Закрыть тренировку'); assert.equal(closed, 1);
assert.equal(fetches, 0);
console.log('PASS: sequential combat (success, failure, 1, 10), NET Controller (1 and 10), target/program matching, Demon choice, replay/topic reset, no network or persistence.');
