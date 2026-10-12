import {ZONES,type CharacterData} from './tracker';
type ArmorDraft=Pick<CharacterData,'armorMode'|'armor'|'armorPenalty'|'evAdjustment'>;
const integer=(value:number,min:number,max:number)=>Number.isInteger(value)&&value>=min&&value<=max;
/** Both modes remain in the saved sheet, including fields hidden by the mode selector. */
export function armorDraftError(data:ArmorDraft):{mode:CharacterData['armorMode'];message:string}|null{
 for(const [zone,label] of Object.entries(ZONES))if(!integer(data.armor[zone as keyof typeof ZONES],0,200))return {mode:'manual',message:`${label}: укажи целый SP от 0 до 200.`};
 if(!integer(data.armorPenalty,0,20))return {mode:'manual',message:'Суммарный EV: укажи целое число от 0 до 20.'};
 if(!integer(data.evAdjustment,-20,20))return {mode:'equipment',message:'Поправка EV: укажи целое число от −20 до 20.'};
 return null;
}
