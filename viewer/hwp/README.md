# 늘뷰어 한글(HWP) 문서 작성 모드

새 노트 > 종류 "한글 문서" 를 고르면 rhwp-studio(한글 편집기)가 전체 화면으로 열립니다.
저장하면 텍스트 층이 있는 PDF가 서재 문서로 만들어지고, 한글 원본(.hwp)은 그 PDF 안에 첨부됩니다.
서재 카드는 일반 PDF처럼 열리고, 문서 관리(⋯) > "한글로 편집"이 첨부된 원본을 편집기에 다시 엽니다.

## 폴더 구성
- `convert.js`      HWP → PDF 변환기 (rhwp 코어로 쪽 SVG를 얻어 pdf-lib로 PDF를 만듦)
- `core/`           @rhwp/core 0.8.7 (MIT) — WASM 파서·렌더러
- `editor/`         @rhwp/editor 0.8.7 (MIT) — 편집기 iframe 연결 코드
- `lib/`            @pdf-lib/fontkit (MIT), harfbuzz-subset.wasm (MIT) — PDF용 글꼴 서브셋
- `fonts/`          PDF에 넣는 글꼴: Noto Sans KR(기본)·나눔고딕·나눔명조·Pretendard Regular/Bold (모두 SIL OFL 1.1). 편집기 글꼴 메뉴의 '늘뷰어 글꼴'과 같은 목록이며, 명조·바탕 계열 문서는 나눔명조로 들어갑니다
- `studio/`         (직접 넣어야 함) rhwp-studio 빌드 결과물. 없으면 온라인 편집기(edwardkim.github.io/rhwp)를 씁니다.

## studio/ 만들기 (오프라인에서도 편집하려면)
```
git clone https://github.com/edwardkim/rhwp.git
cd rhwp
mkdir pkg
# @rhwp/core 0.8.7 의 rhwp.js, rhwp.d.ts, rhwp_bg.wasm, rhwp_bg.wasm.d.ts 를 pkg/ 에 복사
#   (npm i @rhwp/core@0.8.7 후 node_modules/@rhwp/core/ 에서 복사)
cd rhwp-studio
npm install
RHWP_DISABLE_EXTERNAL_WEBFONTS=1 RHWP_WITHOUT_HWPCTRL=1 npx vite build --base=./
# dist/ 안의 모든 파일을 viewer/hwp/studio/ 로 복사
```
