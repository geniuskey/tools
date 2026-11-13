import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseParticipants, sampleText } from '../src/lib/raffle/core';
import { ladderResults, makeLadder, mix, parseGroups, shuffle, splitTeams, teamName, teamSizes, teamsCsv, teamsText, trace, type Rand } from '../src/lib/team/core';

/** 테스트마다 같은 결과가 나오는 난수 */
function seeded(seed: number): Rand {
  let s = seed >>> 0;
  return (n) => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    const t = Math.imul(s ^ (s >>> 13), 0x297a2d39) >>> 0;
    return Math.floor(((t ^ (t >>> 16)) >>> 0) / 0x1_0000_0000 * n);
  };
}

test('조 인원: 차이는 많아야 한 명', () => {
  assert.deepEqual(teamSizes(10, 3), [4, 3, 3]);
  assert.deepEqual(teamSizes(12, 4), [3, 3, 3, 3]);
  assert.deepEqual(teamSizes(2, 5), [1, 1]);
  assert.deepEqual(teamSizes(0, 3), [0]);
  assert.deepEqual([teamName(0, '1조'), teamName(2, 'A조'), teamName(25, 'A팀'), teamName(26, 'A팀'), teamName(9, '1팀')], ['1조', 'C조', 'Z팀', 'AA팀', '10팀']);
});

test('조 편성: 모두 한 번씩, 인원은 고르게', () => {
  const people = parseParticipants(sampleText(97)).list;
  for (const k of [1, 2, 7, 10, 97, 200]) {
    const { teams } = splitTeams(people, { teams: k, balance: false, rand: seeded(k) });
    const flat = teams.flat().sort((a, b) => a - b);
    assert.deepEqual(flat, people.map((_, i) => i), `조 ${k}개`);
    const sizes = teams.map((t) => t.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `조 ${k}개: ${sizes}`);
  }
  assert.deepEqual(splitTeams([], { teams: 3, balance: true }).teams, [[]]);
  // 암호학적 난수(기본값)로도 같다
  const real = splitTeams(people, { teams: 8, balance: true });
  assert.equal(real.teams.flat().length, people.length);
});

test('조 편성: 부가 정보가 고르게 섞인다', () => {
  // 부서 4곳 × 6명, 성별 반반 → 4개 조에 부서마다 1~2명, 성별 3명씩
  const lines: string[] = [];
  for (let i = 0; i < 24; i++) lines.push(`사람${i}\t${['개발', '디자인', '영업', '인사'][i % 4]}\t${i % 8 < 4 ? '남' : '여'}`);
  const people = parseParticipants(lines.join('\n')).list;
  for (let seed = 1; seed <= 5; seed++) {
    const { teams } = splitTeams(people, { teams: 4, balance: true, rand: seeded(seed) });
    for (const t of teams) {
      const m = new Map(mix(t.map((i) => people[i])));
      for (const dept of ['개발', '디자인', '영업', '인사']) assert.ok([1, 2].includes(m.get(dept) ?? 0), `seed ${seed} ${dept} ${m.get(dept)}`);
      assert.equal(m.get('남'), 3, `seed ${seed}`);
    }
  }
  // 고르게 섞지 않으면 그렇게 되지 않는 경우가 있다 (조건이 실제로 일을 한다)
  let uneven = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const { teams } = splitTeams(people, { teams: 4, balance: false, rand: seeded(seed) });
    if (teams.some((t) => new Map(mix(t.map((i) => people[i]))).get('남') !== 3)) uneven++;
  }
  assert.ok(uneven > 5, `고르지 않은 결과 ${uneven}/10`);
});

test('조 편성: 떨어뜨리기와 묶기', () => {
  const people = parseParticipants(Array.from({ length: 20 }, (_, i) => `p${i}`).join('\n')).list;
  const parsed = parseGroups('p0, p1, p2, p3\np4;p5\n없는사람, p6\n\np7', people);
  assert.deepEqual(parsed.groups, [[0, 1, 2, 3], [4, 5]]);
  assert.deepEqual(parsed.unknown, ['없는사람']);
  for (let seed = 1; seed <= 8; seed++) {
    const r = splitTeams(people, { teams: 4, balance: false, apart: [[0, 1, 2, 3], [4, 5]], together: [[6, 7, 8], [9, 10]], rand: seeded(seed) });
    const of = (i: number) => r.teams.findIndex((t) => t.includes(i));
    assert.equal(new Set([0, 1, 2, 3].map(of)).size, 4, `seed ${seed}`);
    assert.notEqual(of(4), of(5));
    assert.equal(new Set([6, 7, 8].map(of)).size, 1);
    assert.equal(of(9), of(10));
    assert.deepEqual(r.unmet, []);
    assert.deepEqual(r.teams.map((t) => t.length), [5, 5, 5, 5]);
  }
  // 조보다 많은 사람을 서로 떨어뜨릴 수는 없다: 어긴 쌍을 알려 준다
  const r = splitTeams(people, { teams: 2, balance: false, apart: [[0, 1, 2]], rand: seeded(3) });
  assert.equal(r.unmet.length, 1);
  // 같은 이름이 여럿이면 모두
  const twins = parseParticipants('김하늘\tA\n김하늘\tB\n이서연').list;
  assert.deepEqual(parseGroups('김하늘, 이서연', twins).groups, [[0, 1, 2]]);
});

test('조 편성: 내보내기', () => {
  const teams = [
    { name: '1조', members: [{ name: '김하늘', info: '개발팀', leader: true }, { name: '이서연', info: '' }] },
    { name: '2조', members: [{ name: '박, 민준', info: '영업팀' }] },
  ];
  assert.equal(teamsText(teams), '[1조] 2명\n김하늘 (개발팀) ★\n이서연\n\n[2조] 1명\n박, 민준 (영업팀)');
  assert.equal(teamsCsv(teams), '﻿조,이름,부가 정보,조장\r\n1조,김하늘,개발팀,조장\r\n1조,이서연,,\r\n2조,"박, 민준",영업팀,');
});

test('사다리: 그린 사다리를 타면 미리 뽑은 결과가 나온다', () => {
  for (let cols = 1; cols <= 30; cols++) {
    for (let seed = 0; seed < 6; seed++) {
      const l = makeLadder(cols, seeded(cols * 100 + seed));
      assert.deepEqual([...l.perm].sort((a, b) => a - b), Array.from({ length: cols }, (_, i) => i));
      for (let c = 0; c < cols; c++) {
        const t = trace(l, c);
        assert.equal(t.end, l.perm[c], `${cols}명 seed ${seed} 자리 ${c}`);
        assert.deepEqual(t.points[0], [c, -1]);
        assert.deepEqual(t.points.at(-1), [t.end, l.rungs.length]);
        // 길은 위에서 아래로만, 한 번에 옆 칸으로만
        for (let i = 1; i < t.points.length; i++) {
          assert.ok(t.points[i][1] >= t.points[i - 1][1]);
          assert.ok(Math.abs(t.points[i][0] - t.points[i - 1][0]) <= 1);
        }
      }
      // 한 줄에서 가로대가 맞닿지 않는다
      for (const row of l.rungs) for (let c = 0; c + 1 < row.length; c++) assert.ok(!(row[c] && row[c + 1]));
      if (cols > 1) assert.ok(l.rungs.length >= 5);
    }
  }
  // 정해 준 결과대로도 그린다 (뒤집기: 가로대가 가장 많이 필요한 경우)
  const rev = makeLadder(9, seeded(1), [8, 7, 6, 5, 4, 3, 2, 1, 0]);
  for (let c = 0; c < 9; c++) assert.equal(trace(rev, c).end, 8 - c);
});

test('사다리: 결과는 치우치지 않는다', () => {
  // 3명이면 6가지 결과가 고르게 나온다 (암호학적 난수)
  const seen = new Map<string, number>();
  for (let i = 0; i < 6000; i++) {
    const key = makeLadder(3).perm.join('');
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  assert.equal(seen.size, 6);
  for (const [k, c] of seen) assert.ok(Math.abs(c - 1000) < 150, `${k}: ${c}`);
  assert.deepEqual(shuffle([1, 2, 3, 4], seeded(2)).sort(), [1, 2, 3, 4]);
  assert.deepEqual(ladderResults('당첨\n\n 2등 ', 4), ['당첨', '2등', '꽝', '꽝']);
  assert.deepEqual(ladderResults('a\nb\nc', 2), ['a', 'b']);
});
