# tools

[tools.euiyun.com](https://tools.euiyun.com) — 단순해 보이지만 끝까지 만든 웹 도구 모음.
문서 작업은 [office.euiyun.com](https://office.euiyun.com), 그보다 작은 도구는 여기에 둔다.

| 도구 | 경로 | 핵심 |
| --- | --- | --- |
| 계산기 | `/calculator` | 직접 만든 수식 파서 + 임의 정밀도 10진 연산, 공학 · 프로그래머 모드, 기록 · 메모리 |
| 이미지 편집기 | `/image` | 벡터 주석(화살표 · 도형 · 글자 · 번호), 모자이크 · 블러, 자르기 · 크기 · 회전 · 보정, 배경 꾸미기 |
| 이미지 일괄 변환 | `/convert` | 여러 장을 한꺼번에 JPG · PNG · WebP 로, 긴 쪽 · 비율로 크기 줄이기, 목표 용량에 맞는 품질 이분 탐색, EXIF(위치 · 기기) 읽어서 알려 주고 지우기, 앞뒤 비교, 직접 만든 ZIP 쓰기 |
| 추첨기 | `/raffle` | 엑셀 붙여넣기, 경품별 인원, 암호학적 난수, 전체 화면 무대(막 · 조명 · 이름 릴 · 색종이), 결과 내보내기 |
| 조 편성 · 사다리 | `/team` | 인원은 고르게 · 부가 정보(소속 · 성별)는 섞어서 · 떨어뜨릴 사람 / 묶을 사람 조건, 조장 뽑기, 결과를 먼저 공평하게 뽑고 그 결과가 나오게 그리는 사다리 |
| 비교 | `/diff` | 직접 만든 diff 엔진(Myers + patience), 좌우 두 창이 그대로 편집기(CodeMirror) — 고치는 대로 다시 비교 · 줄 맞춤 빈칸 · 블록 복사 · 찾기 · 되돌리기, 줄 · 단어 단위 강조, 패치 내보내기, JSON 정규화, 이미지 슬라이더 · 픽셀 차이 |
| 화면 녹화 | `/recorder` | 화면 · 창 · 탭 녹화, 구간 · 영역 자르기, 직접 만든 GIF 인코더(공용 팔레트 + 바뀐 영역만 기록), 영상 → GIF |
| 데이터 뷰어 | `/data` | JSON 트리 · CSV 표(보이는 줄만 그려 100만 행도 바로), 검색 · 경로 복사, 정렬 · 거르기, JSON · YAML · TOML · CSV 를 알아서 읽고 서로 변환 |
| 텍스트 | `/text` | 정규식 시험(작업자에서 돌려 끝나지 않는 식은 끊음) · 한 조각씩 우리말 풀이 · 바꾸기 · 묶음을 표로 복사, 줄 정렬 · 겹치는 줄 지우기 · 잇기, 글자 수 · 바이트 · 원고지 |
| QR 코드 | `/qr` | 직접 만든 QR 인코더(버전 1~40), Wi-Fi · 연락처 양식, 모양 · 색 · 로고, 브라우저 인식기로 읽기 확인 |
| 행사 타이머 | `/timer` | 순서표, 발표자 화면을 다른 창으로(BroadcastChannel 동기화), 화면 메시지, 경고 색 · 소리 |

모든 도구는 브라우저 안에서만 동작한다. 서버로 보내는 코드가 없고 CSP(`connect-src 'self'`)로도 막는다.
서비스 워커가 빌드 산출물을 캐시하므로 한 번 열면 오프라인에서도 쓸 수 있다.

## 개발

```sh
npm install
npm run dev        # 개발 서버
npm run check      # 타입 검사
npm test           # 단위 테스트 (계산 · 추첨 · 릴 · diff · GIF · CSV/JSON · QR · 타이머 · 이미지 변환 · 조 편성/사다리 · 정규식/줄 정리)
npm run build && npx vite preview --port 4317 &
npm run e2e        # 실제 브라우저(설치된 Chrome)로 핵심 흐름 확인, 스크린샷은 e2e/screenshots
npm run deploy     # Cloudflare Pages (프로젝트 이름: tools)
```

## 구조

- `src/lib/tools.ts` — 도구 목록. 새 도구는 여기에 등록하고 `src/routes/<id>/+page.svelte` 를 만든다.
- `src/lib/ui/ToolShell.svelte` — 모든 도구가 쓰는 공통 틀(머리글, 도구별 강조색).
- `src/lib/ui/ToolDrawer.svelte` — 왼쪽 서랍(도구 목록). `tools.ts` 의 `short` · `icon` 을 쓴다.
- `src/lib/ui/VirtualList.svelte` — 보이는 줄만 그리는 목록 (데이터 뷰어).
- `src/lib/calc/` — 수식 엔진(`engine.ts`), 프로그래머 모드(`programmer.ts`).
- `src/lib/raffle/` — 추첨 로직(`core.ts`), 무대(`Stage.svelte`), 이름 릴 움직임(`reel.ts`), 무대 조명(`backdrop.ts`), 효과음 · 색종이 · 불꽃.
- `src/lib/image/` — 도형 모델(`shapes.ts`), 픽셀 처리(`raster.ts`), 편집기 상태(`editor.svelte.ts`).
- `src/lib/diff/` — 비교 엔진(`core.ts`), 픽셀 비교(`image.ts`), 화면(`TextDiff.svelte`, `ImageDiff.svelte`), 편집기 장식(`editor.ts`).
- `src/lib/recorder/gif.ts` — GIF 인코더 (팔레트 양자화, LZW, 프레임 차분).
- `src/lib/data/core.ts` — 형식 판단(JSON · YAML · TOML · CSV)과 변환, CSV 파서, JSON 트리 펼치기 · 검색, 표 변환 · 정렬. YAML · TOML 읽기/쓰기는 `yaml` · `smol-toml`.
- `src/lib/qr/` — QR 인코더(`core.ts`), 내용 양식(`payload.ts`), SVG 그리기(`render.ts`).
- `src/lib/convert/` — 크기 계산 · 목표 용량 탐색 · EXIF 읽기 · ZIP 쓰기(`core.ts`), 캔버스로 읽고 다시 담기(`pipeline.ts`).
- `src/lib/team/core.ts` — 조 편성(무작위로 나눈 뒤 맞바꾸며 다듬기), 사다리(뽑은 결과 → 가로대), 길 따라가기. 명단 파서와 난수는 `raffle/core.ts` 것을 쓴다.
- `src/lib/text/` — 정규식 실행 · 풀이 · 오류 번역(`regex.ts`), 작업자와 시간 제한(`match.worker.ts`, `runner.ts`), 줄 정리 · 글자 수(`lines.ts`).
- `src/lib/timer/` — 타이머 계산(`core.ts`), 창 사이 동기화(`store.svelte.ts`), 무대(`Stage.svelte`).

SvelteKit + adapter-static 으로 정적 사이트를 만든다 (office 와 같은 구성).
