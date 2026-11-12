export interface ToolInfo {
  id: string;
  href: string;
  name: string;
  /** 서랍 목록에 쓰는 한 줄 */
  short: string;
  /** 24x24 선 아이콘 path */
  icon: string;
  tagline: string;
  color: string;
  features: string[];
  keywords: string;
}

export const tools: ToolInfo[] = [
  {
    id: 'calculator',
    href: '/calculator',
    name: '계산기',
    short: '수식 · 공학 · 프로그래머',
    icon: 'M6.5 3h11A1.5 1.5 0 0 1 19 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3zM8.5 7h7v3h-7zM8.5 14h.01M12 14h.01M15.5 14h.01M8.5 17.5h.01M12 17.5h.01M15.5 17.5h.01',
    tagline: '수식을 그대로 쓰는 계산기. 0.1 + 0.2 는 정확히 0.3 입니다.',
    color: 'var(--c-calc)',
    features: ['임의 정밀도 10진 연산', '공학 함수 · 각도 단위', '프로그래머 모드 (비트 연산)', '계산 기록 · 메모리'],
    keywords: 'calculator calc 계산 공학 프로그래머 hex bin 진법',
  },
  {
    id: 'image',
    href: '/image',
    name: '이미지 편집기',
    short: '주석 · 모자이크 · 자르기',
    icon: 'M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4zM4.5 16.5l4.5-4.5 4 4 2.5-2.5 4 4M14.5 9a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
    tagline: '스크린샷을 붙여넣고, 표시하고, 가리고, 다듬어서 바로 복사합니다.',
    color: 'var(--c-image)',
    features: ['화살표 · 도형 · 텍스트 · 번호', '모자이크 · 블러로 가리기', '자르기 · 크기 · 회전 · 보정', '배경 꾸미기 · PNG/JPEG/WebP'],
    keywords: 'image screenshot editor 이미지 스크린샷 캡처 편집 모자이크 자르기 crop annotate',
  },
  {
    id: 'raffle',
    href: '/raffle',
    name: '추첨기',
    short: '행사용 경품 추첨',
    icon: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5V10a2 2 0 0 0 0 4v1.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 15.5V14a2 2 0 0 0 0-4zM14 7v2M14 11.5v1M14 15v2',
    tagline: '수백 명 명단도 거뜬한 행사용 추첨. 강당 스크린을 위한 전체 화면.',
    color: 'var(--c-raffle)',
    features: ['엑셀에서 붙여넣기 · 번호 범위', '경품별 인원 · 중복 당첨 방지', '전체 화면 무대 · 효과음', '암호학적 난수 · 결과 내보내기'],
    keywords: 'raffle lottery draw 추첨 뽑기 경품 행사 랜덤 제비',
  },
  {
    id: 'diff',
    href: '/diff',
    name: '비교',
    short: '텍스트 · JSON · 이미지 차이',
    icon: 'M5.5 4h5A1.5 1.5 0 0 1 12 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4zM15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M6.5 12h3M16 9.5v5M13.5 12h5',
    tagline: '두 글, 두 JSON, 두 이미지에서 달라진 곳만 정확히 짚어 줍니다.',
    color: 'var(--c-diff)',
    features: ['줄 · 단어 단위 차이 강조', '나란히 / 한 줄로 보기 · 패치 내보내기', 'JSON 키 순서 · 들여쓰기 무시', '이미지 슬라이더 · 픽셀 차이'],
    keywords: 'diff compare 비교 차이 텍스트 json 이미지 patch merge 변경',
  },
  {
    id: 'recorder',
    href: '/recorder',
    name: '화면 녹화',
    short: '녹화 · 구간/영역 자르기 · GIF',
    icon: 'M5.5 6h9A1.5 1.5 0 0 1 16 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 16.5v-9A1.5 1.5 0 0 1 5.5 6zM16 10.5l4-2.5v8l-4-2.5M8.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
    tagline: '화면을 녹화해서 필요한 부분만 GIF 나 영상으로. 올리지 않고 바로 만듭니다.',
    color: 'var(--c-rec)',
    features: ['전체 화면 · 창 · 탭 녹화, 소리 포함', '구간 · 영역 자르기', '용량을 줄인 GIF 인코더', '영상 파일 → GIF 변환'],
    keywords: 'screen record recorder gif video 화면 녹화 캡처 영상 움짤 변환 webm mp4',
  },
  {
    id: 'data',
    href: '/data',
    name: '데이터 뷰어',
    short: 'JSON 트리 · CSV 표 · 변환',
    icon: 'M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4zM4 9.5h16M4 14.5h16M9.5 9.5V20',
    tagline: '큰 JSON 과 CSV 를 바로 펼쳐 보고, 찾고, 서로 바꿉니다.',
    color: 'var(--c-data)',
    features: ['수십만 줄도 끊김 없는 트리 · 표', '키 · 값 검색, 경로 복사', '정렬 · 거르기 · 엑셀용 복사', 'JSON ↔ CSV 변환, 오류 위치 표시'],
    keywords: 'json csv tsv viewer data table tree 데이터 뷰어 표 트리 변환 포맷 정렬 jsonl',
  },
  {
    id: 'qr',
    href: '/qr',
    name: 'QR 코드',
    short: '링크 · Wi-Fi · 연락처 · 로고',
    icon: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 20h.01M20 14h.01M7 7h.01M17 7h.01M7 17h.01',
    tagline: '링크, Wi-Fi, 연락처를 QR 로. 꾸민 뒤에도 실제로 읽히는지 확인해 줍니다.',
    color: 'var(--c-qr)',
    features: ['링크 · Wi-Fi · 연락처 · 이메일 · 문자', '점 · 귀퉁이 모양, 색, 가운데 로고', '읽기 확인 · 색 대비 경고', 'PNG (최대 4096px) · SVG'],
    keywords: 'qr qrcode 큐알 코드 바코드 wifi 와이파이 명함 vcard 링크 생성',
  },
  {
    id: 'timer',
    href: '/timer',
    name: '행사 타이머',
    short: '순서표 · 발표자 화면 · 메시지',
    icon: 'M12 6a7.5 7.5 0 1 0 0 15a7.5 7.5 0 1 0 0-15zM12 9.5v4l2.5 1.5M9.5 3h5M12 3v3',
    tagline: '순서표대로 흘러가는 발표 · 행사용 타이머. 무대 화면은 따로, 조작은 내 자리에서.',
    color: 'var(--c-timer)',
    features: ['순서표 붙여넣기 · 끝나는 시각 예상', '발표자 화면을 다른 창으로 (동기화)', '화면에 크게 띄우는 메시지', '경고 색 · 소리 · 초과 시간'],
    keywords: 'timer countdown stopwatch 타이머 카운트다운 발표 행사 시간 스톱워치 진행',
  },
];

export function toolById(id: string): ToolInfo {
  const t = tools.find((x) => x.id === id);
  if (!t) throw new Error(`unknown tool: ${id}`);
  return t;
}
