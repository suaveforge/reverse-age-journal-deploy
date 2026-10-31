/* Family-facing, no-charge usability exercise.
 * No server writes, actual payments, phone calls, or invented diary results.
 * Session-only inputs are erased when the browser tab closes.
 */
(() => {
  'use strict';
  const host=document.getElementById('family-journey');
  if(!host)return;
  const KEY='raj.family.walkthrough.v1';
  const defaults=()=>({step:0,family:'',elder:'',phone:'',consent:false,plan:0,credits:0,bookedAt:''});
  let state=defaults();
  try {
    const data=JSON.parse(sessionStorage.getItem(KEY)||'null');
    if(data && Number.isInteger(data.step) && data.step>=0 && data.step<=7){
      state={...state,...data};
    }
  } catch {}
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const save=()=>{try{sessionStorage.setItem(KEY,JSON.stringify(state));}catch{}};
  const formatDate=iso=>{
    if(!iso)return '';
    const date=new Date(iso);
    return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('ko-KR',{
      timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',
      hour:'numeric',minute:'2-digit',hour12:false
    }).format(date);
  };
  const button=(text,id,variant='primary')=>'<button id="'+id+'" type="button" class="family-button '+variant+'">'+text+'</button>';
  const back=()=>state.step>0&&state.step<7?'<button id="family-back" class="family-back" type="button">이전</button>':'';
  const frame=(heading,body,subtitle='')=>{
    host.innerHTML='<div class="family-shell">'+back()+
      '<h1 class="family-title">'+heading+'</h1>'+
      (subtitle?'<p class="family-subtitle">'+subtitle+'</p>':'')+
      '<div class="family-body">'+body+'</div></div>';
    const prev=document.getElementById('family-back');
    if(prev)prev.addEventListener('click',()=>{
      state.step-=1;
      save();render();
    });
  };
  function next(step){state.step=step;save();render();}
  function showError(message){
    const el=document.getElementById('family-error');
    if(el){el.textContent=message;el.hidden=false;}
  }
  const err='<p id="family-error" role="alert" class="family-error" hidden></p>';
  function render(){
    if(state.step===0){
      frame('전화로 나눈 하루,<br>가족의 기록으로.',
        button('이용해 보기','family-start'),'');
      document.getElementById('family-start').addEventListener('click',()=>next(1));
    }else if(state.step===1){
      frame('가족 등록',
        '<form id="family-form" class="family-form">'+
        '<label for="family-name">가족 이름</label>'+
        '<input id="family-name" name="name" maxlength="40" autocomplete="off" required placeholder="이름 입력" value="'+esc(state.family)+'">'+
        button('다음','family-next')+err+'</form>');
      document.getElementById('family-next').addEventListener('click',()=>{
        const name=document.getElementById('family-name').value.trim();
        if(name.length<2){showError('이름을 입력해 주세요.');return;}
        state.family=name;next(2);
      });
      document.getElementById('family-form').addEventListener('submit',e=>{e.preventDefault();document.getElementById('family-next').click();});
    }else if(state.step===2){
      frame('어르신 등록',
        '<form id="family-elder-form" class="family-form">'+
        '<label for="family-elder">어르신 이름</label>'+
        '<input id="family-elder" name="elder" maxlength="40" autocomplete="off" required placeholder="이름 입력" value="'+esc(state.elder)+'">'+
        '<label for="family-phone">어르신 전화번호</label>'+
        '<input id="family-phone" name="phone" inputmode="tel" autocomplete="off" maxlength="18" type="tel" required placeholder="010-0000-0000" value="'+esc(state.phone)+'">'+
        '<label class="family-consent"><input id="family-consent" type="checkbox" '+(state.consent?'checked':'')+'><span>어르신의 통화·기록 동의를 확인했어요</span></label>'+
        button('등록하기','family-register')+err+'</form>');
      const go=()=>{
        const elder=document.getElementById('family-elder').value.trim();
        const phone=document.getElementById('family-phone').value.replace(/\D/g,'');
        if(elder.length<2){showError('어르신 이름을 입력해 주세요.');return;}
        if(phone.length<9||phone.length>11){showError('전화번호를 확인해 주세요.');return;}
        if(!document.getElementById('family-consent').checked){showError('어르신의 동의를 확인해 주세요.');return;}
        state.elder=elder;
        state.phone=phone;
        state.consent=true;
        next(3);
      };
      document.getElementById('family-register').addEventListener('click',go);
      document.getElementById('family-elder-form').addEventListener('submit',e=>{e.preventDefault();go();});
    }else if(state.step===3){
      frame('이용권 선택',
        '<div class="family-choices">'+button('3회 이용권','family-three','outline')+
        button('5회 이용권','family-five','outline')+'</div>');
      document.getElementById('family-three').addEventListener('click',()=>{state.plan=3;next(4);});
      document.getElementById('family-five').addEventListener('click',()=>{state.plan=5;next(4);});
    }else if(state.step===4){
      frame('가상 결제',
        '<div class="family-amount">'+state.plan+'회 이용권</div>'+
        '<p class="family-important">연습 결제입니다. 실제 금액은 청구되지 않습니다.</p>'+
        button('가상 결제하기','family-pay'));
      document.getElementById('family-pay').addEventListener('click',()=>{
        state.credits=state.plan;next(5);
      });
    }else if(state.step===5){
      const d=new Date(Date.now()+3600000);
      const pad=n=>String(n).padStart(2,'0');
      const min=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
      frame('통화 예약',
        '<form id="family-reserve-form" class="family-form">'+
        '<label for="family-when">통화할 날짜와 시간</label>'+
        '<input id="family-when" name="when" type="datetime-local" min="'+min+'" required>'+
        '<p class="family-important">예약 체험입니다. 전화는 실제로 발신되지 않습니다.</p>'+
        button('예약하기','family-reserve')+err+'</form>');
      const reserve=()=>{
        const value=document.getElementById('family-when').value;
        const d=new Date(value);
        if(!value||Number.isNaN(d.getTime())||d.getTime()<=Date.now()){
          showError('미래의 날짜와 시간을 선택해 주세요.');return;
        }
        state.bookedAt=d.toISOString();next(6);
      };
      document.getElementById('family-reserve').addEventListener('click',reserve);
      document.getElementById('family-reserve-form').addEventListener('submit',e=>{e.preventDefault();reserve();});
    }else if(state.step===6){
      frame('예약 체험 완료',
        '<div class="family-confirm">'+
        '<strong>'+esc(state.elder)+' 어르신</strong>'+
        '<strong>'+esc(formatDate(state.bookedAt))+'</strong>'+
        '<strong>체험 이용권 '+state.credits+'회</strong></div>'+
        '<p class="family-important">실제 예약이나 전화 발신은 진행되지 않았습니다.</p>'+button('기록 확인','family-record','primary')+
        '<button id="family-reset" class="family-back" type="button">처음부터 다시 체험</button>');
      document.getElementById('family-record').addEventListener('click',()=>next(7));
      document.getElementById('family-reset').addEventListener('click',reset);
    }else{
      frame('통화 기록',
        '<div class="family-no-record">아직 통화 기록이 없습니다.</div>'+
        '<p class="family-important">실제 통화가 진행된 뒤 기록을 확인할 수 있습니다.</p>'+
        button('이용 정보 보기','family-home')+
        '<button id="family-reset" class="family-back" type="button">다시 체험하기</button>');
      document.getElementById('family-home').addEventListener('click',()=>next(6));
      document.getElementById('family-reset').addEventListener('click',reset);
    }
  }
  function reset(){
    if(!confirm('지금까지 입력한 체험 내용을 지우고 처음부터 시작할까요?'))return;
    state=defaults();save();render();
  }
  render();
})();