// 이미지 편집기의 상태와 동작. 화면(svelte)은 여기 있는 반응형 필드를 읽고 메서드를 부르기만 한다.
import {
  HANDLE_CURSOR,
  bounds,
  cloneShape,
  drawShape,
  handlePoints,
  hitTest,
  isLine,
  isPath,
  isRectLike,
  moveShape,
  newId,
  normRect,
  rectHandles,
  resizeRect,
  roundRectPath,
  scaleShape,
  type Fill,
  type Handle,
  type Rect,
  type Shape,
  type TextShape,
  type Tool,
} from './shapes';
import {
  NO_ADJUST,
  adjustCanvas,
  cropCanvas,
  flipCanvas,
  makeCanvas,
  resizeCanvas,
  rotateCanvas,
  type Adjust,
} from './raster';

export interface Style {
  color: string;
  width: number;
  fill: Fill;
  fontSize: number;
  boxed: boolean;
  strength: number;
}

export interface Frame {
  enabled: boolean;
  padding: number;
  radius: number;
  shadow: number;
  bg: string;
}

export interface Background {
  id: string;
  name: string;
  stops: string[];
}

export const BACKGROUNDS: Background[] = [
  { id: 'dusk', name: '노을', stops: ['#ff9a8b', '#ff6a88', '#6a5af9'] },
  { id: 'ocean', name: '바다', stops: ['#4facfe', '#2563eb', '#1e1b6a'] },
  { id: 'mint', name: '민트', stops: ['#a8edea', '#5eead4', '#22a39f'] },
  { id: 'peach', name: '복숭아', stops: ['#ffecd2', '#fcb69f'] },
  { id: 'grape', name: '포도', stops: ['#c471f5', '#7048e8', '#3b2a8c'] },
  { id: 'forest', name: '숲', stops: ['#d4fc79', '#56ab2f', '#1f6f43'] },
  { id: 'slate', name: '슬레이트', stops: ['#cfd9df', '#8e9eab'] },
  { id: 'night', name: '밤', stops: ['#3a3d4a', '#15161c'] },
  { id: 'white', name: '흰색', stops: ['#ffffff'] },
  { id: 'black', name: '검정', stops: ['#101114'] },
  { id: 'none', name: '투명', stops: [] },
];

export const COLORS = ['#e03131', '#f76707', '#f5c400', '#2f9e44', '#1c7ed6', '#7048e8', '#111111', '#ffffff'];

interface Snapshot {
  base: HTMLCanvasElement;
  shapes: Shape[];
  adjust: Adjust;
  frame: Frame;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number }
  | { kind: 'draw'; shape: Shape; ox: number; oy: number }
  | { kind: 'move'; shape: Shape; lx: number; ly: number; moved: boolean }
  | { kind: 'handle'; shape: Shape; handle: Handle; orig: Shape; moved: boolean }
  | { kind: 'crop-new'; ox: number; oy: number }
  | { kind: 'crop-move'; lx: number; ly: number }
  | { kind: 'crop-handle'; handle: Handle; orig: Rect };

export interface EditingText {
  id: string;
  left: number;
  top: number;
  fontSize: number;
  color: string;
  boxed: boolean;
  text: string;
}

const HANDLE_PX = 9;
const MAX_HISTORY = 60;

export class Editor {
  // ── 화면이 읽는 상태 ──
  tool = $state<Tool>('select');
  selectedId = $state<string | null>(null);
  hasImage = $state(false);
  width = $state(0);
  height = $state(0);
  zoom = $state(1);
  /** 도형이 바뀔 때마다 올라가는 번호. 화면이 다시 계산해야 할 때를 알려준다. */
  rev = $state(0);
  canUndo = $state(false);
  canRedo = $state(false);
  style = $state<Style>({ color: COLORS[0], width: 4, fill: 'none', fontSize: 28, boxed: false, strength: 12 });
  adjust = $state<Adjust>({ ...NO_ADJUST });
  frame = $state<Frame>({ enabled: false, padding: 64, radius: 12, shadow: 40, bg: 'dusk' });
  crop = $state<Rect | null>(null);
  cropAspect = $state<number | null>(null);
  editing = $state<EditingText | null>(null);
  cursor = $state('default');
  toast = $state('');
  name = $state('image');

  // ── 내부 상태 ──
  private base: HTMLCanvasElement | null = null;
  private adjusted: HTMLCanvasElement | null = null;
  private adjustDirty = true;
  private baseRev = 0;
  private shapes: Shape[] = [];
  private history: Snapshot[] = [];
  private hIndex = -1;
  private canvas: HTMLCanvasElement | null = null;
  private panX = 0;
  private panY = 0;
  private drag: Drag | null = null;
  private raf = 0;
  private toastTimer = 0;
  /** 화면에 맞춘 상태인지. 그렇다면 창 크기가 바뀔 때 다시 맞춘다. */
  private fitted = true;
  private accent = '#6741d9';
  private checker: CanvasPattern | null = null;
  spaceDown = false;

  // ── 연결 ──
  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.accent = getComputedStyle(canvas).getPropertyValue('--app').trim() || this.accent;
    this.resizeView();
  }

  detach() {
    cancelAnimationFrame(this.raf);
    this.canvas = null;
  }

  resizeView() {
    const c = this.canvas;
    if (!c) return;
    const dpr = devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      if (this.fitted && !this.drag) this.fit();
    }
    this.requestRender();
  }

  say(msg: string) {
    this.toast = msg;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast = ''), 2200);
  }

  get selected(): Shape | null {
    void this.rev;
    const id = this.selectedId;
    return id ? (this.shapes.find((s) => s.id === id) ?? null) : null;
  }

  get shapeCount(): number {
    void this.rev;
    return this.shapes.length;
  }

  private get pad(): number {
    return this.frame.enabled ? this.frame.padding : 0;
  }

  // ── 문서 ──
  load(canvas: HTMLCanvasElement, name = 'image') {
    this.base = canvas;
    this.shapes = [];
    this.adjust = { ...NO_ADJUST };
    this.selectedId = null;
    this.crop = null;
    this.editing = null;
    this.name = name.replace(/\.[^.]+$/, '') || 'image';
    this.hasImage = true;
    this.syncSize();
    // 이미지 크기에 맞는 기본 굵기 (4K 캡처에서 2px 선은 보이지 않는다)
    const long = Math.max(canvas.width, canvas.height);
    this.style.width = Math.max(3, Math.round(long / 320));
    this.style.fontSize = Math.max(18, Math.round(long / 48));
    this.style.strength = Math.max(8, Math.round(long / 140));
    if (this.tool === 'crop') this.tool = 'select';
    this.history = [];
    this.hIndex = -1;
    this.commit();
    this.fit();
  }

  /** 이미 이미지가 열려 있을 때 붙여넣은 이미지는 위에 얹는 조각으로 추가한다 */
  addImage(source: HTMLCanvasElement) {
    if (!this.base) return this.load(source);
    const scale = Math.min(1, (this.width * 0.8) / source.width, (this.height * 0.8) / source.height);
    const w = source.width * scale;
    const h = source.height * scale;
    const shape: Shape = { id: newId(), type: 'image', source, x: (this.width - w) / 2, y: (this.height - h) / 2, w, h };
    this.shapes.push(shape);
    this.tool = 'select';
    this.selectedId = shape.id;
    this.commit();
  }

  close() {
    this.base = null;
    this.adjusted = null;
    this.shapes = [];
    this.history = [];
    this.hIndex = -1;
    this.hasImage = false;
    this.selectedId = null;
    this.crop = null;
    this.canUndo = this.canRedo = false;
    this.rev++;
    this.requestRender();
  }

  private syncSize() {
    this.width = this.base?.width ?? 0;
    this.height = this.base?.height ?? 0;
    this.adjustDirty = true;
  }

  // ── 실행 취소 ──
  private snapshot(): Snapshot {
    return {
      base: this.base!,
      shapes: this.shapes.map(cloneShape),
      adjust: { ...$state.snapshot(this.adjust) },
      frame: { ...$state.snapshot(this.frame) },
    };
  }

  commit() {
    if (!this.base) return;
    this.history.length = this.hIndex + 1;
    this.history.push(this.snapshot());
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.hIndex = this.history.length - 1;
    this.touch();
  }

  private touch() {
    this.canUndo = this.hIndex > 0;
    this.canRedo = this.hIndex < this.history.length - 1;
    this.rev++;
    this.requestRender();
  }

  private restore(s: Snapshot) {
    this.base = s.base;
    this.shapes = s.shapes.map(cloneShape);
    this.adjust = { ...s.adjust };
    this.frame = { ...s.frame };
    this.syncSize();
    if (this.selectedId && !this.shapes.some((x) => x.id === this.selectedId)) this.selectedId = null;
    this.crop = null;
    if (this.tool === 'crop') this.tool = 'select';
    this.touch();
  }

  undo() {
    if (this.hIndex <= 0) return;
    this.restore(this.history[--this.hIndex]);
  }

  redo() {
    if (this.hIndex >= this.history.length - 1) return;
    this.restore(this.history[++this.hIndex]);
  }

  // ── 보기 ──
  private viewSize(): { w: number; h: number } {
    return { w: this.canvas?.clientWidth ?? 0, h: this.canvas?.clientHeight ?? 0 };
  }

  fit() {
    const { w, h } = this.viewSize();
    if (!this.base || !w || !h) return;
    const tw = this.width + this.pad * 2;
    const th = this.height + this.pad * 2;
    const margin = Math.min(48, w * 0.06);
    this.zoom = Math.min(1, (w - margin * 2) / tw, (h - margin * 2) / th);
    this.panX = (w - this.width * this.zoom) / 2;
    this.panY = (h - this.height * this.zoom) / 2;
    this.fitted = true;
    this.requestRender();
  }

  zoomTo(z: number, cx?: number, cy?: number) {
    const { w, h } = this.viewSize();
    cx ??= w / 2;
    cy ??= h / 2;
    z = Math.max(0.02, Math.min(32, z));
    const ix = (cx - this.panX) / this.zoom;
    const iy = (cy - this.panY) / this.zoom;
    this.zoom = z;
    this.panX = cx - ix * z;
    this.panY = cy - iy * z;
    this.fitted = false;
    this.endEdit();
    this.requestRender();
  }

  zoomBy(f: number) {
    this.zoomTo(this.zoom * f);
  }

  private toImage(e: { clientX: number; clientY: number }): { x: number; y: number; sx: number; sy: number } {
    const r = this.canvas!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom, sx, sy };
  }

  // ── 그리기 ──
  requestRender() {
    if (this.raf || !this.canvas) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private getAdjusted(): HTMLCanvasElement {
    if (this.adjustDirty || !this.adjusted) {
      this.adjusted = adjustCanvas(this.base!, $state.snapshot(this.adjust));
      this.adjustDirty = false;
      this.baseRev++;
    }
    return this.adjusted;
  }

  private paintBackground(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    const bg = BACKGROUNDS.find((b) => b.id === this.frame.bg) ?? BACKGROUNDS[0];
    if (bg.stops.length === 0) return;
    if (bg.stops.length === 1) g.fillStyle = bg.stops[0];
    else {
      const grad = g.createLinearGradient(x, y, x + w, y + h);
      bg.stops.forEach((c, i) => grad.addColorStop(i / (bg.stops.length - 1), c));
      g.fillStyle = grad;
    }
    g.fillRect(x, y, w, h);
  }

  /** 문서를 그린다. 화면과 내보내기가 같은 코드를 쓴다. scale 은 그림자 번짐을 맞추기 위한 현재 배율. */
  private renderDocument(g: CanvasRenderingContext2D, opts: { frame: boolean; screen: boolean; scale: number }) {
    const W = this.width;
    const H = this.height;
    const framed = opts.frame && this.frame.enabled;
    const radius = framed ? this.frame.radius : 0;
    if (framed) {
      const p = this.frame.padding;
      this.paintBackground(g, -p, -p, W + p * 2, H + p * 2);
      if (this.frame.shadow > 0) {
        g.save();
        g.shadowColor = 'rgba(0,0,0,0.42)';
        g.shadowBlur = this.frame.shadow * opts.scale;
        g.shadowOffsetY = this.frame.shadow * 0.35 * opts.scale;
        g.fillStyle = '#000';
        roundRectPath(g, 0, 0, W, H, radius);
        g.fill();
        g.restore();
      }
    }
    g.save();
    if (radius > 0) roundRectPath(g, 0, 0, W, H, radius);
    else {
      g.beginPath();
      g.rect(0, 0, W, H);
    }
    g.clip();
    if (framed && this.frame.shadow > 0) g.clearRect(0, 0, W, H);
    if (opts.screen) {
      // 투명한 부분을 알아볼 수 있게 바둑판을 깐다
      g.save();
      g.fillStyle = this.checkerPattern(g);
      g.scale(1 / opts.scale, 1 / opts.scale);
      g.fillRect(0, 0, W * opts.scale, H * opts.scale);
      g.restore();
    }
    const base = this.getAdjusted();
    g.imageSmoothingEnabled = !opts.screen || opts.scale < 3;
    g.imageSmoothingQuality = 'high';
    g.drawImage(base, 0, 0);
    const env = { base, baseRev: this.baseRev };
    const skip = opts.screen ? this.editing?.id : undefined;
    for (const s of this.shapes) if (s.id !== skip) drawShape(g, s, env);
    g.restore();
  }

  private checkerPattern(g: CanvasRenderingContext2D): CanvasPattern {
    if (!this.checker) {
      const c = makeCanvas(16, 16);
      const cg = c.getContext('2d')!;
      cg.fillStyle = '#fff';
      cg.fillRect(0, 0, 16, 16);
      cg.fillStyle = '#e3e5e9';
      cg.fillRect(0, 0, 8, 8);
      cg.fillRect(8, 8, 8, 8);
      this.checker = g.createPattern(c, 'repeat')!;
    }
    return this.checker;
  }

  private render() {
    const c = this.canvas;
    if (!c) return;
    const g = c.getContext('2d')!;
    const dpr = devicePixelRatio || 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    if (!this.base) return;

    g.setTransform(dpr * this.zoom, 0, 0, dpr * this.zoom, dpr * this.panX, dpr * this.panY);
    this.renderDocument(g, { frame: true, screen: true, scale: this.zoom * dpr });

    // 여기부터는 화면 좌표 (선택 표시는 배율과 무관하게 같은 굵기)
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.crop) this.renderCrop(g);
    else this.renderSelection(g);
  }

  private screenRect(r: Rect): Rect {
    return { x: r.x * this.zoom + this.panX, y: r.y * this.zoom + this.panY, w: r.w * this.zoom, h: r.h * this.zoom };
  }

  private drawHandle(g: CanvasRenderingContext2D, x: number, y: number, round = false) {
    g.beginPath();
    if (round) g.arc(x, y, 5, 0, Math.PI * 2);
    else g.rect(x - 4, y - 4, 8, 8);
    g.fillStyle = '#fff';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = this.accent;
    g.stroke();
  }

  private renderSelection(g: CanvasRenderingContext2D) {
    const s = this.shapes.find((x) => x.id === this.selectedId);
    if (!s || this.editing?.id === s.id) return;
    g.save();
    g.strokeStyle = this.accent;
    g.lineWidth = 1.5;
    if (!isLine(s)) {
      const b = this.screenRect(bounds(s));
      const m = isRectLike(s) ? 0 : 4;
      if (!isRectLike(s)) g.setLineDash([5, 4]);
      g.strokeRect(b.x - m, b.y - m, b.w + m * 2, b.h + m * 2);
      g.setLineDash([]);
    }
    for (const h of handlePoints(s)) this.drawHandle(g, h.x * this.zoom + this.panX, h.y * this.zoom + this.panY, isLine(s));
    g.restore();
  }

  private renderCrop(g: CanvasRenderingContext2D) {
    const { w, h } = this.viewSize();
    const r = this.screenRect(this.crop!);
    g.save();
    g.beginPath();
    g.rect(0, 0, w, h);
    g.rect(r.x, r.y, r.w, r.h);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fill('evenodd');
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    g.strokeRect(r.x, r.y, r.w, r.h);
    // 3등분 안내선
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    for (let i = 1; i < 3; i++) {
      g.moveTo(r.x + (r.w * i) / 3, r.y);
      g.lineTo(r.x + (r.w * i) / 3, r.y + r.h);
      g.moveTo(r.x, r.y + (r.h * i) / 3);
      g.lineTo(r.x + r.w, r.y + (r.h * i) / 3);
    }
    g.stroke();
    for (const hp of rectHandles(r)) this.drawHandle(g, hp.x, hp.y);
    g.restore();
  }

  // ── 포인터 ──
  private hitHandle(points: { h: Handle; x: number; y: number }[], sx: number, sy: number, screen = false): Handle | null {
    for (const p of points) {
      const x = screen ? p.x : p.x * this.zoom + this.panX;
      const y = screen ? p.y : p.y * this.zoom + this.panY;
      if (Math.abs(sx - x) <= HANDLE_PX && Math.abs(sy - y) <= HANDLE_PX) return p.h;
    }
    return null;
  }

  private topShapeAt(x: number, y: number): Shape | null {
    const tol = 6 / this.zoom;
    for (let i = this.shapes.length - 1; i >= 0; i--) if (hitTest(this.shapes[i], x, y, tol)) return this.shapes[i];
    return null;
  }

  private clampPoint(x: number, y: number) {
    return { x: Math.max(0, Math.min(this.width, x)), y: Math.max(0, Math.min(this.height, y)) };
  }

  pointerDown(e: PointerEvent) {
    if (!this.canvas) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.endEdit();
    const p = this.toImage(e);
    const pan = (): Drag => ({ kind: 'pan', sx: e.clientX, sy: e.clientY, px: this.panX, py: this.panY });
    if (e.button === 1 || this.spaceDown) {
      this.drag = pan();
      this.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0 || !this.base) return;

    if (this.tool === 'crop' && this.crop) {
      const h = this.hitHandle(rectHandles(this.crop), p.sx, p.sy);
      const c = this.crop;
      const full = c.w >= this.width - 0.5 && c.h >= this.height - 0.5;
      if (h) this.drag = { kind: 'crop-handle', handle: h, orig: { ...c } };
      // 아직 영역을 잡지 않았으면(전체 선택) 안쪽을 끌어도 새 영역을 그린다
      else if (!full && p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) this.drag = { kind: 'crop-move', lx: p.x, ly: p.y };
      else {
        const q = this.clampPoint(p.x, p.y);
        this.drag = { kind: 'crop-new', ox: q.x, oy: q.y };
      }
      return;
    }

    // 선택된 도형의 조절점은 어떤 도구에서든 잡을 수 있다
    const sel = this.shapes.find((s) => s.id === this.selectedId);
    if (sel) {
      const h = this.hitHandle(handlePoints(sel), p.sx, p.sy);
      if (h) {
        this.drag = { kind: 'handle', shape: sel, handle: h, orig: cloneShape(sel), moved: false };
        return;
      }
    }

    const st = this.style;
    switch (this.tool) {
      case 'select': {
        const hit = this.topShapeAt(p.x, p.y);
        if (hit) {
          this.select(hit);
          this.drag = { kind: 'move', shape: hit, lx: p.x, ly: p.y, moved: false };
        } else {
          this.selectedId = null;
          this.drag = pan();
          this.requestRender();
        }
        return;
      }
      case 'text': {
        const hit = this.topShapeAt(p.x, p.y);
        if (hit?.type === 'text') {
          this.select(hit);
          this.beginEdit(hit);
          return;
        }
        const shape: TextShape = { id: newId(), type: 'text', x: p.x, y: p.y - st.fontSize * 0.65, text: '', color: st.color, size: st.fontSize, boxed: st.boxed };
        this.shapes.push(shape);
        this.selectedId = shape.id;
        this.rev++;
        this.beginEdit(shape);
        return;
      }
      case 'step': {
        const used = this.shapes.filter((s) => s.type === 'step').map((s) => (s as { n: number }).n);
        const shape: Shape = { id: newId(), type: 'step', x: p.x, y: p.y, n: used.length ? Math.max(...used) + 1 : 1, color: st.color, size: st.fontSize };
        this.shapes.push(shape);
        this.selectedId = shape.id;
        this.commit();
        this.drag = { kind: 'move', shape, lx: p.x, ly: p.y, moved: false };
        return;
      }
      case 'rect':
      case 'ellipse':
        this.startDraw({ id: newId(), type: this.tool, x: p.x, y: p.y, w: 0, h: 0, color: st.color, width: st.width, fill: st.fill }, p);
        return;
      case 'mosaic':
      case 'blur':
        this.startDraw({ id: newId(), type: this.tool, x: p.x, y: p.y, w: 0, h: 0, strength: st.strength }, p);
        return;
      case 'line':
      case 'arrow':
        this.startDraw({ id: newId(), type: this.tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: st.color, width: st.width }, p);
        return;
      case 'pen':
        this.startDraw({ id: newId(), type: 'pen', points: [p.x, p.y], color: st.color, width: st.width }, p);
        return;
      case 'marker':
        this.startDraw({ id: newId(), type: 'marker', points: [p.x, p.y], color: st.color, width: Math.max(st.width * 4, st.fontSize * 0.9) }, p);
        return;
    }
  }

  private startDraw(shape: Shape, p: { x: number; y: number }) {
    this.shapes.push(shape);
    this.selectedId = null;
    this.drag = { kind: 'draw', shape, ox: p.x, oy: p.y };
  }

  private snapAngle(ox: number, oy: number, x: number, y: number) {
    const len = Math.hypot(x - ox, y - oy);
    const a = Math.round(Math.atan2(y - oy, x - ox) / (Math.PI / 4)) * (Math.PI / 4);
    return { x: ox + Math.cos(a) * len, y: oy + Math.sin(a) * len };
  }

  pointerMove(e: PointerEvent) {
    if (!this.canvas) return;
    const p = this.toImage(e);
    const d = this.drag;
    if (!d) {
      this.updateCursor(p);
      return;
    }
    switch (d.kind) {
      case 'pan':
        this.panX = d.px + (e.clientX - d.sx);
        this.panY = d.py + (e.clientY - d.sy);
        this.fitted = false;
        break;
      case 'draw': {
        const s = d.shape;
        if (isRectLike(s)) {
          let w = p.x - d.ox;
          let h = p.y - d.oy;
          if (e.shiftKey) {
            const m = Math.max(Math.abs(w), Math.abs(h));
            w = m * Math.sign(w || 1);
            h = m * Math.sign(h || 1);
          }
          s.x = d.ox;
          s.y = d.oy;
          s.w = w;
          s.h = h;
        } else if (isLine(s)) {
          const q = e.shiftKey ? this.snapAngle(d.ox, d.oy, p.x, p.y) : p;
          s.x2 = q.x;
          s.y2 = q.y;
        } else if (isPath(s)) {
          if (e.shiftKey) {
            // Shift: 곧은 선 (형광펜으로 한 줄을 반듯하게 칠할 때)
            const q = Math.abs(p.x - d.ox) > Math.abs(p.y - d.oy) ? { x: p.x, y: d.oy } : { x: d.ox, y: p.y };
            s.points = [d.ox, d.oy, q.x, q.y];
          } else {
            const n = s.points.length;
            if (Math.hypot(p.x - s.points[n - 2], p.y - s.points[n - 1]) >= 1.5 / this.zoom) s.points.push(p.x, p.y);
          }
        }
        break;
      }
      case 'move':
        if (!d.moved && Math.hypot(p.x - d.lx, p.y - d.ly) * this.zoom < 2) return;
        moveShape(d.shape, p.x - d.lx, p.y - d.ly);
        d.lx = p.x;
        d.ly = p.y;
        d.moved = true;
        break;
      case 'handle': {
        const s = d.shape;
        d.moved = true;
        if (isLine(s) && isLine(d.orig)) {
          if (d.handle === 'p1') {
            const q = e.shiftKey ? this.snapAngle(s.x2, s.y2, p.x, p.y) : p;
            s.x1 = q.x;
            s.y1 = q.y;
          } else {
            const q = e.shiftKey ? this.snapAngle(s.x1, s.y1, p.x, p.y) : p;
            s.x2 = q.x;
            s.y2 = q.y;
          }
        } else if (isRectLike(s) && isRectLike(d.orig)) {
          const o = normRect(d.orig);
          // 이미지 조각은 기본이 비율 유지, 나머지는 Shift 를 누를 때만
          const keep = (s.type === 'image') !== e.shiftKey;
          Object.assign(s, resizeRect(o, d.handle, p.x, p.y, keep && o.h > 0 ? o.w / o.h : null));
        }
        break;
      }
      case 'crop-new': {
        const q = this.clampPoint(p.x, p.y);
        let r = normRect({ x: d.ox, y: d.oy, w: q.x - d.ox, h: q.y - d.oy });
        if (this.cropAspect) r = this.fitAspect(r, q.x < d.ox, q.y < d.oy);
        this.crop = r;
        break;
      }
      case 'crop-move': {
        const c = this.crop!;
        const nx = Math.max(0, Math.min(this.width - c.w, c.x + p.x - d.lx));
        const ny = Math.max(0, Math.min(this.height - c.h, c.y + p.y - d.ly));
        d.lx += nx - c.x;
        d.ly += ny - c.y;
        this.crop = { ...c, x: nx, y: ny };
        break;
      }
      case 'crop-handle': {
        const q = this.clampPoint(p.x, p.y);
        let r = resizeRect(d.orig, d.handle, q.x, q.y, this.cropAspect);
        r = this.intersect(r);
        if (this.cropAspect) r = this.fitAspect(r, d.handle.includes('w'), d.handle.includes('n'));
        this.crop = r;
        break;
      }
    }
    this.requestRender();
  }

  private intersect(r: Rect): Rect {
    const x = Math.max(0, r.x);
    const y = Math.max(0, r.y);
    return { x, y, w: Math.max(0, Math.min(this.width, r.x + r.w) - x), h: Math.max(0, Math.min(this.height, r.y + r.h) - y) };
  }

  /** 사각형을 넘치지 않게 줄여서 비율을 맞춘다. 고정된 쪽 모서리는 그대로 둔다. */
  private fitAspect(r: Rect, anchorRight: boolean, anchorBottom: boolean): Rect {
    const a = this.cropAspect!;
    const w = Math.min(r.w, r.h * a);
    const h = w / a;
    return { x: anchorRight ? r.x + r.w - w : r.x, y: anchorBottom ? r.y + r.h - h : r.y, w, h };
  }

  pointerUp(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (this.canvas?.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    switch (d.kind) {
      case 'draw': {
        const s = d.shape;
        let tooSmall = false;
        if (isRectLike(s)) {
          Object.assign(s, normRect(s));
          tooSmall = s.w * this.zoom < 4 || s.h * this.zoom < 4;
        } else if (isLine(s)) tooSmall = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * this.zoom < 4;
        if (tooSmall) {
          this.shapes.pop();
          this.requestRender();
        } else {
          this.selectedId = s.id;
          this.commit();
        }
        break;
      }
      case 'move':
      case 'handle':
        if (d.moved) {
          if (isRectLike(d.shape)) Object.assign(d.shape, normRect(d.shape));
          this.commit();
        }
        break;
      case 'crop-new':
        if (!this.crop || this.crop.w < 2 || this.crop.h < 2) this.crop = { x: 0, y: 0, w: this.width, h: this.height };
        this.requestRender();
        break;
    }
    this.updateCursor(this.toImage(e));
  }

  private updateCursor(p: { x: number; y: number; sx: number; sy: number }) {
    if (this.spaceDown) return void (this.cursor = 'grab');
    if (!this.base) return void (this.cursor = 'default');
    if (this.tool === 'crop' && this.crop) {
      const h = this.hitHandle(rectHandles(this.crop), p.sx, p.sy);
      const c = this.crop;
      const inside = p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h;
      return void (this.cursor = h ? HANDLE_CURSOR[h] : inside ? 'move' : 'crosshair');
    }
    const sel = this.shapes.find((s) => s.id === this.selectedId);
    if (sel) {
      const h = this.hitHandle(handlePoints(sel), p.sx, p.sy);
      if (h) return void (this.cursor = HANDLE_CURSOR[h]);
    }
    if (this.tool === 'select') this.cursor = this.topShapeAt(p.x, p.y) ? 'move' : 'default';
    else if (this.tool === 'text') this.cursor = 'text';
    else this.cursor = 'crosshair';
  }

  wheel(e: WheelEvent) {
    e.preventDefault();
    if (!this.base) return;
    if (e.ctrlKey || e.metaKey) {
      const r = this.canvas!.getBoundingClientRect();
      // 트랙패드 핀치는 ctrlKey 가 붙은 작은 delta 로 들어온다
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01));
      this.zoomTo(this.zoom * f, e.clientX - r.left, e.clientY - r.top);
    } else {
      const k = e.deltaMode === 1 ? 16 : 1;
      this.panX -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
      this.panY -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
      this.fitted = false;
      this.endEdit();
      this.requestRender();
    }
  }

  dblClick(e: MouseEvent) {
    if (!this.base || this.tool === 'crop') return;
    const p = this.toImage(e);
    const hit = this.topShapeAt(p.x, p.y);
    if (hit?.type === 'text') {
      this.select(hit);
      this.beginEdit(hit);
    }
  }

  // ── 선택 · 도형 조작 ──
  private select(s: Shape) {
    this.selectedId = s.id;
    // 선택한 도형의 속성을 옵션 막대에 보여준다
    const st = this.style;
    if ('color' in s) st.color = s.color;
    if (s.type === 'rect' || s.type === 'ellipse') st.fill = s.fill;
    if ((isLine(s) || s.type === 'rect' || s.type === 'ellipse' || s.type === 'pen') && 'width' in s) st.width = Math.round(s.width);
    if (s.type === 'text') {
      st.fontSize = Math.round(s.size);
      st.boxed = s.boxed;
    }
    if (s.type === 'step') st.fontSize = Math.round(s.size);
    if (s.type === 'mosaic' || s.type === 'blur') st.strength = Math.round(s.strength);
    this.requestRender();
  }

  deselect() {
    this.selectedId = null;
    this.requestRender();
  }

  setTool(t: Tool) {
    this.endEdit();
    if (!this.base && t !== 'select') return;
    if (this.tool === 'crop' && t !== 'crop') this.crop = null;
    this.tool = t;
    if (t === 'crop') {
      this.selectedId = null;
      this.crop = { x: 0, y: 0, w: this.width, h: this.height };
      this.setCropAspect(this.cropAspect);
    }
    this.requestRender();
  }

  /** 옵션 막대에서 값을 바꾸면 기본값이 바뀌고, 선택된 도형이 있으면 그 도형에도 적용된다. */
  setStyle(patch: Partial<Style>, commit = true) {
    Object.assign(this.style, patch);
    const s = this.shapes.find((x) => x.id === this.selectedId);
    if (!s) return;
    let changed = false;
    const set = <T extends object, K extends keyof T>(obj: T, key: K, value: T[K]) => {
      if (obj[key] !== value) {
        obj[key] = value;
        changed = true;
      }
    };
    if (patch.color != null && 'color' in s) set(s, 'color', patch.color);
    if (patch.width != null && 'width' in s && s.type !== 'marker') set(s, 'width', patch.width);
    if (patch.fill != null && (s.type === 'rect' || s.type === 'ellipse')) set(s, 'fill', patch.fill);
    if (patch.fontSize != null && (s.type === 'text' || s.type === 'step')) set(s, 'size', patch.fontSize);
    if (patch.boxed != null && s.type === 'text') set(s, 'boxed', patch.boxed);
    if (patch.strength != null && (s.type === 'mosaic' || s.type === 'blur')) set(s, 'strength', patch.strength);
    if (changed) {
      if (commit) this.commit();
      else {
        this.rev++;
        this.requestRender();
      }
    }
    if (this.editing && this.editing.id === s.id && s.type === 'text') this.beginEdit(s, false);
  }

  /** 슬라이더를 놓았을 때: 끄는 동안 바뀐 내용을 기록 한 칸으로 남긴다 */
  commitIfSelected() {
    if (this.selectedId) this.commit();
  }

  deleteSelected() {
    const i = this.shapes.findIndex((s) => s.id === this.selectedId);
    if (i < 0) return;
    this.shapes.splice(i, 1);
    this.selectedId = null;
    this.commit();
  }

  duplicateSelected() {
    const s = this.shapes.find((x) => x.id === this.selectedId);
    if (!s) return;
    const copy = cloneShape(s);
    copy.id = newId();
    const off = 16 / this.zoom;
    moveShape(copy, off, off);
    if (copy.type === 'step') copy.n = Math.max(...this.shapes.filter((x) => x.type === 'step').map((x) => (x as { n: number }).n)) + 1;
    this.shapes.push(copy);
    this.selectedId = copy.id;
    this.commit();
  }

  reorder(dir: 'front' | 'back') {
    const i = this.shapes.findIndex((s) => s.id === this.selectedId);
    if (i < 0) return;
    const [s] = this.shapes.splice(i, 1);
    if (dir === 'front') this.shapes.push(s);
    else this.shapes.unshift(s);
    this.commit();
  }

  nudge(dx: number, dy: number) {
    const s = this.shapes.find((x) => x.id === this.selectedId);
    if (!s) return false;
    moveShape(s, dx, dy);
    this.commit();
    return true;
  }

  clearShapes() {
    if (!this.shapes.length) return;
    this.shapes = [];
    this.selectedId = null;
    this.commit();
  }

  // ── 글자 입력 ──
  beginEdit(s: TextShape, fresh = true) {
    const pad = s.boxed ? s.size * 0.38 : 0;
    this.editing = {
      id: s.id,
      left: (s.x + pad) * this.zoom + this.panX,
      top: (s.y + pad) * this.zoom + this.panY,
      fontSize: s.size * this.zoom,
      color: s.color,
      boxed: s.boxed,
      text: fresh ? s.text : (this.editing?.text ?? s.text),
    };
    this.requestRender();
  }

  updateEditText(text: string) {
    if (this.editing) this.editing.text = text;
  }

  endEdit() {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const i = this.shapes.findIndex((s) => s.id === ed.id);
    if (i < 0) return;
    const s = this.shapes[i] as TextShape;
    const text = ed.text.replace(/\s+$/, '');
    if (!text) {
      this.shapes.splice(i, 1);
      this.selectedId = null;
      // 새로 만들었다가 비운 글상자는 기록에 남기지 않는다
      if (s.text) this.commit();
      else {
        this.rev++;
        this.requestRender();
      }
    } else if (text !== s.text) {
      s.text = text;
      this.commit();
    } else this.requestRender();
  }

  // ── 자르기 ──
  setCropAspect(a: number | null) {
    this.cropAspect = a;
    if (!this.crop || !a) return;
    // 지금 영역의 가운데를 유지하면서 비율에 맞춘다
    const c = this.crop;
    const w = Math.min(c.w, c.h * a);
    const h = w / a;
    this.crop = { x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h };
    this.requestRender();
  }

  applyCrop() {
    const c = this.crop;
    if (!c || !this.base) return;
    const r = { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) };
    this.crop = null;
    this.tool = 'select';
    if (r.w < 1 || r.h < 1 || (r.x === 0 && r.y === 0 && r.w === this.width && r.h === this.height)) {
      this.requestRender();
      return;
    }
    this.base = cropCanvas(this.base, r);
    for (const s of this.shapes) moveShape(s, -r.x, -r.y);
    this.syncSize();
    this.commit();
    this.fit();
  }

  cancelCrop() {
    this.crop = null;
    this.tool = 'select';
    this.requestRender();
  }

  // ── 이미지 변형 ──
  /** 주석과 보정을 바탕 이미지에 합친다 (회전·뒤집기 전에 필요) */
  private flattenInto(): HTMLCanvasElement {
    const c = makeCanvas(this.width, this.height);
    this.renderDocument(c.getContext('2d')!, { frame: false, screen: false, scale: 1 });
    return c;
  }

  private bake(): boolean {
    const had = this.shapes.length > 0;
    this.base = this.flattenInto();
    this.shapes = [];
    this.selectedId = null;
    this.adjust = { ...NO_ADJUST };
    return had;
  }

  rotate(dir: 'cw' | 'ccw') {
    if (!this.base) return;
    this.endEdit();
    const had = this.bake();
    this.base = rotateCanvas(this.base, dir);
    this.syncSize();
    this.commit();
    this.fit();
    if (had) this.say('주석을 이미지에 합친 뒤 회전했습니다');
  }

  flip(axis: 'h' | 'v') {
    if (!this.base) return;
    this.endEdit();
    const had = this.bake();
    this.base = flipCanvas(this.base, axis);
    this.syncSize();
    this.commit();
    if (had) this.say('주석을 이미지에 합친 뒤 뒤집었습니다');
  }

  resize(w: number, h: number) {
    if (!this.base) return;
    w = Math.max(1, Math.min(16384, Math.round(w)));
    h = Math.max(1, Math.min(16384, Math.round(h)));
    if (w === this.width && h === this.height) return;
    this.endEdit();
    const sx = w / this.width;
    const sy = h / this.height;
    this.base = resizeCanvas(this.base, w, h);
    for (const s of this.shapes) scaleShape(s, sx, sy);
    this.syncSize();
    this.commit();
    this.fit();
  }

  setAdjust(patch: Partial<Adjust>, commit: boolean) {
    Object.assign(this.adjust, patch);
    this.adjustDirty = true;
    if (commit) this.commit();
    else this.requestRender();
  }

  setFrame(patch: Partial<Frame>, commit: boolean) {
    const wasPad = this.pad;
    Object.assign(this.frame, patch);
    if (commit) this.commit();
    else this.requestRender();
    if (patch.enabled != null || (patch.padding != null && commit && wasPad !== this.pad)) this.fit();
  }

  // ── 내보내기 ──
  exportCanvas(): HTMLCanvasElement {
    this.endEdit();
    const p = this.pad;
    const c = makeCanvas(this.width + p * 2, this.height + p * 2);
    const g = c.getContext('2d')!;
    g.translate(p, p);
    this.renderDocument(g, { frame: true, screen: false, scale: 1 });
    return c;
  }
}
