/* Single PWA install + development notification action.
 * Reuses existing receiver service worker; never subscribes without consent.
 */
(() => {
'use strict';
const API=String(window.RAJ_CONFIG?.pilotApiBase||'').replace(/\/$/,'')+'/api/pilot/dev';
let pendingInstall=null,installed=false,prepared=null,readyPush=null,subscribed=false,busy=false;
const ios=()=>/iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone=()=>window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;
const supported=()=>window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
const $=id=>document.getElementById(id);
function toast(text){let el=$('raj-dev-toast');if(!el){el=document.createElement('div');el.id='raj-dev-toast';document.body.append(el);}el.textContent=text;el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,5800);}
function bytes(value){
 const src=value.replace(/-/g,'+').replace(/_/g,'/');
 return Uint8Array.from(atob(src+'='.repeat((4-src.length%4)%4)),c=>c.charCodeAt(0));
}
async function prepare(){
 if(!supported())return null;
 try{
  const [reg,res]=await Promise.all([
   navigator.serviceWorker.register('./service-worker.js',{scope:'/'}).then(()=>navigator.serviceWorker.ready),
   fetch(API+'/push/config',{cache:'no-store'})
  ]);
  if(!res.ok)throw Error('PUSH_CONFIG_'+res.status);
  const j=await res.json();
  return {reg,key:bytes(j.publicKey)};
 }catch(e){prepared=null;return null;}
}
function render(){
 const b=$('raj-app-setup');if(!b)return;
 b.disabled=busy;
 if(!standalone()){
  b.textContent=installed?'앱에서 알림 켜기':'앱 설치·알림';
  b.title=ios()?'Safari 공유 → 홈 화면에 추가 → 앱에서 알림 허용':'앱 설치 후 실행하여 알림을 허용합니다.';
  return;
 }
 if(!supported()){b.textContent='알림 미지원';return;}
 if(Notification.permission==='denied'){b.textContent='알림 차단됨';return;}
 b.textContent=subscribed&&Notification.permission==='granted'?'알림 켜짐':'알림 허용';
 b.title=subscribed?'눌러서 시험 알림을 보냅니다.':'공동개발 채팅·건의 알림을 켜고, 연결된 안부전화 알림도 허용합니다.';
}
function installedEvent(){installed=true;pendingInstall=null;render();}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();pendingInstall=e;render();});
window.addEventListener('appinstalled',installedEvent);
async function onClick(){
 const b=$('raj-app-setup');if(!b||busy)return;
 if(!standalone()){
  if(pendingInstall){
   const prompt=pendingInstall;pendingInstall=null;
   try{
    await prompt.prompt();const result=await prompt.userChoice;
    if(result?.outcome==='accepted'){installed=true;toast('앱 설치가 시작됐습니다. 설치된 앱에서 같은 버튼으로 알림을 허용하세요.');}
    else toast('설치를 취소했습니다.');
   }catch{toast('브라우저 메뉴의 앱 설치를 이용해 주세요.');}
  }else if(ios())toast('Safari 공유(□↑) → 홈 화면에 추가 → 설치된 기쁜사이 실행 → 알림 허용');
  else toast('Chrome/Edge 메뉴(⋮) → 앱 설치 → 설치된 앱에서 알림 허용');
  render();return;
 }
 if(!supported()){toast('이 기기에서는 웹 푸시 알림을 지원하지 않습니다.');return;}
 if(Notification.permission==='denied'){toast('기기 설정 → 알림에서 기쁜사이 알림을 허용하세요.');return;}
 if(subscribed&&Notification.permission==='granted'){
  try{const member=await window.RAJ_DEV_SESSION?.();
   if(!member)throw Error('참여자 세션 없음');
   const token=localStorage.getItem('raj.dev.community.token.v1');
   const response=await fetch(API+'/push/test',{method:'POST',headers:{'X-RAJ-DEV-TOKEN':token||''}});
   if(!response.ok)throw Error('HTTP '+response.status);
   toast('시험 알림을 서버에 요청했습니다. 실제 수신은 기기에서 확인하세요.');
  }catch(e){toast('시험 알림 요청 실패 · '+e.message);}
  return;
 }
 // iPhone Home Screen PWAs require PushManager.subscribe() directly inside
 // the user's click activation, before the first await (same as OptionTrade).
 if(!readyPush){
  if(!prepared)prepared=prepare();
  Promise.resolve(prepared).then(value=>{readyPush=value;}).catch(()=>{});
  toast('알림 연결을 준비하고 있습니다. 준비 후 버튼을 다시 눌러주세요.');
  return;
 }
 let pendingSubscription;
 try{
  pendingSubscription=readyPush.reg.pushManager.subscribe({
   userVisibleOnly:true,applicationServerKey:readyPush.key
  });
 }catch(e){toast('알림 권한 요청 실패 · '+(e.message||e));return;}
 busy=true;render();
 try{
  const subscription=await pendingSubscription;
  if(Notification.permission!=='granted')throw Error('알림 허용이 필요합니다');
  await window.RAJ_DEV_SESSION?.();
  const token=localStorage.getItem('raj.dev.community.token.v1')||'';
  const response=await fetch(API+'/push/subscribe',{method:'POST',
   headers:{'X-RAJ-DEV-TOKEN':token,'Content-Type':'application/json'},
   body:JSON.stringify(subscription.toJSON())});
  if(!response.ok)throw Error('구독 등록 HTTP '+response.status);
  subscribed=true;
  // A paired elder receiver must retain its separate, consent-based enrollment.
  if(typeof window.RAJ_ENABLE_RECEIVER_PUSH==='function'){
   try{await window.RAJ_ENABLE_RECEIVER_PUSH();}catch{}
  }
  toast('공동개발 알림을 켰습니다.');
 }catch(e){toast('알림 설정 실패 · '+(e.message||e));}
 finally{busy=false;render();}
}
function start(){
 const b=$('raj-app-setup');if(!b)return;
 b.removeEventListener('click',onClick);b.addEventListener('click',onClick);
 if(supported()){
  prepared=prepare();
  Promise.resolve(prepared).then(value=>{readyPush=value;}).catch(()=>{});
 }
 render();
 if(standalone()&&Notification.permission==='granted'&&supported()){
  Promise.resolve(prepared).then(async obj=>{
   if(!obj)return;
   const sub=await obj.reg.pushManager.getSubscription();
   if(!sub)return;
   await window.RAJ_DEV_SESSION?.();
   const token=localStorage.getItem('raj.dev.community.token.v1')||'';
   const r=await fetch(API+'/push/subscribe',{method:'POST',headers:{'X-RAJ-DEV-TOKEN':token,'Content-Type':'application/json'},body:JSON.stringify(sub.toJSON())});
   subscribed=r.ok;render();
  }).catch(()=>{});
 }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
else start();
})();
