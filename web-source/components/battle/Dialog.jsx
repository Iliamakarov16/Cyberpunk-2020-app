'use client';
import React,{useEffect,useRef,useState} from 'react';
import {Dialog as Primitive} from 'radix-ui';
import {X} from 'lucide-react';
import {observeBattleViewport} from '@/lib/battle-viewport.mjs';
import './battle-dialog.css';
export const Dialog = Primitive.Root;
/** @param {import('react').ComponentProps<typeof Primitive.Content> & {showCloseButton?:boolean}} props */
export function DialogContent({children,className='',showCloseButton=true,style,onOpenAutoFocus,...props}) {
 const [viewport,setViewport]=useState(null);
 const content=useRef(null);
 useEffect(()=>observeBattleViewport(window,next=>setViewport(previous=>previous&&['width','height','top','left'].every(key=>previous[key]===next[key])?previous:next)),[]);
 useEffect(()=>{const frame=window.requestAnimationFrame(()=>{const input=document.activeElement;if(content.current?.contains(input)&&input?.matches?.('input,textarea,select'))input.scrollIntoView({block:'nearest',inline:'nearest'});});return()=>window.cancelAnimationFrame(frame);},[viewport?.height,viewport?.width]);
 const visibleStyle=viewport?{'--nc-dialog-height':viewport.height+'px','--nc-dialog-width':viewport.width+'px','--nc-dialog-top':viewport.top+'px','--nc-dialog-left':viewport.left+'px'}:{};
 const focusDialog=event=>{if(onOpenAutoFocus){onOpenAutoFocus(event);return;}event.preventDefault();event.target?.focus?.({preventScroll:true});};
 return <Primitive.Portal><Primitive.Overlay className="nc-battle-dialog-overlay"/><Primitive.Content ref={content} data-slot="dialog-content" className={'nc-battle-dialog-content '+className} style={{...visibleStyle,...style}} onOpenAutoFocus={focusDialog} {...props}>{children}{showCloseButton&&<Primitive.Close className="nc-battle-dialog-close" aria-label="Закрыть окно"><X size={20}/></Primitive.Close>}</Primitive.Content></Primitive.Portal>;
}
export const DialogHeader = ({children}) => <div data-slot="dialog-header" className="nc-battle-dialog-header">{children}</div>;
export const DialogTitle = props => <Primitive.Title data-slot="dialog-title" {...props}/>;
export const DialogDescription = props => <Primitive.Description data-slot="dialog-description" {...props}/>;
