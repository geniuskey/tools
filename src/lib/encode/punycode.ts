// Punycode (RFC 3492) — 한글 도메인 ↔ xn--… 을 직접 바꾼다.

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, points: number, first: boolean): number {
  delta = first ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / points);
  let k = 0;
  while (delta > ((BASE - TMIN) * TMAX) >> 1) {
    delta = Math.floor(delta / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * delta) / (delta + SKEW));
}

const digit = (d: number) => String.fromCharCode(d < 26 ? 97 + d : 22 + d);
function value(c: number): number {
  if (c >= 48 && c <= 57) return c - 22;
  if (c >= 65 && c <= 90) return c - 65;
  if (c >= 97 && c <= 122) return c - 97;
  return -1;
}

/** xn-- 를 뗀 한 토막을 푼다. 꼴이 틀리면 null */
export function punyDecode(input: string): string | null {
  const out: number[] = [];
  const cut = input.lastIndexOf('-');
  for (let i = 0; i < Math.max(cut, 0); i++) {
    const c = input.charCodeAt(i);
    if (c >= 128) return null;
    out.push(c);
  }
  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;
  for (let pos = cut > 0 ? cut + 1 : 0; pos < input.length; ) {
    const old = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (pos >= input.length) return null;
      const d = value(input.charCodeAt(pos++));
      if (d < 0) return null;
      i += d * w;
      if (i > 0x7fffffff) return null;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (d < t) break;
      w *= BASE - t;
    }
    bias = adapt(i - old, out.length + 1, old === 0);
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

/** 한 토막을 Punycode 로 (xn-- 는 붙이지 않는다) */
export function punyEncode(input: string): string {
  const points = Array.from(input, (ch) => ch.codePointAt(0)!);
  let out = points.filter((c) => c < 128).map((c) => String.fromCharCode(c)).join('');
  const basic = out.length;
  let done = basic;
  if (basic) out += '-';
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  while (done < points.length) {
    let m = Infinity;
    for (const c of points) if (c >= n && c < m) m = c;
    delta += (m - n) * (done + 1);
    n = m;
    for (const c of points) {
      if (c < n) delta++;
      if (c === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
          if (q < t) break;
          out += digit(t + ((q - t) % (BASE - t)));
          q = Math.floor((q - t) / (BASE - t));
        }
        out += digit(q);
        bias = adapt(delta, done + 1, done === basic);
        delta = 0;
        done++;
      }
    }
    delta++;
    n++;
  }
  return out;
}

/** xn--… 토막이 든 도메인을 사람이 읽는 꼴로. 바꿀 것이 없거나 틀렸으면 null */
export function toUnicode(domain: string): string | null {
  let changed = false;
  const labels = domain.split('.').map((label) => {
    if (!/^xn--/i.test(label)) return label;
    const decoded = punyDecode(label.slice(4));
    if (decoded == null) return null;
    changed = true;
    return decoded;
  });
  return changed && !labels.includes(null) ? labels.join('.') : null;
}

/** 한글 도메인을 xn--… 꼴로. 도메인에 쓸 수 없는 글자가 있으면 null */
export function toAscii(domain: string): string | null {
  const labels = domain.normalize('NFC').toLowerCase().split(/[.。]/);
  if (labels.some((l, i) => !l && i < labels.length - 1) || /[\s/?#@:]/.test(domain)) return null;
  return labels.map((l) => (/[^\x00-\x7f]/.test(l) ? 'xn--' + punyEncode(l) : l)).join('.');
}
