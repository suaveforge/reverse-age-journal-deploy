(() => {
  'use strict';
  const config = window.RAJ_CONFIG || {};
  const $ = id => document.getElementById(id);
  const API = String(config.apiBase || '').replace(/\/$/, '');
  const PROJECT = String(config.authProject || '');
  const AUTH_API = String(config.authApiBase || '').replace(/\/$/, '');
  const AUTH_WEB = String(config.authWebBase || '').replace(/\/$/, '');
  const ENV = String(config.environment || 'production');
  const SESSION_KEY = 'raj.session.v1';
  let session = null;
  let selectedId = '';
  let currentView = 'family';
  let recipients = [];
  let operator = false;
  let modalHandler = null;
  let appReady = Boolean(API && PROJECT && AUTH_API && AUTH_WEB);

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const readyNotice = msg => { const el = $('readiness'); el.textContent = msg; el.hidden = !msg; };
  const setText = (id, value) => { $(id).textContent = value; };
  const friendlyDate = value => {
    if (!value) return '예약 없음';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '예약 없음' :
      new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',hour:'numeric',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'}).format(d);
  };

  function readSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }
  function setSession(value) {
    session = value;
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_KEY);
  }
  async function request(path, options = {}) {
    if (!API) throw Error('서비스 API 연결 전입니다.');
    const token = session?.accessToken || '';
    const headers = {...(options.body ? {'Content-Type':'application/json'} : {}), ...(token ? {'Authorization':'Bearer ' + token} : {}), ...(options.headers || {})};
    const response = await fetch(API + path, {cache:'no-store',...options,headers});
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(result.detail || result.error || '요청에 실패했습니다 (' + response.status + ')');
    return result;
  }

  function loginUrl() {
    const url = new URL(AUTH_WEB + '/login/');
    url.searchParams.set('project', PROJECT);
    url.searchParams.set('environment', ENV);
    url.searchParams.set('redirect_uri', location.origin + location.pathname);
    url.searchParams.set('state','raj');
    url.searchParams.set('lang','ko');
    return url.toString();
  }
  async function loginCallback() {
    const url = new URL(location.href);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (!code && !error) return;
    url.searchParams.delete('code'); url.searchParams.delete('error');
    url.searchParams.delete('status'); url.searchParams.delete('state');
    history.replaceState(null,'',url.pathname + url.search + url.hash);
    if (error) throw Error('로그인을 완료하지 못했습니다: ' + error);
    if (!PROJECT || !AUTH_API) throw Error('로그인 연결 정보가 없습니다.');
    const r = await fetch(AUTH_API + '/v1/auth/' + encodeURIComponent(PROJECT) + '/exchange?environment=' + encodeURIComponent(ENV), {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({code})
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.accessToken) throw Error('AuthHub 로그인 인증에 실패했습니다.');
    setSession(data);
  }
  function startLogin() {
    if (!appReady) { readyNotice('로그인 연결 준비 중입니다.'); return; }
    location.href = loginUrl();
  }
  async function logout() {
    // Tokens are never credentials for changing a payment state.
    const refreshToken = session?.refreshToken;
    setSession(null);
    $('auth-button').textContent='로그인';
    if (refreshToken && AUTH_API && PROJECT) {
      try { await fetch(AUTH_API + '/v1/auth/' + encodeURIComponent(PROJECT) + '/logout?environment=' + encodeURIComponent(ENV),{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken})
      }); } catch {}
    }
    recipients = []; selectedId = ''; operator = false;
    resetDashboard(); renderSelect(); renderOperator(); view(currentView);
  }

  function resetDashboard() {
    setText('balance-value','—'); setText('next-call','예약 없음'); setText('diary-count','—');
    $('schedule-list').className='empty-state';
    $('schedule-list').textContent='예정된 통화가 없습니다.';
    $('diary-list').className='empty-state';
    $('diary-list').textContent='아직 남겨진 일기가 없습니다.';
    $('packages').innerHTML='<span class="tag-not-ready">상품 준비 중</span>';
  }
  function renderSelect() {
    const select=$('recipient-select');
    select.replaceChildren();
    if (!recipients.length) {
      const option=document.createElement('option');option.value='';option.textContent='등록된 가족 없음'; select.append(option);return;
    }
    recipients.forEach(r => {const option=document.createElement('option');option.value=r.id;option.textContent=r.display_name;select.append(option);});
    if (!recipients.some(r=>r.id===selectedId)) selectedId=recipients[0].id;
    select.value=selectedId;
  }
  async function loadRecipients() {
    if (!session) return;
    const data=await request('/api/recipients');
    recipients=data.recipients || [];
    renderSelect();
    await loadDashboard();
  }
  async function loadDashboard() {
    resetDashboard();
    if (!selectedId || !session) return;
    const [info,packs]=await Promise.all([
      request('/api/recipients/'+encodeURIComponent(selectedId)+'/dashboard'),
      request('/api/packages')
    ]);
    setText('balance-value',String(info.balance)+'회');
    setText('diary-count',String((info.diaries||[]).length)+'건');
    setText('next-call',(info.upcoming||[]).length?friendlyDate(info.upcoming[0].scheduled_at):'예약 없음');
    if (info.upcoming?.length) {
      $('schedule-list').className='entry-list';
      $('schedule-list').innerHTML=info.upcoming.map(r=>'<div class="entry"><div><strong>'+esc(friendlyDate(r.scheduled_at))+'</strong><small>AI 통화 예약 일정</small></div><span class="state">예약됨</span></div>').join('');
    }
    if (info.diaries?.length) {
      $('diary-list').className='entry-list';
      $('diary-list').innerHTML=info.diaries.map(d=>'<div class="entry"><div><strong>'+esc(d.title)+'</strong><small>'+esc(d.entry_date)+'</small></div><span class="state">일기</span></div>').join('');
    }
    if (packs.packages?.length) {
      $('packages').replaceChildren();
      packs.packages.forEach(p => {
        const b=document.createElement('button');
        b.className='package-buy';
        b.innerHTML='<strong>'+esc(p.name)+'</strong><small>'+esc(Number(p.price_krw).toLocaleString('ko-KR'))+'원 · '+esc(p.sessions)+'회</small>';
        b.addEventListener('click',()=>checkout(p.id));
        $('packages').append(b);
      });
    }
  }

  function openModal(title,fields,onSubmit) {
    $('modal-title').textContent=title;
    $('modal-fields').innerHTML=fields;
    $('modal-error').hidden=true;
    modalHandler=onSubmit;
    $('modal').showModal();
    const first=$('modal-fields').querySelector('input');if(first)first.focus();
  }
  function closeModal() { $('modal').close();modalHandler=null; }
  const field=(name,label,type,placeholder='',required=true)=>'<label class="form-field"><span>'+esc(label)+'</span><input name="'+esc(name)+'" type="'+esc(type)+'" placeholder="'+esc(placeholder)+'" '+(required?'required':'')+'></label>';
  function requireLogin() {if (!session) { startLogin(); return false;} return true;}

  function addFamily() {
    if (!requireLogin()) return;
    openModal('가족 등록하기',field('name','어르신 표시 이름','text','가족의 이름'),async form=>{
      const name=String(form.get('name')||'').trim();
      if (!name) throw Error('이름을 입력해 주세요.');
      const rec=await request('/api/recipients',{method:'POST',body:JSON.stringify({display_name:name})});
      selectedId=rec.id; await loadRecipients();
    });
  }
  function addReservation() {
    if (!requireLogin()) return;
    if (!selectedId) {readyNotice('먼저 가족을 등록해 주세요.');return;}
    openModal('통화 일정 등록',field('date','통화 희망 날짜와 시간','datetime-local'),async form=>{
      const value=String(form.get('date')||'');
      if (!value) throw Error('날짜와 시간을 선택해 주세요.');
      const d=new Date(value);
      if (Number.isNaN(d.getTime())) throw Error('날짜를 다시 확인해 주세요.');
      await request('/api/recipients/'+encodeURIComponent(selectedId)+'/reservations',{
        method:'POST',body:JSON.stringify({scheduled_at:d.toISOString()})
      });
      await loadDashboard();
    });
  }
  async function checkout(packageId) {
    if (!requireLogin() || !selectedId) return;
    if (!confirm('PayHub 결제 화면으로 이동하시겠습니까?')) return;
    try {
      const data=await request('/api/recipients/'+encodeURIComponent(selectedId)+'/checkout?package_id='+encodeURIComponent(packageId),{method:'POST'});
      if (!data.checkout_url?.startsWith('https://')) throw Error('결제 주소를 확인하지 못했습니다.');
      location.href=data.checkout_url;
    } catch(e) {readyNotice(String(e.message||e));}
  }
  function addPackage() {
    if (!requireLogin() || !operator) {readyNotice('상담사 권한으로 로그인해 주세요.');return;}
    openModal('이용권 상품 준비',
      field('name','이용권 이름','text','예: 기본 5회권')+
      field('sessions','포함 회기','number','5')+
      field('price','판매 예정 가격 (원)','number','10000')+
      '<label class="form-checkbox"><input name="active" type="checkbox"> 고객에게 상품 공개 (승인 후에만)</label>',async f=>{
      const data={name:String(f.get('name')||''),sessions:Number(f.get('sessions')),price_krw:Number(f.get('price')),active:f.get('active')==='on'};
      await request('/api/operator/packages',{method:'POST',body:JSON.stringify(data)});
      readyNotice('이용권 상품을 저장했습니다. 실제 결제 가능 여부는 PayHub 설정에 따릅니다.');
      if(selectedId)await loadDashboard();
    });
  }
  async function renderOperator() {
    if(!session || !operator) {
      setText('operator-users','—');setText('operator-upcoming','—');
      $('operator-list').className='empty-state';
      $('operator-list').textContent='상담사 로그인 후 확인할 수 있습니다.';
      return;
    }
    const info=await request('/api/operator/overview');
    setText('operator-users',String(info.recipients?.length||0)+'명');
    setText('operator-upcoming',String(info.upcoming?.length||0)+'건');
    if(info.recipients?.length) {
      $('operator-list').className='entry-list';
      $('operator-list').innerHTML=info.recipients.map(r=>'<div class="entry"><div><strong>'+esc(r.display_name)+'</strong><small>이용자 등록 '+esc((r.created_at||'').slice(0,10))+'</small></div><span class="state">잔여 '+esc(r.balance)+'회</span></div>').join('');
    }else{
      $('operator-list').className='empty-state';
      $('operator-list').textContent='등록된 이용자가 없습니다.';
    }
  }

  function view(name) {
    currentView=name;
    document.querySelectorAll('[data-view]').forEach(b=>{const active=b.dataset.view===name;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    $('family-view').hidden=name!=='family';
    $('operator-view').hidden=name!=='operator';
    $('workspace-title').textContent=name==='family'?'우리 가족의 기록':'상담사 관리';
    $('workspace').hidden = !session;
    if(name==='operator') {
      $('hero-title').innerHTML='통화 일정과 기록,<br><span>한곳에서 관리합니다.</span>';
      document.querySelector('.hero-subtitle').textContent='상담사를 위한 관리 공간.';
      $('start-button').querySelector('span').textContent=(session && operator)?'이용권 등록하기':'상담사 로그인';
      $('reserve-button').hidden=true;
    }else{
      $('hero-title').innerHTML='전화로 나눈 하루,<br><span>일기로 남깁니다.</span>';
      document.querySelector('.hero-subtitle').textContent='어르신은 전화로 이야기하고, 가족은 일기로 읽습니다.';
      $('start-button').querySelector('span').textContent='가족 등록하기';
      $('reserve-button').hidden=false;
    }
    $('recipient-select').disabled=name!=='family';
    $('recipient-label').hidden=name!=='family';
    if(name==='operator')renderOperator().catch(e=>readyNotice(String(e.message||e)));
  }
  async function init() {
    session=readSession();
    try{await loginCallback();}catch(e){readyNotice(String(e.message||e));}
    if(session && appReady){
      try {
        const identity=await request('/api/me');
        operator=Boolean(identity.operator);
        $('auth-button').textContent='로그아웃';
        await loadRecipients();
      } catch(e) {
        if(String(e.message||'').includes('401')) {setSession(null);}
        readyNotice('로그인 정보 확인 또는 서버 연결에 실패했습니다: '+String(e.message||e));
      }
    }
    const params=new URLSearchParams(location.search);
    if(params.has('payment_status')) {
      // A redirect is never payment proof. The backend rechecks PayHub securely.
      const sessionId=params.get('payment_session_id')||'';
      const shouldReconcile=params.get('payment_status')==='paid';
      params.delete('payment_status');params.delete('payment_session_id');
      history.replaceState(null,'',location.pathname+(params.toString()?'?'+params:'')+location.hash);
      if(session && selectedId && shouldReconcile && sessionId) {
        try {
          await request('/api/payments/reconcile',{
            method:'POST',body:JSON.stringify({session_id:sessionId})
          });
        }catch(error){
          readyNotice('결제 확인 중입니다. 잠시 후 이용 내역에서 다시 확인해 주세요. ('+String(error.message||error)+')');
        }
      }
      if(session && selectedId)await loadDashboard().catch(()=>{});
    }
    renderSelect();view(currentView);
  }

  $('auth-button').addEventListener('click',()=>session?logout():startLogin());
  $('start-button').addEventListener('click',()=>currentView==='operator' ? (session && operator?addPackage():startLogin()) : addFamily());
  $('reserve-button').addEventListener('click',addReservation);
  $('new-package-button').addEventListener('click',addPackage);
  $('modal-close').addEventListener('click',closeModal);
  $('modal-cancel').addEventListener('click',closeModal);
  $('modal-form').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!modalHandler)return;
    const btn=$('modal-save');btn.disabled=true;$('modal-error').hidden=true;
    try {await modalHandler(new FormData(e.target));closeModal();}
    catch(err){$('modal-error').textContent=String(err.message||err);$('modal-error').hidden=false;}
    finally{btn.disabled=false;}
  });
  $('recipient-select').addEventListener('change',e=>{selectedId=e.target.value;loadDashboard().catch(err=>readyNotice(String(err.message||err)));});
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
  init().catch(err=>readyNotice('페이지를 초기화하지 못했습니다: '+String(err.message||err)));
})();
