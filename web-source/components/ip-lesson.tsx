'use client';
import React,{useEffect,useRef,useState} from 'react';
import {BookOpen,Check,RotateCcw} from 'lucide-react';
import {skillImprovementCost} from '@/lib/tracker';

const TITLES=['Что такое IP','Как ведущий выдаёт очки','Начисли и потрать в учебном листе'];
export default function IPLesson({onFinish}:{onFinish:()=>void}){
 const [step,setStep]=useState(0),[awarded,setAwarded]=useState(false),[improved,setImproved]=useState(false);
 const heading=useRef<HTMLHeadingElement|null>(null);
 useEffect(()=>{heading.current?.focus();},[step]);
 const cost=skillImprovementCost({rank:4,multiplier:1})!;
 const ip=38+(awarded?3:0)-(improved?cost:0);
 const restart=()=>{setAwarded(false);setImproved(false);setStep(0);};
 return <section className="training-lab ip-lesson" data-tour="training-ip" aria-label="Урок: развитие навыков и IP">
  <header className="training-header"><div><span className="training-eyebrow">ОСНОВЫ ДЛЯ ГМ / CYBERPUNK 2020</span><h2>Развитие навыков и IP</h2></div><button className="training-icon-button" aria-label="Начать урок IP заново" onClick={restart}><RotateCcw/></button></header>
  <p className="training-safe-note"><BookOpen/>Короткий урок для ведущего и игроков. Учебный лист не связан с твоими персонажами.</p>
  <div className="training-progress"><span>ШАГ {String(step+1).padStart(2,'0')} / 03</span><div aria-hidden="true">{TITLES.map((title,index)=><i key={title} className={index===step?'current':index<step?'done':''}/>)}</div></div>
  <div className="ip-lesson-body"><h3 ref={heading} tabIndex={-1}>{TITLES[step]}</h3>
   {step===0&&<>
    <p><strong>IP — Improvement Points, очки улучшения навыков.</strong> В Cyberpunk 2020 персонаж развивает отдельные навыки. Общего уровня героя, как в D&D, здесь нет.</p>
    <div className="ip-concepts"><article><span>РАНГ</span><h4>Насколько хорошо ты умеешь</h4><p>Ранг навыка добавляется к проверке: d10 + характеристика + навык. Обычно он находится в пределах 0–10.</p></article><article><span>IP</span><h4>Сколько накопил на улучшение</h4><p>У каждого навыка свой запас IP. Очки за применение пистолета идут в «Пистолеты», а не в общий кошелёк опыта.</p></article></div>
    <p>Начальные очки при создании персонажа и IP, заработанные во время игры, — разные вещи. Стартовый лист ты уже заполняешь через мастер создания.</p>
   </>}
   {step===1&&<>
    <p>Ведущий определяет награду и называет конкретный навык: «За частое и успешное применение пистолета получаешь 3 IP в “Пистолеты”». Число 3 — пример решения ГМ, а не награда за каждый бросок.</p>
    <ol className="ip-award-guide"><li><strong>Опыт в приключении.</strong> Учитывай применение навыка, удачные решения, отыгрыш и командную работу. Поощряй всех игроков последовательно; бросок сам по себе не начисляет IP.</li><li><strong>Самостоятельная практика.</strong> Игрок описывает, чему и как учится. Core даёт ориентир 1 IP за день и ограничивает самообучение рангом +2.</li><li><strong>Занятия с учителем.</strong> Предметный навык наставника должен быть выше навыка ученика. Найдите время на уроки. Core предлагает обычно 1–5 IP за занятие; предел зависит от навыка учителя и его Teaching.</li></ol>
    <details className="ip-extra"><summary>Сколько давать за приключение?</summary><p>В Core есть таблица ориентиров: частое применение — 1 IP, эффективное — 2, частое и эффективное — 3. Более заметные достижения могут дать больше. Обычно книга рекомендует не выдавать больше 6 IP в один навык за сессию; это рекомендация, а не жёсткий предел.</p><p>Предел занятий с учителем — среднее его предметного навыка и Teaching. Например, при навыке 8 и Teaching 4 он может обучить до ранга 6.</p><p>Можно записывать награды по ходу игры, а сверять их с игроками в конце встречи. Это удобный порядок для группы; сами награды остаются решением ведущего.</p></details>
   </>}
   {step===2&&<>
    <p>У Веги ранг «Пистолетов» 4 и 38 IP в этом навыке. Выдай ей 3 IP из предыдущего примера, затем оплати повышение до 5.</p>
    <div className="ip-demo-sheet" aria-label="Учебные навыки Веги"><article><strong>Пистолеты · Handgun</strong><span>Ранг <b>{improved?5:4}</b> · <b>{ip} IP</b></span><small>Множитель ×1</small></article><article><strong>Первая помощь</strong><span>Ранг 2 · 6 IP</span><small>Свои очки, без изменений</small></article></div>
    <p className="ip-cost"><strong>4 × 10 × 1 = {cost} IP</strong><span>Текущий ранг × 10 × множитель навыка.</span></p>
    <div className="ip-demo-actions"><button className={!awarded?'training-primary':''} disabled={awarded} onClick={()=>setAwarded(true)}>{awarded?<Check/>:null}{awarded?'3 IP начислены':'Выдать 3 IP в «Пистолеты»'}</button><button className={awarded&&!improved?'training-primary':''} disabled={ip<cost||improved} onClick={()=>setImproved(true)}>{improved?<Check/>:null}{improved?'Навык повышен до 5':'Потратить 40 IP: ранг 4 → 5'}</button></div>
    <p className="ip-demo-result" role="status">{improved?'Готово: ранг 5, остался 1 IP в «Пистолетах». Очки «Первой помощи» не менялись.':awarded?'Теперь 41 IP. Хватает на повышение за 40 IP.':'Пока 38 IP: для повышения не хватает 2. Сначала начисли награду.'}</p>
    <details className="ip-extra"><summary>Первый ранг и сложные навыки</summary><p>По тексту Core 2.01 новый навык 0 → 1 стоит 10 IP. Для следующих рангов действует формула выше: навык с множителем ×3 при повышении 4 → 5 требует 120 IP. Множитель указан в описании навыка. Обычный предел ранга — 10.</p></details>
    {improved&&<div className="ip-at-table"><h4>Теперь в настоящей игре</h4><p><strong>ГМ:</strong> назови навык, количество IP и причину награды. Проверь накопленные очки и условия обучения, когда игрок захочет повысить ранг.</p><p><strong>Игрок:</strong> открой персонажа → «Навыки» → нужный навык. При награде увеличь поле «IP навыка». При согласованном повышении вычти цену и прибавь 1 к рангу. Нажми «Применить к листу», затем «Сохранить лист».</p><p>В приложении это ручные изменения. Учебные кнопки показывают порядок действий.</p></div>}
   </>}
  </div>
  <footer className="ip-lesson-footer"><small>Источник: Cyberpunk 2020 · Core 2.01 · стр. 42, 53–54.</small><div>{step>0&&<button onClick={()=>setStep(step-1)}>Предыдущий шаг</button>}{step<2?<button className="training-primary" onClick={()=>setStep(step+1)}>Следующий шаг</button>:<button className="training-primary" disabled={!improved} onClick={onFinish}>Завершить урок</button>}</div></footer>
 </section>;
}
