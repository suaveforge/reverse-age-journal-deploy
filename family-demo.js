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
    credits:0,orderId:'',when:'',booked:false,
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
      throw Error(errors[data.detail]||'처리하지 못했습니다. 다시 시도해 주세요.');
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
      await request('/onboarding',{method:'POST',body:JSON.stringify({
        guest_token:state.guestToken,guardian_name:state.family,
        guardian_phone:state.guardianPhone,elder_name:elder,elder_phone:phone,
        relationship:document.getElementById('family-relationship').value,
        preferred_hour:hour,interests:document.getElementById('family-interests').value.trim()
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
      if(data.consent==='CONFIRMED')move(4);
      else tell('어르신 동의 확인 중입니다.');
    }catch(e){tell(e.message);}
    finally{if(action)action.disabled=false;}
  }
  async function plans(){
    page('이용권 선택','<div id="family-plans"></div>'+error,false);
    const box=document.getElementById('family-plans');
    try{
      const data=await request('/payment-ready');
      if(state.step!==4)return;
      if(!data.ready||!data.packages?.length){
        tell('현재 이용권을 구매할 수 없습니다.');return;
      }
      box.className='family-choices';
      for(const item of data.packages){
        if(!['FIVE','TEN'].includes(item.code))continue;
        const b=document.createElement('button');
        b.className='family-button outline';b.type='button';
        b.textContent=item.sessions+'회 · '+Number(item.price_krw).toLocaleString('ko-KR')+'원';
        b.addEventListener('click',()=>{
          state.packageCode=item.code;state.price=Number(item.price_krw);move(5);
        });
        box.append(b);
      }
    }catch(e){if(state.step===4)tell(e.message);}
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
      state.when=at.toISOString();state.booked=true;move(7);
    }catch(e){tell(e.message);action.disabled=false;}
  }
  function render(){
    if(state.step===0){
      page('',button('시작하기','family-start'),false);
      document.getElementById('family-start').onclick=()=>move(1);
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
        '<label class="family-consent"><input id="family-information-consent" type="checkbox">'+
        '<span>등록 정보를 상담 준비에 사용하는 데 동의</span></label>'+
        button('등록하기','family-register')+error+'</form>');
      document.getElementById('family-elder-form').onsubmit=e=>{e.preventDefault();submitElder();};
      document.getElementById('family-register').onclick=submitElder;
    }else if(state.step===3){
      page('어르신 동의 확인','<p class="family-primary-message">상담사가 어르신과 통화한 뒤 확인합니다.</p>'+
        button('동의 확인하기','family-consent-check')+error,false);
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
    }else{
      page('예약 접수','<div class="family-confirm"><strong>'+esc(state.elder)+'</strong>'+
        '<strong>'+esc(dateDisplay(state.when))+'</strong></div>'+
        '<p class="family-primary-message">테스트 예약입니다. 자동 전화 발신은 진행되지 않습니다.</p>'+
        button('내 이용 현황','family-dashboard'),false);
      document.getElementById('family-dashboard').onclick=async()=>{
        try{
          const r=await request('/onboarding');
          if(!r.registered)throw Error('등록 정보를 확인할 수 없습니다.');
          page('이용 현황','<div class="family-confirm"><strong>'+esc(r.elder_name)+'</strong>'+
            '<strong>'+esc(dateDisplay(r.booking_at||state.when))+'</strong>'+
            '<strong>결제한 이용권 '+state.credits+'회</strong></div>'+
            '<p class="family-primary-message">통화 기록은 통화가 완료된 뒤 확인할 수 있습니다.</p>',false);
        }catch(e){tell(e.message);}
      };
    }
  }
  // Never trust the browser's stored consent state. Verify against the counselor record.
  if(state.registered && state.step>=4 && state.step<7){
    request('/onboarding').then(r=>{
      if(r.consent!=='CONFIRMED'){state.step=3;remember();render();}
    }).catch(()=>{});
  }
  remember();render();
})();