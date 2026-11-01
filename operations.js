(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  if(!$('pilot-management'))return;
  let selected='';
  let subjects=[];
  let lastReport='';
  let loading=false;
  let activeTab='info';
  let creating=false;
  let authorized=false;
  let hasOutbox=false;
  let noticeTimer=null;
  let previousRecurringConsent=false;
  let previousParticipantConsent=false;
  let previousSharingConsent=false;
  let guardianSharingRequested=false;
  const ticketLabels={TRIAL:'체험 충전',PURCHASE:'구매',COMPLETED_CALL:'통화 사용'};
  function switchTab(tab){
    if(!subjects.length && tab!=='info')tab='info';
    activeTab=tab;
    document.querySelector('.ops-tabs').hidden=!subjects.length;
    $('ops-outbox-panel').hidden=tab!=='record'||!hasOutbox;
    if($('pilot-status').dataset.kind==='ok')$('pilot-status').textContent='';
    for(const button of document.querySelectorAll('[data-ops-tab]')){
      const yes=button.dataset.opsTab===tab;
      button.classList.toggle('active',yes);
      if(yes)button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    }
    for(const panel of document.querySelectorAll('[data-ops-panel]')){
      panel.hidden=panel.dataset.opsPanel!==tab;
    }
    $('ops-create-panel').hidden=tab!=='info'||!(creating||!subjects.length);
    $('ops-profile-panel').hidden=tab!=='info'||!selected;
    $('ops-profile-details').hidden=tab!=='info'||!selected;
    $('ops-subject-panel').hidden=tab!=='info';
    $('ops-call-context').hidden=tab!=='call';
    $('pilot-call-panel').hidden=!authorized||tab!=='call';
    for(const id of ['pilot-results','pilot-draft-panel']){
      $(id).classList.toggle('ops-away',tab!=='call');
    }
    $('pilot-saved').hidden=!authorized||tab!=='record';
    $('pilot-saved').classList.toggle('ops-away',tab!=='record');
    $('ops-new-person').hidden=tab!=='info'||!subjects.length;
    $('ops-outbox-panel').hidden=tab!=='record'||!hasOutbox;
  }
  function renderCreditHistory(data){
    const target=$('ops-ticket-history');
    target.replaceChildren();
    if(!data||!data.credit_history||!data.credit_history.length){
      target.textContent='이용 내역 없음';return;
    }
    for(const entry of data.credit_history){
      const el=document.createElement('div');el.className='ops-entry';
      const label=document.createElement('strong');
      label.textContent=ticketLabels[entry.kind]||entry.kind;
      const amount=document.createElement('strong');
      amount.textContent=(entry.delta>0?'+':'')+entry.delta+'회';
      const date=document.createElement('small');
      date.textContent=String(entry.created_at||'').slice(0,10);
      el.append(label,amount,date);
      target.append(el);
    }
  }
  function showProfile(data){
    if(!data?.subject)return;
    const person=data.subject;
    $('ops-consent-status').hidden=false;
    $('ops-consent-status').textContent=person.participant_consent ? '통화 동의 확인됨' : '어르신 통화 동의 확인 필요';
    $('ops-consent-status').dataset.kind=person.participant_consent?'confirmed':'pending';
    previousRecurringConsent=Boolean(person.recurring_consent);
    previousParticipantConsent=Boolean(person.participant_consent);
    previousSharingConsent=Boolean(person.family_notifications_consent);
    guardianSharingRequested=Boolean(person.guardian_sharing_requested);
    const pendingShare=guardianSharingRequested&&!previousSharingConsent;
    $('ops-confirm-consent').hidden=previousParticipantConsent&&!pendingShare;
    $('ops-confirm-consent').textContent=previousParticipantConsent?'가족 공유 동의 확인':'통화 동의 확인';
    const dial=$('ops-consent-dial');
    const phone=String(person.phone||'').trim();
    const pending=!person.participant_consent;
    dial.hidden=!pending||!/^\+?[0-9]{9,16}$/.test(phone);
    dial.href=dial.hidden?'#':'tel:'+phone;
    dial.textContent='어르신께 전화하기';
    $('ops-edit-name').value=person.name||'';
    $('ops-edit-phone').value=person.phone||'';
    $('ops-edit-family').value=person.family_phone||'';
    $('ops-edit-consent').checked=Boolean(person.participant_consent);
    $('ops-edit-recurring').checked=Boolean(person.recurring_consent);
    $('ops-edit-family-consent').checked=Boolean(person.family_notifications_consent);
    $('ops-followup-days').value=String(person.followup_days||3);
    $('ops-retry-limit').value=String(person.retry_limit||3);
    $('ops-preferred-hour').value=String(person.preferred_hour??14);
    renderCreditHistory(data);
  }
  async function saveProfile(){
    if(!selected){feedback('어르신을 선택해 주세요.',true);return;}
    const name=$('ops-edit-name').value.trim();
    if(!name){feedback('이름을 입력해 주세요.',true);return;}
    const participant=$('ops-edit-consent').checked;
    const repeat=$('ops-edit-recurring').checked;
    if(repeat&&!participant){feedback('통화 동의가 필요합니다.',true);return;}
    if(participant&&!previousParticipantConsent&&
       !confirm('어르신에게 직접 AI 통화·녹음·기록 동의를 확인하셨습니까?'))return;
    if(repeat&&!previousRecurringConsent&&
       !confirm('어르신에게 별도로 정기 전화 및 재통화 동의를 확인하셨습니까?'))return;
    if($('ops-edit-family-consent').checked&&!previousSharingConsent&&
       !confirm('어르신이 가족에게 일기를 공유하는 데 동의하셨습니까?'))return;
    if(!repeat&&previousRecurringConsent&&!confirm('자동 재통화를 끄면 예정된 자동 예약이 취소됩니다. 저장할까요?'))return;
    $('ops-save-profile').disabled=true;
    try{
      await request('/subjects/'+encodeURIComponent(selected),{
        method:'PATCH',body:JSON.stringify({
          name,phone:$('ops-edit-phone').value.trim()||null,
          family_phone:$('ops-edit-family').value.trim()||null,
          participant_consent:participant,
          recurring_consent:repeat,
          family_notifications_consent:$('ops-edit-family-consent').checked,
          followup_days:Number($('ops-followup-days').value),
          retry_limit:Number($('ops-retry-limit').value),
          preferred_hour:Number($('ops-preferred-hour').value)
        })
      });
      await loadSubjects();
      feedback('저장 완료');
    }finally{$('ops-save-profile').disabled=false;}
  }
  async function confirmConsent(){
    if(!selected){feedback('어르신을 먼저 선택해 주세요.',true);return;}
    if(!previousParticipantConsent&&
       !confirm('어르신의 AI 통화·녹음·기록 동의를 직접 확인하셨습니까?'))return;
    let share=false;
    if(guardianSharingRequested&&!previousSharingConsent){
      share=confirm('어르신이 상담 일기를 보호자에게 공유하는 데에도 동의하셨습니까?');
    }
    $('ops-confirm-consent').disabled=true;
    try{
      const result=await request('/subjects/'+encodeURIComponent(selected)+'/confirm-consent',{
        method:'POST',body:JSON.stringify({share_with_family:share})
      });
      await loadSubjects();
      feedback(result.share_approved?'통화·가족 공유 승인 완료':'통화 동의 확인 완료');
      if(result.consent_confirmed&&result.balance>0){
        switchTab('call');
        $('pilot-consent').scrollIntoView({behavior:'smooth',block:'center'});
      }
    }finally{$('ops-confirm-consent').disabled=false;}
  }
  const request=(path,options)=>window.RAJ_OPERATIONS_REQUEST(path,options);
  function feedback(message,bad=false){
    const el=$('pilot-status');el.textContent=message;el.dataset.kind=bad?'error':'ok';
    clearTimeout(noticeTimer);
    if(message)noticeTimer=setTimeout(()=>{if(el.textContent===message)el.textContent='';},bad?6500:3500);
  }
  async function safe(promise){
    try{return await (typeof promise==='function'?promise():promise)}catch(e){
      feedback(String(e.message||e).replace(/[<>]/g,''),true);
      return null;
    }
  }
  function text(id,value){$(id).textContent=String(value??'');}
  function formatTime(value){
    const dt=new Date(value);
    return isNaN(dt.getTime())?String(value):new Intl.DateTimeFormat('ko-KR',{
      timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
      hour12:false}).format(dt);
  }
  function addEntry(parent,parts){
    const el=document.createElement('div');el.className='ops-entry';
    for(const part of parts){
      const node=document.createElement(part.tag||'span');
      node.textContent=String(part.text||'');
      if(part.cls)node.className=part.cls;
      el.append(node);
    }
    parent.append(el);
    return el;
  }
  async function loadSubjects(){
    const data=await request('/subjects');
    subjects=data.subjects||[];
    const picker=$('pilot-subject-select');
    picker.replaceChildren();
    const blank=document.createElement('option');
    blank.textContent='어르신 선택';blank.value='';picker.append(blank);
    for(const s of subjects){const option=document.createElement('option');
      option.value=s.id;option.textContent=s.name+(s.consent_confirmed?'':' · 동의 대기');picker.append(option);}
    if(!subjects.some(x=>x.id===selected))selected=subjects[0]?.id||'';
    picker.value=selected;
    if(!selected)creating=true;
    window.RAJ_SELECTED_SUBJECT=selected;
    await showSubject();
    switchTab(activeTab);
    if(activeTab==='call')await webRingStatus().catch(()=>{});
  }
  async function showSubject(){
    window.RAJ_SELECTED_SUBJECT=selected;
    window.RAJ_CREDITS_AVAILABLE=false;
    window.RAJ_CONSENT_APPROVED=false;
    window.RAJ_REFRESH_CALL_BUTTON?.();
    text('ops-credit','잔여 회기 —');
    text('ops-stage','첫 통화 안내');
    text('ops-script','어르신을 선택하면 대화 안내가 나타납니다.');
    text('ops-previous','');
    $('ops-appointments').replaceChildren();
    if(!selected){$('ops-consent-status').hidden=true;$('ops-consent-dial').hidden=true;$('ops-confirm-consent').hidden=true;window.RAJ_CONSENT_APPROVED=false;return;}
    const info=await request('/subjects/'+encodeURIComponent(selected));
    showProfile(info);
    const trials=(info.credit_history||[]).filter(x=>x.kind==='TRIAL')
      .reduce((total,x)=>total+Number(x.delta||0),0);
    $('ops-trial').hidden=trials>=3;
    text('ops-credit','잔여 회기 '+info.balance+'회');
    window.RAJ_CREDITS_AVAILABLE=info.balance>0;
    window.RAJ_CONSENT_APPROVED=Boolean(info.subject?.participant_consent);
    window.RAJ_REFRESH_CALL_BUTTON?.();
    const script=info.script||{};
    text('ops-stage',script.stage==='RETURN'?'재통화 안내':'첫 통화 안내');
    text('ops-script',script.prompt||'');
    text('ops-previous',script.prior_story||'');
    const target=$('ops-appointments');
    const a=(info.appointments||[]);
    if(!a.length){target.textContent='예약 없음';return;}
    for(const item of a.slice(0,8)){
      const entry=addEntry(target,[
        {text:formatTime(item.due_at),cls:'ops-entry-date'},
        {text:({SCHEDULED:'예약됨',WAITING_GATEWAY:'전화 연동 대기',
          NEEDS_PAYMENT:'회기 충전 필요',CALLING:'통화 중',
          RETRY_WAIT:'재시도 예약',COMPLETED:'완료',
          MISSED:'부재 종료',CANCELLED:'취소됨',
          REVIEW_REQUIRED:'운영자 확인 필요'})[item.state]||item.state,cls:'ops-entry-state'}
      ]);
      if(['SCHEDULED','WAITING_GATEWAY','RETRY_WAIT','NEEDS_PAYMENT'].includes(item.state)){
        const button=document.createElement('button');
        button.textContent='취소';button.type='button';button.className='ops-small-button';
        button.addEventListener('click',()=>safe(async()=>{
          await request('/bookings/'+encodeURIComponent(item.id)+'/cancel',{method:'POST'});
          await showSubject();
          feedback('예약을 취소했습니다.');
        }));
        entry.append(button);
      }
    }
  }
  async function addSubject(){
    if(loading)return;
    const name=$('ops-name').value.trim(),phone=$('ops-phone').value.trim(),
      family=$('ops-family-phone').value.trim();
    if(!name){feedback('어르신 이름을 입력해 주세요.',true);return;}
    if(!$('ops-consent').checked){feedback('어르신 동의가 필요합니다.',true);return;}
    loading=true;$('ops-add').disabled=true;
    try{
      const data=await request('/subjects',{method:'POST',body:JSON.stringify({
        name,phone:phone||null,family_phone:family||null,participant_consent:true,
        family_notifications_consent:$('ops-family-consent').checked,
        recurring_consent:$('ops-recurring-consent').checked
      })});
      selected=data.id;
      for(const id of ['ops-name','ops-phone','ops-family-phone'])$(id).value='';
      $('ops-consent').checked=false;
      $('ops-family-consent').checked=false;
      $('ops-recurring-consent').checked=false;
      creating=false;
      await loadSubjects();
      switchTab('info');
      feedback('등록했습니다. 이용권을 확인하세요.');
    }finally{loading=false;$('ops-add').disabled=false;}
  }
  async function trial(){
    if(!selected){feedback('어르신을 먼저 선택해 주세요.',true);return;}
    const info=await request('/trial-credits',{method:'POST',
      body:JSON.stringify({subject_id:selected,count:3,reason:'COUNSELOR_TRIAL'})});
    await loadSubjects();
    feedback('체험 3회 충전 완료');
  }
  async function book(){
    if(!selected){feedback('어르신을 먼저 선택해 주세요.',true);return;}
    const value=$('ops-date').value;
    if(!value){feedback('예약 날짜를 입력해 주세요.',true);return;}
    const dt=new Date(value);
    if(isNaN(dt.getTime())){feedback('예약 시간을 확인해 주세요.',true);return;}
    const booking=await request('/bookings',{method:'POST',body:JSON.stringify({
      subject_id:selected,scheduled_at:dt.toISOString()
    })});
    await showSubject();
    feedback(booking.automatic_phone_delivery_enabled?
      '통화 예약이 등록됐습니다.':'예약이 등록됐습니다. 전화 자동 발신은 연동 대기 중입니다.');
  }
  async function report(){
    if(!selected){feedback('어르신을 먼저 선택해 주세요.',true);return;}
    const m=$('ops-report-month').value;
    const data=await request('/subjects/'+encodeURIComponent(selected)+'/monthly-report?month='+encodeURIComponent(m));
    const lines=[
      data.month+' 가족 이야기 기록',
      '어르신: '+data.name,
      '완료한 통화: '+data.calls_completed+'회',
      '남긴 일기: '+data.diaries_saved+'건',
      '남은 회기: '+data.credits_remaining+'회',
      ''
    ];
    for(const item of data.stories||[])lines.push(item.title+'\n'+item.excerpt+'\n');
    lines.push('상담·대화 기록을 정리한 보고서이며 의료적 판정이나 진단 결과는 포함하지 않습니다.');
    lastReport=lines.join('\n');
    $('ops-report-output').value=lastReport;
    $('ops-report-output').hidden=false;
    $('ops-report-copy').hidden=false;
    feedback('월간 가족 보고서를 만들었습니다.');
  }
  async function outbox(){
    const data=await request('/outbox');
    const el=$('ops-outbox');el.replaceChildren();
    hasOutbox=Boolean(data.messages?.length);
    $('ops-outbox-panel').hidden=activeTab!=='record'||!hasOutbox;
    if(!hasOutbox){return;}
    for(const msg of data.messages.slice(0,25)){
      const card=document.createElement('div');card.className='ops-message';
      const title=document.createElement('strong');
      title.textContent=msg.kind==='PAYMENT_REMINDER'?'이용권 충전 안내':msg.kind==='MISSED'?'부재 안내':'알림';
      const body=document.createElement('p');body.textContent=msg.content;
      const action=document.createElement('button');action.textContent='안내 내용 복사';
      action.type='button';action.className='ops-small-button';
      action.addEventListener('click',()=>safe(async()=>{
        await navigator.clipboard.writeText((msg.recipient_phone||'')+'\n'+msg.content);
        feedback('안내 내용이 복사됐습니다.');
      }));
      card.append(title,body,action);el.append(card);
    }
  }
  async function reload(){
    await loadSubjects();
    await outbox();
  }
  let billingReady=false;
  const billing=(path,options)=>window.RAJ_BILLING_REQUEST(path,options);
  async function loadBilling(){
    const data=await billing('/packages');
    billingReady=data.payhub_ready===true;
    $('ops-payhub-status').textContent=billingReady?
      'PayHub 연결됨. 상품 금액을 확인한 뒤 결제 링크를 생성할 수 있습니다.':
      'PayHub 운영 프로젝트가 아직 연결되지 않았습니다. 결제 링크는 비활성화되어 있습니다.';
    $('ops-pay-checkout').disabled=!billingReady;
    $('ops-payhub-status').hidden=!billingReady;
    document.querySelectorAll('[data-payhub-action]').forEach(el=>{el.hidden=!billingReady;});
    const item=(data.packages||[]).find(x=>x.package_code===$('ops-pay-package').value);
    $('ops-pay-price').value=item?String(item.price_krw):'';
    $('ops-pay-active').value=item&&item.active?'true':'false';
  }
  async function savePackage(){
    const amount=Number($('ops-pay-price').value);
    if(!Number.isSafeInteger(amount)||amount<100||amount>10000000){
      feedback('정확한 판매 가격을 입력해 주세요.',true);return;
    }
    await billing('/packages',{method:'PUT',body:JSON.stringify({
      package_code:$('ops-pay-package').value,price_krw:amount,
      active:$('ops-pay-active').value==='true'
    })});
    await loadBilling();
    feedback('상품을 저장했습니다. PayHub 연결 전에는 실제 결제를 받을 수 없습니다.');
  }
  async function createCheckout(){
    if(!selected){feedback('어르신을 먼저 선택해 주세요.',true);return;}
    if(!billingReady){feedback('PayHub 운영 연결이 필요합니다.',true);return;}
    if(!confirm('표시된 금액으로 실제 결제 링크를 만들까요?'))return;
    const result=await billing('/checkout',{method:'POST',body:JSON.stringify({
      subject_id:selected,package_code:$('ops-pay-package').value
    })});
    $('ops-pay-link').value=result.checkout_url;
    $('ops-pay-link').hidden=false;
    $('ops-pay-copy').hidden=false;
    feedback('PayHub 결제 링크를 생성했습니다. 승인된 결제 완료 후 회기가 충전됩니다.');
  }
  let lastWebRing='';
  async function webRingStatus(){
    if(!authorized||!selected)return;
    const state=await request('/subjects/'+encodeURIComponent(selected)+'/web-ring');
    const button=$('ops-web-ring');
    const consent=Boolean(window.RAJ_CONSENT_APPROVED);
    const credits=Boolean(window.RAJ_CREDITS_AVAILABLE);
    const busy=['RINGING','CONNECTING','IN_CALL'].includes(state.ring_status);
    button.disabled=!state.receiver_online||!consent||!credits||busy;
    const message=state.ring_status==='RINGING'?'어르신 기기에 전화가 울리고 있습니다.':
      state.ring_status==='CONNECTING'?'어르신이 전화를 받고 연결 중입니다.':
      state.ring_status==='IN_CALL'?'어르신이 AI와 대화 중입니다.':
      state.ring_status==='COMPLETED'?'통화가 종료됐습니다. 기록에서 일기를 검토해 주세요.':
      state.ring_status==='DECLINED'?'어르신이 통화를 거절했습니다.':
      state.ring_status==='MISSED'?'받지 않아 종료됐습니다. 다시 걸 수 있습니다.':
      state.ring_status==='FAILED'?'통화 연결에 실패했습니다. 다시 걸 수 있습니다.':
      !consent?'어르신 통화 동의 확인이 필요합니다.':
      !credits?'잔여 체험 회기가 없습니다.':
      state.receiver_online?'어르신 기기가 연결됐습니다. 웹전화를 걸 수 있습니다.':
      '어르신 기기에서 보호자가 공유한 수신 링크를 먼저 열어주세요.';
    $('ops-web-ring-status').textContent=message;
    if(state.ring_status==='COMPLETED'&&lastWebRing!==state.ring_id){
      lastWebRing=state.ring_id;
      window.RAJ_RELOAD_DIARIES?.().catch(()=>{});
    }
  }
  async function ringWeb(){
    if(!selected)return;
    const button=$('ops-web-ring');button.disabled=true;
    try{
      const result=await request('/subjects/'+encodeURIComponent(selected)+'/web-ring',{method:'POST'});
      $('ops-web-ring-status').textContent=result.status==='RINGING'?'어르신께 웹전화 요청을 보냈습니다.':'연결 상태를 확인 중입니다.';
      await webRingStatus();
    }finally{await webRingStatus().catch(()=>{});}
  }
  async function connected(){
    authorized=true;
    $('pilot-management').hidden=false;
    document.querySelector('.pilot-section-head').hidden=true;
    $('ops-report-month').value=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}).slice(0,7);
    await safe(reload);
    await safe(loadBilling);
    await safe(webRingStatus);
    switchTab('info');
  }
  function bind(id,handler){$(id).addEventListener('click',()=>safe(handler));}
  bind('ops-add',addSubject);
  bind('ops-save-profile',saveProfile);
  bind('ops-confirm-consent',confirmConsent);
  bind('ops-new-person',()=>{
    creating=!creating;
    $('ops-new-person').textContent=creating?'닫기':'어르신 추가';
    switchTab('info');
  });
  document.querySelectorAll('[data-ops-tab]').forEach(button=>{
    button.addEventListener('click',()=>switchTab(button.dataset.opsTab));
  });
  bind('ops-pay-save',savePackage);
  bind('ops-pay-checkout',createCheckout);
  bind('ops-pay-copy',async()=>{
    await navigator.clipboard.writeText($('ops-pay-link').value);
    feedback('결제 링크를 복사했습니다.');
  });
  $('ops-pay-package').addEventListener('change',()=>safe(loadBilling));

  bind('ops-trial',trial);
  bind('ops-book',book);
  bind('ops-web-ring',ringWeb);
  bind('ops-web-ring-refresh',webRingStatus);
  bind('ops-report',report);
  bind('ops-refresh',async()=>{await reload();await window.RAJ_RELOAD_DIARIES?.();});
  bind('ops-report-copy',async()=>{
    await navigator.clipboard.writeText(lastReport);
    feedback('가족 보고서를 복사했습니다.');
  });
  $('pilot-subject-select').addEventListener('change',e=>{
    selected=e.target.value;
    safe(async()=>{await showSubject();switchTab(activeTab);});
  });
  setInterval(()=>{
    if(authorized&&selected&&activeTab==='call'&&!document.hidden){
      webRingStatus().catch(()=>{});
    }
  },4500);
  window.addEventListener('raj:pilot-connected',connected);
  window.addEventListener('raj:pilot-disconnected',()=>{
    authorized=false;
    subjects=[];
    selected='';
    creating=false;
    hasOutbox=false;
    $('pilot-subject-select').replaceChildren();
    $('ops-appointments').replaceChildren();
    $('ops-outbox').replaceChildren();
    $('ops-ticket-history').replaceChildren();
    $('ops-report-output').value='';
    $('ops-consent-status').hidden=true;
    $('ops-confirm-consent').hidden=true;
    $('ops-consent-dial').hidden=true;
    switchTab('info');
  });
  window.addEventListener('raj:diary-saved',()=>safe(async()=>{
    await showSubject();
    switchTab('record');
    $('pilot-saved').scrollIntoView({behavior:'smooth',block:'start'});
  }));
  window.addEventListener('raj:operations-changed',()=>safe(reload));
})();
