'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Footprints, RotateCcw, DoorOpen, Shield, Users, BookOpen, ScrollText, Grid2X2, ZoomIn, ZoomOut, LocateFixed, Maximize, Minimize, Play, Pause, Square, Eye, EyeOff, MapPin, BrickWall, MousePointer2, ChevronRight, Undo2, Plus, Smartphone, Settings2, X, Check, Cable, Download, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './Dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { LOCATIONS } from '@/lib/firefight/scene.mjs';
import { actorAppearance, FALLBACK_APPEARANCE_ID } from '@/lib/firefight/appearances.mjs';
import { PROP_CATALOG, propFootprint } from '@/lib/firefight/props.mjs';
import './battle.css';
import { woundInfo, effectiveRef, actionPenalty } from '@/lib/firefight/display.mjs';
import { actorHeading, headingToward, headingLabel, HEADINGS } from '@/lib/firefight/heading.mjs';
import { createBattleEventQueue } from '@/lib/firefight/event-queue.mjs';
import CombatFeedback from './CombatFeedback';
import CoverProfileEditor from './CoverProfileEditor';
import TrainingLoadoutSetup from './TrainingLoadoutSetup';
import { trainingLoadoutGroups } from '@/lib/firefight/training-loadout.mjs';
import {MeleeRuling,meleeRulingReady,RulesProfileEditor,rulesProfileReady,FumbleReview,ThroughCoverRuling,throughRulingReady,ProtectionReview} from './CombatAdjudication';
import NetControls from './NetControls';
import { BattleAudio } from '@/lib/firefight/audio.mjs';
import { BattleRenderer } from '@/lib/firefight/renderer.mjs';
const ACTIONS = [{ id: 'inspect', label: 'Осмотр', Icon: MousePointer2, key: '1' }, { id: 'move', label: 'Идти', Icon: Footprints, key: '2' }, { id: 'shoot', label: 'Огонь', Icon: Crosshair, key: '3' }, { id: 'reload', label: 'Заряд', Icon: RotateCcw, key: '4' }, { id: 'interact', label: 'Дверь', Icon: DoorOpen, key: '5' }, { id: 'net', label: 'Сеть', Icon: Cable, key: '6' }, { id: 'face', label: 'Поворот', Icon: RotateCcw, key: '7' }];
const MAP_TOOLS = [{value:'floor',label:'Пол · убрать предмет'},{value:'wall',label:'Стена · 1×1'},{value:'door',label:'Дверь · 1×1'},...Object.entries(PROP_CATALOG).map(([value,prop])=>({value,label:prop.label + ' · ' + prop.w + '×' + prop.h}))];
const INLINE_PANELS = ['menu', 'actions', 'camera', 'attack-setup', 'weapons','object'];
const PHASE = { preparation: 'Подготовка', combat: 'Бой', paused: 'Пауза', ended: 'Бой завершён' };
const newId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
function armorPersistenceLabel(persistence) { return persistence.mode === 'manual-review' ? 'Износ · ручная проверка' : 'Без источника брони'; }
function Avatar({ actor, large = false }) {
    const appearance = actorAppearance(actor.sprite), [failedUrl, setFailedUrl] = useState(null);
    const original = appearance.original || failedUrl === appearance.url;
    const id = appearance.original ? appearance.id : FALLBACK_APPEARANCE_ID;
    return <span aria-hidden="true" className={'avatar ' + (large ? 'large' : '')} style={original ? { backgroundPosition: id / 3 * 100 + '% 0%' } : { backgroundImage: 'none' }}>
        {!original && <svg width="100%" height="100%" viewBox={appearance.sourceRect.join(' ')} preserveAspectRatio="xMidYMax meet" focusable="false" aria-hidden="true" style={{ display: 'block', overflow: 'hidden', imageRendering: 'pixelated' }}><image href={appearance.url} width={appearance.dimensions[0]} height={appearance.dimensions[1]} onError={() => setFailedUrl(appearance.url)}/></svg>}
    </span>;
}
function Picker({ value, onChange, options, label }) { return <Select value={value} onValueChange={onChange}><SelectTrigger className="game-select" aria-label={label}><SelectValue /></SelectTrigger><SelectContent className="nc-firefight game-select-menu">{options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>; }
function IconButton({ Icon, label, onClick, active = false, disabled = false, className = '' }) { return <button type="button" className={'icon-button ' + (active ? 'is-active ' : '') + className} aria-label={label} title={label} onClick={onClick} disabled={disabled}><Icon size={19}/></button>; }
function FacingRuling({value,onChange,local=false}) { return <fieldset className="facing-ruling"><legend>{local?'Решение ГМа в тренировке':'Решение ГМа для этой атаки'}</legend><div role="group" aria-label="Атака с разворотом"><button type="button" aria-pressed={value===false} onClick={()=>onChange(false)}>Без разворота</button><button type="button" aria-pressed={value===true} onClick={()=>onChange(true)}>Разворот · −2</button></div><small>Штраф относится к этому броску. Отдельная цена поворота не назначается автоматически.</small></fieldset>; }
function declarationIntent(declaration) {return declaration.action||{...declaration,type:declaration.type||(declaration.targetId?'shoot':undefined)};}
function ShotRequestReview({declaration,version,onPreview,onConfirm,disabled}) {
    const [ruling,setRuling]=useState(null),[result,setResult]=useState(null),previewRef=useRef(onPreview);
    useEffect(()=>{previewRef.current=onPreview;},[onPreview]);
    const raw=declarationIntent(declaration),action={type:'shoot',actorId:raw.actorId||declaration.actorId,targetId:raw.targetId,location:raw.location||'random'},actionKey=JSON.stringify(action),key=declaration.id+':'+version+':'+ruling;
    useEffect(()=>{if(typeof ruling!=='boolean')return;let current=true;
        previewRef.current({...JSON.parse(actionKey),turnToTarget:ruling,expectedVersion:version}).then(value=>{if(current)setResult({key,value});}).catch(error=>{if(current)setResult({key,value:{ok:false,error:error.message||'Предпросмотр недоступен'}});});
        return()=>{current=false;};
    },[actionKey,key,ruling,version]);
    const preview=result?.key===key?result.value:null;
    return <><FacingRuling value={ruling} onChange={setRuling}/>{typeof ruling==='boolean'&&(preview?.ok?<p>Итог: {preview.base} + d10 ≥ {preview.difficulty} · разворот {preview.turnPenalty??(ruling?-2:0)}</p>:<p role={preview?.error?'alert':'status'}>{preview?.error||'Проверяем выбранный модификатор…'}</p>)}<button type="button" className="primary-button" disabled={disabled||typeof ruling!=='boolean'||!preview?.ok} onClick={()=>onConfirm({type:'confirm',declarationId:declaration.id,turnToTarget:ruling,expectedVersion:version})}><Check size={17}/>Подтвердить и бросить</button></>;
}
function FoundationRequestReview({declaration,scene,onPreview,onConfirm,onRules,disabled}) {
    const raw=declarationIntent(declaration),actor=scene.actors.find(a=>a.id===raw.actorId),target=scene.actors.find(a=>a.id===raw.targetId);
    const [through,setThrough]=useState(null),[turn,setTurn]=useState(null),[melee,setMelee]=useState(()=>scene.settings?.cp2020Rulings?.punchRounding?{punchRounding:scene.settings.cp2020Rulings.punchRounding}:null),[result,setResult]=useState(null);
    const valid=raw.type==='fire'?typeof turn==='boolean'&&(raw.coverMode!=='through'||throughRulingReady(through)):meleeRulingReady(melee,actor,raw.technique,raw.skillName);
    const choice=raw.type==='fire'?{gmFire:{turnToTarget:turn,...(raw.coverMode==='through'?through:{})}}:{gmMelee:melee};
    const requestKey=JSON.stringify({...raw,...(valid?choice:{}),expectedVersion:scene.version}),previewRef=useRef(onPreview);
    useEffect(()=>{previewRef.current=onPreview;},[onPreview]);
    useEffect(()=>{let live=true;previewRef.current(JSON.parse(requestKey)).then(value=>{if(live)setResult({key:requestKey,value});}).catch(error=>{if(live)setResult({key:requestKey,value:{ok:false,error:error.message}});});return()=>{live=false;};},[requestKey]);
    const preview=result?.key===requestKey?result.value:null;
    return <>{raw.type==='fire'?<><FacingRuling value={turn} onChange={setTurn}/>{raw.coverMode==='through'&&<ThroughCoverRuling value={through} onChange={setThrough}/>}</>:<MeleeRuling actor={actor} target={target} technique={raw.technique} skillName={raw.skillName} value={melee} onChange={setMelee}/>}
      {preview?.unresolvedRulings?.length>0&&<><p className="adjudication-warning">Для этого режима ещё не подтверждены соглашения сцены.</p><button type="button" className="small-button" onClick={onRules}>Соглашения сцены</button></>}
      <ProtectionReview value={preview?.protectionReview} actors={scene.actors}/>
      {preview?.error&&<p role="alert">{preview.error}</p>}
      {preview?.attackBase!==undefined&&<p>Атака {preview.attackBase} + d10 против защиты {preview.defenseBase} + d10. Ничья защищает цель.</p>}
      {preview?.targets?.map(t=><p key={t.id}>{scene.actors.find(a=>a.id===t.id)?.name||'Цель'}: {t.base} {t.modeModifier>=0?'+':''}{t.modeModifier??'?'} + d10 ≥ {t.difficulty} · {t.allocatedRounds} патр.</p>)}
      <button type="button" className="primary-button" disabled={disabled||!valid||!preview?.ok||raw.type==='fire'&&!preview?.readyToRoll||raw.type==='melee'&&preview?.requiresGmMeleeDecision} onClick={()=>onConfirm({type:'confirm',declarationId:declaration.id,...choice,expectedVersion:scene.version})}><Check size={17}/>Подтвердить и бросить</button></>;
}

/** Original Firefight visual/control shell. All scene mutations and previews are authoritative transport calls.
 * @param {any} props
 */
export default function BattleApp({ scene, role = 'gm', controlledIds = [], viewerActors = [], viewerActorId = null, onViewpoint, onTestMenu, trainingLocalAdjudication = false, onCommand, onPreview, onExit, onSetup, onExport, onImport, onLoadout, onAddNpc, onTraining, onReset, onRefresh, canUndo = false, busy: transportBusy = false, online = true, training = false, saved = true, declarations = [], rulesNote = '', demoCompatible = true, active = true, backRef } = {}) {
    const state = scene, view = scene;
    const localAdjudication=training&&!!onTestMenu&&trainingLocalAdjudication===true,canAdjudicate=role==='gm'||localAdjudication;
    const stateRef = useRef(state), canvasRef = useRef(null), rendererRef = useRef(null), initiativeRef = useRef(null);
    useEffect(() => {stateRef.current = state;}, [state]);
    const firstCrew = state.actors.find(a => controlledIds.includes(a.id)) || state.actors.find(a => a.team === 'crew') || state.actors[0];
    const [selectedId, setSelectedId] = useState(firstCrew?.id || '');
    const controlledId = controlledIds.includes(selectedId) ? selectedId : controlledIds[0];
    const [action, setAction] = useState('inspect'), [pending, setPending] = useState(null), [location, setLocation] = useState('random');
    const [dialog, setDialog] = useState(null), [grid, setGrid] = useState(false), [paint, setPaint] = useState('floor'), [editor, setEditor] = useState(false);
    const [orientation, setOrientation] = useState(0);
    const [objectTarget,setObjectTarget]=useState(null),[coverEdit,setCoverEdit]=useState(null),[coverDirty,setCoverDirty]=useState(false),[coverDiscard,setCoverDiscard]=useState(false);
    const [coverMode,setCoverMode]=useState('exposed'),[throughDraft,setThroughDraft]=useState(null);
    const [trainingDirty,setTrainingDirty]=useState(false),[trainingDiscard,setTrainingDiscard]=useState(false);
    const [turnToTarget,setTurnToTarget]=useState(null),[meleeDraft,setMeleeDraft]=useState(null),[technique,setTechnique]=useState('punch'),[meleeSkill,setMeleeSkill]=useState(''),[fireMode,setFireMode]=useState('single'),[fireRounds,setFireRounds]=useState(1),[rulesDraft,setRulesDraft]=useState(null);
    const [notice, setNotice] = useState(null), [effect, setEffect] = useState(null), [previewResult, setPreviewResult] = useState(null);
    const [portraitDismissed, setPortraitDismissed] = useState(false), [full, setFull] = useState(false);
    const [camera, setCamera] = useState({ scale: 1 }), [detailsId, setDetailsId] = useState(null);
    const audioRef = useRef(null), transportRef = useRef({onCommand,onPreview});
    useEffect(() => {transportRef.current = {onCommand,onPreview};}, [onCommand,onPreview]);
    const [sound, setSound] = useState(false), [dismissedFeedback, setDismissedFeedback] = useState(null);
    const noticeTimer = useRef(null), sendingRef = useRef(false), keyboardCell = useRef({ x: 6, y: 10 });
    const actor = role === 'player' ? state.actors.find(a => a.id === controlledId) : state.actors.find(a => a.id === selectedId) || state.actors.find(a => a.id === state.currentActorId) || state.actors[0];
    const observerLabel=role==='gm'?'ГМ · вся сцена':null;
    const observerName=viewerActors.find(a=>a.id===viewerActorId)?.name||state.actors.find(a=>a.id===controlledIds[0])?.name;
    const turn = state.actors.find(a => a.id === state.currentActorId);
    const waiting = declarations.some(d => d.status === 'pending' && (role === 'gm' || d.actorId === actor?.id));
    const busy = transportBusy || !online || waiting;
    const canAct = !state.awaitingGmResolution&&!state.unresolvedFumbles?.length && saved && state.phase === 'combat' && actor?.id === turn?.id && actor?.status === 'active' && !busy;
    const canEdit = saved && role === 'gm' && ['preparation', 'ended'].includes(state.phase);
    const visibleActors = view.actors;
    const missingProfiles=visibleActors.filter(a=>a.status!=='dead'&&!a.weapon?.unarmed&&(!a.loadout||a.loadout.legacy||a.weapon?.legacy));
    const trainingGroups=training&&role==='gm'?trainingLoadoutGroups(state):null;
    const closeTraining=()=>{if(transportBusy||sendingRef.current)return;if(trainingDiscard){setTrainingDiscard(false);return;}if(trainingDirty){setTrainingDiscard(true);return;}setDialog(null);};
    const closeCover=()=>{if(transportBusy||sendingRef.current)return;if(coverDiscard){setCoverDiscard(false);return;}if(coverDirty){setCoverDiscard(true);return;}setDialog(null);};
    const selectedObject=objectTarget?.propId?state.props.find(p=>p.id===objectTarget.propId):objectTarget?state.tiles[objectTarget.y]?.[objectTarget.x]:null;
    const command = useMemo(() => pending ? { ...pending, ...(['shoot','fire'].includes(pending.type)?{location:pending.type==='fire'&&pending.mode!=='single'?'random':location}:{}), ...(pending.type==='shoot'&&canAdjudicate&&typeof turnToTarget==='boolean'?{turnToTarget}:{}), ...(pending.type==='fire'&&canAdjudicate&&typeof turnToTarget==='boolean'?{gmFire:{turnToTarget,...(pending.coverMode==='through'&&throughRulingReady(throughDraft)?throughDraft:{})}}:{}), ...(pending.type==='melee'&&role==='gm'&&meleeRulingReady(meleeDraft,actor,pending.technique,pending.skillName)?{gmMelee:meleeDraft}:{}) } : null, [pending,location,turnToTarget,canAdjudicate,meleeDraft,actor,role,throughDraft]);
    const commandKey = command ? JSON.stringify(command) : '';
    const preview = previewResult?.key === commandKey ? previewResult.value : null;
    const feedback = view.log.slice().reverse().find(e => ['shoot', 'melee', 'control'].includes(e.kind)&&!e.visualOnly);
    const eventQueue=useRef(null),soundRef=useRef(sound);
    const [documentVisible,setDocumentVisible]=useState(()=>document.visibilityState!=='hidden');
    const [reducedMotion,setReducedMotion]=useState(()=>document.documentElement.dataset.playerMotion==='off'||!!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    const viewedDetails = visibleActors.find(a => a.id === detailsId) || visibleActors.find(a => a.id === actor?.id);
    const noticeFn = (text, error = false) => { clearTimeout(noticeTimer.current); setNotice({ text, error }); noticeTimer.current = setTimeout(() => setNotice(null), error ? 5000 : 3800); };
    const declarationSummary = declaration => {
        const intent = declarationIntent(declaration);
        const target = visibleActors.find(a => a.id === intent.targetId);
        const device = view.devices.find(d => d.id === intent.deviceId);
        if(intent.type === 'shoot') return 'Цель: ' + (target?.name || 'видимый участник') + ' · ' + (intent.location === 'random' ? 'обычный выстрел' : LOCATIONS.find(l=>l.id===intent.location)?.label || 'обычный выстрел');
        if(intent.type==='fire')return ({single:'Одиночные',burst:'Очередь из трёх',auto:'Автоматический огонь'}[intent.mode]||intent.mode)+' · '+intent.rounds+' патронов · '+intent.targetIds.map(id=>visibleActors.find(a=>a.id===id)?.name||'Цель').join(', ');
        if(intent.type==='melee')return ({punch:'Удар рукой',kick:'Удар ногой',weapon:'Рукопашное оружие'}[intent.technique])+' · '+(target?.name||'Цель');
        if(intent.type==='flip')return 'Опрокинуть стол · '+({0:'вправо',90:'вниз',180:'влево',270:'вверх'})[intent.facing];
        if(intent.type==='face') return 'Направление: '+headingLabel(intent.heading);
        if(['move','place','interact','door'].includes(intent.type)) return 'Клетка ' + (intent.x+1) + ', ' + (intent.y+1);
        if(['connect','control'].includes(intent.type)) return (device?.name || 'Устройство') + (intent.operation ? ' · ' + ({open:'открыть',close:'закрыть',observe:'просмотр',on:'включить',off:'выключить'}[intent.operation] || intent.operation) : '');
        return ({reload:'Перезарядка оружия',end:'Завершить ход',scan:'Найти устройства сети',disconnect:'Отключить деку'})[intent.type] || '';
    };
    const saveStatus = training ? 'Тренировка · реальные листы не меняются' : saved ? 'Общая сцена · сохранено на сервере' : 'Подготовка ещё не сохранена';
    /* eslint-disable react-hooks/set-state-in-effect -- Hydrate user sound preference and reconcile selections to newly received server revisions. */
    useEffect(() => {
        try { setSound(localStorage.getItem('night-city-sound') === 'true'); } catch { }
        return () => { clearTimeout(noticeTimer.current); audioRef.current?.dispose(); };
    }, []);
    useEffect(() => {
        if (!command || !active) return;
        let current = true;
        if (command.expectedVersion !== state.version) { setPending(null); return; }
        transportRef.current.onPreview(command).then(value => { if(current) setPreviewResult({key:commandKey,value}); }).catch(error => { if(current) setPreviewResult({key:commandKey,value:{ok:false,error:error.message || 'Предпросмотр недоступен. Проверь связь.'}}); });
        return () => { current = false; };
    }, [command,commandKey,state.version,active]);
    useEffect(()=>{soundRef.current=sound;},[sound]);
    useEffect(()=>{
        const media=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
        const motion=()=>setReducedMotion(document.documentElement.dataset.playerMotion==='off'||!!media?.matches);
        const visible=()=>setDocumentVisible(document.visibilityState!=='hidden');
        const observer=typeof MutationObserver==='function'?new MutationObserver(motion):null;
        observer?.observe(document.documentElement,{attributes:true,attributeFilter:['data-player-motion']});
        media?.addEventListener?.('change',motion);document.addEventListener('visibilitychange',visible);motion();
        return()=>{observer?.disconnect();media?.removeEventListener?.('change',motion);document.removeEventListener('visibilitychange',visible);};
    },[]);
    useEffect(()=>{
        let alive=true;
        const queue=createBattleEventQueue({onEffect:(event,meta)=>{
            if(!alive)return;
            setEffect(event?{...event,static:!meta.animate}:null);
            if(event)setDismissedFeedback(null);
            if(event?.kind==='shoot'&&meta.animate&&soundRef.current){if(!audioRef.current)audioRef.current=new BattleAudio();void audioRef.current.shot();}
        }});eventQueue.current=queue;
        return()=>{alive=false;queue.dispose();eventQueue.current=null;};
    },[]);
    useEffect(()=>{
        eventQueue.current?.ingest({scopeKey:state.id+':'+role+':'+(viewerActorId||controlledIds[0]||'gm'),version:state.version,log:view.log,active:active&&documentVisible,online,reducedMotion});
    },[state.id,state.version,view.log,role,viewerActorId,controlledIds,active,documentVisible,online,reducedMotion]);
    useEffect(() => {
        if (role === 'gm' && state.currentActorId) { setSelectedId(state.currentActorId); setAction('inspect'); setEditor(false); setDialog(value => value === 'actions' || value === 'net' ? null : value); }
    }, [state.currentActorId,role]);
    /* eslint-enable react-hooks/set-state-in-effect */
    useEffect(() => {
        initiativeRef.current?.querySelector('[aria-current="step"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
    }, [state.currentActorId,state.index]);
    useEffect(() => {
        if (!backRef) return;
        backRef.current = () => {
            if (dialog==='training-setup') {closeTraining();return true;}
            if (dialog==='cover-edit') {closeCover();return true;}
            if (dialog) { setDialog(null); if(dialog === 'net') {setPending(null);setAction('inspect');} return true; }
            if (pending) {setPending(null);return true;}
            if (editor || action !== 'inspect') {setEditor(false);setAction('inspect');return true;}
            return false;
        };
        return () => {backRef.current = null;};
    });
    useEffect(()=>{const guard=event=>{if((dialog==='training-setup'&&trainingDirty||dialog==='cover-edit'&&coverDirty)||sendingRef.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[dialog,trainingDirty,coverDirty]);
    const pickRef = useRef(null);
    useEffect(() => {
        pickRef.current = cell => {
            if (!active || (busy && (editor || action !== 'inspect'))) return;
            const current = stateRef.current, actual = current.actors.find(a => a.id === cell.actorId), allowed = actual && (role === 'gm' || !actual.hidden || controlledIds.includes(actual.id));
            if (canEdit && editor) {
                setPending({ id: newId(), type: 'paint', x: cell.x, y: cell.y, paint, ...(PROP_CATALOG[paint] ? {facing:orientation} : {}), expectedVersion: current.version });
                return;
            }
            if (action === 'place' && canEdit) {
                if (allowed && actual.id !== actor?.id) {
                    setSelectedId(actual.id);
                    setPending(null);
                    return;
                }
                setPending({ id: newId(), type: 'place', actorId: actor?.id, x: cell.x, y: cell.y, expectedVersion: current.version });
                return;
            }
            if (action === 'face' && actor) {
                setPending({id:newId(),type:'face',actorId:actor.id,heading:headingToward(actor,cell),expectedVersion:current.version});return;
            }
            if (action === 'melee') {
                if(allowed&&actual.id!==actor?.id){setMeleeDraft(state.settings?.cp2020Rulings?.punchRounding?{punchRounding:state.settings.cp2020Rulings.punchRounding}:null);setPending({id:newId(),type:'melee',actorId:actor.id,targetId:actual.id,technique,skillName:technique==='weapon'?actor.weapon.skillName:meleeSkill,expectedVersion:current.version});}
                else noticeFn('Выбери соседнюю цель рукопашной атаки.');return;
            }
            if (action === 'shoot') {
                if (allowed && actual.id !== actor?.id) {
                    setTurnToTarget(null);setThroughDraft(null);
                    if(actor?.loadout){setPending(previous=>({id:newId(),type:'fire',actorId:actor.id,mode:fireMode,rounds:fireRounds,coverMode,targetIds:fireMode==='auto'&&previous?.type==='fire'?[...new Set([...previous.targetIds,actual.id])]:[actual.id],expectedVersion:current.version}));}
                    else setPending({ id: newId(), type: 'shoot', actorId: actor?.id, targetId: actual.id, location, expectedVersion: current.version });
                    return;
                }
                noticeFn('Выбери персонажа, в которого хочешь стрелять.');
                return;
            }
            if (action === 'move') {
                setPending({ id: newId(), type: 'move', actorId: actor?.id, x: cell.x, y: cell.y, expectedVersion: current.version });
                return;
            }
            if (action === 'interact') {
                setPending({ id: newId(), type: canEdit ? 'door' : 'interact', actorId: actor?.id, x: cell.x, y: cell.y, expectedVersion: current.version });
                return;
            }
            if (allowed) {
                if (role === 'gm' || controlledIds.includes(actual.id)) {
                    setSelectedId(actual.id);
                    setPending(null);
                    setDialog('actions');
                }
                else {
                    setDetailsId(actual.id);
                    setDialog('character');
                }
                return;
            }
            setDialog(null);
            const prop=current.props.find(p=>cell.x>=p.x&&cell.x<p.x+p.w&&cell.y>=p.y&&cell.y<p.y+p.h);
            const tile = current.tiles[cell.y][cell.x];
            if(prop||role==='gm'&&['wall','door'].includes(tile.type)){setObjectTarget(prop?{propId:prop.id}:{x:cell.x,y:cell.y});setPending(null);setDialog('object');return;}
            if (tile.type === 'door' && !busy) {
                setAction('interact');
                setPending({ id: newId(), type: canEdit ? 'door' : 'interact', actorId: actor?.id, x: cell.x, y: cell.y, expectedVersion: current.version });
            }
        };
    });
    useEffect(() => {
        if (!canvasRef.current)
            return;
        const renderer = new BattleRenderer(canvasRef.current, cell => pickRef.current?.(cell), setCamera);
        rendererRef.current = renderer;
        return () => { renderer.dispose(); rendererRef.current = null; };
    }, []);
    useEffect(() => {
        const safePreview = preview?.ok ? { ...preview, actor, target: visibleActors.find(a => a.id === command?.targetId), targets:(command?.targetIds||[]).map(id=>visibleActors.find(a=>a.id===id)).filter(Boolean), line: preview.line ? {...preview.line, cover: typeof preview.line.cover === 'object' ? preview.line.cover : null} : undefined } : null;
        const propGhost = command?.type==='flip'&&preview?.ok&&preview.footprint?{...preview.footprint,type:'table',facing:command.facing,flipped:true}:command?.type === 'paint' && PROP_CATALOG[command.paint] && preview?.ok && preview.footprint ? {...preview.footprint,type:command.paint,facing:command.facing??0} : null;
        const ghost = command?.type === 'place' && preview?.ok ? { ...actor, x: command.x, y: command.y } : null;
        rendererRef.current?.setData({ state: view, grid, selectedId: actor?.id, activeId: view.currentActorId, targetId: command?.targetId, preview: safePreview, cell: command?.x !== undefined ? { x: command.x, y: command.y } : null, ghost, propGhost, reducedMotion }, effect);
    });
    useEffect(() => {
        const changed = () => setFull(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', changed);
        return () => document.removeEventListener('fullscreenchange', changed);
    }, []);
    const send = async (cmd) => {
        if (transportBusy || !online || sendingRef.current) return;
        sendingRef.current = true;
        if(sound) {if(!audioRef.current)audioRef.current = new BattleAudio();void audioRef.current.enable?.();}
        try {
            const result = await transportRef.current.onCommand({id:cmd.id || newId(),expectedVersion:cmd.expectedVersion ?? stateRef.current.version,...cmd});
            if (!result) return;
            setPending(null);
            if(cmd.type === 'shoot') setLocation('random');
            if(['move','shoot','fire','melee','switch','unjam','reload','interact','face','flip'].includes(cmd.type)) setAction('inspect');
            if(cmd.type === 'control') {setDialog(null);setAction('inspect');}
            if(['start','end','finish'].includes(cmd.type)) {setAction('inspect');setEditor(false);}
            if(role === 'player' && !['confirm','reject'].includes(cmd.type)) noticeFn('Заявка отправлена ГМу. Ресурсы изменятся после подтверждения.');
            return result;
        } catch(error) { noticeFn(error.message || 'Не удалось выполнить действие.',true); }
        finally {sendingRef.current = false;}
    };
    const startEditor = async () => {
        if (role !== 'gm' || busy || !['preparation','ended'].includes(state.phase)) return;
        if (!saved && !await send({type:'save-preparation'})) return;
        setDialog(null);
        setEditor(true);
        setAction('inspect');
        setPending(null);
    };
    const openPanel = id => {
        setPending(null);
        setEditor(false);
        setAction('inspect');
        setDismissedFeedback(feedback?.id || null);
        setDialog(value => value === id ? null : id);
    };
    const chooseAction = id => {
        setDialog(null);
        setDismissedFeedback(feedback?.id || null);
        setPending(null);
        setEditor(false);
        if (id === 'shoot'&&!actor?.loadout&&!actor?.weapon?.unarmed) {setAction('inspect');setPending(null);setDialog('actions');setNotice({text:'Подтверди оружие по правилам 2020 в подготовке. Прежний алгоритм закрыт для новых атак.',error:true});return;}
        if (id === 'shoot') {setCoverMode('exposed');setThroughDraft(null);setLocation('random');setTurnToTarget(null);if(actor?.loadout||actor?.weapon?.unarmed){const mode=actor.weapon?.fireModes?.find(mode=>mode!=='suppress')||'single';setFireMode(mode);setFireRounds(mode==='burst'?3:mode==='auto'?Math.min(actor.weapon.ammo,actor.weapon.rof-(actor.shotsByWeapon?.[actor.weapon.id]||0)):1);setTechnique(actor.weapon?.kind==='melee'?'weapon':'punch');setMeleeSkill('');setDialog('attack-setup');setAction('inspect');return;}}
        if (id === 'net') {
            setAction('net');
            setDialog('net');
            return;
        }
        if (id === 'reload') {
            setAction(id);
            setPending({ id: newId(), type: 'reload', actorId: actor?.id, expectedVersion: state.version });
        }
        else
            setAction(id);
    };
    const selectActor = a => {
        setEditor(false);
        setPending(null);
        setAction('inspect');
        setDismissedFeedback(feedback?.id || null);
        if (role === 'player' && !controlledIds.includes(a.id)) {
            setDetailsId(a.id);
            setDialog('character');
            return;
        }
        setSelectedId(a.id);
        setPending(null);
        setAction('inspect');
        setDialog('actions');
        rendererRef.current?.center(a);
    };
    const undo = () => { if(role === 'gm' && canUndo && !busy) void send({type:'undo'}); };
    const reset = async () => { if(role !== 'gm' || !training || !onReset) return; const result = await onReset(); if(result) {setDialog(null);setPending(null);setAction('inspect');setEditor(false);setEffect(null);setSelectedId('ray');rendererRef.current?.fit();} };
    const fullscreen = async () => {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
                return;
            }
            await document.documentElement.requestFullscreen();
            if (screen.orientation?.lock)
                try {
                    await screen.orientation.lock('landscape');
                }
                catch { }
        }
        catch {
            noticeFn('Полный экран недоступен в этом браузере. Поверни телефон горизонтально.');
        }
    };
    const actionAllowed = id => id === 'inspect' || (['interact','face'].includes(id) && canEdit && !!actor && !busy) || (canAct && (id !== 'move' || !actor.moved) && (id !== 'shoot' || (actor.loadout||actor.weapon?.unarmed||actor.weapon?.ammo > 0 && actor.shots < actor.weapon.rof)));
    useEffect(() => {
        const keyboard = e => {
            if (!active || (dialog && !INLINE_PANELS.includes(dialog)) || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable || e.target.closest?.('input,textarea,select,[role="combobox"],[contenteditable="true"]'))
                return;
            if (e.key === 'Escape') {
                e.preventDefault();
                if (dialog==='training-setup') closeTraining();
                else if(dialog==='cover-edit')closeCover();
                else if (dialog) setDialog(null);
                else if (pending) setPending(null);
                else {setAction('inspect');setEditor(false);}
                return;
            }
            if (['BUTTON', 'A'].includes(e.target.tagName) || e.target.closest?.('button,a,[role="button"]')) return;
            const found = ACTIONS.find(a => a.key === e.key && (a.id !== 'net' || actor?.net?.deck));
            if (found && actionAllowed(found.id)) {
                e.preventDefault();
                chooseAction(found.id);
                return;
            }
            if (e.code === 'Space' && !state.awaitingGmResolution&&!state.unresolvedFumbles?.length && !e.repeat && !command && saved && state.phase === 'combat' && actor?.id === turn?.id && !busy) {
                e.preventDefault();
                send({ type: 'end', actorId: actor?.id });
                return;
            }
            if (e.target === canvasRef.current && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) {
                e.preventDefault();
                const cell = keyboardCell.current;
                if (e.key === 'ArrowUp')
                    cell.y--;
                if (e.key === 'ArrowDown')
                    cell.y++;
                if (e.key === 'ArrowLeft')
                    cell.x--;
                if (e.key === 'ArrowRight')
                    cell.x++;
                cell.x = Math.max(0, Math.min(state.width - 1, cell.x));
                cell.y = Math.max(0, Math.min(state.height - 1, cell.y));
                if (e.key === 'Enter') {
                    const a = visibleActors.find(a => a.x === cell.x && a.y === cell.y);
                    pickRef.current?.({ ...cell, actorId: a?.id });
                }
                else {
                    rendererRef.current?.center(cell);
                    noticeFn('Клетка ' + (cell.x + 1) + ', ' + (cell.y + 1));
                }
            }
        };
        window.addEventListener('keydown', keyboard);
        return () => window.removeEventListener('keydown', keyboard);
    });
    const hint = editor ? 'Выбери клетку для изменения карты.' : action === 'place' ? 'Выбери стартовую клетку для ' + actor?.name + '.' : action === 'face' ? 'Укажи направление или нажми стрелку. Обзор изменится после подтверждения.' : action === 'move' ? 'Выбери клетку. Сначала увидишь маршрут.' : action === 'melee' ? 'Выбери соседнюю цель для рукопашной атаки.' : action === 'shoot' ? (fireMode==='auto'&&actor?.loadout?'Выбери цели; повторные касания добавляют их в действие.':'Выбери цель на карте.') : action === 'interact' ? 'Выбери дверь.' : state.phase === 'preparation' ? 'Расставь участников или начни бой.' : state.phase === 'paused' ? 'ГМ приостановил бой.' : state.phase === 'ended' ? 'Можно осмотреть сцену или начать новый бой.' : canAct ? 'Выбери действие для ' + actor?.name + '.' : view.gmTurn && role === 'player' ? 'Сейчас ход ГМа.' : 'Сейчас очередь: ' + (turn?.name || '—') + '.';

    const wound = woundInfo(actor?.wounds || 0);
    const editorFootprint = propFootprint(paint, orientation);
    const facingName = ['Вправо →','Вниз ↓','Влево ←','Вверх ↑'][orientation/90];
    const rotateProp = () => {const facing=(orientation+90)%360;setOrientation(facing);setPending(value=>value?.type==='paint'?{...value,facing}:value);};
    return <main className="nc-firefight battle-app" data-battle-original="true" data-has-initiative={state.order.length > 0 || Boolean(view.gmTurn)}>
    <header className="scene-header battlefield-rail">
      <div className="scene-title"><h1 title={state.name}>{state.name}</h1><span className="compact-phase">{training ? 'Тренировка · ' : ''}{PHASE[state.phase]}{state.round > 0 ? ' · ' + state.round : ''}</span></div>
      {(state.order.length > 0 || view.gmTurn) && <div ref={initiativeRef} className="initiative-track" aria-label="Очередь ходов">
        {view.order.map((id, i) => {const a = visibleActors.find(a => a.id === id);return <button type="button" key={id || 'hidden-' + i} className={'initiative-slot ' + (view.index === i ? 'current ' : '') + (a?.team || 'hidden')} disabled={!a} onClick={() => a && selectActor(a)} title={a ? a.name + ' · инициатива ' + (a.initiative ?? 'скрыта') : 'Ход ГМа'} aria-label={a ? a.name + (view.index === i ? ' — текущий ход' : '') : 'Ход ГМа'} aria-current={view.index === i ? 'step' : undefined}>{a ? <Avatar actor={a}/> : <EyeOff size={18}/>}<span>{a?.name || 'ГМ'}</span>{role === 'gm' && a && <small>{a.initiative}</small>}</button>;})}
        {view.gmTurn && <span className="initiative-slot hidden current" aria-label="Ход скрытого участника. Управляет ГМ."><EyeOff size={18}/><span>Ход ГМа</span></span>}
      </div>}
      <div className="header-controls">
        <span className={'connection-dot ' + (online ? 'online' : 'offline')} title={onTestMenu?'Локальный тест':online ? 'Связь с сервером' : 'Нет связи'} aria-label={onTestMenu?'Локальный тест':online ? 'Связь с сервером' : 'Нет связи'}/>
        {onTestMenu ? <button type="button" className="personal-vision-label test-view-button" aria-label="Режим тестового обзора" onClick={()=>{setDialog(null);onTestMenu();}}>{observerLabel || (observerName?'Глазами: '+observerName:'Нет персонажа')}<ChevronRight size={14}/></button> : <span className="personal-vision-label" title={role==='gm'?'Полный обзор ведущего. Выбор фигуры меняет управление, но не обзор.':'Личный обзор одного персонажа, без общего зрения партии'}>{observerLabel || (observerName?'Глазами: '+observerName:'Нет персонажа')}</span>}
        {declarations.some(d=>d.status==='pending') && <button className="small-button request-count" onClick={()=>openPanel('requests')}>Заявки · {declarations.filter(d=>d.status==='pending').length}</button>}
        {role === 'gm' && <IconButton Icon={Undo2} label="Отменить последнее действие" disabled={!canUndo || busy} onClick={undo}/>}
        <button type="button" className={'small-button battle-menu-toggle ' + (dialog === 'menu' ? 'active' : '')} aria-label="Меню боя" aria-expanded={dialog === 'menu'} aria-controls="battle-control-menu" onClick={()=>openPanel('menu')}><Settings2 size={19}/><span>Меню</span></button>
        {onExit && <IconButton Icon={X} label={training ? 'К подготовке' : 'К кампании'} onClick={onExit}/>}
      </div>
    </header>

    <section className="battle-stage" aria-label="Тактическая карта">
      <canvas ref={canvasRef} tabIndex={0} className={'battle-canvas tool-' + action} aria-label="Карта боя. Касание персонажа открывает действия; выбери действие, затем клетку или цель и подтверди предпросмотр. Клавиши стрелок и Enter выбирают клетку."/>
      {dialog === 'menu' && <aside id="battle-control-menu" className="battle-context-panel battle-control-menu" aria-label="Управление боем">
        {role==='gm'&&['preparation','ended'].includes(state.phase)&&missingProfiles.length>0&&<button type="button" className="small-button" onClick={()=>training?setDialog('training-setup'):selectActor(missingProfiles[0])}>{training?'Подготовить учебный бой':'Подтвердить оружие по 2020'} · {missingProfiles.length}</button>}
        <div className="context-heading"><strong>{training ? 'Тренировка' : PHASE[state.phase]}</strong><IconButton Icon={X} label="Закрыть меню боя" onClick={()=>setDialog(null)}/></div>
        {onTestMenu && <button type="button" className="small-button" onClick={()=>{setDialog(null);onTestMenu();}}><Eye size={17}/>Режимы и настройки стенда</button>}
        {role === 'player' && viewerActors.length > 1 && onViewpoint && <Picker label="Смотреть персонажем" value={viewerActorId||''} onChange={id=>{if(!busy&&!command)onViewpoint(id);}} options={viewerActors.map(a=>({value:a.id,label:a.name}))}/>}
        {role === 'gm' && <div className="context-menu-group">
          {onSetup && <button className="small-button" disabled={transportBusy} onClick={()=>{setDialog(null);onSetup();}}><Users size={17}/>Участники и карта</button>}
          {onTraining && <button className="small-button" disabled={transportBusy} onClick={()=>{setDialog(null);onTraining();}}><Play size={17}/>Пробный бой</button>}
          {!saved && (onImport || onAddNpc) && <p className="context-help context-wide">Карта будет сохранена перед добавлением НПС или импортом сцены.</p>}
          {onImport && <button className="small-button" disabled={busy} onClick={()=>{setDialog(null);onImport();}}><Upload size={17}/>Импорт сцены</button>}
          {onAddNpc && <button className="small-button" disabled={busy} onClick={()=>{setDialog(null);onAddNpc();}}><Plus size={17}/>Добавить НПС</button>}
          {!saved && <button className="small-button" disabled={transportBusy || !online} onClick={()=>send({type:'save-preparation'})}>Сохранить подготовку</button>}
          {canEdit && <><button className="small-button" disabled={busy || !actor} onClick={()=>{setDialog('roster');}}><MapPin size={17}/>Расставить участников</button><button className="small-button" disabled={busy} onClick={startEditor}><BrickWall size={17}/>Конструктор карты</button></>}
          {!saved && state.phase === 'preparation' && <button className="small-button context-wide" disabled={busy} onClick={startEditor}><BrickWall size={17}/>Сохранить и открыть конструктор</button>}
          {['preparation','ended'].includes(state.phase) && <button className="primary-button" disabled={busy || !saved || state.actors.filter(a=>a.status!=='dead').length<2} onClick={()=>{if(missingProfiles.length){if(training)setDialog('training-setup');else selectActor(missingProfiles[0]);return;}setDialog(null);send({type:'start'});}}><Play size={17}/>Начать бой</button>}
          {state.phase === 'combat' && <button className="small-button" disabled={busy} onClick={()=>{setDialog(null);send({type:'pause'});}}><Pause size={17}/>Пауза</button>}
          {state.phase === 'paused' && <button className="primary-button" disabled={busy} onClick={()=>{setDialog(null);send({type:'resume'});}}><Play size={17}/>Продолжить бой</button>}
        </div>}
        <div className="context-menu-group"><button className="small-button" onClick={()=>setDialog('roster')}><Users size={17}/>Участники сцены</button><button className="small-button" onClick={()=>setDialog('log')}><ScrollText size={17}/>Журнал боя</button><button className="small-button" onClick={()=>setDialog('scene')}><Settings2 size={17}/>Сцена и сохранение</button><button className="small-button" onClick={()=>setDialog('rules')}><BookOpen size={17}/>Правила и управление</button>{onRefresh && <button className="small-button" onClick={onRefresh} disabled={transportBusy}><RotateCcw size={17}/>Обновить общий бой</button>}<button className="small-button" onClick={fullscreen}>{full ? <Minimize size={17}/> : <Maximize size={17}/>} {full ? 'Выйти из полного экрана' : 'Полный экран'}</button></div>
      </aside>}
      {dialog === 'actions' && actor && <aside className="battle-context-panel actor-context-panel" aria-label="Действия выбранного персонажа">
        <div className="context-heading"><Avatar actor={actor}/><div><strong>{actor.name}</strong><span>{actor.status === 'dead' ? 'Погиб' : actor.status === 'stunned' ? 'Оглушён' : wound.label}</span></div><IconButton Icon={Eye} label={'Карточка персонажа ' + actor.name} onClick={()=>{setDetailsId(actor.id);setDialog('character');}}/><IconButton Icon={X} label="Закрыть действия персонажа" onClick={()=>setDialog(null)}/></div>
        <div className="context-actor-summary"><span>{actor.weapon?.name || 'Без оружия'}</span>{actor.weapon?.ammo!==undefined && <strong>{actor.weapon.ammo} / {actor.weapon.magazine}</strong>}</div>
        {role==='gm'&&['preparation','ended'].includes(state.phase)&&onLoadout&&<button type="button" className="small-button" onClick={()=>{setDialog(null);onLoadout(actor);}}>{actor.loadout?'Оружие и режимы':'Подтвердить оружие по правилам 2020'}</button>}
        {!actor.loadout&&!actor.weapon?.unarmed&&<p className="context-help legacy-weapon-warning">Прежний профиль сохранён, но новые атаки закрыты. ГМ должен подтвердить набор оружия в подготовке; начавшийся старый бой сначала нужно завершить.</p>}
        {state.phase==='combat'&&<div className="context-menu-group"><button type="button" className="small-button" disabled={!canAct} onClick={()=>{setTechnique(actor.weapon?.kind==='melee'?'weapon':'punch');setMeleeSkill('');setDialog('attack-setup');}}>Рукопашная / атака</button>{actor.loadout&&<button type="button" className="small-button" disabled={!canAct} onClick={()=>setDialog('weapons')}>Сменить оружие</button>}{actor.weaponJams?.[actor.weapon?.id]>0&&<button type="button" className="small-button" disabled={!canAct} onClick={()=>{setDialog(null);setPending({id:newId(),type:'unjam',actorId:actor.id,expectedVersion:state.version});}}>Устранить задержку · {actor.weaponJams[actor.weapon.id]} ход.</button>}</div>}
        {state.phase === 'combat' && <><div className="action-meta"><span>{actor.actions || 0} действий</span><strong>Следующее {actionPenalty(actor) || 'без штрафа'}</strong></div>{!canAct && <p className="context-help">{waiting ? 'Ожидает решения ГМа.' : !online ? 'Нет связи с сервером.' : 'Сейчас очередь: ' + (turn?.name || 'ГМ') + '.'}</p>}</>}
        {canEdit && <><button className="primary-button" disabled={busy} onClick={()=>chooseAction('place')}><MapPin size={17}/>Поставить на карту</button><button className="small-button" disabled={busy||actor.status!=='active'} onClick={()=>chooseAction('face')}><RotateCcw size={17}/>Повернуть персонажа</button></>}
      </aside>}
      {dialog==='attack-setup'&&actor&&<aside className="battle-context-panel actor-context-panel attack-setup" aria-label="Выбор атаки"><div className="context-heading"><strong>{actor.name} · атака</strong><IconButton Icon={X} label="Закрыть выбор атаки" onClick={()=>setDialog(null)}/></div>
       {actor.loadout&&actor.weapon?.kind==='ranged'&&<section><h3>{actor.weapon.name}</h3><label>Режим<select aria-label="Режим огня" value={fireMode} onChange={e=>{setFireMode(e.target.value);setFireRounds(e.target.value==='burst'?3:e.target.value==='auto'?Math.min(actor.weapon.ammo,actor.weapon.rof-(actor.shotsByWeapon?.[actor.weapon.id]||0)):1);}}>{actor.weapon.fireModes.filter(mode=>mode!=='suppress').map(mode=><option key={mode} value={mode}>{({single:'Одиночные',burst:'Очередь из трёх',auto:'Автоматический огонь'})[mode]}</option>)}</select></label><label>Способ атаки<select aria-label="Способ огня" value={coverMode} onChange={e=>{setCoverMode(e.target.value);setThroughDraft(null);}}><option value="exposed">По открытым частям тела</option><option value="through">Прострел через укрытие</option></select></label><label>Патронов в этом действии<input aria-label="Патронов в действии" type="number" min={1} max={Math.min(actor.weapon.ammo,actor.weapon.rof-(actor.shotsByWeapon?.[actor.weapon.id]||0),fireMode==='single'?actor.weapon.singleActionCap:100)} value={fireRounds} disabled={fireMode==='burst'} onChange={e=>setFireRounds(e.target.valueAsNumber)}/></label><p className="context-help">Одно действие. Магазин {actor.weapon.ammo}; за раунд потрачено {actor.shotsByWeapon?.[actor.weapon.id]||0}/{actor.weapon.rof}. Подавление на местности ещё не подключено.</p><button type="button" className="primary-button" disabled={!canAct||!actor.weapon.fireModes.includes(fireMode)||fireMode==='suppress'||!Number.isInteger(fireRounds)||fireRounds<1||fireRounds>actor.weapon.ammo||fireRounds>actor.weapon.rof-(actor.shotsByWeapon?.[actor.weapon.id]||0)||fireMode==='single'&&fireRounds>actor.weapon.singleActionCap||fireMode==='burst'&&fireRounds!==3||actor.weaponJams?.[actor.weapon.id]>0} onClick={()=>{setLocation('random');setTurnToTarget(null);setDialog(null);setAction('shoot');}}>Выбрать цель огня</button></section>}
       <section><h3>Рукопашная</h3><label>Приём<select aria-label="Приём рукопашной" value={technique} onChange={e=>{setTechnique(e.target.value);setMeleeSkill('');}}><option value="punch">Удар рукой · d6/2</option><option value="kick">Удар ногой · d6</option>{actor.weapon?.kind==='melee'&&<option value="weapon">{actor.weapon.name}</option>}</select></label>{technique!=='weapon'&&<label>Навык<select aria-label="Навык рукопашной атаки" value={meleeSkill} onChange={e=>setMeleeSkill(e.target.value)}><option value="">Без навыка · Brawling 0</option>{(actor.meleeSkills||[]).filter(skill=>['brawling','martialArts'].includes(skill.kind)).map(skill=><option key={skill.name} value={skill.name}>{skill.name} · {skill.rank}</option>)}</select></label>}<button type="button" className="primary-button" disabled={!canAct} onClick={()=>{setDialog(null);setAction('melee');setMeleeDraft(null);}}>Выбрать цель рукопашной</button><p className="context-help">ГМ выберет применимую защиту. Особые приёмы, парирование и активное уклонение пока требуют отдельного разбора.</p></section>
      </aside>}
      {dialog==='object'&&selectedObject&&<aside className="battle-context-panel actor-context-panel" aria-label="Предмет на карте"><div className="context-heading"><strong>{selectedObject.label||PROP_CATALOG[selectedObject.type]?.label||({wall:'Стена',door:'Дверь'})[selectedObject.type]}</strong><IconButton Icon={X} label="Закрыть предмет" onClick={()=>setDialog(null)}/></div>
        {role==='gm'&&<><p className="context-help">{selectedObject.protection?selectedObject.protection.material+' · SP '+selectedObject.protection.sp:'Материал/SP не подтверждены. Для прострела сначала настрой преграду.'}</p><button type="button" className="small-button" disabled={busy} onClick={()=>{setCoverEdit({target:{...objectTarget,type:selectedObject.type},profile:selectedObject.protection?JSON.parse(JSON.stringify(selectedObject.protection)):null,version:state.version,battleId:state.id});setCoverDirty(false);setCoverDiscard(false);setDialog('cover-edit');}}>Настроить укрытие</button></>}
        {selectedObject.type==='door'&&<button type="button" className="small-button" disabled={busy||!canAct&&!canEdit} onClick={()=>{setDialog(null);setPending({id:newId(),type:canEdit?'door':'interact',...(canEdit?{}:{actorId:actor?.id}),...objectTarget,expectedVersion:state.version});}}>{selectedObject.open?'Закрыть':'Открыть'} дверь</button>}
        {selectedObject.type==='table'&&!selectedObject.flipped&&selectedObject.protection?.movable&&<><p className="context-help">Опрокинуть от себя. Сначала увидишь новую занимаемую клетку и защиту; подтверждение ГМа расходует одно действие.</p><div className="context-menu-group">{[0,90,180,270].map(facing=><button type="button" className="small-button" key={facing} disabled={!canAct} onClick={()=>{setDialog(null);setPending({id:newId(),type:'flip',actorId:actor.id,propId:objectTarget.propId,facing,expectedVersion:state.version});}}>Опрокинуть {({0:'→',90:'↓',180:'←',270:'↑'})[facing]}</button>)}</div></>}
        {selectedObject.flipped&&<p className="context-help">Стол опрокинут. Вернуть последнее действие может ГМ через отмену.</p>}
      </aside>}
      {dialog==='weapons'&&actor?.loadout&&<aside className="battle-context-panel actor-context-panel" aria-label="Смена оружия"><div className="context-heading"><strong>Оружие в руках</strong><IconButton Icon={X} label="Закрыть смену оружия" onClick={()=>setDialog(null)}/></div><p className="context-help">Смена оружия — действие. Магазины и общий резерв сохраняются.</p>{[{id:null,name:'Убрать оружие · безоружный'},...actor.loadout.weapons].map(weapon=><button type="button" className="small-button" key={weapon.id||'unarmed'} disabled={!canAct||actor.loadout.activeWeaponId===weapon.id||actor.unavailableWeapons?.includes(weapon.id)} onClick={()=>{setDialog(null);setPending({id:newId(),type:'switch',actorId:actor.id,weaponId:weapon.id,expectedVersion:state.version});}}>{weapon.name}{weapon.kind==='ranged'?' · '+weapon.ammo+'/'+weapon.magazine:''}{actor.weaponJams?.[weapon.id]>0?' · задержка':''}</button>)}</aside>}
      {editor && !command && <div className="editor-strip"><Picker label="Инструмент карты" value={paint} onChange={p=>{setPaint(p);setPending(null);}} options={MAP_TOOLS}/>{PROP_CATALOG[paint] && <button type="button" className="small-button prop-rotate" onClick={rotateProp} aria-label={'Повернуть предмет · ' + facingName}><RotateCcw size={18}/><span>{facingName} · {editorFootprint.w}×{editorFootprint.h}</span></button>}<IconButton Icon={X} label="Закрыть редактор карты" onClick={()=>{setEditor(false);setPending(null);}}/></div>}
      {!command && !editor && action === 'inspect' && <button type="button" className="camera-toggle small-button" aria-label="Масштаб и сетка" aria-expanded={dialog === 'camera'} onClick={()=>openPanel('camera')}><ZoomIn size={18}/><span>{Math.round(camera.scale * 100)}%</span></button>}
      {dialog === 'camera' && <aside className="battle-context-panel camera-panel" aria-label="Камера карты"><div className="context-heading"><strong>Карта · {state.tileMeters} м / клетка</strong><IconButton Icon={X} label="Закрыть управление картой" onClick={()=>setDialog(null)}/></div><div className="camera-controls"><IconButton Icon={ZoomOut} label="Отдалить карту" onClick={()=>rendererRef.current?.zoom(1 / 1.2)}/><IconButton Icon={ZoomIn} label="Приблизить карту" onClick={()=>rendererRef.current?.zoom(1.2)}/><IconButton Icon={LocateFixed} label="К выбранному персонажу" disabled={!actor} onClick={()=>rendererRef.current?.center(actor)}/><button className="scale-button" onClick={()=>rendererRef.current?.fit()} title="Показать всю карту" aria-label="Показать всю карту">Вся карта</button><IconButton Icon={Grid2X2} label={grid ? 'Скрыть сетку' : 'Показать сетку'} active={grid} onClick={()=>setGrid(!grid)}/></div></aside>}

      {state.unresolvedFumbles?.length>0&&role==='gm'&&<div className="fumble-alert"><button type="button" className="small-button" onClick={()=>setDialog('fumbles')}>Разобрать критическую ошибку · {state.unresolvedFumbles.length}</button></div>}
      {role==='player'&&!actor&&<div className="vision-empty" role="status">В этой сцене пока нет твоего принятого персонажа. Ведущий должен добавить его; чужой обзор закрыт.</div>}
      {role==='player'&&actor&&actor.status!=='active'&&<div className="vision-empty" role="status">{actor.status==='dead'?'Персонаж погиб.':'Персонаж оглушён.'} Новый обзор закрыт. Состояние и свой ход доступны внизу.</div>}
      {training && role === 'gm' && !demoCompatible && <div className="update-banner"><span>Прежняя тренировка сохранена, включая ручное скрытие. В новой сцене охранник не скрыт вручную.</span><button className="small-button" onClick={() => setDialog('reset')}>Новая сцена</button></div>}
      {command && command.type !== 'control' && <aside className={'intent-panel ' + (preview?.ok ? '' : 'invalid')} aria-label="Предпросмотр действия">
        <div className="intent-header"><span>{['shoot','fire','melee'].includes(command.type) ? 'АТАКА' : command.type === 'face' ? 'ПОВОРОТ' : command.type === 'move' ? 'ПЕРЕМЕЩЕНИЕ' : command.type === 'place' ? 'РАССТАНОВКА' : command.type === 'reload' ? 'ПЕРЕЗАРЯДКА' : command.type === 'paint' ? 'КАРТА' : 'ВЗАИМОДЕЙСТВИЕ'}</span><button aria-label="Отменить выбор" className="icon-button" onClick={() => setPending(null)}><X size={18}/></button></div>
        <div className="intent-scroll">
        {command.type === 'shoot' && <><h2>{visibleActors.find(a => a.id === command.targetId)?.name || 'Цель'}</h2><Picker label="Часть тела" value={location} onChange={setLocation} options={[{ value: 'random', label: 'Обычный выстрел' }, ...LOCATIONS.map(l => ({ value: l.id, label: l.label + ' · −4' }))]}/></>}
        {command.type==='shoot'&&canAdjudicate&&<FacingRuling value={turnToTarget} onChange={setTurnToTarget} local={localAdjudication}/>}
        {command.type==='melee'&&role==='gm'&&<MeleeRuling actor={actor} target={visibleActors.find(a=>a.id===command.targetId)} technique={command.technique} skillName={command.skillName} value={meleeDraft} onChange={setMeleeDraft}/>}
        {command.type==='melee'&&role==='player'&&localAdjudication&&<p className="context-help">Для защиты в тренировке перейди в режим ГМа. {onTestMenu&&<button type="button" className="small-button" onClick={onTestMenu}>Режим тренировки</button>}</p>}
        {command.type==='fire'&&canAdjudicate&&<><FacingRuling value={turnToTarget} onChange={setTurnToTarget} local={localAdjudication}/>{command.coverMode==='through'&&<ThroughCoverRuling value={throughDraft} onChange={setThroughDraft}/>}</>}
        {command.type==='fire'&&command.mode==='single'&&<Picker label="Часть тела" value={location} onChange={setLocation} options={[{value:'random',label:'Случайное место'},...LOCATIONS.map(l=>({value:l.id,label:l.label+' · −4'}))]}/>}
        {role==='gm'&&<ProtectionReview value={preview?.protectionReview} actors={visibleActors}/>}
        {command.type==='fire'&&<div className="fire-targets">{command.targetIds.map(id=><button type="button" className="small-button" key={id} onClick={()=>setPending(previous=>previous?.type==='fire'&&previous.targetIds.length>1?{...previous,targetIds:previous.targetIds.filter(aid=>aid!==id)}:null)}>{visibleActors.find(a=>a.id===id)?.name||'Цель'} ×</button>)}</div>}
        {preview?.unresolvedRulings?.length>0&&<p className="adjudication-warning">Нужно подтверждение соглашений сцены ГМом.{role==='gm'&&<button type="button" className="small-button" onClick={()=>{setPending(null);setDialog('rules');}}>Настроить соглашения</button>}</p>}
        {preview?.requiresGmMeleeDecision&&<p className="context-help">Ведущий ещё должен выбрать защиту и подтвердить обстоятельства.</p>}
        {preview?.requiresGmFacingDecision&&<p className="context-help">Предварительный расчёт: ведущий ещё должен решить, была ли атака с разворотом (−2).</p>}
        {preview?.ok ? <div className="intent-details">
          {command.type === 'shoot' && <><div><span>Дистанция</span><strong>{preview.distance.toFixed(1)} м</strong></div><div><span>Проверка</span><strong>{preview.base} + d10 ≥ {preview.difficulty}</strong></div><div><span>Шанс попадания</span><strong>{Math.round(preview.chance * 100)}%</strong></div><div><span>Урон</span><strong>{actor?.weapon?.damageDice}d6{actor?.weapon?.damageBonus ? '+' + actor.weapon.damageBonus : ''}</strong></div>{preview.location === 'head' && <p className="head-warning">Голова: урон ×2; больше 8 — гибель.</p>}{preview.line?.cover && <p className="cover-note"><Shield size={15}/>Укрытие закрывает ноги</p>}</>}
          {command.type==='fire'&&<>{preview.lines?.some(line=>line.cover)&&<p className="cover-note">{command.coverMode==='through'?'Прострел: защита преграды и брони объединяется пропорционально. Предмет не разрушается автоматически.':'Закрытые ГМом части тела исключены из обычного случайного попадания.'}</p>}<p>{command.rounds} патронов в одном действии · следующее действие −{3*(actor.actions+1)}</p>{preview.targets?.map(target=><p key={target.id}>{visibleActors.find(a=>a.id===target.id)?.name}: {target.base} {target.modeModifier>=0?'+':''}{target.modeModifier??'?'} + d10 ≥ {target.difficulty} · выделено {target.allocatedRounds} патр.</p>)}</>}
          {command.type==='melee'&&preview.attackBase!==undefined&&<p>{preview.attackBase} + d10 против {preview.defenseBase} + d10. Ничья в пользу защитника.</p>}
          {command.type==='switch'&&<><h2>{preview.weaponName}</h2><p>Одно действие; магазины не пополняются.</p></>}
          {command.type==='flip'&&<><h2>Опрокинуть стол</h2><p>Одно действие. ГМ проверяет возможность опрокидывания. После подтверждения изменятся занятые клетки и защита: {preview.footprint.w}×{preview.footprint.h}; {preview.blocksVision?'преграждает взгляд':'не преграждает взгляд'}.</p></>}
          {command.type==='unjam'&&<p>Один ход работы. Осталось {preview.remainingTurns}. После подтверждения нужно завершить ход.</p>}
          {command.type === 'move' && <><h2>{preview.distance.toFixed(1)} м</h2><div><span>Предел за раунд</span><strong>{actor.stats.ma * 3} м</strong></div><p>Одно действие. Следующее: {-(actor.actions + 1) * 3}.</p></>}
          {command.type === 'face' && <><h2>{headingLabel(command.heading)}</h2><p>Передняя половина обзора · 180°. Новые клетки появятся только после подтверждения. Поворот сам по себе не списывает отдельное действие.</p></>}
          {command.type === 'place' && <><h2>{actor.name}</h2><p>Клетка {command.x + 1}, {command.y + 1}</p></>}
          {command.type === 'reload' && <><h2>{actor.weapon.name}</h2><p>Загрузить {preview.count} патронов.<br />Одно действие.</p></>}
          {command.type === 'paint' && <><h2>{PROP_CATALOG[paint]?.label || MAP_TOOLS.find(tool=>tool.value===paint)?.label || 'Карта'}</h2><p>Клетка {command.x + 1}, {command.y + 1}{editorFootprint && <> · {preview.footprint?.w || editorFootprint.w}×{preview.footprint?.h || editorFootprint.h} клеток</>}</p></>}
          {['door', 'interact'].includes(command.type) && <h2>{preview.text === 'Изменить сцену' ? (state.tiles[command.y][command.x].open ? 'Закрыть дверь' : 'Открыть дверь') : preview.text}</h2>}
          </div> : <><p className="intent-error">{preview?.error || 'Проверяем действие на сервере…'}</p><button className="small-button" onClick={() => setPending(null)}>Выбрать другое</button></>}
        {command.type==='paint'&&PROP_CATALOG[paint]&&<button type="button" className="small-button prop-rotate" onClick={rotateProp} aria-label={'Повернуть предмет · ' + facingName}><RotateCcw size={18}/>{facingName} · {editorFootprint.w}×{editorFootprint.h}</button>}
        </div>
        {preview?.ok && <button className="primary-button confirm-action" disabled={busy || command.type==='melee'&&role==='player'&&localAdjudication || ['shoot','fire'].includes(command.type)&&canAdjudicate&&typeof turnToTarget!=='boolean'||command.type==='fire'&&canAdjudicate&&!preview.readyToRoll||command.type==='melee'&&canAdjudicate&&preview.requiresGmMeleeDecision} onClick={() => send(command)}><Check size={17}/>{role === 'player' ? 'Отправить ГМу' : command.type === 'shoot' ? 'Огонь' : command.type === 'paint' ? 'Применить' : preview.text}</button>}
      </aside>}
      {!dialog && !command && !editor && feedback && feedback.id !== dismissedFeedback && <CombatFeedback event={feedback} onClose={() => setDismissedFeedback(feedback.id)}/>}
      {notice && <div className={'game-notice ' + (notice.error ? 'error' : '')} role="status">{notice.text}</div>}
      {state.phase === 'paused' && <div className="pause-label"><Pause size={22}/>Пауза</div>}
      {!command&&action==='face'&&actor&&<div className="facing-picker" role="group" aria-label="Направление персонажа">{HEADINGS.map(heading=><button type="button" key={heading} aria-label={headingLabel(heading)} aria-pressed={actorHeading(actor)===heading} onClick={()=>setPending({id:newId(),type:'face',actorId:actor.id,heading,expectedVersion:state.version})}>{['→','↘','↓','↙','←','↖','↑','↗'][heading/45]}</button>)}<IconButton Icon={X} label="Отменить поворот" onClick={()=>{setPending(null);setAction('inspect');}}/></div>}
      {!command && (editor || action !== 'inspect'&&action !== 'face') && <div className="map-hint targeting-hint" role="status"><span>{hint}</span><IconButton Icon={X} label="Отменить действие" onClick={()=>{setPending(null);setEditor(false);setAction('inspect');}}/></div>}
    </section>

    {state.phase === 'combat' && actor && <footer className="battle-hotbar" aria-label="Быстрые действия боя">
      <button type="button" className="hotbar-actor" onClick={()=>selectActor(actor)} aria-label={'Действия и состояние: ' + actor.name}><Avatar actor={actor}/><span><strong>{actor.name}</strong><small>{state.awaitingGmResolution?'Разбор ГМа':waiting ? 'Заявка у ГМа' : actor.id === turn?.id ? (role==='gm'?'Ход участника':'Твой ход') : 'Ожидание хода'}</small></span></button>
      <div className="hotbar-actions" aria-label="Действия персонажа">{ACTIONS.filter(a=>a.id !== 'inspect' && (a.id !== 'net' || actor.net?.deck)).map(({id,label,Icon,key})=><button type="button" key={id} className={'hotbar-slot ' + (action === id ? 'is-active' : '')} aria-pressed={action===id} disabled={!actionAllowed(id)} onClick={()=>chooseAction(id)} title={label + ' · ' + key}><Icon size={19}/><span>{id==='shoot'&&actor.loadout?'Атака':label}</span></button>)}</div>
      <button type="button" className="hotbar-end" disabled={busy || state.awaitingGmResolution||!!state.unresolvedFumbles?.length||actor.id !== turn?.id || !!command} onClick={()=>{setDialog(null);send({type:'end',actorId:actor.id});}} title={command ? 'Сначала подтверди или отмени выбранное действие' : 'Завершить ход'}><span>Завершить ход</span><ChevronRight size={18}/></button>
    </footer>}

    {!portraitDismissed && <div className="portrait-prompt"><Smartphone size={46}/><h2>Поверни телефон</h2><p>Для карты и действий удобнее горизонтальный экран.</p><button className="primary-button" onClick={fullscreen}><Maximize size={17}/>Полный экран</button><button className="text-button" onClick={() => setPortraitDismissed(true)}>Продолжить вертикально</button></div>}

    <Dialog open={!!dialog && !INLINE_PANELS.includes(dialog)} onOpenChange={open => {
            if (!open) {
                if(dialog==='training-setup'){closeTraining();return;}
                if(dialog==='cover-edit'){closeCover();return;}
                if (dialog === 'net') {
                    setPending(null);
                    setAction('inspect');
                }
                setDialog(null);
            }
        }}>
      <DialogContent className={'nc-firefight game-dialog dialog-' + dialog}>
        <DialogHeader><DialogTitle>{dialog==='cover-edit'?'Материал и укрытие':dialog==='training-setup'?'Подготовить учебный бой':dialog==='fumbles'?'Критические ошибки':dialog === 'requests' ? 'Заявки на подтверждение' : dialog === 'finish' ? 'Завершить бой?' : dialog === 'net' ? 'Контроль устройств' : dialog === 'roster' ? 'Участники сцены' : dialog === 'log' ? 'Журнал боя' : dialog === 'rules' ? 'Правила и управление' : dialog === 'scene' ? 'Сцена' : dialog === 'reset' ? 'Начать демонстрацию заново?' : viewedDetails?.name || 'Персонаж'}</DialogTitle><DialogDescription>{dialog==='cover-edit'?'Параметры преграды подтверждает ведущий.':dialog==='training-setup'?'Одна проверка двух видов оружия. Позиции, ранения и текущие патроны сохранятся.':dialog === 'requests' ? 'Только подтверждённое действие меняет состояние сцены.' : dialog === 'finish' ? 'Подтверждённые последствия сохранятся. Новые действия будут закрыты.' : dialog === 'net' ? 'Locate Remote · Control Remote · Cyberpunk 2020' : dialog === 'roster' ? 'Выбери персонажа для осмотра или расстановки.' : dialog === 'log' ? 'События текущей сцены.' : dialog === 'rules' ? 'Cyberpunk 2020 · первая рабочая версия' : dialog === 'scene' ? saveStatus : dialog === 'reset' ? 'Текущие позиции, ранения и патроны будут заменены исходной сценой.' : viewedDetails?.team === 'crew' ? 'Персонаж группы' : 'Персонаж сцены'}</DialogDescription></DialogHeader>
        <div className="dialog-body">
          {dialog==='cover-edit'&&role==='gm'&&coverEdit&&<><div hidden={coverDiscard}><CoverProfileEditor key={coverEdit.battleId+':'+coverEdit.version} target={coverEdit.target} profile={coverEdit.profile} onDirty={setCoverDirty} onCancel={closeCover} disabled={busy||state.version!==coverEdit.version||state.id!==coverEdit.battleId} onConfirm={async ({target,profile})=>{if(stateRef.current.version!==coverEdit.version||stateRef.current.id!==coverEdit.battleId)return {error:'Сцена изменилась. Открой настройку снова.'};const result=await send({type:'configure-cover',expectedVersion:coverEdit.version,target:target.propId?{propId:target.propId}:{x:target.x,y:target.y},profile});if(result){setCoverDirty(false);setCoverDiscard(false);setDialog('object');}return result;}}/>{state.version!==coverEdit.version&&<p role="alert">Сцена изменилась. Закрой и открой настройку заново.</p>}</div>{coverDiscard&&<div className="reset-actions"><p>Закрыть несохранённые параметры укрытия?</p><button className="small-button" onClick={()=>setCoverDiscard(false)}>Продолжить настройку</button><button className="danger-button" onClick={()=>{setCoverDirty(false);setCoverDiscard(false);setDialog(null);}}>Закрыть без сохранения</button></div>}</>}
          {dialog==='training-setup'&&training&&role==='gm'&&<><div hidden={trainingDiscard}><TrainingLoadoutSetup scene={state} disabled={busy||!canEdit} onDirty={setTrainingDirty} onCancel={closeTraining} onConfirm={async cmd=>{if(!training||role!=='gm'||!canEdit||stateRef.current.id!==cmd.battleId||stateRef.current.version!==cmd.expectedVersion)return false;const result=await send(cmd);if(result){setTrainingDirty(false);setTrainingDiscard(false);setDialog('menu');}return result;}}/>{trainingGroups?.error&&onLoadout&&<div className="training-manual-list"><p>Открой отдельный профиль участника:</p>{missingProfiles.map(participant=><button type="button" className="small-button" key={participant.id} onClick={()=>{setDialog(null);onLoadout(participant);}}>{participant.name}</button>)}</div>}</div>{trainingDiscard&&<div className="reset-actions"><p>Закрыть несохранённую учебную подготовку?</p><button type="button" className="small-button" onClick={()=>setTrainingDiscard(false)}>Продолжить подготовку</button><button type="button" className="danger-button" onClick={()=>{setTrainingDiscard(false);setTrainingDirty(false);setDialog(null);}}>Закрыть без сохранения</button></div>}</>}

          {dialog === 'finish' && <div className="reset-actions"><button className="small-button" onClick={()=>setDialog('scene')}>Отмена</button><button className="primary-button" disabled={busy} onClick={async()=>{await send({type:'finish'});setDialog(null);}}>Да, завершить бой</button></div>}
          {dialog === 'requests' && <div className="battle-requests">{declarations.filter(d=>d.status==='pending').map(d=><article key={d.id}><strong>{visibleActors.find(a=>a.id===d.actorId)?.name || 'Участник'} · {d.preview?.text || ({shoot:'Выстрел',move:'Перемещение',reload:'Перезарядка',face:'Поворот',end:'Завершить ход',control:'Контроль устройства'}[declarationIntent(d).type] || 'Действие')}</strong><p>{declarationSummary(d)}</p>{d.preview?.base!==undefined && <p>Проверка {d.preview.base} + d10 ≥ {d.preview.difficulty}</p>}{d.preview?.distance!==undefined && <p>Дистанция {Number(d.preview.distance).toFixed(1)} м{d.preview?.chance!==undefined ? ' · шанс '+Math.round(d.preview.chance*100)+'%' : ''}</p>}<p>{role==='gm' ? 'Проверь намерение и обстоятельства.' : 'Ожидает решения ГМа.'}</p>{role==='gm' && <div className="reset-actions">{['fire','melee'].includes(declarationIntent(d).type)?<FoundationRequestReview key={d.id+':'+state.version} declaration={d} scene={state} onPreview={onPreview} onConfirm={send} onRules={()=>setDialog('rules')} disabled={transportBusy||!online}/>: (declarationIntent(d).type)==='shoot'?<ShotRequestReview key={d.id+':'+state.version} declaration={d} version={state.version} onPreview={onPreview} onConfirm={send} disabled={transportBusy||!online}/>:<button className="primary-button" disabled={transportBusy || !online} onClick={()=>send({type:'confirm',declarationId:d.id})}><Check size={17}/>Подтвердить действие</button>}<button className="small-button" disabled={transportBusy || !online} onClick={()=>send({type:'reject',declarationId:d.id})}><X size={17}/>Отклонить</button></div>}</article>)}{!declarations.some(d=>d.status==='pending') && <p>Ожидающих заявок нет.</p>}</div>}

          {dialog === 'net' && <NetControls actor={actor} scene={view} command={command} preview={preview} busy={busy} onStage={cmd => setPending({ id: newId(), expectedVersion: state.version, ...cmd })} onSend={send}/>}
          {dialog === 'roster' && <>{role==='gm'&&<p className="local-note">Ручное скрытие ГМа сохраняется даже в прямой видимости. Стены и двери закрывают обзор игроков отдельно, автоматически.</p>}<div className="roster-list">{visibleActors.map(a => <div className={'roster-row ' + (a.id === actor?.id ? 'selected' : '')} key={a.id}><button onClick={() => selectActor(a)}><Avatar actor={a}/><span><strong>{a.name}</strong><small>{a.team === 'crew' ? 'Группа' : 'НПС'}{a.hidden ? ' · скрыт ГМом' : ''}{a.status === 'dead' ? ' · погиб' : ''}</small></span><MapPin size={17}/></button>{role === 'gm' && a.team !== 'crew' && <IconButton Icon={a.hidden ? EyeOff : Eye} label={a.hidden ? 'Снять ручное скрытие: ' + a.name : 'Скрыть вручную: ' + a.name} onClick={() => send({ type: 'hide', actorId: a.id })}/>}</div>)}</div>{role === 'gm' && ['preparation','ended'].includes(state.phase) && <button className="small-button" onClick={() => onAddNpc ? (setDialog(null),onAddNpc()) : training ? send({ type: 'add' }) : (setDialog(null),onSetup?.())}><Plus size={17}/>Добавить НПС</button>}</>}
          {dialog === 'log' && <div className="combat-log">{view.log.length ? view.log.slice().reverse().map(e => <article key={e.id}><span>Раунд {e.round || '—'}</span><p>{e.text}</p>{e.total !== undefined && <small>d10: {e.roll}{e.bonus ? ' + ' + e.bonus : ''} · итог {e.total} / {e.difficulty}{e.rawDamage !== undefined ? ' · урон до брони ' + e.rawDamage + (e.sp !== undefined ? ' · SP ' + e.sp : '') + (e.btm !== undefined ? ' · BTM ' + e.btm : '') : ''}</small>}{e.armorWear && <p className={e.armorWear.requiresManualUpdate ? 'armor-wear-warning' : 'armor-wear-note'}>Броня: SP {e.armorWear.before} → {e.armorWear.after}. {e.armorWear.persisted ? 'Износ сохранён в листе.' : e.armorWear.requiresManualUpdate ? 'Нужна ручная правка листа. ' + e.armorWear.reason : 'Износ сохранён в сцене.'}</p>}{e.stunRoll !== null && e.stunRoll !== undefined && <small>Оглушение: {e.stunRoll} ≤ {e.stunLimit}{e.stunRoll <= e.stunLimit ? ' · выдержал' : ' · оглушён'}</small>}</article>) : <p className="empty-copy">Событий пока нет. Начни бой или измени расстановку.</p>}</div>}
          {dialog==='fumbles'&&role==='gm'&&(state.unresolvedFumbles||[]).map(entry=><FumbleReview key={entry.commandId} entry={entry} actors={state.actors} disabled={transportBusy||!online} onResolve={send}/>)}
          {dialog==='rules'&&role==='gm'&&<section><h3>Соглашения этой сцены</h3><p>Staged Penetration · дополнительное правило core, стр. 102: {state.settings?.stagedPenetration?'включено':'выключено'}.</p><button type="button" className="small-button" disabled={busy} onClick={()=>send({type:'armor-rule',enabled:!state.settings?.stagedPenetration})}>{state.settings?.stagedPenetration?'Выключить':'Включить'} дополнительный износ брони</button><RulesProfileEditor value={rulesDraft??state.settings?.cp2020Rulings??{}} onChange={setRulesDraft} disabled={transportBusy}/><button type="button" className="primary-button" disabled={transportBusy||!online||!rulesProfileReady(rulesDraft??state.settings?.cp2020Rulings??{})} onClick={async()=>{if(await send({type:'rules',rulings:rulesDraft??state.settings?.cp2020Rulings??{}}))setRulesDraft(null);}}>Подтвердить соглашения сцены</button></section>}
          {dialog === 'rules' && <div className="rules-copy"><h3>Как управлять</h3><p>В режиме ГМа видна вся сцена: выбранная фигура отвечает за управление, а не за глаза персонажа. Игрок получает только свой серверный обзор. Нажми на персонажа или его имя в очереди. Выбери действие в хотбаре, затем клетку или цель на карте. Посмотри предпросмотр и подтверди. Касание карты само по себе ничего не расходует.</p><p>Перемещай карту пальцем или мышью. Щипок и колесо меняют масштаб. Кнопка масштаба открывает приближение, общий вид и сетку; прицел возвращает камеру к персонажу.</p><p>На клавиатуре: 1–6 — действия, пробел — закончить ход, Escape — отменить выбор. Когда карта в фокусе, стрелки выбирают клетку, Enter подтверждает выбор клетки.</p><h3>Базовые правила 2020</h3><p>Раунд ≈ 3 секунды. Инициатива: d10 + REF с учётом ранений + Combat Sense; перебрасывается каждый раунд. Равенство: Combat Sense, затем REF, затем постоянный ID.</p><p>Первое действие без штрафа. Следующие проверки: −3, −6, −9… Перемещение и перезарядка расходуют действие. Один маршрут за раунд, до 3 × MA метров; диагональ измеряется по длине. Отдельных очков действий нет.</p><p>Выстрел: REF + навык оружия + WA + модификаторы + d10. Натуральная 1 — промах; 10 добавляет ещё один d10. Прицельный выстрел в часть тела получает −4. ROF ограничивает суммарное число выстрелов за раунд.</p><p>Броня SP учитывается по месту попадания. После неё применяется BTM, минимум 1 при пробитии. Урон голове удваивается после BTM. Ранения вызывают проверки оглушения и смертельного шока.</p><p>ГМ назначает закрытые зоны конкретной преграды: они исключены из обычного попадания по примеру низкой стены в core. Старые ненастроенные низкие предметы сохраняют только прежний пример защиты ног у цели, без выдуманного SP. Для обычного огня непрозрачные преграды закрывают цель. Прострел — отдельная заявка с подтверждёнными материалами/SP и решением ГМа об осведомлённости и модификаторах. SP укрытия и брони объединяется пропорционально (core, стр. 101).</p><h3>Границы этой сборки</h3><p>Общая сцена рассчитывается сервером. Игрок отправляет заявку, ведущий подтверждает действие. В тренировке ведущий управляет обеими сторонами; реальные листы не меняются. Все НПС управляются вручную.</p><p>Подтверждённые профили поддерживают смену оружия, общий запас и раздельные магазины, одиночные выстрелы в одном действии, очередь из трёх и автоогонь. Базовая рукопашная использует встречные проверки с выбранной ГМом защитой. Подавление, гранаты, накопленное прицеливание, особые рукопашные приёмы, полное погружение в Net и MicroNET ещё не подключены. Последствия критического промаха и ограничения от уничтоженной конечности определяет ГМ.</p><p>{state.settings?.stagedPenetration ? 'Дополнительное правило Staged Penetration включено: пробитая броня теряет 1 SP. В кампании ручная броня или единственный подтверждённый слой обновляются в листе; сложную многослойную броню проверяет ведущий по явному предупреждению.' : 'Необязательное правило Staged Penetration в этой сцене выключено. Износ брони определяет ведущий.'} Масштаб {state.tileMeters} м на клетку, один маршрут за раунд и порядок равной инициативы — явные соглашения этой версии.</p>{rulesNote && <p className="source-note">{rulesNote}</p>}<h3>Направление и разворот</h3><p>Стрелка у ног показывает направление. Личный обзор — передняя половина от линии плеч; восемь положений и поворот в свой ход являются соглашениями приложения. Для каждого выстрела ведущий явно решает, применяется ли «Атака с разворотом −2». Автоматическая дополнительная цена поворота или срок штрафа не выдумываются.</p><h3>Контроль устройств</h3><p>В демонстрации Мира — нетраннер с декой и Interface 4. В её ход: Сеть → подключить деку к соседнему порту → найти устройства → выбрать команду. Genie управляет дверями (STR 5), Crystal Ball показывает камеру (STR 4), Soundmachine управляет громкой связью (STR 4). Успех: d10 ≤ STR программы; Interface и штраф следующих физических действий к этому броску не добавляются.</p><p>Камера обнаруживает скрытых участников в пределах 6 м и прямой видимости. Реакцию НПС на тревогу определяет ГМ. Порт, короткий кабель, локальная сеть и одна попытка Control за раунд — упрощения этой версии. Импланты врагов не являются обычными remotes.</p><p className="source-note">Источник: твоя основная книга Cyberpunk 2020, страницы 29, 42–43, 61, 97–107, 132–140, 150–153. Интерфейс и оригинальные изображения разработаны отдельно.</p></div>}
          {dialog === 'scene' && <div className="scene-options"><div className="setting-row"><span><strong>Сетка карты</strong><small>Масштаб {state.tileMeters} м на клетку</small></span><Switch checked={grid} onCheckedChange={setGrid} aria-label="Сетка карты"/></div><div className="setting-row"><span><strong>Звук выстрелов</strong><small>Короткий эффект при подтверждении атаки</small></span><Switch checked={sound} onCheckedChange={value => { setSound(value); if(value){if(!audioRef.current)audioRef.current = new BattleAudio();void audioRef.current.enable?.();} try {
        localStorage.setItem('night-city-sound', String(value));
    }
    catch { } }} aria-label="Звук выстрелов"/></div><p className="local-note">{training ? 'Тренировка сохраняется отдельно. Управляй Рэем, Мирой и охранниками, нажимая на фигуру или очередь. Реальные листы не меняются.' : 'Сцена сохраняется на сервере. Игроки получают только свой разрешённый обзор; действия подтверждает ведущий.'}</p>{role === 'gm' && <>{!saved && <p className="local-note">Карта будет сохранена перед добавлением НПС или импортом сцены.</p>}{onExport && <button className="small-button wide" disabled={busy} onClick={() => {setDialog(null);onExport();}}><Download size={17}/>Экспорт сцены</button>}{onImport && <button className="small-button wide" disabled={busy} onClick={() => {setDialog(null);onImport();}}><Upload size={17}/>Импорт сцены</button>}{!onImport && saved && <p className="local-note">Импорт доступен в подготовке или после завершения боя.</p>}{['combat', 'paused'].includes(state.phase) && <button className="small-button wide" disabled={busy} onClick={() => setDialog('finish')}><Square size={17}/>Завершить бой, сохранив последствия</button>}{training && <button className="small-button wide danger-text" disabled={transportBusy} onClick={() => setDialog('reset')}><RotateCcw size={17}/>Сбросить демонстрацию</button>}</>}</div>}
          {dialog === 'reset' && <div className="reset-actions"><button className="small-button" onClick={() => setDialog('scene')}>Вернуться к сцене</button><button className="primary-button danger-button" onClick={reset}>Сбросить демонстрацию</button></div>}
          {dialog === 'character' && viewedDetails && <div className="character-details"><div className="character-heading"><Avatar actor={viewedDetails} large/><div><strong>{viewedDetails.name}</strong><span>{viewedDetails.status === 'dead' ? 'Погиб' : viewedDetails.status === 'stunned' ? 'Оглушён' : 'В сцене'}</span></div></div>{viewedDetails.stats ? <><div className="stat-grid"><div><span>REF</span><strong>{effectiveRef(viewedDetails)}</strong></div><div><span>MA</span><strong>{viewedDetails.stats.ma}</strong></div><div><span>BODY</span><strong>{viewedDetails.stats.body}</strong></div><div><span>Combat Sense</span><strong>{viewedDetails.stats.combatSense}</strong></div></div>{viewedDetails.net?.deck && <p>Нетраннер · Interface {viewedDetails.stats.interface} · программы: {viewedDetails.net.programIds.map(id=>({genie:'Genie',crystalBall:'Crystal Ball',soundmachine:'Soundmachine'}[id] || id)).join(', ') || 'не выбраны'}.</p>}<h3>{viewedDetails.weapon.name}</h3><p>{viewedDetails.weapon.damageDice}d6{viewedDetails.weapon.damageBonus ? '+' + viewedDetails.weapon.damageBonus : ''} · WA {viewedDetails.weapon.accuracy} · ROF {viewedDetails.weapon.rof} · дальность {viewedDetails.weapon.range} м</p><p>Патроны: {viewedDetails.weapon.ammo} / {viewedDetails.weapon.magazine} · запас {viewedDetails.weapon.reserve}</p><h3>Броня и ранения</h3><div className="armor-grid">{LOCATIONS.map(l => <div key={l.id}><span>{l.label}</span><strong>SP {viewedDetails.armor[l.id]}</strong>{viewedDetails.armorPersistence?.[l.id] && <small title={viewedDetails.armorPersistence[l.id].reason}>{viewedDetails.armorPersistence[l.id].mode === 'manual' ? 'Ручная броня · лист' : viewedDetails.armorPersistence[l.id].mode === 'item' ? 'Один слой · предмет' : armorPersistenceLabel(viewedDetails.armorPersistence[l.id])}</small>}{viewedDetails.wearPending?.[l.id] && <small className="armor-wear-warning">Нужна правка листа: SP {viewedDetails.wearPending[l.id].sourceSP} → {viewedDetails.wearPending[l.id].resultSP}. {viewedDetails.wearPending[l.id].reason}</small>}{viewedDetails.destroyed.includes(l.id) && <small>Уничтожена</small>}</div>)}</div><p>Ранения: {viewedDetails.wounds} · {woundInfo(viewedDetails.wounds).label}</p></> : <p>Личные характеристики и содержимое инвентаря этого персонажа закрыты.</p>}</div>}
        </div>
      </DialogContent>
    </Dialog>

  </main>;
}
