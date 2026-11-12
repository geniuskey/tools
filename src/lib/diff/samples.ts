export const sampleText = {
  a: `# 3월 정기 워크숍 안내

안녕하세요, 운영팀입니다.
3월 정기 워크숍을 아래와 같이 진행합니다.

- 일시: 3월 14일(금) 오후 2시 ~ 6시
- 장소: 본사 3층 대회의실
- 대상: 개발팀, 디자인팀

## 일정

1. 14:00 개회 및 분기 실적 공유
2. 14:40 팀별 발표 (팀당 15분)
3. 16:00 휴식
4. 16:20 자유 토론
5. 17:30 경품 추첨 및 마무리

## 준비물

노트북과 사원증을 지참해 주세요.
주차 공간이 부족하니 대중교통을 이용해 주시기 바랍니다.

참석 여부는 3월 7일까지 회신 부탁드립니다.
문의: 운영팀 김하늘 (내선 1234)
`,
  b: `# 3월 정기 워크숍 안내

안녕하세요, 운영팀입니다.
3월 정기 워크숍을 아래와 같이 진행합니다.

- 일시: 3월 21일(금) 오후 1시 ~ 6시
- 장소: 본사 5층 대강당
- 대상: 개발팀, 디자인팀, 기획팀

## 일정

1. 13:00 개회 및 분기 실적 공유
2. 13:40 팀별 발표 (팀당 20분)
3. 16:00 휴식
4. 16:20 자유 토론
5. 17:30 경품 추첨 및 마무리

## 준비물

노트북과 사원증을 지참해 주세요.

## 오시는 길

주차 공간이 부족하니 대중교통을 이용해 주시기 바랍니다.
2호선 강남역 3번 출구에서 도보 5분입니다.

참석 여부는 3월 14일까지 회신 부탁드립니다.
문의: 운영팀 이서연 (내선 1234)
`,
};

export const sampleJson = {
  a: `{
  "name": "tools",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "test": "tsx --test tests/*.test.ts"
  },
  "dependencies": {
    "decimal.js": "^10.6.0"
  },
  "devDependencies": {
    "svelte": "^5.57.3",
    "typescript": "^5.9.3",
    "vite": "^7.3.8"
  },
  "keywords": ["tools", "calculator"]
}
`,
  b: `{"version":"0.2.0","name":"tools","private":true,
 "scripts":{"build":"vite build","dev":"vite dev --host","test":"tsx --test tests/*.test.ts","check":"svelte-check"},
 "devDependencies":{"vite":"^7.3.8","svelte":"^5.60.0","typescript":"^5.9.3"},
 "dependencies":{"decimal.js":"^10.6.0"},
 "keywords":["tools","calculator","diff"]}
`,
};
