'use client';
import React from 'react';
import {ArrowUpRight,BookOpen,NotebookPen,Settings2,ShieldCheck,UserRound} from 'lucide-react';
import SignalType from '@/components/signal-type';
import {RecordFooter} from '@/components/record-shell';
type StartMenuProps = {
 onTutorial:(id:string)=>void;
 onCharacters:()=>void;
 onCampaigns:()=>void;
 onLessons:()=>void;
 onSettings:()=>void;
 username?:string;
 characterCount?:number;
};
export default function StartMenu({onTutorial,onCharacters,onCampaigns,onLessons,onSettings,username,characterCount}:StartMenuProps){
 const count=typeof characterCount==='number'&&Number.isFinite(characterCount)?Math.max(0,Math.floor(characterCount)):null;
 return <section className="start-menu nc-terminal-record" aria-label="Главное меню">
  <header className="nc-terminal-top"><span className="nc-terminal-brand">NC<span>2020</span></span><span className="nc-terminal-caption">ЛИЧНЫЙ ТЕРМИНАЛ<small>PERSONAL ACCESS / CREW RECORDS</small></span></header>
  <div className="nc-record-body">
   <div className="nc-record-index"><span>INDEX / 00</span><span>ОПЕРАТОР НА СВЯЗИ</span></div>
   <header className="start-record-header nc-menu-identity"><div><span className="eyebrow">NIGHT CITY / ЛИЧНЫЙ КАНАЛ</span><h1><SignalType>Главное меню</SignalType></h1></div><dl className="start-session-meta">{username&&<div><dt>ОПЕРАТОР</dt><dd>{username}</dd></div>}{count!==null&&<div><dt>ЛИСТОВ</dt><dd>{String(count).padStart(2,'0')}</dd></div>}</dl></header>
   <div className="nc-menu-bank">
    <div className="nc-bank-label"><span>БАНК ЗАПИСЕЙ</span><span>01 / 02</span></div>
    <div className="start-destinations">
     <button data-tour="nav-personal" onClick={onCharacters}>
      <span className="start-destination-number" aria-hidden="true">01</span><UserRound aria-hidden="true"/>
      <span className="start-destination-copy"><strong>Мои персонажи</strong><small>Твои листы, снаряжение и навыки.</small><span className="start-destination-footer">ЛИЧНАЯ КОЛЛЕКЦИЯ / ОТКРЫТЬ</span></span><ArrowUpRight className="start-destination-arrow" aria-hidden="true"/>
     </button>
     <button data-tour="nav-campaigns" onClick={onCampaigns}>
      <span className="start-destination-number" aria-hidden="true">02</span><NotebookPen aria-hidden="true"/>
      <span className="start-destination-copy"><strong>Кампании</strong><small>Группа, игровой стол и записи ведущего.</small><span className="start-destination-footer">ГРУППОВОЙ КАНАЛ / ОТКРЫТЬ</span></span><ArrowUpRight className="start-destination-arrow" aria-hidden="true"/>
     </button>
    </div>
    <section className="start-training" aria-labelledby="start-training-title">
     <div className="start-training-heading"><span className="start-learning-index" aria-hidden="true">03</span><div><h2 id="start-training-title">Впервые здесь?</h2><p>Выбери свой учебный маршрут.</p></div></div>
     <div className="start-learning"><button data-tour="menu-player-tutorial" onClick={()=>onTutorial('player-start')}><UserRound aria-hidden="true"/><span className="start-learning-copy"><strong>Обучение игрока</strong><span>Персонаж, группа и первый ход.</span></span><BookOpen className="start-learning-mark" aria-hidden="true"/></button><button data-tour="menu-gm-tutorial" onClick={()=>onTutorial('gm-start')}><ShieldCheck aria-hidden="true"/><span className="start-learning-copy"><strong>Обучение ведущего</strong><span>Кампания, игровой стол и партия.</span></span><BookOpen className="start-learning-mark" aria-hidden="true"/></button></div>
     <p className="start-training-note">Роль игрока или ведущего назначается отдельно в каждой кампании.</p>
    </section>
    <div className="start-menu-links"><button data-tour="nav-learning" onClick={onLessons}><BookOpen/>Уроки и справка</button><button onClick={onSettings}><Settings2/>Настройки</button></div>
   </div>
  </div>
  <RecordFooter/>
 </section>;
}
