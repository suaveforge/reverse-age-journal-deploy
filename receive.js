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
  let homeReturnTimer=0;
  function returnHomeAfterCall(){
    if(homeReturnTimer)return;
    homeReturnTimer=setTimeout(()=>{window.location.replace('./');},1800);
  }
  const bellNotes=new Set();

  // The original ONTALK native/PWA model: one-time permission and persistent
  // OS notifications. SIP/RTP is not kept running in an iOS browser background.
  let pushRegistration=null;
  function beginNotificationPermission(){
    if(!('Notification' in window)||!('serviceWorker' in navigator)||!('PushManager' in window))
      return Promise.resolve('unsupported');
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
    if(permission!=='granted'||!('serviceWorker' in navigator)||!('PushManager' in window))return false;
    const reg=pushRegistration||await navigator.serviceWorker.register('./service-worker.js?v=1',{scope:'/'});
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
    if(!saved.ok)throw Error('수신 알림 등록에 실패했습니다.');
    return true;
  }
  async function setupExistingPush(){
    if(!('serviceWorker' in navigator))return;
    try{
      const reg=await navigator.serviceWorker.register('./service-worker.js?v=1',{scope:'/'});
      pushRegistration=reg;
      const active=reg.active||reg.waiting||reg.installing;
      active?.postMessage({type:'RAJ_RECEIVER_TOKEN',token});
      if('Notification' in window&&Notification.permission==='granted')
        await registerBackgroundReceiver('granted');
    }catch(_){ /* The page still supports foreground calls. */ }
  }

  const title=(heading,note)=>{
    $('receiver-title').textContent=heading;
    $('receiver-note').textContent=note||'';
  };
  const show=(id,visible)=>{$(id).hidden=!visible;};
  const error=message=>{show('receiver-error',!!message);$('receiver-error').textContent=message||'';};
  const messageOf=e=>String(e?.message||e||'연결 오류').replace(/[<>{}]/g,'');

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
    const permission=beginNotificationPermission();
    try{
      const ok=await unlockBell();
      registerBackgroundReceiver(await permission).catch(()=>{});
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
    if(phase==='connecting'||phase==='in-call')return;
    const consentRequired=Boolean(result.consent_required);
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
    if(ring?.status==='RINGING'){
      phase='ringing';ringId=ring.id;
      if(lastRingId!==ring.id)lastRingId=ring.id;
      document.body.classList.add('ringing');
      show('receiver-incoming',true);
      show('receiver-alert',!bellAllowed);
      beginBell();
      title('전화가 왔어요','전화 받기를 눌러 주세요.');
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
      title('전화 기다리는 중','예약 시간이 되면 문자로도 전화 알림을 보내드립니다.');
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
      await client.startAudioPlayback();
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
  async function answer(){
    if(active||phase==='connecting'||!ringId)return;
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
    const notificationPermission=beginNotificationPermission();
    const unlock=unlockBell().catch(()=>false);
    try{
      await api('consent',{method:'POST',body:JSON.stringify({accept:true})});
      await registerBackgroundReceiver(await notificationPermission).catch(()=>false);
      const allowed=await unlock;
      show('receiver-consent-panel',false);
      show('receiver-alert',!allowed);
      error('');await check();
    }catch(e){error(messageOf(e));}
    finally{button.disabled=false;}
  }

  $('receiver-consent-confirm').addEventListener('click',confirmElderConsent);
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
  setupExistingPush();
  sdkPromise=import('https://esm.sh/retell-client-js-sdk@2.0.8');
  sdkPromise.catch(()=>error('음성 연결 구성 요소를 불러오지 못했습니다. 네트워크를 확인해 주세요.'));
  check();
  setInterval(check,3500);
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden){
      if(phase==='ringing')beginBell();
      check();
    }
  });
})();