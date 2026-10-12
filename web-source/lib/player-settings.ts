export type AmbientLevel='quiet'|'vivid'|'off';
export type PlayerSettings={hints:boolean;tutorial:boolean;animations:boolean;ambient:AmbientLevel};
export const DEFAULT_PLAYER_SETTINGS:PlayerSettings={hints:true,tutorial:true,animations:true,ambient:'quiet'};
export function playerSettings(raw:unknown):PlayerSettings{
 const value=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
 return {
  hints:typeof value.hints==='boolean'?value.hints:DEFAULT_PLAYER_SETTINGS.hints,
  tutorial:typeof value.tutorial==='boolean'?value.tutorial:DEFAULT_PLAYER_SETTINGS.tutorial,
  animations:typeof value.animations==='boolean'?value.animations:DEFAULT_PLAYER_SETTINGS.animations,
  ambient:value.ambient==='quiet'||value.ambient==='vivid'||value.ambient==='off'?value.ambient:DEFAULT_PLAYER_SETTINGS.ambient,
 };
}
