'use client';
import React,{useEffect,useRef,useState} from 'react';
type Invitation={campaignId:number;campaignName:string;battleId:string;battleName:string;phase:string;actorIds:string[]};
type Props={accountId:number;api:(path:string,method?:string,data?:unknown)=>Promise<any>;onJoin:(context:{campaignId:number;campaignName:string})=>void};
export default function BattleInvitations({accountId,api,onJoin}:Props){
 const [invitations,setInvitations]=useState<Invitation[]>([]),dismissed=useRef(new Set<string>()),apiRef=useRef(api);apiRef.current=api;
 const key=`nc-battle-invitations:${accountId}`;
 useEffect(()=>{
  let alive=true,inFlight=false;
  try{const ids=JSON.parse(localStorage.getItem(key)||'[]');dismissed.current=new Set(Array.isArray(ids)?ids.filter(id=>typeof id==='string').slice(-100):[]);}catch{dismissed.current=new Set();}
  const read=async()=>{if(inFlight||document.visibilityState!=='visible')return;inFlight=true;try{
   const result=await apiRef.current('/api/battles/active');if(!alive)return;
   const rows=Array.isArray(result?.battles)?result.battles:[];
   setInvitations(rows.filter((row:any)=>Number.isInteger(row.campaignId)&&typeof row.campaignName==='string'&&typeof row.battleId==='string'&&typeof row.battleName==='string'&&['combat','paused'].includes(row.phase)&&Array.isArray(row.actorIds)&&row.actorIds.length&&!dismissed.current.has(row.battleId)));
  }catch{if(alive)setInvitations([]);}finally{inFlight=false;}};
  void read();const timer=setInterval(()=>void read(),3000);const wake=()=>void read();document.addEventListener('visibilitychange',wake);window.addEventListener('nightcity-sync',wake);
  return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',wake);window.removeEventListener('nightcity-sync',wake);};
 },[accountId,key]);
 function dismiss(id:string){dismissed.current.add(id);try{localStorage.setItem(key,JSON.stringify([...dismissed.current].slice(-100)));}catch{}setInvitations(rows=>rows.filter(row=>row.battleId!==id));}
 const invitation=invitations[0];if(!invitation)return null;
 return <aside className="nc-battle-invitation" aria-label="Приглашение в бой" role="status"><div><strong>ГМ объявил бой</strong><p>{invitation.campaignName} · {invitation.battleName}</p><small>Вход за своего персонажа. Открытый лист останется на месте.</small></div><div><button className="primary" onClick={()=>{dismiss(invitation.battleId);onJoin({campaignId:invitation.campaignId,campaignName:invitation.campaignName});}}>Войти в бой</button><button className="quiet" onClick={()=>dismiss(invitation.battleId)}>Позже</button></div></aside>;
}
