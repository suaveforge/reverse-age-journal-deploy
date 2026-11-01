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
  await page.locator('#family-guardian-form').waitFor({state:'visible',timeout:10000});
  await audit(page,'02-family-contact-'+label,width,height);
  await page.locator('#family-name').fill('QA가족');
  await page.locator('#guardian-phone').fill('01012345678');
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
await browser.close();
console.log('UI_QA_PASS '+count+' screenshots; dynamic authenticated states are layout previews only; no live call, payment, or sensitive account interaction.');
