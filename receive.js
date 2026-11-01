/* Elder web receiver: explicit consent, real live-call feedback, no PSTN. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const BASE=String(window.RAJ_CONFIG?.pilotApiBase||'').replace(/\/$/,'');
  const token=location.hash.slice(1)||sessionStorage.getItem('raj.receiver.token')||'';

  let client=null, active=false, polling=false, answered=false, ringId='', sdkPromise=null;
  let lastRingId='', phase='idle', agentSpeaking=false, micMuted=false;
  let durationTimer=0, activityTimer=0, callStartedAt=0, lastVoiceState='', speakerNeedsTap=false;
  let bellContext=null, bellOutput=null, bellTimer=0, bellAllowed=false;
  let sipUA=null,sipRegistered=false,sipSession=null,sipAudio=null,sipStarting=false;
  let sipRetryTimer=0;
  let sipMode='LEGACY',incomingSip=null,pendingSip=null,sipAudioWatch=0,sipAnsweredPosted=false;
  let sipBoundPeers=new WeakSet(),sipConfigurationReady=false;
  let notificationAnswerId=new URLSearchParams(location.search).get('action')==='answer'
    ?new URLSearchParams(location.search).get('ring'):null;
  if(!/^ring_[a-f0-9]{32}$/.test(notificationAnswerId||''))notificationAnswerId=null;
  let homeReturnTimer=0;
  function returnHomeAfterCall(){
    if(homeReturnTimer)return;
    homeReturnTimer=setTimeout(()=>{window.location.replace('./');},1800);
  }
  const bellNotes=new Set();

  // The original ONTALK native/PWA model: one-time permission and persistent
  // OS notifications. SIP/RTP is not kept running in an iOS browser background.
  let pushRegistration=null;
  function pushFeedback(message){
    const area=$('receiver-push-status');
    if(area){area.textContent=message||'';area.hidden=!message;}
  }
  // Background OS push is optional. Foreground SIP web calls work without
  // installing a PWA or granting Notification permission.
  function canUseBackgroundPush(){
    if(!('Notification' in window)||!('serviceWorker' in navigator)||!('PushManager' in window))
      return false;
    if(/iPad|iPhone|iPod/.test(navigator.userAgent))
      return Boolean(window.navigator.standalone || window.matchMedia?.('(display-mode: standalone)')?.matches);
    return true;
  }
  function beginNotificationPermission(){
    if(!canUseBackgroundPush())return Promise.resolve('unsupported');
    if(Notification.permission==='default'){
      try{return Notification.requestPermission();}catch(_){return Promise.resolve('denied');}
    }
    return Promise.resolve(Notification.permission);
  }
  function base64ToBytes(key){
    const clean=key.replace(/-/g,'+').replace(/_/g,'/');
    const raw=atob(clean+'='.repeat((4-clean.length%4)%4));
    return Uint8Array.from(raw,c=>c.charCodeAt(0));
  }
  async function registerBackgroundReceiver(permission){
    if(permission!=='granted'){
      reportSipDiagnostic('PUSH_FAILED',permission||'unknown');
      pushFeedback(permission==='denied'?'잠금화면 알림이 차단되었습니다. 웹전화는 화면을 열어 받을 수 있습니다.':'잠금화면 알림은 선택 기능입니다. 웹전화는 화면을 열어 받을 수 있습니다.');
      return false;
    }
    if(!canUseBackgroundPush()){
      reportSipDiagnostic('PUSH_FAILED','unsupported');
      pushFeedback('잠금화면 알림은 이 브라우저에서 지원되지 않습니다. 웹전화는 계속 이용할 수 있습니다.');
      return false;
    }
    await navigator.serviceWorker.register('./service-worker.js?v=3-ontalk-sip',{scope:'/'});
    const reg=await navigator.serviceWorker.ready;
    pushRegistration=reg;
    const worker=reg.active||reg.waiting||reg.installing;
    if(worker)worker.postMessage({type:'RAJ_RECEIVER_TOKEN',token});
    const response=await fetch(BASE+'/api/pilot/receiver/push/public-key',{cache:'no-store'});
    if(!response.ok)throw Error('수신 알림 설정을 읽지 못했습니다.');
    const conf=await response.json();
    let sub=await reg.pushManager.getSubscription();
    if(!sub)sub=await reg.pushManager.subscribe({
      userVisibleOnly:true,applicationServerKey:base64ToBytes(conf.public_key)
    });
    const saved=await fetch(BASE+'/api/pilot/receiver/push/subscribe',{
      method:'POST',headers:{'X-RAJ-RECEIVER-TOKEN':token,'Content-Type':'application/json'},
      body:JSON.stringify({subscription:sub.toJSON()})
    });
    if(!saved.ok){reportSipDiagnostic('PUSH_FAILED','http_'+saved.status);throw Error('수신 알림 등록에 실패했습니다.');}
    reportSipDiagnostic('PUSH_REGISTERED');
    pushFeedback('');
    return true;
  }
  async function setupExistingPush(){
    // ONTALK parity: keep the service worker available for an already-permitted
    // local incoming-SIP notification even when OS background push is unavailable.
    // Do not require Home Screen installation for a foreground SIP web call.
    if(!('serviceWorker' in navigator))return;
    try{
      await navigator.serviceWorker.register('./service-worker.js?v=3-ontalk-sip',{scope:'/'});
      const reg=await navigator.serviceWorker.ready;
      pushRegistration=reg;
      const active=reg.active||reg.waiting||reg.installing;
      active?.postMessage({type:'RAJ_RECEIVER_TOKEN',token});
      if('Notification' in window&&Notification.permission==='granted')
        await registerBackgroundReceiver('granted');
    }catch(e){
      reportSipDiagnostic('PUSH_FAILED',e?.name||'background');
      pushFeedback('잠금화면 알림 연결 오류: '+messageOf(e));
    }
  }

  const title=(heading,note)=>{
    $('receiver-title').textContent=heading;
    $('receiver-note').textContent=note||'';
  };
  const show=(id,visible)=>{$(id).hidden=!visible;};
  const error=message=>{show('receiver-error',!!message);$('receiver-error').textContent=message||'';};
  const messageOf=e=>String(e?.message||e||'연결 오류').replace(/[<>{}]/g,'');
  let lastSipDiagnostic='';
  function reportSipDiagnostic(state,detail=''){
    const clean=String(detail||'').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,45);
    if(lastSipDiagnostic===state+'|'+clean)return;
    lastSipDiagnostic=state+'|'+clean;
    fetch(BASE+'/api/pilot/receiver/sip/client-state',{
      method:'POST',headers:{'X-RAJ-RECEIVER-TOKEN':token,'Content-Type':'application/json'},
      body:JSON.stringify({state,detail:clean}),cache:'no-store',keepalive:true
    }).catch(()=>{});
  }
  function sipState(message='',retry=false){
    const label=$('receiver-sip-status'),button=$('receiver-reconnect');
    if(label){label.textContent=message;label.hidden=!message;}
    if(button)button.hidden=!retry;
  }
  function queueSipReconnect(){
    if(sipRetryTimer||sipRegistered||active||incomingSip)return;
    sipRetryTimer=setTimeout(()=>{
      sipRetryTimer=0;
      if(!sipRegistered&&!active&&!incomingSip&&!sipStarting)
        initializeAsteriskSip(true).catch(()=>{});
    },5000);
  }
  function maybeAnswerNotification(){
    if(!notificationAnswerId||phase!=='ringing'||ringId!==notificationAnswerId)return;
    notificationAnswerId=null;
    try{history.replaceState(null,'',location.pathname+location.hash);}catch(_){}
    answer();
  }
  function notifySipRinging(){
    if(!document.hidden||!('Notification' in window)||Notification.permission!=='granted'||!pushRegistration)return;
    pushRegistration.showNotification('기쁜사이 전화가 왔어요',{
      body:'AI 안부전화입니다. 전화 받기를 누르세요.',
      tag:'raj-call-'+ringId,renotify:true,requireInteraction:true,silent:false,
      vibrate:[500,180,500,180,900],data:{ring_id:ringId},
      actions:[{action:'answer',title:'전화 받기'},{action:'decline',title:'거절'}]
    }).catch(()=>{});
  }
  function ensureSipAudio(){
    if(!sipAudio){
      sipAudio=document.createElement('audio');
      sipAudio.autoplay=true;sipAudio.playsInline=true;
      sipAudio.setAttribute('playsinline','');
      sipAudio.setAttribute('webkit-playsinline','');
      sipAudio.style.display='none';document.body.appendChild(sipAudio);
    }
    sipAudio.muted=false;sipAudio.volume=1;return sipAudio;
  }
  function primeSipAudio(){
    const audio=ensureSipAudio();
    if(audio.srcObject){playSipAudio(true);return;}
    audio.src='data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==';
    try{
      Promise.resolve(audio.play()).then(()=>{
        if(!audio.srcObject){audio.pause();audio.removeAttribute('src');audio.load();}
      }).catch(()=>{if(!audio.srcObject){audio.removeAttribute('src');audio.load();}});
    }catch(_){}
  }
  function playSipAudio(userInitiated=false){
    const audio=ensureSipAudio();
    if(!audio.srcObject)return Promise.resolve(false);
    let playback;
    try{playback=audio.play();}catch(_){playback=Promise.reject();}
    return Promise.resolve(playback).then(()=>{
      speakerNeedsTap=false;show('receiver-sound',false);return true;
    }).catch(()=>{
      speakerNeedsTap=true;show('receiver-sound',true);
      if(userInitiated)error('상대 음성을 재생하지 못했습니다. 휴대전화 미디어 음량을 확인해 주세요.');
      return false;
    });
  }
  function attachSipStream(stream,track){
    if(!stream&&track&&window.MediaStream)stream=new MediaStream([track]);
    if(!stream)return;
    if(track&&stream.getTracks&&!stream.getTracks().includes(track))stream.addTrack(track);
    const audio=ensureSipAudio();
    if(audio.srcObject!==stream){audio.pause();audio.removeAttribute('src');audio.srcObject=stream;}
    playSipAudio();
  }
  function syncSipReceivers(peer){
    const tracks=peer?.getReceivers?.().map(item=>item?.track)
      .filter(item=>item?.kind==='audio'&&item.readyState!=='ended')||[];
    if(!tracks.length||!window.MediaStream)return;
    const current=sipAudio?.srcObject;
    const stream=current?.getTracks?current:new MediaStream();
    tracks.forEach(track=>{if(!stream.getTracks().includes(track))stream.addTrack(track);});
    attachSipStream(stream);
  }
  function bindSipPeer(peer){
    if(!peer||sipBoundPeers.has(peer))return;
    sipBoundPeers.add(peer);
    peer.addEventListener?.('track',e=>attachSipStream(e.streams?.[0],e.track));
    peer.addEventListener?.('addstream',e=>attachSipStream(e.stream));
    peer.addEventListener?.('connectionstatechange',()=>syncSipReceivers(peer));
    peer.addEventListener?.('iceconnectionstatechange',()=>syncSipReceivers(peer));
    syncSipReceivers(peer);
  }
  function attachSipMedia(session){
    clearInterval(sipAudioWatch);sipAudioWatch=0;sipBoundPeers=new WeakSet();
    ensureSipAudio();
    session.on('peerconnection',e=>bindSipPeer(e.peerconnection||session.connection));
    bindSipPeer(session.connection);
    const started=Date.now();
    sipAudioWatch=setInterval(()=>{
      if(sipSession!==session||Date.now()-started>20000){
        clearInterval(sipAudioWatch);sipAudioWatch=0;return;
      }
      bindSipPeer(session.connection);syncSipReceivers(session.connection);
    },250);
  }
  function clearSipMedia(){
    clearInterval(sipAudioWatch);sipAudioWatch=0;sipBoundPeers=new WeakSet();
    if(sipAudio){try{sipAudio.pause();}catch(_){}
      sipAudio.srcObject=null;sipAudio.removeAttribute('src');sipAudio.remove();sipAudio=null;
    }
    speakerNeedsTap=false;
  }


  // iOS Safari requires an explicit tap to unlock audio. Elder consent is
  // already that gesture; do not demand an additional bell-enable button.
  async function unlockBell(){
    if(!bellContext||bellContext.state==='closed'){
      bellContext=new (window.AudioContext||window.webkitAudioContext)();
      bellOutput=bellContext.createGain();
      bellOutput.gain.value=0.22;
      bellOutput.connect(bellContext.destination);
    }
    await bellContext.resume();
    bellAllowed=bellContext.state==='running';
    if(bellAllowed)show('receiver-alert',false);
    return bellAllowed;
  }
  function playChime(preview=false){
    if(!bellAllowed||!bellContext||bellContext.state!=='running')return;
    if(!preview||phase==='ringing'){
      if(phase!=='ringing')return;
    }
    // A two-pulse incoming ring, not the short 1.3s call-interfering beep.
    // Its output is routed through one gain so Answer can silence it instantly.
    const t=bellContext.currentTime+0.01;
    for(const pulse of [0,0.88]){
      for(const [frequency,offset] of [[659,0],[880,0.08],[1047,0.16]]){
        const osc=bellContext.createOscillator(),volume=bellContext.createGain();
        const begin=t+pulse+offset, end=begin+0.45;
        osc.type='sine';
        osc.frequency.value=frequency;
        volume.gain.setValueAtTime(0.0001,begin);
        volume.gain.exponentialRampToValueAtTime(0.23,begin+0.02);
        volume.gain.exponentialRampToValueAtTime(0.0001,end);
        osc.connect(volume);volume.connect(bellOutput);
        bellNotes.add(osc);
        osc.onended=()=>{bellNotes.delete(osc);osc.disconnect();volume.disconnect();};
        osc.start(begin);osc.stop(end+0.02);
      }
    }
  }
  function stopBell(){
    if(bellTimer){clearInterval(bellTimer);bellTimer=0;}
    // Clearing an interval alone does not cancel already-scheduled oscillators.
    if(bellOutput&&bellContext?.state==='running'){
      const t=bellContext.currentTime;
      bellOutput.gain.cancelScheduledValues(t);
      bellOutput.gain.setValueAtTime(0,t);
    }
    for(const osc of bellNotes){try{osc.stop();}catch{}}
    bellNotes.clear();
    navigator.vibrate?.(0);
    document.body.classList.remove('ringing');
  }
  function beginBell(){
    if(phase!=='ringing'||!bellAllowed||bellTimer)return;
    bellOutput.gain.setValueAtTime(0.22,bellContext.currentTime);
    playChime();
    bellTimer=setInterval(()=>{
      if(phase!=='ringing'){stopBell();return;}
      playChime();
    },3800);
    navigator.vibrate?.([250,120,250]);
  }
  async function enableBell(){
    try{
      const ok=await unlockBell();
      if(!ok)throw Error('오디오가 차단돼 있습니다.');
      if(phase==='ringing')beginBell();
      else{
        bellOutput.gain.setValueAtTime(0.22,bellContext.currentTime);
        playChime(true); // Immediate audible feedback to this button.
      }
    }catch(e){error('벨소리를 켤 수 없습니다. 기기 음량과 브라우저 설정을 확인해 주세요.');}
  }
  async function api(path,options={}){
    const response=await fetch(BASE+'/api/pilot/receiver/'+path,{
      ...options,cache:'no-store',
      headers:{'X-RAJ-RECEIVER-TOKEN':token,
        ...(options.body?{'Content-Type':'application/json'}:{}),
        ...(options.headers||{})}
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.detail||'SERVER_'+response.status);
    return data;
  }

  function meter(id,level){
    const bars=$(id).children;
    const v=Math.max(0,Math.min(1,level||0));
    const shape=[.56,.85,1,.75,.48];
    for(let i=0;i<bars.length;i++){
      const amount=.15+v*shape[i]*.85;
      bars[i].style.transform='scaleY('+amount.toFixed(2)+')';
    }
  }
  function setVoice(agentIsSpeaking,userIsSpeaking,micLevel=0,agentLevel=0){
    if(!active)return;
    const talking=!micMuted&&Boolean(userIsSpeaking);
    const key=[agentIsSpeaking,talking,micMuted].join(':');
    if(lastVoiceState!==key){
      lastVoiceState=key;
      $('voice-ai-status').textContent=agentIsSpeaking?'말하는 중':'듣는 중';
      $('voice-self-status').textContent=micMuted?'마이크 꺼짐':talking?'말하는 중':'듣는 중';
      $('voice-ai').classList.toggle('talking',agentIsSpeaking);
      $('voice-self').classList.toggle('talking',talking);
      $('voice-self').classList.toggle('muted',micMuted);
    }
    meter('voice-self-bars',micMuted?0:micLevel);
    meter('voice-ai-bars',agentIsSpeaking?Math.max(.16,agentLevel):0);
  }
  function updateMicActivity(){
    if(!active||!client)return;
    // LiveKit publishes the same microphone track Retell is already using.
    // Reading its voice-activity stats avoids opening a second microphone.
    const speaker=client.room?.localParticipant;
    const level=typeof speaker?.audioLevel==='number'?speaker.audioLevel:0;
    const talking=!micMuted&&(speaker?.isSpeaking===true||level>0.045);
    setVoice(agentSpeaking,talking,level*4,client.analyzerComponent?.calculateVolume?.()||0);
  }
  function stopCallUI(){
    if(durationTimer){clearInterval(durationTimer);durationTimer=0;}
    if(activityTimer){clearInterval(activityTimer);activityTimer=0;}
    agentSpeaking=false;micMuted=false;lastVoiceState='';
    show('receiver-voice',false);
    show('receiver-footer',true);
    show('receiver-connected',false);
    show('receiver-sound',false);
    show('receiver-signal',true);
    $('receiver-mute').textContent='마이크 끄기';
    $('receiver-mute').setAttribute('aria-pressed','false');
  }
  function startCallUI(){
    stopBell();
    phase='in-call';active=true;
    show('receiver-incoming',false);
    show('receiver-signal',false);
    show('receiver-voice',true);
    show('receiver-footer',false);
    show('receiver-connected',true);
    show('receiver-sound',speakerNeedsTap);
    title('통화 중','');
    if(!callStartedAt)callStartedAt=Date.now();
    const updateDuration=()=>{
      const elapsed=Math.max(0,Math.floor((Date.now()-callStartedAt)/1000));
      $('receiver-duration').textContent=String(Math.floor(elapsed/60)).padStart(2,'0')+':'+String(elapsed%60).padStart(2,'0');
    };
    updateDuration();
    if(!durationTimer)durationTimer=setInterval(updateDuration,1000);
    if(!activityTimer)activityTimer=setInterval(updateMicActivity,120);
    updateMicActivity();
  }
  function render(result){
    const needsConsent=Boolean(result.consent_required);
    const pushReady=Boolean(result.background_push_ready);
    // Optional background push must never gate foreground SIP call reception.
    const pushButton=$('receiver-enable-notifications');
    if(pushButton)pushButton.hidden=needsConsent||pushReady||!canUseBackgroundPush();
    if(!needsConsent&&pushReady)pushFeedback('');
    if(incomingSip||phase==='connecting'||phase==='in-call')return;
    const consentRequired=needsConsent;
    show('receiver-consent-panel',consentRequired);
    if(consentRequired){
      stopBell();phase='idle';stopCallUI();
      show('receiver-alert',false);
      show('receiver-incoming',false);
      title('안부 상담 안내','동의하시면 예약 시간과 이후 3일마다 같은 시간에 웹전화를 받습니다.');
      return;
    }
    const ring=result.ring;
    show('receiver-incoming',false);
    if(ring?.status==='SIP_DIALING'||ring?.status==='SIP_RINGING'){
      if(ring.status==='SIP_RINGING')reportSipDiagnostic('SIP_INVITE_WAIT');
      stopBell();phase='idle';
      show('receiver-alert',false);
      title('AI 전화 연결 중','잠시 후 전화가 울립니다.');
      return;
    }
    if(ring?.status==='RINGING'){
      phase='ringing';ringId=ring.id;
      if(lastRingId!==ring.id)lastRingId=ring.id;
      document.body.classList.add('ringing');
      show('receiver-incoming',true);
      show('receiver-alert',!bellAllowed);
      beginBell();notifySipRinging();
      reportSipDiagnostic(bellAllowed?'WEB_RING_VISIBLE':'WEB_RING_SILENT');
      title('전화가 왔어요','전화 받기를 눌러 주세요.');
      maybeAnswerNotification();
      return;
    }
    stopBell();phase='idle';
    show('receiver-alert',!bellAllowed);
    if(ring?.status==='COMPLETED'){
      show('receiver-alert',false);
      title('통화가 끝났어요','대화 기록이 저장됐습니다.');
    }else if(ring?.status==='NO_SPEECH'){
      show('receiver-alert',false);
      title('통화가 끝났어요','대화 내용이 없어 회기를 차감하지 않았습니다.');
    }else if(ring?.status==='FAILED'){
      show('receiver-alert',false);
      title('통화 연결 실패','통화가 완료되지 않았습니다.');
    }else if(['CONNECTING','IN_CALL','ENDING'].includes(ring?.status)){
      show('receiver-alert',false);
      title('통화 상태 확인 중','기록을 정리하고 있습니다.');
    }else if(result.next_appointment_state==='NEEDS_PAYMENT'){
      title('다음 전화 예약 대기','이용 회기가 없어 아직 전화가 예약되지 않았습니다.');
    }else if(!['WEB_SCHEDULED','WEB_RINGING','WEB_CONNECTING','WEB_CALLING'].includes(result.next_appointment_state)){
      title('예약된 전화가 없어요','보호자에게 예약 상태를 확인해 주세요.');
    }else{
      title('전화 기다리는 중','예약 시간이 되면 AI 전화가 울립니다.');
    }
  }
  async function check(){
    if(polling||active||phase==='connecting'||phase==='in-call')return;
    polling=true;
    try{
      const result=await api('status');
      if(answered&&result.ring?.status==='IN_CALL')await finalize(false);
      else{render(result);error('');}
    }catch(e){
      if(phase!=='ending'){title('연결을 확인해 주세요','네트워크 연결을 확인하세요.');error(messageOf(e));}
    }finally{polling=false;}
  }
  async function finalize(force=true){
    if(active)return;
    try{
      const result=await api('result');
      if(result.state==='COMPLETED'){
        phase='finished';answered=false;
        title('통화가 끝났어요','대화 기록이 저장됐습니다.');
      }else if(result.state==='NO_SPEECH'){
        phase='finished';answered=false;
        title('통화가 끝났어요','대화 내용이 없어 회기를 차감하지 않았습니다.');
      }else if(result.state==='FAILED'){
        phase='finished';answered=false;
        title('통화 연결 실패','통화가 완료되지 않았습니다.');
      }else if(force||answered){
        phase='ending';
        title('기록 정리 중','대화 기록을 저장하고 있습니다.');
      }
    }catch(e){error(messageOf(e));}
  }
  async function unlockSpeaker(){
    if(!client)return;
    try{
      const result=await client.startAudioPlayback();
      if(result===false)throw Error('AUDIO_BLOCKED');
      speakerNeedsTap=false;show('receiver-sound',false);
      error('');
    }catch(e){error('소리를 켤 수 없습니다. 기기 음량을 확인해 주세요.');}
  }
  function endClientCall(){
    if(phase==='ending'&&!client)return;
    stopBell();stopCallUI();active=false;phase='ending';
    client=null;answered=false;
    title('통화가 종료됐어요','메인화면으로 돌아갑니다.');
    // The server continues persisting the diary independently of this page.
    // Do not keep an elder trapped on the call screen while it settles.
    finalize(false);
    returnHomeAfterCall();
  }

  function terminateSip(session,code=486){
    try{session.terminate({status_code:code,reason_phrase:code===486?'Busy Here':'Temporarily Unavailable'});}
    catch(_){try{session.terminate();}catch(__){}}
  }
  async function receiveSipSession(data){
    const session=data?.session;
    if(!session||data.originator!=='remote')return;
    reportSipDiagnostic('SIP_INBOUND_RECEIVED');
    if(incomingSip||pendingSip||active||phase==='connecting'){
      reportSipDiagnostic('SIP_INBOUND_REJECTED','busy');
      terminateSip(session);return;
    }
    pendingSip=session;
    try{
      // ONTALK's normal extension can be dialed by other ONTALK members.
      // Only the journal's active, consent-authorized ring may be shown.
      const status=await api('status');
      if(pendingSip!==session)return;
      const remoteUser=String(session.remote_identity?.uri?.user||'');
      if(status.consent_required||status.ring?.status!=='SIP_RINGING'||remoteUser!=='7777'){
        reportSipDiagnostic('SIP_INBOUND_REJECTED',status.consent_required?'consent':status.ring?.status!=='SIP_RINGING'?'ring_state':'wrong_caller');
        terminateSip(session,480);return;
      }
      incomingSip=session;sipSession=session;ringId=status.ring.id;
      sipAnsweredPosted=false;
      session.on('accepted',()=>sipConnected(session));
      session.on('confirmed',()=>sipConnected(session));
      session.on('ended',()=>sipFinished(session,false));
      session.on('failed',e=>sipFinished(session,true,e?.cause));
      session.on('muted',()=>{micMuted=true;if(active)updateMicActivity();});
      session.on('unmuted',()=>{micMuted=false;if(active)updateMicActivity();});
      attachSipMedia(session);
      phase='ringing';show('receiver-incoming',true);
      reportSipDiagnostic('SIP_INBOUND_RINGING');
      document.body.classList.add('ringing');
      title('전화가 왔어요','전화 받기를 눌러 주세요.');
      beginBell();notifySipRinging();maybeAnswerNotification();
    }catch(e){terminateSip(session,480);error(messageOf(e));}
    finally{if(pendingSip===session)pendingSip=null;}
  }
  function sipConnected(session){
    if(incomingSip!==session||phase==='in-call')return;
    answered=true;callStartedAt=Date.now();sipSession=session;
    syncSipReceivers(session.connection);playSipAudio();
    startCallUI();
    if(!sipAnsweredPosted){
      sipAnsweredPosted=true;
      api('sip/answered',{method:'POST',body:JSON.stringify({id:ringId})})
        .catch(e=>error('연결 상태 저장 오류: '+messageOf(e)));
    }
  }
  function sipFinished(session,failed=false,cause=''){
    if(incomingSip!==session)return;
    incomingSip=null;sipSession=null;clearSipMedia();
    if(!answered&&!active){
      stopBell();phase='idle';show('receiver-incoming',false);
      if(failed)error('SIP 전화 연결 실패: '+String(cause||'연결 실패'));
      check();return;
    }
    client=null;endClientCall();
  }
  async function answerIncomingSip(){
    const session=incomingSip;
    if(!session||phase!=='ringing')return;
    phase='connecting';stopBell();show('receiver-incoming',false);
    title('통화 연결 중','마이크 연결을 준비하고 있습니다.');
    const button=$('receiver-answer');button.disabled=true;
    try{
      primeSipAudio();
      session.answer({
        mediaConstraints:{audio:true,video:false},
        pcConfig:{iceServers:[{urls:'stun:stun.l.google.com:19302'}]}
      });
      client={
        stopCall:async()=>session.terminate(),
        mute:()=>session.mute({audio:true}),
        unmute:()=>session.unmute({audio:true}),
        startAudioPlayback:()=>playSipAudio(true)
      };
      syncSipReceivers(session.connection);
    }catch(e){
      terminateSip(session);sipFinished(session,true,messageOf(e));
      error('통화 연결 실패: '+messageOf(e));
    }finally{button.disabled=false;}
  }
  async function initializeAsteriskSip(force=false){
    if(active||incomingSip||sipStarting)return;
    if(!window.JsSIP){
      sipState('통화 프로그램을 불러오지 못했습니다. 자동 재연결 중입니다.',true);
      reportSipDiagnostic('JS_MISSING');
      queueSipReconnect();
      return;
    }
    if(sipUA&&!force)return;
    if(force&&sipUA){try{sipUA.stop();}catch(_){}sipUA=null;sipRegistered=false;}
    sipStarting=true;sipState('통화 서버 연결 중');reportSipDiagnostic('SETUP_STARTED');
    try{
      const response=await fetch(BASE+'/api/pilot/receiver/sip/setup',{
        method:'POST',headers:{'X-RAJ-RECEIVER-TOKEN':token}
      });
      if(response.status===409){sipState('');reportSipDiagnostic('CONSENT_PENDING');return;}
      if(!response.ok){reportSipDiagnostic('SETUP_HTTP_ERROR',String(response.status));throw Error('SIP_SETTINGS_'+response.status);}
      const cfg=await response.json();
      sipMode=cfg.mode||'LEGACY';
      sipConfigurationReady=Boolean(cfg.ready);
      if(!cfg.ready||!cfg.sip_uri||!cfg.sip_secret){
        sipState('통화 서버 내선 준비 중',true);reportSipDiagnostic('SIP_NOT_PROVISIONED');queueSipReconnect();return;
      }
      const socket=new window.JsSIP.WebSocketInterface(cfg.websocket_url);
      const ua=new window.JsSIP.UA({
        sockets:[socket],uri:cfg.sip_uri,password:cfg.sip_secret,
        register:true,register_expires:120,session_timers:false,display_name:'기쁜사이'
      });
      sipUA=ua;
      reportSipDiagnostic('WS_STARTING');
      const watchdog=setTimeout(()=>{
        if(sipUA===ua&&!sipRegistered){
          reportSipDiagnostic('WS_TIMEOUT');
          sipState('통화 서버 응답이 없습니다. 자동 재연결 중입니다.',true);
          queueSipReconnect();
        }
      },12000);
      const stopWatchdog=()=>clearTimeout(watchdog);
      ua.on('connected',()=>{
        if(sipUA===ua){reportSipDiagnostic('WS_CONNECTED');sipState('통화 서버 등록 중');}
      });
      ua.on('registered',()=>{
        if(sipUA!==ua)return;
        stopWatchdog();sipRegistered=true;reportSipDiagnostic('SIP_REGISTERED');
        if(sipRetryTimer){clearTimeout(sipRetryTimer);sipRetryTimer=0;}
        sipState('');
      });
      ua.on('unregistered',()=>{
        if(sipUA!==ua)return;
        stopWatchdog();sipRegistered=false;reportSipDiagnostic('SIP_UNREGISTERED');
        sipState('통화 서버 연결이 끊겼습니다.',true);queueSipReconnect();
      });
      ua.on('registrationFailed',event=>{
        if(sipUA!==ua)return;
        stopWatchdog();sipRegistered=false;
        reportSipDiagnostic('SIP_REG_FAILED',event?.cause||'unknown');
        sipState('통화 서버 등록에 실패했습니다.',true);queueSipReconnect();
      });
      ua.on('disconnected',event=>{
        if(sipUA!==ua)return;
        stopWatchdog();sipRegistered=false;
        reportSipDiagnostic('WS_DISCONNECTED',event?.cause||event?.code||'unknown');
        sipState('통화 서버 연결이 끊겼습니다.',true);queueSipReconnect();
      });
      ua.on('newRTCSession',receiveSipSession);
      ua.start();
    }catch(e){
      sipRegistered=false;
      reportSipDiagnostic('JS_ERROR',e?.name||'failed');
      sipState('통화 서버 연결 실패: '+messageOf(e),true);
      queueSipReconnect();
    }
    finally{sipStarting=false;}
  }
  async function answerViaAsterisk(){
    if(!sipUA||!sipRegistered||active||!ringId)return false;
    phase='connecting';stopBell();
    const button=$('receiver-answer');
    button.disabled=true;
    show('receiver-incoming',false);
    title('통화 연결 중','AI 상담사에게 연결하고 있습니다.');
    try{
      // Request microphone under a real user gesture before asynchronous APIs.
      const mic=navigator.mediaDevices.getUserMedia({audio:true});
      const response=await fetch(BASE+'/api/pilot/receiver/sip/accept',{
        method:'POST',
        headers:{'X-RAJ-RECEIVER-TOKEN':token,'Content-Type':'application/json'},
        body:JSON.stringify({id:ringId})
      });
      if(!response.ok){
        await mic.then(x=>x.getTracks().forEach(t=>t.stop())).catch(()=>{});
        throw Error('SIP_CALL_REGISTRATION_FAILED_'+response.status);
      }
      const info=await response.json();
      const userMedia=await mic;
      userMedia.getTracks().forEach(t=>t.stop());
      sipAudio=ensureSipAudio();
      primeSipAudio();
      const session=sipUA.call(info.dial_uri,{
        mediaConstraints:{audio:true,video:false},
        pcConfig:{iceServers:[{urls:'stun:stun.l.google.com:19302'}]},
        extraHeaders:['X-RAJ-Call-ID: '+info.call_id]
      });
      sipSession=session;
      client={
        stopCall:async()=>session.terminate(),
        mute:()=>session.mute({audio:true}),
        unmute:()=>session.unmute({audio:true}),
        startAudioPlayback:async()=>sipAudio.play()
      };
      attachSipMedia(session);
      session.on('confirmed',()=>{if(sipSession===session)startCallUI();});
      session.on('accepted',()=>{if(sipSession===session)startCallUI();});
      session.on('ended',()=>{if(sipSession===session){
        sipSession=null;clearSipMedia();endClientCall();
      }});
      session.on('failed',e=>{
        if(sipSession===session){
          sipSession=null;clearSipMedia();
          stopBell();stopCallUI();active=false;phase='idle';client=null;
          title('통화 연결 실패','연결할 수 없습니다.');
          error(String(e?.cause||'SIP 연결 실패'));
        }
      });
      answered=true;
      return true;
    }catch(e){
      stopBell();stopCallUI();phase='idle';active=false;client=null;
      title('통화 연결 실패','잠시 후 다시 시도해 주세요.');
      error(messageOf(e));
      return true;
    }finally{button.disabled=false;}
  }

  async function answer(){
    if(active||phase==='connecting'||!ringId)return;
    if(incomingSip){await answerIncomingSip();return;}
    // No reverse outgoing SIP leg: live AI calls arrive from Asterisk.
    // Only browser WEB fallback may create a new Retell web call on Answer.
    // The very first operation silences the ring. Never restart it in polling.
    phase='connecting';stopBell();
    const button=$('receiver-answer');button.disabled=true;
    show('receiver-incoming',false);
    error('');title('통화 연결 중','마이크 사용을 허용해 주세요.');
    try{
      // Preflight mic permission within the Answer gesture, before network calls.
      if(navigator.mediaDevices?.getUserMedia){
        const stream=await navigator.mediaDevices.getUserMedia({audio:true});
        stream.getTracks().forEach(track=>track.stop());
      }
      const sdk=await sdkPromise;
      const result=await api('accept',{method:'POST',body:JSON.stringify({id:ringId})});
      answered=true;callStartedAt=0;speakerNeedsTap=false;
      const current=new sdk.RetellWebClient();
      client=current;
      current.on('call_started',()=>{if(client===current)startCallUI();});
      current.on('call_ready',async()=>{
        if(client!==current)return;
        try{await current.startAudioPlayback();}
        catch{speakerNeedsTap=true;show('receiver-sound',true);}
      });
      current.on('agent_start_talking',()=>{
        if(client!==current)return;
        agentSpeaking=true;updateMicActivity();
      });
      current.on('agent_stop_talking',()=>{
        if(client!==current)return;
        agentSpeaking=false;updateMicActivity();
      });
      current.on('audio',samples=>{
        if(client!==current||!active||!agentSpeaking||!samples?.length)return;
        // Real agent output samples; no simulated waveform.
        let sum=0;for(let i=0;i<samples.length;i++)sum+=samples[i]*samples[i];
        const rms=Math.sqrt(sum/samples.length);
        meter('voice-ai-bars',Math.min(1,rms*7));
      });
      current.on('call_ended',()=>{
        if(client===current)endClientCall();
      });
      current.on('error',e=>{
        if(client!==current)return;
        stopBell();error('통화 오류: '+messageOf(e));
      });
      await current.startCall({accessToken:result.access_token,emitRawAudioSamples:true});
      if(!active&&phase==='connecting'){
        throw Error('음성 통화가 연결되지 않았습니다.');
      }
    }catch(e){
      stopBell();stopCallUI();active=false;phase='idle';
      title('통화 연결 실패','연결 상태를 확인해 주세요.');
      error(messageOf(e));
    }finally{button.disabled=false;}
  }
  async function decline(){
    phase='idle';stopBell();
    if(incomingSip){const session=incomingSip;incomingSip=null;sipSession=null;
      terminateSip(session);clearSipMedia();}
    if(!ringId)return;
    try{
      await api('decline',{method:'POST',body:JSON.stringify({id:ringId})});
      ringId='';await check();
    }catch(e){error(messageOf(e));}
  }
  async function hangup(){
    if(!client)return;
    $('receiver-hangup').disabled=true;
    stopBell();
    try{await client.stopCall();}catch(e){error(messageOf(e));}
    if(client)endClientCall();
    $('receiver-hangup').disabled=false;
  }
  function toggleMute(){
    if(!client||!active)return;
    try{
      if(micMuted)client.unmute();
      else client.mute();
      micMuted=!micMuted;
      $('receiver-mute').textContent=micMuted?'마이크 켜기':'마이크 끄기';
      $('receiver-mute').setAttribute('aria-pressed',String(micMuted));
      updateMicActivity();
    }catch(e){error(messageOf(e));}
  }
  async function confirmElderConsent(){
    if(!$('receiver-consent-check').checked){
      error('AI 상담과 녹음 안내를 확인해 주세요.');return;
    }
    const button=$('receiver-consent-confirm');button.disabled=true;
    // Start resume() during this user gesture: Safari does not grant it after fetch.
    const unlock=unlockBell().catch(()=>false);
    try{
      await api('consent',{method:'POST',body:JSON.stringify({accept:true})});
      initializeAsteriskSip().catch(()=>{});
      const allowed=await unlock;
      show('receiver-consent-panel',false);
      show('receiver-alert',!allowed);
      error('');await check();
    }catch(e){error(messageOf(e));}
    finally{button.disabled=false;}
  }

  $('receiver-consent-confirm').addEventListener('click',confirmElderConsent);
  $('receiver-enable-notifications')?.addEventListener('click',async()=>{
    // The permission prompt must originate in this physical tap.
    const request=beginNotificationPermission();
    const button=$('receiver-enable-notifications');
    button.disabled=true;
    try{
      const ready=await registerBackgroundReceiver(await request);
      if(ready)await check();
    }catch(e){pushFeedback('알림 연결 실패: '+messageOf(e));}
    finally{button.disabled=false;}
  });
  $('receiver-reconnect').addEventListener('click',()=>initializeAsteriskSip(true));
  $('receiver-alert').addEventListener('click',enableBell);
  $('receiver-answer').addEventListener('click',answer);
  $('receiver-decline').addEventListener('click',decline);
  $('receiver-sound').addEventListener('click',unlockSpeaker);
  $('receiver-mute').addEventListener('click',toggleMute);
  $('receiver-hangup').addEventListener('click',hangup);

  if(!/^[0-9a-f]{64}$/.test(token)){
    title('연결 링크가 필요해요','보호자에게 웹전화 연결 링크를 받아 주세요.');
    show('receiver-alert',false);
    return;
  }
  sessionStorage.setItem('raj.receiver.token',token);
  reportSipDiagnostic('PAGE_LOADED');
  setupExistingPush();
  initializeAsteriskSip();
  navigator.serviceWorker?.addEventListener('message',event=>{
    const d=event.data||{};
    if(d.type==='RAJ_RECEIVER_ANSWER'&&/^ring_[a-f0-9]{32}$/.test(d.ringId||'')){
      notificationAnswerId=d.ringId;maybeAnswerNotification();
    }
  });
  sdkPromise=import('https://esm.sh/retell-client-js-sdk@2.0.8');
  sdkPromise.catch(()=>error('음성 연결 구성 요소를 불러오지 못했습니다. 네트워크를 확인해 주세요.'));
  check();
  setInterval(check,3500);
  function resumeReceiverAfterBackground(){
    if(active||incomingSip||sipStarting||phase==='connecting'||phase==='in-call')return;
    // iOS may suspend a minimized page. Re-check JsSIP when Safari resumes;
    // never tear down a live or incoming call for a background transition.
    if(!sipUA||!sipRegistered||sipUA.isConnected?.()===false||sipUA.isRegistered?.()===false)
      initializeAsteriskSip(true).catch(()=>{});
    check();
  }
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden){
      if(phase==='ringing')beginBell();
      resumeReceiverAfterBackground();
    }
  });
  window.addEventListener('pageshow',resumeReceiverAfterBackground);
  window.addEventListener('online',resumeReceiverAfterBackground);
})();