'use client';
import React,{useState} from 'react';

/** Archival data fold: every child remains the real working control. */
export function RecordFold({number,title,count,initialOpen=false,className='',dataTour,children}:{number:string;title:string;count?:number;initialOpen?:boolean;className?:string;dataTour?:string;children:React.ReactNode}){
 const [open,setOpen]=useState(initialOpen);
 return <details className={`nc-data-fold ${className}`} data-tour={dataTour} open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary><span className="nc-section-number" aria-hidden="true">{number}</span><span>{title}</span>{count!==undefined&&<span className="nc-fold-count">{count}</span>}<span className="nc-fold-mark" aria-hidden="true"/></summary>
  <div className="nc-fold-content">{children}</div>
 </details>;
}

export function RecordFooter({label='NIGHT CITY / PERSONAL RECORD / 2020'}:{label?:string}){
 return <footer className="nc-record-footer"><span>{label}</span><span className="nc-record-barcode" aria-hidden="true"/></footer>;
}
