import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseOf, convert, duration, feetInches, fmt, fromBase, show, transferSeconds, windowsSize, type Ctx } from '../src/lib/unit/core';
import { parse, unitNamed, write } from '../src/lib/unit/parse';
import { rat } from '../src/lib/unit/rat';
import { categories, unitOf, units } from '../src/lib/unit/units';

const ctx: Ctx = { dpi: 96, delta: false };
/** 바꿔서 화면 글자로 */
const cv = (v: string, from: string, to: string, sig = 6, c = ctx) => fmt(convert(rat(v), from, to, c)!, sig);
/** 읽은 첫 뜻: "분류 글" */
function read(text: string) {
  const p = parse(text);
  assert.equal(p.kind, 'quantity', `${text}: ${JSON.stringify(p)}`);
  if (p.kind !== 'quantity') throw 0;
  return { r: p.readings[0], alts: p.readings.slice(1), target: p.target };
}
const total = (text: string, to: string, sig = 6) => {
  const { r } = read(text);
  return fmt(fromBase(baseOf(r.parts, ctx)!, unitOf(to), ctx)!, sig);
};

test('단위 표: 이름이 겹치지 않고, 기호를 다시 적으면 같은 단위로 읽힌다', () => {
  assert.equal(new Set(units.map((u) => u.id)).size, units.length);
  for (const c of categories) assert.ok(units.some((u) => u.id === c.first && u.cat === c.id), c.id);
  for (const u of units) {
    const p = parse(write('7', u.id), u.cat);
    assert.equal(p.kind, 'quantity', u.id);
    if (p.kind === 'quantity') assert.equal(p.readings[0].unit, u.id, `${u.id} (${u.sym})`);
    if (u.hero) assert.equal(unitOf(u.hero).cat, u.cat, `${u.id} 의 짝`);
  }
});

test('정확한 10진수: 끝나지 않는 비율도 마지막에 한 번만 나눈다', () => {
  // 1평 = 400/121 m² — 121평은 정확히 400 m²
  const m2 = convert(rat(121), 'pyeong', 'm2')!;
  assert.deepEqual(show(m2), { text: '400', plain: '400', approx: false });
  assert.equal(cv('32', 'pyeong', 'm2'), '105.785');
  assert.equal(show(convert(rat(32), 'pyeong', 'm2')!).approx, true);
  assert.equal(cv('32', 'pyeong', 'm2', 30), '105.785123966942148760330578512');
  assert.equal(cv('100', 'm2', 'pyeong'), '30.25');
  // 0.1 + 0.2 같은 어긋남이 없다
  assert.deepEqual(show(convert(rat('0.3'), 'm', 'cm')!), { text: '30', plain: '30', approx: false });
  assert.equal(cv('1', 'ft', 'cm'), '30.48');
  assert.equal(cv('1', 'mi', 'km', 12), '1.609344');
  assert.equal(cv('1', 'mi', 'km'), '1.60934');
  assert.equal(cv('1', 'in', 'mm'), '25.4');
  assert.equal(cv('1', 'ja', 'cm'), '30.303');
  assert.equal(cv('10', 'ri', 'km'), '3.92727');
  assert.equal(cv('1', 'acre', 'pyeong'), '1,224.17');
  assert.equal(cv('1', 'jeongbo', 'pyeong'), '3,000');
  assert.equal(cv('1', 'lb', 'kg', 12), '0.45359237');
  assert.equal(cv('1', 'geun', 'don'), '160');
  assert.equal(cv('1', 'geunveg', 'don'), '100');
  assert.equal(cv('1', 'gwan', 'kg'), '3.75');
  assert.equal(cv('1', 'usgal', 'L', 12), '3.785411784');
  assert.equal(cv('1', 'ukgal', 'L'), '4.54609');
  assert.equal(cv('1', 'doe', 'L'), '1.80391');
  assert.equal(cv('1', 'mal', 'doe'), '10');
  assert.equal(cv('1', 'kn', 'kmh'), '1.852');
  assert.equal(cv('1', 'psi', 'kPa'), '6.89476');
  assert.equal(cv('1', 'atm', 'hPa'), '1,013.25');
  assert.equal(cv('1', 'kgfcm2', 'bar'), '0.980665');
  assert.equal(cv('1', 'kWh', 'MJ'), '3.6');
  assert.equal(cv('1', 'kcal', 'kJ'), '4.184');
  assert.equal(cv('1', 'yr', 'd'), '365.243');
  assert.equal(cv('1', 'wk', 'h'), '168');
});

test('온도: 비율이 아니라 0점이 다르다', () => {
  assert.equal(cv('100', 'C', 'F'), '212');
  assert.equal(cv('-40', 'C', 'F'), '-40');
  assert.equal(cv('36.5', 'C', 'F'), '97.7');
  assert.equal(cv('0', 'K', 'C'), '-273.15');
  assert.equal(cv('98.6', 'F', 'C'), '37');
  assert.equal(cv('0', 'F', 'K'), '255.372');
  assert.equal(show(convert(rat('98.6'), 'F', 'C')!).approx, false);
  // 온도 차이: 10°C 차이 = 18°F 차이
  const delta = { ...ctx, delta: true };
  assert.equal(cv('10', 'C', 'F', 6, delta), '18');
  assert.equal(cv('10', 'K', 'C', 6, delta), '10');
});

test('연비: L/100km 는 거꾸로 간다', () => {
  assert.equal(cv('12.5', 'kmL', 'L100'), '8');
  assert.equal(cv('8', 'L100', 'kmL'), '12.5');
  assert.equal(cv('5', 'L100', 'L100'), '5');
  // 연비가 두 배면 L/100km 는 절반
  assert.equal(cv('25', 'kmL', 'L100'), '4');
  assert.equal(cv('30', 'mpgUS', 'L100'), '7.84049');
  assert.equal(cv('30', 'mpgUK', 'L100'), '9.41603');
  assert.equal(cv('10', 'kmL', 'mpgUS'), '23.5215');
  assert.equal(convert(rat(0), 'L100', 'kmL'), null);
  assert.equal(convert(rat(0), 'kmL', 'L100'), null);
});

test('데이터: 1000 과 1024, Windows 에 보이는 크기, 받는 시간', () => {
  assert.equal(cv('1', 'TB', 'GiB'), '931.323');
  assert.equal(cv('1', 'GiB', 'MB'), '1,073.74');
  assert.equal(cv('1', 'GB', 'Mbit'), '8,000');
  assert.equal(cv('1', 'B', 'bit'), '8');
  assert.equal(cv('100', 'Mbps', 'MBps'), '12.5');
  assert.equal(cv('1', 'Gbps', 'MiBps'), '119.209');
  assert.equal(windowsSize(rat('1e12')), '931 GB');
  assert.equal(windowsSize(rat('2e12')), '1.82 TB');
  assert.equal(windowsSize(rat('500e9')), '466 GB');
  assert.equal(windowsSize(rat(1000)), null);
  assert.equal(windowsSize(rat(2048)), '2 KB');
  // 1 GB 를 100 Mbps 로: 80초
  const s = transferSeconds(rat('1e9'), rat('1e8'))!;
  assert.equal(duration(s), '1분 20초');
  assert.equal(duration(transferSeconds(rat('50e9'), rat('1e8'))!), '1시간 6분 40초');
  assert.equal(transferSeconds(rat(1), rat(0)), null);
});

test('인쇄 · 화면: px 은 DPI 를 따른다', () => {
  assert.equal(cv('96', 'px', 'inP'), '1');
  assert.equal(cv('12', 'pt', 'px'), '16');
  assert.equal(cv('210', 'mmP', 'px'), '793.701');
  const print = { ...ctx, dpi: 300 };
  assert.equal(cv('210', 'mmP', 'px', 6, print), '2,480.31');
  assert.equal(cv('1', 'inP', 'px', 6, print), '300');
  assert.equal(cv('72', 'pt', 'mmP', 6, { ...ctx, dpi: 72 }), '25.4');
  assert.equal(cv('1', 'pica', 'pt'), '12');
});

test('적기: 유효숫자 · 쉼표 · 아주 크고 작은 수', () => {
  assert.equal(show(rat('1234567.89')).text, '1,234,568');
  assert.equal(show(rat('1234567.89')).plain, '1234568');
  assert.equal(show(rat('0.000123456789')).text, '0.000123457');
  assert.equal(show(rat('1e-9')).text, '1 × 10⁻⁹');
  assert.equal(show(rat('1.5e-9')).plain, '1.5e-9');
  assert.equal(show(rat('6.02214076e23'), 4).text, '6.022 × 10²³');
  assert.equal(show(rat('-12345.678')).text, '-12,345.7');
  assert.equal(show(rat(0)).text, '0');
  assert.equal(feetInches(rat('1.8034')), '5 ft 11 in');
  assert.equal(feetInches(rat('1.75')), '5 ft 8.9 in');
  assert.equal(feetInches(rat('0.3047')), '1 ft 0 in');
  assert.equal(duration(rat(90)), '1분 30초');
  assert.equal(duration(rat('0.25')), '0.25초');
  assert.equal(duration(rat(86400 * 3 + 3600 + 59)), '3일 1시간');
});

test('읽기: 적은 그대로', () => {
  const cases: [string, string, string][] = [
    ['32평', 'area', '32 평'],
    ['32 평', 'area', '32 평'],
    ['32평형', 'area', '32 평'],
    ['105㎡', 'area', '105 m²'],
    ['105 m^2', 'area', '105 m²'],
    ['1,000 sq ft', 'area', '1000 ft²'],
    ['5ft 11in', 'length', '5 ft 11 in'],
    [`5'11"`, 'length', '5 ft 11 in'],
    ['5′11″', 'length', '5 ft 11 in'],
    [`5' 11`, 'length', '5 ft 11 in'],
    ['1m 80', 'length', '1 m 80 cm'],
    ['１８０ｃｍ', 'length', '180 cm'],
    ['1.5 GB', 'data', '1.5 GB'],
    ['1.5GB', 'data', '1.5 GB'],
    ['500 MiB', 'data', '500 MiB'],
    ['100 km/h', 'speed', '100 km/h'],
    ['시속 100km', 'speed', '100 km/h'],
    ['시속 60마일', 'speed', '60 mph'],
    ['초속 3', 'speed', '3 m/s'],
    ['36.5도', 'temp', '36.5 °C'],
    ['36.5℃', 'temp', '36.5 °C'],
    ['섭씨 20도', 'temp', '20 °C'],
    ['화씨 100도', 'temp', '100 °F'],
    ['-40°F', 'temp', '-40 °F'],
    ['300 K', 'temp', '300 K'],
    ['3근', 'mass', '3 근'],
    ['3근(채소)', 'mass', '3 근(채소)'],
    ['2돈', 'mass', '2 돈'],
    ['3킬로', 'mass', '3 kg'],
    ['150 lbs', 'mass', '150 lb'],
    ['1 1/2 컵', 'volume', '1 1/2 컵'],
    ['1/2 cup', 'volume', '1/2 US cup'],
    ['3만평', 'area', '3만 평'],
    ['2억 원', 'error', ''],
    ['1시간 30분', 'time', '1 시간 30 분'],
    ['1시간30분', 'time', '1 시간 30 분'],
    ['1h 30m', 'time', '1 시간 30 분'],
    ['1시간 30', 'time', '1 시간 30 분'],
    ['100Mbps', 'rate', '100 Mbps'],
    ['20 MB/s', 'rate', '20 MB/s'],
    ['12pt', 'print', '12 pt'],
    ['1920px', 'print', '1920 px'],
    ['2000kcal', 'energy', '2000 kcal'],
    ['500칼로리', 'energy', '500 kcal'],
    ['32 psi', 'pressure', '32 psi'],
    ['1013 hPa', 'pressure', '1013 hPa'],
    ['15 km/L', 'fuel', '15 km/L'],
    ['8 L/100km', 'fuel', '8 L/100km'],
    ['30 mpg', 'fuel', '30 mpg'],
    ['32평이요', 'area', '32 평'],
    ['1e3 m', 'length', '1e3 m'],
  ];
  for (const [text, cat, canon] of cases) {
    const p = parse(text);
    if (cat === 'error') {
      assert.equal(p.kind, 'error', text);
      continue;
    }
    assert.equal(p.kind, 'quantity', `${text}: ${JSON.stringify(p)}`);
    if (p.kind !== 'quantity') continue;
    assert.equal(p.readings[0].cat, cat, text);
    assert.equal(p.readings[0].text, canon, text);
  }
  assert.equal(total('5ft 11in', 'cm'), '180.34');
  assert.equal(total('1 1/2 컵', 'mL'), '300');
  assert.equal(total('3만평', 'ha'), '9.91736');
  assert.equal(total('1시간 30분', 'min'), '90');
});

test('읽기: 헷갈리는 이름은 다른 뜻도 알려 준다', () => {
  const alt = (text: string) => read(text).alts.map((r) => `${r.cat}:${r.text}`);
  assert.deepEqual(alt('3근'), ['mass:3 근(채소)']);
  assert.deepEqual(alt('3킬로'), ['length:3 km']);
  assert.deepEqual(alt('2컵'), ['volume:2 US cup']);
  assert.deepEqual(alt('5 kb'), ['data:5 kbit']);
  assert.deepEqual(alt('30 mpg'), ['fuel:30 mpg (UK)']);
  // 대소문자까지 맞게 적으면 그대로
  assert.deepEqual(alt('1.5 GB'), []);
  assert.equal(read('5 Mb').r.unit, 'Mbit');
  assert.equal(read('5 MB').r.unit, 'MB');
  assert.equal(read('5 mb').r.unit, 'MB');
  assert.equal(read('1 B').r.unit, 'B');
  assert.equal(read('8 b').r.unit, 'bit');
  // m 은 분이 아니다 — "1h 30m" 처럼 시간과 같이 있을 때만
  assert.deepEqual(alt('1234.5 m'), []);
  assert.equal(read('5 min').r.unit, 'min');
  // 보고 있는 분류가 먼저: mm 는 길이, 인쇄 화면에서는 인쇄
  assert.equal(read('3 mm').r.cat, 'length');
  const p = parse('3 mm', 'print');
  assert.ok(p.kind === 'quantity' && p.readings[0].unit === 'mmP');
});

test('읽기: 몇 ~ 로 물으면 그 단위를 짚는다', () => {
  assert.equal(read('32평은 몇 제곱미터').target, 'm2');
  assert.equal(read('105㎡는 몇 평이야?').target, 'pyeong');
  assert.equal(read('5 ft 11 in to cm').target, 'cm');
  assert.equal(read('100 km/h → mph').target, 'mph');
  assert.equal(read('1 TB = ? GiB').target, 'GiB');
  assert.equal(read('72 in in cm').target, 'cm');
  // 킬로가 무게인지 길이인지는 묻는 단위가 정한다
  const km = read('3킬로는 몇 마일');
  assert.equal(km.r.unit, 'km');
  assert.equal(km.target, 'mi');
  assert.deepEqual(unitNamed('제곱미터'), ['m2']);
  assert.deepEqual(unitNamed('없는단위'), []);
});

test('읽기: 숫자만 · 용지 · 못 읽는 글', () => {
  assert.deepEqual(parse(''), { kind: 'empty' });
  assert.deepEqual(parse('   '), { kind: 'empty' });
  const n = parse('42');
  assert.ok(n.kind === 'number' && n.raw === '42');
  const a4 = parse('A4');
  assert.ok(a4.kind === 'paper' && a4.paper.w === 210 && a4.paper.h === 297);
  assert.ok(parse('a4 용지').kind === 'paper');
  const b5 = parse('B5');
  assert.ok(b5.kind === 'paper' && b5.paper.w === 182 && b5.others[0].w === 176);
  const iso = parse('B5 (ISO)');
  assert.ok(iso.kind === 'paper' && iso.paper.w === 176);
  assert.ok(parse('letter').kind === 'paper');
  assert.ok(parse('A11').kind !== 'paper');
  const bad = parse('3 foo');
  assert.ok(bad.kind === 'error' && bad.message.includes('foo'));
  const mixed = parse('5 kg 3 m');
  assert.ok(mixed.kind === 'error' && mixed.message.includes('다른 종류'));
  assert.equal(parse('20도 30도').kind, 'error');
  assert.equal(parse('5 ft 11').kind, 'quantity');
});
