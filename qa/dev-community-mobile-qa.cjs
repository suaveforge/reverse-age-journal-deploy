'use strict';
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 let page;
 try{
  page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[],posts=[],messages=[];
  page.on('pageerror',err=>errors.push(err.message));
  await page.route('**/api/pilot/dev/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname,method=request.method();
   const reply=(payload,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(payload)});
   if(method==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,X-RAJ-DEV-TOKEN,X-RAJ-FILENAME','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'}});
   if(path.endsWith('/session')&&method==='POST')return reply({id:'m_fixture',nickname:'테스터',token:'f'.repeat(64)},201);
   if(path.endsWith('/session')&&method==='GET')return reply({id:'m_fixture',nickname:'테스터'});
   if(path.endsWith('/posts')&&method==='GET')return reply({posts});
   if(path.endsWith('/posts')&&method==='POST'){
    const body=request.postDataJSON(),value={id:'abc123',owner:'m_fixture',nickname:'테스터',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),title:body.title,body:body.body,files:[]};
    posts.push(value);return reply({ok:true,id:value.id},201);
   }
   if(path.endsWith('/posts/abc123')&&method==='GET')return reply({...posts[0],comments:[]});
   if(path.endsWith('/posts/abc123')&&method==='PATCH'){
    const body=request.postDataJSON();Object.assign(posts[0],body);return reply({ok:true,id:'abc123'});
   }
   if(path.endsWith('/posts/abc123')&&method==='DELETE'){posts.length=0;return reply({ok:true});}
   if(path.endsWith('/chat')&&method==='GET')return reply({messages});
   if(path.endsWith('/chat')&&method==='POST'){
    const body=request.postDataJSON(),value={id:'msg123',owner:'m_fixture',nickname:'테스터',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),body:body.body,files:[]};
    messages.push(value);return reply({id:value.id,ok:true},201);
   }
   if(path.endsWith('/chat/msg123')&&method==='PATCH'){
    messages[0].body=request.postDataJSON().body;return reply({ok:true,id:'msg123'});
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
  await page.locator('#raj-dev-new').click();
  await page.locator('#raj-dev-detail input[maxlength="180"]').fill('테스트 개선');
  await page.locator('#raj-dev-detail textarea[maxlength="12000"]').fill('게시판 입력 검증');
  await page.locator('#raj-dev-detail button[type="submit"]').first().click();
  await page.waitForFunction(()=>document.querySelector('#raj-dev-detail h3')?.textContent==='테스트 개선',{timeout:10000});
  if(posts.length!==1)throw Error('POST_NOT_CREATED');
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
  await page.locator('#raj-dev-chat-input').fill('공동 채팅 테스트');
  await page.locator('#raj-dev-chat-send').click();
  await page.waitForFunction(()=>document.querySelector('.raj-dev-msg p')?.textContent==='공동 채팅 테스트',{timeout:12000});
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
  console.log('RAJ_DEV_MOBILE_QA=PASS board=create/edit/delete chat=create/edit/delete fullscreen=PASS pwa-button=visible');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
