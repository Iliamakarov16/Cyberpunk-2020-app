import React from 'react';
import {createRoot} from 'react-dom/client';
import Tracker from './tracker';
const root=document.getElementById('tracker');
if(root)createRoot(root).render(<Tracker platformAuth={false}/>);
