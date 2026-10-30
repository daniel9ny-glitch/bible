const { chromium } = require('playwright');const path=require('path'),http=require('http'),fs=require('fs');
const ROOT=path.resolve(process.argv[2]);const lib=n=>require.resolve(n,{paths:(process.env.NODE_PATH||'').split(path.delimiter)});
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';const f=path.join(ROOT,u);if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('no');}r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);}).listen(0,'127.0.0.1');
 await new Promise(r=>srv.on('listening',r));
 const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:900,height:900},serviceWorkers:'block'});
 const L={'pdf.min.js':lib('pdfjs-dist/build/pdf.min.js'),'pdf.worker.min.js':lib('pdfjs-dist/build/pdf.worker.min.js'),'pdf-lib.min.js':lib('pdf-lib/dist/pdf-lib.min.js')};
 await ctx.route(/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/,r=>{const u=r.request().url(),k=Object.keys(L).find(k=>u.endsWith(k));k?r.fulfill({path:L[k],contentType:'application/javascript'}):r.abort();});
 const pg=await ctx.newPage();pg.on('dialog',d=>d.accept());pg.on('console',m=>{if(/QRDBG/.test(m.text()))console.log(m.text())});pg.on('pageerror',e=>console.log('PAGEERR',e.message.slice(0,150)));
 await pg.addInitScript(()=>{window.__opened=[];window.open=(u)=>{window.__opened.push(u);return {};};});
 await pg.goto(`http://127.0.0.1:${srv.address().port}/index.html`);await pg.waitForSelector('#btnNewNote');await sleep(1200);
 await pg.setInputFiles('#fileInput',[path.resolve('out/qr/qr.pdf')]);await sleep(3000);
 await pg.click('text=모든 문서').catch(()=>{});await sleep(400);
 await pg.evaluate(()=>document.querySelector('#grid .card .cover').click());
 await pg.waitForFunction(()=>document.querySelectorAll('#pages .page canvas').length>0,null,{timeout:20000});await sleep(4000);
 // click helper: fraction coordinates within page i (from top-left)
 const clickAt=async(i,fx,fy)=>{
   await pg.evaluate(i=>document.querySelectorAll('#pages .page')[i].scrollIntoView({block:'center'}),i);await sleep(900);
   const r=await pg.evaluate(i=>{const e=document.querySelectorAll('#pages .page')[i].getBoundingClientRect();return{x:e.left,y:e.top,w:e.width,h:e.height};},i);
   await pg.evaluate(()=>{window.__opened.length=0;window.__toast=null;});
   await pg.mouse.click(r.x+r.w*fx,r.y+r.h*fy);await sleep(500);
   return pg.evaluate(()=>({opened:window.__opened.slice(),toast:[...document.querySelectorAll('#toasts .toast')].map(t=>t.textContent).join('|')}));
 };
 // wait for page scans (idle)
 await sleep(3000);
 // QR1 on p2: image at x80..230 (of 595), y 500..650 from bottom => top-based 192..342 of 842 → center (155/595, 267/842)
 const T=[
  ['p2 QR1 (그림)',1,155/595,267/842,'https://example.com/neul-one'],
  ['p2 QR2 (그림)',1,400/595,(842-250)/842,'https://example.org/two'],
  ['p3 도형 QR',2,(200+62)/595,(842-300-62)/842,'https://example.net/vec'],
  ['p1 글자 쪽 아무 데나',0,.5,.5,null],
  ['p2 QR 밖',1,.1,.9,null],
  ['p4 주소 아닌 QR',3,275/595,(842-475)/842,'TOAST'],
 ];
 let fail=0;
 for(const [n,i,fx,fy,exp] of T){const r=await clickAt(i,fx,fy);
   let ok=exp===null?r.opened.length===0:exp==='TOAST'?(r.opened.length===0&&/just some text 123/.test(r.toast||'')):(r.opened[0]===exp);
   if(!ok)fail++;console.log(ok?'OK ':'FAIL',n,JSON.stringify(r));}
 // setting off
 await pg.evaluate(()=>localStorage.setItem('neul-qr','0'));
 const r=await clickAt(1,155/595,267/842);console.log((r.opened.length===0)?'OK ':'FAIL','끄면 안 열림',JSON.stringify(r));if(r.opened.length)fail++;
 console.log('실패',fail);
 await b.close();srv.close();
})();
