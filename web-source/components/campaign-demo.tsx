'use client';

import React,{useCallback,useEffect,useRef,useState} from 'react';
import {BookOpen,Check,ChevronRight,RotateCcw,ShieldCheck,UserRound} from 'lucide-react';
import CampaignTerminal from '@/components/campaign-terminal';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import {applyDemoCommand,createDemoState,DEMO_ACCOUNTS,DEMO_CAMPAIGN_ID,demoSnapshot,DemoFailure,type DemoRole,type DemoState} from '@/lib/campaign-demo';

export type CampaignDemoProps={onDirtyChange?:(dirty:boolean)=>void;onBusyChange?:(busy:boolean)=>void};
type Confirmation={title:string;text:string;run:()=>void};

function nextStep(state:DemoState,role:DemoRole):{title:string;body:string;role?:DemoRole}{
 const action=state.data.scene.actions[state.data.scene.actions.length-1];
 if(!state.data.scene.active)return role==='gm'?{title:'Открой сцену',body:'В подготовке сцены выбери «Сохранить и открыть сцену». После этого игрок сможет отправлять намерения.'}:{title:'Сцена закрыта',body:'Ведущий готовит игровую ситуацию. Перейди на его экран и открой приём действий.',role:'gm'};
 if(!action)return role==='gm'?{title:'Сначала посмотри стол глазами игрока',body:'ГМ видит всё поле и готовит ситуацию. Переключись на экран игрока: часть карты и турель за стеной будут скрыты.',role:'player'}:{title:'Выбери цель на поле',body:'Нажми пешку охранника, выбери действие и опиши намерение в форме под картой. Например, попроси пропустить тебя. «Отправить ГМу» создаст заявку; кубики пока не нужны.'};
 if(action.status==='submitted')return role==='gm'?{title:'Рассмотри заявку под полем',body:'Открой карточку в «Заявках участников». «Разрешить действие» позволяет игроку внести кубики. Если намерение невозможно, напиши причину и выбери «Отклонить».'}:{title:'Заявка ждёт ведущего',body:'Намерение отправлено. Переключись на учебный экран ГМа и разреши или отклони его. В настоящей игре это делает другой участник на своём телефоне.',role:'gm'};
 if(action.status==='approved'){
  if(action.movement)return role==='gm'?{title:'Подтверди перемещение',body:'Пешка ещё на прежнем месте. В карточке заявки опиши согласованный результат и нажми «Подтвердить результат». Только после этого пешка переместится.'}:{title:'Перемещение разрешено',body:'Ведущий подтвердит маршрут и результат в карточке заявки. Бросок для каждого перемещения приложение не требует; условия определяет ГМ.',role:'gm'};
  if(action.roll===null)return role==='player'?{title:'Внеси обычный бросок',body:'В карточке разрешённой заявки открой «Внести результат кубиков». Для знакомства с формой впиши любой учебный итог. В игре вводится итог настоящей проверки, согласованной за столом.'}:{title:'Дождись кубиков игрока',body:'Теперь переключись на экран игрока и внеси учебный бросок в карточку разрешённого действия. ГМ определяет сложность и обстоятельства за столом.',role:'player'};
  return role==='gm'?{title:'Опиши, что произошло',body:'Проверь введённые кубики в карточке заявки. Запиши итог по правилам и обстоятельствам, затем нажми «Подтвердить результат». Приложение сохранит описание и покажет его игроку.'}:{title:'Бросок записан',body:'Передай решение ведущему: на его учебном экране можно описать и подтвердить результат.',role:'gm'};
 }
 if(action.status==='rejected')return{title:'Ответ ведущего получен',body:'Причина видна в карточке заявки. Можно предложить другое действие. Для повторения всего маршрута нажми «Начать заново».'};
 return role==='gm'?{title:'Результат записан в журнал',body:'Переключись на экран игрока и посмотри подтверждённый результат. Затем попробуй движение: на экране игрока нажми свободную видимую клетку.',role:'player'}:{title:'Один игровой ход разобран',body:'Посмотри описание результата и журнал под полем. Теперь попробуй нажать свободную видимую клетку и запросить перемещение. ГМ согласует его тем же способом.'};
}

export default function CampaignDemo({onDirtyChange,onBusyChange}:CampaignDemoProps){
 const stateRef=useRef<DemoState>(createDemoState()),roleRef=useRef<DemoRole>('gm'),dirtyRef=useRef(false),busyRef=useRef(false);
 const callbacks=useRef({onDirtyChange,onBusyChange});callbacks.current={onDirtyChange,onBusyChange};
 const [role,setRole]=useState<DemoRole>('gm'),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[confirmation,setConfirmation]=useState<Confirmation|null>(null),[generation,setGeneration]=useState(0);
 const setTerminalDirty=useCallback((dirty:boolean)=>{dirtyRef.current=dirty;callbacks.current.onDirtyChange?.(dirty);},[]);
 const setTerminalBusy=useCallback((value:boolean)=>{busyRef.current=value;setBusy(value);callbacks.current.onBusyChange?.(value);},[]);
 useEffect(()=>()=>{callbacks.current.onDirtyChange?.(false);callbacks.current.onBusyChange?.(false);},[]);
 const api=useCallback(async(path:string,method='GET',payload?:unknown)=>{
  if(path!==`/api/campaigns/${DEMO_CAMPAIGN_ID}/workspace`)throw new DemoFailure(404,'Учебный стол не обращается к настоящим кампаниям.');
  if(method==='GET')return demoSnapshot(stateRef.current,roleRef.current);
  if(method!=='POST')throw new DemoFailure(405,'Метод не поддерживается учебным столом.');
  const result=applyDemoCommand(stateRef.current,roleRef.current,payload);stateRef.current=result.state;setRevision(value=>value+1);return result.response;
 },[]);
 const switchRole=(next:DemoRole)=>{
  if(next===role||busyRef.current)return;
  const change=()=>{roleRef.current=next;dirtyRef.current=false;callbacks.current.onDirtyChange?.(false);setRole(next);};
  if(dirtyRef.current)setConfirmation({title:'Переключить учебный экран?',text:'Неотправленный черновик текущего экрана будет очищен. Уже отправленные заявки и результаты останутся на учебном столе. Для сохранения ввода используй «Черновики» в терминале.',run:change});else change();
 };
 const reset=()=>{
  if(busyRef.current)return;
  setConfirmation({title:'Начать обучение заново?',text:'Учебная карта, сообщения и заявки вернутся к исходному состоянию. Неотправленный ввод будет очищен. Твои настоящие персонажи и кампании не изменятся.',run:()=>{stateRef.current=createDemoState();roleRef.current='gm';dirtyRef.current=false;callbacks.current.onDirtyChange?.(false);setRole('gm');setRevision(value=>value+1);setGeneration(value=>value+1);}});
 };
 const state=stateRef.current,step=nextStep(state,role),gm=role==='gm';
 const latest=state.data.scene.actions[state.data.scene.actions.length-1];
 return <div className="campaign-demo" data-demo-version={revision}>
  <header className="demo-intro"><span className="eyebrow">TRAINING / TABLETOP</span><h2>Попробуй игровой стол без группы</h2><p>Это одна учебная сцена с двумя отдельными точками зрения. Здесь можно пройти действие от заявки до результата, подготовить карту и посмотреть, какие сведения получает игрок.</p><p className="demo-isolation"><BookOpen aria-hidden="true"/>Учебный стол живёт только на этом экране. Настоящие персонажи, кампании и листы не меняются.</p></header>
  <button className="quiet demo-guide-launch" onClick={()=>window.dispatchEvent(new CustomEvent('nightcity-start-tutorial',{detail:{id:'table'}}))}><BookOpen/>Показать подсветку кнопок</button><div className="demo-controls"><div className="demo-role-switch" data-tour="demo-role-switch" role="group" aria-label="Точка зрения в учебной кампании"><button type="button" aria-pressed={gm} disabled={busy} onClick={()=>switchRole('gm')}><ShieldCheck aria-hidden="true"/>Экран ГМа</button><button type="button" aria-pressed={!gm} disabled={busy} onClick={()=>switchRole('player')}><UserRound aria-hidden="true"/>Экран игрока</button></div><button className="demo-reset" type="button" disabled={busy} onClick={reset}><RotateCcw aria-hidden="true"/>Начать заново</button></div>
  <div className={`demo-role-banner ${gm?'is-gm':'is-player'}`} role="status">{gm?<ShieldCheck aria-hidden="true"/>:<UserRound aria-hidden="true"/>}<div><strong>{gm?'Сейчас ты смотришь экран ведущего':'Сейчас ты смотришь экран игрока · Вега'}</strong><p>{gm?'Доступны всё поле, подготовка карты и решения по заявкам.':'Доступны обзор своего персонажа и его действия; скрытые сведения не передаются.'}</p><small>Эти кнопки переключают учебные аккаунты. В настоящей кампании доступ назначается её участникам.</small></div></div>
  <section className="demo-next-step" aria-label="Следующий шаг обучения" aria-live="polite"><div><span className="eyebrow">{latest?.status==='resolved'?'RESULT / CONFIRMED':'NEXT STEP'}</span><h3>{latest?.status==='resolved'&&<Check aria-hidden="true"/>}{step.title}</h3><p>{step.body}</p></div>{step.role&&step.role!==role&&<button type="button" className="primary" disabled={busy} onClick={()=>switchRole(step.role!)}>Открыть экран {step.role==='gm'?'ГМа':'игрока'}<ChevronRight aria-hidden="true"/></button>}</section>
  <details className="demo-table-manual"><summary>Как это выглядит за настоящим столом</summary><ol><li>ГМ готовит карту и открывает сцену. У каждого участника свой аккаунт и назначенный персонаж.</li><li>Игрок выбирает видимую цель, описывает намерение и отправляет заявку со своего телефона.</li><li>ГМ учитывает правила и обстоятельства, затем разрешает действие.</li><li>Игрок бросает обычные кубики за столом и записывает согласованный итог проверки.</li><li>ГМ описывает и подтверждает результат. Участники учитывают согласованные расходы и ранения в листах.</li></ol><p>Обзор карты задаёт ведущий для отображения сцены. Попадание, броня, урон и применение программ определяются правилами Cyberpunk 2020 и решением за столом.</p></details>
  <CampaignTerminal demoMode key={`demo-${generation}-${role}`} campaignId={DEMO_CAMPAIGN_ID} me={DEMO_ACCOUNTS[role]} api={api} onDirtyChange={setTerminalDirty} onBusyChange={setTerminalBusy} requestedSection={{section:'scene',revision:0}}/>
  <AlertDialog open={!!confirmation} onOpenChange={open=>{if(!open)setConfirmation(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmation?.title}</AlertDialogTitle><AlertDialogDescription>{confirmation?.text}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Вернуться</AlertDialogCancel><AlertDialogAction onClick={()=>{const run=confirmation?.run;setConfirmation(null);run?.();}}>Подтвердить</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </div>;
}
