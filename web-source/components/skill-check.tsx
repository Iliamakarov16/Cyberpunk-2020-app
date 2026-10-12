'use client';

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Dice5, RotateCcw } from 'lucide-react';
import { equipment, STATS, STAT_LABELS, type CharacterData, type Skill, type Stat } from '@/lib/tracker';
import { resolveSkillCheck, rollSkillCheck, type CheckResult } from '@/lib/dice';

type Props = { data: CharacterData; skill?: Skill };

export function SkillCheck({ data, skill }: Props) {
  const id = useId();
  const findSkill = () => skill ? data.skills.findIndex(s => s === skill || (s.name === skill.name && s.stat === skill.stat && s.rank === skill.rank)) : -1;
  const [skillIndex, setSkillIndex] = useState(findSkill);
  const [stat, setStat] = useState<Stat>(skill?.stat ?? 'REF');
  const [modifier, setModifier] = useState('0');
  const [difficulty, setDifficulty] = useState('');
  const [mode, setMode] = useState<'app' | 'physical'>('app');
  const [natural, setNatural] = useState('');
  const [extra, setExtra] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState('');
  const computed = useMemo(() => equipment(data), [data]);
  const selected = data.skills[skillIndex];
  const rank = selected?.rank ?? 0;
  const statValue = computed.stats[stat];
  const naturalValue = natural === '' ? null : Number(natural);
  const needsExtra = naturalValue === 1 || naturalValue === 10;
  const prefix = id.replaceAll(':', '');
  const clear = () => { setResult(null); setError(''); };

  useEffect(() => {
    setSkillIndex(findSkill());
    setStat(skill?.stat ?? 'REF');
    setResult(null);
    setError('');
  }, [skill]);
  useEffect(() => { setResult(null); }, [data]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      if (modifier.trim() === '') throw new Error('Укажи модификатор: 0, если поправок нет.');
      const input = { stat: statValue, rank, modifier: Number(modifier), difficulty: difficulty === '' ? null : Number(difficulty) };
      if (mode === 'app') {
        setResult(rollSkillCheck(input));
      } else {
        if (natural === '') throw new Error('Введи результат своего d10.');
        if (needsExtra && extra === '') throw new Error('Брось и введи ещё один d10.');
        setResult(resolveSkillCheck(input, Number(natural), needsExtra ? Number(extra) : undefined));
      }
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : 'Не удалось провести проверку.');
    }
  }

  return <div className="check-tool">
    <p className="check-intro">Скажи, что делает персонаж. Ведущий выберет навык, характеристику и сложность. После этого бросай.</p>
    <form className="check-form" onSubmit={submit}>
      <div className="check-fields">
        <div className="check-field">
          <label htmlFor={`${prefix}-skill`}>Навык</label>
          <select id={`${prefix}-skill`} value={selected ? skillIndex : -1} onChange={event => {
            const index = Number(event.target.value); setSkillIndex(index);
            if (data.skills[index]) setStat(data.skills[index].stat);
            clear();
          }}>
            <option value={-1}>Без навыка · ранг 0</option>
            {data.skills.map((s, index) => <option key={`${s.name}-${index}`} value={index}>{s.name} · {s.stat} +{s.rank}</option>)}
          </select>
          <span className="check-note">Для проверки используй один подходящий навык. Согласуй проверку без навыка с ведущим.</span>
        </div>
        <div className="check-field">
          <label htmlFor={`${prefix}-stat`}>Характеристика · STAT</label>
          <select id={`${prefix}-stat`} value={stat} onChange={event => { setStat(event.target.value as Stat); clear(); }}>
            {STATS.map(key => <option key={key} value={key}>{key} · {STAT_LABELS[key]} · {computed.stats[key]}</option>)}
          </select>
          <span className="check-note">Из экипировки уже учтены бонусы и EV брони. Не добавляй их повторно.</span>
        </div>
        <div className="check-field">
          <label htmlFor={`${prefix}-modifier`}>Поправка к броску</label>
          <input id={`${prefix}-modifier`} type="number" step="1" min="-99" max="99" value={modifier} onChange={event => { setModifier(event.target.value); clear(); }} required aria-describedby={`${prefix}-modifier-help`} />
          <span id={`${prefix}-modifier-help`} className="check-note">0 без поправок; например −2 за штраф или +1 за преимущество, которое разрешил ведущий.</span>
        </div>
        <div className="check-field">
          <label htmlFor={`${prefix}-difficulty`}>Сложность от ведущего</label>
          <input id={`${prefix}-difficulty`} type="number" inputMode="numeric" step="1" min="1" max="999" placeholder="Можно оставить пустой" value={difficulty} onChange={event => { setDifficulty(event.target.value); clear(); }} aria-describedby={`${prefix}-difficulty-help`} />
          <span id={`${prefix}-difficulty-help`} className="check-note">Итог, равный сложности, — успех. Без сложности приложение покажет только итог.</span>
        </div>
      </div>

      <div className="check-formula" aria-label="Формула проверки">
        <span>{stat} <b>{statValue}</b></span><span aria-hidden="true">+</span>
        <span>Навык <b>{rank}</b></span><span aria-hidden="true">+</span>
        <span>Поправка <b>{modifier || '…'}</b></span><span aria-hidden="true">+</span><span><b>d10</b></span>
      </div>

      <fieldset className="check-mode">
        <legend>Как бросаем</legend>
        <label className="check-choice"><input type="radio" name={`${prefix}-mode`} value="app" checked={mode === 'app'} onChange={() => { setMode('app'); clear(); }} /><span>В приложении</span></label>
        <label className="check-choice"><input type="radio" name={`${prefix}-mode`} value="physical" checked={mode === 'physical'} onChange={() => { setMode('physical'); clear(); }} /><span>Настоящий кубик</span></label>
      </fieldset>

      {mode === 'physical' && <div className="check-physical">
        <div className="check-field">
          <label htmlFor={`${prefix}-natural`}>Результат первого d10</label>
          <input id={`${prefix}-natural`} type="number" inputMode="numeric" min="1" max="10" step="1" required value={natural} onChange={event => { setNatural(event.target.value); setExtra(''); clear(); }} />
          <span className="check-note">Если на твоём d10 грани 0–9 и выпал «0», введи 10.</span>
        </div>
        {needsExtra && <div className="check-field">
          <label htmlFor={`${prefix}-extra`}>{naturalValue === 1 ? 'Дополнительный d10 для таблицы промахов' : 'Один дополнительный d10 к итогу'}</label>
          <input id={`${prefix}-extra`} type="number" inputMode="numeric" min="1" max="10" step="1" required value={extra} onChange={event => { setExtra(event.target.value); clear(); }} />
          <span className="check-note">{naturalValue === 1 ? 'Первый бросок 1 — автоматический провал. Этот кубик определяет последствие по таблице, а не уменьшает итог.' : 'Добавь второй результат к итогу. Даже если снова выпало 10, третьего броска нет.'}</span>
        </div>}
      </div>}

      {error && <p className="check-error" role="alert">{error}</p>}
      <button type="submit" className="check-roll"><Dice5 size={20} aria-hidden="true" />{mode === 'app' ? result ? 'Бросить ещё раз' : 'Бросить d10' : 'Посчитать результат'}</button>
    </form>

    {result && <section className={`check-result check-result-${result.outcome}`} aria-live="polite" aria-atomic="true">
      <div className="check-result-heading"><span>{result.outcome === 'fumble' ? 'Автоматический провал' : result.outcome === 'success' ? 'Успех' : result.outcome === 'failure' ? 'Неудача' : 'Итог проверки'}</span><b>{result.outcome === 'fumble' ? '1' : result.total}</b></div>
      <p className="check-result-dice">На d10: <strong>{result.natural}</strong>{result.bonus !== null && <> · дополнительный d10: <strong>{result.bonus}</strong></>}</p>
      {result.outcome === 'fumble' ? <>
        <p>На первом d10 выпала 1: проверка провалена независимо от STAT и навыка.</p>
        <p>Бросок для таблицы промахов: <strong>{result.fumble}</strong>. Покажи ведущему: он определит последствие по виду действия (Core, с. 42–43). Этот кубик не вычитается из суммы.</p>
      </> : <>
        <p className="check-result-sum">{result.stat} + {result.rank} + ({result.modifier}) + {result.natural}{result.bonus !== null ? ` + ${result.bonus}` : ''} = <strong>{result.total}</strong></p>
        <p>{result.difficulty === null ? 'Узнай у ведущего, хватает ли этого итога. Сложность пока не указана.' : `Сложность: ${result.difficulty}. ${result.total >= result.difficulty ? 'Итог достиг сложности.' : 'Итог ниже сложности.'}`}</p>
        {result.bonus !== null && <p>Первая 10 дала ровно один дополнительный d10. Успех зависит от итоговой суммы.</p>}
      </>}
      <button type="button" className="check-clear" onClick={() => { clear(); setNatural(''); setExtra(''); }}><RotateCcw size={16} aria-hidden="true" />Очистить результат</button>
    </section>}

    <details className="check-rules">
      <summary>Что ещё проверить перед броском</summary>
      <p>Раны, освещение, расстояние, режим стрельбы и другие условия могут менять бросок. Здесь они не рассчитываются: согласуй поправку с ведущим и введи её выше.</p>
      <p>LUCK не прибавляется автоматически. Если тратишь Удачу, сначала согласуй расход, внеси её в поправку и отметь остаток в заметках. Здесь бросок не расходует ресурсы и не меняет персонажа.</p>
      <p>Для особой способности роли и специальных проверок используй её собственное правило. Обычная формула не заменяет урон, спасброски, инициативу или правила Сети.</p>
      <p>Основа: Cyberpunk 2020 Core, с. 41–43. Для встречной проверки сравни итоги с ведущим; при равенстве выигрывает защищающийся.</p>
    </details>
  </div>;
}

export default SkillCheck;
