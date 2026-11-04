import { chromium } from 'playwright';
import fs from 'node:fs';
fs.mkdirSync('qa-screenshots',{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
let count=0;
async function audit(page,name,width,height){
  await page.setViewportSize({width,height});
  await page.waitForTimeout(280);
  const check=await page.evaluate(()=>{
    const all=Array.from(document.querySelectorAll('body *')).filter(el=>{
      const s=getComputedStyle(el),r=el.getBoundingClientRect();
      return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0;
    });
    const out=all.filter(el=>el.getBoundingClientRect().right>innerWidth+3||el.getBoundingClientRect().left< -3);
    return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      overflow:out.slice(0,6).map(el=>({tag:el.tagName,id:el.id,cls:String(el.className).slice(0,65)}))};
  });
  if(check.scrollWidth>width+3||check.overflow.length)throw Error(name+': horizontal overflow '+JSON.stringify(check));
  await page.screenshot({path:'qa-screenshots/'+name+'.png',fullPage:true});
  console.log('PASS '+name+' '+width+'x'+height+' no horizontal overflow');
  count++;
}
for(const [label,width,height] of [['desktop',1248,900],['mobile',390,844]]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  const uncaught=[];
  page.on('pageerror',err=>uncaught.push(err.message));
  // All phone-auth routes are synthetic; no SMS is ever dispatched in visual QA.
  await page.route('**/api/pilot/family/auth/**',route=>{
    const u=route.request().url(), method=route.request().method();
    const payload=u.endsWith('/capabilities')?{sms_available:true}:
      u.endsWith('/request')?{requested:true,expires_in_seconds:300}:
      u.endsWith('/verify')?{authenticated:true,token:'synthetic-verified-guardian-session-token-12345678',registered:false}:
      u.endsWith('/session')?{authenticated:true,registered:false,phone_last4:'5678'}:{};
    route.fulfill({status:200,contentType:'application/json',
      headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'},
      body:JSON.stringify(payload)});
  });
  await page.route('**/api/pilot/family/onboarding',route=>route.fulfill({
    status:404,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},
    body:JSON.stringify({detail:'FAMILY_NOT_REGISTERED'})
  }));
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
  await page.locator('.family-opening').waitFor({state:'visible',timeout:12000});
  const leaf=await page.locator('.family-opening-leaf').boundingBox();
  const heading=await page.locator('.family-opening-heading').boundingBox();
  const btn=await page.locator('#family-start').boundingBox();
  if(!leaf||leaf.width>160||leaf.height>170||!heading||!btn||btn.y<heading.y+heading.height-15)
    throw Error('Bad locked opening geometry '+JSON.stringify({leaf,heading,btn}));
  if((await page.locator('.family-opening-heading').innerText()).replace(/\s/g,'').indexOf('내일의일기가됩니다')<0)
    throw Error('Approved text lost');
  await audit(page,'01-home-'+label,width,height);
  await page.locator('#family-start').click();
  await page.locator('#family-login-form').waitFor({state:'visible',timeout:10000});
  await audit(page,'02-phone-login-'+label,width,height);
  await page.locator('#family-login-phone').fill('01012345678');
  await page.locator('#family-request-code').click();
  await page.locator('#family-code-form').waitFor({state:'visible',timeout:10000});
  await audit(page,'02-otp-code-'+label,width,height);
  await page.locator('#family-login-code').fill('123456');
  await page.locator('#family-confirm-code').click();
  await page.locator('#family-guardian-form').waitFor({state:'visible',timeout:10000});
  await audit(page,'02-family-contact-'+label,width,height);
  await page.locator('#family-name').fill('QA가족');
  const lockedPhone=await page.locator('#guardian-phone').getAttribute('readonly');
  if(lockedPhone===null)throw Error('Verified phone number is editable');
  await page.locator('#family-next').click();
  await page.locator('#family-elder-form').waitFor({state:'visible',timeout:10000});
  await audit(page,'03-elder-registration-'+label,width,height);
  await page.locator('#admin-entry').click();
  await page.locator('#pilot-login').waitFor({state:'visible',timeout:10000});
  await audit(page,'04-counselor-login-'+label,width,height);
  await page.evaluate(()=>{
    document.querySelector('#pilot-login').hidden=true;
    document.querySelector('#pilot-management').hidden=false;
    document.querySelector('.pilot-section-head').hidden=true;
    document.querySelector('.ops-tabs').hidden=false;
    document.querySelector('.page').classList.add('counselor-mode');
    document.querySelector('.page').classList.remove('family-mode');
    document.querySelectorAll('[data-ops-panel]').forEach(p=>{p.hidden=p.dataset.opsPanel!=='info';});
    document.querySelector('#ops-create-panel').hidden=false;
    document.querySelector('#ops-subject-panel').hidden=false;
    document.querySelector('#ops-profile-details').hidden=true;
    document.querySelector('#ops-outbox-panel').hidden=true;
    document.querySelector('#pilot-call-panel').hidden=true;
    document.querySelector('#pilot-results').hidden=true;
    document.querySelector('#pilot-draft-panel').hidden=true;
    document.querySelector('#pilot-saved').hidden=true;
  });
  await audit(page,'05-counselor-info-preview-'+label,width,height);
  for(const tab of ['call','tickets','record']){
    await page.evaluate(tab=>{
      document.querySelectorAll('[data-ops-panel]').forEach(p=>{p.hidden=p.dataset.opsPanel!==tab;});
      document.querySelector('#ops-outbox-panel').hidden=true;
      document.querySelector('#pilot-call-panel').hidden=tab!=='call';
      document.querySelector('#pilot-results').hidden=true;
      document.querySelector('#pilot-draft-panel').hidden=true;
      document.querySelector('#pilot-saved').hidden=true;
      document.querySelectorAll('[data-ops-tab]').forEach(b=>b.classList.toggle('active',b.dataset.opsTab===tab));
    },tab);
    await audit(page,'05-counselor-'+tab+'-preview-'+label,width,height);
  }
  await page.close();
  // A returning buyer must regain the same purchases and top-up control after session restore.
  const buyer=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  await buyer.addInitScript(()=>{
    localStorage.setItem('raj.family.account.v1','synthetic-verified-guardian-session-token-12345678');
  });
  await buyer.route('**/api/pilot/family/**',route=>{
    const url=route.request().url();
    const data=url.endsWith('/auth/session')?{authenticated:true,registered:true,phone_last4:'5678'}:
      url.endsWith('/onboarding')?{registered:true,elder_name:'QA어르신',consent:'CONFIRMED',balance:4,share_requested:false,share_approved:false}:
      url.endsWith('/account')?{registered:true,elder_name:'QA어르신',balance:4,purchases:[{id:'ord_fixture',sessions:5,amount_krw:1000,paid_at:'2026-11-01T12:00:00Z'}],usage:[{sessions:1,at:'2026-11-01T14:00:00Z'}]}:
      url.endsWith('/summary')?{shared:false,reports:[]}:
      url.endsWith('/payment-ready')?{ready:true,packages:[{code:'FIVE',sessions:5,price_krw:1000}]}:{};
    route.fulfill({status:200,contentType:'application/json',
      headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'},
      body:JSON.stringify(data)});
  });
  await buyer.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
  await buyer.locator('#family-start').click();
  await buyer.locator('#family-purchases').getByText('1,000원 · 5회').waitFor({state:'visible',timeout:12000});
  if(!(await buyer.locator('#family-tickets').innerText()).includes('구매 5회 · 사용 1회'))
    throw Error('Guardian account ledger does not reconcile visibly');
  await buyer.locator('#family-open-plans').waitFor({state:'visible'});
  await audit(buyer,'05-guardian-account-and-topup-'+label,width,height);
  await buyer.close();
  // Restore a real historical guest without its old browser session.
  // Synthetic SMS and orders only; nothing sent to Retell, PayHub or an elder.
  const legacy=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  legacy.on('pageerror',err=>uncaught.push(err.message));
  let recovered=false;
  await legacy.route('**/api/pilot/family/**',route=>{
    const url=route.request().url();
    let status=200, data={};
    if(url.endsWith('/auth/capabilities'))data={sms_available:true};
    else if(url.endsWith('/auth/request'))data={requested:true,expires_in_seconds:300};
    else if(url.endsWith('/auth/verify')){
      const body=route.request().postDataJSON();
      if(body.phone!=='01012345678'||body.code!=='123456'
          ||body.elder_phone || body.guardian_name)
        throw Error('Legacy login unexpectedly requires elder details');
      recovered=true;
      data={authenticated:true,token:'synthetic-legacy-recovery-account-token-123456789',registered:true};
    }else if(url.endsWith('/onboarding')){
      data=recovered
        ?{registered:true,elder_name:'기존어르신',consent:'CONFIRMED',balance:4,share_requested:false,share_approved:false}
        :{detail:'FAMILY_NOT_REGISTERED'};
      if(!recovered)status=404;
    }else if(url.endsWith('/account')){
      data={registered:true,elder_name:'기존어르신',balance:4,
        purchases:[{id:'old-purchase',sessions:5,amount_krw:1000,paid_at:'2026-11-01T12:00:00Z'}],
        usage:[{sessions:1,at:'2026-11-02T12:00:00Z'}]};
    }else if(url.endsWith('/summary'))data={shared:false,reports:[]};
    else if(url.endsWith('/payment-ready'))data={ready:true,packages:[{code:'FIVE',sessions:5,price_krw:1000}]};
    route.fulfill({status,contentType:'application/json',headers:{
      'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*',
      'Access-Control-Allow-Methods':'GET,POST,OPTIONS'},body:JSON.stringify(data)});
  });
  await legacy.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
  await legacy.locator('#family-start').click();
  await legacy.locator('#family-login-phone').fill('01012345678');
  await legacy.locator('#family-request-code').click();
  await legacy.locator('#family-login-code').fill('123456');
  await legacy.locator('#family-confirm-code').click();
  await legacy.locator('#family-purchases').getByText('1,000원 · 5회').waitFor({state:'visible',timeout:10000});
  if(await legacy.locator('#family-recovery-form').count())
    throw Error('Extra elder details requested after SMS on a single existing account');
  await legacy.locator('#family-purchases').getByText('1,000원 · 5회').waitFor({state:'visible',timeout:10000});
  await legacy.locator('#family-open-plans').waitFor({state:'visible'});
  await audit(legacy,'05-restored-buyer-ledger-'+label,width,height);
  await legacy.close();
  // Exercise the actual receiver JavaScript with a synthetic SIP_DIALING
  // reservation, no registered customer, no PBX, no Retell or paid calls.
  const scheduled=await browser.newPage({
    viewport:{width,height},deviceScaleFactor:1,
    userAgent:label==='mobile'
      ?'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1'
      :undefined
  });
  scheduled.on('pageerror',err=>uncaught.push(err.message));
  await scheduled.route('https://jssip.net/**',route=>route.abort());
  await scheduled.route('https://esm.sh/**',route=>route.fulfill({
    status:200,contentType:'text/javascript',
    headers:{'Access-Control-Allow-Origin':'*'},body:'export class RetellWebClient {}'
  }));
  await scheduled.addInitScript(()=>{
    window.JsSIP={
      WebSocketInterface:class{constructor(url){}},
      UA:class{
        constructor(cfg){this.handlers={}}
        on(name,fn){this.handlers[name]=fn}
        start(){setTimeout(()=>{this.handlers.connected?.();this.handlers.registered?.();},90)}
        stop(){}
        isConnected(){return true}
        isRegistered(){return true}
      }
    };
  });
  await scheduled.route('**/api/pilot/receiver/**',route=>{
    const url=route.request().url();
    const payload=url.endsWith('/status')?
      {online:true,consent_required:false,background_push_ready:false,
        next_appointment_state:'WEB_RINGING',
        ring:{id:'ring_'+'1'.repeat(32),status:'SIP_DIALING',expires_at:9999999999}}:
      url.endsWith('/sip/setup')?
      {ready:true,mode:'SIP',sip_uri:'sip:4000@localhost.invalid',
        sip_secret:'synthetic-test-only',websocket_url:'wss://invalid.example.test'}:{};
    route.fulfill({status:200,contentType:'application/json',headers:{
      'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*',
      'Access-Control-Allow-Methods':'GET,POST,OPTIONS'},body:JSON.stringify(payload)});
  });
  await scheduled.goto('http://127.0.0.1:8765/receive.html#'+'a'.repeat(64),
                       {waitUntil:'domcontentloaded'});
  await scheduled.locator('.receiver[data-call-state="dialing"]').waitFor({state:'visible',timeout:10000});
  await scheduled.locator('#receiver-call-visual').waitFor({state:'visible'});
  if(!(await scheduled.locator('#receiver-title').innerText()).includes('전화 연결 중'))
    throw Error('Scheduled SIP state not surfaced as a call connection');
  await audit(scheduled,'06-scheduled-SIP-dialing-'+label,width,height);
  if(label==='mobile'){
    // A failed PBX invite MUST never strand a user who opened the SMS link.
    await scheduled.locator('#receiver-answer').waitFor({state:'visible',timeout:25000});
    if((await scheduled.locator('#receiver-answer').innerText())!=='지금 전화 받기')
      throw Error('Delayed SIP does not offer a direct web answer');
    if(await scheduled.locator('#receiver-reconnect').isVisible())
      throw Error('Broken SIP retries compete with the direct web answer');
    await audit(scheduled,'06-scheduled-SIP-direct-answer-'+label,width,height);
  }
  await scheduled.close();
  const receiver=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  receiver.on('pageerror',err=>uncaught.push(err.message));
  await receiver.goto('http://127.0.0.1:8765/receive.html',{waitUntil:'domcontentloaded'});
  await receiver.locator('#receiver-title').waitFor({state:'visible'});
  await audit(receiver,'06-receiver-idle-'+label,width,height);
  await receiver.evaluate(()=>{
    document.getElementById('receiver-consent-panel').hidden=false;
    document.getElementById('receiver-incoming').hidden=true;
    document.getElementById('receiver-alert').hidden=true;
    document.getElementById('receiver-title').textContent='통화 동의';
    document.getElementById('receiver-note').textContent='';
  });
  await audit(receiver,'07-receiver-consent-preview-'+label,width,height);
  await receiver.evaluate(()=>{
    document.getElementById('receiver-consent-panel').hidden=true;
    document.getElementById('receiver-incoming').hidden=false;
    document.getElementById('receiver-title').textContent='전화가 왔어요';
    document.getElementById('receiver-note').textContent='전화 받기를 눌러 주세요.';
  });
  await audit(receiver,'08-receiver-incoming-preview-'+label,width,height);
  if(uncaught.length)throw Error(label+' page JS errors '+uncaught.join('; '));
  await receiver.close();
}
// Production GitHub Pages must match the approved layout; this is read-only.
for(const [label,width,height] of [['desktop',1248,900],['mobile',390,844]]){
  const live=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  await live.goto('https://reverse-age-journal.suaveforge.com/?ui-qa=20261101-unified04',
    {waitUntil:'domcontentloaded',timeout:24000});
  await live.locator('.family-opening').waitFor({state:'visible',timeout:14000});
  const actual=await live.evaluate(()=>{
    const leaf=document.querySelector('.family-opening-leaf').getBoundingClientRect();
    return {leafWidth:leaf.width,leafHeight:leaf.height,
      title:document.querySelector('.family-opening-heading').textContent};
  });
  if(actual.leafWidth>160||actual.leafHeight>170||!actual.title.includes('내일의 일기가 됩니다'))
    throw Error('Live Pages differs from locked design: '+JSON.stringify(actual));
  await audit(live,'09-production-home-'+label,width,height);
  // Opening the login form sends NO SMS; the OTP request button is untouched.
  await live.locator('#family-start').click();
  await live.locator('#family-login-form').waitFor({state:'visible',timeout:14000});
  await audit(live,'10-production-guardian-login-'+label,width,height);
  await live.close();
  // Read-only production receiver: no fragment token -> no API call, no ring.
  const publishedReceiver=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  await publishedReceiver.goto('https://reverse-age-journal.suaveforge.com/receive.html?ui-qa=20261104-waiting01',
    {waitUntil:'domcontentloaded',timeout:24000});
  await publishedReceiver.locator('#receiver-call-visual').waitFor({state:'visible',timeout:12000});
  if(!(await publishedReceiver.locator('#receiver-title').innerText()).includes('연결 링크가 필요해요'))
    throw Error('Production elder receiver did not load updated call-state module');
  const face=await publishedReceiver.locator('.call-visual-disc').boundingBox();
  if(!face||face.width<80)throw Error('Production call state icon is not visible');
  await audit(publishedReceiver,'11-production-receiver-no-token-'+label,width,height);
  await publishedReceiver.close();
}
await browser.close();
console.log('UI_QA_PASS '+count+' screenshots including LIVE Pages; authenticated counselor and receiver states are local layout previews only; no paid call or payment.');
