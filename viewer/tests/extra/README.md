# 참고용 시험 스크립트 (추가 점검)

`npm test`(e2e.cjs), `npm run unit`과 달리 **참고용**입니다. 만든 때의 작업 폴더 기준 경로가 들어 있어서, 돌리기 전에 맨 위의 경로(`ROOT`, `out/...`)를 지금 폴더에 맞게 고치세요.
돌릴 때 `NODE_PATH`에 playwright, pdfjs-dist, pdf-lib(, qrcode, pngjs)가 설치된 `node_modules`를 걸어 줍니다.

| 파일 | 무엇을 시험하나 |
|---|---|
| `sync_fakedrive.cjs` | 가짜 구글 드라이브를 세우고 기기 A·B 두 대를 흉내 내어, 한글 문서 동기화·(더 나중에 저장한 쪽이 남는) 충돌 처리·옛 충돌 사본 정리를 확인. 한글 시료는 `tests/fixtures/a.hwp` 등을 씀 |
| `make_qr_pdf.cjs`, `make_qr_pdf2.cjs` | QR 시험용 PDF를 만든다 (그림 QR·도형 QR·주소 아닌 QR / 넓은 쪽의 작은 QR). `qrcode`, `pngjs` 필요 |
| `qr_click.cjs`, `qr_small.cjs` | 그 PDF를 열어 QR 위치를 눌렀을 때 주소로 이동하는지 확인 (실행: `node qr_click.cjs <viewer 폴더>`) |
| `shelf_layout.cjs` | 여러 화면 크기에서 서재가 왼쪽 메뉴인지 위쪽 탭인지 확인 |

시험 중 `window.open`을 가로채 열린 주소를 기록하는 방식이라, 실제로 새 탭이 뜨지는 않습니다.
