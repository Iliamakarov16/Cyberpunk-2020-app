export type SceneSheetRequest = {
 characterId:number;
 sceneId:string;
 sceneName:string;
 actionId:string;
 destination:'resources'|'items';
 result:string;
};
export type SceneSheetContext = SceneSheetRequest & {campaignId:number;campaignName:string};
export type CampaignRoleContext = {campaignId:number;campaignName:string;isGM:boolean;pending:boolean;canPlay:boolean};
