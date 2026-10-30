const { chromium } = require('playwright');const path=require('path'),http=require('http'),fs=require('fs');
const ROOT=path.resolve(process.argv[2]);const tag=process.argv[3];const lib=n=>require.resolve(n,{paths:(process.env.NODE_PATH||'').split(path.delimiter)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';const f=path.join(ROOT,u);if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('no');}r.writeHead(200,{'content-type':f.endsWith('.html')?'text/html; charset=utf-8':'text/javascript'});fs.createReadStream(f).pipe(r);}).listen(0,'127.0.0.1');
 await new Promise(r=>srv.on('listening',r));
 const b=await chromium.launch();
 const L={'pdf.min.js':lib('pdfjs-dist/build/pdf.min.js'),'pdf.worker.min.js':lib('pdfjs-dist/build/pdf.worker.min.js'),'pdf-lib.min.js':lib('pdf-lib/dist/pdf-lib.min.js')};
 for(const [w,h] of [[500,900],[680,900],[780,860],[850,900],[900,600],[900,420],[820,380],[1000,800]]){
  const ctx=await b.newContext({viewport:{width:w,height:h},serviceWorkers:'block'});
  await ctx.route(/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/,r=>{const u=r.request().url(),k=Object.keys(L).find(k=>u.endsWith(k));k?r.fulfill({path:L[k],contentType:'application/javascript'}):r.abort();});
  const pg=await ctx.newPage();pg.on('pageerror',e=>console.log('PAGEERR',e.message.slice(0,120)));
  await pg.goto(`http://127.0.0.1:${srv.address().port}/index.html`);await pg.waitForSelector('#btnNewNote');await sleep(1000);
  const r=await pg.evaluate(()=>{const c=document.querySelector('.cats').getBoundingClientRect();return{catsW:Math.round(c.width),catsH:Math.round(c.height),side:c.height>c.width?'왼쪽 메뉴':'위쪽 탭'};});
  console.log(`${w}x${h}`,JSON.stringify(r));
  if([780,500,820].includes(w)&&tag)await pg.screenshot({path:`out/qr/shelf_${tag}_${w}x${h}.png`});
  await ctx.close();}
 await b.close();srv.close();
})();
