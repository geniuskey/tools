// 한 색을 여러 표기로 적는다. sRGB 밖의 색은 HEX · RGB · HSL 처럼 sRGB 로만 적을 수 있는 표기에 맞춘 색을 쓴다.
import { NAMES, parseColor } from './parse';
import { cmyk, deltaEOK, gamutMap, hsl, hwb, inGamut, lab, lch, oklab, oklch, p3, round8, type Rgb } from './space';

/** 소수 d 자리까지, 뒤의 0 은 지운다 */
export function fmtNum(v: number, d: number): string {
  const r = Number(v.toFixed(d));
  return Object.is(r, -0) || r === 0 ? '0' : String(r);
}
const pct = (v: number, d = 1) => `${fmtNum(v, d)}%`;
const alphaPart = (a: number) => (a < 0.9995 ? ` / ${pct(a * 100, 1)}` : '');
const byte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);

/** #rrggbb 또는 #rrggbbaa. 색역 밖이면 맞춘 뒤 적는다 */
export function toHex(c: Rgb): string {
  const m = inGamut(c) ? c : gamutMap(c);
  const parts = [m.r, m.g, m.b].map((v) => byte(v).toString(16).padStart(2, '0'));
  if (m.alpha < 0.9995) parts.push(byte(m.alpha).toString(16).padStart(2, '0'));
  return '#' + parts.join('');
}
/** 알파 없이 #rrggbb */
export const toHex6 = (c: Rgb) => toHex({ ...c, alpha: 1 });

export const fmtRgb = (c: Rgb) => `rgb(${byte(c.r)} ${byte(c.g)} ${byte(c.b)}${alphaPart(c.alpha)})`;
export function fmtOklch(c: Rgb): string {
  const o = oklch(c);
  return `oklch(${pct(o.l * 100, 1)} ${fmtNum(o.c, 3)} ${fmtNum(o.h, 1)}${alphaPart(c.alpha)})`;
}

export interface Format {
  id: string;
  label: string;
  text: string;
  note?: string;
}

export interface Described {
  /** 들어온 그대로의 색 */
  original: Rgb;
  /** sRGB 안으로 맞춘 색. 화면 · HEX 는 이 색 */
  srgb: Rgb;
  /** sRGB 밖이라 맞췄다 */
  mapped: boolean;
  formats: Format[];
}

export function describe(original: Rgb): Described {
  const mapped = !inGamut(original, 0.5 / 255);
  const s = round8(mapped ? gamutMap(original) : original);
  const a = original.alpha;
  const [h, sl, l] = hsl(s);
  const [hh, w, bl] = hwb(s);
  const [L, A, B] = oklab(original);
  const o = oklch(original);
  const [lL, la, lb] = lab(original);
  const [cL, cC, cH] = lch(original);
  const p = p3(original);
  const [cc, cm, cy, ck] = cmyk(s);
  const formats: Format[] = [
    { id: 'hex', label: 'HEX', text: toHex(s) },
    { id: 'rgb', label: 'RGB', text: fmtRgb(s) },
    { id: 'rgb-legacy', label: 'RGB (쉼표)', text: a < 0.9995 ? `rgba(${byte(s.r)}, ${byte(s.g)}, ${byte(s.b)}, ${fmtNum(a, 3)})` : `rgb(${byte(s.r)}, ${byte(s.g)}, ${byte(s.b)})`, note: '오래된 프로그램 · 엑셀 VBA 등' },
    { id: 'hsl', label: 'HSL', text: `hsl(${fmtNum(h, 1)} ${pct(sl)} ${pct(l)}${alphaPart(a)})` },
    { id: 'hwb', label: 'HWB', text: `hwb(${fmtNum(hh, 1)} ${pct(w)} ${pct(bl)}${alphaPart(a)})` },
    { id: 'oklch', label: 'OKLCH', text: `oklch(${pct(o.l * 100, 2)} ${fmtNum(o.c, 4)} ${fmtNum(o.h, 2)}${alphaPart(a)})`, note: '사람 눈에 고른 밝기 · 채도 · 색상' },
    { id: 'oklab', label: 'OKLab', text: `oklab(${pct(L * 100, 2)} ${fmtNum(A, 4)} ${fmtNum(B, 4)}${alphaPart(a)})` },
    { id: 'lab', label: 'Lab', text: `lab(${fmtNum(lL, 2)} ${fmtNum(la, 2)} ${fmtNum(lb, 2)}${alphaPart(a)})`, note: 'CIE Lab (D50)' },
    { id: 'lch', label: 'LCH', text: `lch(${fmtNum(cL, 2)} ${fmtNum(cC, 2)} ${fmtNum(cH, 2)}${alphaPart(a)})` },
    { id: 'p3', label: 'Display P3', text: `color(display-p3 ${p.map((v) => fmtNum(v, 4)).join(' ')}${alphaPart(a)})`, note: '맥 · 아이폰의 넓은 색역' },
    { id: 'float', label: '0~1 실수', text: [s.r, s.g, s.b].map((v) => fmtNum(v, 4)).join(', ') + (a < 0.9995 ? `, ${fmtNum(a, 3)}` : ''), note: 'Swift · Unity · 셰이더' },
    { id: 'int', label: '0xAARRGGBB', text: '0x' + [a, s.r, s.g, s.b].map((v) => byte(v).toString(16).padStart(2, '0')).join('').toUpperCase(), note: '안드로이드 · Flutter' },
    { id: 'cmyk', label: 'CMYK', text: `cmyk(${[cc, cm, cy, ck].map((v) => pct(v, 0)).join(' ')})`, note: '단순 계산값 — 인쇄소의 색 관리 값과 다릅니다' },
  ];
  return { original, srgb: s, mapped, formats };
}

const NAMED: [string, Rgb][] = [];
function named() {
  if (!NAMED.length) {
    const seen = new Set<string>();
    for (const [n, h] of NAMES) {
      if (seen.has(h)) continue;
      seen.add(h);
      NAMED.push([n, parseColor('#' + h)!.color]);
    }
  }
  return NAMED;
}
/** 가장 가까운 CSS 이름 색 */
export function nearestName(c: Rgb): { name: string; hex: string; exact: boolean; distance: number } {
  let best = named()[0];
  let d = Infinity;
  const s = { ...c, alpha: 1 };
  for (const e of named()) {
    const x = deltaEOK(s, e[1]);
    if (x < d) [best, d] = [e, x];
  }
  return { name: best[0], hex: toHex(best[1]), exact: toHex6(s) === toHex(best[1]), distance: d };
}
