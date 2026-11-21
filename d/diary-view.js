'use strict';
(() => {
  const status=document.getElementById('diary-status');
  const article=document.getElementById('diary-article');
  const token=decodeURIComponent(location.hash.slice(1));
  // The URL fragment is never transmitted to GitHub Pages or Retell.
  // Only the specific private API request receives it in an authorization header.
  const base=String(window.RAJ_CONFIG?.pilotApiBase||'').replace(/\/$/,'');
  const showError=()=>{status.textContent='이 일기를 열 수 없어요. 링크가 만료되었거나 보관 동의가 취소되었을 수 있어요.';status.hidden=false;article.hidden=true;};
  if(!/^[A-Za-z0-9_-]{16}$/.test(token)||!base.startsWith('https://')){
    showError();return;
  }
  fetch(base+'/api/pilot/member-diaries/view',{
    method:'GET',headers:{'X-RAJ-DIARY-LINK':token},cache:'no-store',
    credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'
  }).then(async res=>{
    if(!res.ok)throw Error('Diary unavailable');
    const data=await res.json();
    if(!data||!data.diary||typeof data.diary.body!=='string')throw Error('Invalid diary');
    return data.diary;
  }).then(d=>{
    document.getElementById('diary-title').textContent=d.title||'오늘의 이야기';
    document.getElementById('diary-body').textContent=d.body;
    const date=new Date(d.created_at);
    document.getElementById('diary-date').textContent=
      Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'}).format(date);
    status.hidden=true;article.hidden=false;
  }).catch(showError);
})();