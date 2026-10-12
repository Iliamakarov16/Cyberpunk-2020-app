'use client';
import {forwardBack,useBackEvent,useBackTrail} from '@/lib/native-navigation';

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, BookOpen, Check, ChevronRight, Copy, Crosshair, Download, FileText, Folder, FolderPlus, KeyRound, LoaderCircle, LockKeyhole, Map, RefreshCw, Save, Send, ShieldCheck, UserRound, Users, X, type LucideIcon} from 'lucide-react';
import {AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle} from '@/components/ui/alert-dialog';
import {PlayerField, usePlayerSettings} from '@/components/player-help';
import {normalize, type Character} from '@/lib/tracker';
import CampaignTerminal from '@/components/campaign-terminal';
import CharacterExterior,{CharacterPortrait} from '@/components/character-exterior';
import type {ExteriorCard} from '@/lib/character-appearance';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import MotionSurface from '@/components/interface-motion';
import type {SceneSheetContext,SceneSheetRequest,CampaignRoleContext} from '@/lib/campaign-navigation';
import TransferPanel from '@/components/transfer-panel';
import {RecordFooter} from '@/components/record-shell';
import SignalType from '@/components/signal-type';

type Id = number;
type Campaign = {
  id:Id; name:string; description:string; gm_id:number; gm:string;
  version:number; updated:number; is_gm:boolean; is_member:boolean; transfer_to:number|null;
};
type Roster = {character_id:number; owner_id:number; owner:string; name:string; role:string; status:'pending'|'active'|'reserve'; can_open:boolean;exterior?:ExteriorCard};
type CampaignDetail = Campaign & {
  roster:Roster[]; members?:{id:number; username:string}[];
  invite_code?:string; gm_notes?:string; ledger?:string;
};
type Draft = {name:string; description:string; gm_notes:string; ledger:string};
type Notice = {message:string; bad?:boolean};
type Confirmation = {title:string; message:string; action:string; run:()=>void; danger?:boolean};
export type CampaignHubProps = {
  me:{id:number; username:string; role:string}; characters:Character[];
  api:(path:string, method?:string, data?:unknown)=>Promise<any>;
  open:(character:Character,context?:SceneSheetContext)=>void; refreshCharacters:()=>Promise<void>;
  createCharacter:()=>void;
  onOpenAtlas?:(context:{campaignId:number;campaignName:string;isGM:boolean})=>void;
  onOpenBattle?:(campaign:{campaignId:number;campaignName:string;initialTool?:'import'})=>void;
  navigationRevision:()=>number;
  onDirtyChange?:(dirty:boolean)=>void;
  onBusyChange?:(busy:boolean)=>void;
  onContextChange?:(context:CampaignRoleContext|null)=>void;
};
const draftOf = (campaign:CampaignDetail):Draft=>({name:campaign.name,description:campaign.description,gm_notes:campaign.gm_notes||'',ledger:campaign.ledger||''});
const encoded = (id:Id)=>encodeURIComponent(String(id));
const errorText = (error:unknown)=>error instanceof Error?error.message:'Не удалось выполнить действие. Попробуй ещё раз.';
const statusName = {pending:'Заявка',active:'В партии',reserve:'Резерв'};

function CampaignGuide({detail=false}:{detail?:boolean}){
  const settings=usePlayerSettings();
  if(!settings.tutorial)return null;
  return <details className="campaign-guide">
    <summary><BookOpen aria-hidden="true"/>{detail?'Как устроена эта папка':'От личного персонажа до партии'}</summary>
    <div>{detail?<>
      <p>«В партии» — действующий персонаж. «Резерв» сохраняет участие и доступ ведущего к листу: так можно отложить старого героя, не удаляя его.</p>
      <p>Заявки принимает ведущий. Вывод персонажа убирает его из кампании и закрывает доступ ведущего к этому листу через неё. Сам лист остаётся в твоей коллекции, а твоё членство в группе сохраняется.</p>
      <p>Заметки и учёты ведущего закрыты от игроков. Описание кампании и список участников доступны её участникам.</p>
    </>:<>
      <p>Создай персонажа в своей коллекции. Затем введи код кампании и выбери, какой лист отправить ведущему. Код открывает подачу заявки; ведущий решает, кого принять.</p>
      <p>Персонажей может быть несколько. Отдельные кампании хранят своё участие: один лист можно отправить в несколько кампаний, но изменения самого листа будут общими.</p>
      <p>Ты можешь играть в одной кампании и вести другую. Здесь нет переключения роли посреди игры: ведущий назначен отдельно для каждой кампании.</p>
    </>}</div>
  </details>;
}

export default function CampaignHub({me,characters,api,open,createCharacter,navigationRevision,refreshCharacters,onDirtyChange,onBusyChange,onContextChange,onOpenBattle,onOpenAtlas}:CampaignHubProps){
  const sharedBattleAvailable=!!onOpenBattle;
  const [campaigns,setCampaigns]=useState<Campaign[]>([]);
  const [selected,setSelected]=useState<Id|null>(null),[detail,setDetail]=useState<CampaignDetail|null>(null);
  const [loading,setLoading]=useState(true),[detailLoading,setDetailLoading]=useState(false),[busy,setBusy]=useState(false);
  const [openingSheet,setOpeningSheet]=useState(false);
  const [exteriorId,setExteriorId]=useState<number|null>(null);
  const exterior=detail?.roster.find(r=>r.character_id===exteriorId)?.exterior;
  useEffect(()=>{if(exteriorId!==null&&!exterior)setExteriorId(null);},[exteriorId,exterior]);
  const [draft,setDraft]=useState<Draft>({name:'',description:'',gm_notes:'',ledger:''}),[baseline,setBaseline]=useState('');
  const [notice,setNotice]=useState<Notice|null>(null),[confirmation,setConfirmation]=useState<Confirmation|null>(null);
  const [form,setForm]=useState<'create'|'join'|'transfer'|null>(null);
  const [terminalDirty,setTerminalDirty]=useState(false),[transferDirty,setTransferDirty]=useState(false);
  const terminalDirtyRef=useRef(terminalDirty);terminalDirtyRef.current=terminalDirty;
  const [terminalBusy,setTerminalBusy]=useState(false),[transferBusy,setTransferBusy]=useState(false);
  const operationBusy=busy||terminalBusy||transferBusy;const operationBusyRef=useRef(operationBusy);operationBusyRef.current=operationBusy;
  const [newName,setNewName]=useState(''),[newDescription,setNewDescription]=useState('');
  const [joinCode,setJoinCode]=useState(''),[joinCharacter,setJoinCharacter]=useState('');
  const [section,setSection]=useState<'overview'|'roster'|'notes'|'settings'|'terminal'|'transfer'>('overview'),[successor,setSuccessor]=useState('');
  const sectionTrail=useBackTrail(section,selected);
  const [rosterFilter,setRosterFilter]=useState<'all'|'accepted'|'pending'>('all');
  const [terminalRequest,setTerminalRequest]=useState<{section:'messages'|'scene';revision:number}>({section:onOpenBattle?'messages':'scene',revision:0});
  const currentRef=useRef({me,api,open,refreshCharacters,onDirtyChange,onBusyChange,characters,navigationRevision});
  currentRef.current={me,api,open,refreshCharacters,onDirtyChange,onBusyChange,characters,navigationRevision};
  const selectedRef=useRef<Id|null>(selected);selectedRef.current=selected;
  const detailRef=useRef<CampaignDetail|null>(detail);detailRef.current=detail;
  const draftRef=useRef(draft);draftRef.current=draft;
  const baselineRef=useRef(baseline);baselineRef.current=baseline;
  const notesDirty=!!detail?.is_gm&&JSON.stringify(draft)!==baseline;
  const notesDirtyRef=useRef(notesDirty);notesDirtyRef.current=notesDirty;
  const formDirty=form==='create'?(!!newName||!!newDescription):form==='join'?(!!joinCode||!!joinCharacter):false;
  const dirty=notesDirty||terminalDirty||transferDirty||formDirty||busy;
  const dirtyRef=useRef(dirty);dirtyRef.current=dirty;
  const listRequest=useRef(0),detailRequest=useRef(0),operation=useRef(0),activeAccount=useRef(me.id);
  const sheetRequest=useRef(0),sheetLoading=useRef(false);

  const readList=useCallback(async()=>{
    const account=currentRef.current.me.id,request=++listRequest.current;
    setLoading(true);
    try{
      const next=await currentRef.current.api('/api/campaigns');
      if(currentRef.current.me.id===account&&listRequest.current===request)setCampaigns(next);
    }catch(error){
      if(currentRef.current.me.id===account&&listRequest.current===request)setNotice({message:errorText(error),bad:true});
    }finally{
      if(currentRef.current.me.id===account&&listRequest.current===request)setLoading(false);
    }
  },[]);

  const readDetail=useCallback(async(id:Id,preserveDraft=false)=>{
    const account=currentRef.current.me.id,request=++detailRequest.current;
    setDetailLoading(true);
    try{
      const next:CampaignDetail=await currentRef.current.api(`/api/campaigns/${encoded(id)}`);
      if(currentRef.current.me.id!==account||detailRequest.current!==request||selectedRef.current!==id)return;
      const previous=detailRef.current;if(previous?.id===id&&next.version<previous.version)return previous;
      setDetail(next);detailRef.current=next;
      const nextDraft=draftOf(next);
      // Hold the original editing baseline while a local draft is open.
      const keepDraft=preserveDraft||notesDirtyRef.current;
      if(!keepDraft||!next.is_gm){setBaseline(JSON.stringify(nextDraft));baselineRef.current=JSON.stringify(nextDraft);setDraft(nextDraft);draftRef.current=nextDraft;}
      return next;
    }catch(error){
      if(currentRef.current.me.id===account&&detailRequest.current===request&&selectedRef.current===id){
        const status=(error as {status?:number})?.status;
        if(status===401||status===403||status===404){setDetail(null);detailRef.current=null;setDraft({name:'',description:'',gm_notes:'',ledger:''});setBaseline('');baselineRef.current='';notesDirtyRef.current=false;}
        setNotice({message:errorText(error),bad:true});
      }
      return undefined;
    }finally{
      if(currentRef.current.me.id===account&&detailRequest.current===request)setDetailLoading(false);
    }
  },[]);

  useEffect(()=>{
    activeAccount.current=me.id;listRequest.current++;detailRequest.current++;operation.current++;sheetRequest.current++;sheetLoading.current=false;setOpeningSheet(false);setExteriorId(null);
    setCampaigns([]);setSelected(null);selectedRef.current=null;setDetail(null);detailRef.current=null;
    setDraft({name:'',description:'',gm_notes:'',ledger:''});setBaseline('');setBusy(false);
    setNotice(null);setConfirmation(null);setForm(null);setNewName('');setNewDescription('');setJoinCode('');setJoinCharacter('');setSuccessor('');
    void readList();
    return()=>{listRequest.current++;detailRequest.current++;operation.current++;sheetRequest.current++;};
  },[me.id,readList]);

  useEffect(()=>{onDirtyChange?.(dirty);},[dirty,onDirtyChange]);
  useEffect(()=>{onBusyChange?.(operationBusy);},[operationBusy,onBusyChange]);
  useEffect(()=>()=>{currentRef.current.onDirtyChange?.(false);currentRef.current.onBusyChange?.(false);},[]);
  useEffect(()=>{
    const prevent=(event:BeforeUnloadEvent)=>{if(dirtyRef.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',prevent);
    return()=>window.removeEventListener('beforeunload',prevent);
  },[]);
  useEffect(()=>{const sync=()=>{void readList();const id=selectedRef.current;if(id!==null)void readDetail(id);};window.addEventListener('nightcity-sync',sync);const timer=setInterval(()=>{if(document.visibilityState==='visible'){const id=selectedRef.current;if(id!==null)void readDetail(id);else void readList();}},8000);return()=>{window.removeEventListener('nightcity-sync',sync);clearInterval(timer);};},[readList,readDetail]);

  function askToLeave(run:()=>void){
    if(operationBusyRef.current){setNotice({message:'Дождись ответа сервера на текущее действие.'});return;}
    const guarded=()=>{if(operationBusyRef.current){setNotice({message:'Дождись ответа сервера на текущее действие.'});return;}run();};
    if(dirtyRef.current)setConfirmation({title:'Есть незавершённая работа',message:'При выходе черновики этой кампании могут исчезнуть. Сначала сохрани изменения или скачай черновик; коды восстановления тоже можно скачать.',action:'Выйти без сохранения',danger:true,run:guarded});
    else guarded();
  }

  function choose(id:Id,nextSection:typeof section='overview'){
    askToLeave(()=>{
      sheetRequest.current++;sheetLoading.current=false;setOpeningSheet(false);
      setExteriorId(null);setSelected(id);selectedRef.current=id;setDetail(null);detailRef.current=null;setNotice(null);setSection(nextSection);setRosterFilter('all');setSuccessor('');
      setDraft({name:'',description:'',gm_notes:'',ledger:''});setBaseline('');setForm(null);dirtyRef.current=false;
      void readDetail(id);
    });
  }
  function back(){askToLeave(()=>{setExteriorId(null);sheetRequest.current++;sheetLoading.current=false;setOpeningSheet(false);detailRequest.current++;setSelected(null);selectedRef.current=null;setDetail(null);detailRef.current=null;setBaseline('');setNotice(null);setDetailLoading(false);dirtyRef.current=false;});}
  useBackEvent('nightcity-hub-back',()=>{
    if(confirmation){setConfirmation(null);return true;}
    if(operationBusyRef.current){setNotice({message:'Дождись ответа сервера на текущее действие.'});return true;}
    if(exteriorId!==null){setExteriorId(null);return true;}
    if(form){askToLeave(()=>{setForm(null);setNewName('');setNewDescription('');setJoinCode('');setJoinCharacter('');});return true;}
    if(selected===null)return false;
    if(section==='terminal'&&forwardBack('nightcity-terminal-back'))return true;
    const previous=sectionTrail.pop();if(previous!==undefined){setSection(previous);return true;}
    back();return true;
  });
  function refresh(){
    if(busy)return;
    setNotice(null);void readList();
    if(selectedRef.current!==null){
      const wasDirty=notesDirtyRef.current,id=selectedRef.current;
      void readDetail(id,wasDirty).then(next=>{if(next&&wasDirty&&selectedRef.current===id)setNotice({message:'Папка обновлена. Твой черновик оставлен на экране; проверь его перед сохранением.'});});
    }
  }
  function validOperation(account:number,token:number,id?:Id){return activeAccount.current===account&&currentRef.current.me.id===account&&operation.current===token&&(id===undefined||selectedRef.current===id);}

  async function updateRosterLists(account:number,token:number){
    await readList();
    try{await currentRef.current.refreshCharacters();}
    catch{if(validOperation(account,token))setNotice({message:'Изменение сохранено. Список листов пока не обновился; попробуй обновить его ещё раз.',bad:true});}
  }

  async function create(event:React.FormEvent){
    event.preventDefault();if(busy||!newName.trim())return;
    const account=me.id,token=++operation.current;setBusy(true);setNotice(null);
    try{
      const created:{id:Id}=await currentRef.current.api('/api/campaigns','POST',{name:newName.trim(),description:newDescription.trim()});
      if(!validOperation(account,token))return;
      setNewName('');setNewDescription('');setForm(null);setSelected(created.id);selectedRef.current=created.id;setSection('settings');
      const next=await readDetail(created.id);await readList();
      if(validOperation(account,token,created.id))setNotice({message:next?'Кампания создана. Пригласительный код находится в настройках.':'Кампания создана. Открой её повторно, чтобы получить код.'});
    }catch(error){if(validOperation(account,token))setNotice({message:errorText(error),bad:true});}
    finally{if(validOperation(account,token))setBusy(false);}
  }

  async function join(event:React.FormEvent){
    event.preventDefault();if(busy||!joinCode.trim()||!joinCharacter)return;
    const account=me.id,token=++operation.current;setBusy(true);setNotice(null);
    try{
      const joined:{id:Id;name:string}=await currentRef.current.api('/api/campaigns/join','POST',{code:joinCode.trim(),character_id:Number(joinCharacter)});
      if(!validOperation(account,token))return;
      setJoinCode('');setJoinCharacter('');setForm(null);setSelected(joined.id);selectedRef.current=joined.id;setSection('overview');
      await readDetail(joined.id);await updateRosterLists(account,token);
      if(validOperation(account,token,joined.id))setNotice({message:`Заявка в «${joined.name}» отправлена. Ведущий увидит этот лист для проверки.`});
    }catch(error){if(validOperation(account,token))setNotice({message:errorText(error),bad:true});}
    finally{if(validOperation(account,token))setBusy(false);}
  }

  async function save(event:React.FormEvent){
    event.preventDefault();const target=detailRef.current;if(!target?.is_gm||busy||!notesDirtyRef.current||!draftRef.current.name.trim())return;
    if(JSON.stringify(draftOf(target))!==baselineRef.current){setNotice({message:'Эти записи изменили на другом устройстве. Черновик сохранён на экране: скачай его, затем загрузи свежие записи и перенеси нужные изменения.',bad:true});return;}
    const account=me.id,token=++operation.current,snapshot={...draftRef.current,name:draftRef.current.name.trim()};
    setBusy(true);setNotice(null);
    try{
      const saved=await currentRef.current.api(`/api/campaigns/${encoded(target.id)}`,'PUT',{version:target.version,...snapshot});
      if(!validOperation(account,token,target.id))return;
      // The mutation has succeeded. A subsequent refresh cannot turn it into a failed save.
      setDraft(snapshot);draftRef.current=snapshot;setBaseline(JSON.stringify(snapshot));baselineRef.current=JSON.stringify(snapshot);notesDirtyRef.current=false;
      const next={...target,...snapshot,version:typeof saved?.version==='number'?saved.version:target.version+1};
      setDetail(next);detailRef.current=next;
      const refreshed=await readDetail(target.id);await readList();
      if(validOperation(account,token,target.id))setNotice({message:refreshed?'Кампания сохранена.':'Кампания сохранена; актуальные данные пока не удалось загрузить.'});
    }catch(error){if(validOperation(account,token,target.id))setNotice({message:`${errorText(error)} Черновик оставлен на экране.`,bad:true});}
    finally{if(validOperation(account,token))setBusy(false);}
  }

  async function mutate(path:string,data:Record<string,unknown>,message:string,refreshSheets=false){
    const target=detailRef.current;if(!target||busy)return;
    const account=me.id,token=++operation.current,wasDirty=notesDirtyRef.current;setBusy(true);setNotice(null);
    try{
      await currentRef.current.api(`/api/campaigns/${encoded(target.id)}/${path}`,'POST',data);
      if(!validOperation(account,token,target.id))return;
      const next=await readDetail(target.id,wasDirty);
      if(!validOperation(account,token,target.id))return;
      await readList();
      if(refreshSheets){try{await currentRef.current.refreshCharacters();}catch{if(validOperation(account,token,target.id))setNotice({message:`${message} Обновить список листов пока не удалось.`,bad:true});}}
      if(validOperation(account,token,target.id)&&next)setNotice({message});
    }catch(error){if(validOperation(account,token,target.id))setNotice({message:errorText(error),bad:true});}
    finally{if(validOperation(account,token))setBusy(false);}
  }

  async function withdraw(row:Roster){
    const target=detailRef.current;if(!target||busy)return;
    const account=me.id,token=++operation.current;setBusy(true);setNotice(null);
    try{
      await currentRef.current.api(`/api/campaigns/${encoded(target.id)}/withdraw`,'POST',{character_id:row.character_id});
      if(!validOperation(account,token,target.id))return;
      // Removing the final own participant may revoke access to the folder.
      if(!target.is_gm&&target.roster.filter(r=>r.owner_id===me.id&&r.character_id!==row.character_id).length===0&&target.transfer_to!==me.id){
        detailRequest.current++;setSelected(null);selectedRef.current=null;setDetail(null);detailRef.current=null;
      }else await readDetail(target.id,notesDirtyRef.current);
      await updateRosterLists(account,token);
      if(validOperation(account,token))setNotice({message:'Персонаж вышел из кампании и остался в твоей коллекции.'});
    }catch(error){if(validOperation(account,token))setNotice({message:errorText(error),bad:true});}
    finally{if(validOperation(account,token))setBusy(false);}
  }

  async function openSheet(row:Roster,context?:SceneSheetContext){
    if(!row.can_open||operationBusyRef.current||sheetLoading.current)return;
      const account=me.id,token=operation.current,request=++sheetRequest.current,target=detailRef.current,view=currentRef.current.navigationRevision();sheetLoading.current=true;setOpeningSheet(true);setNotice(null);
      try{
        // Recheck access and version: another session may have changed campaign leadership.
        const character:Character=await currentRef.current.api(`/api/characters/${encoded(row.character_id)}`);
        if(!validOperation(account,token,target?.id)||sheetRequest.current!==request||currentRef.current.navigationRevision()!==view)return;
        if(context){
          // Read after the sheet GET: the result may have been undone while that read was pending.
          const freshWorkspace=await currentRef.current.api(`/api/campaigns/${encoded(context.campaignId)}/workspace`);
          if(!validOperation(account,token,target?.id)||sheetRequest.current!==request||currentRef.current.navigationRevision()!==view)return;
          const scene=freshWorkspace?.data?.scene,action=scene?.actions?.find((action:{id:string})=>action.id===context.actionId);
          if(scene?.id!==context.sceneId||action?.status!=='resolved'||action.result!==context.result||!freshWorkspace.characters?.some((character:{id:number})=>character.id===context.characterId)){
            setNotice({message:'Сцена, результат или доступ к персонажу изменились. Проверь актуальную карточку действия перед учётом последствий.',bad:true});
            window.dispatchEvent(new CustomEvent('nightcity-return-to-scene',{detail:context}));return;
          }
          if(terminalDirtyRef.current){setNotice({message:'В терминале появился черновик. Сначала сохрани или отбрось его, затем открой лист.',bad:true});return;}
        }
        // Keep this hub mounted while a sheet is shown, so notes survive reading a sheet.
        currentRef.current.open({...character,data:normalize(character.data)},context);
      }catch(error){if(validOperation(account,token))setNotice({message:errorText(error),bad:true});}
      finally{if(activeAccount.current===account&&sheetRequest.current===request){sheetLoading.current=false;setOpeningSheet(false);}}
  }

  function openSceneSheet(request:SceneSheetRequest){
    const campaign=detailRef.current;if(!campaign)return;
    const row=campaign.roster.find(row=>row.character_id===request.characterId&&row.can_open&&(row.status==='active'||row.status==='reserve'));
    if(!row){setNotice({message:'Этот лист сейчас недоступен в кампании.',bad:true});return;}
    if(terminalDirty){setNotice({message:'Сначала сохрани или отбрось черновики в терминале. После этого можно учесть последствия в листе.',bad:true});return;}
    void openSheet(row,{...request,campaignId:Number(campaign.id),campaignName:campaign.name});
  }

  function downloadDraft(){
    if(!detailRef.current?.is_gm)return;
    const blob=new Blob([JSON.stringify({campaign_id:detailRef.current.id,...draftRef.current},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download=`campaign-${String(detailRef.current.id).replace(/[^\w-]/g,'-')}-notes.json`;document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
  }
  async function copyInvite(){
    if(!detail?.invite_code)return;
    const account=me.id,id=detail.id;
    try{await navigator.clipboard.writeText(detail.invite_code);if(currentRef.current.me.id===account&&selectedRef.current===id)setNotice({message:'Код скопирован. Отправь его своим игрокам.'});}
    catch{if(currentRef.current.me.id===account&&selectedRef.current===id)setNotice({message:'Выдели код в поле и скопируй его вручную: браузер не разрешил автоматическое копирование.'});}
  }

  const ownedCharacters=characters.filter(c=>c.owner_id===me.id);
  // GET returns only accessible folders. Pending applicants do not yet have is_member.
  const visibleCampaigns=campaigns;
  const incoming=detail?.transfer_to===me.id&&!detail.is_gm;
  const pending=detail?.roster.filter(r=>r.status==='pending')||[],active=detail?.roster.filter(r=>r.status==='active')||[],reserve=detail?.roster.filter(r=>r.status==='reserve')||[];
  const ownAccepted=detail?.roster.filter(row=>row.owner_id===me.id&&(row.status==='active'||row.status==='reserve'))||[];
  const canPlay=!!detail?.is_gm||ownAccepted.length>0;
  useEffect(()=>{if(!detail)return;if((section==='terminal'&&!canPlay)||((section==='notes'||section==='settings')&&!detail.is_gm))setSection('overview');},[detail?.id,detail?.is_gm,canPlay,section]);
  const candidates=detail?.members?.filter(member=>member.id!==me.id)||[];
  const successorName=detail?.members?.find(member=>member.id===detail.transfer_to)?.username||'выбранному участнику';
  useEffect(()=>{onContextChange?.(detail&&detail.id===selected?{campaignId:detail.id,campaignName:detail.name,isGM:detail.is_gm,pending:!detail.is_member&&!detail.is_gm,canPlay}:null);},[selected,detail?.id,detail?.name,detail?.is_gm,detail?.is_member,canPlay,onContextChange]);
  const sections:[typeof section,string,LucideIcon][]=[['overview','Сводка',Folder],['terminal',onOpenBattle?'Связь и записи':'Стол',BookOpen],['roster','Партия',Users],...(detail?.is_gm?([['notes','Записи',FileText],['settings','Настройки',KeyRound]] as [typeof section,string,LucideIcon][]):[])];
  useEffect(()=>{
    const returnToScene=(event:Event)=>{const context=(event as CustomEvent<SceneSheetContext>).detail;if(context&&Number(detailRef.current?.id)===context.campaignId)setSection('terminal');};
    window.addEventListener('nightcity-return-to-scene',returnToScene);return()=>window.removeEventListener('nightcity-return-to-scene',returnToScene);
  },[me.id]);
  function showRoster(filter:typeof rosterFilter='all'){if(operationBusyRef.current)return;setRosterFilter(filter);setSection('roster');}
  function play(next:'messages'|'scene'){if(operationBusyRef.current)return;setTerminalRequest(previous=>({section:next,revision:previous.revision+1}));setSection('terminal');}
  useEffect(()=>{
    const navigate=(event:Event)=>{
      const command=(event as CustomEvent<{destination:string;accepted?:boolean}>).detail;if(!command)return;
      const dest=command.destination;
      if(operationBusyRef.current){command.accepted=false;return;}
      if(dest==='campaigns'){if(selectedRef.current!==null){if(dirtyRef.current){command.accepted=false;return;}back();}return;}
      if(dest==='campaign-join'||dest==='campaign-create'){
        if(dirtyRef.current){command.accepted=false;setNotice({message:'Сначала заверши или сохрани текущую работу. Обучение не закрывает черновики.'});return;}
        detailRequest.current++;setSelected(null);selectedRef.current=null;setDetail(null);detailRef.current=null;setForm(dest==='campaign-join'?'join':'create');return;
      }
      const target:typeof section=dest==='campaign-notes'?'notes':dest==='campaign-settings'?'settings':dest==='campaign-party'?'roster':['campaign-messages','campaign-scene','campaign-play'].includes(dest)?'terminal':'overview';
      const needsGM=target==='settings'||target==='notes';
      const current=detailRef.current;
      if(!current||(needsGM&&!current.is_gm)){
        if(dirtyRef.current){command.accepted=false;return;}
        const available=campaigns.find(c=>!needsGM||c.is_gm);
        if(!available){setNotice({message:needsGM?'Сначала создай свою кампанию кнопкой «Создать кампанию».':'Сначала отправь заявку по коду ведущего или создай кампанию.'});return;}
        choose(available.id,target);
      }else{const playable=current.is_gm||current.roster.some(row=>row.owner_id===me.id&&(row.status==='active'||row.status==='reserve'));setSection(target==='terminal'&&!playable?'overview':target);}
      if(target==='terminal')setTerminalRequest(previous=>({section:dest==='campaign-messages'||(sharedBattleAvailable&&dest==='campaign-play')?'messages':'scene',revision:previous.revision+1}));
    };
    const created=(event:Event)=>{setJoinCharacter(String((event as CustomEvent).detail.id));setForm('join');};
    window.addEventListener('nightcity-hub-navigate',navigate);window.addEventListener('nightcity-character-created',created);
    return()=>{window.removeEventListener('nightcity-hub-navigate',navigate);window.removeEventListener('nightcity-character-created',created);};
  },[campaigns,sharedBattleAvailable]);

  function rosterGroup(rows:Roster[],title:string){
    if(!rows.length)return null;
    return <section className="campaign-roster-group"><h3>{title}<span>{rows.length}</span></h3><div className="campaign-roster-list">{rows.map(row=><article className="campaign-roster-row" key={row.character_id}>
      <div className="campaign-roster-person">{row.exterior?<CharacterPortrait name={row.name} appearance={row.exterior.appearance}/>:<UserRound aria-hidden="true"/>}<div><strong>{row.name}</strong><span>{row.role} · {row.owner}{row.owner_id===me.id?' · твой персонаж':''}</span></div></div>
      <span className={`campaign-status status-${row.status}`}>{statusName[row.status]}</span>
      <div className="campaign-roster-actions">
        {row.exterior&&<button disabled={busy} onClick={()=>setExteriorId(row.character_id)}><UserRound/>Внешность</button>}
        {row.can_open&&<button disabled={busy||openingSheet} onClick={()=>void openSheet(row)}><FileText/>Лист</button>}
        {detail?.is_gm&&<>
          {row.status==='pending'&&<button className="primary" disabled={busy} onClick={()=>void mutate('roster',{version:detail.version,character_id:row.character_id,status:'active'},'Персонаж принят в партию.',true)}><Check/>Принять</button>}
          {row.status==='reserve'&&<button disabled={busy} onClick={()=>void mutate('roster',{version:detail.version,character_id:row.character_id,status:'active'},'Персонаж вернулся в партию.',true)}>В партию</button>}
          {row.status==='active'&&<button disabled={busy} onClick={()=>void mutate('roster',{version:detail.version,character_id:row.character_id,status:'reserve'},'Персонаж переведён в резерв.',true)}>В резерв</button>}
          <button className="campaign-remove" disabled={busy} onClick={()=>setConfirmation({title:row.status==='pending'?'Отклонить заявку?':'Убрать из кампании?',message:`«${row.name}» останется у владельца. Участие в этой кампании закончится; доступ ведущего через неё будет закрыт.`,action:row.status==='pending'?'Отклонить':'Убрать из кампании',danger:true,run:()=>void mutate('roster',{version:detail.version,character_id:row.character_id,status:'remove'},'Персонаж убран из кампании.',true)})}>{row.status==='pending'?'Отклонить':'Убрать'}</button>
        </>}
        {row.owner_id===me.id&&!detail?.is_gm&&<button className="campaign-remove" disabled={busy} onClick={()=>setConfirmation({title:row.status==='pending'?'Отозвать заявку?':'Вывести персонажа из кампании?',message:`«${row.name}» сохранится в твоей коллекции. Ведущий этой кампании потеряет доступ к листу через неё. Твоё членство в группе останется.`,action:row.status==='pending'?'Отозвать заявку':'Вывести персонажа',run:()=>void withdraw(row)})}>{row.status==='pending'?'Отозвать':'Вывести'}</button>}
      </div>
    </article>)}</div></section>;
  }

  return <MotionSurface theme={section==='terminal'?'tactical':section==='notes'?'signal':section==='transfer'?'network':'bio'} navigationKey={`${selected??'list'}:${section}:${form??'index'}`} startAfter=".campaign-sections" enabled={!confirmation&&!openingSheet}><section className="campaign-hub" aria-label="Кампании"><section className="nc-terminal-record nc-campaign-record" data-campaign-view={selected===null?'index':section}>
    <header className="nc-terminal-top"><span className="nc-terminal-brand">NC<span>2020</span></span><span className="nc-terminal-caption">АРХИВ КАМПАНИЙ<small>{selected===null?'CAMPAIGN FILES / PERSONAL INDEX':`CAMPAIGN FILE / ${String(selected).padStart(3,'0')}`}</small></span></header>
    <div className="nc-record-body nc-campaign-body"><div className="nc-record-index"><span>{selected===null?'INDEX / 01':`FILE / ${String(selected).padStart(3,'0')}`}</span><span>{me.username}</span></div>
    <div className="campaign-heading"><div><span className="eyebrow">{selected===null?'ЛИЧНЫЙ РЕЕСТР':'ПАПКА КАМПАНИИ'}</span><h1><SignalType>{selected!==null?(detail?.name||'Открываем папку…'):'Кампании'}</SignalType></h1><p>{selected!==null?`Ведущий: ${detail?.gm||'…'}`:'Все твои кампании. Роль и доступ указаны у каждой папки.'}</p>{detail&&selected===detail.id&&<div className="campaign-file-meta"><span>ПАПКА {String(detail.id).padStart(3,'0')}</span><span>v{detail.version}</span></div>}</div><button className="quiet campaign-refresh" disabled={busy||loading||detailLoading} onClick={refresh} aria-label="Обновить кампании"><RefreshCw/>Обновить</button></div>
    {notice&&<div className={`campaign-notice ${notice.bad?'bad':''}`} role={notice.bad?'alert':'status'}><span>{notice.message}</span><button className="icon-button" onClick={()=>setNotice(null)} aria-label="Закрыть сообщение"><X/></button></div>}
    {selected===null?<>
      <CampaignGuide/><button className="quiet campaign-demo-launch" onClick={()=>askToLeave(()=>window.dispatchEvent(new Event('nightcity-open-demo')))}><BookOpen/>Попробовать ГМа и игрока без группы</button>
      <div className="campaign-index-toolbar" data-tour="campaign-list">
        <span>Мои кампании <b>{visibleCampaigns.length}</b></span>
        <div>{<button data-tour="campaign-create" className={form==='create'?'primary':''} disabled={operationBusy} onClick={()=>askToLeave(()=>setForm(form==='create'?null:'create'))} aria-expanded={form==='create'}><FolderPlus/>Создать кампанию</button>}<button data-tour="campaign-join" className={form==='join'?'primary':''} disabled={operationBusy} onClick={()=>askToLeave(()=>setForm(form==='join'?null:'join'))} aria-expanded={form==='join'}><KeyRound/>Ввести код</button><button className={form==='transfer'?'primary':''} disabled={operationBusy} onClick={()=>askToLeave(()=>setForm(form==='transfer'?null:'transfer'))} aria-expanded={form==='transfer'}><Download/>Импорт кампании из файла</button></div>
      </div>
      {form==='create'&&<form className="campaign-form campaign-entry-form" onSubmit={create}>
        <h2><FolderPlus/>Новая папка кампании</h2>
        <PlayerField label="Название" topic="campaign-description"><input value={newName} onChange={e=>setNewName(e.target.value)} disabled={busy} maxLength={100} required placeholder="Например: Тени Найт-Сити"/></PlayerField>
        <PlayerField label="Описание для игроков" topic="campaign-description"><textarea value={newDescription} onChange={e=>setNewDescription(e.target.value)} disabled={busy} maxLength={3000} rows={4} placeholder="О чём эта история и кого ждёшь за столом"/></PlayerField>
        <p className="campaign-safety"><ShieldCheck/>Ты станешь ведущим этой кампании. Код приглашения появится после создания.</p>
        <button type="submit" className="primary" disabled={busy||!newName.trim()}>{busy?<LoaderCircle/>:<FolderPlus/>}Создать кампанию</button>
      </form>}
      {form==='join'&&<form className="campaign-form campaign-entry-form" onSubmit={join}>
        <h2><KeyRound/>Заявка по коду</h2>
        <PlayerField label="Пригласительный код" topic="campaign-invite"><input value={joinCode} onChange={e=>setJoinCode(e.target.value)} disabled={busy} maxLength={80} required autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="Код от ведущего"/></PlayerField>
        <PlayerField label="Твой персонаж" topic="campaign-join"><select value={joinCharacter} onChange={e=>setJoinCharacter(e.target.value)} disabled={busy||!ownedCharacters.length} required><option value="">Выбери лист для заявки</option>{ownedCharacters.map(character=><option key={character.id} value={character.id}>{character.data.name} · {character.data.role}</option>)}</select></PlayerField>
        {!ownedCharacters.length&&<div className="campaign-safety"><p>Для заявки нужен свой персонаж. Создай его здесь — введённый код останется на месте.</p><button type="button" disabled={busy} onClick={createCharacter}><UserRound/>Создать персонажа</button></div>}
        <p className="campaign-safety"><LockKeyhole/>Отправляя заявку, ты открываешь ведущему выбранный лист. Другие личные персонажи останутся закрытыми.</p>
        <button type="submit" className="primary" disabled={busy||!joinCode.trim()||!joinCharacter}>{busy?<LoaderCircle/>:<Send/>}Отправить заявку</button>
      </form>}
      {loading?<div className="campaign-empty" role="status"><LoaderCircle/><p>Загружаем кампании…</p></div>:visibleCampaigns.length?<div className="campaign-folder-list">{visibleCampaigns.map(campaign=><button className="campaign-folder" key={campaign.id} onClick={()=>choose(campaign.id)} disabled={busy}>
        <span className="nc-campaign-folder-index" aria-hidden="true">FILE<strong>{String(campaign.id).padStart(3,'0')}</strong></span><span className="nc-campaign-folder-copy"><span className="nc-campaign-folder-topline"><b className={`campaign-role-pill ${campaign.is_gm?'gm':'player'}`}>{campaign.is_gm?'ГМ':campaign.is_member?'ИГРОК':'ЗАЯВКА'}</b><span>v{campaign.version}</span></span><strong>{campaign.name}</strong><small>{campaign.is_gm?'Ты ведущий':!campaign.is_member?'Заявка ожидает принятия':`Ты игрок · ГМ: ${campaign.gm}`}{campaign.transfer_to===me.id?' · предлагают вести':''}</small>{campaign.description&&<p>{campaign.description}</p>}</span><ChevronRight className="nc-campaign-folder-arrow" aria-hidden="true"/>
      </button>)}</div>:<div className="campaign-empty"><Folder/><h2>Твоих кампаний пока нет</h2><p>Играешь? Введи код ведущего. Ведёшь? Создай кампанию и пригласи игроков.</p></div>}
    </>:<>
      <button className="back-button campaign-back" onClick={back} disabled={busy}><ArrowLeft/>Все кампании</button>
      {detailLoading&&!detail?<div className="campaign-empty" role="status"><LoaderCircle/><p>Загружаем папку кампании…</p></div>:!detail?<div className="campaign-empty"><Folder/><p>Папку не удалось открыть. Проверь сообщение выше и попробуй обновить.</p><button onClick={refresh} disabled={busy}>Попробовать ещё раз</button></div>:<>
        <section className={`campaign-role-banner ${detail.is_gm?'gm':'player'}`} data-tour="campaign-access" data-campaign-role={detail.is_gm?'gm':canPlay?'player':detail.is_member?'member':'pending'} aria-label="Твоя роль в кампании"><div><span className="campaign-role-code" aria-hidden="true">{detail.is_gm?'GM':canPlay?'PC':detail.is_member?'MEM':'REQ'}</span>{detail.is_gm?<ShieldCheck/>:<UserRound/>}<strong>{detail.is_gm?'Ты — ГМ':canPlay?'Ты — игрок':detail.is_member?'Участник без героя':'Заявка на рассмотрении'}</strong></div><dl className="nc-campaign-party-stats"><div><dt>В партии</dt><dd>{active.length}</dd></div><div><dt>Резерв</dt><dd>{reserve.length}</dd></div>{detail.is_gm&&<div><dt>Заявки</dt><dd>{pending.length}</dd></div>}</dl></section>
        {section==='overview'&&detail.description&&<p className="campaign-description">{detail.description}</p>}
        {incoming&&<div className="campaign-transfer-banner"><ShieldCheck/><div><h2>Тебе предлагают вести эту кампанию</h2><p>После принятия тебе перейдут состав партии, код приглашения и закрытые заметки ведущего. Прежний ведущий перестанет иметь права ГМ в этой папке.</p><button className="primary" disabled={busy} onClick={()=>setConfirmation({title:'Стать ведущим кампании?',message:'Тебе перейдёт управление этой папкой и доступ к закрытым заметкам. Прежний ведущий потеряет права ГМ после принятия.',action:'Принять роль ГМ',run:()=>void mutate('transfer/accept',{version:detail.version},'Теперь ты ведущий этой кампании.',true)})}>Принять роль ГМ</button></div></div>}
        {onOpenAtlas&&canPlay&&<div className="campaign-control-secondary"><button disabled={operationBusy} onClick={()=>onOpenAtlas({campaignId:detail.id,campaignName:detail.name,isGM:detail.is_gm})}><Map aria-hidden="true"/>Карта Найт-Сити</button></div>}
        <div className="campaign-sections" data-count={sections.length} aria-label="Разделы кампании">{sections.map(([value,title,Icon],index)=><button data-tour={value==='roster'?'campaign-party':value==='settings'?'campaign-settings':value==='notes'?'campaign-notes':value==='terminal'?'campaign-play':undefined} key={value} data-record-index={String(index+1).padStart(2,'0')} aria-pressed={section===value} onClick={()=>value==='roster'?showRoster():value==='terminal'&&onOpenBattle?play('messages'):setSection(value)} disabled={operationBusy||(value==='terminal'&&!canPlay)}><Icon/>{title}{value==='roster'&&pending.length>0&&detail.is_gm&&<b>{pending.length}</b>}</button>)}</div>
        {onOpenBattle&&canPlay&&<div className="campaign-shared-battle-entry"><button className="primary" data-campaign-shortcut="shared-battle" disabled={operationBusy||openingSheet} onClick={()=>onOpenBattle({campaignId:detail.id,campaignName:detail.name})}><Crosshair/>Бой</button><p className="hint">Общее поле, заявки на выстрел и подтверждение ГМа. Открытые черновики кампании останутся на месте.</p></div>}
        {section==='overview'&&<section className="campaign-overview campaign-control-home"><div className="section-heading"><h2>{detail.is_gm?'За столом ведущего':'Твоя игра'}</h2><button className="text-button" onClick={()=>window.dispatchEvent(new CustomEvent('nightcity-start-tutorial',{detail:{id:detail.is_gm?'gm':'join'}}))}><BookOpen/>Показать по шагам</button></div>{detail.is_gm?<><div className="campaign-control-shortcuts">{!onOpenBattle&&<button className="campaign-control-primary" data-campaign-shortcut="scene" disabled={operationBusy} onClick={()=>play('scene')}><Crosshair/><span><strong>Сцена и действия</strong><small>Поле, очередь заявок и подтверждение результатов.</small></span><ChevronRight/></button>}<button disabled={operationBusy} onClick={()=>showRoster('accepted')}><FileText/><span><strong>Листы партии</strong><small>{active.length} в партии · {reserve.length} в резерве</small></span><ChevronRight/></button><button disabled={operationBusy} onClick={()=>showRoster('pending')}><Users/><span><strong>Заявки игроков</strong><small>{pending.length?`${pending.length} ожидают принятия`:'Новых заявок нет'}</small></span>{pending.length>0?<b className="campaign-control-count">{pending.length}</b>:<ChevronRight/>}</button><button data-campaign-shortcut="messages" disabled={operationBusy} onClick={()=>play('messages')}><Send/><span><strong>Связь и НПС</strong><small>Контакты, личные сообщения и ответы героев.</small></span><ChevronRight/></button></div><div className="campaign-control-secondary"><button disabled={operationBusy||!detail.invite_code} onClick={()=>void copyInvite()}><Copy/>Скопировать код приглашения</button><button disabled={operationBusy} onClick={()=>setSection('notes')}><FileText/>Записи ведущего</button></div></>:<><p>{!canPlay?(detail.is_member?'У тебя нет принятого героя в этой кампании. Отправь заявку с новым листом по коду ведущего, чтобы пользоваться игровыми действиями.':'Заявка отправлена. Ведущий проверит лист и примет героя в партию. Статус обновляется автоматически.'):onOpenBattle?'Открой лист своего героя или бой кампании. Сообщения относятся к выбранному персонажу.':'Открой лист своего героя или общую сцену. Твои сообщения и действия относятся к выбранному персонажу.'}</p><div className="campaign-control-shortcuts">{detail.roster.filter(row=>row.owner_id===me.id&&row.can_open).map(row=><button className="campaign-control-character" data-campaign-character={row.character_id} key={row.character_id} disabled={operationBusy||openingSheet} onClick={()=>void openSheet(row)}>{row.exterior?<CharacterPortrait name={row.name} appearance={row.exterior.appearance}/>:<UserRound/>}<span><strong>{row.name}</strong><small>{statusName[row.status]} · открыть свой лист</small></span><ChevronRight/></button>)}{!onOpenBattle&&<button className="campaign-control-primary" data-campaign-shortcut="scene" disabled={!canPlay||operationBusy} onClick={()=>play('scene')}><Crosshair/><span><strong>Открыть сцену</strong><small>{canPlay?'Поле, твоё действие и ответ ведущего.':'Нужен свой герой в партии или резерве.'}</small></span><ChevronRight/></button>}<button data-campaign-shortcut="messages" disabled={!canPlay||operationBusy} onClick={()=>play('messages')}><Send/><span><strong>Мои сообщения</strong><small>Контакты и переписки твоего героя.</small></span><ChevronRight/></button></div></>}{onOpenBattle&&canPlay&&<div className="campaign-control-secondary"><button data-campaign-shortcut="legacy-scene" disabled={operationBusy} onClick={()=>play('scene')}><BookOpen/>Прежние сцены / ручные действия</button></div>}<p className="campaign-context-note"><ShieldCheck/>Роль и доступ относятся к этой кампании.</p></section>}
        {(section==='roster'||(!detail.is_gm&&(section==='notes'||section==='settings')))&&<div className="campaign-roster">{detail.is_gm&&<nav className="campaign-roster-filters" aria-label="Показать участников"><button aria-pressed={rosterFilter==='all'} onClick={()=>setRosterFilter('all')} disabled={operationBusy}>Все <b>{detail.roster.length}</b></button><button aria-pressed={rosterFilter==='accepted'} onClick={()=>setRosterFilter('accepted')} disabled={operationBusy}>Принятые <b>{active.length+reserve.length}</b></button><button aria-pressed={rosterFilter==='pending'} onClick={()=>setRosterFilter('pending')} disabled={operationBusy}>Заявки <b>{pending.length}</b></button></nav>}<CampaignGuide detail/>{(!detail.is_gm||rosterFilter!=='pending')&&rosterGroup(active,'В партии')}{(!detail.is_gm||rosterFilter!=='pending')&&rosterGroup(reserve,'Резерв')}{(!detail.is_gm||rosterFilter!=='accepted')&&rosterGroup(pending,'Заявки')}{detail.is_gm&&rosterFilter==='pending'&&!pending.length&&<p className="campaign-empty-copy">Все заявки рассмотрены.</p>}{detail.is_gm&&rosterFilter==='accepted'&&!active.length&&!reserve.length&&!!detail.roster.length&&<p className="campaign-empty-copy">Пока нет принятых героев. Открой заявки, чтобы проверить их листы.</p>}{!detail.roster.length&&<div className="campaign-empty"><Users/><h2>Партия пока пуста</h2><p>{detail.is_gm?'Передай игрокам пригласительный код из раздела «Настройки». Они выберут свои листы и отправят заявки.':'Отправленные персонажи появятся здесь.'}</p>{detail.is_gm&&<button onClick={()=>setSection('settings')}><KeyRound/>Показать код</button>}</div>}</div>}
        {canPlay&&<div hidden={section!=='terminal'}><CampaignTerminal embedded legacyMode={!!onOpenBattle} requestedSection={terminalRequest} key={me.id+':'+detail.id} campaignId={detail.id} me={me} api={api} onDirtyChange={setTerminalDirty} onBusyChange={setTerminalBusy} onOpenSheet={openSceneSheet} sheetOpening={openingSheet}/></div>}
        {detail.is_gm&&(section==='notes'||section==='settings')&&<form className="campaign-form campaign-workspace" onSubmit={save}>
          {section==='notes'?<>
            <div className="campaign-private"><LockKeyhole/><div><strong>Видно только ведущему этой кампании</strong><span>Если передашь кампанию другому ГМ, эти записи перейдут ему вместе с папкой.</span></div></div>
            <section className="nc-campaign-log-section"><header><span aria-hidden="true">01</span><h2>Закрытый журнал</h2><small>GM RECORD / NOTES</small></header><PlayerField label="Заметки ведущего" topic="campaign-notes"><textarea value={draft.gm_notes} onChange={e=>setDraft({...draft,gm_notes:e.target.value})} disabled={busy} maxLength={24000} rows={12} placeholder="Сцены, тайны, NPC, зацепки и планы следующей сессии…"/></PlayerField></section>
            <section className="nc-campaign-log-section"><header><span aria-hidden="true">02</span><h2>Учёт и последствия</h2><small>GM RECORD / LEDGER</small></header><PlayerField label="Учёт кампании" topic="campaign-notes"><textarea value={draft.ledger} onChange={e=>setDraft({...draft,ledger:e.target.value})} disabled={busy} maxLength={16000} rows={8} placeholder="Долги, договорённости, общий бюджет, добыча и последствия решений…"/></PlayerField></section>
          </>:<>
            <PlayerField label="Название кампании" topic="campaign-description"><input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} disabled={busy} required maxLength={100}/></PlayerField>
            <PlayerField label="Описание для игроков" topic="campaign-description"><textarea value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})} disabled={busy} maxLength={3000} rows={5}/></PlayerField>
          </>}
          <div className="campaign-save-row"><span role="status">{busy?'Сохраняем…':notesDirty?'Есть несохранённый черновик':'Изменения сохранены'}<small>Заметки и описание сохраняются одной версией.</small></span><button type="button" onClick={downloadDraft} disabled={busy}><Download/>Копия записей</button><button className="primary" type="submit" disabled={busy||!notesDirty||!draft.name.trim()}><Save/>Сохранить</button></div>
          {notesDirty&&<button className="quiet campaign-discard" type="button" disabled={busy} onClick={()=>setConfirmation({title:'Вернуть сохранённые записи?',message:'Черновик будет заменён последней загруженной версией кампании. Если нужно, сначала скачай копию записей.',action:'Вернуть сохранённое',danger:true,run:()=>{const target=detailRef.current;if(target){const saved=draftOf(target);setDraft(saved);draftRef.current=saved;setBaseline(JSON.stringify(saved));baselineRef.current=JSON.stringify(saved);notesDirtyRef.current=false;}}})}>Вернуть сохранённое</button>}
        </form>}
        {detail.is_gm&&section==='settings'&&<div className="campaign-admin-sections">
          <section className="campaign-invite" data-tour="campaign-invite"><h2><KeyRound/>Пригласительный код</h2><p>Игрок вводит код и выбирает своего персонажа. Ты проверяешь заявку, затем принимаешь его в партию.</p><div className="campaign-code-row"><label className="sr-only" htmlFor={`campaign-invite-${detail.id}`}>Код приглашения</label><input id={`campaign-invite-${detail.id}`} value={detail.invite_code||''} readOnly onFocus={event=>event.currentTarget.select()} spellCheck={false}/><button disabled={busy||!detail.invite_code} onClick={()=>void copyInvite()}><Copy/>Копировать</button></div><button className="quiet" disabled={busy} onClick={()=>setConfirmation({title:'Сменить код приглашения?',message:'Старый код перестанет принимать новые заявки. Участники и уже поданные заявки останутся в кампании.',action:'Сгенерировать новый',run:()=>void mutate('invite',{version:detail.version},'Код обновлён. Передай игрокам новый код.')})}><RefreshCw/>Новый код</button></section>
          <section className="campaign-transfer"><h2><ShieldCheck/>Передать роль ведущего</h2><p>Выбери одного из принятых участников. Он получит предложение и сам подтвердит смену. После принятия ему перейдут закрытые заметки и учёты; ты перестанешь быть ГМ этой кампании.</p>
            {detail.transfer_to!==null?<div className="campaign-transfer-pending"><p>Предложение отправлено: <strong>{successorName}</strong>. Пока оно не принято, ты остаёшься ведущим.</p><button disabled={busy} onClick={()=>void mutate('transfer',{version:detail.version,user_id:null},'Предложение передачи отменено.')}><X/>Отменить предложение</button></div>:<>
              <PlayerField label="Новый ведущий" topic="campaign-transfer"><select value={successor} onChange={e=>setSuccessor(e.target.value)} disabled={busy||!candidates.length}><option value="">Выбери участника</option>{candidates.map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.username}</option>)}</select></PlayerField>
              {!candidates.length&&<p className="campaign-safety">Сначала прими в кампанию хотя бы одного другого участника.</p>}
              <button disabled={busy||!successor} onClick={()=>setConfirmation({title:'Предложить смену ведущего?',message:`${candidates.find(c=>c.id===Number(successor))?.username||'Участник'} сможет принять роль ГМ. После принятия ему откроются твои закрытые записи, а ты потеряешь права ведущего в этой кампании.`,action:'Отправить предложение',run:()=>void mutate('transfer',{version:detail.version,user_id:Number(successor)},'Предложение смены ведущего отправлено.')})}><Send/>Предложить стать ГМ</button>
            </>}
          </section>
          <button className="quiet" disabled={busy} onClick={()=>setSection('transfer')}><Download/>Файлы кампании: импорт, экспорт и доступ</button>
        </div>}
      </>}
    </>}
    <div hidden={selected===null?form!=='transfer':section!=='transfer'}><TransferPanel campaignId={selected} isGM={!!detail?.is_gm} me={me} api={api} onDirtyChange={setTransferDirty} onBusyChange={setTransferBusy} onOpenCampaign={()=>setSection('overview')} onImportScene={detail?.is_gm&&onOpenBattle?()=>onOpenBattle({campaignId:detail.id,campaignName:detail.name,initialTool:'import'}):undefined} onImported={async id=>{const account=currentRef.current.me.id,revision=currentRef.current.navigationRevision();const live=()=>currentRef.current.me.id===account&&currentRef.current.navigationRevision()===revision;await readList();if(!live())return;await currentRef.current.refreshCharacters();if(!live())return;if(selectedRef.current!==id){setDetail(null);detailRef.current=null;setDraft({name:'',description:'',gm_notes:'',ledger:''});setBaseline('');baselineRef.current='';notesDirtyRef.current=false;}setSelected(id);selectedRef.current=id;setSection('transfer');await readDetail(id);}}/></div>
    </div><RecordFooter label={detail?`ПАПКА ${String(detail.id).padStart(3,'0')} / v${detail.version} / ${notesDirty?'ЧЕРНОВИК':'АРХИВ КАМПАНИЙ'}`:'CAMPAIGN FILES / NIGHT CITY / 2020'}/></section>
    <Dialog open={!!exterior} onOpenChange={open=>{if(!open)setExteriorId(null);}}><DialogContent className="tracker-dialog exterior-dialog"><DialogHeader><DialogTitle>Карточка персонажа</DialogTitle><DialogDescription>Имя, портрет и видимая экипировка</DialogDescription></DialogHeader>{exterior&&<CharacterExterior card={exterior}/>}</DialogContent></Dialog>
    <AlertDialog open={!!confirmation} onOpenChange={value=>{if(!value)setConfirmation(null);}}><AlertDialogContent className="tracker-dialog campaign-confirm"><AlertDialogHeader><AlertDialogTitle>{confirmation?.title}</AlertDialogTitle><AlertDialogDescription>{confirmation?.message}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="plain-button">Отмена</AlertDialogCancel><AlertDialogAction className={confirmation?.danger?'danger-button':'primary'} onClick={()=>{const task=confirmation;setConfirmation(null);task?.run();}}>{confirmation?.action||'Продолжить'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section></MotionSurface>;
}
