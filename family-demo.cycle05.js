/* CareFriend onboarding order reused with the existing counselor subject,
   verified consent and PayHub TEST API. No simulated payment or call. */
(() => {
  'use strict';
  const host=document.getElementById('family-journey');
  if(!host)return;
  const API=String(window.RAJ_CONFIG?.pilotApiBase||'').replace(/\/$/,'');
  const KEY='raj.family.walkthrough.v2';
  const blank=()=>({
    step:0, family:'',guardianPhone:'',elder:'',phone:'',relationship:'부모님',
    preferredHour:14,interests:'',registered:false,packageCode:'',price:0,
    credits:0,orderId:'',when:'',booked:false,phoneReady:false,
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
  const remember=()=>{try{sessionStorage.setItem(KEY,JSON.stringify(state));}catch{}};
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const button=(name,id,kind='primary')=>'<button class="family-button '+kind+'" type="button" id="'+id+'">'+name+'</button>';
  const error='<p id="family-error" class="family-error" role="alert" hidden></p>';
  function tell(message){const x=document.getElementById('family-error');if(x){x.hidden=false;x.textContent=message;}}
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
    try{await checkRegistrationAvailable();move(1);}
    catch(e){tell(e.message);if(action)action.disabled=false;}
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
        FAMILY_NOT_REGISTERED:'먼저 어르신을 등록해 주세요.'
      };
      if(errors[data.detail])throw Error(errors[data.detail]);
      if(response.status===404 && path==='/onboarding')
        throw Error('현재 어르신 등록 서비스를 이용할 수 없습니다.');
      if(response.status===404)throw Error('요청한 정보를 찾을 수 없습니다.');
      if(response.status===422)throw Error('입력한 정보를 확인해 주세요.');
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
    if(!name||phone.length<10||phone.length>11){tell('이름과 전화번호를 확인해 주세요.');return;}
    state.family=name;state.guardianPhone=phone;move(2);
  }
  async function submitElder(){
    const elder=document.getElementById('family-elder').value.trim();
    const phone=phoneDigits(document.getElementById('family-phone').value);
    const hour=Number(document.getElementById('family-hour').value);
    if(!elder||phone.length<10||phone.length>11){tell('어르신 이름과 전화번호를 확인해 주세요.');return;}
    if(phone===state.guardianPhone){tell('어르신 전화번호를 따로 입력해 주세요.');return;}
    if(!document.getElementById('family-information-consent').checked){
      tell('등록 정보 사용 동의를 확인해 주세요.');return;
    }
    const action=document.getElementById('family-register');action.disabled=true;
    try{
      await checkRegistrationAvailable();
      await request('/onboarding',{method:'POST',body:JSON.stringify({
        guest_token:state.guestToken,guardian_name:state.family,
        guardian_phone:state.guardianPhone,elder_name:elder,elder_phone:phone,
        relationship:document.getElementById('family-relationship').value,
        preferred_hour:hour,interests:document.getElementById('family-interests').value.trim(),
         share_with_family:document.getElementById('family-share-request').checked
      })});
      state.elder=elder;state.phone=phone;state.relationship=document.getElementById('family-relationship').value;
      state.preferredHour=hour;state.registered=true;move(3);
    }catch(e){tell(e.message);action.disabled=false;}
  }
  async function checkConsent(){
    const action=document.getElementById('family-consent-check');
    if(action)action.disabled=true;
    try{
      const data=await request('/onboarding');
      if(data.consent==='CONFIRMED')move(8);
      else tell('아직 상담사 확인이 없습니다. 상담사 화면에서 어르신 통화 동의를 직접 확인해 주세요.');
    }catch(e){tell(e.message);}
    finally{if(action)action.disabled=false;}
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
  async function dashboard(){
    page('가족 기록',
      '<div id="family-overview" class="family-confirm">기록을 확인하고 있습니다.</div>'+
      '<div id="family-shared-list"></div>'+
      '<div id="family-share-action"></div>'+
      button('새로고침','family-dashboard-refresh','outline')+
      '<div id="family-optional-pay"></div>'+error,false);
    document.getElementById('family-dashboard-refresh').onclick=()=>dashboard();
    try{
      const [profile,summary]=await Promise.all([request('/onboarding'),request('/summary')]);
      if(state.step!==8)return;
      if(profile.consent!=='CONFIRMED'){move(3);return;}
      document.getElementById('family-overview').innerHTML=
        '<strong>'+esc(profile.elder_name)+'</strong><strong>잔여 통화 '+Number(profile.balance||0)+'회</strong>';
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
      if(Number(profile.balance||0)===0){
        const payment=await request('/payment-ready').catch(()=>null);
        if(payment?.ready&&payment.packages?.length&&state.step===8){
          document.getElementById('family-optional-pay').innerHTML=button('이용권 선택','family-open-plans','outline');
          document.getElementById('family-open-plans').onclick=()=>move(4);
        }
      }
    }catch(e){if(state.step===8)tell(e.message);}
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
    if(state.step===0){
      page('',button('시작하기','family-start')+error,false);
      document.getElementById('family-start').onclick=beginRegistration;
    }else if(state.step===1){
      page('가족 연락처','<form id="family-guardian-form" class="family-form">'+
        '<label for="family-name">이름</label>'+
        '<input id="family-name" maxlength="60" autocomplete="name" value="'+esc(state.family)+'" required>'+
        '<label for="guardian-phone">전화번호</label>'+
        '<input id="guardian-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000" value="'+esc(state.guardianPhone)+'" required>'+
        button('다음','family-next')+error+'</form>');
      document.getElementById('family-guardian-form').onsubmit=e=>{e.preventDefault();submitGuardian();};
      document.getElementById('family-next').onclick=submitGuardian;
    }else if(state.step===2){
      const times=Array.from({length:11},(_,i)=>{
        const hour=9+i;return '<option value="'+hour+'" '+(state.preferredHour===hour?'selected':'')+'>'+
          (hour<12?'오전 '+hour+'시':hour===12?'오후 12시':'오후 '+(hour-12)+'시')+'</option>';
      }).join('');
      page('어르신 등록','<form id="family-elder-form" class="family-form">'+
        '<label for="family-elder">어르신 이름</label>'+
        '<input id="family-elder" maxlength="60" autocomplete="off" value="'+esc(state.elder)+'" required>'+
        '<label for="family-phone">어르신 전화번호</label>'+
        '<input id="family-phone" type="tel" inputmode="tel" placeholder="010-0000-0000" value="'+esc(state.phone)+'" required>'+
        '<label for="family-relationship">관계</label>'+
        '<select id="family-relationship">'+['부모님','조부모님','배우자','기타'].map(v=>
          '<option value="'+v+'" '+(state.relationship===v?'selected':'')+'>'+v+'</option>').join('')+'</select>'+
        '<label for="family-hour">통화 희망 시간</label>'+
        '<select id="family-hour">'+times+'</select>'+
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
      page('상담사 확인 대기',
        '<p class="family-primary-message">어르신 등록은 완료됐습니다. 상담사가 통화·녹음 동의를 직접 확인해야 합니다.</p>'+
        button('동의 상태 새로고침','family-consent-check')+error,false);
      document.getElementById('family-consent-check').onclick=checkConsent;
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
  window.addEventListener('raj:family-opened',()=>{
    if(!state.registered)return;
    if(state.step===3)checkConsent();
    else if(state.step===8)dashboard();
  });
  remember();render();
})();