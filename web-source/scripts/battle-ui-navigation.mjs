// Explicit navigation for the contextual battle shell. No server/engine mocking here.
import assert from 'node:assert/strict';
export async function openBattleMenu(h) {
 if (!h.find(node=>node.props['aria-label']==='Управление боем')) await h.click('Меню боя');
}
export async function clickBattleControl(h,label) {
 // The fullscreen preparation can already expose its own training/setup action.
 if (!h.button(label)) await openBattleMenu(h);
 await h.click(label);
}
export async function showBattleActorActions(h,actorId) {
 const rendered=globalThis.__battleRendered;
 const actor=rendered.state.actors.find(a=>a.id===(actorId || rendered.selectedId));
 assert(actor,'Actor context needs a real projected actor');
 const queue=h.buttons().find(node=>node.props['aria-label']===actor.name || node.props['aria-label']===actor.name+' — текущий ход');
 if(queue) await h.click(queue);
 else {globalThis.__battlePick({x:actor.x,y:actor.y,actorId:actor.id});h.render();await h.flush();}
 assert(h.find(node=>node.props['aria-label']==='Действия выбранного персонажа'),'Actor selection opens its context panel');
}
export async function clickBattleAction(h,label) {
 if (!h.find(node=>node.props['aria-label']==='Предпросмотр действия')) await showBattleActorActions(h);
 // Tests deliberately adjudicate an ordinary GM shot; production has no default.
 if(label==='Огонь'&&h.find(node=>node.props['aria-label']==='Предпросмотр действия')&&h.button('Без разворота'))await h.click('Без разворота');
 await h.click(label);
}
