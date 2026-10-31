/* Family-first flow. PayHub TEST payments must be confirmed server-side.
   Never invent payment, balance, phone calls or diary records. */
(() => {
  'use strict';
  const root=document.getElementById('family-journey');
  if(!root)return;
  const API=String(window.RAJ_CONFIG?.pilotApiBase||'').replace(/\/$/,'');
  const KEY='raj.family.walkthrough.v2';
  const fresh=()=>({
    step:0,family:'',elder:'',phone:'',consent:false,
    packageCode:'',price:0,credits:0,orderId:'',when:'',booked:false,
    guestToken:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','')
  });
  let state=fresh();
  try {
    const saved=JSON.parse(sessionStorage.getItem(KEY)||'null');
    if(saved&&Number.isInteger(saved.step)&&saved.step>=0&&saved.step<=6
      && typeof saved.guestToken==='string'&&saved.guestToken.length>=32)
      state={...state,...saved};
  }catch{}
  const remember=()=>sessionStorage.setItem(KEY,JSON.stringify(state));
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const button=(name,id,kind='primary')=>'<button class="family-button '+kind+'" type="button" id="'+id+'">'+name+'</button>';
  const error='<p id="family-error" class="family-error" role="alert" hidden></p>';
  function tell(message){
    const e=document.getElementById('family-error');
    if(e){e.hidden=false;e.textContent=message;}
  }
  function dateDisplay(value){
    const d=new Date(value);
    return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('ko-KR',{
      timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',
      hour:'numeric',minute:'2-digit',hour12:false
    }).format(d);
  }
  function page(title,body){
    root.innerHTML='<div class="family-shell">'+
      (state.step>0&&state.step<4?'<button type="button" class="family-back" id="family-back">이전</button>':'')+
      (title?'<h1 class="family-title">'+title+'</h1>':'')+
      '<div class="family-body">'+body+'</div></div>';
    document.getElementById('family-back')?.addEventListener('click',()=>{
      state.step--;remember();render();
    });
  }
  function to(step){state.step=step;remember();render();}
  async function request(path,options={}){
    if(!API)throw Error('PayHub 연결 정보가 없습니다.');
    let response;
    try {
      response=await fetch(API+'/api/pilot/family'+path,{
        ...options,cache:'no-store',
        headers:{'Content-Type':'application/json','X-RAJ-FAMILY-TOKEN':state.guestToken,
          ...(options.headers||{})}
      });
    }catch {throw Error('결제 서버에 연결할 수 없습니다.');}
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const errors={
        PAYHUB_TEST_NOT_CONFIGURED:'PayHub 테스트 결제 연결이 필요합니다.',
        TEST_PACKAGE_NOT_CONFIGURED:'PayHub 이용권 설정이 필요합니다.',
        PAYHUB_TEST_PROVIDER_REQUIRED:'PayHub 테스트 결제수단이 필요합니다.',
        PAYMENT_NOT_CONFIRMED:'결제 완료 확인이 필요합니다.',
        PAYHUB_REQUEST_FAILED:'PayHub 결제 연결에 실패했습니다.',
        PAYHUB_UNAVAILABLE:'PayHub에 연결할 수 없습니다.'
      };
      throw Error(errors[data.detail]||'결제를 완료하지 못했습니다.');
    }
    return data;
  }
  async function plans(){
    page('이용권 선택','<div id="family-plans"></div>'+error);
    const box=document.getElementById('family-plans');
    try{
      const data=await request('/payment-ready');
      if(state.step!==3)return;
      if(!data.ready||!data.packages?.length){
        box.innerHTML='<p class="family-error">PayHub 결제 연결이 필요합니다.</p>';
        return;
      }
      box.className='family-choices';
      for(const item of data.packages){
        if(!['FIVE','TEN'].includes(item.code))continue;
        const el=document.createElement('button');
        el.className='family-button outline';
        el.type='button';
        el.textContent=item.sessions+'회 · '+Number(item.price_krw).toLocaleString('ko-KR')+'원';
        el.addEventListener('click',()=>{
          state.packageCode=item.code;
          state.price=Number(item.price_krw);
          to(4);
        });
        box.append(el);
      }
    }catch(e){if(state.step===3)tell(e.message);}
  }
  async function pay(){
    const action=document.getElementById('family-pay');
    if(!action)return;
    action.disabled=true;
    try {
      const data=await request('/checkout',{method:'POST',body:JSON.stringify({
        guest_token:state.guestToken,package_code:state.packageCode
      })});
      if(!/^https:\/\/payhub\.suaveforge\.com\/checkout\//.test(data.checkout_url))
        throw Error('PayHub 결제 주소를 확인할 수 없습니다.');
      state.orderId=data.order_id;remember();
      location.assign(data.checkout_url);
    }catch(e){tell(e.message);action.disabled=false;}
  }
  async function confirmPay(){
    const action=document.getElementById('family-check');
    if(action)action.disabled=true;
    try{
      const data=await request('/orders/'+encodeURIComponent(state.orderId));
      if(data.state==='PAID'){
        state.credits=data.sessions;to(5);
      }else tell('PayHub 결제 완료가 확인되지 않았습니다.');
    }catch(e){tell(e.message);}
    finally{if(action)action.disabled=false;}
  }
  function render(){
    if(state.step===0){
      page('',button('시작하기','family-start'));
      document.getElementById('family-start').addEventListener('click',()=>to(1));
    }else if(state.step===1){
      page('가족 이름','<form id="family-first" class="family-form">'+
        '<input id="family-name" autocomplete="off" maxlength="40" placeholder="이름" value="'+esc(state.family)+'" required>'+
        button('다음','family-next')+error+'</form>');
      const advance=()=>{
        const name=document.getElementById('family-name').value.trim();
        if(name.length<2){tell('이름을 입력해 주세요.');return;}
        state.family=name;to(2);
      };
      document.getElementById('family-first').addEventListener('submit',e=>{e.preventDefault();advance();});
      document.getElementById('family-next').addEventListener('click',advance);
    }else if(state.step===2){
      page('어르신 등록','<form id="family-elder-form" class="family-form">'+
        '<label for="family-elder">이름</label>'+
        '<input id="family-elder" autocomplete="off" maxlength="40" required value="'+esc(state.elder)+'">'+
        '<label for="family-phone">전화번호</label>'+
        '<input id="family-phone" type="tel" inputmode="tel" maxlength="18" required value="'+esc(state.phone)+'" placeholder="010-0000-0000">'+
        '<label class="family-consent"><input id="family-consent" type="checkbox" '+(state.consent?'checked':'')+'><span>어르신의 통화·기록 동의</span></label>'+
        button('다음','family-register')+error+'</form>');
      const advance=()=>{
        const elder=document.getElementById('family-elder').value.trim();
        const phone=document.getElementById('family-phone').value.replace(/\D/g,'');
        if(elder.length<2){tell('이름을 입력해 주세요.');return;}
        if(phone.length<9||phone.length>11){tell('전화번호를 확인해 주세요.');return;}
        if(!document.getElementById('family-consent').checked){tell('동의를 확인해 주세요.');return;}
        state.elder=elder;state.phone=phone;state.consent=true;to(3);
      };
      document.getElementById('family-elder-form').addEventListener('submit',e=>{e.preventDefault();advance();});
      document.getElementById('family-register').addEventListener('click',advance);
    }else if(state.step===3){
      plans();
    }else if(state.step===4){
      page('PayHub 결제','<div class="family-amount">'+
        Number(state.price).toLocaleString('ko-KR')+'원</div>'+
        button('결제하기','family-pay')+
        (state.orderId?button('결제 확인','family-check','outline'):'')+error);
      document.getElementById('family-pay').addEventListener('click',pay);
      document.getElementById('family-check')?.addEventListener('click',confirmPay);
      if(state.orderId)confirmPay();
    }else if(state.step===5){
      const d=new Date(Date.now()+3600000);
      const p=x=>String(x).padStart(2,'0');
      const min=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes());
      page('통화 예약','<form id="family-book-form" class="family-form">'+
        '<label for="family-when">날짜와 시간</label>'+
        '<input id="family-when" type="datetime-local" required min="'+min+'">'+
        button('예약하기','family-reserve')+error+'</form>');
      const book=async()=>{
        const v=document.getElementById('family-when').value;
        const d=new Date(v);
        if(!v||Number.isNaN(d.getTime())||d.getTime()<=Date.now()){tell('날짜와 시간을 확인해 주세요.');return;}
        const b=document.getElementById('family-reserve');b.disabled=true;
        try {
          await request('/bookings',{method:'POST',body:JSON.stringify({
            guest_token:state.guestToken,order_id:state.orderId,scheduled_at:d.toISOString()
          })});
          state.when=d.toISOString();state.booked=true;to(6);
        }catch(e){tell(e.message);b.disabled=false;}
      };
      document.getElementById('family-book-form').addEventListener('submit',e=>{e.preventDefault();book();});
      document.getElementById('family-reserve').addEventListener('click',book);
    }else if(state.step===6){
      page('예약 확인','<div class="family-confirm">'+
        '<strong>'+esc(state.elder)+'</strong>'+
        '<strong>'+esc(dateDisplay(state.when))+'</strong>'+
        '<strong>이용권 '+state.credits+'회</strong></div>'+
        '<p class="family-important">전화 자동 발신은 아직 연결되지 않았습니다.</p>'+
        button('처음으로','family-home'));
      document.getElementById('family-home').addEventListener('click',()=>{
        if(!confirm('새 체험을 시작할까요?'))return;
        state=fresh();remember();render();
      });
    }
  }
  remember();render();
})();