/* A single paper doll: unchanged anatomy, independently rendered transparent layers. */
(() => {
  'use strict';
  const root = '/art/paperdoll-v2/';
  const skinTones = [
    {name:'Светлый',rgb:[246,183,129],hex:'#f6b781'},
    {name:'Песочный',rgb:[221,168,124],hex:'#dda87c'},
    {name:'Оливковый',rgb:[184,146,103],hex:'#b89267'},
    {name:'Карамельный',rgb:[175,116,76],hex:'#af744c'},
    {name:'Коричневый',rgb:[128,85,60],hex:'#80553c'},
    {name:'Тёмный',rgb:[87,58,44],hex:'#573a2c'}
  ];
  const underwearColors = [
    {name:'Графит',rgb:[68,66,69],hex:'#444245'},
    {name:'Вишня',rgb:[105,45,58],hex:'#692d3a'},
    {name:'Индиго',rgb:[49,64,92],hex:'#31405c'}
  ];
  const items = [
    {id:'tshirt',slot:'inner',name:'Футболка',hint:'Внутренний слой'},
    {id:'jeans',slot:'legs',name:'Джинсы',hint:'Брюки'},
    {id:'jacket',slot:'outer',name:'Кожаная куртка',hint:'Верхний слой'},
    {id:'sneakers',slot:'feet',name:'Кеды',hint:'Обувь'}
  ];
  const hairChoices = [{id:'none',name:'Без волос'},{id:'crop',name:'Короткий кроп'},{id:'swept',name:'Асимметрия'}];
  const defaults = () => ({skin:1,underwear:0,hair:'crop',marks:{tattoo:false,scar:false,stubble:false},equipment:{inner:'tshirt',legs:'jeans',outer:null,feet:'sneakers'}});
  let state = defaults();
  const ui = {tab:'clothes',section:'skin',view:'body'};
  let manifest, basePixels;
  let ready = false;
  const canvas = document.getElementById('body-layer');
  const ctx = canvas.getContext('2d',{willReadFrequently:true});
  const choices = document.getElementById('choices');
  const layers = document.getElementById('layers');
  const worn = document.getElementById('worn');
  const loading = document.getElementById('loading');
  const announcement = document.getElementById('announcement');
  const imageCache = new Map();
  const decodedImages = new Map();
  const registeredSprites = new Map();
  const escape = str => str.replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const announce = msg => { announcement.textContent = msg; };

  function recolorBody() {
    const output = new ImageData(new Uint8ClampedArray(basePixels.data),basePixels.width,basePixels.height);
    const p = output.data, tone = skinTones[state.skin].rgb, briefs = underwearColors[state.underwear].rgb;
    for(let i=0;i<p.length;i+=4) {
      if(p[i+3]===0) continue;
      const r=p[i],g=p[i+1],b=p[i+2];
      // The base's warm skin palette is distinct from its dark ink and gray briefs.
      // White teeth/eyes and black line work remain the original illustration.
      const x=(i/4)%basePixels.width, y=Math.floor(i/4/basePixels.width);
      const iris=(y>=124 && y<=139 && ((x>=475 && x<=494)||(x>=529 && x<=548))) && r<160 && g<110 && b<80;
      if(!iris && r>75 && r>g*1.08 && g>b*1.08) {
        p[i]=Math.min(255,r*tone[0]/246);
        p[i+1]=Math.min(255,g*tone[1]/183);
        p[i+2]=Math.min(255,b*tone[2]/129);
      } else {
        if(x>=350 && x<=675 && y>=manifest.underwearRange[0] && y<=manifest.underwearRange[1] && r>32 && r<130 && Math.abs(r-g)<14 && Math.abs(g-b)<14) {
          p[i]=r*briefs[0]/68; p[i+1]=g*briefs[1]/66; p[i+2]=b*briefs[2]/69;
        }
      }
    }
    const unoccluded=new ImageData(new Uint8ClampedArray(output.data),output.width,output.height);
    if(state.equipment.feet==='sneakers') {
      for(let y=1376;y<output.height;y++) for(let x=0;x<output.width;x++) output.data[(y*output.width+x)*4+3]=0;
    }
    ctx.putImageData(output,0,0);
    return unoccluded;
  }

  function addLayer(id) {
    const asset=manifest.layers[id];
    if(!asset) return;
    if(asset.sleeveRegistration) {
      if(!registeredSprites.has(id)) {
        const source=document.createElement('canvas');source.width=1024;source.height=1536;
        const sctx=source.getContext('2d'), [sx,sy,tx,ty]=asset.transform;
        sctx.setTransform(sx,0,0,sy,tx,ty);sctx.drawImage(decodedImages.get(asset.file),0,0);
        const fitted=document.createElement('canvas');fitted.width=1024;fitted.height=1536;
        const fctx=fitted.getContext('2d'), points=asset.sleeveRegistration;
        fctx.drawImage(source,0,0,1024,430,0,0,1024,430);
        for(let y=430;y<750;y++) {
          let index=points.findIndex(point=>point[0]>=y);if(index===0)index=1;
          const a=points[index-1],b=points[index],shift=a[1]+(b[1]-a[1])*(y-a[0])/(b[0]-a[0]);
          const split=Math.max(300,Math.round(368-(y-430)*.25));
          fctx.drawImage(source,split,y,1024-2*split,1,split,y,1024-2*split,1);
          fctx.drawImage(source,0,y,split,1,shift,y,split,1);
          fctx.drawImage(source,1024-split,y,split,1,1024-split-shift,y,split,1);
        }
        fctx.drawImage(source,0,750,1024,786,0,750,1024,786);
        registeredSprites.set(id,fitted);
      }
      const display=document.createElement('canvas');display.width=1024;display.height=1536;display.className='layer';display.setAttribute('aria-hidden','true');
      display.getContext('2d').drawImage(registeredSprites.get(id),0,0);layers.append(display);return;
    }
    const img=document.createElement('img');
    img.src=root+asset.file; img.alt=''; img.className='layer';
    img.width=1024; img.height=1536;
    const [sx,sy,tx,ty]=asset.transform || [1,1,0,0];
    // Registration is part of each asset; never changes with outfit or appearance.
    img.style.transformOrigin='0 0';
    img.style.transform=`translate(${tx/1024*100}%,${ty/1536*100}%) scale(${sx},${sy})`;
    if(asset.blend) img.style.mixBlendMode=asset.blend;
    layers.append(img);
  }

  function renderFigure() {
    if(!ready) return;
    const body=recolorBody(); layers.replaceChildren();
    if(state.marks.tattoo) addLayer('tattoo');
    // Skin marks are below clothes, so sleeves naturally cover a selected tattoo.
    for(const slot of ['legs','inner','outer','feet']) if(state.equipment[slot]) addLayer(state.equipment[slot]);
    // Back collars sit behind the original head/neck rather than across the throat.
    const head=document.createElement('canvas');head.width=body.width;head.height=body.height;head.className='layer';
    const hp=new ImageData(new Uint8ClampedArray(body.data),body.width,body.height);
    for(let y=0;y<body.height;y++) for(let x=0;x<body.width;x++) {
      if(y>=258 || (y>=230 && (x<456 || x>565))) hp.data[(y*body.width+x)*4+3]=0;
    }
    head.getContext('2d').putImageData(hp,0,0);layers.append(head);
    if(state.marks.scar) addLayer('scar');
    if(state.marks.stubble) addLayer('stubble');
    if(state.hair!=='none') addLayer(state.hair);
    document.getElementById('figure-window').classList.toggle('portrait',ui.view==='portrait');
    const names=items.filter(item=>state.equipment[item.slot]===item.id).map(item=>item.name);
    document.getElementById('doll').setAttribute('aria-label',`Персонаж: ${skinTones[state.skin].name.toLowerCase()} скинтон, ${hairChoices.find(h=>h.id===state.hair).name.toLowerCase()}, ${names.length?names.join(', '):'в белье'}`);
    renderWorn();
  }

  function renderWorn() {
    const equipped=items.filter(item=>state.equipment[item.slot]===item.id);
    worn.innerHTML=equipped.length ? equipped.map(item=>`<button type="button" data-remove="${item.id}" aria-label="Снять: ${escape(item.name)}">${item.name}<span aria-hidden="true">×</span></button>`).join('') : '<p class="worn-empty">Только бельё</p>';
  }

  function palette(colors,selected,action) {
    return `<div class="palette" role="group" aria-label="${action==='skin'?'Оттенок кожи':'Цвет белья'}">${colors.map((color,i)=>`<button type="button" class="swatch" data-${action}="${i}" aria-label="${color.name}" title="${color.name}" aria-pressed="${i===selected}" style="--swatch:${color.hex}"></button>`).join('')}</div><p class="current-label">${colors[selected].name}</p>`;
  }

  function renderChoices() {
    if(!ready) return;
    const scrollTop=choices.scrollTop;
    if(ui.tab==='clothes') {
      choices.innerHTML=`<p class="helper">Нажми на вещь, чтобы надеть или снять.</p><div class="item-grid">${items.map(item=>`<button type="button" class="item-card" data-equip="${item.id}" aria-pressed="${state.equipment[item.slot]===item.id}"><span class="item-art"><img src="${root+manifest.layers[item.id].thumbnail}" alt=""></span><span class="item-state" aria-hidden="true">Надето</span><span class="item-label"><strong>${item.name}</strong><small>${state.equipment[item.slot]===item.id?'Нажми, чтобы снять':item.hint}</small></span></button>`).join('')}</div>`;
    } else {
      const sections=[['skin','Кожа'],['hair','Волосы'],['marks','Детали'],['underwear','Бельё']];
      const tabs=`<div class="appearance-tabs" role="group" aria-label="Часть внешности">${sections.map(([id,name])=>`<button type="button" data-section="${id}" aria-pressed="${ui.section===id}">${name}</button>`).join('')}</div>`;
      let content='';
      if(ui.section==='skin') content='<h2 class="section-title">Оттенок кожи</h2>'+palette(skinTones,state.skin,'skin');
      if(ui.section==='underwear') content='<h2 class="section-title">Боксёры</h2>'+palette(underwearColors,state.underwear,'underwear')+'<p class="helper" style="margin-top:20px">Сними джинсы, чтобы увидеть бельё.</p>';
      if(ui.section==='hair') content=`<div class="option-grid">${hairChoices.map(h=>`<button type="button" class="item-card" data-hair="${h.id}" aria-pressed="${state.hair===h.id}"><span class="hair-art">${h.id==='none'?'<span class="hair-none">Без волос</span>':`<img src="${root+manifest.layers[h.id].thumbnail}" alt="">`}</span><span class="item-state" aria-hidden="true">Выбрано</span><span class="item-label"><strong>${h.name}</strong></span></button>`).join('')}</div>`;
      if(ui.section==='marks') content=`<div class="detail-options">${[['tattoo','Тату на плече','Под рукавом не видно'],['scar','Шрам у брови','Лучше видно в портрете'],['stubble','Щетина','Независимо от причёски']].map(([id,name,hint])=>`<button type="button" class="option" data-mark="${id}" aria-pressed="${state.marks[id]}"><span>${name}<small>${hint}</small></span><span class="check" aria-hidden="true">${state.marks[id]?'✓':'+'}</span></button>`).join('')}</div>`;
      choices.innerHTML=tabs+content;
    }
    choices.scrollTop=scrollTop;
  }

  function update(focusKey) {
    renderFigure(); renderChoices();
    if(focusKey) {
      const target=choices.querySelector(focusKey);
      if(target) target.focus({preventScroll:true});
    }
  }

  function toggleItem(id,removeOnly=false) {
    const item=items.find(x=>x.id===id); if(!item) return;
    const remove=removeOnly || state.equipment[item.slot]===id;
    state.equipment[item.slot]=remove?null:id;
    announce(`${item.name}: ${remove?'снято':'надето'}`);
    update(removeOnly?undefined:`[data-equip="${id}"]`);
    if(removeOnly) {
      const next=worn.querySelector('button') || choices.querySelector(`[data-equip="${id}"]`) || document.querySelector('[data-tab="clothes"]');
      next?.focus({preventScroll:true});
    }
  }

  document.addEventListener('click',event=>{
    const button=event.target.closest('button'); if(!button || !ready) return;
    const d=button.dataset;
    if(d.equip) toggleItem(d.equip);
    else if(d.remove) toggleItem(d.remove,true);
    else if(d.tab) {
      ui.tab=d.tab; choices.scrollTop=0;
      document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.tab===ui.tab));
      renderChoices();
    } else if(d.section) {
      ui.section=d.section; choices.scrollTop=0;renderChoices();
      choices.querySelector(`[data-section="${d.section}"]`)?.focus({preventScroll:true});
    } else if(d.view) {
      ui.view=d.view;
      document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.view===ui.view));
      renderFigure();
    } else if(d.skin!==undefined) {
      state.skin=Number(d.skin);announce(`Кожа: ${skinTones[state.skin].name}`);update(`[data-skin="${d.skin}"]`);
    } else if(d.underwear!==undefined) {
      state.underwear=Number(d.underwear);announce(`Бельё: ${underwearColors[state.underwear].name}`);update(`[data-underwear="${d.underwear}"]`);
    } else if(d.hair) {
      state.hair=d.hair;announce(`Причёска: ${hairChoices.find(h=>h.id===d.hair).name}`);update(`[data-hair="${d.hair}"]`);
    } else if(d.mark) {
      state.marks[d.mark]=!state.marks[d.mark];update(`[data-mark="${d.mark}"]`);
    } else if(button.id==='reset') {
      state=defaults();announce('Внешность и одежда сброшены');update();
    }
  });

  function loadImage(file) {
    if(imageCache.has(file)) return imageCache.get(file);
    const promise=new Promise((resolve,reject)=>{
      const img=new Image();img.onload=()=>{decodedImages.set(file,img);resolve(img);};img.onerror=()=>reject(new Error(`Не загрузилась иллюстрация ${file}`));img.src=root+file;
    });
    imageCache.set(file,promise); return promise;
  }

  async function init() {
    try {
      const response=await fetch(root+'manifest.json');if(!response.ok) throw new Error('Не загрузилась примерочная');
      manifest=await response.json();
      const base=await loadImage(manifest.base);
      canvas.width=manifest.width;canvas.height=manifest.height;
      ctx.drawImage(base,0,0);basePixels=ctx.getImageData(0,0,canvas.width,canvas.height);
      await Promise.all(Object.values(manifest.layers).flatMap(a=>[loadImage(a.file),loadImage(a.thumbnail)]));
      ready=true;loading.hidden=true;update();
    } catch(error) {
      loading.textContent='Не удалось загрузить примерочную. Обнови страницу.';
      console.error(error);
    }
  }
  function adaptTextSize(){document.documentElement.classList.toggle('large-text',parseFloat(getComputedStyle(document.body).fontSize)>20);}
  adaptTextSize();window.addEventListener('resize',adaptTextSize);
  init();
})();
