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
   for(const [code,label] of [['ko','한국어'],['en','English'],['es','Español']]){
     const option=document.createElement('option');option.value=code;option.textContent=label;select.append(option);
   }
   select.value=lang;
   select.addEventListener('change',()=>change(select.value));
   select.style.cssText='font:600 12px system-ui,sans-serif;border:1px solid #b7c7b9;border-radius:8px;color:#214c35;background:#fff;padding:7px 9px;max-width:118px;min-height:34px';
   m.append(select);
 }
 async function switcher(){
   const m=document.createElement('div');m.dataset.localizehubSwitcher='p49';
   m.style.cssText='position:absolute;top:12px;right:155px;z-index:2147483000;min-width:120px;max-width:140px';
   const style=document.createElement('style');
   style.textContent='@media(max-width:700px){[data-localizehub-switcher]{top:7px!important;right:145px!important;min-width:104px!important;max-width:116px!important}}';
   document.head.append(style);
   (document.querySelector('.site-header')||document.body).append(m);
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
