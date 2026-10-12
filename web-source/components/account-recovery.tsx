'use client';
import React,{useEffect,useState} from 'react';

export default function AccountRecovery({platformAuth,onOwnerLogin,onNativeRecovery}:{platformAuth:boolean;onOwnerLogin:()=>void;onNativeRecovery:()=>void}) {
  const [native,setNative]=useState(false),[local,setLocal]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    const inspect=()=>{setNative(typeof window.NightCityNative?.postMessage==='function');setLocal(window.location?.origin==='http://127.0.0.1:8080');};
    inspect();window.addEventListener('night-city-native-ready',inspect);
    return()=>window.removeEventListener('night-city-native-ready',inspect);
  },[]);
  function recover(){
    try{
      if(!native||!local||typeof window.NightCityNative?.postMessage!=='function')throw new Error('Открой локальную игру на телефоне ведущего.');
      window.NightCityNative.postMessage('recover-account');onNativeRecovery();
    }catch(e){setError(e instanceof Error?e.message:'Не удалось открыть восстановление. Попробуй со стартового экрана приложения.');}
  }
  return <div className="nc-recovery">
    {native&&local?<section><span className="eyebrow">01 / ЭТОТ ТЕЛЕФОН</span><h3>Вернуться в свою игру</h3><p>Подтверди PIN, пароль или графический ключ телефона и задай новый пароль локального ведущего. Персонажи, кампании и история сохранятся.</p><button type="button" className="primary" onClick={recover}>Подтвердить доступ к телефону</button></section>:<section><span className="eyebrow">01 / СЕРВЕР ВЕДУЩЕГО</span><h3>Восстановить аккаунт игрока</h3><p>Администратор этого сервера может задать тебе новый пароль: «Аккаунт» → «Аккаунты сервера» → твой логин → «Сбросить пароль».</p>{native&&<><p>Если это твоя локальная игра, вернись к подключению и открой её на этом телефоне.</p><button type="button" onClick={()=>window.NightCityNative?.postMessage('connection')}>Открыть подключение</button></>}</section>}
    {platformAuth&&<section><span className="eyebrow">02 / МОЙ ТЕСТ</span><h3>Доступ через ChatGPT</h3><p>Свой тест можно открыть через аккаунт ChatGPT, из которого он создан.</p><button type="button" onClick={onOwnerLogin}>Открыть мой тест через ChatGPT</button></section>}
    {error&&<p role="alert" className="error">{error}</p>}
  </div>;
}
