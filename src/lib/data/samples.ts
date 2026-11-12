const names = ['김하늘', '이서연', '박민준', '최지우', '정도윤', '강서준', '조은서', '윤지호', '장하준', '임수아'];
const teams = ['개발팀', '디자인팀', '기획팀', '운영팀', '영업팀'];
const cities = ['서울', '부산', '대전', '광주', '제주'];
const items = ['키보드', '모니터', '의자', '책상', '마우스', '헤드셋', '웹캠', '거치대'];

export function sampleJson(): string {
  const orders = Array.from({ length: 240 }, (_, i) => ({
    id: 1001 + i,
    customer: { name: names[(i * 7) % names.length], team: teams[(i * 3) % teams.length], vip: i % 9 === 0 },
    city: cities[(i * 11) % cities.length],
    items: Array.from({ length: 1 + (i % 3) }, (_, k) => ({ name: items[(i + k * 3) % items.length], qty: 1 + ((i + k) % 4), price: 12000 + ((i * 37 + k * 911) % 40) * 2500 })),
    paid: i % 5 !== 0,
    orderedAt: `2026-${String(1 + (i % 11)).padStart(2, '0')}-${String(1 + ((i * 5) % 28)).padStart(2, '0')}T${String(9 + (i % 9)).padStart(2, '0')}:30:00+09:00`,
    memo: i % 13 === 0 ? '부재 시 경비실에 맡겨 주세요' : null,
  }));
  return JSON.stringify({ shop: 'tools.euiyun.com', exportedAt: '2026-11-13T09:00:00+09:00', currency: 'KRW', total: orders.length, orders }, null, 2);
}

export function sampleCsv(): string {
  const lines = ['사번,이름,부서,지역,입사일,연봉(만원),비고'];
  for (let i = 0; i < 400; i++) {
    const memo = i % 17 === 0 ? '"재택, 주 2회"' : i % 23 === 0 ? '"""팀장"" 겸직"' : '';
    lines.push(
      [`E${String(1000 + i)}`, names[(i * 7) % names.length], teams[(i * 3) % teams.length], cities[(i * 11) % cities.length], `20${String(10 + (i % 16)).padStart(2, '0')}-${String(1 + (i % 12)).padStart(2, '0')}-01`, 3200 + ((i * 131) % 60) * 100, memo].join(','),
    );
  }
  return lines.join('\n') + '\n';
}
