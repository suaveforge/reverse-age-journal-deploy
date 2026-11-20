'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const worker=fs.readFileSync('service-worker.js','utf8');
const setup=fs.readFileSync('raj-app-setup.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const dock=fs.readFileSync('dev-community.js','utf8');
const manifest=JSON.parse(fs.readFileSync('manifest.webmanifest','utf8'));
assert.match(setup,/pendingSubscription=readyPush\.reg\.pushManager\.subscribe/);
assert.doesNotMatch(setup,/Notification\.requestPermission\(\)/);
assert.match(setup,/if\(!response\.ok\)throw Error\('구독 등록 HTTP '/);
assert.match(setup,/if\(!response\.ok\)throw Error\('HTTP '/);
assert.match(html,/raj-app-setup\.js\?v=20261120-02/);
assert.match(dock,/dock\.children\[2\]\.id='raj-app-setup'/);
assert.equal(manifest.display,'standalone');
assert.equal(manifest.scope,'/');
const events={};const delivered=[];const windows=[];
const self={
 location:{origin:'https://reverse-age-journal.suaveforge.com'},
 registration:{showNotification:async(title,opts)=>{delivered.push({title,opts});}},
 addEventListener:(type,callback)=>events[type]=callback,
 skipWaiting:async()=>{},clients:{claim:async()=>{}}
};
const clients={matchAll:async()=>[],openWindow:async(url)=>{windows.push(url)}};
vm.runInNewContext(worker,{self,clients,URL,console,Promise,indexedDB:{open(){throw Error('Dev push must not read receiver token');}}});
async function push(kind){
 let task;events.push({data:{json:()=>({type:'dev-community',kind})},waitUntil:p=>{task=p}});
 await task;
}
async function clicked(){
 let task;const last=delivered.at(-1);
 events.notificationclick({notification:{data:last.opts.data,close(){}},waitUntil:p=>task=p});
 await task;
}
(async()=>{
 await push('chat');
 assert.equal(delivered.at(-1).title,'공동개발 새 채팅');
 assert.equal(delivered.at(-1).opts.data.tab,'chat');
 await clicked();assert.equal(windows.at(-1),'https://reverse-age-journal.suaveforge.com/?dev=chat');
 await push('board');
 assert.equal(delivered.at(-1).title,'새로운 개발 건의');
 await clicked();assert.equal(windows.at(-1),'https://reverse-age-journal.suaveforge.com/?dev=board');
 await push('test');assert.equal(delivered.at(-1).title,'기쁜사이 알림 시험');
 assert.match(worker,/payload\.type!=='incoming-web-call'/);
 assert.match(worker,/RAJ_RECEIVER_ANSWER/);
 console.log('PWA_INSTALL_SETUP_CODE=PASS');
 console.log('IPHONE_USER_ACTIVATION_SUBSCRIBE_CODE=PASS');
 console.log('SW_CHAT_PUSH_EVENT=PASS');
 console.log('SW_BOARD_PUSH_EVENT=PASS');
 console.log('SW_TEST_PUSH_EVENT=PASS');
 console.log('SW_CHAT_BOARD_NOTIFICATION_CLICK=PASS');
 console.log('EXISTING_CALL_RECEIVER_HANDLER_PRESENT=PASS');
 console.log('REAL_LOCKED_IPHONE_PUSH_DELIVERY=NOT_TESTED');
})().catch(e=>{console.error(e);process.exitCode=1;});
