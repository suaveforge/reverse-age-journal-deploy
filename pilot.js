/* Counselor end-to-end pilot. Requests use a dedicated verified HTTPS high-port API origin.
 * Access code is in JS memory only; no URL, localStorage or console logs.
 * The actual paid call is created only after deliberate consent + confirmation.
 */
(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const PILOT_API = String(window.RAJ_CONFIG?.pilotApiBase || "").replace(/\/$/, "");
  if(!$("pilot-access"))return;
  let operatorCode="";
  let client=null;
  let currentCallId=sessionStorage.getItem("raj.evidence.pilot.call")||"";
  let active=false;
  let audioObjectUrl="";
  let polling=0;
  let noticeTimer=null;

  function status(message,kind=""){
    $("pilot-status").textContent=message;
    $("pilot-status").dataset.kind=kind;
    clearTimeout(noticeTimer);
    if(message && kind==="ok")noticeTimer=setTimeout(()=>{
      if($("pilot-status").textContent===message)$("pilot-status").textContent="";
    },3500);
  }
  function errorMessage(e){
    const d=String(e?.message||e||"").replace(/[<>{}]/g,"");
    const codes={
      "INVALID_EVIDENCE_OPERATOR_CODE":"접근 코드가 맞지 않습니다.",
      "EVIDENCE_CALL_LIMIT":"시험 통화 횟수 제한에 도달했습니다.",
      "TRANSCRIPT_NOT_READY":"아직 대화 내용이 도착하지 않았습니다.",
      "CALL_NOT_ENDED":"통화가 끝난 후 일기를 만들 수 있습니다.",
      "EVIDENCE_UNAVAILABLE":"낌새 Evidence 서버에 연결할 수 없습니다.",
      "EVIDENCE_REQUEST_FAILED":"Evidence 통화 결과를 확인할 수 없습니다.",
      "RECORDING_NOT_AVAILABLE":"녹음이 아직 준비되지 않았습니다.",
      "EVIDENCE_INVALID_CALL_RESPONSE":"통화 생성 응답을 확인할 수 없습니다.",
    };
    for(const [key,desc] of Object.entries(codes))if(d.includes(key))return desc;
    return d||"연결 오류가 발생했습니다.";
  }
  async function api(path,options={}){
    if(!operatorCode)throw Error("운영자 접근 코드를 입력해 주세요.");
    const response=await fetch(PILOT_API+"/api/pilot"+path,{
      ...options,cache:"no-store",
      headers:{"X-RAJ-COUNSELOR-CODE":operatorCode,
        ...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})}
    });
    if(!response.ok){
      const data=await response.json().catch(()=>({}));
      throw Error(data.detail||"API_HTTP_"+response.status);
    }
    return response.status===204?null:response.json();
  }
  function show(node,yes){node.hidden=!yes;}
  function setWorking(working){
    $("pilot-start").disabled=working||!operatorCode||!$("pilot-consent").checked||!window.RAJ_SELECTED_SUBJECT||!window.RAJ_CONSENT_APPROVED||!window.RAJ_CREDITS_AVAILABLE||active;
    $("pilot-stop").disabled=!active;
    $("pilot-unmute").hidden=!active;
    $("pilot-unmute").disabled=!active||!client;
    $("pilot-check").disabled=working||!currentCallId;
    $("pilot-sync").disabled=working||!currentCallId;
    $("pilot-draft").disabled=working||!currentCallId;
  }
  function clearDraft(){
    $("pilot-title").value="";
    $("pilot-body").value="";
    $("pilot-draft-source").textContent="";
    $("pilot-save-consent").checked=false;
    show($("pilot-draft-panel"),false);
  }
  async function verify(){
    const value=$("pilot-access").value.trim();
    if(!value){status("기존 Evidence 운영자 접근 코드를 입력해 주세요.","error");return;}
    $("pilot-verify").disabled=true;
    status("Evidence 연결을 확인하고 있습니다.");
    try {
      operatorCode=value;
      await api("/verify",{method:"POST"});
      $("pilot-access").value="";
      show($("pilot-login"),false);
      show($("pilot-call-panel"),true);
      window.dispatchEvent(new Event("raj:pilot-connected"));
      status("");
      setWorking(false);
      // Diary retrieval can fail independently of successful operator verification.
      // Do not invalidate the verified operator code on a secondary API error.
      await loadDiaries().catch(e=>status("연결됐으나 기존 일기는 조회되지 않았습니다: "+errorMessage(e),"error"));
      if(currentCallId){
        $("pilot-call-id").textContent="최근 통화: "+currentCallId;
        show($("pilot-results"),true);
        await refresh().catch(()=>{});
      }
    }catch(e){
      operatorCode="";
      status(errorMessage(e),"error");
    }finally{
      $("pilot-verify").disabled=false;
    }
  }
  async function createCall(){
    if(!operatorCode||active||!$("pilot-consent").checked)return;
    if(!window.RAJ_SELECTED_SUBJECT){status("통화할 어르신을 먼저 선택해 주세요.","error");return;}
    if(!window.RAJ_CONSENT_APPROVED){status("어르신 통화 동의 확인 후 시작할 수 있습니다.","error");return;}
    if(!window.RAJ_CREDITS_AVAILABLE){status("체험 회기 또는 이용권을 먼저 충전해 주세요.","error");return;}
    if(!window.confirm("동의받은 시험 통화를 시작할까요? 실제 Retell 통화 요금이 발생할 수 있습니다."))return;
    clearDraft();
    currentCallId="";
    setWorking(true);
    $("pilot-call-id").textContent="";
    $("pilot-transcript").replaceChildren();
    show($("pilot-results"),false);
    status("통화를 연결하고 있습니다.");
    try{
      // Load the SDK BEFORE requesting the short-lived billable Retell access token.
      // A failed import must never create a paid call.
      const sdk=await import("https://esm.sh/retell-client-js-sdk@3.0.2");
      const data=await api("/calls",{method:"POST",body:JSON.stringify({consent:true,subject_id:window.RAJ_SELECTED_SUBJECT})});
      currentCallId=data.call_id;
      $("pilot-delete").hidden=false;
      sessionStorage.setItem("raj.evidence.pilot.call",currentCallId);
      $("pilot-call-id").textContent="통화 ID: "+currentCallId;
      show($("pilot-results"),true);
      client=new sdk.RetellWebClient();
      client.on("call_started",()=>{active=true;status("통화 중입니다. 이야기를 나눠 주세요.","ok");setWorking(false);});
      client.on("call_ready",()=>{active=true;status("통화 중입니다. 이야기를 나눠 주세요.","ok");setWorking(false);});
      client.on("call_ended",()=>{
        active=false;
        status("통화가 종료됐습니다. 결과를 불러옵니다.");
        setWorking(false);
        pollResult(0);
      });
      client.on("error",e=>{
        active=false;
        status("통화 연결 오류: "+errorMessage(e),"error");
        setWorking(false);
      });
      await client.startCall({accessToken:data.access_token,callId:data.call_id,transport:data.transport,iceServers:data.ice_servers});
      active=true;
      status("AI 통화 중입니다.","ok");
      setWorking(false);
    }catch(e){
      active=false;
      status("통화 시작 실패: "+errorMessage(e),"error");
      setWorking(false);
    }
  }
  async function stopCall(){
    if(!client)return;
    $("pilot-stop").disabled=true;
    status("통화를 종료하고 있습니다.");
    try{await client.stopCall();}
    catch(e){status("종료 요청 오류: "+errorMessage(e),"error");}
    active=false;
    client=null;
    setWorking(false);
    pollResult(0);
  }
  // iOS browsers may block remote agent audio after asynchronous call creation.
  // This method is invoked directly from the user's own tap (no automatic playback).
  function unlockPlayback(){
    if(!client||!active)return;
    if(typeof client.startAudioPlayback!=="function"){
      status("이 브라우저에서는 스피커 재활성화를 지원하지 않습니다.","error");
      return;
    }
    try{
      Promise.resolve(client.startAudioPlayback())
        .then(()=>status("통화 소리를 켰습니다.","ok"))
        .catch(e=>status("스피커 활성화 오류: "+errorMessage(e),"error"));
    }catch(e){status("스피커 활성화 오류: "+errorMessage(e),"error");}
  }
  function renderTranscript(data){
    const output=$("pilot-transcript");
    output.replaceChildren();
    const turns=Array.isArray(data.transcript_object)?data.transcript_object:[];
    let count=0;
    for(const turn of turns){
      if(!turn||typeof turn!=="object")continue;
      const content=String(turn.content||turn.text||"").trim();
      if(!content)continue;
      const row=document.createElement("div");
      row.className="pilot-turn";
      const who=document.createElement("strong");
      who.textContent=turn.role==="agent"?"AI":"참여자";
      const words=document.createElement("p");
      words.textContent=content;
      row.append(who,words);
      output.append(row);
      count++;
    }
    if(!count){
      const placeholder=document.createElement("p");
      placeholder.className="pilot-empty";
      placeholder.textContent="대화 전문 수신 대기 중";
      output.append(placeholder);
    }
    $("pilot-event").textContent=(Number(data.event_mask||0)&2)?"통화 종료 확인":"통화 결과 수신 중";
    $("pilot-voice").textContent=data.recording_status==="STORED"?"녹음 준비됨":"녹음 확인 대기";
    $("pilot-transcript-count").textContent=count+"개 발화";
    show($("pilot-results"),true);
    return count;
  }
  async function refresh(){
    if(!currentCallId||!operatorCode)return false;
    const data=await api("/calls/"+encodeURIComponent(currentCallId));
    const count=renderTranscript(data);
    if(data.journal_operations){
      const j=data.journal_operations;
      status(j.settlement?.status==="needs_payment_no_charge"?"회기가 부족합니다. 이용권을 확인하세요.":"대화와 회기 상태를 확인했습니다.","ok");
      window.dispatchEvent(new Event("raj:operations-changed"));
    }
    if(data.voice_measurements?.responseDelay){
      const metric=data.voice_measurements.responseDelay;
      $("pilot-voice").textContent=metric.status==="measured"?
        "응답 간격 중앙값 "+Math.round(metric.medianLatencyMs/1000*10)/10+"초 (참고)":"응답 간격 측정 자료 부족";
    }
    return Boolean(count&&(Number(data.event_mask||0)&2));
  }
  async function pollResult(attempt){
    if(!operatorCode||!currentCallId||active)return;
    try{
      const ready=await refresh();
      if(ready){status("통화 결과가 도착했습니다. 일기를 만들어 보세요.","ok");return;}
      if(attempt>=14){status("분석 중입니다. '결과 확인'을 눌러 주세요.");return;}
    }catch(e){if(attempt>=14){status(errorMessage(e),"error");return;}}
    clearTimeout(polling);
    polling=setTimeout(()=>pollResult(attempt+1),4000);
  }
  async function syncCall(){
    if(!currentCallId)return;
    status("Evidence에서 녹음과 대화 내용을 다시 가져옵니다.");
    try{
      await api("/calls/"+encodeURIComponent(currentCallId)+"/sync",{method:"POST"});
      await refresh();
      status("자료 확인을 마쳤습니다.","ok");
    }catch(e){status(errorMessage(e),"error");}
  }
  async function draft(){
    if(!currentCallId)return;
    $("pilot-draft").disabled=true;
    status("실제 대화 기록으로 일기를 준비합니다.");
    try{
      const d=await api("/calls/"+encodeURIComponent(currentCallId)+"/draft",{method:"POST"});
      $("pilot-title").value=d.title||"오늘의 이야기";
      $("pilot-body").value=d.body||"";
      $("pilot-draft-source").textContent=d.source==="retell_ai_summary"?
          "Retell AI 요약을 바탕으로 만든 초안입니다. 저장 전 검토해 주세요.":
          "참여자의 실제 발화를 그대로 모은 초안입니다. 저장 전 정리해 주세요.";
      show($("pilot-draft-panel"),true);
      status("일기 초안이 만들어졌습니다. 검토 후 저장해 주세요.","ok");
      $("pilot-draft-panel").scrollIntoView({behavior:"smooth",block:"start"});
    }catch(e){status(errorMessage(e),"error");}
    finally{$("pilot-draft").disabled=false;}
  }
  async function saveDiary(){
    if(!currentCallId)return;
    if(!$("pilot-save-consent").checked){
      status("일기 저장 동의를 확인해 주세요.","error");return;
    }
    const title=$("pilot-title").value.trim(),body=$("pilot-body").value.trim();
    if(!title||!body){status("제목과 일기를 작성해 주세요.","error");return;}
    $("pilot-save").disabled=true;
    try{
      await api("/calls/"+encodeURIComponent(currentCallId)+"/diary",
        {method:"PUT",body:JSON.stringify({title,body,consent_to_save:true})});
      status("일기가 저장됐습니다. 가족 화면에서 공유된 기록을 확인할 수 있습니다.","ok");
      await loadDiaries();
      window.dispatchEvent(new Event("raj:operations-changed"));
      window.dispatchEvent(new Event("raj:diary-saved"));
    }catch(e){status(errorMessage(e),"error");}
    finally{$("pilot-save").disabled=false;}
  }
  async function loadDiaries(){
    if(!operatorCode)return;
    const data=await api("/diaries");
    const out=$("pilot-diaries");out.replaceChildren();
    const all=data.diaries||[];
    if(!all.length){out.textContent="저장된 일기가 없습니다.";return;}
    for(const entry of all){
      const row=document.createElement("article");row.className="pilot-saved-entry";
      const heading=document.createElement("strong");heading.textContent=entry.title;
      const body=document.createElement("p");body.textContent=entry.body;
      const dates=document.createElement("small");dates.textContent="저장 "+entry.created_at.slice(0,10);
      const buttons=document.createElement("div");buttons.className="pilot-saved-actions";
      const copy=document.createElement("button");copy.type="button";copy.textContent="일기 복사";
      copy.addEventListener("click",async()=>{
        try{await navigator.clipboard.writeText(entry.title+"\n\n"+entry.body);status("일기를 복사했습니다.","ok");}
        catch{status("복사할 수 없습니다.","error");}
      });
      const remove=document.createElement("button");remove.type="button";remove.textContent="삭제";
      remove.addEventListener("click",async()=>{
        if(!confirm("저장한 일기를 삭제할까요?"))return;
        try{await api("/diaries/"+encodeURIComponent(entry.call_id),{method:"DELETE"});
          await loadDiaries();status("일기를 삭제했습니다.","ok");}
        catch(e){status(errorMessage(e),"error");}
      });
      buttons.append(copy,remove);row.append(heading,dates,body,buttons);out.append(row);
    }
  }
  async function loadAudio(){
    if(!currentCallId)return;
    status("녹음을 가져오고 있습니다.");
    try{
      const r=await fetch(PILOT_API+"/api/pilot/calls/"+encodeURIComponent(currentCallId)+"/audio",
          {headers:{"X-RAJ-COUNSELOR-CODE":operatorCode},cache:"no-store"});
      if(!r.ok)throw Error((await r.json().catch(()=>({}))).detail||"RECORDING_NOT_AVAILABLE");
      if(audioObjectUrl)URL.revokeObjectURL(audioObjectUrl);
      audioObjectUrl=URL.createObjectURL(await r.blob());
      $("pilot-audio").src=audioObjectUrl;
      show($("pilot-audio"),true);
      status("녹음이 준비됐습니다.","ok");
    }catch(e){status(errorMessage(e),"error");}
  }
  async function eraseCall(){
    if(!currentCallId||!confirm("Evidence 원본 사본 및 이 사이트의 일기를 삭제할까요? Retell 자체 보관 기록은 별도입니다."))return;
    try{
      await api("/calls/"+encodeURIComponent(currentCallId),{method:"DELETE"});
      currentCallId="";sessionStorage.removeItem("raj.evidence.pilot.call");
      $("pilot-delete").hidden=true;
      $("pilot-call-id").textContent="";
      show($("pilot-results"),false);
      clearDraft();
      if(audioObjectUrl)URL.revokeObjectURL(audioObjectUrl);
      show($("pilot-audio"),false);
      await loadDiaries();
      status("시험 자료를 삭제했습니다.","ok");
    }catch(e){status(errorMessage(e),"error");}
  }
  window.RAJ_IS_CALL_ACTIVE=()=>active;
  window.RAJ_CLOSE_COUNSELOR_SESSION=()=>{
    if(active)return false;
    clearTimeout(polling);
    clearTimeout(noticeTimer);
    operatorCode='';
    currentCallId='';
    client=null;
    sessionStorage.removeItem('raj.evidence.pilot.call');
    $('pilot-access').value='';
    $('pilot-call-id').textContent='';
    $('pilot-diaries').replaceChildren();
    $('pilot-transcript').replaceChildren();
    if(audioObjectUrl){URL.revokeObjectURL(audioObjectUrl);audioObjectUrl='';}
    $('pilot-audio').removeAttribute('src');
    show($('pilot-audio'),false);
    clearDraft();
    show($('pilot-login'),true);
    show($('pilot-call-panel'),false);
    show($('pilot-results'),false);
    show($('pilot-saved'),false);
    show($('pilot-management'),false);
    status('');
    window.RAJ_SELECTED_SUBJECT='';
    window.RAJ_CREDITS_AVAILABLE=false;
    window.RAJ_CONSENT_APPROVED=false;
    window.dispatchEvent(new Event('raj:pilot-disconnected'));
    setWorking(false);
    return true;
  };
  function bind(id,handler){$(id).addEventListener("click",()=>{Promise.resolve(handler()).catch(e=>status(errorMessage(e),"error"));});}
  window.RAJ_OPERATIONS_REQUEST=(path,options)=>api("/operations"+path,options);
  window.RAJ_BILLING_REQUEST=(path,options)=>api("/billing"+path,options);
  $("pilot-delete").hidden=!currentCallId;
  window.RAJ_SELECTED_SUBJECT="";
  window.RAJ_CREDITS_AVAILABLE=false;
  window.RAJ_CONSENT_APPROVED=false;
  window.RAJ_REFRESH_CALL_BUTTON=()=>setWorking(false);
    bind("pilot-verify",verify);
  $("pilot-access").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();verify();}});
  $("pilot-consent").addEventListener("change",()=>setWorking(false));
  bind("pilot-start",createCall);
  bind("pilot-stop",stopCall);
  bind("pilot-unmute",unlockPlayback);
  bind("pilot-check",async()=>{try{const ok=await refresh();status(ok?"통화 종료 및 대화를 확인했습니다.":"통화 결과를 기다리고 있습니다.",ok?"ok":"");}catch(e){status(errorMessage(e),"error");}});
  bind("pilot-sync",syncCall);
  bind("pilot-draft",draft);
  bind("pilot-save",saveDiary);
  bind("pilot-audio-button",loadAudio);
  bind("pilot-delete",eraseCall);
  bind("pilot-refresh-diaries",loadDiaries);
  window.addEventListener("pagehide",()=>{if(audioObjectUrl)URL.revokeObjectURL(audioObjectUrl);});
  show($("pilot-call-panel"),false);
  show($("pilot-results"),false);
  show($("pilot-draft-panel"),false);
  setWorking(false);
})();
