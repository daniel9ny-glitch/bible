/* 늘뷰어 단위 점검 — 브라우저 없이 index.html 안의 "계산만 하는 함수"를 꺼내 시험합니다.
   `npm run unit`  (설치할 것 없음: Node만 있으면 됩니다) */
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').split('\n');

/* 이름으로 정의(한 줄 또는 여러 줄)를 찾아, 문법이 완성될 때까지 줄을 이어 붙여 꺼낸다 */
function grab(name) {
  const re = new RegExp('^(?:async\\s+)?(?:const|let|function)\\s+' + name + '\\b');
  const i = src.findIndex(l => re.test(l));
  if (i < 0) throw new Error('정의를 찾지 못했습니다: ' + name);
  let code = '';
  for (let j = i; j < Math.min(src.length, i + 40); j++) {
    code += (code ? '\n' : '') + src[j];
    try { new Function(code); return code; } catch (e) { /* 아직 덜 이어붙임 */ }
  }
  throw new Error('정의를 끝까지 읽지 못했습니다: ' + name);
}
const load = (names, ret) => new Function(names.map(grab).join('\n') + '\nreturn {' + ret.join(',') + '};')();

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); pass++; console.log('  통과 · ' + n); } catch (e) { fail++; console.log('  실패 · ' + n + '\n      ' + e.message); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || '') + ' 기대 ' + JSON.stringify(b) + ' / 실제 ' + JSON.stringify(a)); };
const ok = (c, m) => { if (!c) throw new Error(m || '조건이 맞지 않습니다'); };

const U = load(['clamp', 'fmtBytes', 'progPct', 'hamm', 'natCmp', 'rgbHex', 'hsv2hex', 'safeName', 'cleanUrl', 'normUrl', 'gFriendly', 'qrAdd'],
  ['clamp', 'fmtBytes', 'progPct', 'hamm', 'natCmp', 'rgbHex', 'hsv2hex', 'safeName', 'cleanUrl', 'normUrl', 'gFriendly', 'qrAdd']);

test('clamp: 범위 안으로 맞춘다', () => { eq(U.clamp(5, 0, 3), 3); eq(U.clamp(-1, 0, 3), 0); eq(U.clamp(2, 0, 3), 2); });
test('fmtBytes: KB·MB·GB 단위', () => { eq(U.fmtBytes(500), '1KB'); eq(U.fmtBytes(2048), '2KB'); eq(U.fmtBytes(5 * 1048576), '5.0MB'); eq(U.fmtBytes(3 * 1073741824), '3.00GB'); });
test('progPct: 읽음 비율', () => {
  eq(U.progPct({ pages: 10, maxPage: 4 }), 50);
  eq(U.progPct({ pages: 10, lastPage: 9 }), 100);
  eq(U.progPct({ pages: 1 }), 0, '한 쪽짜리를 읽은 적 없으면 0');
  eq(U.progPct({ pages: 1, readMs: 1000 }), 100, '한 쪽짜리를 읽었으면 100');
  ok(U.progPct({ pages: 3, maxPage: 99 }) <= 100, '100을 넘지 않는다');
});
test('hamm: 표지 지문(64자) 차이 세기', () => {
  const a = '0'.repeat(64), b = '0'.repeat(60) + '1111';
  eq(U.hamm(a, a), 0); eq(U.hamm(a, b), 4);
});
test('natCmp: 한국어·숫자 자연 정렬', () => {
  eq(['제10과', '제2과', '제1과'].sort(U.natCmp), ['제1과', '제2과', '제10과']);
  eq(['나', '가', '다'].sort(U.natCmp), ['가', '나', '다']);
  eq(['file10', 'file9', 'file1'].sort(U.natCmp), ['file1', 'file9', 'file10']);
});
test('rgbHex·hsv2hex: 색 변환', () => {
  eq(U.rgbHex(255, 0, 0), '#ff0000'); eq(U.rgbHex(300, -5, 15.4), '#ff000f', '범위 밖 값은 맞춘다');
  eq(U.hsv2hex(0, 1, 1), '#ff0000'); eq(U.hsv2hex(120, 1, 1), '#00ff00'); eq(U.hsv2hex(240, 1, 1), '#0000ff');
  eq(U.hsv2hex(0, 0, 1), '#ffffff'); eq(U.hsv2hex(0, 0, 0), '#000000');
});
test('safeName: 파일 이름에 못 쓰는 글자를 바꾼다', () => {
  eq(U.safeName('a/b:c*d?'), 'a_b_c_d_'); eq(U.safeName('  '), 'document'); eq(U.safeName('정상 이름.pdf'), '정상 이름.pdf');
});
test('cleanUrl·normUrl: 글 속 주소 다듬기', () => {
  eq(U.cleanUrl('https://a.com/x.'), 'https://a.com/x'); eq(U.cleanUrl('www.a.com),'), 'www.a.com');
  eq(U.normUrl('www.a.com'), 'https://www.a.com'); eq(U.normUrl('http://a.com/'), 'http://a.com/');
});
test('gFriendly: 드라이브 오류를 쉬운 말로', () => {
  ok(/연결하지 못했습니다/.test(U.gFriendly('TypeError: Failed to fetch')));
  ok(/403/.test(U.gFriendly('x (403)'))); ok(/너무 많았습니다/.test(U.gFriendly('x (429)'))); ok(/잠시 응답하지/.test(U.gFriendly('x (503)')));
  ok(/다시 로그인/.test(U.gFriendly('로그인이 만료되었습니다')));
  eq(U.gFriendly('알 수 없음'), '알 수 없음'); eq(U.gFriendly(null), '');
});
test('qrAdd: 같은 QR은 두 번 넣지 않는다', () => {
  const out = [];
  U.qrAdd(out, { fx: .1, fy: .1, fw: .1, fh: .1, text: 'a' });
  U.qrAdd(out, { fx: .12, fy: .12, fw: .05, fh: .05, text: 'a' }); eq(out.length, 1, '겹치면 하나');
  U.qrAdd(out, { fx: .6, fy: .6, fw: .1, fh: .1, text: 'b' }); eq(out.length, 2, '떨어져 있으면 둘');
});


/* ===== 저장 키 문서(저장키_목록.md)와 코드가 어긋나지 않는지 =====
   새 `neul-…` 키를 코드에 넣고 문서에 안 적으면 여기서 실패합니다. 반대로 문서에만 남은 옛 키도 잡습니다. */
const html = src.join('\n'), doc = fs.readFileSync(path.join(__dirname, '..', '저장키_목록.md'), 'utf8');
/* 저장 키가 아닌 이름(창 이름·캐시 이름·DB 이름·표지 글머리 등) — 늘릴 때는 이유를 같이 적을 것 */
const NOT_KEYS = new Set(['neul-build', 'neul-item', 'neul-tmp-', 'neul-hwp', 'neul-hwp-', 'neul-viewer', 'neul-bible', 'neul-', 'neul-dupo-loose']);
const codeTok = [...new Set(html.match(/neul-[a-z0-9_-]*/g) || [])].filter(t => !NOT_KEYS.has(t));
const sections = doc.split(/^## /m).slice(1).map(b => ({ title: b.split('\n')[0], toks: [...new Set((b.match(/`(neul-[a-z0-9_<>가-힣*-]*)`/g) || []).map(x => x.slice(1, -1).replace(/<[^>]*>/g, '').replace(/\*/g, '')))] }));
const keySecs = sections.filter(x => /^[1-7]\./.test(x.title));
const docTok = [...new Set(keySecs.flatMap(x => x.toks))];
const same = (a, b) => a === b || (b.endsWith('-') && a.startsWith(b)) || (a.endsWith('-') && b.startsWith(a));
const syncKey = load(['setSyncKey'], ['setSyncKey']).setSyncKey;

test('저장 키: 코드에 있는 키는 모두 문서에 적혀 있다', () => {
  const miss = codeTok.filter(t => !docTok.some(d => same(t, d)));
  eq(miss, [], '문서에 없는 키(저장키_목록.md에 추가하세요; 저장 키가 아니면 unit.cjs의 NOT_KEYS에):');
});
test('저장 키: 문서에만 있고 코드에는 없는 옛 키가 없다', () => {
  const stale = docTok.filter(d => !codeTok.some(t => same(t, d)));
  eq(stale, [], '코드에 없는 키(문서에서 지우세요):');
});
test('동기화 분류: 1번 표의 키는 모두 setSyncKey에 걸리고, 나머지 표의 키는 걸리지 않는다', () => {
  const sample = t => t.endsWith('-') ? t + 'x' : t;
  const s1 = keySecs.filter(x => /^1\./.test(x.title)).flatMap(x => x.toks).filter(t => t !== 'neul-setst');
  const rest = keySecs.filter(x => !/^1\./.test(x.title)).flatMap(x => x.toks);
  eq(s1.filter(t => !syncKey(sample(t))), [], '1번 표에 적었는데 동기화되지 않는 키(setSyncKey에 추가하거나 다른 표로):');
  eq(rest.filter(t => syncKey(sample(t))), [], '동기화되는데 1번 표 밖에 적힌 키(1번 표로 옮기세요):');
});
test('동기화 분류: setSyncKey가 받아들이는 키는 모두 1번 표에 있다', () => {
  const rx = html.match(/function setSyncKey\(k\)\{return \/\^neul-\(([^)]*)\)\$\//);
  ok(rx, 'setSyncKey 정규식을 찾지 못했습니다');
  const names = rx[1].split('|').map(n => 'neul-' + n.replace(/\.\+$/, '').replace(/-$/, '-'));
  const s1 = keySecs.filter(x => /^1\./.test(x.title)).flatMap(x => x.toks);
  eq(names.filter(n => !s1.some(d => same(n, d))), [], '동기화되는데 문서(1번 표)에 없는 키:');
});

console.log('\n통과 ' + pass + ' / 실패 ' + fail);
process.exit(fail ? 1 : 0);
