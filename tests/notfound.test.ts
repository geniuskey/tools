import { test } from 'node:test';
import assert from 'node:assert/strict';
import { charDiff, distance, guess, words } from '../src/lib/notfound';

const to = (path: string) => {
  const g = guess(path);
  return g ? `${g.via}:${g.tool.id}` : null;
};

test('주소를 낱말로', () => {
  assert.deepEqual(words('/QR.html'), ['qr']);
  assert.deepEqual(words('/tools/Calculator/'), ['tools', 'calculator']);
  assert.deepEqual(words('/%EC%A0%95%EA%B7%9C%EC%8B%9D'), ['정규식']);
  assert.deepEqual(words('/%E0%A4%A'), ['%e0%a4%a']);
  assert.deepEqual(words('/'), []);
});

test('거리', () => {
  assert.equal(distance('calulator', 'calculator'), 1);
  assert.equal(distance('claculator', 'calculator'), 1);
  assert.equal(distance('timer', 'timer'), 0);
  assert.equal(distance('', 'abc'), 3);
});

test('도구 주소가 들어 있으면 그 도구', () => {
  assert.equal(to('/qr/abc'), 'exact:qr');
  assert.equal(to('/tools/raffle'), 'exact:raffle');
  assert.equal(to('/timer.html'), 'exact:timer');
  assert.equal(to('/CRON'), 'exact:cron');
});

test('검색어로 찾는다', () => {
  assert.equal(to('/json'), 'keyword:data');
  assert.equal(to('/regex'), 'keyword:text');
  assert.equal(to('/base64'), 'keyword:encode');
  assert.equal(to('/%EC%B6%94%EC%B2%A8'), 'keyword:raffle');
  assert.equal(to('/계산기'), 'keyword:calculator');
  assert.equal(to('/사다리'), 'keyword:team');
});

test('오타', () => {
  assert.equal(to('/calulator'), 'typo:calculator');
  assert.equal(to('/claculator'), 'typo:calculator');
  assert.equal(to('/recoder'), 'typo:recorder');
  assert.equal(to('/rafle'), 'typo:raffle');
  assert.equal(to('/imgae'), 'typo:image');
  assert.equal(to('/regx'), 'typo:text');
  const g = guess('/calulator')!;
  assert.equal(g.typed, 'calulator');
  assert.equal(g.word, 'calculator');
});

test('짐작할 수 없으면 null', () => {
  assert.equal(to('/'), null);
  assert.equal(to('/wp-admin'), null);
  assert.equal(to('/abc'), null);
  assert.equal(to('/xy'), null);
  assert.equal(to('/favicon.ico'), null);
});

test('글자 단위 비교', () => {
  const { segA, segB } = charDiff('calulator', 'calculator');
  assert.deepEqual(segA, [{ text: 'calulator', changed: false }]);
  assert.deepEqual(segB, [
    { text: 'cal', changed: false },
    { text: 'c', changed: true },
    { text: 'ulator', changed: false },
  ]);
  const swap = charDiff('imgae', 'image');
  assert.equal(swap.segA.map((s) => s.text).join(''), 'imgae');
  assert.equal(swap.segB.map((s) => s.text).join(''), 'image');
  assert.ok(swap.segA.some((s) => s.changed) && swap.segB.some((s) => s.changed));
});
