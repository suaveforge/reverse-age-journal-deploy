/* p49 LocalizeHub: UI text only, preserve existing SIP, billing and consent flows. */
(() => {
 'use strict';
 const P='p49',H='https://api-localizehub.suaveforge.com:18025',L=['ko','en','es'];
 const A=['placeholder','title','aria-label','alt'],SKIP='script,style,code,pre,textarea,input,select,option,[contenteditable],[data-localizehub-switcher],localize-switcher,[data-localize-ignore]';
 const q=new URLSearchParams(location.search).get('lang');
 let saved='';try{saved=localStorage.getItem('localizehub:'+P+':locale')||'';}catch{}
 const lang=L.includes(q)?q:(L.includes(saved)?saved:'ko');
 try{localStorage.setItem('localizehub:'+P+':locale',lang);}catch{}
 document.documentElement.lang=lang;
 // p49-only visual emblem: Argentina, Brazil, Chile and Colombia in a 2x2 rectangular flag.
 // This does not change locale semantics: Espanol remains "es" (Brazil speaks Portuguese).
 const LATAM_RECT_FLAG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 60" aria-hidden="true">'
  + '<rect width="44" height="30" fill="#74acdf"/><rect y="10" width="44" height="10" fill="#fff"/><circle cx="22" cy="15" r="3" fill="#f6b40e"/>'
  + '<rect x="44" width="44" height="30" fill="#009b3a"/><polygon points="66,3 85,15 66,27 47,15" fill="#ffdf00"/><circle cx="66" cy="15" r="7.5" fill="#002776"/><path d="M59 13.5Q66 11 73 16" fill="none" stroke="#fff" stroke-width="1.6"/>'
  + '<rect y="30" width="44" height="15" fill="#fff"/><rect y="45" width="44" height="15" fill="#d52b1e"/><rect y="30" width="17" height="15" fill="#0039a6"/><polygon points="8.5,32.8 9.8,36.8 14,36.8 10.6,39.2 11.9,43.1 8.5,40.7 5.1,43.1 6.4,39.2 3,36.8 7.2,36.8" fill="#fff"/>'
  + '<rect x="44" y="30" width="44" height="15" fill="#fcd116"/><rect x="44" y="45" width="44" height="7.5" fill="#003893"/><rect x="44" y="52.5" width="44" height="7.5" fill="#ce1126"/>'
  + '<path d="M44 0V60M0 30H88" stroke="#fff" stroke-width="1"/></svg>';
 function decorateLatamSwitcher(el){
   const root=el.shadowRoot;
   if(!root)return;
   const put=flag=>{
     if(!flag||flag.dataset.latamComposite==='yes')return;
     flag.dataset.latamComposite='yes';
     flag.innerHTML=LATAM_RECT_FLAG;
   };
   const apply=()=>{
     const option=root.querySelector('.option[data-locale="es"] .flag');
     const active=lang==='es'?root.querySelector('.control .flag'):null;
     put(option);put(active);
     if(option&&(lang!=='es'||active))observer.disconnect();
   };
   const observer=new MutationObserver(apply);
   observer.observe(root,{childList:true,subtree:true});
   apply();
 }
 const norm=s=>String(s??'').replace(/\s+/g,' ').trim();
 let words=new Map(),longWords=[],processing=false;
 function translate(value){
   if(lang==='ko'||!/[가-힣]/.test(String(value)))return value;
   const source=norm(value);if(!source)return value;
   let target=words.get(source);
   if(!target){
     target=source;
     for(const [a,b] of longWords)if(target.includes(a))target=target.split(a).join(b);
     if(target===source)return value;
   }
   const s=String(value);
   return (s.match(/^\s*/)?.[0]||'')+target+(s.match(/\s*$/)?.[0]||'');
 }
 function applyOne(node){
   if(node.nodeType===3){
     if(!node.parentElement||node.parentElement.closest(SKIP))return;
     const next=translate(node.nodeValue);if(next!==node.nodeValue)node.nodeValue=next;
   }else if(node.nodeType===1){
     if(node.closest(SKIP))return;
     for(const attr of A)if(node.hasAttribute(attr)){
       const old=node.getAttribute(attr),next=translate(old);
       if(next!==old)node.setAttribute(attr,next);
     }
   }
 }
 function apply(root){
   if(processing||lang==='ko'||!words.size||!root)return;
   processing=true;
   try{
     applyOne(root);
     const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
     while(walker.nextNode())applyOne(walker.currentNode);
   }finally{processing=false;}
 }
 function change(next){
   if(!L.includes(next))return;
   try{localStorage.setItem('localizehub:'+P+':locale',next);}catch{}
   const url=new URL(location.href);url.searchParams.set('lang',next);location.assign(url.toString());
 }
 function fallback(m){
   m.replaceChildren();
   const select=document.createElement('select');
   select.setAttribute('aria-label','Language / 언어 / Idioma');
   for(const [code,label] of [['ko','🇰🇷 한국어'],['en','🇺🇸 English'],['es','🌎 Español']]){
     const option=document.createElement('option');option.value=code;option.textContent=label;select.append(option);
   }
   select.value=lang;
   select.addEventListener('change',()=>change(select.value));
   select.style.cssText='font:600 12px system-ui,sans-serif;border:1px solid #b7c7b9;border-radius:8px;color:#214c35;background:#fff;padding:7px 9px;max-width:118px;min-height:34px';
   m.append(select);
 }
 async function switcher(){
   const m=document.createElement('div');m.dataset.localizehubSwitcher='p49';
   // Real header flex/grid placement: no absolute right offset, even inside iOS PWA.
   m.style.cssText='position:relative;z-index:2147483000;flex:none;width:118px;min-width:118px;max-width:118px;margin-left:auto';
   const style=document.createElement('style');
   style.id='raj-localizehub-responsive-header';
   style.textContent=[
     '.site-header [data-localizehub-switcher]{align-self:center}',
     '@media(max-width:700px){',
     '.page.family-opening-mode .site-header{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;align-items:center!important;gap:8px!important;padding-top:calc(8px + env(safe-area-inset-top))!important;padding-left:max(12px,env(safe-area-inset-left))!important;padding-right:max(12px,env(safe-area-inset-right))!important}',
     '.page.family-opening-mode .site-header [data-localizehub-switcher]{grid-column:1;grid-row:1;justify-self:start;margin-left:0!important}',
     '.page.family-opening-mode .site-header .admin-entry{grid-column:2;grid-row:1;justify-self:end;max-width:calc(100vw - 160px);white-space:normal!important;text-align:center;overflow-wrap:break-word}',
     '.page:not(.family-opening-mode) .site-header{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;grid-template-rows:auto auto;align-items:center!important;column-gap:8px!important;row-gap:5px!important;padding-top:calc(18px + env(safe-area-inset-top))!important;padding-left:max(16px,env(safe-area-inset-left))!important;padding-right:max(16px,env(safe-area-inset-right))!important}',
     '.page:not(.family-opening-mode) .site-header .wordmark{grid-column:1/-1;grid-row:1;min-width:0;max-width:100%}',
     '.page:not(.family-opening-mode) .site-header .admin-entry{grid-column:2;grid-row:2;justify-self:end}',
     '.page:not(.family-opening-mode) .site-header [data-localizehub-switcher]{grid-column:1;grid-row:2;justify-self:start;margin-left:0!important}',
     '}'
   ].join('');
   document.head.append(style);
   const header=document.querySelector('.site-header')||document.body;
   header.insertBefore(m,header.querySelector('.admin-entry')||null);
   fallback(m);
   try{
     const response=await fetch(H+'/api/v1/public/projects/'+P+'/locales',{cache:'no-store'});
     if(!response.ok)throw Error('locales HTTP '+response.status);
     const cfg=await response.json();
     if(!L.every(v=>cfg.supportedLocales?.includes(v)))throw Error('p49 locales not configured');
     if(!customElements.get('localize-switcher')){
       await new Promise((ok,fail)=>{
         const s=document.createElement('script');s.src='https://localizehub.suaveforge.com/widget.js';
         s.onload=ok;s.onerror=()=>fail(Error('widget unavailable'));document.head.append(s);
       });
     }
     const el=document.createElement('localize-switcher');
     for(const [a,v] of Object.entries({project:P,api:H,locales:'ko,en,es',type:'dropdown',size:'sm',flags:'true','flag-style':'svg','label-mode':'native','query-param':'lang',navigate:'reload',locale:lang}))el.setAttribute(a,v);
     el.style.setProperty('--lh-switcher-width','118px');
     m.replaceChildren(el);
     decorateLatamSwitcher(el);
     console.info('RAJ_LOCALIZEHUB_SELECTOR_OK=yes project=p49 locales=ko,en,es');
   }catch(e){console.warn('RAJ_LOCALIZEHUB_SELECTOR_FALLBACK',String(e));}
 }
 async function bundle(){
   const r=await fetch(H+'/api/v1/public/projects/'+P+'/bundle?locale='+lang,{cache:'no-store'});
   if(!r.ok)throw Error('bundle HTTP '+r.status);
   const j=await r.json();
   if(j.project!==P||j.locale!==lang||!j.texts)throw Error('bundle contract mismatch');
   return j.texts;
 }
 async function boot(){
   void switcher();
   if(lang==='ko')return;
   let catalog;
   try{
     const r=await fetch('./raj-localizehub-catalog.json?v=20261120-01',{cache:'no-store'});
     if(!r.ok)throw Error('catalog HTTP '+r.status);
     catalog=await r.json();
     if(catalog.project!==P||!Array.isArray(catalog.entries))throw Error('catalog invalid');
   }catch(e){console.warn('RAJ_LOCALIZEHUB_CATALOG_ERROR',String(e));return;}
   let remote=null;
   try{remote=await bundle();}catch(e){console.warn('RAJ_LOCALIZEHUB_BUNDLE_FALLBACK',String(e));}
   catalog.entries.forEach((e,i)=>{
     const value=remote?.['raj.'+String(i+1).padStart(4,'0')]||e[lang];
     if(!e.ko||!value)return;
     words.set(norm(e.ko),value);
     if(e.ko.length>=9)longWords.push([e.ko,value]);
   });
   longWords.sort((a,b)=>b[0].length-a[0].length);
   for(const name of ['alert','confirm']){
     const original=window[name];
     if(typeof original==='function')window[name]=function(message,...args){return original.call(window,translate(message),...args);};
   }
   apply(document.documentElement);
   const observer=new MutationObserver(records=>{
     if(processing)return;
     for(const change of records){
       if(change.type==='characterData'||change.type==='attributes')apply(change.target);
       else for(const node of change.addedNodes)apply(node);
     }
   });
   observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:A});
   console.info('RAJ_LOCALIZEHUB_TRANSLATION_OK=yes project=p49 locale='+lang+' source='+(remote?'hub+fallback':'fallback')+' keys='+words.size);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
 else void boot();
})();
