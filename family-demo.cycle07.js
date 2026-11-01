/* CareFriend onboarding order reused with the existing counselor subject,
   verified consent and PayHub TEST API. No simulated payment or call. */
(() => {
  'use strict';
  const host=document.getElementById('family-journey');
  if(!host)return;
  const API=String(window.RAJ_CONFIG?.pilotApiBase||'').replace(/\/$/,'');
  const KEY='raj.family.walkthrough.v2';
  const AUTH_KEY='raj.family.account.v1';
  const storedAccount=localStorage.getItem(AUTH_KEY)||'';
  let legacyToken='';

  const blank=()=>({
    step:0, family:'',guardianPhone:'',elder:'',phone:'',relationship:'부모님',
    preferredHour:14,preferredMinute:0,interests:'',registered:false,packageCode:'',price:0,
    credits:0,orderId:'',when:'',booked:false,phoneReady:false,smsStatus:'',
    guestToken:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','')
  });
  let state=blank();
  try{
    const old=JSON.parse(sessionStorage.getItem(KEY)||'null');
    if(old&&typeof old.guestToken==='string'&&old.guestToken.length>=32){
      state={...state,...old};
      // Previous browser-only forms never registered the elder or established consent.
      if(!old.registered && old.step>2)state.step=1;
    }
  }catch{}
  legacyToken=state.guestToken;
  if(storedAccount){state.guestToken=storedAccount;state.step=0;}
  const remember=()=>{try{sessionStorage.setItem(KEY,JSON.stringify(state));}catch{}};
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const button=(name,id,kind='primary')=>'<button class="family-button '+kind+'" type="button" id="'+id+'">'+name+'</button>';
  const error='<p id="family-error" class="family-error" role="alert" hidden></p>';
  function tell(message){const x=document.getElementById('family-error');if(x){x.hidden=false;x.textContent=message;}}
  // Keep the verified family session, but return to the true opening screen.
  // A plain href reload used to restore the unfinished step from sessionStorage.
  document.addEventListener('click',event=>{
    const brand=event.target.closest?.('a.wordmark, a.family-opening-brand');
    if(!brand)return;
    event.preventDefault();
    state.step=0;
    remember();
    document.querySelector('[data-view="family"]')?.click();
    render();
    window.scrollTo(0,0);
  });
  function validationMessage(detail){
    if(detail==='CALL_HOURS_09_TO_20_KST_ONLY')
      return '서버에 이전 통화 시간 제한이 남아 있습니다. 선택하신 시간은 저장되지 않았습니다.';
    const items=Array.isArray(detail)?detail:[];
    const field=item=>Array.isArray(item?.loc)?item.loc[item.loc.length-1]:'';
    if(items.some(item=>field(item)==='preferred_hour'||field(item)==='preferred_minute'))
      return '등록 서버의 통화 시간 설정이 아직 반영되지 않았습니다. 선택하신 시간은 저장되지 않았습니다.';
    const labels={guardian_name:'보호자 이름',guardian_phone:'보호자 전화번호',
      elder_name:'어르신 이름',elder_phone:'어르신 전화번호',
      relationship:'관계',interests:'대화 주제',guest_token:'가족 등록 세션'};
    const invalid=items.map(field).find(key=>Object.hasOwn(labels,key));
    if(invalid)return labels[invalid]+' 항목이 서버에서 거절됐습니다. 입력 내용을 확인해 주세요.';
    if(detail==='CONTACTS_MUST_DIFFER')return '보호자와 어르신의 전화번호를 다르게 입력해 주세요.';
    if(detail==='NAME_REQUIRED')return '보호자와 어르신의 이름을 입력해 주세요.';
    return '등록 서버가 요청을 거절했습니다. 선택한 정보는 저장되지 않았습니다. (422)';
  }
  function page(title,content,back=true){
    host.innerHTML='<div class="family-shell">'+
      (back&&state.step>0&&state.step<4?'<button class="family-back" id="family-back" type="button">이전</button>':'')+
      (title?'<h1 class="family-title">'+title+'</h1>':'')+
      '<div class="family-body">'+content+'</div></div>';
    document.getElementById('family-back')?.addEventListener('click',()=>{
      if(state.registered)return;
      state.step=Math.max(0,state.step-1);remember();render();
    });
  }
  function move(step){state.step=step;remember();render();}
  async function checkRegistrationAvailable(){
    if(!API)throw Error('현재 어르신 등록 서비스를 이용할 수 없습니다.');
    let response;
    try{
      response=await fetch(API+'/api/pilot/family/onboarding',{
        cache:'no-store',
        headers:{'X-RAJ-FAMILY-TOKEN':state.guestToken}
      });
    }catch{
      throw Error('등록 서버에 연결할 수 없습니다.');
    }
    if(response.ok)return true;
    const body=await response.json().catch(()=>({}));
    if(response.status===404 && body.detail==='FAMILY_NOT_REGISTERED')return true;
    // The legacy API also returns 404, but with "Not Found": don't collect
    // private contact details when the matching registration API isn't deployed.
    if(response.status===404 && body.detail==='Not Found')
      throw Error('현재 어르신 등록 서비스를 이용할 수 없습니다.');
    if(response.status>=500)
      throw Error('등록 서버 점검 중입니다.');
    throw Error('현재 어르신 등록을 진행할 수 없습니다.');
  }
  async function beginRegistration(){
    const action=document.getElementById('family-start');
    if(action)action.disabled=true;
    try{
      if(localStorage.getItem(AUTH_KEY)){
        try{
          const session=await request('/auth/session');
          state.accountVerified=true;state.registered=!!session.registered;
          await checkRegistrationAvailable();
          move(session.registered?8:1);return;
        }catch(e){
          if(e.message!=='FAMILY_LOGIN_REQUIRED')throw e;
          localStorage.removeItem(AUTH_KEY);
          state.guestToken=legacyToken;
        }
      }
      const capability=await request('/auth/capabilities');
      if(!capability.sms_available)throw Error('보호자 문자 인증을 아직 이용할 수 없습니다.');
      move(9);
    }catch(e){tell(e.message);if(action)action.disabled=false;}
  }
  async function sendLoginCode(){
    const input=document.getElementById('family-login-phone');
    const phone=phoneDigits(input.value);
    if(!/^010[0-9]{8}$/.test(phone)){tell('휴대폰 번호를 확인해 주세요.');return;}
    const button=document.getElementById('family-request-code');button.disabled=true;
    try{
      await request('/auth/request',{method:'POST',body:JSON.stringify({phone})});
      state.guardianPhone=phone;move(10);
    }catch(e){tell(e.message);button.disabled=false;}
  }
  async function confirmLoginCode(){
    const input=document.getElementById('family-login-code');
    const code=input.value.trim();
    if(!/^[0-9]{6}$/.test(code)){tell('인증번호 6자리를 입력해 주세요.');return;}
    const button=document.getElementById('family-confirm-code');button.disabled=true;
    try{
      const result=await request('/auth/verify',{method:'POST',body:JSON.stringify({
        phone:state.guardianPhone,code,legacy_token:legacyToken||null
      })});
      if(!result.authenticated||!result.token)throw Error('인증 결과를 확인할 수 없습니다.');
      localStorage.setItem(AUTH_KEY,result.token);
      state.guestToken=result.token;legacyToken='';state.accountVerified=true;
      state.registered=!!result.registered;
      await checkRegistrationAvailable();
      move(result.registered?8:1);
    }catch(e){tell(e.message);button.disabled=false;}
  }
  async function logOutAccount(){
    await request('/auth/logout',{method:'POST',body:'{}'}).catch(()=>{});
    localStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(KEY);
    state=blank();legacyToken=state.guestToken;move(0);
  }
  async function request(path,options={}){
    if(!API)throw Error('서비스 연결을 확인할 수 없습니다.');
    let response;
    try{
      response=await fetch(API+'/api/pilot/family'+path,{
        ...options,cache:'no-store',
        headers:{'Content-Type':'application/json','X-RAJ-FAMILY-TOKEN':state.guestToken,...(options.headers||{})}
      });
    }catch{throw Error('서비스에 연결할 수 없습니다.');}
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const errors={
        ELDER_CONSENT_PENDING:'어르신 동의 확인 후 이용할 수 있습니다.',
        PAYHUB_TEST_NOT_CONFIGURED:'현재 결제를 이용할 수 없습니다.',
        TEST_PACKAGE_NOT_CONFIGURED:'이용권을 준비하고 있습니다.',
        PAYHUB_TEST_PROVIDER_REQUIRED:'현재 결제수단을 이용할 수 없습니다.',
        PAYMENT_NOT_CONFIRMED:'결제 완료를 확인할 수 없습니다.',
        PAYHUB_REQUEST_FAILED:'결제를 연결할 수 없습니다.',
        PAYHUB_UNAVAILABLE:'결제를 연결할 수 없습니다.',
        FAMILY_NOT_REGISTERED:'먼저 어르신을 등록해 주세요.',
        FAMILY_LOGIN_REQUIRED:'FAMILY_LOGIN_REQUIRED',
        GUARDIAN_SMS_UNAVAILABLE:'문자 인증 연결이 준비되지 않았습니다.',
        OTP_DELIVERY_UNCERTAIN:'인증번호 발송 결과를 확인할 수 없습니다.',
        OTP_WAIT_BEFORE_RETRY:'잠시 후 다시 인증번호를 요청해 주세요.',
        OTP_RATE_LIMITED:'인증 요청 횟수를 초과했습니다.',
        OTP_INVALID:'인증번호가 올바르지 않습니다.',
        OTP_EXPIRED_OR_LOCKED:'인증번호가 만료됐습니다. 다시 요청해 주세요.',
        LEGACY_ACCOUNT_REQUIRES_ORIGINAL_SESSION:'기존 가입 정보가 있습니다. 처음 가입한 기기로 인증하거나 고객센터에 문의해 주세요.',
        GUARDIAN_PHONE_NOT_VERIFIED:'인증된 휴대폰 번호와 다릅니다.'
      };
      if(errors[data.detail])throw Error(errors[data.detail]);
      if(response.status===401)throw Error('FAMILY_LOGIN_REQUIRED');
      if(response.status===404 && path==='/onboarding')
        throw Error('현재 어르신 등록 서비스를 이용할 수 없습니다.');
      if(response.status===404)throw Error('요청한 정보를 찾을 수 없습니다.');
      if(response.status===422)throw Error(validationMessage(data.detail));
      if(response.status===409)throw Error('현재 상태에서 진행할 수 없습니다.');
      if(response.status===429)throw Error('이용 횟수를 초과했습니다.');
      if(response.status>=500)throw Error('서버 오류가 발생했습니다. 관리자에게 문의해 주세요.');
      throw Error('요청을 완료할 수 없습니다. 관리자에게 문의해 주세요.');
    }
    return data;
  }
  function dateDisplay(value){
    const d=new Date(value);
    return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('ko-KR',{
      timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',
      hour:'numeric',minute:'2-digit',hour12:false
    }).format(d);
  }
  function phoneDigits(value){return String(value||'').replace(/\D/g,'');}
  function submitGuardian(){
    const name=document.getElementById('family-name').value.trim();
    const phone=phoneDigits(document.getElementById('guardian-phone').value);
    if(phone!==state.guardianPhone){tell('인증한 휴대폰 번호를 사용해 주세요.');return;}
    if(!name||phone.length<10||phone.length>11){tell('이름과 전화번호를 확인해 주세요.');return;}
    state.family=name;state.guardianPhone=phone;move(2);
  }
  async function submitElder(){
    const elder=document.getElementById('family-elder').value.trim();
    const phone=phoneDigits(document.getElementById('family-phone').value);
    const selectedTime=document.getElementById('family-hour').value;
    const matched=/^([0-9]{2}):([0-9]{2})$/.exec(selectedTime);
    const hour=matched?Number(matched[1]):NaN;
    const minute=matched?Number(matched[2]):NaN;
    if(!Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minute)||minute<0||minute>59){
      tell('통화 시간을 확인해 주세요.');return;
    }
    if(!elder||phone.length<10||phone.length>11){tell('어르신 이름과 전화번호를 확인해 주세요.');return;}
    if(phone===state.guardianPhone){tell('어르신 전화번호를 따로 입력해 주세요.');return;}
    if(!document.getElementById('family-information-consent').checked){
      tell('등록 정보 사용 동의를 확인해 주세요.');return;
    }
    const action=document.getElementById('family-register');action.disabled=true;
    try{
      await checkRegistrationAvailable();
      const registration=await request('/onboarding',{method:'POST',body:JSON.stringify({
        guest_token:state.guestToken,guardian_name:state.family,
        guardian_phone:state.guardianPhone,elder_name:elder,elder_phone:phone,
        relationship:document.getElementById('family-relationship').value,
        preferred_hour:hour,preferred_minute:minute,interests:document.getElementById('family-interests').value.trim(),
         share_with_family:document.getElementById('family-share-request').checked
      })});
      state.elder=elder;state.phone=phone;state.relationship=document.getElementById('family-relationship').value;
      state.preferredHour=hour;state.preferredMinute=minute;state.registered=true;state.smsStatus=registration.sms_status||'';move(3);
    }catch(e){tell(e.message);action.disabled=false;}
  }
  function smsMessage(status){
    if(status==='SUBMITTED')return '문자 발송 요청을 자동으로 전달했습니다. 어르신이 안내 문자를 열고 동의하시면 다음 단계로 넘어갑니다.';
    if(status==='UNKNOWN')return '문자 발송 여부를 확인할 수 없습니다. 중복 문자는 보내지 않았습니다.';
    return '어르신 등록은 완료됐습니다. 문자 발송 중계가 아직 설정되지 않아 안내 문자는 발송되지 않았습니다.';
  }
  async function checkConsent(){
    if(state.step!==3)return;
    try{
      const data=await request('/onboarding');
      if(state.step!==3)return;
      if(data.sms_status)state.smsStatus=data.sms_status;
      if(data.consent==='CONFIRMED'){move(8);return;}
      const p=document.getElementById('family-send-status');
      if(p)p.textContent=smsMessage(state.smsStatus);
    }catch{
      const p=document.getElementById('family-send-status');
      if(p)p.textContent='등록 상태를 확인할 수 없습니다.';
    }
  }
  async function plans(){
    page('이용권 선택','<div id="family-plans"></div>'+error,false);
    const box=document.getElementById('family-plans');
    try{
      const data=await request('/payment-ready');
      if(state.step!==4)return;
      if(!data.ready||!data.packages?.length){box.textContent='이용권 구매는 준비 중입니다.';return;}
      box.className='family-choices';
      for(const item of data.packages){
        if(!['FIVE','TEN'].includes(item.code))continue;
        const b=document.createElement('button');b.className='family-button outline';b.type='button';
        b.textContent=item.sessions+'회 · '+Number(item.price_krw).toLocaleString('ko-KR')+'원';
        b.onclick=()=>{state.packageCode=item.code;state.price=Number(item.price_krw);move(5);};
        box.append(b);
      }
    }catch(e){if(state.step===4)tell(e.message);}
  }
  function receiverTools(){
    const host=document.getElementById('family-receiver-tools');
    if(!host)return;
    const open=document.createElement('button');
    open.className='family-button primary';open.type='button';
    open.textContent='어르신 웹전화 연결 링크 만들기';
    const hint=document.createElement('p');hint.className='family-primary-message';
    hint.textContent='지정된 어르신 기기에서 링크를 열고 대기해 주세요.';
    host.replaceChildren(open,hint);
    open.onclick=async()=>{
      open.disabled=true;
      try{
        const data=await request('/receiver-link',{method:'POST',
          body:JSON.stringify({guest_token:state.guestToken})});
        const url=String(data.url||'');
        if(!/^https:\/\/reverse-age-journal\.suaveforge\.com\/receive\.html#[0-9a-f]{64}$/.test(url))
          throw Error('연결 링크 형식을 확인할 수 없습니다.');
        const input=document.createElement('input');input.readOnly=true;
        input.className='family-receiver-url';input.value=url;
        input.setAttribute('aria-label','어르신 수신 링크');
        const copy=document.createElement('button');copy.type='button';
        copy.className='family-button outline';copy.textContent='링크 복사';
        copy.onclick=async()=>{
          try{await navigator.clipboard.writeText(url);copy.textContent='복사 완료';}
          catch{input.select();document.execCommand('copy');copy.textContent='복사 완료';}
        };
        const launch=document.createElement('a');launch.href=url;
        launch.target='_blank';launch.rel='noopener noreferrer';
        launch.className='family-button outline';launch.textContent='이 기기에서 수신 열기';
        const share=document.createElement('button');share.type='button';
        share.className='family-button outline';share.textContent='어르신께 링크 공유';
        share.onclick=async()=>{
          if(navigator.share){try{await navigator.share({title:'기쁜사이 웹전화',url});}catch{}}
          else copy.click();
        };
        host.replaceChildren(hint,input,copy,share,launch);
      }catch(e){tell(e.message);open.disabled=false;}
    };
  }
  async function dashboard(){
    page('내 정보',
      '<div id="family-overview" class="family-confirm">불러오는 중</div>'+
      '<div id="family-tickets"></div>'+
      '<div id="family-purchases"></div>'+
      '<div id="family-usage"></div>'+
      '<div id="family-optional-pay"></div>'+
      '<div id="family-shared-list"></div>'+
      '<div id="family-share-action"></div>'+
      '<button type="button" id="family-signout" class="family-back">로그아웃</button>'+error,false);
    document.getElementById('family-signout').onclick=logOutAccount;
    try{
      const [profile,summary,account]=await Promise.all([
        request('/onboarding'),request('/summary'),request('/account')
      ]);
      if(state.step!==8)return;
      if(!account.registered)throw Error('등록된 가족 정보를 찾지 못했습니다.');
      state.elder=profile.elder_name;state.registered=true;
      document.getElementById('family-overview').innerHTML=
        '<strong>'+esc(profile.elder_name)+'</strong><strong>잔여 통화 '+Number(account.balance||0)+'회</strong>';
      const purchases=account.purchases||[];
      const usages=account.usage||[];
      const bought=purchases.reduce((total,p)=>total+Number(p.sessions||0),0);
      const used=usages.reduce((total,u)=>total+Number(u.sessions||0),0);
      document.getElementById('family-tickets').innerHTML=
        '<p class="family-primary-message">구매 '+bought+'회 · 사용 '+used+'회</p>'+
        (profile.consent!=='CONFIRMED'
          ?'<p class="family-primary-message">어르신 통화 동의 확인 대기 중</p>':'');
      document.getElementById('family-purchases').innerHTML=purchases.length
        ?'<h2 class="family-summary-title">결제 내역</h2>'+
         purchases.map(p=>'<div class="family-shared-summary"><strong>'+Number(p.amount_krw).toLocaleString('ko-KR')+
            '원 · '+Number(p.sessions)+'회</strong><p>'+esc((p.paid_at||'').slice(0,10))+'</p></div>').join('')
        :'';
      document.getElementById('family-usage').innerHTML=usages.length
        ?'<h2 class="family-summary-title">사용 내역</h2>'+
         usages.map(u=>'<div class="family-shared-summary"><strong>'+Number(u.sessions)+'회 사용</strong><p>'+
           esc((u.at||'').slice(0,10))+'</p></div>').join('')
        :'';
      const list=document.getElementById('family-shared-list');
      if(profile.share_requested&&!profile.share_approved){
        list.innerHTML='<p class="family-primary-message">가족 공유 동의 확인 대기 중입니다.</p>';
      }else if(summary.shared&&Array.isArray(summary.reports)&&summary.reports.length){
        list.innerHTML='<h2 class="family-summary-title">가족에게 공유된 일기</h2>'+
          summary.reports.map(item=>'<article class="family-shared-summary"><strong>'+esc(item.title)+'</strong>'+
          '<p>'+esc(item.excerpt)+'</p></article>').join('');
      }else if(profile.share_approved){
        list.innerHTML='<p class="family-primary-message">상담 후 일기가 저장되면 이곳에서 볼 수 있습니다.</p>';
      }else{
        list.innerHTML='<p class="family-primary-message">일기를 가족에게 공유하려면 별도 동의가 필요합니다.</p>';
      }
      const action=document.getElementById('family-share-action');
      if(!profile.share_requested){
        action.innerHTML=button('가족 일기 공유 요청','family-share-request');
        document.getElementById('family-share-request').onclick=async()=>{
          const b=document.getElementById('family-share-request');b.disabled=true;
          try{await request('/sharing',{method:'POST',body:JSON.stringify({requested:true})});await dashboard();}
          catch(e){tell(e.message);b.disabled=false;}
        };
      }else{
        action.innerHTML=button('가족 공유 중단','family-share-revoke','outline');
        document.getElementById('family-share-revoke').onclick=async()=>{
          if(!confirm('가족에게 더 이상 상담 기록을 공유하지 않을까요?'))return;
          try{await request('/sharing',{method:'POST',body:JSON.stringify({requested:false})});await dashboard();}
          catch(e){tell(e.message);}
        };
      }
      const payment=await request('/payment-ready').catch(()=>null);
      if(payment?.ready&&payment.packages?.length&&state.step===8){
        document.getElementById('family-optional-pay').innerHTML=button('이용권 충전','family-open-plans','outline');
        document.getElementById('family-open-plans').onclick=()=>move(4);
      }
    }catch(e){
      if(state.step===8){
        if(e.message==='FAMILY_LOGIN_REQUIRED'){localStorage.removeItem(AUTH_KEY);move(9);}
        else tell(e.message);
      }
    }
  }
  async function pay(){
    const b=document.getElementById('family-pay');b.disabled=true;
    try{
      const data=await request('/checkout',{method:'POST',body:JSON.stringify({
        guest_token:state.guestToken,package_code:state.packageCode
      })});
      if(!/^https:\/\/payhub\.suaveforge\.com\/checkout\//.test(data.checkout_url))
        throw Error('결제 주소를 확인할 수 없습니다.');
      state.orderId=data.order_id;remember();location.assign(data.checkout_url);
    }catch(e){tell(e.message);b.disabled=false;}
  }
  async function confirmPay(){
    const b=document.getElementById('family-check');
    if(b)b.disabled=true;
    try{
      const data=await request('/orders/'+encodeURIComponent(state.orderId));
      if(data.state==='PAID'){state.credits=data.sessions;move(6);}
      else if(data.state==='FAILED'||data.state==='CANCELLED')tell('결제가 완료되지 않았습니다.');
      else tell('결제 완료를 확인하고 있습니다.');
    }catch(e){tell(e.message);}
    finally{if(b)b.disabled=false;}
  }
  async function book(){
    const input=document.getElementById('family-when');
    const at=new Date(input.value);
    if(!input.value||Number.isNaN(at.getTime())||at.getTime()<=Date.now()){
      tell('통화 날짜를 확인해 주세요.');return;
    }
    const action=document.getElementById('family-reserve');action.disabled=true;
    try{
      const result=await request('/bookings',{method:'POST',body:JSON.stringify({
        guest_token:state.guestToken,order_id:state.orderId,scheduled_at:at.toISOString()
      })});
      if(!result.saved)throw Error('예약을 저장하지 못했습니다.');
      state.when=result.scheduled_at||at.toISOString();state.phoneReady=Boolean(result.automatic_phone_delivery_enabled);state.booked=true;move(7);
    }catch(e){tell(e.message);action.disabled=false;}
  }
  function render(){
    document.querySelector('.page')?.classList.toggle('family-opening-mode',state.step===0);
    if(state.step===0){
      page('',"<section class=\"family-opening\" aria-label=\"기쁜사이 시작\">\n          <div class=\"family-opening-center\">\n            <a class=\"family-opening-brand\" id=\"family-home-opening\" href=\"./\" aria-label=\"기쁜사이 홈으로 이동\">\n              <svg class=\"family-opening-leaf\" width=\"120\" height=\"118\" viewBox=\"0 0 125 123\" aria-hidden=\"true\">\n                <path d=\"M49 81 C40 35 75 4 111 4 C126 33 110 74 74 101 C58 107 53 96 49 81Z\" fill=\"#69b52d\"/>\n                <path d=\"M8 49 C29 28 61 39 81 67 C93 83 95 102 81 115 C49 123 7 98 8 49Z\" fill=\"#005b3a\"/>\n              </svg>\n              <span class=\"family-opening-brand-name\">기쁜사이\n                <svg class=\"family-opening-smile\" width=\"160\" height=\"24\" viewBox=\"0 0 200 26\" aria-hidden=\"true\"><path d=\"M7 4 Q100 46 193 4\" stroke=\"#60b52b\" stroke-width=\"7\" stroke-linecap=\"round\" fill=\"none\"/></svg>\n              </span>\n            </a>\n            <h1 class=\"family-opening-heading\"><span>오늘의 대화가,</span><span class=\"family-opening-second\">내일의 일기가 됩니다</span></h1>\n            <button class=\"family-button primary\" id=\"family-start\" type=\"button\">시작하기 <span class=\"family-start-arrow\" aria-hidden=\"true\">→</span></button>\n          </div>\n          <svg class=\"family-opening-waves\" viewBox=\"0 0 1600 160\" preserveAspectRatio=\"none\" aria-hidden=\"true\">\n            <path d=\"M0 35 C280 -5 435 178 740 151 S1232 76 1600 32 L1600 160 L0 160Z\" fill=\"#e8f3d2\"/>\n            <path d=\"M0 140 C365 5 499 170 791 153 S1321 44 1600 132 L1600 160 L0 160Z\" fill=\"#b4d8a7\" fill-opacity=\".56\"/>\n          </svg>\n        </section>"+error,false);
      document.getElementById('family-start').onclick=beginRegistration;
    }else if(state.step===9){
      page('휴대폰 인증','<form id="family-login-form" class="family-form">'+
        '<label for="family-login-phone">보호자 휴대폰 번호</label>'+
        '<input id="family-login-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000" value="'+esc(state.guardianPhone)+'" required>'+
        button('인증번호 받기','family-request-code')+error+'</form>',false);
      document.getElementById('family-login-form').onsubmit=e=>{e.preventDefault();sendLoginCode();};
      document.getElementById('family-request-code').onclick=sendLoginCode;
    }else if(state.step===10){
      page('인증번호 확인','<form id="family-code-form" class="family-form">'+
        '<label for="family-login-code">문자로 받은 인증번호 6자리</label>'+
        '<input id="family-login-code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required>'+
        button('확인','family-confirm-code')+error+'</form>',false);
      document.getElementById('family-code-form').onsubmit=e=>{e.preventDefault();confirmLoginCode();};
      document.getElementById('family-confirm-code').onclick=confirmLoginCode;
    }else if(state.step===1){
      page('가족 연락처','<form id="family-guardian-form" class="family-form">'+
        '<label for="family-name">이름</label>'+
        '<input id="family-name" maxlength="60" autocomplete="name" value="'+esc(state.family)+'" required>'+
        '<label for="guardian-phone">전화번호</label>'+
        '<input id="guardian-phone" type="tel" inputmode="tel" autocomplete="tel" value="'+esc(state.guardianPhone)+'" readonly required>'+
        button('다음','family-next')+error+'</form>');
      document.getElementById('family-guardian-form').onsubmit=e=>{e.preventDefault();submitGuardian();};
      document.getElementById('family-next').onclick=submitGuardian;
    }else if(state.step===2){
      const preferredTime=String(state.preferredHour).padStart(2,'0')+':'+String(state.preferredMinute||0).padStart(2,'0');
      page('어르신 등록','<form id="family-elder-form" class="family-form">'+
        '<label for="family-elder">어르신 이름</label>'+
        '<input id="family-elder" maxlength="60" autocomplete="off" value="'+esc(state.elder)+'" required>'+
        '<label for="family-phone">어르신 전화번호</label>'+
        '<input id="family-phone" type="tel" inputmode="tel" placeholder="010-0000-0000" value="'+esc(state.phone)+'" required>'+
        '<label for="family-relationship">관계</label>'+
        '<select id="family-relationship">'+['부모님','조부모님','배우자','기타'].map(v=>
          '<option value="'+v+'" '+(state.relationship===v?'selected':'')+'>'+v+'</option>').join('')+'</select>'+
        '<label for="family-hour">통화 희망 시간</label>'+
        '<input id="family-hour" type="time" min="00:00" max="23:59" step="60" value="'+preferredTime+'" required>'+
        '<details class="family-more"><summary>대화 주제 (선택)</summary>'+
        '<textarea id="family-interests" maxlength="220" rows="2" placeholder="취미나 관심사">'+esc(state.interests)+'</textarea></details>'+
        '<label class="family-consent"><input id="family-share-request" type="checkbox">'+
         '<span>어르신 동의 확인 후 가족에게 일기 공유 요청 (선택)</span></label>'+
         '<label class="family-consent"><input id="family-information-consent" type="checkbox">'+
        '<span>등록 정보를 상담 준비에 사용하는 데 동의</span></label>'+
        button('등록하기','family-register')+error+'</form>');
      document.getElementById('family-elder-form').onsubmit=e=>{e.preventDefault();submitElder();};
      document.getElementById('family-register').onclick=submitElder;
    }else if(state.step===3){
      page('등록 완료',
        '<p class="family-primary-message" id="family-send-status">'+esc(smsMessage(state.smsStatus))+'</p>'+error,false);
      checkConsent();
    }else if(state.step===4){
      plans();
    }else if(state.step===5){
      page('결제','<div class="family-amount">'+Number(state.price).toLocaleString('ko-KR')+'원</div>'+
        '<p class="family-primary-message">테스트 결제 · 실제 청구 없음</p>'+
        button('결제하기','family-pay')+
        (state.orderId?button('결제 확인','family-check','outline'):'')+error,false);
      document.getElementById('family-pay').onclick=pay;
      document.getElementById('family-check')?.addEventListener('click',confirmPay);
      if(state.orderId)confirmPay();
    }else if(state.step===6){
      const d=new Date(Date.now()+3600000),p=v=>String(v).padStart(2,'0');
      const min=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes());
      page('통화 예약','<form id="family-book-form" class="family-form">'+
        '<label for="family-when">날짜와 시간</label>'+
        '<input id="family-when" type="datetime-local" min="'+min+'" required>'+
        button('예약하기','family-reserve')+error+'</form>',false);
      document.getElementById('family-book-form').onsubmit=e=>{e.preventDefault();book();};
      document.getElementById('family-reserve').onclick=book;
    }else if(state.step===7){
      page('예약 접수','<div class="family-confirm"><strong>'+esc(state.elder)+'</strong>'+
        '<strong>'+esc(dateDisplay(state.when))+'</strong></div>'+
        '<p class="family-primary-message">'+(state.phoneReady
          ?'예약된 시간에 AI 전화가 발신되도록 일정표에 등록됐습니다.'
          :'통화 일정은 저장됐지만, 전화 발신 서비스 설정이 아직 완료되지 않아 실제 전화가 걸리지 않습니다.')+'</p>'+
        button('내 이용 현황','family-dashboard'),false);
      document.getElementById('family-dashboard').onclick=()=>move(8);
    }else if(state.step===8){
      dashboard();
    }
  }
  // Never trust the browser's stored consent state. Verify against the counselor record.
  // A previous build stranded approved families on optional payment.
  if(state.registered&&state.step===4&&!state.packageCode)state.step=8;
  if(state.registered&&[4,5,6].includes(state.step)){
    request('/onboarding').then(r=>{
      if(r.consent!=='CONFIRMED'){state.step=3;remember();render();}
    }).catch(()=>{});
  }
  setInterval(()=>{if(state.step===3&&!document.hidden)checkConsent();},12000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.step===3)checkConsent();});
  window.addEventListener('raj:family-opened',()=>{
    if(!state.registered)return;
    if(state.step===3)checkConsent();
    else if(state.step===8)dashboard();
  });
  remember();render();
})();