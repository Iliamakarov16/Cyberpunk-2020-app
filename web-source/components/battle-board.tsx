'use client';

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ArrowRight, Box, CarFront, CircuitBoard, Crosshair, DoorClosed, Eye, EyeOff, Flag, Move, UserRound, X, Zap} from 'lucide-react';
import {battleCellIndex, isBlockingBattleTile, visibleBattleCells, type BattleBoard as BoardModel, type BattleBoardView as ProjectedBoard, type BattlePiece} from '@/lib/battle';

export type BattleTarget = {id:string;name:string;kind:'person'|'device'|'program';description:string;visible:boolean};
export type BattleCharacter = {id:number;name:string};
export type BattleBoardProps = {
  board:BoardModel|ProjectedBoard;gm:boolean;characterId:number|null;
  characters:BattleCharacter[];targets:BattleTarget[];busy?:boolean;readOnly?:boolean;
  onTarget:(targetId:string,kind:'attack'|'program'|'other')=>void;
  onMove?:(pieceId:string,x:number,y:number)=>void;
  onRequestMove?:(x:number,y:number)=>void;
  onNextTurn?:()=>void;
};
const PIECE_KIND = {character:'Персонаж',target:'Цель',loot:'Лут',vehicle:'Транспорт'};
const TILE_KIND = {floor:'Пол',wall:'Стена',door:'Закрытая дверь',cover:'Укрытие',unknown:'Неизвестная область'};
export function BattlePieceIcon({piece,target}:{piece:BattlePiece;target?:BattleTarget}) {
  const Icon=piece.kind==='character'?UserRound:piece.kind==='loot'?Box:piece.kind==='vehicle'?CarFront:target?.kind==='program'?Zap:target?.kind==='device'?CircuitBoard:Crosshair;
  return <Icon aria-hidden="true"/>;
}

/** Renders only the selected character's view, even when the server projects several owned characters. */
export default function BattleBoard({board,gm,characterId,characters,targets,busy=false,readOnly=false,onTarget,onMove,onRequestMove,onNextTurn}:BattleBoardProps) {
  const [selectedId,setSelectedId]=useState(''),[destination,setDestination]=useState<{x:number;y:number;pieceId?:string}|null>(null),[lastMovableId,setLastMovableId]=useState('');
  const [zoom,setZoom]=useState<'normal'|'large'>('normal'),[notice,setNotice]=useState('');
  const viewport=useRef<HTMLDivElement>(null);
  const ownPiece=board.pieces.find(p=>p.kind==='character'&&p.characterId===characterId);
  const visible=useMemo(()=>{
    if(gm)return new Set(board.tiles.map((_,i)=>i));
    const view='views' in board?board.views.find(v=>v.characterId===characterId):undefined;
    if(view)return new Set(view.visible);
    // A complete board is permitted for the tutorial, never infer visibility from a projected union.
    if(!('views' in board)&&ownPiece)return new Set(visibleBattleCells(board as BoardModel,ownPiece));
    return new Set<number>();
  },[board,gm,characterId,ownPiece]);
  const shownPieces=board.pieces.filter(p=>gm||visible.has(battleCellIndex(board,p.x,p.y))&&(!p.hidden||p.id===ownPiece?.id)&&(p.kind!=='target'||targets.some(t=>t.id===p.targetId&&t.visible)));
  const selected=shownPieces.find(p=>p.id===selectedId);
  const target=selected?.targetId?targets.find(t=>t.id===selected.targetId):undefined;
  const turn=shownPieces.find(p=>p.id===board.turnPieceId);
  const actorName=characters.find(c=>c.id===characterId)?.name||ownPiece?.name||'твоего персонажа';
  const movable=gm?(destination?.pieceId?shownPieces.find(p=>p.id===destination.pieceId):selected):ownPiece;
  const lootMovePiece=gm?shownPieces.find(p=>p.id===lastMovableId):ownPiece;
  const canMoveToLoot=!!selected&&selected.kind==='loot'&&!!lootMovePiece&&(lootMovePiece.x!==selected.x||lootMovePiece.y!==selected.y)&&!isBlockingBattleTile(board.tiles[battleCellIndex(board,selected.x,selected.y)])&&!shownPieces.some(p=>p.x===selected.x&&p.y===selected.y&&p.kind!=='loot'&&p.id!==lootMovePiece.id);
  const mayRequest=!readOnly&&!!onRequestMove&&!!ownPiece;
  const pendingPiece=destination&&movable;
  const pieceLabel=(piece:BattlePiece)=>piece.characterId!==null?characters.find(c=>c.id===piece.characterId)?.name||piece.name:piece.targetId!==null?targets.find(t=>t.id===piece.targetId)?.name||piece.name:piece.name;

  useEffect(()=>{setSelectedId('');setDestination(null);setLastMovableId('');setNotice('');},[characterId,gm]);
  useEffect(()=>{
    if(selectedId&&!shownPieces.some(p=>p.id===selectedId))setSelectedId('');
    if(destination&&(!visible.has(battleCellIndex(board,destination.x,destination.y))||isBlockingBattleTile(board.tiles[battleCellIndex(board,destination.x,destination.y)])))setDestination(null);
  },[board,visible,selectedId,destination,shownPieces]);

  function cellPieces(x:number,y:number){return shownPieces.filter(p=>p.x===x&&p.y===y);}
  function chooseCell(x:number,y:number){
    if(busy)return;
    const index=battleCellIndex(board,x,y),pieces=cellPieces(x,y),piece=pieces.find(p=>p.kind!=='loot')||pieces[0];
    setNotice('');
    if(piece){setSelectedId(piece.id);if(piece.kind!=='loot')setLastMovableId(piece.id);setDestination(null);return;}
    if(!visible.has(index)||isBlockingBattleTile(board.tiles[index]))return;
    if(readOnly){setNotice('Приём действий закрыт. Карточки видимых пешек можно изучать.');return;}
    if(gm&&!selected){setNotice('Сначала выбери пешку, затем свободную клетку для перемещения.');return;}
    if(gm&&!onMove||!gm&&!mayRequest){setNotice(gm?'Перемещение здесь недоступно.':'Ведущий ещё не разместил твоего персонажа на поле.');return;}
    setDestination({x,y});
  }
  function move(){
    if(busy||readOnly||!destination||!movable)return;
    if(gm)onMove?.(movable.id,destination.x,destination.y);else onRequestMove?.(destination.x,destination.y);
    setDestination(null);
  }
  function centre(){
    const piece=gm?(selected||turn||ownPiece):ownPiece;if(!piece)return;
    const cell=viewport.current?.querySelector<HTMLElement>(`[data-cell="${piece.x}:${piece.y}"]`);
    if(cell&&viewport.current){const frame=viewport.current;frame.scrollTo({left:Math.max(0,cell.offsetLeft-frame.clientWidth/2+cell.offsetWidth/2),top:Math.max(0,cell.offsetTop-frame.clientHeight/2+cell.offsetHeight/2),behavior:'auto'});}
  }
  const instruction=readOnly?'Приём действий закрыт. Можно изучать видимые пешки; заявки станут доступны, когда ГМ откроет сцену.':gm?'Выбери пешку. Затем нажми свободную клетку и подтверди перемещение.':ownPiece?'Нажми видимую цель, чтобы выбрать действие. Нажми свободную клетку, чтобы запросить перемещение.':'Персонажа пока нет на поле. Ведущий должен разместить его в конструкторе.';

  return <section className={`battle-board ${gm?'battle-gm':'battle-player'}`} aria-label={gm?'Поле боя ведущего':`Поле боя: вид ${actorName}`}>
    <header className="battle-heading"><div><span className="battle-eyebrow">{gm?'ПОЛНЫЙ ОБЗОР ГМ':`ОБЗОР · ${actorName}`}</span><h3>Поле боя</h3><p>{board.width} × {board.height} клеток · {board.cellMeters} м на клетку</p></div><span className="battle-view-badge">{gm?<Eye aria-hidden="true"/>:<EyeOff aria-hidden="true"/>}{gm?'Видишь всё поле':'Видишь только доступную область'}</span></header>
    <div className="battle-toolbar"><div className="battle-zoom" role="group" aria-label="Размер клеток"><button type="button" aria-pressed={zoom==='normal'} onClick={()=>setZoom('normal')}>Обычный</button><button type="button" aria-pressed={zoom==='large'} onClick={()=>setZoom('large')}>Крупнее</button></div><button type="button" onClick={centre} disabled={!ownPiece&&!selected&&!turn}><Crosshair aria-hidden="true"/>{gm?'К выбранной пешке':'К своему персонажу'}</button></div>
    <p className="battle-instruction">{instruction} Поле можно прокручивать пальцем.</p>
    <div ref={viewport} className="battle-viewport" tabIndex={0} aria-label="Прокручиваемое поле боя">
      <div className={`battle-grid battle-zoom-${zoom}`} style={{gridTemplateColumns:`repeat(${board.width},var(--battle-cell))`}} role="group" aria-label="Клетки поля боя">
        {board.tiles.map((sourceTile,index)=>{
          const x=index%board.width,y=Math.floor(index/board.width),known=visible.has(index),tile=known?sourceTile:'unknown',pieces=known?cellPieces(x,y):[];
          const piece=pieces.find(p=>p.kind!=='loot')||pieces[0],pieceTarget=piece?.targetId?targets.find(t=>t.id===piece.targetId):undefined;
          const current=pieces.some(p=>p.id===board.turnPieceId),chosen=pieces.some(p=>p.id===selectedId),dest=destination?.x===x&&destination?.y===y;
          const label=`Клетка ${x+1}, ${y+1}: ${TILE_KIND[tile]}${pieces.length?`, ${pieces.map(p=>`${PIECE_KIND[p.kind]} ${pieceLabel(p)}${p.hidden&&gm?', скрыта от игроков':''}`).join('; ')}`:''}${current?', текущий ход':''}`;
          return <button key={index} type="button" data-cell={`${x}:${y}`} aria-label={label} aria-pressed={chosen||dest} title={label} disabled={busy||!known||(!pieces.length&&isBlockingBattleTile(tile))} className={`battle-cell tile-${tile}${chosen?' is-selected':''}${dest?' is-destination':''}${current?' is-turn':''}`} onClick={()=>chooseCell(x,y)}>
            {tile==='door'&&!piece&&<DoorClosed aria-hidden="true"/>}
            {piece&&<><span className={`battle-pawn pawn-${piece.kind}${piece.hidden&&gm?' is-hidden':''}`}><BattlePieceIcon piece={piece} target={pieceTarget}/>{piece.hidden&&gm&&<EyeOff className="battle-hidden-mark" aria-hidden="true"/>}</span><span className="battle-pawn-label" aria-hidden="true">{pieceLabel(piece)}</span>{pieces.length>1&&<span className="battle-pawn-count" aria-hidden="true">+{pieces.length-1}</span>}</>}
            {dest&&<Move className="battle-destination-mark" aria-hidden="true"/>}
            {current&&<Flag className="battle-turn-mark" aria-hidden="true"/>}
          </button>;
        })}
      </div>
    </div>
    <div className="battle-legend" aria-label="Обозначения поля"><span><i className="legend-wall"/>Стена</span><span><DoorClosed aria-hidden="true"/>Закрытая дверь</span><span><i className="legend-cover"/>Укрытие</span>{!gm&&<span><i className="legend-fog"/>Неизвестно</span>}<span><UserRound aria-hidden="true"/>Персонаж</span><span><Crosshair aria-hidden="true"/>Цель</span><span><Box aria-hidden="true"/>Лут</span><span><CarFront aria-hidden="true"/>Транспорт</span></div>
    <div className="battle-live" aria-live="polite">{notice||destination&&`Выбрана клетка ${destination.x+1}, ${destination.y+1}. Подтверди перемещение ниже.`||selected&&`${PIECE_KIND[selected.kind]}: ${pieceLabel(selected)}. Клетка ${selected.x+1}, ${selected.y+1}.`||''}</div>
    {selected&&<article className="battle-selection"><header><div><span>{PIECE_KIND[selected.kind]} · клетка {selected.x+1}, {selected.y+1}</span><h4>{pieceLabel(selected)}</h4></div><button type="button" aria-label="Снять выбор пешки" onClick={()=>{setSelectedId('');setDestination(null);}}><X aria-hidden="true"/></button></header>{(target?.description||selected.description)&&<p>{target?.description||selected.description}</p>}{selected.hidden&&gm&&<p className="battle-warning"><EyeOff aria-hidden="true"/>Эта пешка скрыта от игроков.</p>}{selected.kind==='target'&&target&&(!gm||characterId!==null)&&<div className="battle-actions"><button type="button" disabled={busy||readOnly||!target.visible||selected.hidden} onClick={()=>onTarget(target.id,'attack')}><Crosshair aria-hidden="true"/>Атаковать</button><button type="button" disabled={busy||readOnly||!target.visible||selected.hidden} onClick={()=>onTarget(target.id,'program')}><Zap aria-hidden="true"/>Применить программу</button><button type="button" disabled={busy||readOnly||!target.visible||selected.hidden} onClick={()=>onTarget(target.id,'other')}>Другое действие<ArrowRight aria-hidden="true"/></button></div>}{selected.kind==='loot'&&<><p className="battle-hint">Опиши ведущему, что хочешь забрать. Лут пока не переносится в инвентарь автоматически.</p>{canMoveToLoot&&(gm?!!onMove:mayRequest)&&<button type="button" disabled={busy} onClick={()=>setDestination({x:selected.x,y:selected.y,...(gm?{pieceId:lootMovePiece!.id}:{})})}><Move aria-hidden="true"/>{gm?`Передвинуть сюда: ${pieceLabel(lootMovePiece!)}`:'Переместиться к этой клетке'}</button>}</>}{cellPieces(selected.x,selected.y).length>1&&<div className="battle-cell-contents"><p className="battle-hint">В этой же клетке:</p><div className="battle-actions">{cellPieces(selected.x,selected.y).filter(p=>p.id!==selected.id).map(p=><button key={p.id} type="button" disabled={busy} onClick={()=>{setSelectedId(p.id);if(p.kind!=='loot')setLastMovableId(p.id);setDestination(null);}}><BattlePieceIcon piece={p} target={p.targetId?targets.find(t=>t.id===p.targetId):undefined}/>{pieceLabel(p)}</button>)}</div></div>}{selected.kind==='vehicle'&&<p className="battle-hint">Доступ, управление и последствия определяет ведущий. Здесь показано расположение транспорта.</p>}</article>}
    {pendingPiece&&destination&&<aside className="battle-move-confirm" aria-label="Подтверждение перемещения"><h4>{gm?'Передвинуть пешку':'Запросить перемещение'}</h4><p><strong>{pieceLabel(movable!)}</strong>: клетка {movable!.x+1}, {movable!.y+1} → {destination.x+1}, {destination.y+1}.</p><p className="battle-hint">{gm?'Позиция изменится после сохранения на сервере. Это ручное перемещение ведущего.':'Позиция изменится после подтверждения результата ведущим. Дальность, маршрут и необходимые проверки определяет ГМ.'}</p><div className="battle-actions"><button type="button" className="primary" disabled={busy} onClick={move}><Move aria-hidden="true"/>{gm?'Подтвердить перемещение':'Отправить заявку ГМу'}</button><button type="button" disabled={busy} onClick={()=>setDestination(null)}>Отмена</button></div></aside>}
    <footer className="battle-turn"><span><Flag aria-hidden="true"/>{turn?`Текущий ход: ${pieceLabel(turn)}`:board.turnPieceId?'Текущий ход вне твоего обзора':'Текущий ход ещё не выбран'}</span>{gm&&onNextTurn&&<button type="button" disabled={busy||!board.pieces.length} onClick={onNextTurn}>Следующий ход<ArrowRight aria-hidden="true"/></button>}</footer>
  </section>;
}
