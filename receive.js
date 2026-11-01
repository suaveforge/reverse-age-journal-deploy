/* Dedicated elder device: fragment-only pairing token, no login or PSTN. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const BASE=String(window.RAJ_CONFIG?.pilotApiBase||'').replace(/\/$/,'');
 const token=location.hash.slice(1)||sessionStorage.getItem('raj.receiver.token')||'';
 let client=null,active=false,polling=false,answered=false,ringId='',sdkPromise=null;
 let lastState='';
 const title=(t,n)=>{$('receiver-title').textContent=t;$('receiver-note').textContent=n||'';};
 const show=(id,yes)=>{$(id).hidden=!yes;};
 const error=t=>{show('receiver-error',!!t);$('receiver-error').textContent=t||'';};
 const pendingMessage=(e)=>String(e?.message||e||'연결 오류').replace(/[<>{}]/g,'');
 async function api(path,options={}){
   const r=await fetch(BASE+'/api/pilot/receiver/'+path,{
      ...options,cache:'no-store',
      headers:{'X-RAJ-RECEIVER-TOKEN':token,...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}
   });
   const data=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(data.detail||'SERVER_'+r.status);
   return data;
 }
 function render(r){
   if(active)return;
   const ring=r.ring;
   document.body.classList.remove('ringing');
   show('receiver-incoming',false);
   show('receiver-connected',false);
   show('receiver-refresh',false);
   if(!ring || ['MISSED','DECLINED','CANCELLED','FAILED'].includes(ring.status)){
     title('전화 기다리는 중','이 화면을 열어두시면 전화가 울립니다.');
     return;
   }
   if(ring.status==='RINGING'){
     if(lastState!==ring.id){lastState=ring.id;ringId=ring.id;}
     document.body.classList.add('ringing');
     title('전화가 왔어요','아래 버튼을 누르면 AI 상담을 시작합니다.');
     show('receiver-incoming',true);
     return;
   }
   if(ring.status==='COMPLETED'){
     title('통화가 끝났어요','대화 기록을 저장했습니다.');
     show('receiver-refresh',true);return;
   }
   if(['CONNECTING','IN_CALL','ENDING'].includes(ring.status)){
     title('통화 기록 확인 중','연결이 끊겼다면 상담사에게 새 통화를 요청하세요.');
     show('receiver-refresh',true);
   }
 }
 async function check(){
   if(polling||active)return;
   polling=true;
   try{
     const s=await api('status');
     if(answered && s.ring?.status==='IN_CALL'){
       await finalize(false);
     } else {render(s);error('');}
   }catch(e){title('연결을 확인해 주세요','링크 또는 네트워크 상태를 확인하세요.');error(pendingMessage(e));show('receiver-refresh',true);}
   finally{polling=false;}
 }
 async function unlock(){
   if(!client||!active)return;
   try{
     if(typeof client.startAudioPlayback==='function')await client.startAudioPlayback();
     title('AI와 통화 중','소리를 켰습니다.');
   }catch(e){error('소리를 켜지 못했습니다: '+pendingMessage(e));}
 }
 async function finalize(force=true){
   if(active)return;
   try{
     const r=await api('result');
     if(r.state==='COMPLETED'){
       title('대화를 저장했어요','상담사가 일기를 검토하면 가족이 볼 수 있습니다.');
       show('receiver-refresh',true);answered=false;
     }else if(r.state==='NO_SPEECH'){
       title('통화 종료','대화 내용이 없어 회기를 차감하지 않았습니다.');
       show('receiver-refresh',true);answered=false;
     }else if(force||answered){
       title('기록 정리 중','대화 기록을 불러오고 있습니다.');
       show('receiver-refresh',true);
     }
   }catch(e){error(pendingMessage(e));show('receiver-refresh',true);}
 }
 async function answer(){
   if(active||!ringId)return;
   const btn=$('receiver-answer');btn.disabled=true;
   error('');
   title('통화 연결 중','마이크 사용을 허용해 주세요.');
   // Capture the actual user gesture early for mobile Safari mic permission.
   try{
     if(navigator.mediaDevices?.getUserMedia){
       const stream=await navigator.mediaDevices.getUserMedia({audio:true});
       stream.getTracks().forEach(t=>t.stop());
     }
     const sdk=await sdkPromise;
     const result=await api('accept',{method:'POST',body:JSON.stringify({id:ringId})});
     answered=true;
     client=new sdk.RetellWebClient();
     client.on('call_started',()=>{active=true;title('AI와 통화 중','편하게 말씀해 주세요.');show('receiver-connected',true);show('receiver-incoming',false);});
     client.on('call_ready',()=>{active=true;title('AI와 통화 중','편하게 말씀해 주세요.');show('receiver-connected',true);show('receiver-incoming',false);});
     client.on('call_ended',()=>{
       active=false;client=null;show('receiver-connected',false);
       title('기록 정리 중','대화를 저장하고 있습니다.');
       finalize();});
     client.on('error',e=>{active=false;show('receiver-connected',false);error('통화 오류: '+pendingMessage(e));finalize();});
     await client.startCall({accessToken:result.access_token});
     active=true;
     title('AI와 통화 중','편하게 말씀해 주세요.');
     show('receiver-connected',true);show('receiver-incoming',false);
   }catch(e){
     active=false;show('receiver-connected',false);show('receiver-incoming',false);
     title('통화 연결 실패','상담사에게 다시 요청해 주세요.');
     error(pendingMessage(e));show('receiver-refresh',true);
   }finally{btn.disabled=false;}
 }
 async function decline(){
   if(!ringId)return;
   try{await api('decline',{method:'POST',body:JSON.stringify({id:ringId})});ringId='';await check();}
   catch(e){error(pendingMessage(e));}
 }
 async function hangup(){
   if(!client)return;
   $('receiver-hangup').disabled=true;
   try{await client.stopCall();}catch(e){error(pendingMessage(e));}
   active=false;client=null;show('receiver-connected',false);
   await finalize();
   $('receiver-hangup').disabled=false;
 }
 $('receiver-answer').addEventListener('click',answer);
 $('receiver-decline').addEventListener('click',decline);
 $('receiver-sound').addEventListener('click',unlock);
 $('receiver-hangup').addEventListener('click',hangup);
 $('receiver-refresh').addEventListener('click',async()=>{await finalize(false);await check();});
 if(!/^[0-9a-f]{64}$/.test(token)){
   title('연결 링크가 필요해요','보호자에게 웹전화 연결 링크를 받아 주세요.');
   show('receiver-refresh',false);
   return;
 }
 sessionStorage.setItem('raj.receiver.token',token);
 // Load SDK before an incoming ring; acceptance is the first billable action.
 sdkPromise=import('https://esm.sh/retell-client-js-sdk@2.0.8');
 sdkPromise.catch(()=>error('음성 연결 구성 요소를 불러오지 못했습니다. 네트워크를 확인해 주세요.'));
 check();
 setInterval(()=>{if(!document.hidden)check();},3500);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
})();
