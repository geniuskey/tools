import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeText, eligible, maskName, parseParticipants, pick, randomInt, rangeText, remaining, resultsCsv, sampleText, type Prize } from '../src/lib/raffle/core';
import { drumPose, reelCurve, reelNames, reelSteps } from '../src/lib/raffle/reel';

test('명단 파싱', () => {
  const r = parseParticipants('이름\t부서\n김하늘\t개발팀\n\n이서연, 디자인팀 , 3년차\n박민준\n김하늘\t개발팀\n');
  assert.equal(r.list.length, 4);
  assert.equal(r.duplicates, 1);
  assert.deepEqual(r.list.map((p) => p.name), ['김하늘', '이서연', '박민준', '김하늘']);
  assert.equal(r.list[1].info, '디자인팀 · 3년차');
  assert.equal(r.list[2].no, 3);
  // 동명이인은 부가 정보가 다르면 다른 사람
  assert.equal(parseParticipants('김하늘,A\n김하늘,B').duplicates, 0);
});

test('한 줄 명단: 쉼표 · 세미콜론', () => {
  const names = (t: string) => parseParticipants(t).list.map((p) => p.name);
  assert.deepEqual(names('김하늘, 이서연 ,박민준,'), ['김하늘', '이서연', '박민준']);
  assert.deepEqual(names('김하늘;이서연; 박민준'), ['김하늘', '이서연', '박민준']);
  // 세미콜론으로 나눈 사람 안의 쉼표는 부가 정보
  const r = parseParticipants('김하늘, 개발팀; 이서연, 디자인팀');
  assert.deepEqual(r.list.map((p) => [p.name, p.info]), [['김하늘', '개발팀'], ['이서연', '디자인팀']]);
  // 여러 줄이면 쉼표는 지금처럼 칸 구분, 세미콜론은 어느 줄에서나 사람 구분
  assert.deepEqual(names('김하늘, 개발팀\n이서연, 디자인팀'), ['김하늘', '이서연']);
  assert.deepEqual(names('김하늘; 이서연\n박민준\t개발팀'), ['김하늘', '이서연', '박민준']);
  // 머리글 · 중복
  assert.deepEqual(names('이름, 김하늘, 이서연'), ['김하늘', '이서연']);
  assert.equal(parseParticipants('a, b, a').duplicates, 1);
  assert.equal(dedupeText('a, b, a, c'), 'a, b, c');
  assert.equal(dedupeText('a; b\nb; c\na'), 'a; b\nc');
});

test('중복 제거와 번호 범위', () => {
  assert.equal(dedupeText('a\nb\na\n\nB\nc'), 'a\nb\nc');
  assert.equal(dedupeText('이름\n김\n김'), '이름\n김');
  assert.equal(rangeText(1, 3), '1\n2\n3');
  assert.equal(rangeText(3, 1, 'A-', '번'), 'A-1번\nA-2번\nA-3번');
  const s = parseParticipants(sampleText(300));
  assert.equal(s.duplicates, 0);
  assert.ok(s.list.length > 250);
});

test('난수: 범위와 균등성', () => {
  const counts = new Array(7).fill(0);
  for (let i = 0; i < 70000; i++) counts[randomInt(7)]++;
  for (const c of counts) assert.ok(Math.abs(c - 10000) < 600, `치우침: ${counts}`);
  // 범위를 벗어난 값은 버린다
  const seq = [0xffffffff, 5];
  assert.equal(randomInt(3, (b) => (b[0] = seq.shift()!)), 2);
});

test('뽑기: 중복 없음', () => {
  const pool = Array.from({ length: 500 }, (_, i) => i);
  const w = pick(pool, 120);
  assert.equal(new Set(w).size, 120);
  assert.equal(pick(pool, 9999).length, 500);
  assert.equal(pool[0], 0);
});

test('대상자 계산', () => {
  const all = parseParticipants('a\nb\nc\nd').list;
  const w = (key: string, v = false) => ({ key, no: 1, name: key, info: '', at: 0, void: v });
  const p1: Prize = { id: '1', name: '1등', count: 2, winners: [w(all[0].key), w(all[1].key, true)] };
  const p2: Prize = { id: '2', name: '2등', count: 2, winners: [] };
  assert.equal(remaining(p1), 1);
  assert.deepEqual(eligible(all, [p1, p2], p2, false).map((x) => x.name), ['c', 'd']);
  assert.deepEqual(eligible(all, [p1, p2], p2, true).map((x) => x.name), ['a', 'b', 'c', 'd']);
  assert.deepEqual(eligible(all, [p1, p2], p1, true).map((x) => x.name), ['c', 'd']);
  assert.ok(resultsCsv([p1]).includes('취소'));
});

test('이름 가리기', () => {
  assert.equal(maskName('김하늘'), '김＊늘');
  assert.equal(maskName('남궁민수'), '남＊＊수');
  assert.equal(maskName('이솔'), '이＊');
});

test('릴: 속도 곡선', () => {
  const curve = reelCurve();
  assert.equal(curve(0), 0);
  assert.equal(curve(-1), 0);
  assert.equal(curve(1), 1);
  assert.equal(curve(2), 1);
  let prev = 0;
  for (let i = 1; i <= 200; i++) {
    const v = curve(i / 200);
    assert.ok(v > prev, `뒤로 가지 않는다 (${i})`);
    prev = v;
  }
  // 처음에는 가속하고, 중간이 가장 빠르고, 끝에서도 완전히 서지는 않는다
  const speed = (u: number) => (curve(u + 0.005) - curve(u - 0.005)) / 0.01;
  assert.ok(speed(0.01) < speed(0.1));
  assert.ok(speed(0.1) > speed(0.5) && speed(0.5) > speed(0.9));
  assert.ok(speed(0.99) > 0.1 && speed(0.99) < speed(0.1) / 5);
  // 끝 속도를 줄이면 더 천천히 멈춘다
  const slow = reelCurve(0.03);
  assert.ok((1 - slow(0.99)) < 1 - curve(0.99));
});

test('릴: 지나가는 이름', () => {
  assert.equal(reelSteps(0), 8);
  assert.equal(reelSteps(2800), 29);
  assert.ok(reelSteps(5200) > reelSteps(2800));

  const pool = ['가', '나', '다', '라', '마'];
  let n = 0;
  const names = reelNames(30, '다', () => pool[n++ % pool.length], '시작');
  assert.equal(names.length, 33);
  assert.equal(names[0], '시작');
  assert.equal(names[30], '다');
  for (let i = 1; i < names.length; i++) assert.notEqual(names[i], names[i - 1], `${i}번째가 앞과 같다`);
  // 멈추기 직전과 직후에는 당첨자 이름이 미리 보이지 않는다
  assert.ok(!names.slice(25, 30).includes('다') && !names.slice(31).includes('다'));
  // 고를 이름이 하나뿐이어도 끝난다
  assert.deepEqual(reelNames(8, '가', () => '가'), new Array(11).fill('가'));
});

test('릴: 원통 위의 글자', () => {
  const front = drumPose(0, 1.5, 0.8);
  assert.deepEqual([Math.abs(front.y), front.sx, front.sy, front.alpha], [0, 1, 1, 1]);
  // 아직 오지 않은 이름은 위에, 지나간 이름은 아래에 있고 둘 다 눌려 보인다
  const next = drumPose(1, 1.5, 0.8);
  const past = drumPose(-1, 1.5, 0.8);
  assert.ok(next.y < -0.9 && past.y > 0.9);
  assert.ok(Math.abs(next.y + past.y) < 1e-9);
  assert.ok(next.sy < 0.75 && next.sx < 1 && next.sx > 0.9);
  assert.ok(next.alpha > 0.2 && next.alpha < 0.45);
  // 원통 뒤로 넘어가면 보이지 않는다
  assert.equal(drumPose(2, 1.5, 0.8).alpha, 0);
});
