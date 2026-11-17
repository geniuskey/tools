import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contract, english, englishCheque, formal, grouped, hanja, korean, mixed, parseMoney, vatFromSupply, vatFromTotal } from '../src/lib/pay/money';

const read = (s: string) => parseMoney(s)?.value;

test('금액 읽기: 숫자 · 한글 단위 · 한글 숫자 · 한자 · 갖은자', () => {
  assert.equal(read('123,456,789'), 123456789n);
  assert.equal(read('1억 2,345만 6,789원'), 123456789n);
  assert.equal(read('4500만'), 45000000n);
  assert.equal(read('4.5천만'), 45000000n);
  assert.equal(read('1.2억'), 120000000n);
  assert.equal(read('천만'), 10000000n);
  assert.equal(read('만원'), 10000n);
  assert.equal(read('일금 일백만원정'), 1000000n);
  assert.equal(read('삼천오백'), 3500n);
  assert.equal(read('一億二千三百四十五萬六千七百八十九'), 123456789n);
  assert.equal(read('金 壹億貳仟參佰肆拾伍萬陸仟柒佰捌拾玖 圓整'), 123456789n);
  assert.equal(read('₩12,000'), 12000n);
  assert.equal(read('3조 5억'), 3000500000000n);
  assert.equal(read('99999999999999999999'), 99999999999999999999n);
  assert.deepEqual(parseMoney('12.5'), { value: 12n, truncated: true });
  assert.equal(read('1만억'), undefined);
  assert.equal(read('사과'), undefined);
  assert.equal(read(''), undefined);
});

test('한글로 쓰기: 만은 "만", 억 · 조는 "일억", 계약서는 일백 · 일천', () => {
  assert.equal(korean(123456789n), '일억이천삼백사십오만육천칠백팔십구');
  assert.equal(korean(123456789n, { spaced: true }), '일억 이천삼백사십오만 육천칠백팔십구');
  assert.equal(korean(10000n), '만');
  assert.equal(korean(110000n), '십일만');
  assert.equal(korean(100000000n), '일억');
  assert.equal(korean(1000010000n), '십억일만');
  assert.equal(korean(0n), '영');
  assert.equal(contract(1000000n), '일금 일백만원정');
  assert.equal(contract(15000n), '일금 일만오천원정');
  assert.equal(contract(15000n, false), '일금 만오천원정');
  // 다시 읽으면 같은 값
  for (const v of [1n, 10n, 10001n, 1000010000n, 987654321012n]) {
    assert.equal(read(korean(v)), v);
    assert.equal(read(contract(v)), v);
    assert.equal(read(hanja(v)), v);
    assert.equal(read(formal(v)), v);
    assert.equal(read(mixed(v)), v);
  }
});

test('한자 · 갖은자 · 숫자 단위 · 영어', () => {
  assert.equal(hanja(123456789n), '一億二千三百四十五萬六千七百八十九');
  assert.equal(formal(123456789n), '壹億貳仟參佰肆拾伍萬陸仟柒佰捌拾玖');
  assert.equal(mixed(123456789n), '1억 2,345만 6,789');
  assert.equal(mixed(100000000n), '1억');
  assert.equal(grouped(1234567n), '1,234,567');
  assert.equal(english(1001n), 'one thousand one');
  assert.equal(english(123456789n), 'one hundred twenty-three million four hundred fifty-six thousand seven hundred eighty-nine');
  assert.equal(englishCheque(1500n), 'KRW One Thousand Five Hundred Only');
});

test('부가세: 공급가액에서 · 합계에서', () => {
  assert.deepEqual(vatFromSupply(12345n), { supply: 12345n, vat: 1234n, total: 13579n });
  assert.deepEqual(vatFromTotal(110000n), { supply: 100000n, vat: 10000n, total: 110000n });
  assert.deepEqual(vatFromTotal(100000n), { supply: 90909n, vat: 9091n, total: 100000n });
});
