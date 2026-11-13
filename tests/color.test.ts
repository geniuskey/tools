import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor } from '../src/lib/color/parse';
import { describe, nearestName, toHex } from '../src/lib/color/format';
import { fromOklch, gamutMap, hsl, inGamut, lab, oklch, p3, rgb, round8 } from '../src/lib/color/space';
import { apca, fmtRatio, ratio, suggest } from '../src/lib/color/contrast';
import { dominant, exportScale, harmony, scale } from '../src/lib/color/palette';
import { simulate } from '../src/lib/color/cvd';

const P = (s: string) => {
  const p = parseColor(s);
  assert.ok(p, `읽지 못함: ${s}`);
  return p.color;
};
const hex = (s: string) => toHex(P(s));
const near = (a: number, b: number, eps: number, msg?: string) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≠ ${b} (±${eps})`);

test('읽기: HEX · 이름 · 느슨한 꼴', () => {
  for (const s of ['#2563eb', '2563EB', '#2563ebff', 'rgb(37 99 235)', 'rgb(37, 99, 235)', 'rgba(37,99,235,1)', '37, 99, 235', '37 99 235', 'rgb 37 99 235', '0xFF2563EB', 'Color(0xFF2563EB)', '0x2563eb', 'background-color: #2563eb !important;', '"#2563eb"', '  #2563EB;  ', 'color(srgb 0.1451 0.3882 0.9216)'])
    assert.equal(hex(s), '#2563eb', s);
  assert.equal(hex('#fff'), '#ffffff');
  assert.equal(hex('#f008'), '#ff000088');
  assert.equal(hex('rebeccapurple'), '#663399');
  assert.equal(hex('Tomato'), '#ff6347');
  assert.equal(P('transparent').alpha, 0);
  assert.equal(hex('rgb(100% 0% 50%)'), '#ff0080');
  assert.equal(hex('rgb(255 0 0 / 50%)'), '#ff000080');
  assert.equal(hex('rgba(255, 0, 0, .5)'), '#ff000080');
  for (const s of ['', '#ggg', '#12345', 'rgb(1 2)', 'rgb(1 2 3 4 5)', 'hsl(10% 50% 50%)', 'nope', 'rgb(1, 2, 3', 'url(#a)', 'color(foo 1 2 3)']) assert.equal(parseColor(s), null, s);
});

test('읽기: HSL · HWB · Lab · LCH · OKLab · OKLCH · P3 · CMYK', () => {
  assert.equal(hex('hsl(0 100% 50%)'), '#ff0000');
  assert.equal(hex('hsl(120deg, 100%, 25%)'), '#008000');
  assert.equal(hex('hsla(240, 100%, 50%, 0.5)'), '#0000ff80');
  assert.equal(hex('hsl(0.5turn 100% 50%)'), '#00ffff');
  assert.equal(hex('hsl(3.14159rad 100% 50%)'), '#00ffff');
  assert.equal(hex('hsl 210 50% 40%'), '#336699');
  assert.equal(hex('hwb(0 0% 0%)'), '#ff0000');
  assert.equal(hex('hwb(0 60% 60%)'), '#808080');
  assert.equal(hex('lab(54.29 80.8 69.89)'), '#ff0000');
  assert.equal(hex('lch(54.29 106.84 40.85)'), '#ff0000');
  assert.equal(hex('oklab(62.8% 0.2249 0.1258)'), '#ff0000');
  assert.equal(hex('oklch(62.8% 0.2577 29.23)'), '#ff0000');
  assert.equal(hex('oklch(0.628 0.2577 29.23)'), '#ff0000');
  assert.equal(hex('oklch(1 0 none)'), '#ffffff');
  assert.equal(hex('color(display-p3 0.9176 0.2003 0.1386)'), '#ff0000');
  assert.equal(hex('cmyk(0% 100% 100% 0%)'), '#ff0000');
  assert.equal(hex('cmyk(0, 1, 1, 0)'), '#ff0000');
  assert.equal(hex('color(xyz-d65 0.4124 0.2126 0.0193)'), '#ff0000');
});

test('알려진 값: OKLCH · Lab · HSL', () => {
  const red = oklch(P('#ff0000'));
  near(red.l, 0.62796, 1e-4, 'L');
  near(red.c, 0.25768, 1e-4, 'C');
  near(red.h, 29.2339, 0.01, 'h');
  const blue = oklch(P('#0000ff'));
  near(blue.l, 0.45201, 1e-4);
  near(blue.c, 0.31321, 1e-4);
  near(blue.h, 264.052, 0.01);
  assert.deepEqual(oklch(P('#ffffff')), { l: oklch(P('#ffffff')).l, c: oklch(P('#ffffff')).c, h: 0 });
  near(oklch(P('#fff')).l, 1, 1e-6);
  near(oklch(P('#808080')).c, 0, 1e-4);
  const [L, a, b] = lab(P('#ff0000'));
  near(L, 54.29, 0.01);
  near(a, 80.8, 0.05);
  near(b, 69.89, 0.05);
  const [h, s, l] = hsl(P('#2563eb'));
  near(h, 221.2, 0.1);
  near(s, 83.2, 0.1);
  near(l, 53.3, 0.1);
  // P3 의 빨강
  const pr = p3(P('#ff0000'));
  near(pr[0], 0.9176, 1e-3);
});

test('왕복: 표기마다 적은 것을 다시 읽으면 같은 색', () => {
  for (const s of ['#2563eb', '#000000', '#ffffff', '#c2255c80', '#7f7f7f', '#00ff00', '#123456', '#fedcba', '#0c8599']) {
    const d = describe(P(s));
    for (const f of d.formats) {
      if (f.id === 'cmyk' || f.id === 'float') continue;
      assert.equal(hex(f.text), s, `${s} → ${f.label} ${f.text}`);
    }
  }
});

test('색역: sRGB 밖의 색은 채도를 줄여 맞춘다', () => {
  const wide = P('oklch(70% 0.4 150)');
  assert.equal(inGamut(wide), false);
  const m = gamutMap(wide);
  assert.ok(inGamut(m));
  const o = oklch(m);
  // 밝기 · 색상은 거의 그대로, 채도만 줄었다
  near(o.l, 0.7, 0.02);
  near(o.h, 150, 3);
  assert.ok(o.c < 0.4 && o.c > 0.15, String(o.c));
  const d = describe(wide);
  assert.equal(d.mapped, true);
  assert.match(d.formats.find((f) => f.id === 'oklch')!.text, /^oklch\(70% 0\.4 150\)$/);
  assert.equal(describe(P('#2563eb')).mapped, false);
  // P3 빨강은 sRGB 빨강 근처로
  assert.equal(toHex(P('color(display-p3 1 0 0)')).slice(0, 3), '#ff');
  // 너무 밝으면 흰색, 너무 어두우면 검정
  assert.equal(toHex(fromOklch(1.2, 0.3, 30)), '#ffffff');
  assert.equal(toHex(fromOklch(0, 0.3, 30)), '#000000');
});

test('대비: WCAG 명암비 · APCA', () => {
  assert.equal(fmtRatio(ratio(P('#777'), P('#fff'))), '4.47');
  near(ratio(P('#777'), P('#fff')), 4.478, 0.001);
  assert.equal(fmtRatio(ratio(P('#000'), P('#fff'))), '21.00');
  assert.equal(fmtRatio(ratio(P('#fff'), P('#fff'))), '1.00');
  near(ratio(P('#767676'), P('#fff')), 4.54, 0.01);
  // 순서와 상관없다
  assert.equal(ratio(P('#2563eb'), P('#fff')), ratio(P('#fff'), P('#2563eb')));
  // 반투명 글자는 배경 위에 겹친 색으로
  near(ratio(P('rgb(0 0 0 / 50%)'), P('#fff')), ratio(rgb(0.5, 0.5, 0.5), P('#fff')), 1e-9);
  // 반투명 배경은 흰 바탕 위에
  near(ratio(P('#000'), P('rgb(0 0 0 / 0%)')), 21, 1e-9);
  near(apca(P('#000'), P('#fff')), 106.04, 0.05);
  near(apca(P('#fff'), P('#000')), -107.88, 0.05);
  near(apca(P('#888'), P('#fff')), 63.06, 0.1);
  assert.equal(apca(P('#fff'), P('#fff')), 0);
});

test('대비: 제안한 색은 반올림한 뒤에도 기준을 넘고, 색상은 그대로', () => {
  for (const [fg, bg, min] of [
    ['#777777', '#ffffff', 4.5],
    ['#2563eb', '#1e293b', 4.5],
    ['#c2255c', '#f8f9fa', 7],
    ['#ffd43b', '#ffffff', 3],
    ['#3bc9db', '#ffffff', 4.5],
  ] as const) {
    const s = suggest(P(fg), P(bg), min, 'fg');
    const any = s.darker ?? s.lighter;
    assert.ok(any, `${fg} on ${bg}`);
    for (const x of [s.darker, s.lighter]) {
      if (!x) continue;
      assert.ok(ratio(x.color, P(bg)) >= min, `${fg} → ${toHex(x.color)} ${ratio(x.color, P(bg))}`);
      assert.equal(toHex(x.color), toHex(round8(x.color)));
      if (oklch(P(fg)).c > 0.05) near(oklch(x.color).h, oklch(P(fg)).h, 6, `${fg} 색상`);
    }
    // 배경을 바꾸는 쪽도
    const b = suggest(P(bg), P(fg), min, 'bg');
    for (const x of [b.darker, b.lighter]) if (x) assert.ok(ratio(P(fg), x.color) >= min);
  }
  // 가장 가까운 색: #777 은 조금만 어둡게
  const s = suggest(P('#777777'), P('#ffffff'), 4.5, 'fg');
  assert.equal(toHex(s.darker!.color), '#767676');
  assert.equal(s.lighter, null);
});

test('팔레트: 단계 · 어울리는 색 · 내보내기', () => {
  const sc = scale(P('#2563eb'));
  assert.equal(sc.length, 11);
  assert.equal(sc.filter((s) => s.base).length, 1);
  assert.ok(sc.some((s) => s.base && s.hex === '#2563eb'));
  // 단계가 갈수록 어두워진다
  for (let i = 1; i < sc.length; i++) assert.ok(oklch(sc[i].color).l < oklch(sc[i - 1].color).l, `${sc[i].step}`);
  assert.ok(oklch(sc[0].color).l > 0.95);
  assert.ok(sc.every((s) => /^#[0-9a-f]{6}$/.test(s.hex)));
  // 무채색은 무채색 단계로
  assert.ok(scale(P('#808080')).every((s) => oklch(s.color).c < 0.01));
  // 아주 밝은 색 · 어두운 색도 순서가 맞다
  for (const c of ['#fefefe', '#050505', '#fde68a']) {
    const x = scale(P(c));
    for (let i = 1; i < x.length; i++) assert.ok(oklch(x[i].color).l <= oklch(x[i - 1].color).l + 1e-9, `${c} ${x[i].step}`);
  }
  const [a, b] = harmony(P('#2563eb'), [0, 180]);
  assert.equal(toHex(a), '#2563eb');
  near(Math.abs(oklch(b).h - oklch(a).h), 180, 8);
  const css = exportScale('Brand Blue', sc, 'css');
  assert.match(css, /--brand-blue-500: #[0-9a-f]{6};/);
  assert.equal(css.split('\n').length, 13);
  assert.deepEqual(Object.keys(JSON.parse(exportScale('x', sc, 'json')).x), ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']);
  assert.match(exportScale('brand', sc, 'tailwind4'), /--color-brand-950: oklch\(/);
  assert.match(exportScale('brand', sc, 'tailwind3'), /^\/\/.*\nbrand: \{\n  50: '#/);
});

test('사진의 주요 색', () => {
  // 빨강 3/4, 파랑 1/4, 투명은 빼고
  const px = new Uint8ClampedArray(4 * 100);
  for (let i = 0; i < 100; i++) px.set(i < 60 ? [255, 0, 0, 255] : i < 80 ? [0, 0, 255, 255] : [0, 255, 0, 0], i * 4);
  const d = dominant(px, 4);
  assert.equal(d.length, 2);
  assert.equal(d[0].hex, '#ff0000');
  near(d[0].share, 0.75, 1e-9);
  assert.equal(d[1].hex, '#0000ff');
  assert.deepEqual(dominant(new Uint8ClampedArray(8)), []);
});

test('색각 이상 흉내 · 가까운 이름', () => {
  const r = simulate(P('#ff0000'), 'protan');
  const g = simulate(P('#00ff00'), 'protan');
  // 적색맹에게 빨강은 어둡고 누르스름하다
  assert.ok(oklch(r).l < oklch(P('#ff0000')).l);
  assert.ok(Math.abs(oklch(r).h - oklch(g).h) < 40, '빨강과 초록이 비슷한 색상으로');
  const gray = simulate(P('#2563eb'), 'achroma');
  assert.ok(Math.abs(gray.r - gray.g) < 1e-9 && Math.abs(gray.g - gray.b) < 1e-9);
  assert.equal(simulate(P('#fff'), 'deutan').r > 0.99, true);
  assert.deepEqual(simulate(rgb(0.1, 0.2, 0.3), 'none'), rgb(0.1, 0.2, 0.3));
  assert.equal(nearestName(P('#ff6347')).name, 'tomato');
  assert.equal(nearestName(P('#ff6347')).exact, true);
  assert.equal(nearestName(P('#2563eb')).exact, false);
  assert.equal(nearestName(P('#808080')).name, 'gray');
});
