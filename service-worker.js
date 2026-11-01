/* Reverse Journal standalone receiver: background incoming-call notifications.
   Adapted from SuaveForge ONTALK's tested lock-screen notification flow.
   The actual call is created only after the elder presses Answer in receive.js.
*/
'use strict';
const DB_NAME='raj-receiver-push-v1',STORE='capabilities',KEY='receiver';
const API='https://api-reverse-age-journal.suaveforge.com:18461';
function store(dbkey,value){
 return new Promise((resolve,reject)=>{
   const open=indexedDB.open(DB_NAME,1);
   open.onupgradeneeded=()=>{if(!open.result.objectStoreNames.contains(STORE))open.result.createObjectStore(STORE);};
   open.onerror=()=>reject(open.error);
   open.onsuccess=()=>{
     const db=open.result,tx=db.transaction(STORE,'readwrite');
     tx.objectStore(STORE).put(value,dbkey);
     tx.oncomplete=()=>{db.close();resolve();};
     tx.onerror=()=>{db.close();reject(tx.error);};
   };
 });
}
function read(dbkey){
 return new Promise((resolve,reject)=>{
   const open=indexedDB.open(DB_NAME,1);
   open.onupgradeneeded=()=>{if(!open.result.objectStoreNames.contains(STORE))open.result.createObjectStore(STORE);};
   open.onerror=()=>reject(open.error);
   open.onsuccess=()=>{
     const db=open.result,tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).get(dbkey);
     req.onsuccess=()=>{const value=req.result;db.close();resolve(value);};
     req.onerror=()=>{db.close();reject(req.error);};
   };
 });
}
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('message',e=>{
  const d=e.data||{};
  if(d.type==='RAJ_RECEIVER_TOKEN'&&/^[a-f0-9]{64}$/.test(String(d.token||'')))
    e.waitUntil(store(KEY,d.token));
});
self.addEventListener('push',e=>{
 e.waitUntil((async()=>{
   const token=await read(KEY);
   if(!token)return;
   let payload={};
   try{payload=e.data?.json()||{};}catch(_){return;}
   if(payload.type!=='incoming-web-call'||!/^ring_[a-f0-9]{32}$/.test(payload.ring_id||''))return;
   const resp=await fetch(API+'/api/pilot/receiver/status',{
     headers:{'X-RAJ-RECEIVER-TOKEN':token},cache:'no-store'
   }).catch(()=>null);
   if(!resp?.ok)return;
   const state=await resp.json();
   if(state.ring?.id!==payload.ring_id||state.ring?.status!=='RINGING')return;
   const url='/receive.html#'+token;
   await self.registration.showNotification('기쁜사이 전화가 왔어요',{
     body:'AI 안부전화입니다. 전화 받기를 누르세요.',
     tag:'raj-call-'+payload.ring_id,
     renotify:true,
     requireInteraction:true,
     silent:false,
     vibrate:[500,150,500,150,800],
     data:{url,ring_id:payload.ring_id},
     actions:[{action:'answer',title:'전화 받기'},{action:'decline',title:'거절'}]
   });
 })());
});
self.addEventListener('notificationclick',e=>{
 e.notification.close();
 const data=e.notification.data||{};
 e.waitUntil((async()=>{
  const token=await read(KEY);
  if(!token)return;
  if(e.action==='decline'&&/^ring_[a-f0-9]{32}$/.test(data.ring_id||'')){
   await fetch(API+'/api/pilot/receiver/decline',{
    method:'POST',headers:{'X-RAJ-RECEIVER-TOKEN':token,'Content-Type':'application/json'},
    body:JSON.stringify({id:data.ring_id})
   }).catch(()=>{});
   return;
  }
  const url='/receive.html#'+token;
  const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
  for(const w of windows){
    if(new URL(w.url).origin===self.location.origin){
     if('navigate' in w){try{await w.navigate(url);}catch(_){}}
     if('focus' in w)await w.focus();
     return;
    }
  }
  await clients.openWindow(url);
 })());
});
