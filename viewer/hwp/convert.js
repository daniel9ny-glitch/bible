/* 한글(HWP) 문서 → 텍스트 층이 있는 PDF 변환기 (늘뷰어)
 *
 * 1) rhwp 코어(@rhwp/core, MIT)로 HWP를 읽어 쪽마다 SVG를 얻는다.
 * 2) SVG의 글자·선·사각형·그림을 pdf-lib로 PDF에 옮긴다 (글자는 실제 텍스트로 그려 검색·읽기가 된다).
 * 3) 쓰인 글자만 남긴 Noto Sans KR 폰트(SIL OFL)를 PDF에 넣는다. (harfbuzz 서브셋)
 * 4) 원본 HWP를 PDF 첨부 파일로 넣어 두어, 나중에 "한글로 편집"으로 되돌릴 수 있게 한다.
 *
 * 사용: const pdfBytes = await hwpToPdf(hwpBytes, { base, PDFLib, fontkit, fetchBytes, title });
 */

const PX2PT = 0.75;

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

/* ---------- 폰트 서브셋 (harfbuzz wasm, 단독 실행) ---------- */
let hbPromise = null;
async function hbLoad(wasmBytes) {
  if (!hbPromise) hbPromise = WebAssembly.instantiate(wasmBytes, {}).then((r) => r.instance.exports);
  return hbPromise;
}
async function subsetFont(hbWasm, fontBytes, codepoints) {
  const x = await hbLoad(hbWasm);
  const u8 = () => new Uint8Array(x.memory.buffer);
  const ptr = x.malloc(fontBytes.length);
  u8().set(fontBytes, ptr);
  const blob = x.hb_blob_create(ptr, fontBytes.length, 0, 0, 0);          // 0 = 복사해서 보관
  const face = x.hb_face_create(blob, 0);
  const input = x.hb_subset_input_create_or_fail();
  const set = x.hb_subset_input_unicode_set(input);
  for (const cp of codepoints) x.hb_set_add(set, cp);
  x.hb_subset_input_set_flags(input, x.hb_subset_input_get_flags(input) | 0x40);   // .notdef 윤곽 유지
  const sub = x.hb_subset_or_fail(face, input);
  if (!sub) throw new Error('폰트 서브셋 실패');
  const out = x.hb_face_reference_blob(sub);
  const len = x.hb_blob_get_length(out), p = x.hb_blob_get_data(out, 0);
  const res = u8().slice(p, p + len);
  x.hb_blob_destroy(out); x.hb_face_destroy(sub); x.hb_subset_input_destroy(input);
  x.hb_face_destroy(face); x.hb_blob_destroy(blob); x.free(ptr);
  return res;
}

/* ---------- PDF에 실제로 넣는 글꼴 (편집기 글꼴 메뉴의 '늘뷰어 내장 글꼴'과 같은 목록) ---------- */
const FAMILY_FILES = { ng: 'NanumGothic', nm: 'NanumMyeongjo', pt: 'Pretendard' };
const FAMILY_MAP = {
  '나눔고딕': 'ng', 'nanum gothic': 'ng', '나눔명조': 'nm', 'nanum myeongjo': 'nm',
  'pretendard': 'pt', 'noto sans kr': '',
};

/* ---------- SVG 읽기 ---------- */
function attrs(s) { const a = {}; for (const m of s.matchAll(/([\w:-]+)="([^"]*)"/g)) a[m[1]] = unescAttr(m[2]); return a; }
const unescAttr = (v) => v.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
function parsePage(svg) {
  const W = parseFloat((svg.match(/<svg[^>]*\swidth="([\d.]+)"/) || [])[1]);
  const H = parseFloat((svg.match(/<svg[^>]*\sheight="([\d.]+)"/) || [])[1]);
  const items = [];
  let depth = 0;
  for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>|<(\/?)(svg|line|rect|image|path|ellipse|polygon|polyline)\b([^>]*?)\/?>/g)) {
    if (m[4] === undefined) { items.push({ t: 'text', a: attrs(m[1]), text: unesc(m[2] || '') }); continue; }
    const closing = m[3] === '/', tag = m[4];
    if (tag === 'svg') {                       // 첫 <svg>는 쪽 자체. 그 안의 <svg>는 그림을 잘라 맞추는 상자
      if (closing) { if (depth > 1) items.push({ t: 'svgClose', a: {}, text: '' }); depth = Math.max(0, depth - 1); }
      else { if (depth >= 1) items.push({ t: 'svgOpen', a: attrs(m[5]), text: '' }); depth++; }
      continue;
    }
    items.push({ t: tag, a: attrs(m[5]), text: '' });
  }
  return { W, H, items };
}
const hexColor = (PDFLib, h) => {
  if (!h || h[0] !== '#') return null;
  let s = h.slice(1); if (s.length === 3) s = s.replace(/./g, (c) => c + c);
  const n = parseInt(s, 16); if (Number.isNaN(n)) return null;
  return PDFLib.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
};

/* ---------- rhwp 코어(WASM) 한 번만 초기화 ---------- */
let corePromise = null;
function getCore(o) {
  if (!corePromise) {
    corePromise = (async () => {
      const core = await import(o.base + 'core/rhwp.js');
      const wasmBytes = await o.fetchBytes(o.base + 'core/rhwp_bg.wasm');
      /* 12MB WASM은 브라우저 메인 스레드에서 동기 컴파일이 막혀 있으므로 반드시 비동기 초기화 */
      await core.default({ module_or_path: wasmBytes });
      return core;
    })().catch((e) => { corePromise = null; throw e; });
  }
  return corePromise;
}

/* 새 한글 문서(빈 문서)의 HWP 바이트 */
export async function blankHwp(o) {
  const core = await getCore(o);
  const d = core.HwpDocument.createEmpty();
  try { return d.exportHwp(); } finally { try { d.free(); } catch (_) { /* 이미 해제됨 */ } }
}

/* ---------- 변환 ---------- */
export async function hwpToPdf(hwp, o) {
  const { PDFLib, fontkit, fetchBytes, base } = o;
  const onProg = o.onProgress || (() => {});
  const core = await getCore(o);

  const doc = new core.HwpDocument(hwp instanceof Uint8Array ? hwp : new Uint8Array(hwp));
  const pages = [];
  try {
    const n = doc.pageCount();
    for (let i = 0; i < n; i++) { pages.push(parsePage(doc.renderPageSvg(i))); onProg('쪽 읽는 중', i + 1, n); }
  } finally { try { doc.free(); } catch (_) { /* 이미 해제됨 */ } }
  if (!pages.length) throw new Error('쪽이 없는 문서입니다');

  /* 글꼴: 기본은 Noto Sans KR(Regular/Bold) + 본문에 없는 기호를 채우는 Pretendard 기호판.
     문서가 고른 글꼴이 아래 표에 있으면(첫 이름 기준) 그 글꼴을, 명조·바탕 같은 세리프 계열은 나눔명조를 쓴다.
     쓰인 글꼴 파일만 불러오고, 전체 글꼴로 지원 글자를 가려낸 뒤 쓰인 글자만 남겨 PDF에 넣는다. */
  const FONTS = [['R', 'NotoSansKR-Regular'], ['B', 'NotoSansKR-Bold'], ['FR', 'Fallback-Regular'], ['FB', 'Fallback-Bold']];
  const famKey = (ff) => {
    const list = String(ff || '').replace(/&apos;|&quot;|["']/g, '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    const hit = FAMILY_MAP[list[0]]; if (hit) return hit;
    return list.length && list[list.length - 1] === 'serif' ? 'nm' : '';
  };
  const famUsed = new Set();
  for (const p of pages) for (const it of p.items) if (it.t === 'text') { it.fk = famKey(it.a['font-family']); if (it.fk) famUsed.add(it.fk); }
  for (const fk of famUsed) for (const w of ['R', 'B']) FONTS.push([fk + ':' + w, FAMILY_FILES[fk] + '-' + (w === 'R' ? 'Regular' : 'Bold')]);
  const [raw, hbWasm] = await Promise.all([
    Promise.all(FONTS.map(([, n]) => fetchBytes(base + 'fonts/' + n + '.ttf'))), fetchBytes(base + 'lib/harfbuzz-subset.wasm')]);
  const F = {}; FONTS.forEach(([k], i) => { F[k] = { all: raw[i], fk: fontkit.create(raw[i]), use: new Set([0x41]) }; });
  const pickFont = (bold, cp, fk) => {
    if (cp <= 32) return null;
    const w = bold ? 'B' : 'R', pri = w, fb = bold ? 'FB' : 'FR';
    if (fk && F[fk + ':' + w].fk.hasGlyphForCodePoint(cp)) return fk + ':' + w;
    if (F[pri].fk.hasGlyphForCodePoint(cp)) return pri;
    if (F[fb].fk.hasGlyphForCodePoint(cp)) return fb;
    return null;
  };
  for (const p of pages) for (const it of p.items) if (it.t === 'text') {
    const bold = it.a['font-weight'] === 'bold';
    for (const ch of it.text) { const cp = ch.codePointAt(0), k = pickFont(bold, cp, it.fk); if (k) F[k].use.add(cp); }
  }
  onProg('글꼴 준비 중', 0, 1);
  const pdf = await PDFLib.PDFDocument.create();
  pdf.registerFontkit(fontkit);
  for (const [k] of FONTS) {
    if (k !== 'R' && F[k].use.size <= 1) continue;                  // 안 쓰인 글꼴은 넣지 않는다
    F[k].emb = await pdf.embedFont(await subsetFont(hbWasm, F[k].all, [...F[k].use]), { subset: false });
  }
  if (o.title) pdf.setTitle(o.title);
  pdf.setProducer('늘뷰어 한글 문서'); pdf.setCreator('늘뷰어');

  const stat = { text: 0, line: 0, rect: 0, image: 0, skippedImg: 0, skippedShape: 0, missingChars: 0 };
  for (let pi = 0; pi < pages.length; pi++) {
    const { W, H, items } = pages[pi];
    const page = pdf.addPage([W * PX2PT, H * PX2PT]);
    /* 같은 줄·같은 서식의 이어진 글자는 한 덩어리(TJ)로 묶어, 글자 위치는 SVG 그대로 두면서
       PDF 텍스트는 단어·문장 단위로 이어지게 한다 (검색·복사·읽어주기에 유리) */
    let run = null;
    const flush = () => {
      if (!run) return;
      const r = run; run = null;
      const font = F[r.k].emb, size = r.size * PX2PT;
      page.setFont(font); const fontKey = page.getFont()[1];
      const arr = PDFLib.PDFArray.withContext(pdf.context);
      for (let i = 0; i < r.chs.length; i++) {
        arr.push(font.encodeText(r.chs[i].ch));
        if (i + 1 < r.chs.length) {
          const w = font.widthOfTextAtSize(r.chs[i].ch, size), dx = (r.chs[i + 1].x - r.chs[i].x) * PX2PT;
          const adj = Math.round((-(dx - w) / size) * 1000);
          if (adj) arr.push(PDFLib.PDFNumber.of(adj));
        }
      }
      const sk = r.italic ? Math.tan(12 * Math.PI / 180) : 0;
      page.pushOperators(
        PDFLib.beginText(), PDFLib.setFillingColor(r.color), PDFLib.setFontAndSize(fontKey, size),
        PDFLib.setTextMatrix(1, 0, sk, 1, r.chs[0].x * PX2PT, (H - r.y) * PX2PT),
        PDFLib.PDFOperator.of(PDFLib.PDFOperatorNames.ShowTextAdjusted, [arr]), PDFLib.endText());
      stat.text++;
    };
    const boxes = [];
    for (const { t, a, text, fk } of items) {
      if (t === 'svgOpen') {
        flush();
        const vb = (a.viewBox || '').split(/[\s,]+/).map(Number);
        boxes.push({ x: +a.x || 0, y: +a.y || 0, w: +a.width, h: +a.height, vb: vb.length === 4 && vb.every(Number.isFinite) ? vb : null });
        continue;
      }
      if (t === 'svgClose') { flush(); boxes.pop(); continue; }
      if (t === 'text') {
        if (!text) continue;
        const bold = a['font-weight'] === 'bold';
        const size = +a['font-size'], x = +a.x, y = +a.y, italic = a['font-style'] === 'italic';
        const color = hexColor(PDFLib, a.fill) || PDFLib.rgb(0, 0, 0), fill = a.fill || '';
        let cx = x;
        for (const ch of text) {
          const k = pickFont(bold, ch.codePointAt(0), fk);
          if (!k) { if (ch.trim()) stat.missingChars++; cx += size * 0.5; continue; }
          const last = run && run.chs[run.chs.length - 1];
          if (!(run && run.y === y && run.size === size && run.k === k && run.italic === italic && run.fill === fill && cx - last.x < size * 4 && cx >= last.x)) {
            flush(); run = { y, size, k, italic, fill, color, chs: [] };
          }
          run.chs.push({ ch, x: cx });
          cx += size * 0.5;                       // 한 <text>에 여러 글자가 오는 경우의 대략 간격 (rhwp는 글자마다 <text>를 냄)
        }
      } else if (t !== 'text') flush();
      if (t === 'text') continue;
      if (t === 'line') {
        page.drawLine({
          start: { x: +a.x1 * PX2PT, y: (H - +a.y1) * PX2PT }, end: { x: +a.x2 * PX2PT, y: (H - +a.y2) * PX2PT },
          thickness: Math.max(0.1, +(a['stroke-width'] || 1) * PX2PT), color: hexColor(PDFLib, a.stroke) || PDFLib.rgb(0, 0, 0),
        });
        stat.line++;
      } else if (t === 'rect') {
        const w = +a.width, h = +a.height;
        if (w >= W - 1 && h >= H - 1) continue;                       // 쪽 배경
        const fill = a.fill && a.fill !== 'none' ? hexColor(PDFLib, a.fill) : null;
        const stroke = a.stroke && a.stroke !== 'none' ? hexColor(PDFLib, a.stroke) : null;
        if (!fill && !stroke) continue;
        page.drawRectangle({
          x: +a.x * PX2PT, y: (H - +a.y - h) * PX2PT, width: w * PX2PT, height: h * PX2PT,
          ...(fill ? { color: fill } : {}), ...(stroke ? { borderColor: stroke, borderWidth: Math.max(0.1, +(a['stroke-width'] || 1) * PX2PT) } : {}),
        });
        stat.rect++;
      } else if (t === 'image') {
        const d = (a.href || a['xlink:href'] || '').match(/^data:image\/(png|jpe?g);base64,(.*)$/s);
        if (!d) { stat.skippedImg++; stat.imgErr = 'href ' + (a.href || a['xlink:href'] || '').slice(0, 30); continue; }
        try {
          const bin = Uint8Array.from(atob(d[2]), (c) => c.charCodeAt(0));
          const img = d[1] === 'png' ? await pdf.embedPng(bin) : await pdf.embedJpg(bin);
          let ix = +a.x || 0, iy = +a.y || 0, iw = +a.width, ih = +a.height;
          const bx = boxes[boxes.length - 1];
          if (bx && bx.vb && bx.vb[2] > 0 && bx.vb[3] > 0) {                // 상자(viewBox) 좌표 → 쪽 좌표, 상자 밖은 잘라냄
            const sx = bx.w / bx.vb[2], sy = bx.h / bx.vb[3];
            ix = bx.x + (ix - bx.vb[0]) * sx; iy = bx.y + (iy - bx.vb[1]) * sy; iw *= sx; ih *= sy;
            page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.rectangle(bx.x * PX2PT, (H - bx.y - bx.h) * PX2PT, bx.w * PX2PT, bx.h * PX2PT), PDFLib.clip(), PDFLib.endPath());
            page.drawImage(img, { x: ix * PX2PT, y: (H - iy - ih) * PX2PT, width: iw * PX2PT, height: ih * PX2PT });
            page.pushOperators(PDFLib.popGraphicsState());
          } else page.drawImage(img, { x: ix * PX2PT, y: (H - iy - ih) * PX2PT, width: iw * PX2PT, height: ih * PX2PT });
          stat.image++;
        } catch (e) { stat.skippedImg++; stat.imgErr = String((e && e.message) || e).slice(0, 80); }
      } else stat.skippedShape++;                                      // path·도형 등: 아직 지원 안 함
    }
    flush();
    onProg('PDF 만드는 중', pi + 1, pages.length);
  }

  /* 원본 HWP를 첨부 → 서재 동기화·백업을 따라 함께 움직인다 */
  const now = new Date();
  await pdf.attach(hwp instanceof Uint8Array ? hwp : new Uint8Array(hwp), (o.name || 'document') + (o.ext || '.hwp'),
    { mimeType: 'application/x-hwp', description: '늘뷰어 한글 문서 원본', creationDate: now, modificationDate: now });
  const bytes = await pdf.save();
  return { pdf: bytes, pages: pages.length, stat };
}

/* PDF 첨부에서 HWP 원본 꺼내기 (pdf.js의 getAttachments 결과를 넘긴다) */
export function pickHwpAttachment(att) {
  if (!att) return null;
  for (const k of Object.keys(att)) { const f = att[k]; if (f && /\.hwpx?$/i.test(f.filename || k) && f.content) return { name: f.filename || k, bytes: f.content }; }
  return null;
}
