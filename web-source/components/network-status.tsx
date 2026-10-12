'use client';

import React, {useEffect, useRef, useState} from 'react';
import {Download, RefreshCw, Wifi, WifiOff, Info, Server} from 'lucide-react';
import {Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription} from '@/components/ui/sheet';
import {APP_VERSION, API_VERSION, isNewerVersion} from '@/lib/app-version';

export const CLIENT_VERSION = APP_VERSION;
export const CLIENT_API_VERSION = API_VERSION;
declare global {
  interface Window {NightCityNative?: {postMessage: (message: string) => void}}
}
type Api = (path: string, method?: string, data?: unknown) => Promise<any>;
type Props = {dirty: boolean; onSync: () => Promise<void>; api: Api};
type Connection = 'checking' | 'online' | 'offline' | 'error' | 'session';
type InstallPrompt = Event & {prompt: () => Promise<void>; userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>};
type Version = {version: string; apiVersion: number};

/** GET-only observer. The root must also check dirty state before applying a response. */
export default function NetworkStatus({dirty, onSync, api}: Props) {
  const callbacks = useRef({dirty, onSync, api});
  callbacks.current = {dirty, onSync, api};
  const requestCheck = useRef<() => void>(() => {});
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const reloadRequested = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const updateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [connection, setConnection] = useState<Connection>('checking');
  const [detail, setDetail] = useState('');
  const [server, setServer] = useState<Version | null>(null);
  const [pending, setPending] = useState(false);
  const [secure, setSecure] = useState(true);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [workerWaiting, setWorkerWaiting] = useState(false);
  const [workerError, setWorkerError] = useState('');
  const [updating, setUpdating] = useState(false);
  const [open, setOpen] = useState(false);
  const [native, setNative] = useState(false);
  const incompatible = server !== null && server.apiVersion !== CLIENT_API_VERSION;
  const updateAvailable = incompatible || workerWaiting || (server !== null && isNewerVersion(server.version, CLIENT_VERSION));

  useEffect(() => {
    const inspect = () => setNative(typeof window.NightCityNative?.postMessage === 'function');
    inspect(); window.addEventListener('night-city-native-ready', inspect);
    return () => window.removeEventListener('night-city-native-ready', inspect);
  }, []);

  useEffect(() => {
    let alive = true, polling = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let appliedSignature: string | null = null;
    let lastVersionCheck = 0;
    let compatible = true;
    function schedule() {
      clearTimeout(timer);
      // Browser internet heuristics can report offline while a Wi-Fi server is reachable.
      if (alive && document.visibilityState === 'visible') timer = setTimeout(() => void check(), navigator.onLine ? 5000 : 10000);
    }
    async function check() {
      if (!alive || polling || document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      polling = true;
      try {
        const versionDue = Date.now() - lastVersionCheck >= 30000;
        const results = await Promise.allSettled([
          callbacks.current.api('/api/sync'),
          versionDue ? callbacks.current.api('/api/version') : Promise.resolve(null),
        ]);
        if (!alive) return;
        const versionResult = results[1];
        if (versionResult.status === 'fulfilled' && versionResult.value !== null) {
          const value = versionResult.value;
          if (typeof value.version === 'string' && Number.isInteger(value.apiVersion)) {
            lastVersionCheck = Date.now();
            compatible = value.apiVersion === CLIENT_API_VERSION;
            setServer({version: value.version, apiVersion: value.apiVersion});
            window.dispatchEvent(new CustomEvent('nightcity-api-version', {detail: {apiVersion: value.apiVersion, compatible}}));
          }
        }
        const syncResult = results[0];
        if (syncResult.status === 'rejected') throw syncResult.reason;
        const sync = syncResult.value;
        if (!sync || typeof sync.signature !== 'string') throw new Error('Сервер прислал неполный ответ синхронизации.');
        if (document.visibilityState !== 'visible') return;
        setConnection('online'); setDetail('');
        if (appliedSignature === null) {appliedSignature = sync.signature; return;}
        if (sync.signature === appliedSignature) return;
        if (callbacks.current.dirty || !compatible) {setPending(true); return;}
        // Re-check after the request; a player may have started typing while it was in flight.
        await callbacks.current.onSync();
        if (!alive) return;
        if (!callbacks.current.dirty) {appliedSignature = sync.signature; setPending(false);}
        else setPending(true);
      } catch (error: any) {
        if (!alive) return;
        setConnection(error?.status === 401 ? 'session' : error?.status ? 'error' : !navigator.onLine ? 'offline' : 'error');
        setDetail(error?.message || 'Не удалось связаться с сервером.');
      } finally {polling = false; schedule();}
    }
    const wake = () => {lastVersionCheck = 0; void check();};
    const visible = () => {clearTimeout(timer); if (document.visibilityState === 'visible') wake();};
    const offline = () => {lastVersionCheck = 0; void check();};
    requestCheck.current = wake;
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    window.addEventListener('offline', offline);
    void check();
    return () => {
      alive = false; clearTimeout(timer); requestCheck.current = () => {};
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', offline);
    };
  }, []);

  useEffect(() => {
    if (!dirty) requestCheck.current();
  }, [dirty]);

  useEffect(() => {
    let alive = true;
    let worker: ServiceWorker | null = null;
    let reg: ServiceWorkerRegistration | null = null;
    let workerTimer: ReturnType<typeof setInterval> | undefined;
    const media = window.matchMedia('(display-mode: standalone)');
    const isInstalled = () => media.matches || Boolean((navigator as Navigator & {standalone?: boolean}).standalone);
    setSecure(window.isSecureContext);
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    setInstalled(isInstalled());
    const installedChanged = () => {setInstalled(isInstalled()); setInstallPrompt(null);};
    const promptAvailable = (event: Event) => {event.preventDefault(); setInstallPrompt(event as InstallPrompt);};
    window.addEventListener('beforeinstallprompt', promptAvailable);
    window.addEventListener('appinstalled', installedChanged);
    media.addEventListener?.('change', installedChanged);
    const controllerChanged = () => {
      // Other open tabs do not reload when this tab approves a new worker.
      if (!reloadRequested.current) return;
      if (!callbacks.current.dirty) window.location.reload();
      else {reloadRequested.current = false; clearTimeout(updateTimer.current); setUpdating(false);}
    };
    const inspect = () => {if (alive && reg) setWorkerWaiting(Boolean(reg.waiting && navigator.serviceWorker.controller));};
    const workerChanged = () => {inspect();};
    const updateFound = () => {
      worker?.removeEventListener('statechange', workerChanged);
      worker = reg?.installing || null;
      worker?.addEventListener('statechange', workerChanged);
    };
    const checkWorker = () => {
      if (reg && document.visibilityState === 'visible') void reg.update().catch(() => {});
    };
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.addEventListener('controllerchange', controllerChanged);
      void navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'}).then(value => {
        if (!alive) return;
        reg = value; registration.current = value;
        inspect(); updateFound(); reg.addEventListener('updatefound', updateFound);
        workerTimer = setInterval(checkWorker, 60000);
        document.addEventListener('visibilitychange', checkWorker);
      }).catch(() => {if (alive) setWorkerError('Офлайн-экран не установлен. Можно продолжать играть с подключением к серверу.');});
    }
    return () => {
      alive = false; registration.current = null; clearInterval(workerTimer);
      clearTimeout(updateTimer.current); reloadRequested.current = false;
      worker?.removeEventListener('statechange', workerChanged);
      reg?.removeEventListener('updatefound', updateFound);
      document.removeEventListener('visibilitychange', checkWorker);
      window.removeEventListener('beforeinstallprompt', promptAvailable);
      window.removeEventListener('appinstalled', installedChanged);
      media.removeEventListener?.('change', installedChanged);
      if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged);
    };
  }, []);

  async function install() {
    if (!installPrompt) return;
    try {await installPrompt.prompt(); await installPrompt.userChoice;} catch {setWorkerError('Установку можно открыть через меню браузера.');} finally {setInstallPrompt(null);}
  }
  async function update() {
    if (callbacks.current.dirty || updating) return;
    setUpdating(true); setWorkerError('');
    const reg = registration.current;
    try {
      if (reg) await reg.update();
      if (callbacks.current.dirty) {setUpdating(false); return;}
      if (reg?.waiting) {
        reloadRequested.current = true;
        reg.waiting.postMessage({type: 'ACTIVATE_UPDATE'});
        // If a browser delays controllerchange, an explicit reload still fetches live app HTML.
        updateTimer.current = setTimeout(() => {
          if (!reloadRequested.current) return;
          if (!callbacks.current.dirty) window.location.reload();
          else {reloadRequested.current = false; setUpdating(false);}
        }, 2500);
      } else window.location.reload();
    } catch {
      setUpdating(false);
      setWorkerError('Не удалось проверить обновление. Восстанови связь с сервером и повтори.');
    }
  }

  const label = connection === 'checking' ? 'Проверяем связь' : connection === 'online' ? 'Сервер на связи' : connection === 'offline' ? 'Нет связи' : connection === 'session' ? 'Нужен повторный вход' : 'Сервер недоступен';
  const attention = updateAvailable || pending || connection === 'offline' || connection === 'error' || connection === 'session';
  const shortLabel = connection === 'offline' || connection === 'error' ? 'Нет связи' : connection === 'session' ? 'Нужен вход' : updateAvailable ? 'Обновление' : pending ? 'Изменения' : 'Связь';
  return <>
    <button ref={trigger} type="button" className={`connection-button ${attention ? 'needs-attention' : ''}`} aria-label={`Связь и сервер: ${label}${updateAvailable ? ', доступно обновление экрана' : pending ? ', есть изменения' : ''}`} aria-haspopup="dialog" onClick={() => setOpen(true)} title={label}>
      {connection === 'online' ? <Wifi aria-hidden="true"/> : connection === 'checking' ? <RefreshCw aria-hidden="true"/> : <WifiOff aria-hidden="true"/>}<span>{shortLabel}</span>
    </button>
    <Sheet open={open} onOpenChange={setOpen}><SheetContent side="right" className="tracker-sheet connection-sheet" onCloseAutoFocus={event=>{event.preventDefault();trigger.current?.focus();}}><SheetHeader className="editor-heading"><SheetTitle>Связь и сервер</SheetTitle><SheetDescription>Подключение, установка и версия</SheetDescription></SheetHeader><div className={`editor-body network-status connection-${connection}`}>
    <div className="connection-summary"><span className="network-connection" role="status">{connection === 'online' ? <Wifi aria-hidden="true"/> : <WifiOff aria-hidden="true"/>}{label}</span><span>Экран {CLIENT_VERSION}{server ? ` · сервер ${server.version}` : ''}</span></div>
    {native && <div className="connection-native"><button type="button" disabled={dirty} onClick={() => window.NightCityNative?.postMessage('connection')}><Server/>Настроить сервер или локальную игру</button>{dirty && <p className="hint">Сначала сохрани или закрой открытый черновик.</p>}</div>}
    {(connection === 'error' || connection === 'offline' || connection === 'session') && <button type="button" onClick={() => requestCheck.current()}><RefreshCw/>Проверить связь</button>}
    {(connection === 'offline' || connection === 'error') && <p className="network-message" role="status">{connection === 'offline' ? 'Восстанови Wi‑Fi или соединение с сервером.' : detail} Открытые несохранённые изменения остаются на экране. После восстановления связи нажми сохранение самостоятельно.</p>}
    {connection === 'session' && <p className="network-message">Вход на сервер истёк. Сохрани нужный черновик перед повторным входом.</p>}
    {pending && <p className="network-message">На сервере есть изменения. {dirty ? 'Сначала сохрани или закрой свой черновик — он не будет заменён автоматически.' : incompatible ? 'Обнови экран, чтобы получить их.' : 'Получаем обновлённые данные…'}</p>}
    {updateAvailable && <div className="network-update" role="status"><div><strong>{incompatible ? 'Версии экрана и сервера несовместимы' : 'Есть новая версия экрана'}</strong><p>{dirty ? 'Сначала сохрани несохранённые изменения.' : incompatible ? 'Синхронизация приостановлена до обновления.' : 'Обновление загрузит интерфейс с подключённого сервера.'}</p></div><button type="button" disabled={dirty || updating || connection !== 'online'} onClick={() => void update()}><RefreshCw/>{updating ? 'Обновляем…' : 'Обновить экран'}</button>{native && <p className="hint">APK обновляется установкой нового пакета. Эта кнопка обновляет только открытый экран.</p>}</div>}
    {workerError && <p className="network-message">{workerError}</p>}
    {!updateAvailable && connection === 'online' && <p className="connection-current">Экран актуален. Данные синхронизируются с сервером.</p>}
    <details className="network-help"><summary><Info aria-hidden="true"/>Как подключиться за столом</summary><div className="network-help-body"><p>ГМ запускает локальную игру и сообщает адрес. Все подключаются к одной Wi‑Fi сети и открывают этот адрес. Интернет не нужен.</p><p>localhost — это само устройство. На телефонах игроков нужен адрес телефона ГМа, который показан на экране локальной игры.</p><p>Общая кампания хранится на сервере ГМа. Без связи новые действия не подтверждаются. Открытый черновик остаётся у тебя на экране.</p></div></details>
    {!native && <details className="network-help"><summary><Download aria-hidden="true"/>{installed ? 'Приложение установлено' : 'Установка на телефон'}</summary><div className="network-help-body"><p>{ios ? 'iPhone / iPad: открой адрес в Safari, нажми «Поделиться» → «На экран Домой».' : 'Android: в Chrome выбери «Установить приложение» или «Добавить на главный экран».'}</p>{installPrompt && secure && <button type="button" onClick={() => void install()}><Download/>Установить</button>}{!secure && <p className="hint">Локальная игра по HTTP работает. Для установки с офлайн-экраном браузеру нужен HTTPS.</p>}</div></details>}
    </div></SheetContent></Sheet>
  </>;
}
