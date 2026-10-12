/** Files are untrusted preparation documents, never client-authoritative saves. */
export const MAX_BATTLE_IMPORT_BYTES = 2 * 1024 * 1024;
export type BattleImportFile = {size:number;text:()=>Promise<string>};
export async function readBattleImport(file:BattleImportFile):Promise<Record<string,unknown>> {
 if(!Number.isFinite(file.size)||file.size<1||file.size>MAX_BATTLE_IMPORT_BYTES)throw new Error('Выбери JSON-файл сцены размером до 2 МБ.');
 let document:unknown;
 try {document=JSON.parse(await file.text());}catch{throw new Error('Не удалось прочитать JSON. Выбери экспортированный файл сцены.');}
 if(!document||typeof document!=='object'||Array.isArray(document))throw new Error('В файле нет документа сцены.');
 return document as Record<string,unknown>;
}
export function battleExportName(name:string):string {
 const safe=name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').trim().replace(/\s+/g,'-').slice(0,80);
 return 'night-city-scene-'+(safe||'preparation')+'.json';
}
export function downloadBattleDocument(document:unknown,name:string):void {
 const blob=new Blob([JSON.stringify(document,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),anchor=window.document.createElement('a');
 anchor.href=url;anchor.download=battleExportName(name);anchor.click();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
}
