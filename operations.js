(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  if(!$('pilot-management'))return;
  let selected='';
  let subjects=[];
  let lastReport='';
  let loading=false;
  const request=(path,options)=>window.RAJ_OPERATIONS_REQUEST(path,options);
  function feedback(message,bad=false){
    const el=$('pilot-status');el.textContent=message;el.dataset.kind=bad?'error':'ok';
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
      option.value=s.id;option.textContent=s.name;picker.append(option);}
    if(!subjects.some(x=>x.id===selected))selected=subjects[0]?.id||'';
    picker.value=selected;
    window.RAJ_SELECTED_SUBJECT=selected;
    await showSubject();
  }
  async function showSubject(){
    window.RAJ_SELECTED_SUBJECT=selected;
    window.RAJ_CREDITS_AVAILABLE=false;
    window.RAJ_REFRESH_CALL_BUTTON?.();
    text('ops-credit','잔여 회기 —');
    text('ops-stage','첫 통화 안내');
    text('ops-script','어르신을 선택하면 대화 안내가 나타납니다.');
    text('ops-previous','');
    $('ops-appointments').replaceChildren();
    if(!selected)return;
    const info=await request('/subjects/'+encodeURIComponent(selected));
    text('ops-credit','잔여 회기 '+info.balance+'회');
    window.RAJ_CREDITS_AVAILABLE=info.balance>0;
    window.RAJ_REFRESH_CALL_BUTTON?.();
    const script=info.script||{};
    text('ops-stage',script.stage==='RETURN'?'재통화 안내':'첫 통화 안내');
    text('ops-script',script.prompt||'');
    text('ops-previous',script.prior_story||'');
    const target=$('ops-appointments');
    const a=(info.appointments||[]);
    if(!a.length){target.textContent='예정된 통화가 없습니다.';return;}
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
      await loadSubjects();
      feedback('어르신이 등록됐습니다. 체험 회기를 충전하세요.');
    }finally{loading=false;$('ops-add').disabled=false;}
  }
  async function trial(){
    if(!selected){feedback('어르신을 먼저 선택해 주세요.',true);return;}
    const info=await request('/trial-credits',{method:'POST',
      body:JSON.stringify({subject_id:selected,count:3,reason:'COUNSELOR_TRIAL'})});
    await loadSubjects();
    feedback('체험 회기 3회가 충전됐습니다. 유료 결제는 발생하지 않았습니다.');
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
    if(!data.messages?.length){el.textContent='대기 중인 안내가 없습니다.';return;}
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
  async function connected(){
    $('pilot-management').hidden=false;
    $('ops-report-month').value=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}).slice(0,7);
    await safe(reload);
    await safe(loadBilling);
  }
  function bind(id,handler){$(id).addEventListener('click',()=>safe(handler));}
  bind('ops-add',addSubject);
  bind('ops-pay-save',savePackage);
  bind('ops-pay-checkout',createCheckout);
  bind('ops-pay-copy',async()=>{
    await navigator.clipboard.writeText($('ops-pay-link').value);
    feedback('결제 링크를 복사했습니다.');
  });
  $('ops-pay-package').addEventListener('change',()=>safe(loadBilling));

  bind('ops-trial',trial);
  bind('ops-book',book);
  bind('ops-report',report);
  bind('ops-refresh',reload);
  bind('ops-report-copy',async()=>{
    await navigator.clipboard.writeText(lastReport);
    feedback('가족 보고서를 복사했습니다.');
  });
  $('pilot-subject-select').addEventListener('change',e=>{
    selected=e.target.value;
    safe(showSubject);
  });
  window.addEventListener('raj:pilot-connected',connected);
  window.addEventListener('raj:operations-changed',()=>safe(reload));
})();
