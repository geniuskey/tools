import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseParticipants, sampleText } from '../src/lib/raffle/core';
import { parseGroups, type Rand } from '../src/lib/team/core';
import {
  PAPERS, PRESETS, DEFAULT_CUSTOM, assignSeats, badgeLayout, cellRects, checkGrid, customGrid, fillTemplate, fitInfo, fitName, lookup, lookupText,
  nameSpacing, paginate, perPage, presetGrid, presetName, seatIndex, seated, seatingCsv, seatingText, suggestTables, swapSeats, tableSizes, tentGrid,
  toTables, NAME_LINE, type Measure,
} from '../src/lib/badge/core';

/** 테스트마다 같은 결과가 나오는 난수 */
function seeded(seed: number): Rand {
  let s = seed >>> 0;
  return (n) => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    const t = Math.imul(s ^ (s >>> 13), 0x297a2d39) >>> 0;
    return Math.floor(((t ^ (t >>> 16)) >>> 0) / 0x1_0000_0000 * n);
  };
}

/** 한글 · 한자는 1em, 그 밖의 글자는 0.5em 으로 치는 자 */
const measure: Measure = (text, size) => [...text].reduce((w, c) => w + (/[ᄀ-￿]/.test(c) ? 1 : 0.5), 0) * size;
const preset = (id: string) => PRESETS.find((p) => p.id === id)!;

test('칸 놓기: 규격은 종이 가운데에, 시중 라벨 용지와 같은 여백', () => {
  const g = presetGrid(preset('99.1x38.1'), PAPERS.A4);
  assert.deepEqual([g.cols, g.rows, g.left, g.top], [2, 7, 4.65, 15.15]);
  assert.equal(checkGrid(g), null);
  const cells = cellRects(g);
  assert.equal(cells.length, 14);
  assert.deepEqual(cells[0], { x: 4.65, y: 15.15, w: 99.1, h: 38.1 });
  assert.deepEqual(cells[1], { x: 106.25, y: 15.15, w: 99.1, h: 38.1 });
  assert.deepEqual(cells[13], { x: 106.25, y: 243.75, w: 99.1, h: 38.1 });
  // 모든 규격이 A4 에 들어가고, 칸이 겹치지 않는다
  for (const p of PRESETS) {
    const grid = presetGrid(p, PAPERS.A4);
    assert.equal(checkGrid(grid), null, p.id);
    assert.deepEqual([grid.cols, grid.rows], [p.cols, p.rows], p.id);
    const last = cellRects(grid).at(-1)!;
    assert.ok(last.x + last.w <= 210.001 && last.y + last.h <= 297.001, p.id);
  }
  assert.equal(presetName(preset('63.5x38.1')), '라벨 63.5×38.1mm (3×7칸)');
});

test('칸 놓기: Letter 에는 들어가는 만큼만, 접는 명패는 가로로 놓고 반으로', () => {
  const g = presetGrid(preset('100x70'), PAPERS.Letter);
  assert.deepEqual([g.cols, g.rows], [2, 3]);
  assert.equal(checkGrid(g), null);
  const t = tentGrid(PAPERS.A4);
  assert.deepEqual([t.pageW, t.pageH, t.cellW, t.cellH, perPage(t), t.tent], [297, 210, 297, 105, 1, true]);
  assert.equal(checkGrid(t), null);
});

test('칸 놓기: 종이를 넘으면 알려 준다', () => {
  assert.equal(checkGrid(customGrid(DEFAULT_CUSTOM, PAPERS.A4)), null);
  const wide = checkGrid(customGrid({ ...DEFAULT_CUSTOM, cols: 3 }, PAPERS.A4))!;
  assert.match(wide, /가로로 65mm/);
  assert.match(wide, /필요한 너비 275mm, 종이 210mm/);
  assert.doesNotMatch(wide, /세로로/);
  const tall = checkGrid(customGrid({ ...DEFAULT_CUSTOM, rows: 6, gapY: 2 }, PAPERS.A4))!;
  assert.match(tall, /세로로 50\.5mm/);
  const both = checkGrid(customGrid({ ...DEFAULT_CUSTOM, cellW: 120, cellH: 80 }, PAPERS.A4))!;
  assert.match(both, /가로로.*세로로/);
  // 같은 설정이 Letter 에서는 세로로 넘친다
  assert.match(checkGrid(customGrid({ ...DEFAULT_CUSTOM, top: 13.5, rows: 5 }, PAPERS.Letter))!, /세로로 4\.1mm/);
  assert.match(checkGrid(customGrid({ ...DEFAULT_CUSTOM, cellW: 0 }, PAPERS.A4))!, /0보다 커야/);
  assert.match(checkGrid(customGrid({ ...DEFAULT_CUSTOM, cols: 0 }, PAPERS.A4))!, /1 이상/);
  assert.match(checkGrid(customGrid({ ...DEFAULT_CUSTOM, left: -1 }, PAPERS.A4))!, /0 이상/);
  assert.match(checkGrid(customGrid({ ...DEFAULT_CUSTOM, cellH: 5 }, PAPERS.A4))!, /너무 작습니다/);
});

test('장 나누기: 장 수와 몇 번째 칸부터', () => {
  const g = presetGrid(preset('90x55'), PAPERS.A4); // 10칸
  assert.deepEqual(paginate(0, g), []);
  assert.equal(paginate(10, g).length, 1);
  assert.equal(paginate(11, g).length, 2);
  assert.equal(paginate(22, g).length, 3);
  assert.deepEqual(paginate(22, g)[2], [20, 21, null, null, null, null, null, null, null, null]);
  // 4번째 칸부터: 앞의 세 칸은 비우고, 다음 장은 처음부터
  const p = paginate(9, g, 4);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], [null, null, null, 0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(p[1], [7, 8, null, null, null, null, null, null, null, null]);
  assert.deepEqual(p.flat().filter((x) => x != null), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  // 범위를 벗어난 값은 다듬는다
  assert.deepEqual(paginate(3, g, 99)[0].slice(-1), [0]);
  assert.deepEqual(paginate(3, g, 0)[0].slice(0, 3), [0, 1, 2]);
  assert.equal(paginate(3, tentGrid(PAPERS.A4)).length, 3);
});

test('이름 크기: 긴 이름은 줄고, 짧은 이름은 글자 사이를 벌린다', () => {
  // 높이가 넉넉하면 너비에 꽉 찬다
  const three = fitName('김하늘', 80, 60, measure);
  assert.deepEqual(three.lines, ['김하늘']);
  assert.equal(three.spacing, 0.2);
  assert.ok(Math.abs(three.size * (3 + 0.2 * 2) - 80) < 0.1, '너비에 꽉');
  // 높이가 낮으면 높이에 맞춘다
  const low = fitName('김하늘', 80, 20, measure);
  assert.equal(low.size, Math.floor((20 / NAME_LINE) * 100) / 100);
  // 글자가 많을수록 작아지고, 어느 것도 칸을 넘지 않는다
  const names = ['김솔', '김하늘', '남궁하늘', '선우은하수', '제갈공명선생님', '황금독수리온세상을놀라게하다'];
  const sizes = names.map((n) => fitName(n, 80, 24, measure));
  for (let i = 0; i < names.length; i++) {
    const f = sizes[i];
    const width = measure(f.lines[0], f.size) + f.spacing * f.size * ([...names[i]].length - 1);
    assert.ok(width <= 80 + 1e-6, `${names[i]} 너비 ${width}`);
    assert.ok(f.size * NAME_LINE * f.lines.length <= 24 + 1e-6, `${names[i]} 높이`);
    if (i) assert.ok(f.size <= sizes[i - 1].size, `${names[i]} 는 ${names[i - 1]} 보다 크지 않다`);
  }
  assert.ok(sizes[5].size < sizes[1].size / 3);
  // 두 글자 이름은 세 글자 이름보다 더 벌린다 — 차지하는 너비가 비슷해진다
  assert.deepEqual([nameSpacing('김솔'), nameSpacing('김하늘'), nameSpacing('남궁하늘'), nameSpacing('선우은하수'), nameSpacing('김 솔')], [0.5, 0.2, 0.06, 0, 0]);
  const two = sizes[0];
  assert.equal(two.size, sizes[1].size);
  assert.ok(two.size * 2.5 > sizes[1].size * 3 * 0.7);
  assert.deepEqual(fitName('  ', 80, 20, measure).lines, []);
});

test('이름 크기: 아주 긴 이름은 띄어쓰기에서 두 줄로', () => {
  const f = fitName('Alexander Maximilian von Humboldt', 80, 24, measure);
  assert.deepEqual(f.lines, ['Alexander Maximilian', 'von Humboldt']);
  assert.equal(f.spacing, 0);
  for (const line of f.lines) assert.ok(measure(line, f.size) <= 80 + 1e-6);
  assert.ok(f.size * NAME_LINE * 2 <= 24 + 1e-6);
  const oneLine = 80 / measure('Alexander Maximilian von Humboldt', 1);
  assert.ok(f.size > oneLine * 1.15, '한 줄일 때보다 크다');
  // 한 줄로도 넉넉하면 나누지 않는다
  assert.deepEqual(fitName('Kim Haneul', 80, 24, measure).lines, ['Kim Haneul']);
});

test('소속: 두 줄까지 접고, 그래도 넘치면 줄인다', () => {
  assert.deepEqual(fitInfo('개발팀', 40, measure, 4), { size: 4, lines: ['개발팀'] });
  // 가운뎃점에서 접으면 점은 뺀다
  assert.deepEqual(fitInfo('플랫폼개발본부 · 수석연구원', 40, measure, 4), { size: 4, lines: ['플랫폼개발본부', '수석연구원'] });
  // 두 줄로도 안 되면 줄인다
  const small = fitInfo('미래전략기획조정실 · 책임연구원 겸 팀장', 30, measure, 4, 2);
  assert.equal(small.lines.length, 2);
  assert.ok(small.size < 4 && small.size >= 2);
  for (const l of small.lines) assert.ok(measure(l, small.size) <= 30);
  // 띄어쓰기가 없으면 글자 사이에서 접는다
  const packed = fitInfo('가나다라마바사아자차카타', 24, measure, 4, 4);
  assert.deepEqual(packed.lines, ['가나다라마바', '사아자차카타']);
  // 가장 작게 해도 넘치면 … 로 줄인다
  const cut = fitInfo('가나다라마바사아자차카타파하가나다라마바사아자차카타파하', 20, measure, 4, 4);
  assert.equal(cut.size, 4);
  assert.deepEqual(cut.lines, ['가나다라마', '바사아자…']);
  assert.deepEqual(fitInfo('', 40, measure, 4).lines, []);
});

test('이름표 배치: 글자가 상자 안에 들어가고, 덧붙인 것만큼 자리를 내준다', () => {
  const base = { name: '김하늘', info: '개발팀 · 팀장', event: '2026 개발자 모임', band: 'top' as const, foot: false, qr: false, logoAspect: 0 };
  for (const [w, h] of [[90, 55], [99.1, 38.1], [63.5, 38.1], [297, 105]]) {
    for (const name of ['김솔', '김하늘', '제갈공명선생님', 'Alexander Maximilian von Humboldt']) {
      const l = badgeLayout(w, h, { ...base, name, foot: true, qr: true, logoAspect: 2 }, measure);
      const used = l.name.lines.length * l.name.size * NAME_LINE + l.gap + l.info.lines.length * l.info.size * 1.28;
      assert.ok(used <= l.text.h + 1e-6, `${w}×${h} ${name}: 높이 ${used} > ${l.text.h}`);
      for (const line of l.name.lines) assert.ok(measure(line, l.name.size) <= l.text.w, `${w}×${h} ${name}: 너비`);
      assert.ok(l.text.x + l.text.w + l.qr <= w && l.text.y + l.text.h + l.footH <= h);
      assert.ok(measure(base.event, l.eventSize) + l.logoW <= w - l.pad * 2);
    }
  }
  const plain = badgeLayout(90, 55, base, measure);
  const withQr = badgeLayout(90, 55, { ...base, qr: true }, measure);
  assert.equal(plain.qr, 0);
  assert.ok(withQr.qr >= 15 && withQr.text.w < plain.text.w);
  assert.ok(badgeLayout(90, 55, { ...base, foot: true }, measure).text.h < plain.text.h);
  const bare = badgeLayout(90, 55, { ...base, name: '김솔', event: '', band: 'none', info: '' }, measure);
  assert.deepEqual([bare.headH, bare.sideW, bare.footH, bare.info.lines.length], [0, 0, 0, 0]);
  assert.ok(bare.name.size > badgeLayout(90, 55, { ...base, name: '김솔' }, measure).name.size, '띠와 소속이 없으면 이름이 커진다');
  assert.ok(badgeLayout(90, 55, { ...base, band: 'side' }, measure).sideW > 0);
  // 사람마다 고친 크기
  assert.ok(Math.abs(badgeLayout(90, 55, { ...base, scale: 0.5 }, measure).name.size - plain.name.size / 2) < 0.01);
});

test('QR 내용 틀', () => {
  const p = { name: '김하늘', info: '개발팀', no: 7 };
  assert.equal(fillTemplate('https://example.com/checkin?n={번호}&name={이름}', p), 'https://example.com/checkin?n=7&name=김하늘');
  assert.equal(fillTemplate('{이름} ({ 소속 }) {없는것}', p), '김하늘 (개발팀) {없는것}');
  assert.equal(fillTemplate('https://example.com', p), 'https://example.com');
});

const roster = (n: number, depts = ['개발', '디자인', '영업', '인사']) =>
  parseParticipants(Array.from({ length: n }, (_, i) => `사람${String(i + 1).padStart(2, '0')}\t${depts[i % depts.length]}`).join('\n')).list;

test('자리 수: 고르게 또는 앞에서부터', () => {
  assert.equal(suggestTables(24, 8), 3);
  assert.equal(suggestTables(25, 8), 4);
  assert.equal(suggestTables(0, 8), 1);
  assert.deepEqual(tableSizes(22, 4, 8), [6, 6, 5, 5]);
  assert.deepEqual(tableSizes(22, 4, 8, true), [8, 8, 6, 0]);
  assert.deepEqual(tableSizes(40, 4, 8), [8, 8, 8, 8]);
  assert.deepEqual(tableSizes(50, 4, 8), [8, 8, 8, 8]);
  assert.deepEqual(tableSizes(2, 4, 8), [1, 1, 0, 0]);
  assert.deepEqual(tableSizes(0, 3, 8), [0, 0, 0]);
});

test('자리 배치: 모두 한 번씩, 인원은 고르게', () => {
  const people = roster(22);
  for (const method of ['order', 'random', 'mix', 'group'] as const) {
    const r = assignSeats(people, { tables: 4, seats: 8, method, rand: seeded(3) });
    assert.deepEqual(r.tables.flat().sort((a, b) => a - b), people.map((_, i) => i), method);
    assert.deepEqual(r.tables.map((t) => t.length).sort((a, b) => b - a), [6, 6, 5, 5], method);
    assert.deepEqual(r.left, []);
  }
  assert.deepEqual(assignSeats(people, { tables: 4, seats: 8, method: 'order' }).tables[0], [0, 1, 2, 3, 4, 5]);
  // 줄 맞춤: 순서대로면 앞줄부터 꽉, 섞으면 쓰는 줄만 고르게
  assert.deepEqual(assignSeats(people, { tables: 5, seats: 6, method: 'order', front: true }).tables.map((t) => t.length), [6, 6, 6, 4, 0]);
  assert.deepEqual(assignSeats(people, { tables: 5, seats: 6, method: 'random', front: true, rand: seeded(1) }).tables.map((t) => t.length), [6, 6, 5, 5, 0]);
  // 사람이 테이블보다 적어도 테이블 수는 그대로
  assert.equal(assignSeats(roster(2), { tables: 4, seats: 8, method: 'random', rand: seeded(1) }).tables.length, 4);
  assert.deepEqual(assignSeats([], { tables: 2, seats: 4, method: 'mix' }).tables, [[], []]);
});

test('자리 배치: 자리가 모자라면 남는 사람을 알려 준다', () => {
  const people = roster(10);
  const a = assignSeats(people, { tables: 2, seats: 4, method: 'order' });
  assert.deepEqual(a.tables, [[0, 1, 2, 3], [4, 5, 6, 7]]);
  assert.deepEqual(a.left, [8, 9]);
  const b = assignSeats(people, { tables: 2, seats: 4, method: 'random', rand: seeded(5) });
  assert.deepEqual(b.tables.map((t) => t.length), [4, 4]);
  assert.equal(b.left.length, 2);
  assert.deepEqual([...b.tables.flat(), ...b.left].sort((x, y) => x - y), people.map((_, i) => i));
});

test('자리 배치: 소속을 섞어서 / 같은 소속끼리', () => {
  const people = roster(24);
  const dept = (i: number) => people[i].info;
  for (let seed = 1; seed <= 5; seed++) {
    const mix = assignSeats(people, { tables: 6, seats: 4, method: 'mix', rand: seeded(seed) });
    for (const t of mix.tables) assert.equal(new Set(t.map(dept)).size, 4, '테이블마다 네 소속이 한 명씩');
  }
  const group = assignSeats(people, { tables: 6, seats: 4, method: 'group' });
  // 소속마다 6명 → 4명 테이블 6개: 한 테이블에 소속은 많아야 둘
  for (const t of group.tables) assert.ok(new Set(t.map(dept)).size <= 2);
  assert.deepEqual(group.tables[0].map(dept), ['개발', '개발', '개발', '개발']);
  // 큰 소속부터, 소속이 없는 사람은 맨 뒤
  const uneven = parseParticipants('가\n나\tB\n다\tA\n라\tB\n마\tB\n바\tA').list;
  assert.deepEqual(assignSeats(uneven, { tables: 1, seats: 6, method: 'group' }).tables[0].map((i) => uneven[i].name), ['나', '라', '마', '다', '바', '가']);
});

test('자리 배치: 떨어뜨릴 사람 · 같은 테이블에 넣을 사람', () => {
  const people = roster(24);
  const apart = parseGroups('사람01, 사람02, 사람03', people).groups;
  const together = parseGroups('사람05, 사람06, 사람07', people).groups;
  for (let seed = 1; seed <= 5; seed++) {
    for (const method of ['random', 'mix'] as const) {
      const r = assignSeats(people, { tables: 4, seats: 6, method, apart, together, rand: seeded(seed) });
      const of = (i: number) => r.tables.findIndex((t) => t.includes(i));
      assert.equal(new Set([0, 1, 2].map(of)).size, 3, '떨어뜨리기');
      assert.equal(new Set([4, 5, 6].map(of)).size, 1, '묶기');
      assert.deepEqual(r.unmet, []);
      assert.deepEqual(r.tables.map((t) => t.length), [6, 6, 6, 6]);
    }
  }
  // 테이블보다 많은 사람을 떨어뜨릴 수는 없다
  const r = assignSeats(people, { tables: 2, seats: 12, method: 'random', apart, rand: seeded(2) });
  assert.equal(r.unmet.length, 1);
});

test('좌석표: 그릴 모양, 맞바꾸기, 이름으로 찾는 표', () => {
  const people = parseParticipants('박민준\t영업\n김하늘\t개발\n이서연\t디자인\n강지우\n김하늘\t인사\nAlice\n최도윤').list;
  const r = assignSeats(people, { tables: 2, seats: 4, method: 'order' });
  const tables = toTables(r, people, 4, 'round', ['', '신랑측']);
  assert.deepEqual(tables.map((t) => t.name), ['1번 테이블', '신랑측']);
  assert.deepEqual(tables.map((t) => t.seats.length), [4, 4]);
  assert.deepEqual(tables[1].seats.map((s) => s?.name ?? null), ['김하늘', 'Alice', '최도윤', null]);
  assert.equal(seated(tables), 7);
  assert.equal(toTables(r, people, 4, 'rows')[1].name, '2줄');

  // 가나다순, 이름이 같으면 테이블 순서
  const rows = lookup(tables);
  assert.deepEqual(rows.map((x) => x.name).filter((n) => n !== 'Alice'), ['강지우', '김하늘', '김하늘', '박민준', '이서연', '최도윤']);
  assert.deepEqual(rows.filter((x) => x.name === '김하늘').map((x) => [x.table, x.seat, x.info]), [['1번 테이블', 2, '개발'], ['신랑측', 1, '인사']]);
  assert.deepEqual(rows.find((x) => x.name === '강지우'), { name: '강지우', info: '', table: '1번 테이블', seat: 4 });
  assert.match(lookupText(tables), /^강지우 → 1번 테이블 4번$/m);
  assert.match(lookupText(tables), /^김하늘 \(인사\) → 신랑측 1번$/m);

  // 맞바꾸기 (원래 것은 그대로), 빈 자리로 옮기기
  const swapped = swapSeats(tables, [0, 0], [1, 1]);
  assert.equal(swapped[0].seats[0]!.name, 'Alice');
  assert.equal(swapped[1].seats[1]!.name, '박민준');
  assert.equal(tables[0].seats[0]!.name, '박민준');
  const moved = swapSeats(tables, [0, 3], [1, 3]);
  assert.equal(moved[0].seats[3], null);
  assert.equal(moved[1].seats[3]!.name, '강지우');
  assert.equal(seated(moved), 7);
  assert.deepEqual(swapSeats(tables, [0, 0], [9, 9]), tables);

  const idx = seatIndex(swapped);
  assert.deepEqual(idx.get(people[0].key), { table: '신랑측', seat: 2 });
  assert.equal(seatingText(tables).split('\n')[0], '[1번 테이블] 4명');
  assert.match(seatingText(tables), /2\. 김하늘 \(개발\)/);
  const two = parseParticipants('박민준\t"영업, 1팀"\n김하늘').list;
  const csv = seatingCsv(toTables(assignSeats(two, { tables: 1, seats: 4, method: 'order' }), two, 4, 'round'));
  assert.equal(csv, '﻿이름,부가 정보,테이블,자리\r\n김하늘,,1번 테이블,2\r\n박민준,"영업, 1팀",1번 테이블,1');
});

test('예시 명단으로 끝까지', () => {
  const people = parseParticipants(sampleText(97)).list;
  const r = assignSeats(people, { tables: suggestTables(97, 8), seats: 8, method: 'mix', rand: seeded(9) });
  assert.equal(r.tables.length, 13);
  const sizes = r.tables.map((t) => t.length);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1 && Math.max(...sizes) <= 8);
  const tables = toTables(r, people, 8, 'round');
  assert.equal(lookup(tables).length, 97);
  assert.equal(seatIndex(tables).size, 97);
});
