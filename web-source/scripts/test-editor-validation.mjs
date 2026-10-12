import assert from 'node:assert/strict';
import {createTestModuleLoader} from './test-ts-loader.mjs';
const modules=createTestModuleLoader();
const {blank}=await modules.load('lib/tracker.ts');
const {armorDraftError}=await modules.load('lib/editor-validation.ts');
for(const mode of ['manual','equipment']){
 const data={...blank(),armorMode:mode};assert.equal(armorDraftError(data),null);
 for(const value of [NaN,Infinity,-1,201,1.5])assert.equal(armorDraftError({...data,armor:{...data.armor,head:value}}).mode,'manual');
 for(const value of [NaN,-1,21,.5])assert.equal(armorDraftError({...data,armorPenalty:value}).mode,'manual');
 for(const value of [NaN,-21,21,.5])assert.equal(armorDraftError({...data,evAdjustment:value}).mode,'equipment');
 for(const value of [-20,0,20])assert.equal(armorDraftError({...data,evAdjustment:value}),null);
}
console.log('Editors: hidden SP/EV fields reject invalid values in both armor modes; valid bounds passed.');
