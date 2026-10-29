/* 늘뷰어 자동 점검 — README.md 참고. `npm test` */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), FIX = path.join(__dirname, 'fixtures', 'a.hwp');
const lib = n => require.resolve(n, { paths: [__dirname, process.cwd(), ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)] });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

const results = []; const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || '조건이 맞지 않습니다'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function serve() {
  return new Promise(res => {
    const srv = http.createServer((q, r) => {
      let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
      let f = path.join(ROOT, u); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
      r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
    }).listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

test('시작할 때 오류가 없다', async c => {
  await sleep(1500);
  ok(c.pageErrors.length === 0, '페이지 오류: ' + c.pageErrors.join(' / '));
  ok(await c.pg.evaluate(() => !!document.querySelector('#btnNewNote')), '서재 화면이 뜨지 않았습니다');
});

test('.hwp 가져오기 → 서재에 한글 카드', async c => {
  await c.pg.setInputFiles('#fileInput', [FIX]);
  await c.pg.waitForFunction(() => { const b = document.querySelector('#fileInput'); return true; });
  await c.showAll();
  await c.pg.waitForFunction(() => [...document.querySelectorAll('.card .badge')].some(b => b.textContent.includes('한글')), null, { timeout: 150000 });
});

test('새 한글 문서 → 늘한글 탭·상단바 버튼 → 저장 → 문서로 열기', async c => {
  const pg = c.pg;
  await pg.click('#btnNewNote'); await pg.fill('#nTitle', '시험문서'); await pg.check('input[name="ntype"][value="hwp"]'); await pg.uncheck('#nHwpWin'); await pg.click('#nGo');
  await pg.waitForSelector('#hwpSave', { state: 'visible', timeout: 30000 });
  for (const s of ['#hwpPop', '#hwpSave', '#hwpView', '#hwpBack', '#rDict', '#rFold', '#rMore']) ok(await c.vis(s), s + ' 버튼이 보이지 않습니다');
  ok(!(await pg.$('.hwp-bar')), '둘째 줄(.hwp-bar)이 남아 있습니다');
  const tabs = await pg.$$eval('#rTabs .rtab', t => t.map(x => x.title)); ok(tabs.length === 1 && tabs[0].startsWith('늘한글'), '탭 이름: ' + tabs);
  await pg.click('#hwpSave');
  await pg.waitForFunction(() => /저장됨/.test(document.querySelector('#hwpSt').textContent), null, { timeout: 150000 });
  await pg.click('#hwpView'); await pg.waitForSelector('#rHwpEdit:not([hidden])', { timeout: 30000 });
  ok(await c.vis('#rHwpEdit'), "상단바 '늘한글로 편집'이 보이지 않습니다");
  await pg.waitForFunction(() => document.querySelectorAll('#pages .textLayer span').length > 0, null, { timeout: 30000 });
});

test("상단바 '늘한글로 편집' → 탭 두 개 오가기 → 닫기", async c => {
  const pg = c.pg;
  await pg.click('#rHwpEdit'); await pg.waitForSelector('#hwpSave', { state: 'visible', timeout: 30000 });
  ok(await pg.evaluate(() => window.__loaded && /시험문서\.hwp$/.test(window.__loaded.n)), '원본이 편집기에 열리지 않았습니다');
  ok((await pg.$$('#rTabs .rtab')).length === 2, '탭이 2개가 아닙니다');
  await pg.click('#rTabs .rtab:not(.on) .rtl');
  await pg.waitForFunction(() => document.querySelector('#rTitle').textContent === '시험문서' && document.querySelector('#pageTot').textContent !== '', null, { timeout: 30000 }).catch(() => { throw new Error('문서 탭으로 돌아오지 못했습니다'); });
  await pg.click('#rTabs .rtab[data-id="hwp"] .rtl'); await sleep(500);   /* 켜진 탭에서 ✕가 눌린다 */
  await pg.hover('#rTabs .rtab[data-id="hwp"]');   /* ✕는 마우스를 올려야 눌린다 */
  await pg.click('#rTabs .rtab[data-id="hwp"] .rx'); await sleep(700);
  ok(!(await pg.$('#rTabs .rtab[data-id="hwp"]')), '늘한글 탭이 닫히지 않았습니다');
});

test('한글 원본 내려받기', async c => {
  const pg = c.pg; await c.toShelf(); await c.showAll();
  await pg.click('.card:has(.name:text("시험문서")) .icon-btn'); await pg.waitForSelector('#dHwpDl', { state: 'visible', timeout: 10000 });
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.click('#dHwpDl')]);
  const p = await dl.path(); /* 자동 시험용 크롬은 한글 파일 이름을 'download'로 바꿔 받으므로 이름은 보지 않고 크기만 본다 */
  ok(fs.statSync(p).size === fs.statSync(FIX).size, '내려받은 원본 크기가 다릅니다');
  await pg.keyboard.press('Escape');
});

test('글상자: 줄바꿈·"- "·방향키는 커서만 움직인다', async c => {
  const pg = c.pg; await c.toShelf(); await c.showAll();
  await pg.click('.card:has(.name:text("시험문서")) .name'); await pg.waitForSelector('#pages .page', { timeout: 30000 }); await sleep(2500);
  await pg.evaluate(() => document.querySelector('.tb[data-tool=text]').click()); await sleep(300);
  const bb = await (await pg.$('#pages .page')).boundingBox(); await pg.mouse.click(bb.x + 120, bb.y + 150); await pg.waitForSelector('.tb-body', { timeout: 10000 });
  await pg.focus('.tb-body'); await pg.keyboard.type('첫줄'); await pg.keyboard.press('Enter'); await pg.keyboard.type('- 글자'); await pg.keyboard.press('Enter'); await pg.keyboard.type('셋째');
  const t = await pg.evaluate(() => document.querySelector('.tb-body').innerText); ok(t === '첫줄\n- 글자\n셋째', '입력 결과: ' + JSON.stringify(t));
  const snap = () => pg.evaluate(() => ({ page: document.querySelector('#pageIn').value, st: Math.round(document.querySelector('#scroller').scrollTop), node: (getSelection().anchorNode || {}).textContent }));
  const a = await snap();
  await pg.keyboard.press('ArrowUp'); await pg.keyboard.press('ArrowUp'); await pg.keyboard.press('ArrowLeft'); await sleep(300);
  const b = await snap(); ok(b.page === a.page && b.st === a.st, '방향키로 문서가 움직였습니다 ' + JSON.stringify([a, b])); ok(b.node !== a.node, '커서가 움직이지 않았습니다');
});

test('받아쓰기 창 접기/펼치기', async c => {
  const pg = c.pg; await pg.keyboard.press('Escape');
  await pg.click('#rDict'); await sleep(500);
  const w0 = await pg.evaluate(() => document.querySelector('#dictPane').getBoundingClientRect().width); ok(w0 > 250, '받아쓰기 창이 열리지 않았습니다');
  await pg.click('#dcFold'); await sleep(300);
  const f = await pg.evaluate(() => { const r = document.querySelector('#dictPane').getBoundingClientRect(); return { h: r.height, cls: document.querySelector('#dictPane').className, sc: document.querySelector('#scroller').getBoundingClientRect().width }; });
  ok(/dfold/.test(f.cls) && f.h < 90, '접히지 않았습니다 ' + JSON.stringify(f));
  await pg.click('#dcFold'); await sleep(300);
  ok(await pg.evaluate(() => !/dfold/.test(document.querySelector('#dictPane').className)), '펼쳐지지 않았습니다');
  await pg.click('#dcClose'); await sleep(300); ok(await pg.evaluate(() => document.querySelector('#dictPane').hidden), '닫히지 않았습니다');
});

test('받아쓰기: 조금씩 바뀌어 다시 오는 같은 문장은 한 줄로', async c => {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const cut = (a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i); return src.slice(i, j); };
  const commit = src.slice(src.indexOf('function dictCommit(){'), src.indexOf('\n', src.indexOf('function dictCommit(){')));
  const feed = cut('function dictFeed(e)', 'function dictAbortRec').replace('function dictFeed', 'function feed');
  const run = new Function(`const DICT={fin:[],live:'',liveFinal:false,cmt:0,lastFin:null,lastRes:0,lastIn:'',int:''};const dictFix=x=>x,dictSave=()=>{},dictRender=()=>{};${commit}\n${feed}
    const mk=(t,f)=>({resultIndex:0,results:[Object.assign([{transcript:t}],{isFinal:f})]});
    const base='그리스도인으로서 신앙생활 하며 가장 곤란할 때가 언제일까요 그것은 은혜의 자리 예배 자리에 있는데 그 은혜의 자리에서 예배의 자리에서 아무런 감동도 오늘도 받지 않는 내 모습을 발견할 때인';
    for(const t of [base+' 거 같습니다',base+' 것 같습니다',base+' 거 같습니다 찰스',base+' 것 같습니다 이야기','십자가를 바라보고도 아무런 감정이 없다는 것 그것이 비극이라고 얘기합니다'])feed(mk(t,true));
    dictCommit();return DICT.fin.length;`);
  const n = run(); ok(n === 2, '줄 수가 2가 아니라 ' + n);
});

test('오류 기록: 예기치 못한 오류가 남고 설정에서 보인다', async c => {
  const pg = c.pg; await c.toShelf();
  c.expectError = true; await pg.evaluate(() => setTimeout(() => { throw new Error('시험용 오류'); }, 0)); await sleep(500);
  await pg.click('#btnSettings'); await pg.click('#setErr'); await pg.waitForSelector('#errBody', { state: 'visible' });
  const v = await pg.inputValue('#errBody'); ok(v.includes('시험용 오류'), '오류 기록에 없습니다: ' + v.slice(0, 120));
  await pg.click('#errClr'); ok((await pg.inputValue('#errBody')).includes('기록된 오류가 없습니다'), '지우기가 되지 않았습니다');
});

(async () => {
  const { srv, port } = await serve();
  const b = await chromium.launch({ headless: !process.env.HEADED });
  const ctx = await b.newContext({ viewport: { width: 1100, height: 800 }, serviceWorkers: 'block', acceptDownloads: true });
  const L = { 'pdf.min.js': lib('pdfjs-dist/build/pdf.min.js'), 'pdf.worker.min.js': lib('pdfjs-dist/build/pdf.worker.min.js'), 'pdf-lib.min.js': lib('pdf-lib/dist/pdf-lib.min.js') };
  await ctx.route(/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/, r => { const u = r.request().url(), k = Object.keys(L).find(k => u.endsWith(k)); k ? r.fulfill({ path: L[k], contentType: 'application/javascript' }) : r.abort(); });
  await ctx.route('**/_test.hwp*', r => r.fulfill({ path: FIX, contentType: 'application/octet-stream' }));
  await ctx.route('**/hwp/editor/index.js', r => r.fulfill({ contentType: 'application/javascript', body: `export async function createEditor(c,o){const f=document.createElement('iframe');c.appendChild(f);window.__dirty=false;return {async loadFile(d,n){window.__loaded={len:d.length,n};return{pageCount:1}},async exportHwp(){const r=await fetch('/_test.hwp?'+Date.now());return new Uint8Array(await r.arrayBuffer())},async getDocumentState(){return{dirty:window.__dirty}},async notifySaved(){return{ok:true}},destroy(){f.remove()}}}` }));
  await ctx.route('**/hwp/studio/**', r => r.abort());   /* 실제 편집기는 쓰지 않는다 */
  const pg = await ctx.newPage(); pg.on('dialog', d => d.accept());
  const c = { pg, pageErrors: [], expectError: false,
    vis: s => pg.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const c = getComputedStyle(e), r = e.getBoundingClientRect(); return c.display !== 'none' && r.width > 0 && r.height > 0 && !e.hidden; }, s),
    toShelf: async () => { for (let i = 0; i < 3; i++) { if (await pg.evaluate(() => document.querySelector('#reader').hidden)) break; await pg.keyboard.press('Escape'); await pg.click('#rBack').catch(() => {}); await sleep(500); } },
    showAll: async () => { await pg.click('text=모든 문서').catch(() => {}); await sleep(400); } };
  pg.on('pageerror', e => { if (!c.expectError) c.pageErrors.push(e.message.slice(0, 160)); });
  await pg.goto(`http://127.0.0.1:${port}/index.html`);
  for (const t of tests) {
    const t0 = Date.now();
    try { await t.fn(c); results.push([t.name, true, Date.now() - t0]); console.log('  통과 ·', t.name); }
    catch (e) { results.push([t.name, false, Date.now() - t0, e.message]); await pg.screenshot({ path: path.join(__dirname, 'last-fail-' + results.length + '.png') }).catch(() => {}); console.log('  실패 ·', t.name, '\n      ', String(e.message).split('\n').slice(0, 6).join(' / ')); }
  }
  await b.close(); srv.close();
  const pass = results.filter(r => r[1]).length, fail = results.length - pass;
  console.log(`\n통과 ${pass} / 실패 ${fail}`); process.exit(fail ? 1 : 0);
})();
