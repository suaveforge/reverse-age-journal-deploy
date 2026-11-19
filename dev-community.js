/* Reverse Age Journal shared development — separate from medical/Retell data. */
(() => {
'use strict';
const BASE=String(window.RAJ_CONFIG?.pilotApiBase||'').replace(/\/$/,'')+'/api/pilot/dev';
const SESSION_KEY='raj.dev.community.token.v1';
const $=id=>document.getElementById(id);
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e;};
const state={user:null,token:'',posts:[],messages:[],selected:null,board:false,chat:false,edit:null,chatTimer:0,chatSig:'',chatEditing:false};
let sessionPromise=null,drag=null;
const date=s=>{try{return new Intl.DateTimeFormat(document.documentElement.lang||'ko',{dateStyle:'short',timeStyle:'short'}).format(new Date(s));}catch{return s;}};
const errMap={DEV_RATE_LIMIT:'잠시 후 다시 작성해 주세요.',ATTACHMENT_TOO_LARGE_100MB:'파일당 최대 100MB까지 첨부할 수 있습니다.',ATTACHMENT_LIMIT:'한 번에 최대 12개까지 첨부할 수 있습니다.',DEV_SESSION_REQUIRED:'참여자 연결을 확인할 수 없습니다.'};
function toast(message){
 let t=$('raj-dev-toast');
 if(!t){t=node('div');t.id='raj-dev-toast';document.body.append(t);}
 t.textContent=String(message);t.hidden=false;clearTimeout(toast.timeout);
 toast.timeout=setTimeout(()=>{t.hidden=true;},4300);
}
async function api(path,method='GET',body=null,token=state.token){
 const headers={};
 if(token)headers['X-RAJ-DEV-TOKEN']=token;
 if(body!==null)headers['Content-Type']='application/json';
 const r=await fetch(BASE+path,{method,headers,body:body===null?undefined:JSON.stringify(body),cache:'no-store'});
 let data={};try{data=await r.json();}catch{}
 if(!r.ok)throw Error(errMap[data.detail]||data.detail||'HTTP '+r.status);
 return data;
}
function ensureSession(){
 if(sessionPromise)return sessionPromise;
 sessionPromise=(async()=>{
  let saved='';try{saved=localStorage.getItem(SESSION_KEY)||'';}catch{}
  if(saved){
   try{const user=await api('/session','GET',null,saved);state.token=saved;state.user=user;return user;}catch{}
  }
  const newUser=await api('/session','POST',{nickname:''},'');
  state.token=newUser.token;state.user={id:newUser.id,nickname:newUser.nickname};
  try{localStorage.setItem(SESSION_KEY,state.token);}catch{}
  return state.user;
 })().catch(e=>{sessionPromise=null;throw e;});
 return sessionPromise;
}
window.RAJ_DEV_SESSION=ensureSession;
function owner(row){return !!state.user&&row.owner===state.user.id;}
function button(text,cls,onClick){const b=node('button',cls,text);b.type='button';if(onClick)b.addEventListener('click',onClick);return b;}
function dateMeta(row){
 const meta=node('div','raj-dev-meta');
 meta.append(node('span','',row.nickname||'참여자'),node('span','',date(row.created_at)));
 if(row.updated_at!==row.created_at)meta.append(node('span','','수정됨'));
 return meta;
}
function renderFiles(holder,files){
 if(!Array.isArray(files)||!files.length)return;
 const wrap=node('div','raj-dev-files');
 for(const file of files){
  if(!/^[a-f0-9]{32}$/.test(file.id||''))continue;
  const url=BASE+'/files/'+file.id;
  const mime=String(file.mime||'');
  if(mime.startsWith('image/')){
   const a=node('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';
   const img=node('img','raj-dev-media');img.src=url;img.alt=file.name||'첨부 이미지';img.loading='lazy';
   a.append(img);wrap.append(a);
  }else if(mime.startsWith('video/')){
   const video=node('video','raj-dev-media');video.src=url;video.controls=true;video.preload='metadata';video.setAttribute('playsinline','');wrap.append(video);
  }else if(mime.startsWith('audio/')){
   const audio=node('audio');audio.src=url;audio.controls=true;audio.preload='none';wrap.append(audio);
  }else{
   const row=node('div','raj-dev-file');
   const a=node('a','',file.name||'첨부 파일');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.download=file.name||'attachment';
   row.append(node('span','','📎'),a,node('small','',Math.ceil((file.size||0)/1024)+'KB'));wrap.append(row);
  }
 }
 holder.append(wrap);
}
async function uploadSelected(files,buttonToDisable){
 const uploaded=[];
 if(files.length>12)throw Error('최대 12개까지 첨부할 수 있습니다.');
 if(buttonToDisable)buttonToDisable.disabled=true;
 try{
  for(const file of files){
   if(file.size>100*1024*1024)throw Error('100MB 초과: '+file.name);
   toast('첨부 중 · '+file.name);
   const res=await fetch(BASE+'/uploads',{
    method:'POST',
    headers:{'X-RAJ-DEV-TOKEN':state.token,'X-RAJ-FILENAME':encodeURIComponent(file.name),'Content-Type':file.type||'application/octet-stream'},
    body:file
   });
   const data=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(errMap[data.detail]||data.detail||'업로드 HTTP '+res.status);
   uploaded.push(data.id);
  }
 }finally{if(buttonToDisable)buttonToDisable.disabled=false;}
 return uploaded;
}
async function ownName(){
 try{
  await ensureSession();
  const name=window.prompt('공동개발에서 사용할 이름',state.user.nickname);
  if(!name||!name.trim())return;
  state.user=await api('/session','PATCH',{nickname:name.trim()});
  toast('표시 이름을 변경했습니다.');
  await Promise.all([refreshBoard(),refreshChat()]);
 }catch(e){toast(e.message);}
}
function setup(){
 if($('raj-dev-dock'))return;
 const dock=node('nav');dock.id='raj-dev-dock';dock.setAttribute('aria-label','공동개발 도구');
 dock.append(
  button('✎ 건의 게시판','',()=>openBoard()),
  button('◉ 공동 채팅','',()=>toggleChat()),
  button('앱 설치·알림','',()=>{}) // Unified PWA setup attaches its own listener.
 );
 dock.children[0].id='raj-dev-board-toggle';
 dock.children[1].id='raj-dev-chat-toggle';
 dock.children[2].id='raj-app-setup';
 document.body.append(dock);
 const overlay=node('div','raj-dev-overlay');overlay.id='raj-dev-overlay';overlay.hidden=true;
 overlay.innerHTML=[
  '<section class="raj-dev-board" role="dialog" aria-modal="true" aria-label="공동개발 건의 게시판">',
  '<header class="raj-dev-head"><div class="raj-dev-grow"><h2>함께 만드는 기쁜사이</h2><p>건의 · 오류 · 개선 제안 / 개인정보·상담기록은 올리지 마세요</p></div>',
  '<button id="raj-dev-name" class="raj-dev-btn" type="button">참여자</button>',
  '<button id="raj-dev-review" class="raj-dev-btn" type="button">GPT 분석 링크</button>',
  '<button id="raj-dev-board-close" class="raj-dev-icon-button" aria-label="닫기" type="button">×</button></header>',
  '<div class="raj-dev-body"><section class="raj-dev-list">',
  '<div class="raj-dev-toolbar"><input id="raj-dev-search" placeholder="건의 검색" aria-label="건의 검색"><button id="raj-dev-new" class="raj-dev-btn primary" type="button">+ 새 글</button></div>',
  '<div id="raj-dev-items"></div></section>',
  '<section id="raj-dev-detail" class="raj-dev-detail"><p class="raj-dev-empty">건의를 선택하거나 새 글을 작성하세요.</p></section>',
  '</div></section>'
 ].join('');
 document.body.append(overlay);
 const chat=node('aside','raj-dev-chat');chat.id='raj-dev-chat';chat.hidden=true;
 chat.setAttribute('role','dialog');chat.setAttribute('aria-label','공동개발 채팅');
 chat.innerHTML=[
  '<header class="raj-dev-chat-handle" id="raj-dev-chat-handle" tabindex="0"><strong>공동개발 채팅</strong>',
  '<button id="raj-dev-chat-name" type="button" title="이름 변경">이름</button>',
  '<button id="raj-dev-chat-close" type="button" aria-label="채팅 닫기">×</button></header>',
  '<div id="raj-dev-chat-log" class="raj-dev-chat-log" role="log"></div>',
  '<form id="raj-dev-chat-form" class="raj-dev-chat-form">',
  '<input id="raj-dev-chat-files" type="file" multiple accept="image/*,video/*,audio/*,.pdf,.zip,.doc,.docx,.xlsx,.txt">',
  '<div class="raj-dev-chat-compose"><textarea id="raj-dev-chat-input" maxlength="4000" aria-label="메시지 입력" placeholder="메시지 입력 (Enter 전송)"></textarea>',
  '<button id="raj-dev-chat-send" class="raj-dev-btn primary" type="submit">전송</button></div></form>'
 ].join('');
 document.body.append(chat);
 $('raj-dev-board-close').onclick=closeBoard;
 $('raj-dev-chat-close').onclick=()=>toggleChat();
 $('raj-dev-new').onclick=()=>postEditor();
 $('raj-dev-name').onclick=ownName;
 $('raj-dev-chat-name').onclick=ownName;
 $('raj-dev-search').oninput=renderPostList;
 $('raj-dev-review').onclick=async()=>{
  const url=BASE+'/review-export';
  try{await navigator.clipboard.writeText(url);toast('GPT 분석 링크 복사 완료 · ChatGPT에서 이 주소를 열어 검토할 수 있어요.');}
  catch{window.prompt('ChatGPT 분석용 자료 주소를 복사하세요.',url);}
 };
 $('raj-dev-chat-form').addEventListener('submit',sendChat);
 $('raj-dev-chat-input').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('raj-dev-chat-form').requestSubmit();}
 });
 overlay.addEventListener('click',e=>{if(e.target===overlay)closeBoard();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.board)closeBoard();});
 window.addEventListener('resize',sizeChat);
 window.visualViewport?.addEventListener('resize',sizeChat);
 window.visualViewport?.addEventListener('scroll',sizeChat);
 setupDragging();
 if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',e=>{
  if(e.data?.type!=='RAJ_DEV_OPEN')return;
  if(e.data.tab==='chat'){if(!state.chat)void toggleChat();}
  else if(!state.board)void openBoard();
 });
 if(new URLSearchParams(location.search).get('dev')==='board')void openBoard();
 if(new URLSearchParams(location.search).get('dev')==='chat')void toggleChat();
}
async function openBoard(){
 state.board=true;$('raj-dev-overlay').hidden=false;document.body.style.overflow='hidden';
 try{
  await ensureSession();
  $('raj-dev-name').textContent=state.user.nickname+' · 수정';
  await refreshBoard();
 }catch(e){toast('게시판 연결 실패 · '+e.message);}
}
function closeBoard(){state.board=false;$('raj-dev-overlay').hidden=true;document.body.style.overflow='';}
async function refreshBoard(){
 if(!state.board)return;
 const data=await api('/posts');state.posts=data.posts||[];renderPostList();
 if(state.selected)await openPost(state.selected,false);
}
function renderPostList(){
 const box=$('raj-dev-items');box.replaceChildren();
 const q=($('raj-dev-search').value||'').toLowerCase().trim();
 const shown=state.posts.filter(x=>!q||(x.title+' '+x.body+' '+x.nickname).toLowerCase().includes(q));
 if(!shown.length){box.append(node('p','raj-dev-empty','등록된 건의가 없습니다. 첫 번째 제안을 남겨주세요.'));return;}
 shown.forEach(post=>{
  const row=button('','raj-dev-item'+(state.selected===post.id?' active':''),()=>openPost(post.id));
  row.append(node('strong','',post.title));
  const meta=dateMeta(post);meta.append(node('span','',(post.files||[]).length?'📎 '+post.files.length:''));
  row.append(meta);
  box.append(row);
 });
}
async function openPost(id,rerender=true){
 state.selected=id;const target=$('raj-dev-detail');
 if(rerender)renderPostList();
 try{
  const post=await api('/posts/'+id);
  target.replaceChildren();
  const bar=node('div','raj-dev-toolbar');
  if(owner(post)){
   bar.append(button('수정','raj-dev-btn',()=>postEditor(post)),button('삭제','raj-dev-btn danger',async()=>{
    if(!window.confirm('이 글과 첨부파일, 댓글을 삭제할까요?'))return;
    try{await api('/posts/'+id,'DELETE');state.selected=null;await refreshBoard();target.replaceChildren(node('p','raj-dev-empty','삭제했습니다.'));}
    catch(e){toast(e.message);}
   }));
  }
  target.append(bar,node('h3','',post.title),dateMeta(post),node('p','raj-dev-text',post.body));
  renderFiles(target,post.files);
  const title=node('h3','','댓글 '+(post.comments?.length||0));title.style.cssText='font-size:16px;margin-top:25px';
  target.append(title);
  (post.comments||[]).forEach(comment=>{
   const div=node('article','raj-dev-comment');div.append(dateMeta(comment),node('p','',comment.body));
   if(owner(comment)){
    div.append(button('수정','raj-dev-link',async()=>{
     const v=window.prompt('댓글 수정',comment.body);
     if(v===null||!v.trim())return;
     try{await api('/comments/'+comment.id,'PATCH',{body:v});await openPost(id,false);}catch(e){toast(e.message);}
    }),button('삭제','raj-dev-link',async()=>{
     if(!window.confirm('댓글을 삭제할까요?'))return;
     try{await api('/comments/'+comment.id,'DELETE');await openPost(id,false);}catch(e){toast(e.message);}
    }));
   }
   target.append(div);
  });
  const form=node('form','raj-dev-comment-form');
  const input=node('textarea');input.placeholder='댓글 남기기';input.maxLength=4000;
  form.append(input,button('등록','raj-dev-btn primary',null));
  form.lastChild.type='submit';
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(!input.value.trim())return;
   form.lastChild.disabled=true;
   try{await api('/posts/'+id+'/comments','POST',{body:input.value});await openPost(id,false);}
   catch(err){toast(err.message);}finally{form.lastChild.disabled=false;}
  });target.append(form);
 }catch(e){toast('글 읽기 실패 · '+e.message);}
}
function postEditor(post=null){
 state.selected=post?.id||null;renderPostList();
 const target=$('raj-dev-detail');target.replaceChildren();
 target.append(node('h3','',post?'건의 수정':'새로운 건의'));
 const form=node('form','raj-dev-compose');
 const title=node('input');title.placeholder='제목';title.maxLength=180;title.required=true;title.value=post?.title||'';
 const body=node('textarea');body.placeholder='개선할 점, 오류 재현 방법, 원하는 기능을 자세히 적어주세요.';body.maxLength=12000;body.value=post?.body||'';
 const file=node('input');file.type='file';file.multiple=true;
 file.setAttribute('aria-label','이미지 영상 문서 파일 첨부');
 const hint=node('small','','이미지·동영상·음성·PDF·ZIP 등 파일당 100MB, 한 글당 12개까지');
 const existing=node('div','raj-dev-files');const retained=new Set((post?.files||[]).map(f=>f.id));
 (post?.files||[]).forEach(f=>{
  const row=node('span','raj-dev-file');row.append(node('span','',f.name));
  row.append(button('×','raj-dev-icon-button',()=>{retained.delete(f.id);row.remove();}));
  existing.append(row);
 });
 const actions=node('div','raj-dev-toolbar');
 const save=button(post?'수정 저장':'건의 등록','raj-dev-btn primary');save.type='submit';
 actions.append(save,button('취소','raj-dev-btn',()=>post?openPost(post.id):target.replaceChildren()));
 form.append(title,body,file,hint,existing,actions);
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(!title.value.trim())return;
  save.disabled=true;
  try{
   const ids=await uploadSelected([...file.files],null);
   const payload={title:title.value,body:body.value,file_ids:[...retained,...ids]};
   const res=await api(post?'/posts/'+post.id:'/posts',post?'PATCH':'POST',payload);
   await refreshBoard();await openPost(res.id);
   toast(post?'건의를 수정했습니다.':'건의를 등록했습니다.');
  }catch(e){toast('저장 실패 · '+e.message);}finally{save.disabled=false;}
 });
 target.append(form);title.focus();
}
function chatSignature(msg){return msg.map(x=>[x.id,x.updated_at,x.body,(x.files||[]).map(f=>f.id).join(',')].join('|')).join('|');}
async function refreshChat(force=false){
 if(!state.chat||(state.chatEditing&&!force))return;
 const data=await api('/chat');
 const messages=data.messages||[];
 const sig=chatSignature(messages);
 if(!force&&state.chatSig===sig)return;
 const log=$('raj-dev-chat-log'),stick=log.scrollHeight-log.scrollTop-log.clientHeight<110;
 state.chatSig=sig;state.messages=messages;log.replaceChildren();
 for(const message of messages){
  const bubble=node('article','raj-dev-msg'+(owner(message)?' mine':''));
  bubble.append(dateMeta(message),node('p','',message.body));
  renderFiles(bubble,message.files);
  if(owner(message)){
   const tools=node('div','raj-dev-toolbar');
   tools.style.marginBottom='0';
   tools.append(button('수정','raj-dev-link',()=>editChat(message,bubble)),
                button('삭제','raj-dev-link',async()=>{
                 if(!window.confirm('메시지와 첨부파일을 삭제할까요?'))return;
                 try{await api('/chat/'+message.id,'DELETE');state.chatSig='';await refreshChat(true);}catch(e){toast(e.message);}
                }));
   bubble.append(tools);
  }
  log.append(bubble);
 }
 if(stick)log.scrollTop=log.scrollHeight;
}
function editChat(message,bubble){
 state.chatEditing=true;
 bubble.replaceChildren(dateMeta(message));
 const form=node('form','raj-dev-compose');
 const field=node('textarea');field.value=message.body;field.maxLength=4000;
 field.style.minHeight='68px';
 const file=node('input');file.type='file';file.multiple=true;
 const retained=new Set((message.files||[]).map(f=>f.id));
 const existing=node('div','raj-dev-files');
 (message.files||[]).forEach(f=>{
  const row=node('span','raj-dev-file',f.name);
  row.append(button('×','raj-dev-link',()=>{retained.delete(f.id);row.remove();}));
  existing.append(row);
 });
 const controls=node('div','raj-dev-toolbar');
 const save=button('저장','raj-dev-btn primary');save.type='submit';
 controls.append(save,button('취소','raj-dev-btn',()=>{state.chatEditing=false;refreshChat(true);}));
 form.append(field,file,existing,controls);bubble.append(form);
 form.addEventListener('submit',async e=>{
  e.preventDefault();save.disabled=true;
  try{
   const ids=await uploadSelected([...file.files]);
   await api('/chat/'+message.id,'PATCH',{body:field.value,file_ids:[...retained,...ids]});
   state.chatEditing=false;state.chatSig='';await refreshChat(true);
  }catch(e){toast(e.message);}finally{save.disabled=false;}
 });
 field.focus();
}
async function sendChat(e){
 e.preventDefault();
 const input=$('raj-dev-chat-input'),file=$('raj-dev-chat-files'),send=$('raj-dev-chat-send');
 if(!input.value.trim()&&!file.files.length)return;
 send.disabled=true;
 try{
  await ensureSession();
  const ids=await uploadSelected([...file.files]);
  await api('/chat','POST',{body:input.value,file_ids:ids});
  input.value='';file.value='';state.chatSig='';await refreshChat(true);
 }catch(err){toast('전송 실패 · '+err.message);}finally{send.disabled=false;}
}
async function toggleChat(){
 state.chat=!state.chat;
 $('raj-dev-chat').hidden=!state.chat;
 $('raj-dev-chat-toggle').setAttribute('aria-pressed',String(state.chat));
 if(state.chatTimer){clearInterval(state.chatTimer);state.chatTimer=0;}
 if(!state.chat)return;
 sizeChat();
 try{
  await ensureSession();$('raj-dev-chat-name').textContent=state.user.nickname;
  await refreshChat(true);
  state.chatTimer=setInterval(()=>{if(!document.hidden&&!$('raj-dev-chat').hidden)refreshChat().catch(()=>{});},3000);
  if(window.innerWidth>740)$('raj-dev-chat-input').focus();
 }catch(e){toast('채팅 연결 실패 · '+e.message);}
}
function sizeChat(){
 if(window.innerWidth<=740){
  const v=window.visualViewport;
  $('raj-dev-chat')?.style.setProperty('--raj-visual-height',(v?.height||window.innerHeight)+'px');
 }else $('raj-dev-chat')?.style.removeProperty('--raj-visual-height');
}
function setupDragging(){
 const panel=$('raj-dev-chat'),bar=$('raj-dev-chat-handle');
 bar.addEventListener('pointerdown',e=>{
  if(window.innerWidth<=740||e.button!==0||e.target.closest('button,input,textarea'))return;
  const r=panel.getBoundingClientRect();
  drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top};
  bar.setPointerCapture(e.pointerId);e.preventDefault();
 });
 bar.addEventListener('pointermove',e=>{
  if(!drag||drag.id!==e.pointerId)return;
  const r=panel.getBoundingClientRect();
  const left=Math.max(4,Math.min(window.innerWidth-r.width-4,drag.left+e.clientX-drag.x));
  const top=Math.max(4,Math.min(window.innerHeight-r.height-4,drag.top+e.clientY-drag.y));
  Object.assign(panel.style,{left:left+'px',top:top+'px',right:'auto',bottom:'auto'});
 });
 const finish=e=>{if(drag?.id===e.pointerId){drag=null;try{bar.releasePointerCapture(e.pointerId);}catch{}}};
 bar.addEventListener('pointerup',finish);bar.addEventListener('pointercancel',finish);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});
else setup();
})();
