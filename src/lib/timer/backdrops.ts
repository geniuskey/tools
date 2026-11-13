// 발표자 화면 뒤에서 흐르는 배경. 어느 것이든 지난 시간만큼 차오르고,
// 멈추면 느려지고, 임박하면 거세지고, 색은 단계에 따라 천천히 바뀐다.
import type { Phase, Scene } from './core';

export type RGB = [number, number, number];

/** 한 장을 그릴 때 받는 값. 색과 진행은 Stage 가 미리 부드럽게 다듬어 준다 */
export interface Frame {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** 배경의 시간 (초). 멈추면 아주 느리게 간다 */
  t: number;
  /** 이번 장에서 흐른 배경의 시간 */
  dt: number;
  /** 0..1 지난 비율 */
  p: number;
  /** 움직임의 세기: 멈춤 0.35 · 보통 1 · 임박 1.6 · 초과 2.4 */
  energy: number;
  top: RGB;
  deep: RGB;
  running: boolean;
  phase: Phase;
  /** 움직임을 줄인 환경: 한 장만 그린다 */
  still: boolean;
}
export type Draw = (f: Frame) => void;

const NORMAL: Record<Scene, { top: RGB; deep: RGB }> = {
  water: { top: [84, 214, 190], deep: [58, 96, 232] },
  sand: { top: [240, 214, 170], deep: [150, 104, 110] },
  stars: { top: [176, 200, 255], deep: [96, 84, 220] },
  aurora: { top: [96, 232, 168], deep: [124, 92, 240] },
  none: { top: [84, 214, 190], deep: [58, 96, 232] },
};
export function toneOf(scene: Scene, phase: Phase): { top: RGB; deep: RGB; energy: number } {
  if (phase === 'warn') return { top: [255, 208, 64], deep: [226, 106, 20], energy: 1.6 };
  if (phase === 'over') return { top: [255, 110, 100], deep: [190, 24, 60], energy: 2.4 };
  return { ...NORMAL[scene], energy: 1 };
}

const rnd = Math.random;
const TAU = Math.PI * 2;
const WHITE: RGB = [255, 255, 255];
const rgba = (c: RGB, a: number) => `rgb(${c[0] | 0} ${c[1] | 0} ${c[2] | 0} / ${a})`;
const FLOOR = 0.045; // 시작할 때도 바닥에 조금은 있다
const CEIL = 0.955; // 다 차도 맨 위는 보인다

/** 느리게 떠다니는 큰 빛 */
function makeGlows(alpha: number): Draw {
  const glows = [0, 1, 2].map((i) => ({ ph: rnd() * TAU, sx: 0.05 + rnd() * 0.05, sy: 0.04 + rnd() * 0.05, i }));
  return ({ ctx, W, H, t, top, deep }) => {
    ctx.globalCompositeOperation = 'lighter';
    for (const g of glows) {
      const x = W * (0.5 + 0.42 * Math.sin(t * g.sx + g.ph));
      const y = H * (0.4 + 0.35 * Math.cos(t * g.sy + g.ph * 1.7));
      const r = Math.max(W, H) * (0.34 + 0.08 * Math.sin(t * 0.11 + g.i));
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, rgba(g.i === 1 ? deep : top, alpha));
      grad.addColorStop(1, rgba(top, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';
  };
}

/** 천천히 떠오르는 먼지 */
function makeMotes(n: number): Draw {
  const motes = Array.from({ length: n }, () => ({ x: rnd(), y: rnd(), r: 0.4 + rnd(), ph: rnd() * TAU, v: 0.004 + rnd() * 0.012 }));
  return ({ ctx, W, H, t, dt, top }) => {
    ctx.globalCompositeOperation = 'lighter';
    for (const m of motes) {
      m.y -= m.v * dt;
      if (m.y < -0.02) (m.y = 1.02), (m.x = rnd());
      ctx.fillStyle = rgba(top, 0.1 + 0.16 * (0.5 + 0.5 * Math.sin(t * 0.9 + m.ph)));
      ctx.beginPath();
      ctx.arc((m.x + 0.012 * Math.sin(t * 0.3 + m.ph)) * W, m.y * H, m.r * Math.max(1, H * 0.0028), 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  };
}

/** 물: 차오르는 수면, 공기 방울이 닿으면 잔물결이 번진다. 넘기면 끓는다 */
function water(): Draw {
  const glow = makeGlows(0.13);
  const motes = makeMotes(34);
  const bubbles = Array.from({ length: 46 }, () => ({ x: rnd(), y: rnd(), r: 0.3 + rnd() ** 2, v: 0.03 + rnd() * 0.07, ph: rnd() * TAU }));
  let ripples: { x: number; age: number; a: number }[] = [];

  return (f) => {
    const { ctx, W, H, t, dt, energy, top, deep } = f;
    const level = FLOOR + (CEIL - FLOOR) * f.p;
    /** 수면의 높이. layer 0 이 맨 앞 */
    const surface = (x: number, layer: number) => {
      const u = (x / W) * TAU;
      const p = layer * 1.9;
      const amp = H * 0.011 * energy * (1 + layer * 0.25);
      let y = H * (1 - level) - layer * H * 0.012;
      y += amp * (Math.sin(u * 1.3 + t * 0.8 + p) + 0.5 * Math.sin(u * 2.9 - t * 1.15 + p * 2) + 0.22 * Math.sin(u * 6.1 + t * 2 + p * 3));
      for (const r of ripples) {
        const d = Math.abs(x - r.x) - r.age * W * 0.09;
        const w = W * 0.03;
        y += H * 0.007 * r.a * Math.exp(-r.age * 1.2) * Math.sin(d / (w * 0.35)) * Math.exp(-((d / w) ** 2)) * (layer ? 0.5 : 1);
      }
      return y;
    };

    glow(f);
    motes(f);
    for (const r of ripples) r.age += dt;
    ripples = ripples.filter((r) => r.age < 3.5);

    const step = Math.max(4, W / 180);
    for (let layer = 2; layer >= 0; layer--) {
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W + step; x += step) ctx.lineTo(x, surface(x, layer));
      ctx.lineTo(W, H);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, H * (1 - level) - H * 0.03, 0, H);
      const a = [0.3, 0.17, 0.11][layer];
      grad.addColorStop(0, rgba(top, a * 1.25));
      grad.addColorStop(Math.min(1, 0.35 + 0.1 * layer), rgba(deep, a));
      grad.addColorStop(1, rgba(deep, a * 0.45));
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // 수면의 빛줄기
    ctx.beginPath();
    for (let x = 0; x <= W + step; x += step) ctx.lineTo(x, surface(x, 0));
    ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(top, 0.16);
    ctx.lineWidth = Math.max(4, H * 0.014);
    ctx.stroke();
    ctx.strokeStyle = rgba(WHITE, 0.55);
    ctx.lineWidth = Math.max(1, H * 0.0025);
    ctx.stroke();

    // 물속 공기 방울
    const boil = f.phase === 'over' && f.running ? 2.6 : 1;
    for (const b of bubbles) {
      b.y += b.v * dt * boil;
      const bx = (b.x + 0.012 * Math.sin(t * 1.3 + b.ph)) * W;
      const by = H - b.y * H;
      const gap = by - surface(bx, 0);
      if (gap < 0) {
        // 수면에 닿아 터지면서 잔물결을 남긴다
        if (!f.still && ripples.length < 14) ripples.push({ x: bx, age: 0, a: 0.5 + b.r });
        b.y = -0.03 - rnd() * 0.1 * level;
        b.x = rnd();
        continue;
      }
      const r = b.r * Math.max(1.2, H * 0.006);
      const a = Math.min(1, gap / (H * 0.04)) * Math.min(1, b.y * 12 + 0.4);
      ctx.fillStyle = rgba(WHITE, 0.07 * a);
      ctx.strokeStyle = rgba(WHITE, 0.38 * a);
      ctx.lineWidth = Math.max(0.75, r * 0.18);
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  };
}

/**
 * 모래: 샌드아트처럼 두세 곳에서 가는 줄기로 떨어져 쌓인다. 모래 한 알이 한 픽셀이고, 알마다 떨어지고 미끄러지는 것을 계산한다.
 * (칸마다 한 알만 들어가는 모래 놀이식 계산. 움직이는 알만 따라가므로 백만 알이 쌓여도 가볍다)
 * 시간이 가면 모래의 색이 바뀌어서 쌓인 순서대로 등고선 같은 띠가 남는다. 경고 · 초과 때 내린 모래는 그 색의 띠가 된다.
 */
function sand(): Draw {
  const glow = makeGlows(0.1);
  const EMPTY = 0;
  const REST = 1; // 자리 잡은 알
  const FALL = 2; // 떨어지는 알
  const SLIDE = 3; // 비탈을 미끄러지는 알
  const TOP = 0.86; // 다 쌓였을 때 봉우리의 높이
  const ALPHA = 138;

  let gw = 0;
  let gh = 0;
  let scale = 1;
  let grid = new Uint8Array(0);
  let off: HTMLCanvasElement | null = null;
  let octx: CanvasRenderingContext2D | null = null;
  let image: ImageData | null = null;
  let px = new Uint32Array(0);
  // 움직이는 알
  let cap = 0;
  let ax = new Int32Array(0);
  let ay = new Int32Array(0);
  let av = new Float32Array(0);
  let n = 0;
  let count = 0; // 지금까지 내린 알
  let acc = 0;
  let rebuilt = -1;
  let rate = 0; // 한 장 (1/60초) 에 늘어나는 알 수 (부드럽게)
  let last = 0;

  // 줄기가 떨어지는 자리 (칸), 칸마다 가장 가까운 줄기까지의 거리, 줄기마다 봉우리의 높이 (y)
  let spouts: number[] = [];
  let far = new Float32Array(0);
  let tops: number[] = [];
  let carry: number[] = []; // 줄기마다 아직 못 내보낸 알의 소수점 아래
  // 색 띠: 봉우리가 얼마나 높아지는 동안 한 색이 이어질지는 띠마다 제멋대로다 (얇은 띠, 두꺼운 띠, 가는 어두운 줄).
  // bounds[b] 는 b 번째 띠가 시작되는 알 수, bandAt[h] 는 봉우리 높이가 h 일 때의 띠
  let bands: { color: RGB; shade: number; dark: boolean }[] = [];
  let bandAt = new Uint16Array(0);
  let bounds: number[] = [];
  let band = 0;
  let full = 0; // 다 쌓였을 때의 알 수

  // 쌓인 모양은 줄기마다 기울기 1:2 의 산이 겹친 것. 봉우리 높이가 h 일 때 x 칸에 쌓인 높이와 전체 알 수
  const column = (x: number, h: number) => Math.max(0, Math.min(gh, Math.round(h - far[x] / 2)));
  const area = (h: number) => {
    let c = 0;
    for (let x = 0; x < gw; x++) c += column(x, h);
    return c;
  };
  /** 알 수가 c 일 때의 봉우리 높이 */
  const peak = (c: number) => {
    let lo = 0;
    let hi = gh + gw;
    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2;
      if (area(mid) < c) lo = mid;
      else hi = mid;
    }
    return hi;
  };

  const PALETTE: RGB[] = [
    [236, 206, 156],
    [206, 122, 88],
    [122, 168, 156],
    [240, 228, 204],
    [98, 112, 172],
    [184, 114, 136],
  ];
  /** 알 하나의 색 (little-endian ABGR). 평소에는 띠마다 다른 모래색, 경고 · 초과 때는 그 단계의 색을 띠마다 다른 농도로 쓴다 */
  const tint = (f: { top: RGB; deep: RGB; phase: Phase }, b: number) => {
    const { color, shade, dark } = bands[Math.min(b, bands.length - 1)];
    const l = (dark ? 0.5 : 1) * (0.74 + rnd() * 0.42);
    const c = (i: number) => Math.min(255, (f.phase === 'normal' ? color[i] : f.top[i] + (f.deep[i] - f.top[i]) * shade) * l) | 0;
    return ((ALPHA << 24) | (c(2) << 16) | (c(1) << 8) | c(0)) >>> 0;
  };

  /** 줄기 두세 곳을 서로 떨어뜨려 아무 데나 놓는다 */
  function place() {
    const count = rnd() < 0.5 ? 2 : 3;
    for (let tries = 0; ; tries++) {
      spouts = Array.from({ length: count }, () => Math.round(gw * (0.12 + rnd() * 0.76))).sort((a, b) => a - b);
      if (tries > 40 || spouts.every((x, i) => i === 0 || x - spouts[i - 1] > gw * 0.2)) break;
    }
    far = new Float32Array(gw);
    for (let x = 0; x < gw; x++) far[x] = Math.min(...spouts.map((sx) => Math.abs(x - sx)));
    tops = spouts.map(() => gh);
    carry = spouts.map(() => 0);
    // 띠를 뽑는다: 두께는 얇은 것부터 두꺼운 것까지 고르게 흩어지고, 이따금 가는 어두운 줄이 낀다
    const unit = Math.max(6, gh * TOP * 0.03);
    bands = [];
    bounds = [];
    bandAt = new Uint16Array(gh + gw + 2);
    let color = PALETTE[(rnd() * PALETTE.length) | 0];
    for (let h = 0; h < bandAt.length; ) {
      const dark = bands.length > 0 && !bands[bands.length - 1].dark && rnd() < 0.3;
      if (!dark) {
        const others = PALETTE.filter((c) => c !== color);
        color = others[(rnd() * others.length) | 0];
      }
      const thick = Math.max(2, unit * (dark ? 0.08 + rnd() * 0.14 : 0.2 * 12 ** rnd()));
      bandAt.fill(bands.length, Math.round(h), Math.round(h + thick) + 1);
      bounds.push(area(h));
      bands.push({ color, shade: 0.05 + rnd() * 0.65, dark });
      h += thick;
    }
    bounds.push(Infinity);
    full = area(gh * TOP);
  }

  function size(W: number, H: number) {
    scale = Math.max(1, Math.ceil(Math.sqrt((W * H) / 2_400_000)));
    gw = Math.max(1, Math.round(W / scale));
    gh = Math.max(1, Math.round(H / scale));
    grid = new Uint8Array(gw * gh);
    off = document.createElement('canvas');
    off.width = gw;
    off.height = gh;
    octx = off.getContext('2d');
    image = octx!.createImageData(gw, gh);
    px = new Uint32Array(image.data.buffer);
    count = 0;
    n = 0;
    rebuilt = -1;
    place();
  }

  /** 알 수에 맞는 산을 한 번에 그린다 (처음 열 때, 순서를 옮기거나 시간을 고쳤을 때) */
  function rebuild(target: number, f: Frame) {
    // 새 순서가 시작되면 줄기 자리도 새로 뽑는다
    if (target < 200 && count > 2000) place();
    grid.fill(EMPTY);
    px.fill(0);
    n = 0;
    count = 0;
    const h = peak(target);
    for (let x = 0; x < gw; x++) {
      const col = target > 0 ? column(x, h) : 0;
      for (let k = 0; k < col; k++) {
        const i = (gh - 1 - k) * gw + x;
        // 이 칸이 덮일 무렵의 봉우리 높이로 띠를 정한다
        grid[i] = REST;
        px[i] = tint(f, bandAt[(k + far[x] / 2) | 0]);
      }
      count += col;
    }
    band = 0;
    while (count >= bounds[band + 1]) band++;
  }

  function grow() {
    cap = Math.max(4096, cap * 2);
    const copy = <T extends Int32Array | Float32Array | Uint8Array>(a: T, b: T) => (b.set(a.subarray(0, n)), b);
    ax = copy(ax, new Int32Array(cap));
    ay = copy(ay, new Int32Array(cap));
    av = copy(av, new Float32Array(cap));
  }

  const at = (x: number, y: number) => (x < 0 || x >= gw || y >= gh ? REST : grid[y * gw + x]);

  /** 받치던 알이 빠져나가면 그 위와 옆의 자리 잡은 알을 다시 깨운다 */
  function wake(x: number, y: number) {
    if (x < 0 || x >= gw || y < 0) return;
    const i = y * gw + x;
    if (grid[i] !== REST) return;
    if (n >= cap) grow();
    grid[i] = SLIDE;
    ax[n] = x;
    ay[n] = y;
    av[n] = FLOW;
    n++;
  }

  /**
   * 한 박자: 움직이는 알마다 떨어지고, 받쳐지면 비탈을 따라 미끄러지고, 갈 데가 없으면 자리 잡는다.
   * 미끄러지는 알 위로도 다른 알이 미끄러질 수 있어서 모래가 여러 겹으로 흘러내린다.
   */
  function tick() {
    const end = n;
    let w = 0;
    for (let k = 0; k < end; k++) {
      const x0 = ax[k];
      const y0 = ay[k];
      let x = x0;
      let y = y0;
      let v = av[k];
      const from = y * gw + x;
      let state = grid[from];
      let rest = false;
      for (let s = Math.max(1, v | 0); s > 0; s--) {
        const below = at(x, y + 1);
        if (below === EMPTY) {
          y++;
          state = FALL;
          continue;
        }
        // 아래 알이 아직 떨어지는 중: 옆으로 새지 않고 바짝 따라간다
        if (below === FALL) break;
        const d = rnd() < 0.5 ? 1 : -1;
        if (at(x + d, y + 1) === EMPTY) (x += d), y++;
        else if (at(x - d, y + 1) === EMPTY) (x -= d), y++;
        else if (at(x + d, y) === EMPTY && at(x + 2 * d, y + 1) === EMPTY) (x += 2 * d), y++;
        else if (at(x - d, y) === EMPTY && at(x - 2 * d, y + 1) === EMPTY) (x -= 2 * d), y++;
        else {
          rest = true;
          break;
        }
        state = SLIDE;
        if (v < FLOW) v = FLOW;
      }
      const i = y * gw + x;
      if (i !== from) {
        px[i] = px[from];
        px[from] = 0;
        grid[from] = EMPTY;
        wake(x0, y0 - 1);
        wake(x0 - 1, y0 - 1);
        wake(x0 + 1, y0 - 1);
        wake(x0 - 2, y0 - 1);
        wake(x0 + 2, y0 - 1);
        wake(x0 - 1, y0);
        wake(x0 + 1, y0);
      }
      if (rest) {
        grid[i] = REST;
        continue;
      }
      // 한 칸도 못 갔으면 막힌 것: 위의 알이 기다리지 않고 옆으로 흘러내리게 한다
      grid[i] = i === from ? SLIDE : state;
      ax[w] = x;
      ay[w] = y;
      av[w] = v;
      w++;
    }
    // 이번 박자에 깨어난 알을 뒤에 붙인다
    for (let k = end; k < n; k++, w++) {
      ax[w] = ax[k];
      ay[w] = ay[k];
      av[w] = av[k];
    }
    n = w;
  }

  const FAST = 12; // 떨어지는 빠르기의 한도 (한 박자에 칸). 이보다 많이 내보낼 때는 줄기가 굵어진다
  const FLOW = 4; // 비탈을 흘러내리는 빠르기
  const BEAT = 14; // 한 박자에 내보내는 알. 이보다 굵으면 봉우리에서 흩어지지 못하고 기둥으로 쌓인다
  const BEATS = 8; // 한 장에 계산하는 박자의 한도. 양이 많으면 줄기를 굵히지 않고 박자를 늘린다

  /**
   * 줄기마다 위에서 가늘게 내보낸다. 봉우리가 낮은 쪽부터 채워서 산들이 고르게 자란다.
   * 한 박자에 내보내는 알 수만큼의 빠르기로 떨어뜨려서 (그리고 떨어지는 동안 빨라지지 않아서) 줄기가 끊기지 않고 이어진다.
   */
  function pour(want: number, f: Frame) {
    const low = Math.max(...tops);
    const open = spouts.map((_, i) => i).filter((i) => tops[i] >= low - 6);
    const share = Math.min(want / open.length, BEAT);
    const width = Math.ceil(share / FAST);
    // 빠르기는 내림: 줄기의 한 줄은 늘 꽉 차고, 남는 알은 옆 칸에 붙어 내려간다
    const v = Math.max(1, Math.floor(share / width));
    while (count >= bounds[band + 1]) band++;
    for (const s of open) {
      carry[s] += share;
      let m = Math.floor(carry[s]);
      carry[s] -= m;
      const cx = spouts[s] - (width >> 1);
      const wide = m > v * width ? width + 1 : width;
      // 아래 줄부터 채운다: 먼저 나온 알이 먼저 움직여야 줄기 안에서 서로 길을 막지 않는다
      for (let y = v - 1; y >= 0 && m > 0; y--) {
        for (let x = cx; x < cx + wide && m > 0; x++, m--) {
          const i = y * gw + x;
          if (x < 0 || x >= gw || grid[i] !== EMPTY) continue;
          if (n >= cap) grow();
          grid[i] = FALL;
          px[i] = tint(f, band);
          ax[n] = x;
          ay[n] = y;
          av[n] = v;
          n++;
          count++;
        }
      }
    }
  }

  /** 줄기 아래 봉우리의 높이를 따라간다 */
  function measure() {
    for (let i = 0; i < spouts.length; i++) {
      const x = spouts[i];
      let y = Math.min(gh, Math.max(1, tops[i]));
      while (y > 1 && grid[(y - 1) * gw + x] === REST) y--;
      while (y < gh && grid[y * gw + x] !== REST) y++;
      tops[i] = y;
    }
  }

  return (f) => {
    const { ctx, W, H } = f;
    if (Math.round(W / scale) !== gw || Math.round(H / scale) !== gh || !off) size(W, H);
    const target = Math.round(full * f.p);
    const now = performance.now();
    // 줄기로는 따라잡을 수 없을 만큼 벌어졌거나 (처음 열 때 · 아주 짧은 순서) 줄어들었으면 다시 쌓는다
    const reach = BEAT * BEATS * 60 * 3;
    if (f.still || rebuilt < 0 || ((target - count > reach || count - target > 2000) && now - rebuilt > 150)) {
      rebuild(target, f);
      rebuilt = now;
      last = target;
    }
    // 한 장에 필요한 알 수 (밀린 양은 1.5초에 걸쳐 따라잡는다) 에 맞춰 박자 수를 정한다
    const frames = f.dt * 60;
    if (frames > 0) rate += (Math.max(0, target - last) / frames - rate) * 0.05;
    last = target;
    const beats = Math.min(BEATS, Math.max(1, Math.ceil(Math.max(rate, (target - count) / 90) / (BEAT * 0.8 * spouts.length))));
    acc = Math.min(beats * 3, acc + frames * beats);
    measure();
    for (; acc >= 1; acc--) {
      if (count < target) pour(target - count, f);
      tick();
    }

    glow(f);
    octx!.putImageData(image!, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off!, 0, 0, gw * scale, gh * scale);
  };
}

/** 별: 시간이 갈수록 별이 하나씩 켜지고, 하늘이 천천히 돈다. 이따금 별똥별 */
function stars(): Draw {
  const glow = makeGlows(0.12);
  const list = Array.from({ length: 900 }, () => ({ a: rnd() * TAU, d: Math.sqrt(0.03 + rnd() * 0.97), r: 0.5 + rnd() ** 3 * 1.9, ph: rnd() * TAU, sp: 0.6 + rnd() * 1.8, order: rnd(), b: -1, tint: rnd() < 0.35 }));
  let shots: { x: number; y: number; vx: number; vy: number; age: number }[] = [];
  let wait = 2 + rnd() * 3;
  const PALE: RGB = [236, 240, 255];

  return (f) => {
    const { ctx, W, H, t, dt, top } = f;
    glow(f);
    // 하늘은 화면 아래 바깥의 한 점을 두고 돈다
    const cx = W * 0.5;
    const cy = H * 1.3;
    const R = Math.hypot(W * 0.5, cy) * 1.03;
    const lit = 0.08 + 0.92 * f.p;
    const k = f.still ? 1 : 1 - Math.exp(-dt * 1.2);
    const unit = Math.max(0.8, H * 0.0024);
    ctx.globalCompositeOperation = 'lighter';
    for (const s of list) {
      const a = s.a + t * 0.011;
      const x = cx + Math.cos(a) * s.d * R;
      const y = cy + Math.sin(a) * s.d * R;
      const on = s.order < lit ? 1 : 0;
      if (s.b < 0) s.b = on;
      else s.b += (on - s.b) * k;
      if (x < -8 || x > W + 8 || y < -8 || y > H + 8 || s.b < 0.01) continue;
      const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
      const r = s.r * unit;
      ctx.fillStyle = rgba(s.tint ? top : PALE, s.b * tw);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      if (s.r > 1.5) {
        ctx.fillStyle = rgba(top, s.b * tw * 0.1);
        ctx.beginPath();
        ctx.arc(x, y, r * 2.2, 0, TAU);
        ctx.fill();
      }
    }

    // 별똥별: 임박할수록 잦다
    wait -= dt * (f.running ? f.energy : 0);
    if (wait <= 0 && !f.still) {
      wait = 3 + rnd() * 6;
      const dir = rnd() < 0.5 ? 1 : -1;
      const v = H * (0.9 + rnd() * 0.5);
      const ang = 0.35 + rnd() * 0.4;
      shots.push({ x: W * (0.15 + rnd() * 0.7), y: H * rnd() * 0.35, vx: Math.cos(ang) * v * dir, vy: Math.sin(ang) * v, age: 0 });
    }
    ctx.lineCap = 'round';
    for (const s of shots) {
      s.age += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const a = Math.sin(Math.min(1, s.age / 0.8) * Math.PI);
      const tx = s.x - s.vx * 0.16;
      const ty = s.y - s.vy * 0.16;
      const grad = ctx.createLinearGradient(s.x, s.y, tx, ty);
      grad.addColorStop(0, rgba(WHITE, 0.9 * a));
      grad.addColorStop(1, rgba(top, 0));
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(1.2, H * 0.004);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    shots = shots.filter((s) => s.age < 0.8);
    ctx.globalCompositeOperation = 'source-over';
  };
}

/** 오로라: 빛의 장막이 바닥에서 시작해 시간이 갈수록 하늘 위로 펼쳐진다 */
function aurora(): Draw {
  const motes = makeMotes(40);
  const N = 5;
  const bands = Array.from({ length: N }, (_, i) => ({ ph: rnd() * TAU, k: 0.7 + rnd() * 0.8, sp: 0.1 + rnd() * 0.14, i }));

  return (f) => {
    const { ctx, W, H, t, top, deep } = f;
    motes(f);
    ctx.globalCompositeOperation = 'lighter';
    const step = Math.max(2, Math.round(W / 280)); // 정수 폭이어야 이음매가 안 보인다
    const sway = H * 0.04 * Math.min(1.8, 0.6 + f.energy * 0.5);
    for (const b of bands) {
      // 한 장막의 세로 빛깔: 아래가 밝고 위로 길게 흩어진다
      const c = b.i % 2 ? deep : top;
      const grad = ctx.createLinearGradient(0, 0, 0, 1);
      grad.addColorStop(0, rgba(c, 0));
      grad.addColorStop(0.55, rgba(c, 0.13));
      grad.addColorStop(0.86, rgba(b.i % 2 ? top : c, 0.36));
      grad.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = grad;
      const base = H * (1 - FLOOR - (CEIL - 0.1 - FLOOR) * f.p * ((b.i + 0.6) / N));
      for (let x = 0; x < W; x += step) {
        const u = (x / W) * TAU;
        const y = base + sway * (Math.sin(u * b.k + t * b.sp + b.ph) + 0.5 * Math.sin(u * b.k * 2.3 - t * b.sp * 1.6 + b.ph * 2));
        const h = H * (0.2 + 0.09 * Math.sin(u * 1.7 + t * 0.23 + b.ph * 3));
        // 가는 빛살이 어른거린다
        const ray = 0.66 + 0.34 * Math.sin(u * 11 + t * 0.9 + b.ph) * Math.sin(u * 4.3 - t * 0.5 + b.ph * 2);
        ctx.globalAlpha = ray;
        ctx.save();
        ctx.translate(x, y - h);
        ctx.scale(step, h * 1.12);
        ctx.fillRect(0, 0, 1, 1);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };
}

export function createBackdrop(scene: Scene): Draw | null {
  return scene === 'water' ? water() : scene === 'sand' ? sand() : scene === 'stars' ? stars() : scene === 'aurora' ? aurora() : null;
}
