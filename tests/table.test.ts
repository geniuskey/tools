import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteRow, dropEmpty, insertCol, mergeSame, moveCol, resolveAligns, sortRows, strWidth, transpose, unmerge, type Grid } from '../src/lib/table/grid';
import { readHtml, readText } from '../src/lib/table/read';
import { asNumber, defaultOptions, sqlType, write, type Format, type Options } from '../src/lib/table/write';

const opts = (g: Grid, o: Partial<Options> = {}): Options => ({ ...defaultOptions, ...o, aligns: resolveAligns(g, [], o.header ?? true) });
const out = (text: string, f: Format, o: Partial<Options> = {}) => {
  const r = readText(text)!;
  return write(r.grid, f, opts(r.grid, { header: r.header, ...o }));
};

test('알아보기: 엑셀 탭 · CSV · 마크다운 · psql · 글자 상자 · Jira · 위키 · JSON · 공백 맞춤', () => {
  const cases: [string, string, string[][]][] = [
    ['tsv', '이름\t나이\n하늘\t31\n', [['이름', '나이'], ['하늘', '31']]],
    ['csv', 'a,b\n"x, y",2\n3,"줄\n바꿈"', [['a', 'b'], ['x, y', '2'], ['3', '줄\n바꿈']]],
    ['markdown', '| a | b |\n|:-:|--:|\n| 1 | x \\| y |\n| 2 | z<br>w |', [['a', 'b'], ['1', 'x | y'], ['2', 'z\nw']]],
    ['box', ' id | name\n----+------\n  1 | 하늘\n(1 row)', [['id', 'name'], ['1', '하늘']]],
    ['box', '┌───┬───┐\n│ a │ b │\n├───┼───┤\n│ 1 │ 2 │\n└───┴───┘', [['a', 'b'], ['1', '2']]],
    ['box', '+---+-----+\n| a | b   |\n+===+=====+\n| 1 | 첫  |\n|   | 둘  |\n+---+-----+\n| 2 | 셋  |\n+---+-----+', [['a', 'b'], ['1', '첫\n둘'], ['2', '셋']]],
    ['jira', '||h1||h2||\n|a|b \\| c|', [['h1', 'h2'], ['a', 'b | c']]],
    ['json', '[{"a":1,"b":"x"},{"a":2,"c":true}]', [['a', 'b', 'c'], ['1', 'x', ''], ['2', '', 'true']]],
    ['json', '{"data":[[1,2],[3,4]]}', [['1', '2'], ['3', '4']]],
    ['spaces', 'CONTAINER ID   IMAGE\nabc123         nginx\ndef456         ', [['CONTAINER ID', 'IMAGE'], ['abc123', 'nginx'], ['def456', '']]],
  ];
  for (const [source, text, rows] of cases) {
    const r = readText(text);
    assert.equal(r?.source, source, text);
    assert.deepEqual(r!.grid.rows, rows, text);
  }
  assert.deepEqual(readText('| a | b |\n|:-:|--:|\n| 1 | 2 |')!.aligns, ['center', 'right']);
  assert.equal(readText('a;b;c\n1;2;3')!.source, 'csv');
  assert.equal(readText('')?.source, undefined);
});

test('머리글 짐작: 첫 줄이 숫자면 머리글이 아니다', () => {
  assert.equal(readText('이름\t점수\n하늘\t90\n서연\t85')!.header, true);
  assert.equal(readText('1\t2\n3\t4')!.header, false);
});

test('HTML: 합친 칸 · 줄바꿈 · 엔티티 · 엑셀 서식 · 표 안의 표', () => {
  const h = readHtml('<table><tr><th>구분</th><th colspan=2>값</th></tr><tr><td rowspan="2">A</td><td>1</td><td>2</td></tr><tr><td>3&nbsp;&amp;</td><td>4<br>5</td></tr></table>')!;
  assert.equal(h.header, true);
  assert.deepEqual(h.grid.rows, [['구분', '값', ''], ['A', '1', '2'], ['', '3 &', '4\n5']]);
  assert.deepEqual(h.grid.merges, [{ r: 0, c: 1, rs: 1, cs: 2 }, { r: 1, c: 0, rs: 2, cs: 1 }]);
  const excel = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><style><!--td {mso-number-format:General}--></style><body><!--StartFragment--><table border=0><tr height=20><td height=20 class=xl65>이름</td><td align=right>1,234</td></tr>\n<tr><td>  김
 하늘 </td><td align=right>5</td></tr><!--EndFragment--></table></body></html>`;
  const x = readHtml(excel)!;
  assert.deepEqual(x.grid.rows, [['이름', '1,234'], ['김 하늘', '5']]);
  assert.deepEqual(x.aligns, ['auto', 'right']);
  const nested = readHtml('<table><tr><td>바깥<table><tr><td>안</td></tr></table></td><td>둘</td></tr></table>')!;
  assert.deepEqual(nested.grid.rows, [['바깥안', '둘']]);
  // 미디어위키도 합친 칸을 읽는다
  const w = readText('{| class="wikitable"\n! A !! B\n|-\n| colspan="2" | 합침\n|-\n| x || y\n|}')!;
  assert.deepEqual(w.grid.merges, [{ r: 1, c: 0, rs: 1, cs: 2 }]);
});

test('마크다운: 한글은 두 칸으로 맞추고, 숫자 열은 오른쪽', () => {
  assert.equal(strWidth('김하늘'), 6);
  assert.equal(strWidth('ab'), 2);
  assert.equal(out('이름\t연봉\n김하늘\t52,000,000\n이\t1\n', 'markdown'), '| 이름   |       연봉 |\n| ------ | ---------: |\n| 김하늘 | 52,000,000 |\n| 이     |          1 |\n');
  assert.equal(out('a\tb\n1\t|', 'markdown', { pad: false }), '| a | b |\n| --: | --- |\n| 1 | \\| |\n');
  // 머리글이 없으면 빈 머리글
  assert.match(out('1\t2\n3\t4', 'markdown'), /^\| +\| +\|\n/);
});

test('글자 표 · 슬랙: 칸 안 여러 줄, 테두리 모양', () => {
  const g = readText('a,b\n1,"x\ny"')!.grid;
  assert.equal(write(g, 'text', opts(g)), '┌───┬───┐\n│ a │ b │\n├───┼───┤\n│ 1 │ x │\n│   │ y │\n└───┴───┘\n');
  assert.equal(write(g, 'text', opts(g, { box: 'plain' })), 'a  b\n-  -\n1  x\n   y\n');
  assert.ok(write(g, 'slack', opts(g)).startsWith('```\n┌'));
  assert.match(write(g, 'text', opts(g, { box: 'rst' })), /\+===\+===\+/);
});

test('합친 칸: HTML · 위키 · Redmine · LaTeX 는 그대로, 나머지는 채우거나 비운다', () => {
  const g = readHtml('<table><tr><th>구분</th><th colspan=2>값</th></tr><tr><td rowspan="2">A</td><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>')!.grid;
  const o = opts(g);
  assert.match(write(g, 'html', o), /<th colspan="2"[^>]*>값<\/th>/);
  assert.match(write(g, 'html', o), /<td rowspan="2"[^>]*>A<\/td>/);
  assert.match(write(g, 'html', o), /<thead>/);
  // 머리글이 몸통까지 합쳐지면 thead 로 나누지 않는다
  const down = readHtml('<table><tr><th rowspan=2>팀</th><th>이름</th></tr><tr><td>하늘</td></tr></table>')!.grid;
  const h = write(down, 'html', opts(down));
  assert.doesNotMatch(h, /<thead>/);
  assert.match(h, /<tbody>\n    <tr>\n      <th rowspan="2"/);
  assert.match(write(g, 'mediawiki', o), /! 구분 !! colspan="2" \| 값/);
  assert.match(write(g, 'redmine', o), /\|_\\2\. 값 \|/);
  assert.match(write(g, 'redmine', o), /\|\/2\. A \|/);
  assert.match(write(g, 'latex', o), /\\multicolumn\{2\}\{c\}\{\\textbf\{값\}\}/);
  assert.match(write(g, 'latex', o), /\\multirow\{2\}\{\*\}\{A\}/);
  assert.equal(write(g, 'csv', { ...o, merges: 'fill' }), '구분,값,값\nA,1,2\nA,3,4\n');
  assert.equal(write(g, 'csv', { ...o, merges: 'blank' }), '구분,값,\nA,1,2\n,3,4\n');
  assert.equal(write(g, 'csv', o), '구분,값,\nA,1,2\n,3,4\n');
});

test('위키 · LaTeX 이스케이프', () => {
  assert.equal(out('a\tb\nx|y\t\n', 'jira'), '||a||b||\n|x\\|y| |\n');
  assert.match(out('a\n50% & $5_x\n', 'latex', { header: true }), /50\\% \\& \\\$5\\_x/);
  assert.match(out('a\nx|y\n', 'mediawiki'), /\| x\{\{!\}\}y/);
});

test('JSON · SQL: 숫자를 알아보되 007 · 전화번호는 글로', () => {
  assert.equal(asNumber('1,234'), 1234);
  assert.equal(asNumber('007'), null);
  assert.equal(asNumber('01012345678'), null);
  assert.equal(asNumber('-3.5'), -3.5);
  const j = JSON.parse(out('id\t이름\t코드\t비고\n1\t하늘\t007\t\n2\t서연\t1,200\ttrue\n', 'json'));
  assert.deepEqual(j, [{ id: 1, 이름: '하늘', 코드: '007', 비고: null }, { id: 2, 이름: '서연', 코드: 1200, 비고: true }]);
  assert.deepEqual(JSON.parse(out('a\tb\na\t1\n', 'json', { jsonShape: 'arrays' })), [['a', 'b'], ['a', 1]]);
  assert.equal(
    out("id\tname\n1\tO'Brien\n2\t\n", 'sql', { sqlTable: 'people' }),
    "INSERT INTO `people` (`id`, `name`) VALUES\n  (1, 'O''Brien'),\n  (2, NULL);\n",
  );
  assert.equal(out('id\n1\n', 'sql', { dialect: 'postgres', sqlBatch: false }), 'INSERT INTO "my_table" ("id") VALUES (1);\n');
  assert.match(out('이름\n하늘\n', 'sql', { dialect: 'sqlserver' }), /\(N'하늘'\)/);
  assert.match(out('id\tname\tday\n1\t하늘\t2026-11-18\n', 'sql', { sqlCreate: true }), /CREATE TABLE `my_table` \(\n  `id` INTEGER,\n  `name` VARCHAR\(50\),\n  `day` DATE\n\);/);
  assert.equal(sqlType(['1.5', '22.25'], 'postgres'), 'DECIMAL(4, 2)');
  assert.equal(sqlType(['3000000000'], 'mysql'), 'BIGINT');
  // 머리글이 겹치거나 비면 이름을 붙인다
  assert.deepEqual(Object.keys(JSON.parse(out('a\ta\t\n1\t2\t3\n', 'json'))[0]), ['a', 'a_2', '열3']);
});

test('다듬기: 행 ↔ 열, 정렬, 옮기기, 넣기, 지우기, 같은 값 합치기', () => {
  const g: Grid = { rows: [['이름', '점수'], ['나', '10'], ['가', '9'], ['다', '']], merges: [] };
  assert.deepEqual(transpose(g).rows, [['이름', '나', '가', '다'], ['점수', '10', '9', '']]);
  assert.deepEqual(sortRows(g, 1, 1, true).rows.map((r) => r[0]), ['이름', '가', '나', '다']);
  assert.deepEqual(sortRows(g, 1, -1, true).rows.map((r) => r[0]), ['이름', '나', '가', '다']);
  assert.deepEqual(sortRows(g, 0, 1, true).rows.map((r) => r[0]), ['이름', '가', '나', '다']);
  const files: Grid = { rows: [['파일10'], ['파일2'], ['파일1']], merges: [] };
  assert.deepEqual(sortRows(files, 0, 1, false).rows.flat(), ['파일1', '파일2', '파일10']);
  assert.deepEqual(moveCol(g, 0, 1).rows[0], ['점수', '이름']);
  assert.deepEqual(insertCol(g, 1).rows[0], ['이름', '', '점수']);
  const m: Grid = { rows: [['팀', '이름'], ['A', '하늘'], ['A', '서연'], ['B', '민준']], merges: [] };
  const merged = mergeSame(m, 0, true);
  assert.deepEqual(merged.merges, [{ r: 1, c: 0, rs: 2, cs: 1 }]);
  assert.deepEqual(merged.rows[2], ['', '서연']);
  assert.deepEqual(unmerge(merged, true).rows, m.rows);
  // 합친 칸의 첫 줄을 지우면 글이 아래로 내려간다
  const d = deleteRow(merged, 1);
  assert.deepEqual(d.rows, [['팀', '이름'], ['A', '서연'], ['B', '민준']]);
  assert.deepEqual(d.merges, []);
  assert.deepEqual(dropEmpty({ rows: [['a', '', 'b'], ['', '', ''], ['c', '', 'd']], merges: [] }).rows, [['a', 'b'], ['c', 'd']]);
});
