# tools

[tools.euiyun.com](https://tools.euiyun.com) — 단순해 보이지만 끝까지 만든 웹 도구 모음.
문서 작업은 [office.euiyun.com](https://office.euiyun.com), 그보다 작은 도구는 여기에 둔다.

| 도구 | 경로 | 핵심 |
| --- | --- | --- |
| 계산기 | `/calculator` | 직접 만든 수식 파서 + 임의 정밀도 10진 연산, 공학 · 프로그래머 모드, 기록 · 메모리 |
| 단위 변환 | `/unit` | 적은 그대로 알아듣기("32평" · "5'11\"" · "시속 100km" · "32평은 몇 m²"), 헷갈리는 이름(근 · 킬로 · Mb)은 다른 뜻도 제안, 값을 분수로 들고 다녀 정확한 10진수(121평 = 정확히 400 m²), 13가지 분류(우리 단위 · 데이터 1000/1024 · 전송 속도 · 인쇄 DPI · 용지 크기 · 온도 차이 · 거꾸로 가는 연비), Windows 에 보이는 크기, 받는 데 걸리는 시간 |
| 날짜 계산기 | `/date` | 두 날짜 사이 · 며칠 뒤를 근무일로, 공휴일 · 대체공휴일을 규정대로 계산, 음력 명절은 표 없이 달과 해의 위치를 계산해서(Meeus), 연차 붙이기 좋은 날, 시간대가 다른 곳과 겹치는 근무 시간, 음력 ↔ 양력, 공휴일 달력 파일(.ics) |
| cron 풀이 | `/cron` | 직접 만든 cron 해석기: Unix(Vixie · cronie) · Spring · Quartz · AWS EventBridge 형식을 칸 수와 `?` 로 알아보기, `L` · `LW` · `15W` · `2#3` · `5L` · 연도 · `@daily` · `rate()`, 식 전체를 한 문장으로 · 칸마다 풀이(커서가 있는 칸 강조), 틀린 글자를 짚고 고치는 법, 흔한 함정 경고(일 · 요일 "또는", `*/45`, `* 9 * * *`, Quartz 의 1 = 일요일), 다음 · 지난 실행(시간대 · 서머타임 · 공휴일 표시, 돌지 않는 식은 까닭을), 말로 고르는 빌더, 다른 형식으로 옮기기, crontab · GitHub Actions(UTC 로 옮기기) · Kubernetes · Spring · AWS 설정 |
| 인코딩 · 해시 | `/encode` | 붙여넣은 글이 무엇인지 알아서 판단(JWT · Base64 · URL · 16진수 · 유닉스 시각 · UUID …)하고 그럴듯한 순서로 풀기, 겹겹이 싸인 것은 이어서 풀기, JWT 만료 · HS 서명 확인, 직접 만든 MD5 · CRC32 · Punycode, 파일 해시(조각내어 읽기) · HMAC · 체크섬 비교, UUID v4/v7 · ULID · 토큰 · 비밀번호 |
| 이미지 편집기 | `/image` | 벡터 주석(화살표 · 도형 · 글자 · 번호), 모자이크 · 블러, 자르기 · 크기 · 회전 · 보정, 배경 꾸미기 |
| 이미지 일괄 변환 | `/convert` | 여러 장을 한꺼번에 JPG · PNG · WebP 로, 긴 쪽 · 비율로 크기 줄이기, 목표 용량에 맞는 품질 이분 탐색, EXIF(위치 · 기기) 읽어서 알려 주고 지우기, 앞뒤 비교, 직접 만든 ZIP 쓰기 |
| 색상 · 대비 | `/color` | 붙여넣은 색을 어떤 표기로든 알아듣고(HEX · rgb() · hsl() · hwb() · lab() · lch() · oklab() · oklch() · color(display-p3 …) · 이름 · 0xAARRGGBB …) 서로 바꾸기, sRGB 밖의 색은 CSS Color 4 방식으로 채도만 줄여 맞춤, WCAG 명암비 AA · AAA(반투명은 겹쳐서) · APCA 참고값, 밝기만 옮겨 기준을 넘는 가장 가까운 색 제안, OKLCH 밝기 단계(50~950) · 어울리는 색 · CSS 변수 / Tailwind / JSON 내보내기, 색각 이상 흉내(Machado 2009), 화면(EyeDropper) · 사진에서 색 따오기(돋보기 · 평균 · 주요 색), 모아 둔 색 |
| 이름표 · 좌석표 | `/badge` | A4 라벨 규격 · 접는 명패에 맞춰 인쇄(mm 그대로), 이름 길이에 맞춰 글자 크기를 알아서, 사람마다 QR, 자리 배치(원탁 · 긴 탁자 가로/세로 · 2인 책상 모둠 · 줄 맞춤을 자리 × 열 × 행으로, 소속 섞기 · 떨어뜨릴 사람), 테이블을 끌어서 실제 자리대로, 소속마다 색, 프로젝터용 전체 화면, 설정을 바꾸면 바로 다시 배치, 사람을 끌어 자리 맞바꾸기, 오른쪽 클릭으로 자리 · 책상 · 테이블을 막거나 치우기, 이름으로 찾는 표 |
| 추첨기 | `/raffle` | 엑셀 붙여넣기, 경품별 인원, 암호학적 난수, 전체 화면 무대(막 · 조명 · 이름 릴 · 색종이), 결과 내보내기 |
| 조 편성 · 사다리 | `/team` | 인원은 고르게 · 부가 정보(소속 · 성별)는 섞어서 · 떨어뜨릴 사람 / 묶을 사람 조건, 조장 뽑기, 결과를 먼저 공평하게 뽑고 그 결과가 나오게 그리는 사다리 |
| 비교 | `/diff` | 직접 만든 diff 엔진(Myers + patience), 좌우 두 창이 그대로 편집기(CodeMirror) — 고치는 대로 다시 비교 · 줄 맞춤 빈칸 · 블록 복사 · 찾기 · 되돌리기, 줄 · 단어 단위 강조, 패치 내보내기, JSON 정규화, 이미지 슬라이더 · 픽셀 차이 |
| 화면 녹화 | `/recorder` | 화면 · 창 · 탭 녹화, 구간 · 영역 자르기, 직접 만든 GIF 인코더(공용 팔레트 + 바뀐 영역만 기록), 영상 → GIF |
| 데이터 뷰어 | `/data` | JSON 트리 · CSV 표(보이는 줄만 그려 100만 행도 바로), 검색 · 경로 복사, 정렬 · 거르기, JSON · YAML · TOML · CSV 를 알아서 읽고 서로 변환 |
| 텍스트 | `/text` | 정규식 시험(작업자에서 돌려 끝나지 않는 식은 끊음) · 한 조각씩 우리말 풀이 · 바꾸기 · 묶음을 표로 복사, 줄 정렬 · 겹치는 줄 지우기 · 잇기, 글자 수 · 바이트 · 원고지 |
| QR 코드 | `/qr` | 직접 만든 QR 인코더(버전 1~40), Wi-Fi · 연락처 양식, 모양 · 색 · 로고, 브라우저 인식기로 읽기 확인 |
| 행사 타이머 | `/timer` | 순서표(길이 또는 "몇 시까지"), 발표자 화면을 다른 창으로(BroadcastChannel 동기화), 화면 메시지, 경고 색 · 소리, 무대 배경(물 · 모래 · 별 · 오로라), 순서표 · 설정을 주소에 담아 링크로 공유 |

모든 도구는 브라우저 안에서만 동작한다. 서버로 보내는 코드가 없고 CSP(`connect-src 'self'`)로도 막는다.
서비스 워커가 빌드 산출물을 캐시하므로 한 번 열면 오프라인에서도 쓸 수 있다.

도구끼리는 결과를 넘길 수 있다: 화면 녹화의 한 장면 → 이미지 편집기, 이미지 편집기 → 일괄 변환, 데이터 뷰어의 두 부분 → 비교.
받는 도구가 새 탭으로 열리므로 하던 작업은 그대로 남는다 (`src/lib/handoff.ts`, 같은 브라우저의 탭끼리만 오가는 BroadcastChannel).

## 개발

```sh
npm install
npm run dev        # 개발 서버
npm run check      # 타입 검사
npm test           # 단위 테스트 (계산 · 추첨 · 릴 · diff · GIF · CSV/JSON · QR · 타이머 · 이미지 변환 · 조 편성/사다리 · 정규식/줄 정리 · 날짜/음력/공휴일/시간대 · 이름표/좌석 · 인코딩/해시 · 색상 · 단위 · cron)
npm run build && npx vite preview --port 4317 &
npm run e2e        # 실제 브라우저(설치된 Chrome)로 핵심 흐름 확인 (smoke · badge · encode · color · unit · cron), 스크린샷은 e2e/screenshots
npm run deploy     # Cloudflare Pages (프로젝트 이름: tools)
```

## 구조

- `src/lib/tools.ts` — 도구 목록. 새 도구는 여기에 등록하고 `src/routes/<id>/+page.svelte` 를 만든다.
- `src/lib/ui/ToolShell.svelte` — 모든 도구가 쓰는 공통 틀(머리글, 도구별 강조색).
- `src/lib/ui/ToolDrawer.svelte` — 왼쪽 서랍(도구 목록). `tools.ts` 의 `short` · `icon` 을 쓴다.
- `src/lib/ui/VirtualList.svelte` — 보이는 줄만 그리는 목록 (데이터 뷰어).
- `src/lib/calc/` — 수식 엔진(`engine.ts`), 프로그래머 모드(`programmer.ts`).
- `src/lib/unit/` — 단위 표와 용지 크기(`units.ts`: 값은 분수 문자열, 옛 단위는 법정 값이 있는 것만), 적은 글 읽기(`parse.ts`), 바꾸기 · 적기(`core.ts`), 분수로 든 정확한 수(`rat.ts`, decimal.js).
- `src/lib/raffle/` — 추첨 로직(`core.ts`), 무대(`Stage.svelte`), 이름 릴 움직임(`reel.ts`), 무대 조명(`backdrop.ts`), 효과음 · 색종이 · 불꽃.
- `src/lib/image/` — 도형 모델(`shapes.ts`), 픽셀 처리(`raster.ts`), 편집기 상태(`editor.svelte.ts`).
- `src/lib/diff/` — 비교 엔진(`core.ts`), 픽셀 비교(`image.ts`), 화면(`TextDiff.svelte`, `ImageDiff.svelte`), 편집기 장식(`editor.ts`).
- `src/lib/recorder/gif.ts` — GIF 인코더 (팔레트 양자화, LZW, 프레임 차분).
- `src/lib/data/core.ts` — 형식 판단(JSON · YAML · TOML · CSV)과 변환, CSV 파서, JSON 트리 펼치기 · 검색, 표 변환 · 정렬. YAML · TOML 읽기/쓰기는 `yaml` · `smol-toml`.
- `src/lib/qr/` — QR 인코더(`core.ts`), 내용 양식(`payload.ts`), SVG 그리기(`render.ts`).
- `src/lib/color/` — 색 공간 변환과 색역 맞춤(`space.ts`), 읽기(`parse.ts`), 표기(`format.ts`), 명암비 · APCA · 통과하는 색 찾기(`contrast.ts`), 밝기 단계 · 어울리는 색 · 내보내기 · 사진의 주요 색(`palette.ts`), 색각 이상 흉내(`cvd.ts`), 탭이 같이 쓰는 상태(`state.svelte.ts`).
- `src/lib/convert/` — 크기 계산 · 목표 용량 탐색 · EXIF 읽기 · ZIP 쓰기(`core.ts`), 캔버스로 읽고 다시 담기(`pipeline.ts`).
- `src/lib/team/core.ts` — 조 편성(무작위로 나눈 뒤 맞바꾸며 다듬기), 사다리(뽑은 결과 → 가로대), 길 따라가기. 명단 파서와 난수는 `raffle/core.ts` 것을 쓴다.
- `src/lib/text/` — 정규식 실행 · 풀이 · 오류 번역(`regex.ts`), 작업자와 시간 제한(`match.worker.ts`, `runner.ts`), 줄 정리 · 글자 수(`lines.ts`).
- `src/lib/date/` — 날 수로 다루는 날짜(`core.ts`), 음력(`lunar.ts`: 합삭 · 중기 계산, 윤달), 공휴일과 대체공휴일(`holidays.ts`), 근무일 · 연휴 · 달력 파일(`work.ts`), 시간대와 겹치는 시간(`zones.ts`), 탭이 같이 쓰는 상태(`state.svelte.ts`). 선거일 · 임시공휴일은 `holidays.ts` 의 `ONE_OFF` 에 손으로 적는다.
- `src/lib/cron/` — 읽기 · 형식 알아보기 · 다음 실행 찾기(`core.ts`: 날짜는 달력 계산으로 거르고 맞는 날만 시간대를 따진다, 서머타임은 그날의 바뀌는 때를 찾아서), 우리말 풀이(`explain.ts`), 조사 고르기(`ko.ts`), 형식 옮기기 · 빌더 · 설정 조각(`format.ts`). 공휴일 · 시간대는 `date/` 것을 쓴다.
- `src/lib/encode/` — 무엇인지 알아보기(`detect.ts`), 풀기 · 만들기(`codec.ts`, `punycode.ts`), 해시(`hash.ts`), JWT(`jwt.ts`), UUID · ULID · 토큰(`ids.ts`), 시각(`time.ts`).
- `src/lib/badge/` — 용지 · 칸 계산, 글자 맞춤, 자리 배치와 배치도 크기(`core.ts`), 이름표 한 장(`Face.svelte`), 배치도(`Plan.svelte`: 끌어 옮기기 · 전체 화면).
- `src/lib/handoff.ts` — 도구 사이에 결과 넘기기 (새 탭 + BroadcastChannel).
- `src/lib/timer/` — 타이머 계산(`core.ts`), 창 사이 동기화(`store.svelte.ts`), 무대(`Stage.svelte`).

SvelteKit + adapter-static 으로 정적 사이트를 만든다 (office 와 같은 구성).
