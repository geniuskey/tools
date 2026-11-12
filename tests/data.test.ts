import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ancestors,
  childId,
  csvToTable,
  detectDelimiter,
  jsonErrorOffset,
  expandAll,
  findTables,
  looksTabular,
  tableAt,
  flatten,
  jsonToTable,
  numericColumns,
  parseAny,
  parseCsv,
  relaxJson,
  toJson,
  toToml,
  toYaml,
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
  assert.deepEqual(parseAny(' {"a":1}'), { kind: 'json', value: { a: 1 }, format: 'json' });
  assert.deepEqual(parseAny('{"a":1}\n{"a":2}\n'), { kind: 'json', value: [{ a: 1 }, { a: 2 }], format: 'jsonl' });
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

test('문서 안의 표 찾기 · 영역별 표', () => {
  const doc: Json = {
    shop: 'x',
    tags: ['a', 'b'],
    orders: [
      { id: 1, who: { name: '김' }, items: [{ n: '키보드', qty: 1 }, { n: '의자', qty: 2 }] },
      { id: 2, who: { name: '이' }, items: [{ n: '책상', qty: 1, 'a*b': true }] },
      { id: 3, who: { name: '박' }, items: [] },
    ],
    matrix: [[1, 2], [3, 4]],
  };
  assert.deepEqual(findTables(doc), [
    { id: '/orders', rows: 3, nodes: 1 },
    { id: '/orders/*/items', rows: 3, nodes: 2 },
  ]);
  assert.deepEqual(findTables([{ a: [{ b: 1 }] }, { a: [{ b: 2 }] }]).map((s) => s.id), ['', '/*/a']);
  assert.deepEqual(findTables('글자'), []);
  assert.ok(looksTabular([{ a: 1 }, null]));
  assert.ok(!looksTabular([1, 2, { a: 1 }]));
  assert.ok(!looksTabular([]));

  const one = tableAt(doc, '/orders')!;
  assert.deepEqual(one.columns, ['id', 'who.name', 'items']);
  assert.deepEqual(one.ids, ['/orders/0', '/orders/1', '/orders/2']);
  assert.deepEqual(one.keys, [['id'], ['who', 'name'], ['items']]);

  // 흩어진 배열을 한 표로: 어디서 왔는지가 앞 열에 붙는다
  const all = tableAt(doc, '/orders/*/items')!;
  assert.deepEqual(all.columns, ['orders[*]', 'n', 'qty', 'a*b']);
  assert.deepEqual(all.rows, [['0', '키보드', '1', ''], ['0', '의자', '2', ''], ['1', '책상', '1', 'true']]);
  assert.deepEqual(all.ids, ['/orders/0/items/0', '/orders/0/items/1', '/orders/1/items/0']);
  assert.deepEqual(all.keys, [null, ['n'], ['qty'], ['a*b']]);
  assert.equal(valueAt(doc, all.keys[3]!.reduce((id, k) => childId(id, k), all.ids[2])), true);
  assert.equal(pathText(doc, '/orders/*/items'), '$.orders[*].items');
  assert.equal(pathText([[{ a: 1 }]], '/*/*'), '$[*][*]');

  assert.deepEqual(tableAt(doc, '/orders/1/items')!.rows, [['책상', '1', 'true']]);
  assert.deepEqual(tableAt(doc, '/tags')!.rows, [['a'], ['b']]);
  assert.equal(tableAt(doc, '/matrix'), null);
  assert.equal(tableAt(doc, '/nope'), null);
  assert.equal(tableAt(doc, '/orders/2/items'), null);
  // 키에 든 * 는 모든 항목 자리와 섞이지 않는다
  assert.equal(childId('', '*'), '/~2');
  assert.deepEqual(tableAt({ '*': [{ a: 1 }] }, '/~2')!.rows, [['1']]);
});

const read = (text: string, hint?: 'json' | 'csv' | 'yaml' | 'toml') => {
  const p = parseAny(text, hint);
  return p.kind === 'json' ? [p.format, p.value] : p.kind === 'csv' ? ['csv', p.rows] : ['error', p.line, p.column];
};

test('형식 판단: YAML · TOML · 주석 있는 JSON', () => {
  // YAML
  assert.deepEqual(read('name: 도구\ntags:\n  - a\n  - b\nnested:\n  on: yes\n  n: 3\n'), ['yaml', { name: '도구', tags: ['a', 'b'], nested: { on: 'yes', n: 3 } }]);
  assert.deepEqual(read('# 설명\n---\n- id: 1\n  when: 2026-11-13\n- id: 2\n'), ['yaml', [{ id: 1, when: '2026-11-13' }, { id: 2 }]]);
  assert.deepEqual(read('a: 1\n---\na: 2\n'), ['yaml', [{ a: 1 }, { a: 2 }]]);
  assert.deepEqual(read('base: &b {x: 1}\nuse:\n  <<: *b\n  y: 2\n'), ['yaml', { base: { x: 1 }, use: { x: 1, y: 2 } }]);
  assert.deepEqual(read('"quoted key": [1, 2]\n'), ['yaml', { 'quoted key': [1, 2] }]);
  // TOML
  assert.deepEqual(read('title = "도구"\nport = 8080\n\n[owner]\nname = "김"\nsince = 2026-11-13\n\n[[servers]]\nip = "10.0.0.1"\n\n[[servers]]\nip = "10.0.0.2"\n'), [
    'toml',
    { title: '도구', port: 8080, owner: { name: '김', since: '2026-11-13' }, servers: [{ ip: '10.0.0.1' }, { ip: '10.0.0.2' }] },
  ]);
  assert.deepEqual(read('# 설정\n[server]\nhost = "a"\n'), ['toml', { server: { host: 'a' } }]);
  assert.deepEqual(read('[[rows]]\na = 1\n'), ['toml', { rows: [{ a: 1 }] }]);
  assert.deepEqual(read('a.b = 1\nbig = 9007199254740993\n'), ['toml', { a: { b: 1 }, big: 9007199254740992 }]);
  // 주석 · 끝 쉼표가 있는 JSON
  assert.deepEqual(read('{\n  // 주석\n  "a": "x // y", /* 또 */\n  "b": [1, 2,],\n}\n'), ['json', { a: 'x // y', b: [1, 2] }]);
  assert.equal(relaxJson('{"a": ",}" , }').length, 14);
  assert.deepEqual(JSON.parse(relaxJson('{"a": ",}" , }')), { a: ',}' });
  // JSON 은 그대로
  assert.deepEqual(read('[1, 2]'), ['json', [1, 2]]);
  assert.deepEqual(read('["a"]\n["b"]'), ['jsonl', [['a'], ['b']]]);
  // CSV 는 여전히 CSV
  assert.equal(read('이름,부서\n김하늘,개발팀\n')[0], 'csv');
  assert.equal(read('time: start,end\n1,2\n')[0], 'csv');
  assert.equal(read('k=v,x\n1,2\n')[0], 'csv');
  assert.equal(read('그냥 글\n두 줄\n')[0], 'csv');
  assert.equal(read('a\tb\n1\t2\n')[0], 'csv');
  // 못 읽으면 어디가 틀렸는지
  assert.deepEqual(read('a = 1\nb = oops\n'), ['error', 2, 5]);
  assert.deepEqual(read('a: 1\nb: [1, 2\n'), ['error', 3, 1]);
  assert.deepEqual(read('[server]\nhost = \n'), ['error', 2, 8]);
  // 확장자가 먼저, 안 되면 내용으로
  assert.deepEqual(read('{a: 1, b: [x, y]}', 'yaml'), ['yaml', { a: 1, b: ['x', 'y'] }]);
  assert.deepEqual(read('a = 1\n', 'yaml'), ['yaml', 'a = 1']);
  assert.deepEqual(read('a: 1\n', 'json'), ['yaml', { a: 1 }]);
  assert.deepEqual(read('{"a": 1}', 'toml'), ['json', { a: 1 }]);
  assert.equal(read('x,y\n1,2\n', 'json')[0], 'error');
  assert.equal(read('a: 1\n', 'csv')[0], 'csv');
});

test('다른 형식으로 쓰기와 왕복', () => {
  const doc: Json = { name: '도구', on: true, n: 1.5, text: '여러\n줄', empty: null, list: [1, 'a', null], rows: [{ id: 1, tag: 'no' }, { id: 2, tag: '2026-11-13' }], deep: { a: { b: [] } } };
  assert.deepEqual(JSON.parse(toJson(doc)), doc);
  assert.equal(toJson([1, { a: 2 }], false), '[1,{"a":2}]\n');
  // YAML: 그대로 돌아온다
  assert.deepEqual(read(toYaml(doc), 'yaml'), ['yaml', doc]);
  assert.deepEqual(read(toYaml(doc)), ['yaml', doc]);
  const shared = { k: 1 };
  assert.ok(!toYaml({ a: shared, b: shared }).includes('*'));
  assert.equal(toYaml({ a: 'x '.repeat(80) }).trim().split('\n').length, 1);
  // TOML: null 은 빠지고 나머지는 돌아온다
  const t = toToml(doc);
  assert.deepEqual([t.wrapped, t.dropped], [null, 2]);
  assert.deepEqual(read(t.text), ['toml', { name: '도구', on: true, n: 1.5, text: '여러\n줄', list: [1, 'a'], rows: [{ id: 1, tag: 'no' }, { id: 2, tag: '2026-11-13' }], deep: { a: { b: [] } } }]);
  assert.match(t.text, /\[\[rows\]\]/);
  // 맨 위가 배열이나 값이면 감싼다
  const arr = toToml([{ a: 1 }, { a: 2 }]);
  assert.equal(arr.wrapped, 'items');
  assert.deepEqual(read(arr.text), ['toml', { items: [{ a: 1 }, { a: 2 }] }]);
  assert.deepEqual(toToml(3), { text: 'value = 3\n', wrapped: 'value', dropped: 0 });
  // CSV → 객체 → YAML · TOML
  const p = parseAny('id,name\n1,김\n2,\n');
  assert.ok(p.kind === 'csv');
  const rows = tableToJson(csvToTable(p.rows, true));
  assert.equal(toYaml(rows), '- id: 1\n  name: 김\n- id: 2\n  name: null\n');
  assert.equal(toToml(rows).text, '[[items]]\nid = 1\nname = "김"\n\n[[items]]\nid = 2\n');
});
