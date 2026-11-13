// 색상 · 대비 도구의 상태. 탭(대비 · 변환 · 팔레트 · 사진)이 같이 쓰고, 통째로 저장한다.
import { toHex } from './format';
import { parseColor } from './parse';
import { CVDS, type Cvd } from './cvd';
import { EXPORTS, HARMONIES, type ExportKind, type Harmony } from './palette';
import { LEVELS, type Level } from './contrast';
import { rgb, type Rgb } from './space';

export type Mode = 'contrast' | 'convert' | 'palette' | 'picker';
export type Target = 'fg' | 'bg' | 'base';
export const MODES: [Mode, string][] = [
  ['contrast', '대비'],
  ['convert', '변환'],
  ['palette', '팔레트'],
  ['picker', '사진'],
];
export const TARGET_NAMES: Record<Target, string> = { fg: '글자 색', bg: '배경 색', base: '기준 색' };

const RECENT_MAX = 16;
const SAVED_MAX = 48;
const isColor = (v: unknown): v is string => typeof v === 'string' && v.length <= 200 && parseColor(v) != null;
const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v);

class ColorState {
  mode = $state<Mode>('contrast');
  toast = $state('');

  fg = $state('#e8590c');
  bg = $state('#ffffff');
  base = $state('#c2255c');
  /** 최근 색 · 사진에서 따온 색이 들어갈 곳 */
  target = $state<Target>('fg');
  goal = $state<Level['id']>('aa');
  cvd = $state<Cvd>('none');

  paletteName = $state('brand');
  exportKind = $state<ExportKind>('css');
  harmony = $state<Harmony>('complement');

  recent = $state<string[]>([]);
  saved = $state<string[]>([]);
  sample = $state<1 | 3 | 5>(1);
  /** 사진 탭에 띄울 그림 (저장하지 않는다) */
  image = $state.raw<{ blob: Blob; name: string } | null>(null);

  fgColor = $derived<Rgb>(parseColor(this.fg)?.color ?? rgb(0, 0, 0));
  bgColor = $derived<Rgb>(parseColor(this.bg)?.color ?? rgb(1, 1, 1));
  baseColor = $derived<Rgb>(parseColor(this.base)?.color ?? rgb(0.5, 0.5, 0.5));
  level = $derived(LEVELS.find((l) => l.id === this.goal)!);

  say(msg: string) {
    this.toast = msg;
    setTimeout(() => this.toast === msg && (this.toast = ''), 2200);
  }
  async copy(text: string, what = text) {
    try {
      await navigator.clipboard.writeText(text);
      this.say(`${what} 복사했습니다`);
    } catch {
      this.say('복사하지 못했습니다');
    }
  }

  /** 색을 한 곳에 넣고 최근 색에 남긴다 */
  set(target: Target, value: string) {
    this[target] = value;
    this.remember(value);
  }
  remember(value: string) {
    const p = parseColor(value);
    if (!p) return;
    const hex = toHex(p.color);
    this.recent = [hex, ...this.recent.filter((h) => h !== hex)].slice(0, RECENT_MAX);
  }
  toggleSaved(value: string) {
    const p = parseColor(value);
    if (!p) return;
    const hex = toHex(p.color);
    if (this.saved.includes(hex)) {
      this.saved = this.saved.filter((h) => h !== hex);
      this.say(`${hex} 를 모아 둔 색에서 뺐습니다`);
    } else {
      this.saved = [...this.saved, hex].slice(-SAVED_MAX);
      this.say(`${hex} 를 모아 두었습니다`);
    }
  }
  swap() {
    [this.fg, this.bg] = [this.bg, this.fg];
  }

  snapshot() {
    const { mode, fg, bg, base, target, goal, cvd, paletteName, exportKind, harmony, sample } = this;
    return { mode, fg, bg, base, target, goal, cvd, paletteName, exportKind, harmony, sample, recent: $state.snapshot(this.recent), saved: $state.snapshot(this.saved) };
  }
  restore(s: Record<string, any>) {
    if (MODES.some((m) => m[0] === s.mode)) this.mode = s.mode;
    if (isColor(s.fg)) this.fg = s.fg;
    if (isColor(s.bg)) this.bg = s.bg;
    if (isColor(s.base)) this.base = s.base;
    if (['fg', 'bg', 'base'].includes(s.target)) this.target = s.target;
    if (LEVELS.some((l) => l.id === s.goal)) this.goal = s.goal;
    if (CVDS.some((c) => c[0] === s.cvd)) this.cvd = s.cvd;
    if (typeof s.paletteName === 'string') this.paletteName = s.paletteName.slice(0, 40);
    if (EXPORTS.some((e) => e[0] === s.exportKind)) this.exportKind = s.exportKind;
    if (HARMONIES.some((h) => h[0] === s.harmony)) this.harmony = s.harmony;
    if ([1, 3, 5].includes(s.sample)) this.sample = s.sample;
    if (Array.isArray(s.recent)) this.recent = [...new Set(s.recent.filter(isHex))].slice(0, RECENT_MAX) as string[];
    if (Array.isArray(s.saved)) this.saved = [...new Set(s.saved.filter(isHex))].slice(0, SAVED_MAX) as string[];
  }
}

export const st = new ColorState();
