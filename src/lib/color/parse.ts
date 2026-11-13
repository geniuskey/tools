// 붙여넣은 색을 읽는다. CSS 색 문법(Color 4)을 거의 다 받고, 흔히 보는 느슨한 꼴도 받는다:
// "#fff", "fff", "255, 0, 0", "rgb 255 0 0", "0xff2563eb"(안드로이드 · Flutter, 앞이 알파), "background: #fff;" …
import { fromCmyk, fromHsl, fromHwb, fromLab, fromLch, fromLinRgb, fromOklab, fromOklch, fromP3, fromXyz50, fromXyz65, rgb, type Rgb } from './space';

export type Kind = 'hex' | 'rgb' | 'hsl' | 'hwb' | 'lab' | 'lch' | 'oklab' | 'oklch' | 'p3' | 'srgb-linear' | 'xyz' | 'cmyk' | 'name' | 'int';

export interface Parsed {
  color: Rgb;
  kind: Kind;
}

// CSS 이름 색 148개 (grey / gray 처럼 같은 색도 있다)
const NAME_LIST =
  'aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32';
export const NAMES: [string, string][] = [];
for (let i = 0, t = NAME_LIST.split(' '); i < t.length; i += 2) NAMES.push([t[i], t[i + 1]]);
const BY_NAME = new Map(NAMES);

function hexColor(h: string): Rgb | null {
  if (!/^[0-9a-f]+$/.test(h)) return null;
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const v = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return rgb(v(0), v(2), v(4), h.length === 8 ? v(6) : 1);
}

interface Tok {
  n: number;
  unit: '' | '%' | 'deg' | 'rad' | 'grad' | 'turn';
  none?: boolean;
}
function token(s: string): Tok | null {
  if (s === 'none') return { n: 0, unit: '', none: true };
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/.exec(s);
  return m ? { n: parseFloat(m[1]), unit: (m[2] ?? '') as Tok['unit'] } : null;
}
/** 숫자 또는 퍼센트. 100% 가 ref */
const num = (t: Tok, ref: number) => (t.unit === '%' ? (t.n / 100) * ref : t.n);
function angle(t: Tok): number | null {
  if (t.unit === '%') return null;
  return t.unit === 'rad' ? (t.n * 180) / Math.PI : t.unit === 'grad' ? t.n * 0.9 : t.unit === 'turn' ? t.n * 360 : t.n;
}
const alphaOf = (t: Tok | undefined) => (t ? Math.max(0, Math.min(1, num(t, 1))) : 1);

/** "a b c / d", "a, b, c, d" → 토큰들과 알파 */
function args(body: string): { toks: Tok[]; alpha?: Tok } | null {
  const [main, alpha, extra] = body.split('/');
  if (extra !== undefined) return null;
  const parts = main.trim().split(/\s*,\s*|\s+/).filter(Boolean);
  const toks = parts.map(token);
  if (toks.some((t) => !t)) return null;
  let a: Tok | undefined;
  if (alpha !== undefined) {
    const t = token(alpha.trim());
    if (!t) return null;
    a = t;
  }
  return { toks: toks as Tok[], alpha: a };
}

function fromSpace(body: string): Parsed | null {
  const [main, alpha, extra] = body.split('/');
  if (extra !== undefined) return null;
  const [space, ...rest] = main.trim().split(/\s+/);
  const vals = rest.map(token);
  if (vals.length !== 3 || vals.some((t) => !t || (t.unit !== '' && t.unit !== '%'))) return null;
  const v = vals.map((t) => num(t!, 1)) as [number, number, number];
  const at = alpha === undefined ? undefined : token(alpha.trim());
  if (at === null) return null;
  const al = alphaOf(at);
  switch (space) {
    case 'srgb':
      return { color: rgb(v[0], v[1], v[2], al), kind: 'rgb' };
    case 'srgb-linear':
      return { color: fromLinRgb(v, al), kind: 'srgb-linear' };
    case 'display-p3':
      return { color: fromP3(v, al), kind: 'p3' };
    case 'xyz':
    case 'xyz-d65':
      return { color: fromXyz65(v, al), kind: 'xyz' };
    case 'xyz-d50':
      return { color: fromXyz50(v, al), kind: 'xyz' };
  }
  return null;
}

function fromFunction(name: string, body: string): Parsed | null {
  if (name === 'color') return fromSpace(body);
  const a = args(body);
  if (!a) return null;
  let { toks, alpha } = a;
  if (name === 'cmyk' || name === 'device-cmyk') {
    if (toks.length === 5 && !alpha) [alpha, toks] = [toks[4], toks.slice(0, 4)];
    if (toks.length !== 4) return null;
    // 0~1 로 적었으면 비율로 본다 (0.5 = 50%)
    const vals = toks.map((t) => t.n);
    const scale = toks.every((t) => t.unit === '') && vals.every((v) => v <= 1) ? 100 : 1;
    return { color: fromCmyk(vals[0] * scale, vals[1] * scale, vals[2] * scale, vals[3] * scale, alphaOf(alpha)), kind: 'cmyk' };
  }
  // 쉼표로 적은 옛 문법은 네 번째 값이 알파
  if (toks.length === 4 && !alpha && body.includes(',')) {
    alpha = toks[3];
    toks = toks.slice(0, 3);
  }
  if (toks.length !== 3) return null;
  const al = alphaOf(alpha);
  const [x, y, z] = toks;
  switch (name) {
    case 'rgb':
    case 'rgba': {
      if ([x, y, z].some((t) => t.unit !== '' && t.unit !== '%')) return null;
      return { color: rgb(num(x, 255) / 255, num(y, 255) / 255, num(z, 255) / 255, al), kind: 'rgb' };
    }
    case 'hsl':
    case 'hsla': {
      const h = angle(x);
      if (h == null) return null;
      return { color: fromHsl(h, num(y, 100), num(z, 100), al), kind: 'hsl' };
    }
    case 'hwb': {
      const h = angle(x);
      if (h == null) return null;
      return { color: fromHwb(h, num(y, 100), num(z, 100), al), kind: 'hwb' };
    }
    case 'lab':
      return { color: fromLab([Math.max(0, num(x, 100)), num(y, 125), num(z, 125)], al), kind: 'lab' };
    case 'lch': {
      const h = angle(z);
      if (h == null) return null;
      return { color: fromLch(Math.max(0, num(x, 100)), Math.max(0, num(y, 150)), h, al), kind: 'lch' };
    }
    case 'oklab':
      return { color: fromOklab([Math.max(0, num(x, 1)), num(y, 0.4), num(z, 0.4)], al), kind: 'oklab' };
    case 'oklch': {
      const h = angle(z);
      if (h == null) return null;
      return { color: fromOklch(Math.max(0, num(x, 1)), Math.max(0, num(y, 0.4)), h, al), kind: 'oklch' };
    }
  }
  return null;
}

const FUNCS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'cmyk', 'device-cmyk']);

export function parseColor(input: string): Parsed | null {
  let s = input.trim().toLowerCase();
  if (!s || s.length > 300) return null;
  // CSS 한 줄을 통째로 붙여넣은 경우: "background-color: #fff !important;"
  s = s.replace(/;+$/, '').replace(/\s*!important$/, '').trim();
  s = s.replace(/^[a-z-]+\s*:\s*(?=\S)/, '');
  s = s.replace(/^(['"`])(.*)\1$/, '$2').trim();

  if (s === 'transparent') return { color: rgb(0, 0, 0, 0), kind: 'name' };
  const named = BY_NAME.get(s);
  if (named) return { color: hexColor(named)!, kind: 'name' };

  // Flutter: Color(0xFF2563EB)
  const flutter = /^color\(\s*(0x[0-9a-f]{8})\s*\)$/.exec(s);
  if (flutter) s = flutter[1];
  // 0xAARRGGBB (안드로이드 · Flutter) 또는 0xRRGGBB
  const ox = /^0x([0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (ox) {
    const h = ox[1];
    const c = hexColor(h.length === 8 ? h.slice(2) + h.slice(0, 2) : h)!;
    return { color: c, kind: 'int' };
  }
  const hex = /^#?([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    const c = hexColor(hex[1]);
    return c ? { color: c, kind: 'hex' } : null;
  }

  const fn = /^([a-z-]+)\s*\(\s*([^()]*?)\s*\)$/.exec(s);
  if (fn) return FUNCS.has(fn[1]) ? fromFunction(fn[1], fn[2]) : null;
  // 괄호 없이: "hsl 210 50% 40%"
  const bare = /^([a-z-]+)\s+([^()]+)$/.exec(s);
  if (bare && FUNCS.has(bare[1]) && bare[1] !== 'color') return fromFunction(bare[1], bare[2]);
  // 숫자만: "255, 0, 0" · "255 0 0 / 50%" → RGB
  if (/^[\d.\s,%/]+$/.test(s)) return fromFunction('rgb', s);
  return null;
}

/** 이름 색 가운데 가장 가까운 것 (같은 색이 두 이름이면 앞의 것) */
export function nameOf(hex: string): string | null {
  const h = hex.replace('#', '').toLowerCase();
  for (const [n, v] of NAMES) if (v === h) return n;
  return null;
}
