import {APP_VERSION} from '@/lib/app-version';
import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
 title: 'Night City Crew · Cyberpunk 2020',
 description: 'Листы, экипировка, проверки и обучение для игроков Cyberpunk 2020.',
 icons: { icon: `/favicon.svg?v=${APP_VERSION}`,apple:'/icons/apple-touch-icon.png' },
 manifest:'/manifest.webmanifest',
 appleWebApp:{capable:true,statusBarStyle:'black-translucent',title:'NC Crew'},
};
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#080406'};
export default function RootLayout({children}: {children: React.ReactNode}) {
 return <html lang="ru" data-palette="carmine" data-treatment="printed" data-digital="on" suppressHydrationWarning><head><script src={`/appearance-init.js?v=${APP_VERSION}`}/><link rel="stylesheet" href={`/style.css?v=${APP_VERSION}`} /><link rel="stylesheet" href={`/dossier-theme.css?v=${APP_VERSION}`} /><link rel="stylesheet" href={`/deck-connection.css?v=${APP_VERSION}`} /><link rel="stylesheet" href={`/cyberoptic-preview.css?v=${APP_VERSION}`} /><link rel="stylesheet" href={`/access-settings.css?v=${APP_VERSION}`} /><link rel="stylesheet" href={`/campaign-dossier.css?v=${APP_VERSION}`} /><link rel="stylesheet" href={`/portrait-editor.css?v=${APP_VERSION}`} /><link rel="stylesheet" href={`/campaign-controls.css?v=${APP_VERSION}`} /><link rel="stylesheet" href={`/city-atlas-transition.css?v=${APP_VERSION}`} /><link rel="stylesheet" href={`/record-controls.css?v=${APP_VERSION}`} /><link rel="stylesheet" href={`/shared-battle.css?v=${APP_VERSION}`} /></head><body>{children}</body></html>;
}
