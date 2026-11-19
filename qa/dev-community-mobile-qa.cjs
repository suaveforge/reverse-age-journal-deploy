'use strict';
const {chromium}=require('playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 let page;
 try{
  page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[],posts=[],messages=[],uploads=[];
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  // Serve checked-out candidate JS/CSS regardless of Pages deployment timing.
  for(const name of ['dev-community.js','dev-community.css'])
   await page.route('**/'+name+'*',route=>route.fulfill({
    status:200,contentType:name.endsWith('.js')?'text/javascript':'text/css',
    body:fs.readFileSync(name,'utf8')
   }));
  const recordFiles=ids=>ids.map(id=>uploads.find(f=>f.id===id)).filter(Boolean);
  page.on('pageerror',err=>errors.push(err.message));
  await page.route('**/api/pilot/dev/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname,method=request.method();
   const reply=(payload,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(payload)});
   if(method==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,X-RAJ-DEV-TOKEN,X-RAJ-FILENAME','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'}});
   if(path.endsWith('/uploads')&&method==='POST'){
    const id=(uploads.length+1).toString(16).padStart(32,'0');
    const value={id,name:decodeURIComponent(request.headers()['x-raj-filename']||'attachment.png'),
     mime:request.headers()['content-type']||'application/octet-stream',
     size:(request.postDataBuffer()||Buffer.alloc(0)).length,url:'/api/pilot/dev/files/'+id};
    uploads.push(value);return reply(value,201);
   }
   if(path.includes('/files/')&&method==='GET')return route.fulfill({
    status:200,contentType:'image/png',
    body:Buffer.from([137,80,78,71,13,10,26,10])
   });
   if(path.endsWith('/session')&&method==='POST')return reply({id:'m_fixture',nickname:'테스터',token:'f'.repeat(64)},201);
   if(path.endsWith('/session')&&method==='GET')return reply({id:'m_fixture',nickname:'테스터'});
   if(path.endsWith('/posts')&&method==='GET')return reply({posts});
   if(path.endsWith('/posts')&&method==='POST'){
    const body=request.postDataJSON(),value={id:'abc123',owner:'m_fixture',nickname:'테스터',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),title:body.title,body:body.body,files:recordFiles(body.file_ids||[])};
    posts.push(value);return reply({ok:true,id:value.id},201);
   }
   if(path.endsWith('/posts/abc123')&&method==='GET')return reply({...posts[0],comments:[]});
   if(path.endsWith('/posts/abc123')&&method==='PATCH'){
    const body=request.postDataJSON();Object.assign(posts[0],body,{files:recordFiles(body.file_ids||[])});return reply({ok:true,id:'abc123'});
   }
   if(path.endsWith('/posts/abc123')&&method==='DELETE'){posts.length=0;return reply({ok:true});}
   if(path.endsWith('/chat')&&method==='GET')return reply({messages});
   if(path.endsWith('/chat')&&method==='POST'){
    const body=request.postDataJSON(),value={id:'msg123',owner:'m_fixture',nickname:'테스터',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),body:body.body,files:recordFiles(body.file_ids||[])};
    messages.push(value);return reply({id:value.id,ok:true},201);
   }
   if(path.endsWith('/chat/msg123')&&method==='PATCH'){
    const body=request.postDataJSON();messages[0].body=body.body;messages[0].files=recordFiles(body.file_ids||[]);return reply({ok:true,id:'msg123'});
   }
   if(path.endsWith('/chat/msg123')&&method==='DELETE'){messages.length=0;return reply({ok:true});}
   if(path.endsWith('/push/config'))return reply({publicKey:''});
   return reply({detail:'unknown mocked route '+path},404);
  });
  await page.goto(process.env.QA_BASE_URL||'https://reverse-age-journal.suaveforge.com/',{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#raj-dev-dock').waitFor({state:'visible',timeout:18000});
  for(const id of ['raj-dev-board-toggle','raj-dev-chat-toggle','raj-app-setup'])
   if(!await page.locator('#'+id).isVisible())throw Error('MISSING_DOCK_'+id);
  await page.locator('#raj-dev-board-toggle').click();
  if(await page.locator('#raj-dev-review').count())throw Error('PUBLIC_GPT_LINK_STILL_VISIBLE');
  await page.locator('#raj-dev-new').click();
  await page.locator('#raj-dev-detail input[maxlength="180"]').fill('테스트 개선');
  const postText=page.locator('#raj-dev-detail textarea[maxlength="12000"]');
  await postText.fill('게시판 입력 검증');
  await postText.focus();
  await page.evaluate(()=>navigator.clipboard.writeText(' 텍스트 붙여넣기'));
  await page.keyboard.press('Control+V');
  if(!(await postText.inputValue()).includes('텍스트 붙여넣기'))
   throw Error('BOARD_TEXT_CLIPBOARD_PASTE_FAILED');
  await postText.evaluate(el=>{
   const clipboardData=new DataTransfer();
   clipboardData.items.add(new File([new Uint8Array([137,80,78,71,13,10,26,10])],
     'clipboard.png',{type:'image/png'}));
   el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));
  });
  await page.waitForFunction(()=>document.querySelectorAll('#raj-dev-detail .raj-dev-pending-file').length===1);
  await page.locator('#raj-dev-detail .raj-dev-compose').evaluate(el=>{
   const dataTransfer=new DataTransfer();
   dataTransfer.items.add(new File(['drop content'],'dropped.txt',{type:'text/plain'}));
   el.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer}));
   el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));
  });
  await page.waitForFunction(()=>document.querySelectorAll('#raj-dev-detail .raj-dev-pending-file').length===2);
  await page.locator('#raj-dev-detail .raj-dev-pending-file button').last().click();
  if(await page.locator('#raj-dev-detail .raj-dev-pending-file').count()!==1)
   throw Error('BOARD_PENDING_ATTACHMENT_REMOVE_FAILED');
  await page.locator('#raj-dev-detail button[type="submit"]').first().click();
  await page.waitForFunction(()=>document.querySelector('#raj-dev-detail h3')?.textContent==='테스트 개선',{timeout:10000});
  if(posts.length!==1||posts[0].files.length!==1||uploads.length!==1)
   throw Error('POST_MEDIA_NOT_SAVED '+JSON.stringify({posts,uploads:uploads.length}));
  await page.locator('#raj-dev-detail button').filter({hasText:'본문 복사'}).click();
  if(!(await page.evaluate(()=>navigator.clipboard.readText())).includes('게시판 입력 검증'))
   throw Error('POST_COPY_FAILED');
  await page.locator('#raj-dev-detail button').filter({hasText:'수정'}).first().click();
  await page.locator('#raj-dev-detail input[maxlength="180"]').fill('게시판 수정 완료');
  await page.locator('#raj-dev-detail button[type="submit"]').first().click();
  await page.waitForFunction(()=>document.querySelector('#raj-dev-detail h3')?.textContent==='게시판 수정 완료',{timeout:10000});
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#raj-dev-detail button').filter({hasText:'삭제'}).first().click();
  await page.waitForFunction(()=>document.querySelector('#raj-dev-items')?.textContent.includes('등록된 건의가 없습니다'),{timeout:10000});
  if(posts.length)throw Error('POST_DELETE_NOT_APPLIED');
  await page.locator('#raj-dev-board-close').click();
  await page.locator('#raj-dev-chat-toggle').click();
  const chatInput=page.locator('#raj-dev-chat-input');
  await chatInput.fill('공동 채팅 테스트');
  await chatInput.focus();
  await page.evaluate(()=>navigator.clipboard.writeText(' 붙여넣기'));
  await page.keyboard.press('Control+V');
  if(!(await chatInput.inputValue()).includes('붙여넣기'))throw Error('CHAT_TEXT_PASTE_FAILED');
  await chatInput.evaluate(el=>{
   const data=new DataTransfer();
   data.items.add(new File([new Uint8Array([137,80,78,71,13,10,26,10])],
     'chat-clipboard.png',{type:'image/png'}));
   el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  });
  await page.waitForFunction(()=>document.querySelectorAll('#raj-dev-chat-form .raj-dev-pending-file').length===1);
  await page.locator('#raj-dev-chat-send').click();
  await page.waitForFunction(()=>document.querySelector('.raj-dev-msg p')?.textContent.includes('공동 채팅 테스트'),{timeout:12000});
  if(messages.length!==1||messages[0].files.length!==1)throw Error('CHAT_IMAGE_NOT_SAVED');
  await page.locator('.raj-dev-msg.mine button').filter({hasText:'복사'}).click();
  if(!(await page.evaluate(()=>navigator.clipboard.readText())).includes('공동 채팅 테스트'))
   throw Error('CHAT_COPY_FAILED');
  const chatBox=await page.locator('#raj-dev-chat').boundingBox();
  if(chatBox.x>1||chatBox.width<389||chatBox.height<830)throw Error('MOBILE_CHAT_NOT_FULLSCREEN '+JSON.stringify(chatBox));
  await page.locator('.raj-dev-msg.mine button').filter({hasText:'수정'}).first().click();
  await page.locator('.raj-dev-msg.mine textarea').fill('채팅 수정 완료');
  await page.locator('.raj-dev-msg.mine button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('.raj-dev-msg p')?.textContent==='채팅 수정 완료',{timeout:12000});
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('.raj-dev-msg.mine button').filter({hasText:'삭제'}).first().click();
  await page.waitForFunction(()=>!document.querySelector('.raj-dev-msg'),{timeout:12000});
  if(messages.length)throw Error('CHAT_DELETE_NOT_APPLIED');
  if(errors.length)throw Error('BROWSER_ERRORS '+errors.join('|'));
  console.log('RAJ_DEV_CLIPBOARD_QA=PASS text-copy/paste=PASS image-paste=PASS file-drag-drop=PASS removable-preview=PASS board-chat-edit-delete=PASS no-public-GPT-link=PASS');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
