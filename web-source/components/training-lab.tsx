'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, Cpu, Dice5, FileText, KeyRound, LockKeyhole, Radio, RotateCcw, Shield, Target, X } from 'lucide-react';
import { rollD10, resolveSkillCheck, type CheckResult } from '@/lib/dice';
import { usePlayerSettings } from '@/components/player-help';

type Topic = 'combat' | 'net';
type NetNode = 'door' | 'file' | 'ic';
type Program = 'open' | 'code' | 'killer';
type LessonStep = { title: string; body: string; cue: string };

const COMBAT_STEPS: LessonStep[] = [
  { title: 'Сначала выбери цель', body: 'Ведущий показывает доступные цели. Здесь он уже описал охранника в дверях. Выбор на телефоне помогает понять, о ком речь.', cue: 'Нажми на охранника.' },
  { title: 'Опиши, что делаешь', body: 'В игре сначала говоришь за столом. В заявке коротко записываешь действие, чтобы ведущий мог его проверить.', cue: 'Оставь свой вариант или используй готовый пример.' },
  { title: 'Отправь действие ведущему', body: 'Это заявка. Само нажатие ещё не означает попадание и не списывает боеприпасы.', cue: 'Нажми «Отправить действие».' },
  { title: 'Дождись решения ведущего', body: 'В настоящей игре подтверждает ГМ со своего устройства. Здесь его ответ заранее написан для урока.', cue: 'Покажи учебный ответ ГМа.' },
  { title: 'Теперь бросок', body: 'Учебный пример: REF 6 + Пистолет 4 + d10; поправка 0, сложность 15. Дистанцию, помехи и остальные поправки в игре задаёт ГМ.', cue: 'Брось d10 здесь или введи результат своего кубика.' },
  { title: 'Результат описывает ведущий', body: 'Приложение показывает бросок. Ведущий решает, что произошло в сцене, и согласует урон, броню и ранения.', cue: 'Посмотри учебное описание результата.' },
  { title: 'Ты прошёл одно действие', body: 'Цель → описание → заявка → подтверждение → бросок → рассказ ГМа. В бою этот порядок повторяется для новых действий.', cue: 'Урок можно пройти ещё раз.' },
];

const NET_STEPS: LessonStep[] = [
  { title: 'Сначала доступ к системе', body: 'У тебя есть подключение к учебной Data Fortress. Ведущий подтвердил точку входа. Нельзя выбрать любой предмет в городе и считать его доступным через NET.', cue: 'Подтверди подключение к учебной системе.' },
  { title: 'Выбери подходящую цель', body: 'В этой системе есть файл, охранная программа и контроллер двери. Сейчас задача — открыть складскую дверь.', cue: 'Выбери контроллер двери. Другие объекты можно изучить.' },
  { title: 'Подбери нужную функцию', body: 'Controller работает с подходящим устройством через CONTROL REMOTE. Decryption взламывает кодовые ворота и замки файлов, Anti-IC атакует программы.', cue: 'Для двери выбери Open Sesame.' },
  { title: 'Передай намерение ведущему', body: 'Ты сообщаешь цель, выбранный инструмент и желаемый результат. Ведущий проверяет доступность и обстоятельства.', cue: 'Отправь учебную заявку.' },
  { title: 'Ведущий подтверждает условия', body: 'В этом примере контроллер двери доступен, Open Sesame подходит. ГМ просит проверку Controller: d10 не выше STR программы.', cue: 'Покажи учебное подтверждение ГМа.' },
  { title: 'В NET бывают другие проверки', body: 'У Open Sesame STR 3. Для этого Controller результат 1–3 на d10 успешен. Это отдельная проверка, не d10 + STAT + навык.', cue: 'Брось d10 здесь или введи свой результат.' },
  { title: 'Что изменилось в сцене?', body: 'Ведущий описывает результат и реакцию системы. Телефон помогает передать действие, но не решает за него все последствия.', cue: 'Посмотри учебный ответ системы.' },
  { title: 'Теперь попробуем Demon', body: 'Demon хранит несколько программ как подпрограммы. В учебную деку заранее загружен Imp с двумя: Open Sesame и Codecracker.', cue: 'Активируй учебный Imp.' },
  { title: 'Выбери одну подпрограмму', body: 'Demon не запускает весь набор одним действием. После активации указываешь нужную подпрограмму. Сейчас снова выбираем контроллер двери.', cue: 'Запусти Open Sesame внутри Imp.' },
  { title: 'Основной порядок понятен', body: 'Доступная система → подходящая цель → нужная функция или программа → согласование с ГМ → нужная проверка → описание результата.', cue: 'Урок можно пройти ещё раз.' },
];

const PROGRAMS: { id: Program; name: string; category: string; description: string; icon: React.ElementType }[] = [
  { id: 'open', name: 'Open Sesame', category: 'CONTROLLER · STR 3', description: 'Двери, лифты и похожие доступные устройства.', icon: KeyRound },
  { id: 'code', name: 'Codecracker', category: 'DECRYPTION · STR 3', description: 'Кодовые ворота и замки файлов.', icon: LockKeyhole },
  { id: 'killer', name: 'Killer', category: 'ANTI-IC', description: 'Охранные и другие программы, а не дверной механизм.', icon: Shield },
];

function parsedDie(value: string): number | null {
  if (!/^(?:[1-9]|10)$/.test(value.trim())) return null;
  return Number(value);
}

function combatNarration(result: CheckResult): string {
  if (result.outcome === 'fumble') return '«Выстрел сорвался. По броску осложнения решим, что помешало: ты поторопился, оружие подвело или ситуация изменилась. Охранник успел отступить за дверь».';
  if (result.outcome === 'success') return '«Выстрел достигает охранника. Теперь бросаем урон выбранного оружия и проверяем зону попадания, броню и ранения по правилам. Я опишу последствия после этих расчётов».';
  return '«Выстрел прошёл рядом: охранник успел нырнуть за дверь. Ты услышал, как пуля ударила в косяк. Он теперь знает, где ты».';
}

function LocalDie({ label, value, setValue, onSubmit, busy = false }: { label: string; value: string; setValue: (value: string) => void; onSubmit: (value: number) => void; busy?: boolean }) {
  const id = useId();
  const valid = parsedDie(value);
  const [error, setError] = useState('');
  function draw() {
    try {
      const result = rollD10();
      setValue(String(result));
      setError('');
      onSubmit(result);
    } catch {
      setError('Бросок здесь недоступен. Брось свой d10 и введи результат ниже.');
    }
  }
  return <div className="training-die-control">
    <button type="button" className="training-primary" data-tour="training-roll" disabled={busy} onClick={draw}><Dice5 aria-hidden="true"/>Бросить d10 здесь</button>
    <div className="training-manual-die"><label htmlFor={id}>{label}</label><div><input id={id} inputMode="numeric" type="text" maxLength={2} placeholder="1–10" value={value} disabled={busy} onChange={e => { setValue(e.target.value); setError(''); }} aria-describedby={`${id}-help`} onKeyDown={e => { if (e.key === 'Enter' && valid !== null) { e.preventDefault(); onSubmit(valid); } }}/><button type="button" disabled={busy || valid === null} onClick={() => valid !== null && onSubmit(valid)}>Принять <Check aria-hidden="true"/></button></div><small id={`${id}-help`}>Результат физического d10: целое число от 1 до 10.</small></div>
    {error && <p className="training-feedback" role="alert">{error}</p>}
  </div>;
}

/** An isolated, explicitly scripted lesson. It never calls APIs, writes storage or edits a sheet. */
export function TrainingLab({ topic, onClose }: { topic: Topic; onClose: () => void }) {
  return <TrainingLabLesson key={topic} topic={topic} onClose={onClose}/>;
}

function TrainingLabLesson({ topic, onClose }: { topic: Topic; onClose: () => void }) {
  const settings = usePlayerSettings();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const [description, setDescription] = useState('Стреляю из пистолета в охранника, пока он стоит в дверях.');
  const [dieInput, setDieInput] = useState('');
  const [extraInput, setExtraInput] = useState('');
  const [natural, setNatural] = useState<number | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [controllerDie, setControllerDie] = useState<number | null>(null);
  const [selectedNode, setSelectedNode] = useState<NetNode | null>(null);
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);
  const [feedback, setFeedback] = useState('');
  const [events, setEvents] = useState<{ actor: string; text: string }[]>([]);
  const steps = topic === 'combat' ? COMBAT_STEPS : NET_STEPS;
  const current = steps[step];
  const complete = step === steps.length - 1;
  const activeAnchor = topic === 'combat'
    ? ['training-target', 'training-description', 'training-submit', 'training-approve', 'training-roll', 'training-resolve', 'training-replay'][step]
    : ['training-net-connect', 'training-net-node', 'training-net-program', 'training-submit', 'training-approve', 'training-roll', 'training-resolve', 'training-net-demon', 'training-net-subroutine', 'training-replay'][step];

  function reset() {
    setStep(0); setDescription('Стреляю из пистолета в охранника, пока он стоит в дверях.'); setDieInput(''); setExtraInput(''); setNatural(null); setResult(null); setControllerDie(null); setSelectedNode(null); setSelectedProgram(null); setFeedback(''); setEvents([]);
  }
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step, topic]);
  function next(actor?: string, text?: string) { if (actor && text) setEvents(list => [...list, { actor, text }]); setFeedback(''); setStep(value => Math.min(value + 1, steps.length - 1)); }
  function firstCombatDie(value: number) {
    setNatural(value);
    if (value === 1 || value === 10) return;
    setResult(resolveSkillCheck({ stat: 6, rank: 4, modifier: 0, difficulty: 15 }, value));
    next('Кубик', `d10 = ${value}; REF 6 + Пистолет 4 + ${value} = ${10 + value}.`);
  }
  function extraCombatDie(value: number) {
    if (natural !== 1 && natural !== 10) return;
    const check = resolveSkillCheck({ stat: 6, rank: 4, modifier: 0, difficulty: 15 }, natural, value);
    setResult(check);
    next('Кубик', natural === 1 ? `На d10 — 1: проверка провалена. Отдельный бросок осложнения: ${value}.` : `На d10 — 10; дополнительный d10 — ${value}. Итог: ${check.total}.`);
  }
  function chooseNode(node: NetNode) {
    setSelectedNode(node);
    if (node === 'door') { setFeedback('Нужная цель. Это доступный контроллер двери.'); return; }
    setFeedback(node === 'file' ? 'Это открытый файл: его читают командой READ. Для замка файла нужна Decryption. Урок сейчас про управление дверью — выбери её контроллер.' : 'Это охранная программа. Против программ используют подходящую Anti-IC; управление дверью — другая задача. Выбери контроллер двери.');
  }
  function chooseProgram(program: Program) {
    setSelectedProgram(program);
    setFeedback(program === 'open' ? 'Верно: Open Sesame — Controller для дверей. В этой сцене используется CONTROL REMOTE.' : program === 'code' ? 'Codecracker работает с кодовыми воротами и замками файлов. Контроллер двери требует Controller: здесь это Open Sesame.' : 'Killer атакует программы. Для команды дверному механизму здесь нужен Open Sesame.');
  }

  const stepAlias = topic === 'combat'
    ? ({ 0: 'combat-training-target', 1: 'combat-training-action', 2: 'combat-training-action', 4: 'combat-training-roll', 5: 'combat-training-result', 6: 'combat-training-result' } as Record<number, string>)[step]
    : ({ 0: 'net-training-deck', 1: 'net-training-target', 2: 'net-training-program', 6: 'net-training-result', 7: 'net-training-deck', 8: 'net-training-program', 9: 'net-training-result' } as Record<number, string>)[step];

  return <section className={`training-lab ${settings.animations ? 'training-motion' : ''}`} data-tour={topic === 'combat' ? 'training-combat' : 'training-net'} aria-labelledby={`${id}-title`} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
    <header className="training-header"><div><span className="training-eyebrow">ТРЕНИРОВКА / ЛОКАЛЬНЫЙ ПРИМЕР</span><h2 id={`${id}-title`}>{topic === 'combat' ? 'Одно действие в бою' : 'Первый шаг в NET'}</h2></div><button className="training-icon-button" type="button" aria-label="Закрыть тренировку" onClick={onClose}><X/></button></header>
    <p className="training-safe-note"><Shield aria-hidden="true"/>Здесь всё учебное: броски, цели и ГМ. Лист и кампания не изменяются.</p>
    <div className="training-progress" aria-label={`Шаг ${step + 1} из ${steps.length}`}><span>ШАГ {String(step + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</span><div aria-hidden="true">{steps.map((_, index) => <i key={index} className={index < step ? 'done' : index === step ? 'current' : ''}/>)}</div></div>
    <div className="training-instruction" aria-live="polite" aria-atomic="true"><h3 ref={heading} tabIndex={-1}>{current.title}</h3><p>{current.body}</p><strong><ChevronRight aria-hidden="true"/>{current.cue}</strong></div>
    <div className="training-stage" data-active-tour={activeAnchor} data-tour={stepAlias}>
      {topic === 'combat' && <>
        {step === 0 && <button type="button" className="training-target-card training-highlight" data-tour="training-target" onClick={() => next('Игрок', 'Выбрана цель: охранник у двери.')}><span className="training-target-symbol"><Target aria-hidden="true"/></span><span><small>ДОСТУПНАЯ ЦЕЛЬ</small><strong>Охранник у двери</strong><span>Виден. На расстоянии, указанном учебным ГМ.</span></span><ArrowRight aria-hidden="true"/></button>}
        {step === 1 && <div className="training-highlight training-input-card"><label htmlFor={`${id}-description`}>Твоё действие</label><textarea id={`${id}-description`} data-tour="training-description" maxLength={600} rows={4} value={description} onChange={e => setDescription(e.target.value)}/><small>Ведущий уточнит, возможно ли действие и какая проверка нужна.</small><button type="button" className="training-primary" disabled={!description.trim()} onClick={() => next()}><ArrowRight aria-hidden="true"/>Готово, дальше</button></div>}
        {step === 2 && <div className="training-action-card"><span className="training-chip">ЗАЯВКА ИГРОКА</span><strong>Охранник у двери</strong><p>{description}</p><button type="button" className="training-primary training-highlight" data-tour="training-submit" onClick={() => next('Игрок', description)}><Radio aria-hidden="true"/>Отправить действие</button></div>}
        {step === 3 && <div className="training-gm-card"><span className="training-chip">СЦЕНАРНЫЙ ГМ · НЕ СМЕНА РОЛИ</span><p>Заявка доставлена. В настоящей кампании ты ждёшь ответа своего ведущего.</p><button type="button" className="training-primary training-highlight" data-tour="training-approve" onClick={() => next('Учебный ГМ', 'Действие допустимо. REF 6, Пистолет 4, поправка 0, сложность 15. Бросай d10.')}><Check aria-hidden="true"/>Показать ответ ГМа</button></div>}
        {step === 4 && <div className="training-roll-card training-highlight"><div className="training-formula"><span>REF <b>6</b></span><i>+</i><span>Пистолет <b>4</b></span><i>+</i><span>d10 <b>{natural ?? '?'}</b></span></div><p className="training-difficulty">Сложность: <strong>15</strong> · поправка: <strong>0</strong></p>{natural === null ? <LocalDie label="Я бросил свой кубик" value={dieInput} setValue={setDieInput} onSubmit={firstCombatDie}/> : <><p className="training-feedback">{natural === 1 ? 'На первом d10 — 1. Это провал, независимо от суммы. Второй d10 определяет осложнение для ведущего.' : 'На первом d10 — 10. Прибавь один дополнительный d10; если и на нём 10, третьего броска здесь нет.'}</p><LocalDie label={natural === 1 ? 'Мой бросок осложнения' : 'Мой дополнительный d10'} value={extraInput} setValue={setExtraInput} onSubmit={extraCombatDie}/></>}</div>}
        {step === 5 && result && <div className="training-gm-card"><span className="training-chip">БРОСОК ПЕРЕДАН ГМУ</span><div className="training-result-number">{result.outcome === 'fumble' ? 'ПРОВАЛ' : result.total}<small>{result.outcome === 'fumble' ? `Осложнение: ${result.fumble}` : `при сложности ${result.difficulty}`}</small></div><button type="button" className="training-primary training-highlight" data-tour="training-resolve" onClick={() => next('Учебный ГМ', combatNarration(result))}><FileText aria-hidden="true"/>Показать описание ГМа</button></div>}
      </>}
      {topic === 'net' && <>
        {step === 0 && <div className="training-net-system"><span className="training-chip">ДОСТУП ПОДТВЕРЖДЁН УЧЕБНЫМ ГМ</span><h4><Cpu aria-hidden="true"/>Склад / Data Fortress</h4><p>Есть согласованная точка подключения и видимая часть системы. Это схема для урока, а не полная карта NET.</p><button type="button" className="training-primary training-highlight" data-tour="training-net-connect" onClick={() => next('Игрок', 'Подключаюсь к доступной учебной системе склада.')}><Radio aria-hidden="true"/>Подключиться</button></div>}
        {step === 1 && <><div className="training-node-grid" data-tour="training-net-node">{([{ id: 'door', title: 'Дверь склада', label: 'УСТРОЙСТВО', icon: KeyRound, text: 'Доступный контроллер' }, { id: 'file', title: 'Расписание смен', label: 'ФАЙЛ', icon: FileText, text: 'Открытая запись' }, { id: 'ic', title: 'Watchdog', label: 'ПРОГРАММА', icon: Shield, text: 'Охрана системы' }] as const).map(node => <button type="button" key={node.id} aria-pressed={selectedNode === node.id} className={`training-choice ${selectedNode === node.id ? 'selected' : ''} ${node.id === 'door' ? 'training-highlight' : ''}`} onClick={() => chooseNode(node.id)}><node.icon aria-hidden="true"/><small>{node.label}</small><strong>{node.title}</strong><span>{node.text}</span></button>)}</div>{feedback && <p className="training-feedback" role="status">{feedback}</p>}<button type="button" className="training-primary" disabled={selectedNode !== 'door'} onClick={() => next('Игрок', 'Цель: доступный контроллер складской двери.')}><ArrowRight aria-hidden="true"/>Работать с дверью</button></>}
        {step === 2 && <><div className="training-program-list" data-tour="training-net-program">{PROGRAMS.map(program => <button type="button" key={program.id} className={`training-program training-choice ${selectedProgram === program.id ? 'selected' : ''} ${program.id === 'open' ? 'training-highlight' : ''}`} aria-pressed={selectedProgram === program.id} onClick={() => chooseProgram(program.id)}><program.icon aria-hidden="true"/><span><small>{program.category}</small><strong>{program.name}</strong><span>{program.description}</span></span>{selectedProgram === program.id && <Check aria-hidden="true"/>}</button>)}</div>{feedback && <p className="training-feedback" role="status">{feedback}</p>}<button type="button" className="training-primary" disabled={selectedProgram !== 'open'} onClick={() => next('Игрок', 'Выбираю Open Sesame через CONTROL REMOTE.')}><ArrowRight aria-hidden="true"/>Подготовить заявку</button></>}
        {step === 3 && <div className="training-action-card"><span className="training-chip">CONTROL REMOTE</span><strong>Открыть складскую дверь</strong><p>Цель: контроллер двери. Программа: Open Sesame, STR 3.</p><button type="button" className="training-primary training-highlight" data-tour="training-submit" onClick={() => next('Игрок', 'Прошу открыть дверь через доступный контроллер программой Open Sesame.')}><Radio aria-hidden="true"/>Отправить заявку</button></div>}
        {step === 4 && <div className="training-gm-card"><span className="training-chip">СЦЕНАРНЫЙ ГМ · НЕ СМЕНА РОЛИ</span><p>Ведущий проверяет доступность цели и подходящую программу.</p><button type="button" className="training-primary training-highlight" data-tour="training-approve" onClick={() => next('Учебный ГМ', 'Контроллер доступен, программа подходит. Для Open Sesame брось d10: успех, если результат не выше STR 3.')}><Check aria-hidden="true"/>Показать ответ ГМа</button></div>}
        {step === 5 && <div className="training-roll-card training-highlight"><div className="training-controller-formula"><Dice5 aria-hidden="true"/><span>d10 ≤ <b>3</b></span></div><p className="training-difficulty">STR Open Sesame: <strong>3</strong></p><LocalDie label="Я бросил свой кубик" value={dieInput} setValue={setDieInput} onSubmit={value => { setControllerDie(value); next('Кубик', `Controller: d10 = ${value}; STR = 3. ${value <= 3 ? 'Успех.' : 'Неуспех.'}`); }}/><small className="training-rule-note">Правило 1/10 из обычной проверки навыка сюда не переносим. Этот урок показывает конкретную проверку Controller из Core.</small></div>}
        {step === 6 && controllerDie !== null && <div className="training-gm-card"><span className="training-chip">ОТВЕТ СИСТЕМЫ ПО БРОСКУ</span><div className="training-result-number">{controllerDie}<small>{controllerDie <= 3 ? 'Не выше 3: успех' : 'Выше 3: неуспех'}</small></div><button type="button" className="training-primary training-highlight" data-tour="training-resolve" onClick={() => next('Учебный ГМ', controllerDie <= 3 ? '«Контроллер принимает команду. Замок щёлкает, складская дверь открывается. Что делает остальная группа?»' : '«Контроллер не выполнил команду. Дверь остаётся закрытой. Ты можешь предложить другой план; последствия и возможность новой попытки обсудим в сцене».')}><FileText aria-hidden="true"/>Показать описание ГМа</button></div>}
        {step === 7 && <div className="training-demon-card"><span className="training-chip">ЗАРАНЕЕ ЗАГРУЖЕННЫЙ УЧЕБНЫЙ НАБОР</span><h4><Cpu aria-hidden="true"/>Imp / Demon Core</h4><div className="training-demon-slots"><span>01 · Open Sesame</span><span>02 · Codecracker</span></div><p>Серийные Demons объединяют 2–5 программ. В этом примере два слота уже заняты: мы не устанавливаем ничего в реальный лист.</p><button type="button" className="training-primary training-highlight" data-tour="training-net-demon" onClick={() => next('Игрок', 'Активирую учебный Imp.')}><Cpu aria-hidden="true"/>Активировать Imp</button></div>}
        {step === 8 && <div className="training-demon-card"><span className="training-chip">IMP АКТИВЕН · ВЫБЕРИ ПОДПРОГРАММУ</span><div className="training-program-list" data-tour="training-net-subroutine">{PROGRAMS.filter(p => p.id !== 'killer').map(program => <button type="button" key={program.id} className={`training-program training-choice ${program.id === 'open' ? 'training-highlight' : ''}`} onClick={() => { if (program.id === 'open') next('Игрок', 'В Imp выбрана одна подпрограмма: Open Sesame. Дальше — согласование цели и проверка Controller, как выше.'); else setFeedback('Codecracker — другая подпрограмма. Для текущей двери выбираем Open Sesame.'); }}><program.icon aria-hidden="true"/><span><small>ПОДПРОГРАММА {program.id === 'open' ? '01' : '02'}</small><strong>{program.name}</strong><span>{program.description}</span></span><ArrowRight aria-hidden="true"/></button>)}</div>{feedback && <p className="training-feedback" role="status">{feedback}</p>}<details className="training-detail"><summary>За компактность есть цена</summary><p>В бою подпрограммы используют Strength ядра Demon. Demon занимает место вместе с набором, а число загруженных подпрограмм влияет на Deck Speed. Если ядро уничтожено, связанные программы тоже теряются. Это учитывает ведущий и лист деки; здесь мы лишь разбираем выбор функции.</p></details></div>}
      </>}
      {complete && <div className="training-complete"><CheckCircle2 aria-hidden="true"/><h4>Можно пробовать в своей группе</h4><p>{topic === 'combat' ? 'Урон оружия, броню, боеприпасы и ранения группа учитывает отдельно. Эта тренировка не симулирует весь бой.' : 'Боевой NET и полноценная дека ещё требуют отдельного игрового модуля. Сейчас в кампании можно согласовывать программные действия с ведущим через сцену.'}</p><div className="training-complete-actions"><button type="button" className="training-primary training-highlight" data-tour="training-replay" onClick={reset}><RotateCcw aria-hidden="true"/>Пройти ещё раз</button><button type="button" onClick={onClose}><ArrowLeft aria-hidden="true"/>Вернуться в приложение</button></div></div>}
    </div>
    {!!events.length && <details className="training-transcript" open={complete}><summary><FileText aria-hidden="true"/>Журнал учебного действия <span>{events.length}</span></summary><ol>{events.map((event, index) => <li key={index}><small>{event.actor}</small><p>{event.text}</p></li>)}</ol></details>}
    <footer className="training-footer"><span>Cyberpunk 2020 · Core{topic === 'net' ? ' / Netrunning, Demonology' : ' / Skill Checks, Friday Night Firefight'}</span>{!complete && <button type="button" onClick={reset}><RotateCcw aria-hidden="true"/>Сначала</button>}</footer>
  </section>;
}
