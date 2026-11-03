/* Shared in-site web receiver, independent of the current home SPA screen.
   The original receive.html remains the single SIP/media implementation.
   A previous, consented device pairing is required; never create credentials.
*/
(() => {
  'use strict';
  const API=String(window.RAJ_CONFIG?.pilotApiBase||'').replace(/\/$/,'');
  if(!API||!('serviceWorker' in navigator)||!('MessageChannel' in window))return;
  const isStandalone=Boolean(navigator.standalone||
    window.matchMedia?.('(display-mode: standalone)')?.matches);
  const isIos=/iPhone|iPad|iPod/i.test(navigator.userAgent);
  let overlay=null,receiver=null,noticeButton=null,currentState='idle',boundToken='';
  const validToken=value=>/^[a-f0-9]{64}$/.test(value||'');

  function openReceiver(){
    if(!overlay)return;
    overlay.style.cssText='position:fixed;inset:0;width:100vw;height:100dvh;'+
      'overflow:hidden;background:#fdfbf7;z-index:2147483000;'+
      'pointer-events:auto;opacity:1;';
    overlay.setAttribute('aria-hidden','false');
  }
  function shrinkReceiver(){
    if(!overlay)return;
    overlay.style.cssText='position:fixed;right:0;bottom:0;'+
      'width:1px;height:1px;overflow:hidden;opacity:0.001;'+
      'z-index:-1;pointer-events:none;';
    overlay.setAttribute('aria-hidden','true');
  }
  async function getStoredReceiverToken(worker){
    return new Promise(resolve=>{
      const channel=new MessageChannel();
      let done=false;
      const finish=token=>{
        if(done)return;
        done=true;
        channel.port1.close();
        resolve(validToken(token)?token:'');
      };
      channel.port1.onmessage=e=>finish(e.data?.token);
      setTimeout(()=>finish(''),4000);
      try{worker.postMessage({type:'RAJ_RECEIVER_GET_TOKEN'},[channel.port2]);}
      catch(_){finish('');}
    });
  }
  function showPairingAction(){
    // iOS copies cookies but not SW IndexedDB during Home Screen install.
    // Pair once inside the installed app, using the existing guardian link.
    if(!isStandalone||document.getElementById('raj-pwa-pair'))return;
    const button=document.createElement('button');
    button.id='raj-pwa-pair';
    button.type='button';
    button.textContent='안부전화 연결';
    button.style.cssText='position:fixed;bottom:max(20px,env(safe-area-inset-bottom));'+
      'right:16px;z-index:10000;background:#24522a;color:#fff;'+
      'border:0;border-radius:12px;padding:16px 20px;font-size:18px;font-weight:700;';
    button.addEventListener('click',()=>{
      const pasted=window.prompt('문자로 받은 안부전화 연결 링크를 붙여넣어 주세요.');
      if(!pasted)return;
      let link;
      try{link=new URL(pasted.trim(),location.href);}catch(_){link=null;}
      const token=link?.hash.slice(1)||'';
      if(link?.origin!==location.origin||link?.pathname!=='/receive.html'||!validToken(token)){
        window.alert('보호자에게 받은 연결 링크를 확인해 주세요.');
        return;
      }
      location.assign('./receive.html#'+token);
    });
    document.body.appendChild(button);
  }
  function installFrame(token){
    overlay=document.createElement('div');
    overlay.id='raj-shared-call-receiver';
    overlay.setAttribute('aria-label','기쁜사이 안부전화');
    shrinkReceiver();
    receiver=document.createElement('iframe');
    receiver.title='기쁜사이 안부전화 수신';
    receiver.src='./receive.html#'+token;
    receiver.setAttribute('allow','microphone; autoplay');
    receiver.style.cssText='display:block;box-sizing:border-box;border:0;'+
      'width:100vw;height:100dvh;background:#fdfbf7;';
    overlay.appendChild(receiver);
    document.body.appendChild(overlay);
  }
  function allowedPush(){
    return 'Notification' in window && 'PushManager' in window &&
      (!isIos||isStandalone);
  }
  function keyBytes(base64){
    const clean=base64.replace(/-/g,'+').replace(/_/g,'/');
    return Uint8Array.from(atob(clean+'='.repeat((4-clean.length%4)%4)),
      c=>c.charCodeAt(0));
  }
  function offerNotificationSetup(token,reg,serverReady){
    if(!allowedPush()||(serverReady&&Notification.permission==='granted'))return;
    noticeButton=document.createElement('button');
    noticeButton.type='button';
    noticeButton.textContent='전화 알림 켜기';
    noticeButton.setAttribute('aria-label','예약 전화 알림 켜기');
    noticeButton.style.cssText='position:fixed;bottom:max(20px,env(safe-area-inset-bottom));'+
      'right:16px;z-index:10000;background:#24522a;color:white;'+
      'border:0;border-radius:12px;padding:16px 20px;font-size:18px;'+
      'font-weight:700;box-shadow:0 3px 12px #0002;';
    noticeButton.addEventListener('click',async()=>{
      // iOS requires the permission prompt to begin inside the real tap.
      const permission=Notification.permission==='default'
        ?Notification.requestPermission():Promise.resolve(Notification.permission);
      noticeButton.disabled=true;
      try{
        if(await permission!=='granted')return;
        const worker=reg.active||navigator.serviceWorker.controller;
        worker?.postMessage({type:'RAJ_RECEIVER_TOKEN',token});
        const resp=await fetch(API+'/api/pilot/receiver/push/public-key',{cache:'no-store'});
        if(!resp.ok)throw Error('PUSH_KEY_ERROR');
        const data=await resp.json();
        let sub=await reg.pushManager.getSubscription();
        if(!sub)sub=await reg.pushManager.subscribe({
          userVisibleOnly:true,applicationServerKey:keyBytes(data.public_key)
        });
        const saved=await fetch(API+'/api/pilot/receiver/push/subscribe',{
          method:'POST',headers:{'Content-Type':'application/json',
            'X-RAJ-RECEIVER-TOKEN':token},
          body:JSON.stringify({subscription:sub.toJSON()})
        });
        if(!saved.ok)throw Error('PUSH_REGISTER_'+saved.status);
        noticeButton.remove();
        noticeButton=null;
      }catch(_){
        noticeButton.textContent='전화 알림 연결 다시 하기';
      }finally{if(noticeButton)noticeButton.disabled=false;}
    });
    document.body.appendChild(noticeButton);
  }
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||!receiver||
      event.source!==receiver.contentWindow)return;
    const data=event.data||{};
    if(data.type==='RAJ_RECEIVER_UI'){
      currentState=data.state;
      if(['ringing','in-call','connecting','consent'].includes(currentState))
        openReceiver();
      else shrinkReceiver();
    }else if(data.type==='RAJ_RECEIVER_CLOSE_REQUEST' &&
      !['ringing','in-call','connecting'].includes(currentState)){
      shrinkReceiver();
    }
  });
  navigator.serviceWorker.addEventListener('message',event=>{
    const data=event.data||{};
    if(data.type!=='RAJ_RECEIVER_OPEN'||!/^ring_[a-f0-9]{32}$/.test(data.ringId||''))return;
    if(receiver){
      openReceiver();
      receiver.contentWindow?.postMessage({type:'RAJ_RECEIVER_SHOW'},location.origin);
    } else {
      location.href='./receive.html'; // Do not fabricate an unpaired receiver.
    }
  });

  async function start(){
    try{
      const reg=await navigator.serviceWorker.register(
        './service-worker.js?v=4-home-bridge',{scope:'/'});
      await navigator.serviceWorker.ready;
      const fromLink=location.hash.slice(1);
      const token=validToken(fromLink)?fromLink:
        await getStoredReceiverToken(reg.active||navigator.serviceWorker.controller);
      if(!validToken(token)){showPairingAction();return;}
      const status=await fetch(API+'/api/pilot/receiver/status',{
        cache:'no-store',headers:{'X-RAJ-RECEIVER-TOKEN':token}
      });
      if(!status.ok){showPairingAction();return;}
      const data=await status.json();
      boundToken=token;
      // A direct, consented homepage link also pairs the installed PWA.
      if(validToken(fromLink)){
        reg.active?.postMessage({type:'RAJ_RECEIVER_TOKEN',token});
        history.replaceState(null,'',location.pathname+location.search);
      }
      installFrame(boundToken);
      if(!data.consent_required)offerNotificationSetup(token,reg,Boolean(data.background_push_ready));
    }catch(_){
      // Never break the regular family/counselor app on a phone setup failure.
    }
  }
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
