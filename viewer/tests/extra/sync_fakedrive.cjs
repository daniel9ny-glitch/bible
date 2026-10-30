const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve('bible-src/repo/viewer');const REAL=path.resolve('out/real');
const lib=n=>require.resolve(n,{paths:(process.env.NODE_PATH||'').split(path.delimiter)});
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.woff2':'font/woff2','.ttf':'font/ttf'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// ---- fake Drive ----
const FILES=new Map();let nid=1;const SESS=new Map();const LOG=[];
const sha=b=>crypto.createHash('sha1').update(b).digest('hex').slice(0,10);
function parseMulti(buf,ct){const b='--'+/boundary=(.+)$/.exec(ct)[1];const parts=buf.toString('latin1').split(b).slice(1,-1);
  const out=[];for(const p of parts){const i=p.indexOf('\r\n\r\n');out.push(Buffer.from(p.slice(i+4,p.length-2),'latin1'));}return out;}
async function drive(r){
  const req=r.request(),u=new URL(req.url()),m=req.method();
  const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','access-control-expose-headers':'Location'};
  if(m==='OPTIONS')return r.fulfill({status:204,headers:cors});
  const J=(o,s=200)=>r.fulfill({status:s,headers:{...cors,'content-type':'application/json'},body:JSON.stringify(o)});
  const body=req.postDataBuffer()||Buffer.alloc(0);
  if(u.host==='upload.fake'){const s=SESS.get(u.pathname.slice(1));const cr=/bytes (\d+)-(\d+)\/(\d+)/.exec(req.headers()['content-range']||'');
    if(cr){s.parts=(s.parts||[]);s.parts.push(body);const got=+cr[2]+1;if(got<+cr[3])return r.fulfill({status:308,headers:{...cors,Range:'bytes=0-'+(got-1)},body:''});s.f.data=Buffer.concat(s.parts);}else s.f.data=body;
    s.f.size=s.f.data.length;LOG.push('PUT blob '+s.f.name+' '+s.f.size+(cr?' chunked':''));return J({id:s.f.id});}
  const mm=/\/files(?:\/([^/]+))?$/.exec(u.pathname);const id=mm&&mm[1];const up=u.pathname.includes('/upload/');
  if(m==='GET'&&!id){return J({files:[...FILES.values()].map(f=>({id:f.id,name:f.name,appProperties:f.appProperties,size:String(f.size)}))});}
  if(m==='GET'&&id){const f=FILES.get(id);if(!f)return r.fulfill({status:404,headers:cors});return r.fulfill({status:200,headers:{...cors,'content-type':'application/octet-stream'},body:f.data});}
  if(m==='DELETE'){FILES.delete(id);return r.fulfill({status:204,headers:cors});}
  if(up&&u.searchParams.get('uploadType')==='multipart'){const [meta,data]=parseMulti(body,req.headers()['content-type']);const mt=JSON.parse(meta.toString());
    let f=id&&FILES.get(id);if(!f){f={id:'f'+nid++,name:mt.name,appProperties:{},data:Buffer.alloc(0),size:0};FILES.set(f.id,f);}
    if(mt.appProperties)f.appProperties=mt.appProperties;f.data=data;f.size=data.length;return J({id:f.id});}
  if(up&&u.searchParams.get('uploadType')==='resumable'){const mt=JSON.parse(body.toString());let f=id&&FILES.get(id);
    if(!f){f={id:'f'+nid++,name:mt.name,appProperties:{},data:Buffer.alloc(0),size:0};FILES.set(f.id,f);}
    if(mt.appProperties)f.appProperties=mt.appProperties;const sid='s'+nid++;SESS.set(sid,{f});
    return r.fulfill({status:200,headers:{...cors,Location:'https://upload.fake/'+sid},body:''});}
  if(m==='PATCH'&&id){return J({id});}
  return r.fulfill({status:404,headers:cors});
}
function serve(){return new Promise(res=>{const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';const f=path.join(ROOT,u);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('no');}r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);}).listen(0,'127.0.0.1',()=>res({srv,port:srv.address().port}));});}
async function device(b,port,name){
  const ctx=await b.newContext({viewport:{width:1100,height:800},serviceWorkers:'block'});
  const L={'pdf.min.js':lib('pdfjs-dist/build/pdf.min.js'),'pdf.worker.min.js':lib('pdfjs-dist/build/pdf.worker.min.js'),'pdf-lib.min.js':lib('pdf-lib/dist/pdf-lib.min.js')};
  await ctx.route(/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/,r=>{const u=r.request().url(),k=Object.keys(L).find(k=>u.endsWith(k));k?r.fulfill({path:L[k],contentType:'application/javascript'}):r.abort();});
  const dev={name,cur:'a.hwp'};
  await ctx.route('**/_test.hwp*',r=>r.fulfill({path:path.join(REAL,dev.cur),contentType:'application/octet-stream'}));
  await ctx.route('**/hwp/editor/index.js',r=>r.fulfill({contentType:'application/javascript',body:`export async function createEditor(c,o){const f=document.createElement('iframe');c.appendChild(f);window.__dirty=false;return {async loadFile(d,n){window.__loaded={len:d.length,n};return{pageCount:1}},async exportHwp(){const r=await fetch('/_test.hwp?'+Date.now());return new Uint8Array(await r.arrayBuffer())},async getDocumentState(){return{dirty:window.__dirty}},async notifySaved(){return{ok:true}},destroy(){f.remove()}}}`}));
  await ctx.route('**/hwp/studio/**',r=>r.abort());
  await ctx.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'application/javascript',body:'window.google={accounts:{oauth2:{initTokenClient(){return{requestAccessToken(){}}},revoke(){}}}};'}));
  await ctx.route(/googleapis\.com|upload\.fake/,drive);
  await ctx.addInitScript(()=>{try{localStorage.setItem('neul-gtoken',JSON.stringify({access_token:'t',expires_at:Date.now()+36e5*5,hint:'x@y'}));localStorage.setItem('neul-gsync','1');localStorage.setItem('neul-ghint','x@y');}catch(e){}});
  const pg=await ctx.newPage();pg.on('console',m=>{if(/에러|error|Error/.test(m.text()))console.log(`[${name}] console`,m.text().slice(0,160));});pg.on('dialog',d=>d.accept());pg.on('pageerror',e=>console.log(`[${name}] pageerror`,e.message.slice(0,140)));
  await pg.goto(`http://127.0.0.1:${port}/index.html`);await pg.waitForSelector('#btnNewNote');await sleep(1200);
  dev.pg=pg;dev.ctx=ctx;
  dev.sync=async()=>{await pg.evaluate(()=>{document.querySelector('#gsMsg').textContent='';document.querySelector('#gsNow').click();});
    await pg.waitForFunction(()=>/동기화 완료|일부만|오류|연결하지|거부|로그인|만료/.test(document.querySelector('#gsMsg').textContent),null,{timeout:40000}).catch(async()=>{console.log('  타임아웃 gsMsg=',await pg.evaluate(()=>document.querySelector('#gsMsg').textContent),'| 요청수',LOG.length);});
    const t=await pg.evaluate(()=>document.querySelector('#gsMsg').textContent);console.log(`  [${name}] 동기화:`,t.slice(0,120));await sleep(400);return t;};
  dev.blobs=()=>pg.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('neul-viewer',1);q.onsuccess=()=>r(q.result);});
    const docs=await new Promise(r=>{const q=db.transaction('docs').objectStore('docs').getAll();q.onsuccess=()=>r(q.result);});
    const out=[];for(const d of docs){const bl=await new Promise(r=>{const q=db.transaction('blobs').objectStore('blobs').get(d.id);q.onsuccess=()=>r(q.result);});
      let h=null;if(bl){const x=await crypto.subtle.digest('SHA-1',bl);h=[...new Uint8Array(x)].slice(0,5).map(b=>b.toString(16).padStart(2,'0')).join('');}
      out.push({id:d.id,title:d.title,hwp:!!d.hwp,type:d.type,size:bl?bl.byteLength:null,hash:h,mod:d.modified});}return out;});
  return dev;
}
(async()=>{
  const {srv,port}=await serve();const b=await chromium.launch();
  const A=await device(b,port,'A기기');
  // 1. A: .hwp 가져오기
  A.cur='a.hwp';await A.pg.setInputFiles('#fileInput',[path.join(REAL,'a.hwp')]);
  await A.pg.waitForFunction(()=>true);await sleep(500);
  await A.pg.click('text=모든 문서').catch(()=>{});
  await A.pg.waitForFunction(()=>[...document.querySelectorAll('.card .badge')].some(x=>x.textContent.includes('한글')),null,{timeout:180000});
  console.log('1) A 가져오기 후',JSON.stringify(await A.blobs()));
  await A.sync();console.log('   드라이브 파일:',[...FILES.values()].map(f=>f.name+'('+f.size+')').join(', '));
  // 2. B: 새 기기
  const B=await device(b,port,'B기기');
  await B.sync();await sleep(1500);
  console.log('2) B 동기화 후',JSON.stringify(await B.blobs()));
  await B.pg.click('text=모든 문서').catch(()=>{});await sleep(500);
  console.log('   B 카드 배지:',await B.pg.evaluate(()=>[...document.querySelectorAll('.card')].map(c=>c.querySelector('.name').textContent+':'+c.querySelector('.badge').textContent)));
  // 3. B에서 편집기로 열기
  await B.pg.evaluate(()=>[...document.querySelectorAll('#grid .card')].find(c=>c.querySelector('.badge').textContent.includes('한글')).querySelector('.cover').click());await B.pg.waitForSelector('#rHwpEdit:not([hidden])',{timeout:60000}).catch(()=>console.log('   B: 상단바 한글편집 버튼 안 보임'));
  await B.pg.click('#rHwpEdit').catch(()=>{});await B.pg.waitForSelector('#hwpSave',{state:'visible',timeout:60000}).catch(()=>{});
  console.log('3) B 편집기 로드:',await B.pg.evaluate(()=>JSON.stringify(window.__loaded||null)));
  // 4. 양쪽 동시 편집 (서로 동기화 없이 각자 저장)
  B.cur='b.hwp';await B.pg.click('#hwpSave');await B.pg.waitForFunction(()=>/저장됨/.test(document.querySelector('#hwpSt').textContent),null,{timeout:180000});
  console.log('4a) B 저장 후',JSON.stringify((await B.blobs()).map(x=>[x.title,x.size,x.hash])));
  await sleep(1100);
  await A.pg.click('#rBack').catch(()=>{});await sleep(500);await A.pg.click('text=모든 문서').catch(()=>{});await sleep(400);await A.pg.evaluate(()=>[...document.querySelectorAll('#grid .card')].find(c=>c.querySelector('.badge').textContent.includes('한글')).querySelector('.cover').click());
  await A.pg.waitForSelector('#rHwpEdit:not([hidden])',{timeout:60000});await A.pg.click('#rHwpEdit');await A.pg.waitForSelector('#hwpSave',{state:'visible',timeout:60000});
  A.cur='c.hwpx'===0?'a.hwp':'a.hwp';
  await A.pg.evaluate(()=>{});
  await A.pg.click('#hwpSave');await A.pg.waitForFunction(()=>/저장됨/.test(document.querySelector('#hwpSt').textContent),null,{timeout:180000});
  console.log('4b) A 저장 후',JSON.stringify((await A.blobs()).map(x=>[x.title,x.size,x.hash])));
  await B.sync();console.log('   드라이브 blob:',[...FILES.values()].filter(f=>f.name.startsWith('nv_b_')).map(f=>f.name+' '+f.size+' ts'+f.appProperties.ts+' '+sha(f.data)));
  await A.sync();
  await B.sync();
  await A.sync();await B.sync();
  console.log('5) 최종 A',JSON.stringify((await A.blobs()).map(x=>[x.title,x.size,x.hash])),'\n   최종 B',JSON.stringify((await B.blobs()).map(x=>[x.title,x.size,x.hash])));
  console.log('   드라이브:',[...FILES.values()].filter(f=>f.name.startsWith('nv_b_')).map(f=>f.size+' '+sha(f.data)).join(' '));
  await A.pg.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('neul-viewer',1);q.onsuccess=()=>r(q.result);});
    const docs=await new Promise(r=>{const q=db.transaction('docs').objectStore('docs').getAll();q.onsuccess=()=>r(q.result);});const d=docs.find(x=>x.hwp);
    const nd={...d,id:d.id+'-c1793237209214',title:'a (충돌 사본)'};await new Promise(r=>{const tx=db.transaction('docs','readwrite');tx.objectStore('docs').put(nd,nd.id);tx.oncomplete=r;});});
  await A.pg.reload();await A.pg.waitForSelector('#btnNewNote');await sleep(1500);await A.sync();await sleep(800);
  console.log('6) 사본 정리 뒤 A',JSON.stringify(await A.pg.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('neul-viewer',1);q.onsuccess=()=>r(q.result);});const docs=await new Promise(r=>{const q=db.transaction('docs').objectStore('docs').getAll();q.onsuccess=()=>r(q.result);});return docs.map(x=>[x.title,!!x.trash]);})));
  await b.close();srv.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
