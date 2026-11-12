// 주석(도형) 모델. 좌표는 모두 이미지 픽셀 기준이며, 내보낼 때까지 벡터로 유지된다.

export type Tool =
  | 'select'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'pen'
  | 'marker'
  | 'text'
  | 'step'
  | 'mosaic'
  | 'blur'
  | 'crop';

export type Fill = 'none' | 'soft' | 'solid';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoxShape extends Rect {
  id: string;
  type: 'rect' | 'ellipse';
  color: string;
  width: number;
  fill: Fill;
}
export interface LineShape {
  id: string;
  type: 'line' | 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}
export interface PathShape {
  id: string;
  type: 'pen' | 'marker';
  /** x0, y0, x1, y1, ... */
  points: number[];
  color: string;
  width: number;
}
export interface TextShape {
  id: string;
  type: 'text';
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  boxed: boolean;
}
export interface StepShape {
  id: string;
  type: 'step';
  x: number;
  y: number;
  n: number;
  color: string;
  size: number;
}
export interface HideShape extends Rect {
  id: string;
  type: 'mosaic' | 'blur';
  strength: number;
}
export interface ImageShape extends Rect {
  id: string;
  type: 'image';
  source: HTMLCanvasElement;
}

export type Shape = BoxShape | LineShape | PathShape | TextShape | StepShape | HideShape | ImageShape;
export type RectLike = BoxShape | HideShape | ImageShape;

export const isRectLike = (s: Shape): s is RectLike =>
  s.type === 'rect' || s.type === 'ellipse' || s.type === 'mosaic' || s.type === 'blur' || s.type === 'image';
export const isLine = (s: Shape): s is LineShape => s.type === 'line' || s.type === 'arrow';
export const isPath = (s: Shape): s is PathShape => s.type === 'pen' || s.type === 'marker';

export const FONT_STACK = `-apple-system, BlinkMacSystemFont, 'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', 'Segoe UI', system-ui, sans-serif`;
const LINE_HEIGHT = 1.3;

export const newId = () => Math.random().toString(36).slice(2, 10);

export function cloneShape<T extends Shape>(s: T): T {
  // 이미지 원본(canvas)은 바뀌지 않으므로 참조만 복사한다
  return isPath(s) ? { ...s, points: s.points.slice() } : { ...s };
}

export function normRect(r: Rect): Rect {
  return { x: r.w < 0 ? r.x + r.w : r.x, y: r.h < 0 ? r.y + r.h : r.y, w: Math.abs(r.w), h: Math.abs(r.h) };
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

export function textFont(size: number): string {
  return `650 ${size}px ${FONT_STACK}`;
}

export function textMetrics(s: TextShape): { w: number; h: number; pad: number; lines: string[] } {
  const g = measurer();
  g.font = textFont(s.size);
  const lines = s.text.split('\n');
  let w = 0;
  for (const l of lines) w = Math.max(w, g.measureText(l || ' ').width);
  const pad = s.boxed ? s.size * 0.38 : 0;
  return { w: w + pad * 2, h: lines.length * s.size * LINE_HEIGHT + pad * 2, pad, lines };
}

export function stepRadius(s: StepShape): number {
  return s.size * 0.72;
}

export function bounds(s: Shape): Rect {
  if (isRectLike(s)) return normRect(s);
  if (isLine(s)) return normRect({ x: s.x1, y: s.y1, w: s.x2 - s.x1, h: s.y2 - s.y1 });
  if (isPath(s)) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < s.points.length; i += 2) {
      x0 = Math.min(x0, s.points[i]);
      x1 = Math.max(x1, s.points[i]);
      y0 = Math.min(y0, s.points[i + 1]);
      y1 = Math.max(y1, s.points[i + 1]);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  if (s.type === 'text') {
    const m = textMetrics(s);
    return { x: s.x, y: s.y, w: m.w, h: m.h };
  }
  const r = stepRadius(s);
  return { x: s.x - r, y: s.y - r, w: r * 2, h: r * 2 };
}

export function moveShape(s: Shape, dx: number, dy: number): void {
  if (isLine(s)) {
    s.x1 += dx;
    s.y1 += dy;
    s.x2 += dx;
    s.y2 += dy;
  } else if (isPath(s)) {
    for (let i = 0; i < s.points.length; i += 2) {
      s.points[i] += dx;
      s.points[i + 1] += dy;
    }
  } else {
    s.x += dx;
    s.y += dy;
  }
}

/** 이미지 크기를 바꿀 때 도형도 함께 늘이고 줄인다 */
export function scaleShape(s: Shape, sx: number, sy: number): void {
  const k = Math.sqrt(sx * sy);
  if (isLine(s)) {
    s.x1 *= sx;
    s.x2 *= sx;
    s.y1 *= sy;
    s.y2 *= sy;
    s.width *= k;
  } else if (isPath(s)) {
    for (let i = 0; i < s.points.length; i += 2) {
      s.points[i] *= sx;
      s.points[i + 1] *= sy;
    }
    s.width *= k;
  } else if (isRectLike(s)) {
    s.x *= sx;
    s.y *= sy;
    s.w *= sx;
    s.h *= sy;
    if (s.type === 'rect' || s.type === 'ellipse') s.width *= k;
    if (s.type === 'mosaic' || s.type === 'blur') s.strength = Math.max(2, s.strength * k);
  } else {
    s.x *= sx;
    s.y *= sy;
    s.size *= k;
  }
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

const inRect = (r: Rect, x: number, y: number, m = 0) => x >= r.x - m && x <= r.x + r.w + m && y >= r.y - m && y <= r.y + r.h + m;

/** tol: 화면에서 몇 픽셀까지 봐줄지를 이미지 픽셀로 환산한 값 */
export function hitTest(s: Shape, x: number, y: number, tol: number): boolean {
  if (isLine(s)) return distToSegment(x, y, s.x1, s.y1, s.x2, s.y2) <= tol + s.width / 2 + (s.type === 'arrow' ? s.width : 0);
  if (isPath(s)) {
    const m = tol + s.width / 2;
    if (!inRect(bounds(s), x, y, m)) return false;
    const p = s.points;
    if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= m;
    for (let i = 0; i + 3 < p.length; i += 2) if (distToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= m) return true;
    return false;
  }
  const b = bounds(s);
  if (s.type === 'rect' || s.type === 'ellipse') {
    const m = tol + s.width / 2;
    if (!inRect(b, x, y, m)) return false;
    if (s.fill !== 'none') return true;
    if (s.type === 'rect') return !inRect({ x: b.x + m, y: b.y + m, w: b.w - 2 * m, h: b.h - 2 * m }, x, y) || b.w < 2 * m || b.h < 2 * m;
    // 타원: 테두리 근처만
    const rx = b.w / 2;
    const ry = b.h / 2;
    if (rx < m || ry < m) return true;
    const nx = (x - b.x - rx) / rx;
    const ny = (y - b.y - ry) / ry;
    const d = Math.hypot(nx, ny);
    return Math.abs(d - 1) * Math.min(rx, ry) <= m;
  }
  if (s.type === 'step') return Math.hypot(x - s.x, y - s.y) <= stepRadius(s) + tol;
  return inRect(b, x, y, tol);
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
export const contrastOn = (hex: string) => (luminance(hex) > 0.62 ? '#111111' : '#ffffff');

function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
export { roundRectPath };

const scratch = new Map<string, HTMLCanvasElement>();
function scratchCanvas(key: string, w: number, h: number): HTMLCanvasElement {
  let c = scratch.get(key);
  if (!c) scratch.set(key, (c = document.createElement('canvas')));
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

interface HideCache {
  key: string;
  canvas: HTMLCanvasElement;
}
const hideCache = new WeakMap<HideShape, HideCache>();

/** 가릴 영역의 결과 이미지를 만든다. 원본 이미지에서 해당 영역만 떼어 처리한다. */
function renderHidden(s: HideShape, base: HTMLCanvasElement, baseRev: number): { canvas: HTMLCanvasElement; r: Rect } | null {
  const b = normRect(s);
  const x = Math.max(0, Math.round(b.x));
  const y = Math.max(0, Math.round(b.y));
  const w = Math.min(base.width, Math.round(b.x + b.w)) - x;
  const h = Math.min(base.height, Math.round(b.y + b.h)) - y;
  if (w < 1 || h < 1) return null;
  const r = { x, y, w, h };
  const key = `${baseRev}:${s.type}:${x},${y},${w},${h}:${s.strength}`;
  const hit = hideCache.get(s);
  if (hit && hit.key === key) return { canvas: hit.canvas, r };

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = out.getContext('2d')!;
  if (s.type === 'mosaic') {
    const cell = Math.max(2, s.strength);
    const sw = Math.max(1, Math.round(w / cell));
    const sh = Math.max(1, Math.round(h / cell));
    // 절반씩 줄여 가며 평균을 내야 칸마다 색이 고르게 나온다
    const small = shrink(base, r, sw, sh);
    g.imageSmoothingEnabled = false;
    g.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
  } else {
    const f = Math.max(2, s.strength);
    const sw = Math.max(1, Math.round(w / f));
    const sh = Math.max(1, Math.round(h / f));
    const small = shrink(base, r, sw, sh);
    // 다시 키울 때는 두 배씩 부드럽게 늘려 번진 느낌을 만든다
    let cur: HTMLCanvasElement = small;
    let cw = sw;
    let ch = sh;
    let i = 0;
    while (cw * 2 < w || ch * 2 < h) {
      const nw = Math.min(w, cw * 2);
      const nh = Math.min(h, ch * 2);
      const next = scratchCanvas(`up${i++ % 2}`, nw, nh);
      const ng = next.getContext('2d')!;
      ng.imageSmoothingEnabled = true;
      ng.imageSmoothingQuality = 'high';
      ng.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
      cur = next;
      cw = nw;
      ch = nh;
    }
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, cw, ch, 0, 0, w, h);
  }
  hideCache.set(s, { key, canvas: out });
  return { canvas: out, r };
}

function shrink(base: HTMLCanvasElement, r: Rect, tw: number, th: number): HTMLCanvasElement {
  let cw = r.w;
  let ch = r.h;
  let cur: HTMLCanvasElement = base;
  let sx = r.x;
  let sy = r.y;
  let i = 0;
  for (;;) {
    const nw = Math.max(tw, Math.ceil(cw / 2));
    const nh = Math.max(th, Math.ceil(ch / 2));
    const next = scratchCanvas(`down${i++ % 2}`, nw, nh);
    const g = next.getContext('2d')!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, sx, sy, cw, ch, 0, 0, nw, nh);
    cur = next;
    sx = sy = 0;
    cw = nw;
    ch = nh;
    if (cw <= tw && ch <= th) return cur;
  }
}

export interface DrawEnv {
  /** 보정이 적용된 바탕 이미지 */
  base: HTMLCanvasElement;
  baseRev: number;
}

export function drawShape(g: CanvasRenderingContext2D, s: Shape, env: DrawEnv): void {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  switch (s.type) {
    case 'rect':
    case 'ellipse': {
      const b = normRect(s);
      g.beginPath();
      if (s.type === 'rect') roundRectPath(g, b.x, b.y, b.w, b.h, Math.min(s.width * 0.9, 6));
      else g.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
      if (s.fill !== 'none') {
        g.globalAlpha = s.fill === 'soft' ? 0.22 : 1;
        g.fillStyle = s.color;
        g.fill();
        g.globalAlpha = 1;
      }
      if (s.fill !== 'solid') {
        g.strokeStyle = s.color;
        g.lineWidth = s.width;
        g.stroke();
      }
      break;
    }
    case 'line':
    case 'arrow': {
      g.strokeStyle = s.color;
      g.fillStyle = s.color;
      g.lineWidth = s.width;
      const dx = s.x2 - s.x1;
      const dy = s.y2 - s.y1;
      const len = Math.hypot(dx, dy);
      if (s.type === 'line' || len < 1) {
        g.beginPath();
        g.moveTo(s.x1, s.y1);
        g.lineTo(s.x2, s.y2);
        g.stroke();
        break;
      }
      const ux = dx / len;
      const uy = dy / len;
      const head = Math.min(len * 0.6, Math.max(12, s.width * 4.2));
      const half = head * 0.42;
      // 몸통은 화살촉 안쪽에서 끝나야 끝이 뭉툭해지지 않는다
      const bx = s.x2 - ux * head * 0.8;
      const by = s.y2 - uy * head * 0.8;
      g.beginPath();
      g.moveTo(s.x1, s.y1);
      g.lineTo(bx, by);
      g.stroke();
      const hx = s.x2 - ux * head;
      const hy = s.y2 - uy * head;
      g.beginPath();
      g.moveTo(s.x2, s.y2);
      g.lineTo(hx - uy * half, hy + ux * half);
      g.lineTo(hx + uy * half, hy - ux * half);
      g.closePath();
      g.lineJoin = 'round';
      g.lineWidth = Math.min(s.width * 0.5, 3);
      g.fill();
      g.stroke();
      break;
    }
    case 'pen':
    case 'marker': {
      const p = s.points;
      if (p.length < 2) break;
      g.strokeStyle = s.color;
      g.lineWidth = s.width;
      if (s.type === 'marker') {
        g.globalAlpha = 0.4;
        g.lineCap = 'butt';
      }
      g.beginPath();
      g.moveTo(p[0], p[1]);
      if (p.length === 2) g.lineTo(p[0] + 0.01, p[1]);
      else if (p.length === 4) g.lineTo(p[2], p[3]);
      else {
        // 중간점을 잇는 2차 곡선으로 손떨림을 부드럽게
        for (let i = 2; i + 3 < p.length; i += 2) {
          const mx = (p[i] + p[i + 2]) / 2;
          const my = (p[i + 1] + p[i + 3]) / 2;
          g.quadraticCurveTo(p[i], p[i + 1], mx, my);
        }
        g.lineTo(p[p.length - 2], p[p.length - 1]);
      }
      g.stroke();
      break;
    }
    case 'text': {
      const m = textMetrics(s);
      g.font = textFont(s.size);
      g.textBaseline = 'middle';
      if (s.boxed) {
        roundRectPath(g, s.x, s.y, m.w, m.h, s.size * 0.3);
        g.fillStyle = s.color;
        g.fill();
        g.fillStyle = contrastOn(s.color);
      } else {
        // 어떤 배경 위에서도 읽히도록 반대색 외곽선을 두른다
        g.strokeStyle = contrastOn(s.color);
        g.lineWidth = Math.max(2, s.size / 7);
        g.fillStyle = s.color;
      }
      m.lines.forEach((line, i) => {
        const x = s.x + m.pad;
        const y = s.y + m.pad + (i + 0.5) * s.size * LINE_HEIGHT;
        if (!s.boxed) g.strokeText(line, x, y);
        g.fillText(line, x, y);
      });
      break;
    }
    case 'step': {
      const r = stepRadius(s);
      g.beginPath();
      g.arc(s.x, s.y, r, 0, Math.PI * 2);
      g.fillStyle = s.color;
      g.shadowColor = 'rgba(0,0,0,0.3)';
      g.shadowBlur = r * 0.25;
      g.shadowOffsetY = r * 0.08;
      g.fill();
      g.shadowColor = 'transparent';
      g.lineWidth = Math.max(1.5, r * 0.12);
      g.strokeStyle = contrastOn(s.color);
      g.stroke();
      g.fillStyle = contrastOn(s.color);
      const label = String(s.n);
      g.font = `750 ${s.size * (label.length > 2 ? 0.62 : 0.85)}px ${FONT_STACK}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, s.x, s.y + s.size * 0.04);
      break;
    }
    case 'mosaic':
    case 'blur': {
      const res = renderHidden(s, env.base, env.baseRev);
      if (res) {
        g.imageSmoothingEnabled = s.type === 'blur';
        g.drawImage(res.canvas, res.r.x, res.r.y);
      }
      break;
    }
    case 'image': {
      const b = normRect(s);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(s.source, b.x, b.y, b.w, b.h);
      break;
    }
  }
  g.restore();
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'p1' | 'p2';

export function handlePoints(s: Shape): { h: Handle; x: number; y: number }[] {
  if (isLine(s)) return [
    { h: 'p1', x: s.x1, y: s.y1 },
    { h: 'p2', x: s.x2, y: s.y2 },
  ];
  if (!isRectLike(s)) return [];
  return rectHandles(normRect(s));
}

export function rectHandles(b: Rect): { h: Handle; x: number; y: number }[] {
  const { x, y, w, h } = b;
  return [
    { h: 'nw', x, y },
    { h: 'n', x: x + w / 2, y },
    { h: 'ne', x: x + w, y },
    { h: 'e', x: x + w, y: y + h / 2 },
    { h: 'se', x: x + w, y: y + h },
    { h: 's', x: x + w / 2, y: y + h },
    { h: 'sw', x, y: y + h },
    { h: 'w', x, y: y + h / 2 },
  ];
}

/** 핸들을 (px, py) 로 끌었을 때의 새 사각형. aspect 가 주어지면 그 비율(w/h)을 지킨다. */
export function resizeRect(orig: Rect, handle: Handle, px: number, py: number, aspect: number | null): Rect {
  let x0 = orig.x;
  let y0 = orig.y;
  let x1 = orig.x + orig.w;
  let y1 = orig.y + orig.h;
  if (handle.includes('w')) x0 = px;
  if (handle.includes('e')) x1 = px;
  if (handle.includes('n')) y0 = py;
  if (handle.includes('s')) y1 = py;
  if (aspect) {
    let w = x1 - x0;
    let h = y1 - y0;
    const corner = handle.length === 2;
    if (corner) {
      // 더 많이 움직인 쪽을 기준으로 맞춘다
      if (Math.abs(w) / aspect > Math.abs(h)) h = (Math.abs(w) / aspect) * Math.sign(h || 1);
      else w = Math.abs(h) * aspect * Math.sign(w || 1);
      if (handle.includes('w')) x0 = x1 - w;
      else x1 = x0 + w;
      if (handle.includes('n')) y0 = y1 - h;
      else y1 = y0 + h;
    } else if (handle === 'n' || handle === 's') {
      const nw = Math.abs(h) * aspect;
      const cx = orig.x + orig.w / 2;
      x0 = cx - nw / 2;
      x1 = cx + nw / 2;
    } else {
      const nh = Math.abs(w) / aspect;
      const cy = orig.y + orig.h / 2;
      y0 = cy - nh / 2;
      y1 = cy + nh / 2;
    }
  }
  return normRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

export const HANDLE_CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  p1: 'move',
  p2: 'move',
};
