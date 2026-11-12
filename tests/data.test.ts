import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ancestors,
  csvToTable,
  detectDelimiter,
  jsonErrorOffset,
  expandAll,
  flatten,
  jsonToTable,
  numericColumns,
  parseAny,
  parseCsv,
  pathText,
  preview,
  search,
  tableToJson,
  toCsv,
  valueAt,
  viewOrder,
  type Json,
} from '../src/lib/data/core';

test('CSV 읽기: 따옴표 · 줄바꿈 · 빈 칸', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3\n'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('a,"b,1","c ""x"""\r\n"여러\n줄",,\r\n'), [['a', 'b,1', 'c "x"'], ['여러\n줄', '', '']]);
  assert.deepEqual(parseCsv('﻿a\tb\n\n1\t2', '\t'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n1,'), [['a', 'b'], ['1', '']]);
  assert.deepEqual(parseCsv('"끝나지 않은'), [['끝나지 않은']]);
  assert.deepEqual(parseCsv(''), []);
});

test('구분자 찾기', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('이름\t부서\n김하늘\t개발, 운영'), '\t');
  assert.equal(detectDelimiter('a;b;c\n"x;y";2;3\n4;5;6'), ';');
  assert.equal(detectDelimiter('한 줄짜리 글'), ',');
});

test('형식 판단: JSON · JSON Lines · CSV · 오류 위치', () => {
  assert.deepEqual(parseAny(' {"a":1}'), { kind: 'json', value: { a: 1 }, lines: false });
  assert.deepEqual(parseAny('{"a":1}\n{"a":2}\n'), { kind: 'json', value: [{ a: 1 }, { a: 2 }], lines: true });
  const csv = parseAny('x,y\n1,2');
  assert.ok(csv.kind === 'csv' && csv.rows.length === 2);
  const err = parseAny('{\n  "a": 1,\n  "b": oops\n}');
  assert.ok(err.kind === 'error');
  assert.deepEqual([err.line, err.column], [3, 8]);
  for (const ok of ['{}', '[]', ' [1, -2.5e3, "a\\n\\u00e9", true, null, {"k": {}}] ', '"x"', '0']) assert.equal(jsonErrorOffset(ok), -1, ok);
  for (const [bad, at] of [['[1,]', 3], ['{"a":1,}', 7], ['{a:1}', 1], ['[1 2]', 3], ['[01]', 2], ['"a\nb"', 0], ['[1', 2], ['{} x', 3], ['', 0]] as const) {
    assert.equal(jsonErrorOffset(bad), at, bad);
    assert.throws(() => JSON.parse(bad));
  }
  assert.equal(parseAny('   ').kind, 'error');
});

test('표 변환과 왕복', () => {
  const t = csvToTable(parseCsv('이름,나이,메모\n김하늘,31,"a,b"\n이서연,,007\n'), true);
  assert.deepEqual(t.columns, ['이름', '나이', '메모']);
  assert.deepEqual(tableToJson(t), [
    { 이름: '김하늘', 나이: 31, 메모: 'a,b' },
    { 이름: '이서연', 나이: null, 메모: '007' },
  ]);
  assert.equal(toCsv(t), '이름,나이,메모\n김하늘,31,"a,b"\n이서연,,007\n');
  assert.deepEqual(parseCsv(toCsv(t)).slice(1), t.rows);
  assert.deepEqual(csvToTable([['1', '2'], ['3']], false), { columns: ['열 1', '열 2'], rows: [['1', '2'], ['3', '']] });

  const j = jsonToTable([{ id: 1, user: { name: '김', tags: ['a'] } }, { id: 2, extra: true, user: { name: '이' } }])!;
  assert.deepEqual(j.columns, ['id', 'user.name', 'user.tags', 'extra']);
  assert.deepEqual(j.rows, [['1', '김', '["a"]', ''], ['2', '이', '', 'true']]);
  assert.deepEqual(jsonToTable([1, 'a', null])!.rows, [['1'], ['a'], ['']]);
  assert.equal(jsonToTable({ a: 1 }), null);
  assert.equal(jsonToTable([]), null);
  assert.equal(jsonToTable([[1, 2]]), null);
});

test('정렬과 거르기', () => {
  const t = { columns: ['이름', '점수'], rows: [['다', '10'], ['가', '9'], ['나', ''], ['라', '1,200']] };
  assert.deepEqual(numericColumns(t), [false, true]);
  assert.deepEqual([...viewOrder(t, '', null)], [0, 1, 2, 3]);
  assert.deepEqual([...viewOrder(t, '', { col: 1, dir: 1 })], [1, 0, 3, 2]); // 숫자로 비교, 빈 칸은 뒤
  assert.deepEqual([...viewOrder(t, '', { col: 1, dir: -1 })], [3, 0, 1, 2]);
  assert.deepEqual([...viewOrder(t, '', { col: 0, dir: 1 })], [1, 2, 0, 3]);
  assert.deepEqual([...viewOrder(t, '1', { col: 0, dir: -1 })], [3, 0]);
  assert.equal(toCsv(t, ',', viewOrder(t, '가', null)), '이름,점수\n가,9\n');
});

const doc: Json = { name: 'tools', list: [{ id: 1, 'a/b': 'x~y' }, { id: 2, tags: ['red', 'Blue'] }], empty: {}, 'has space': null };

test('트리: 펼치기 · 경로 · 값', () => {
  assert.deepEqual(flatten(doc, new Set()).map((r) => r.id), ['']);
  const rows = flatten(doc, new Set(['', '/list', '/list/0']));
  assert.deepEqual(rows.map((r) => r.id), ['', '/name', '/list', '/list/0', '/list/0/id', '/list/0/a~1b', '/list/1', '/empty', '/has space']);
  assert.deepEqual(rows.map((r) => r.depth), [0, 1, 1, 2, 3, 3, 2, 1, 1]);
  assert.equal(rows[6].open, false);
  assert.equal(rows[7].size, 0);
  assert.equal(pathText(doc, '/list/0/a~1b'), '$.list[0]["a/b"]');
  assert.equal(pathText(doc, '/has space'), '$["has space"]');
  assert.equal(pathText(doc, ''), '$');
  assert.equal(valueAt(doc, '/list/0/a~1b'), 'x~y');
  assert.deepEqual(valueAt(doc, '/list/1/tags'), ['red', 'Blue']);
  assert.deepEqual(ancestors('/list/1/tags/0'), ['', '/list', '/list/1', '/list/1/tags']);
  assert.deepEqual(ancestors(''), []);

  const all = expandAll(doc);
  assert.equal(all.complete, true);
  assert.equal(flatten(doc, all.expanded).length, 13);
  const part = expandAll(doc, 6);
  assert.equal(part.complete, false);
  assert.deepEqual([...part.expanded], ['']);
});

test('트리: 검색과 미리보기', () => {
  assert.deepEqual(search(doc, 'blue').ids, ['/list/1/tags/1']);
  assert.deepEqual(search(doc, 'id').ids, ['/list/0/id', '/list/1/id']);
  assert.deepEqual(search(doc, '2').ids, ['/list/1/id']);
  assert.deepEqual(search(doc, ' ').ids, []);
  assert.deepEqual(search(doc, 'null').ids, ['/has space']);
  const big: Json = Array.from({ length: 100 }, (_, i) => ({ v: `item ${i}` }));
  const r = search(big, 'item', 10);
  assert.equal(r.ids.length, 10);
  assert.equal(r.more, true);
  assert.equal(preview({ a: 1, b: ['x', null] }), '{a: 1, b: ["x", null]}');
  assert.ok(preview(big, 40).endsWith('…'));
  assert.ok(preview(big, 40).length <= 41);
});

test('큰 입력도 빠르게', () => {
  const lines = ['id,name,score'];
  for (let i = 0; i < 200_000; i++) lines.push(`${i},"사람 ${i}",${(i * 37) % 1000}`);
  const t0 = Date.now();
  const p = parseAny(lines.join('\n'));
  assert.ok(p.kind === 'csv' && p.rows.length === 200_001);
  const table = csvToTable(p.rows, true);
  const order = viewOrder(table, '', { col: 2, dir: -1 });
  assert.equal(table.rows[order[0]][2], '999');
  const json = tableToJson(table);
  assert.equal(flatten(json, expandAll(json, 1_000_000).expanded).length, 800_001);
  assert.ok(Date.now() - t0 < 6000, `${Date.now() - t0}ms`);
});
