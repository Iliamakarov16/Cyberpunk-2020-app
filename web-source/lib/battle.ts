/** Canonical battle data. No UI or persistence dependencies. */
export type BattleTile = 'floor' | 'wall' | 'door' | 'cover';
export type Movement = {fromX:number;fromY:number;x:number;y:number};
export type BattlePiece = {
 id:string;kind:'character'|'target'|'loot'|'vehicle';x:number;y:number;
 characterId:number|null;targetId:string|null;name:string;description:string;
 hidden:boolean;initiative:number|null;
};
export type BattleBoard = {
 schemaVersion:1;width:number;height:number;cellMeters:number;vision:number;
 tiles:BattleTile[];pieces:BattlePiece[];turnPieceId:string|null;
};
export type BattleBoardView = Omit<BattleBoard,'tiles'> & {
 tiles:(BattleTile|'unknown')[];views:{characterId:number;visible:number[]}[];
};
export class BattleValidationError extends Error {
 readonly status=400;
 constructor(message:string){super(message);this.name='BattleValidationError';}
}
const invalid=(message:string):never=>{throw new BattleValidationError(message);};
function record(v:unknown,keys?:string[]):Record<string,any>{if(!v||typeof v!=='object'||Array.isArray(v)||keys&&Object.keys(v).some(k=>!keys.includes(k)))invalid('Проверь формат поля боя.');return v as Record<string,any>;}
function integer(v:any,label:string,min:number,max:number){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)invalid('Проверь число «'+label+'» на поле боя.');return v as number;}
function string(v:any,label:string,max:number,required=false){if(typeof v!=='string'||v.length>max||(required&&!v.trim()))invalid('Проверь поле «'+label+'» на поле боя.');return v.trim() as string;}
function identifier(v:any){const s=string(v,'ID',80,true);if(!/^[a-zA-Z0-9_-]+$/.test(s))invalid('Некорректный ID пешки.');return s;}
function boolean(v:any){if(typeof v!=='boolean')invalid('Проверь скрытие пешки.');return v as boolean;}
export function battleCellIndex(board:Pick<BattleBoard,'width'>,x:number,y:number){return y*board.width+x;}
export function isBlockingBattleTile(tile:BattleTile|'unknown'|undefined){return tile==='wall'||tile==='door'||tile==='unknown'||tile===undefined;}
export function canOccupyBattleCell(board:BattleBoard,piece:BattlePiece,x:number,y:number){
 if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||x<0||y<0||x>=board.width||y>=board.height)return false;
 if(isBlockingBattleTile(board.tiles[battleCellIndex(board,x,y)]))return false;
 return piece.kind==='loot'||!board.pieces.some(p=>p.id!==piece.id&&p.kind!=='loot'&&p.x===x&&p.y===y);
}
export function validateBattleBoard(raw:any,characterIds?:Set<number>,targetIds?:Set<string>):BattleBoard {
 const v=record(raw,['schemaVersion','width','height','cellMeters','vision','tiles','pieces','turnPieceId']);if(v.schemaVersion!==1)invalid('Неизвестный формат поля боя.');
 const width=integer(v.width,'Ширина',6,24),height=integer(v.height,'Высота',6,24);
 if(typeof v.cellMeters!=='number'||!Number.isFinite(v.cellMeters)||v.cellMeters<0.5||v.cellMeters>10)invalid('Размер клетки должен быть от 0,5 до 10 метров.');
 const vision=integer(v.vision,'Обзор',1,24);
 if(!Array.isArray(v.tiles)||v.tiles.length!==width*height||v.tiles.some((t:any)=>!['floor','wall','door','cover'].includes(t)))invalid('Количество клеток не соответствует размеру поля.');
 if(!Array.isArray(v.pieces)||v.pieces.length>60)invalid('На поле можно разместить не более 60 пешек.');
 const pieces:BattlePiece[]=v.pieces.map((rawPiece:any)=>{
  const p=record(rawPiece,['id','kind','x','y','characterId','targetId','name','description','hidden','initiative']);if(!['character','target','loot','vehicle'].includes(p.kind))invalid('Выбери тип пешки.');
  const characterId=p.characterId===null?null:integer(p.characterId,'Персонаж',1,Number.MAX_SAFE_INTEGER);
  const targetId=p.targetId===null?null:identifier(p.targetId);
  if((p.kind==='character')!==(characterId!==null)||(p.kind==='target')!==(targetId!==null))invalid('Ссылка пешки не соответствует её типу.');
  if(characterId!==null&&characterIds&&!characterIds.has(characterId))invalid('Пешка ссылается на персонажа вне принятого состава. Исправь поле боя.');
  if(targetId!==null&&targetIds&&!targetIds.has(targetId))invalid('Пешка ссылается на удалённую цель.');
  return {id:identifier(p.id),kind:p.kind,x:integer(p.x,'X',0,width-1),y:integer(p.y,'Y',0,height-1),characterId,targetId,name:string(p.name,'Название пешки',100,true),description:string(p.description,'Описание пешки',1500),hidden:boolean(p.hidden),initiative:p.initiative===null?null:integer(p.initiative,'Инициатива',Number.MIN_SAFE_INTEGER,Number.MAX_SAFE_INTEGER)};
 });
 for(const [values,label] of [[pieces.map(p=>p.id),'ID пешек'],[pieces.filter(p=>p.characterId!==null).map(p=>p.characterId),'персонажей'],[pieces.filter(p=>p.targetId!==null).map(p=>p.targetId),'целей']] as [unknown[],string][])if(new Set(values).size!==values.length)invalid('Не допускаются повторные ссылки: '+label+'.');
 const turnPieceId=v.turnPieceId===null?null:identifier(v.turnPieceId);
 if(turnPieceId!==null&&!pieces.some(p=>p.id===turnPieceId))invalid('Пешка текущего хода отсутствует на поле.');
 const board:BattleBoard={schemaVersion:1,width,height,cellMeters:v.cellMeters,vision,tiles:[...v.tiles],pieces,turnPieceId};
 if(pieces.some(p=>p.kind!=='loot'&&!canOccupyBattleCell(board,p,p.x,p.y)))invalid('Пешки не могут стоять в стене, закрытой двери или в занятой клетке.');
 return board;
}
export function validateMovement(raw:any,board?:Pick<BattleBoard,'width'|'height'>):Movement {
 const v=record(raw,['fromX','fromY','x','y']),maxX=board?board.width-1:23,maxY=board?board.height-1:23;
 return {fromX:integer(v.fromX,'Начало X',0,maxX),fromY:integer(v.fromY,'Начало Y',0,maxY),x:integer(v.x,'Назначение X',0,maxX),y:integer(v.y,'Назначение Y',0,maxY)};
}
/** Grid traversal between cell centres. A blocking endpoint is visible. */
function hasLineOfSight(board:BattleBoard,fromX:number,fromY:number,toX:number,toY:number){
 let x=fromX,y=fromY,stepsX=0,stepsY=0;
 const dx=Math.abs(toX-fromX),dy=Math.abs(toY-fromY),sx=Math.sign(toX-fromX),sy=Math.sign(toY-fromY);
 const blocks=(a:number,b:number)=>isBlockingBattleTile(board.tiles[battleCellIndex(board,a,b)]);
 while(x!==toX||y!==toY){
  const nextX=dx?(2*stepsX+1)*dy:Infinity,nextY=dy?(2*stepsY+1)*dx:Infinity;
  if(nextX===nextY){if(blocks(x+sx,y)&&blocks(x,y+sy))return false;x+=sx;y+=sy;stepsX++;stepsY++;}
  else if(nextX<nextY){x+=sx;stepsX++;}else{y+=sy;stepsY++;}
  if(x===toX&&y===toY)return true;
  if(blocks(x,y))return false;
 }
 return true;
}
export function visibleBattleCells(board:BattleBoard,piece:Pick<BattlePiece,'x'|'y'>):number[]{
 const visible:number[]=[];
 for(let y=Math.max(0,piece.y-board.vision);y<=Math.min(board.height-1,piece.y+board.vision);y++)for(let x=Math.max(0,piece.x-board.vision);x<=Math.min(board.width-1,piece.x+board.vision);x++)if((x-piece.x)**2+(y-piece.y)**2<=board.vision**2&&hasLineOfSight(board,piece.x,piece.y,x,y))visible.push(battleCellIndex(board,x,y));
 return visible;
}
export function targetVisibleToActor(board:BattleBoard,targetId:string,characterId:number){
 const actor=board.pieces.find(p=>p.kind==='character'&&p.characterId===characterId);
 if(targetId==='battle-floor')return Boolean(actor);
 const target=board.pieces.find(p=>p.kind==='target'&&p.targetId===targetId);
 if(!target)return true;
 return Boolean(actor&&!target.hidden&&visibleBattleCells(board,actor).includes(battleCellIndex(board,target.x,target.y)));
}
export function projectBattleBoard(board:BattleBoard,own:Set<number>,accepted?:Set<number>,visibleTargetIds?:Set<string>):BattleBoardView {
 const ownPieces=board.pieces.filter(p=>p.kind==='character'&&p.characterId!==null&&own.has(p.characterId)&&(!accepted||accepted.has(p.characterId)));
 const views=ownPieces.map(p=>({characterId:p.characterId!,visible:visibleBattleCells(board,p)})),visible=new Set(views.flatMap(v=>v.visible));
 const pieces=board.pieces.filter(p=>{
  if(p.kind==='character'&&p.characterId!==null&&accepted&&!accepted.has(p.characterId))return false;
  if(ownPieces.some(a=>a.id===p.id))return true;
  if(p.kind==='target'&&p.targetId!==null&&visibleTargetIds&&!visibleTargetIds.has(p.targetId))return false;
  return !p.hidden&&visible.has(battleCellIndex(board,p.x,p.y));
 }).map(p=>({...p}));
 return {...board,tiles:board.tiles.map((tile,i)=>visible.has(i)?tile:'unknown'),pieces,turnPieceId:pieces.some(p=>p.id===board.turnPieceId)?board.turnPieceId:null,views};
}
export function movementFloorTarget(){return {id:'battle-floor',name:'Поле боя',kind:'device' as const,description:'Перемещение по полю',visible:true};}
