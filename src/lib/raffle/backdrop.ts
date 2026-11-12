// 무대 뒤 조명. 화면보다 낮은 해상도의 캔버스에 빛을 겹쳐 그린다.
// 스포트라이트 · 떠다니는 먼지 · 당첨 순간의 빛살과 충격파. 글자 뒤에 깔리므로 흐릿해도 괜찮다.

const TAU = Math.PI * 2;
type RGB = readonly [number, number, number];

const PINK: RGB = [255, 92, 154];
const VIOLET: RGB = [146, 110, 255];
const AMBER: RGB = [255, 176, 64];
const GOLD: RGB = [255, 214, 110];
const WHITE: RGB = [255, 244, 224];

const rgba = (c: RGB, a: number) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

interface Beam {
  /** 화면 위쪽에 매달린 가로 위치 (0~1) */
  x: number;
  /** 평소에 향하는 각도 */
  base: number;
  sway: number;
  speed: number;
  phase: number;
  half: number;
  color: RGB;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 평소에 떠다니는 속도 */
  dx: number;
  dy: number;
  size: number;
  twinkle: number;
  fade: number;
  color: RGB;
}

interface Ring {
  age: number;
  delay: number;
}

interface Glint {
  x: number;
  y: number;
  age: number;
  life: number;
  size: number;
}

/** 캔버스에 쓸 픽셀 수. 빛은 번져 보이는 편이 자연스러워 이 정도면 충분하다 */
const PIXELS = 1_100_000;

export class Backdrop {
  private g: CanvasRenderingContext2D | null;
  private observer: ResizeObserver | null = null;
  private calm: MediaQueryList | null = null;
  private raf = 0;
  private last = 0;
  private time = 0;
  private delay = 0;
  private w = 0;
  private h = 0;
  private res = 1;
  /** 큰 화면에서는 먼지와 선도 그만큼 굵게 그린다 */
  private unit = 1;
  private quality = 1;
  private frames = 0;
  private slow = 0;

  private beams: Beam[];
  private motes: Mote[] = [];
  private rings: Ring[] = [];
  private glints: Glint[] = [];
  private seeds = Array.from({ length: 24 }, () => Math.random());
  private spin = 0;
  private glintIn = 0;

  /** 추첨 중의 긴장도 (0~1). 빛이 빨라지고 먼지가 바깥으로 달려 나간다 */
  private energy = 0;
  private energyTo = 0;
  /** 스포트라이트가 가운데로 모인 정도 */
  private gather = 0;
  private gatherTo = 0;
  private hold = 0;
  /** 당첨자 뒤에서 퍼지는 빛살 */
  private rays = 0;
  private raysTo = 0;
  private pulse = 0;
  private flash = 0;
  /** 빛이 모이는 자리 (0~1) 와 퍼지는 크기 */
  private fx = 0.5;
  private fy = 0.5;
  private spread = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d');
    const colors = [VIOLET, PINK, AMBER, AMBER, PINK, VIOLET];
    this.beams = [-0.03, 0.18, 0.39, 0.61, 0.82, 1.03].map((x, i) => ({
      x,
      base: Math.PI / 2 + (0.5 - x) * 0.75,
      sway: 0.2 + Math.random() * 0.14,
      speed: 0.32 + Math.random() * 0.3,
      phase: Math.random() * TAU,
      half: 0.05 + Math.random() * 0.03,
      color: colors[i],
    }));
  }

  /** @param delay 조명이 켜지기 시작할 때까지 기다릴 시간 (초) */
  start(delay = 0) {
    if (!this.g || this.calm) return;
    this.delay = delay;
    this.calm = matchMedia('(prefers-reduced-motion: reduce)');
    this.calm.addEventListener('change', this.sync);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.canvas);
    this.resize();
    this.sync();
  }

  /** 움직임을 줄이도록 설정한 동안에는 아무것도 그리지 않는다 (무대를 연 채로 설정을 바꿔도 따라간다) */
  private sync = () => {
    const g = this.g!;
    if (this.calm?.matches) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    } else if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  setEnergy(v: number) {
    this.energyTo = v > 0 ? Math.min(1, v) : 0;
  }

  /** 빛이 모일 자리. 무대 크기에 대한 비율로 준다 */
  setFocus(x: number, y: number, spread = 1) {
    this.fx = x;
    this.fy = y;
    this.spread = spread;
  }

  /** 이름이 하나 지나갈 때마다 가운데 빛이 한 번 뛴다 */
  tick() {
    this.pulse = Math.min(1, this.pulse + 0.55);
  }

  /** 당첨 순간: 먼지가 터져 나가고, 충격파와 빛살이 퍼지고, 스포트라이트가 당첨자를 비춘다 */
  reveal(x: number, y: number, spread = 1) {
    this.setFocus(x, y, spread);
    this.energy = this.energyTo = 0;
    this.raysTo = 1;
    this.flash = 1;
    this.pulse = 1;
    this.gatherTo = 1;
    this.hold = 1.6;
    this.rings.push({ age: 0, delay: 0 }, { age: 0, delay: 0.16 });
    const cx = x * this.w;
    const cy = y * this.h;
    for (const m of this.motes) {
      const a = Math.atan2(m.y - cy, m.x - cx) + (Math.random() - 0.5) * 0.6;
      const s = 500 + Math.random() * 1400;
      m.vx = Math.cos(a) * s;
      m.vy = Math.sin(a) * s;
    }
  }

  /** 빛살을 거두고 평소 조명으로 돌아간다 */
  rest() {
    this.energyTo = 0;
    this.raysTo = 0;
    this.gatherTo = 0;
    this.hold = 0;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.observer?.disconnect();
    this.observer = null;
    this.calm?.removeEventListener('change', this.sync);
    this.calm = null;
  }

  private resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const res = Math.min(devicePixelRatio || 1, Math.sqrt((PIXELS * this.quality) / (w * h)));
    const pw = Math.max(1, Math.round(w * res));
    const ph = Math.max(1, Math.round(h * res));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    // 창 크기가 바뀌면 먼지도 같은 비율로 옮긴다
    if (this.w && this.h) for (const m of this.motes) ((m.x *= w / this.w), (m.y *= h / this.h));
    this.w = w;
    this.h = h;
    this.res = pw / w;
    this.unit = Math.max(1, Math.min(w, h) / 900);
    const count = Math.round(Math.min(150, Math.max(50, (w * h) / 12000)));
    while (this.motes.length < count) this.motes.push(this.mote());
    this.motes.length = count;
  }

  private mote(): Mote {
    const r = Math.random();
    return {
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      vx: 0,
      vy: 0,
      dx: (Math.random() - 0.5) * 26,
      dy: -4 - Math.random() * 16,
      size: 0.7 + Math.random() * 1.7,
      twinkle: Math.random() * TAU,
      fade: 0,
      color: r < 0.55 ? WHITE : r < 0.8 ? GOLD : PINK,
    };
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const raw = (now - this.last) / 1000;
    this.last = now;
    // 느린 기기에서는 해상도를 낮춘다. 한 번 낮추면 다시 올리지 않는다.
    // 초당 30장으로 도는 화면은 정상이므로 그보다 느릴 때만 세고, 탭이 가려져 멈췄던 프레임은 세지 않는다
    if (raw > 0.045 && raw < 0.5) this.slow++;
    if (++this.frames >= 90) {
      if (this.slow > 30 && this.quality > 0.3) {
        this.quality *= 0.55;
        this.resize();
      }
      this.frames = this.slow = 0;
    }
    this.step(Math.min(0.05, Math.max(0, raw)));
    this.paint();
  };

  private step(dt: number) {
    const { w, h } = this;
    const ease = (cur: number, to: number, rate: number) => cur + (to - cur) * (1 - Math.exp(-rate * dt));
    this.time += dt;
    this.energy = ease(this.energy, this.energyTo, this.energyTo > this.energy ? 3.5 : 2.5);
    this.gather = ease(this.gather, this.gatherTo, this.gatherTo > this.gather ? 10 : 1.6);
    this.rays = ease(this.rays, this.raysTo, this.raysTo > this.rays ? 8 : 2.2);
    // 터진 뒤에는 은은하게 남는다
    if (this.raysTo === 1 && this.rays > 0.92) this.raysTo = 0.55;
    this.pulse *= Math.exp(-7 * dt);
    this.flash *= Math.exp(-4 * dt);
    if (this.hold > 0 && (this.hold -= dt) <= 0) this.gatherTo = 0;
    this.spin += dt * (0.06 + this.flash * 0.5);
    for (const b of this.beams) b.phase += dt * b.speed * (1 + this.energy * 3.2);

    const cx = this.fx * w;
    const cy = this.fy * h;
    // 추첨 중에는 먼지가 가운데에서 바깥으로, 멀어질수록 빠르게 날아간다 (앞으로 달려 나가는 느낌)
    const rush = this.energy ** 2 * 2.6;
    const settle = Math.min(1, 2.5 * dt);
    for (const m of this.motes) {
      m.vx += (m.dx + (m.x - cx) * rush - m.vx) * settle;
      m.vy += (m.dy + (m.y - cy) * rush - m.vy) * settle;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.twinkle += dt * (1.2 + m.size);
      m.fade = Math.min(1, m.fade + dt * 1.4);
      if (m.x < -60 || m.x > w + 60 || m.y < -60 || m.y > h + 60) {
        if (rush > 0.15) {
          // 화면 밖으로 나가면 가운데 근처에서 다시 나온다
          const a = Math.random() * TAU;
          const r = (40 + Math.random() * 160) * this.unit;
          m.x = cx + Math.cos(a) * r;
          m.y = cy + Math.sin(a) * r;
        } else {
          m.x = Math.random() * w;
          m.y = Math.random() * h;
        }
        m.vx = m.dx;
        m.vy = m.dy;
        m.fade = 0;
      }
    }

    for (const r of this.rings) r.age += dt;
    if (this.rings.length && this.rings[0].age - this.rings[0].delay > 1) this.rings = this.rings.filter((r) => r.age - r.delay <= 1);

    // 당첨자 둘레에서 반짝이는 별
    if (this.rays > 0.25 && (this.glintIn -= dt) <= 0) {
      this.glintIn = 0.05 + Math.random() * 0.13;
      this.glints.push({
        x: cx + (Math.random() * 2 - 1) * w * 0.36 * this.spread,
        y: cy + (Math.random() * 2 - 1) * h * 0.24 * this.spread,
        age: 0,
        life: 0.45 + Math.random() * 0.6,
        size: (5 + Math.random() * 13) * this.unit,
      });
    }
    if (this.glints.length) {
      for (const s of this.glints) s.age += dt;
      this.glints = this.glints.filter((s) => s.age < s.life);
    }
  }

  private paint() {
    const g = this.g!;
    const { w, h, unit } = this;
    g.setTransform(this.res, 0, 0, this.res, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    const cx = this.fx * w;
    const cy = this.fy * h;
    const diag = Math.hypot(w, h);

    // 가운데에서 번지는 빛
    const glow = this.energy * 0.1 + this.pulse * 0.07 + this.rays * 0.16 + this.flash * 0.3;
    if (glow > 0.004) {
      const r = Math.min(w, h) * (0.5 + 0.12 * this.pulse) * this.spread;
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, rgba(GOLD, glow));
      grad.addColorStop(0.45, rgba(GOLD, glow * 0.4));
      grad.addColorStop(1, rgba(GOLD, 0));
      g.fillStyle = grad;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }

    // 빛살: 굵기가 다른 두 겹이 서로 반대로 천천히 돈다
    if (this.rays > 0.01) {
      this.burst(cx, cy, diag * 0.75, 14, this.spin, this.rays * 0.13 + this.flash * 0.1, 0);
      this.burst(cx, cy, diag * 0.55, 9, -this.spin * 1.7, this.rays * 0.1, 7);
    }

    // 스포트라이트
    const len = diag * 1.1;
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i];
      const on = Math.max(0, Math.min(1, (this.time - this.delay - i * 0.11) / 0.45));
      if (on <= 0) continue;
      // 켜지는 동안에는 전구처럼 살짝 깜빡인다
      const warm = on < 1 ? on * (0.55 + 0.45 * Math.sin(this.time * 70 + i * 2)) : 1;
      const ax = b.x * w;
      const ay = -0.06 * h;
      const swing = b.base + Math.sin(b.phase) * b.sway * (1 + this.energy * 0.8);
      const ang = swing + (Math.atan2(cy - ay, cx - ax) - swing) * this.gather;
      const a = warm * (0.075 + this.energy * 0.07 + this.gather * 0.06 + this.flash * 0.12);
      const color = mix(b.color, GOLD, this.gather * 0.7);
      // 폭이 다른 여러 겹을 쌓아 가장자리가 부드럽게 흐려지게 한다
      for (const k of [2.1, 1.55, 1.05, 0.6]) this.cone(ax, ay, ang, b.half * k, len, color, a * 0.36);
    }

    // 충격파
    for (const r of this.rings) {
      const t = r.age - r.delay;
      if (t <= 0 || t >= 1) continue;
      g.lineWidth = (2 + 16 * (1 - t) ** 2) * unit;
      g.strokeStyle = rgba(WHITE, 0.5 * (1 - t) ** 1.6);
      g.beginPath();
      g.arc(cx, cy, 24 * unit + (1 - (1 - t) ** 3) * diag * 0.6, 0, TAU);
      g.stroke();
    }

    // 먼지. 빠르게 움직일 때는 꼬리가 생긴다
    g.lineCap = 'round';
    for (const m of this.motes) {
      const speed = Math.hypot(m.vx, m.vy);
      let a = m.fade * (0.3 + 0.25 * Math.sin(m.twinkle) + Math.min(0.45, speed / 1800));
      // 글자가 있는 가운데는 비워 둔다
      if (this.energy > 0.05) a *= Math.max(0, Math.min(1, (Math.hypot(m.x - cx, m.y - cy) / unit - 90) / 220));
      if (a < 0.02) continue;
      if (speed < 60) {
        g.fillStyle = rgba(m.color, a);
        g.beginPath();
        g.arc(m.x, m.y, m.size * unit, 0, TAU);
        g.fill();
      } else {
        g.strokeStyle = rgba(m.color, a);
        g.lineWidth = m.size * 1.6 * unit;
        g.beginPath();
        g.moveTo(m.x, m.y);
        g.lineTo(m.x - m.vx * 0.05, m.y - m.vy * 0.05);
        g.stroke();
      }
    }

    // 반짝이는 별 (네 갈래)
    for (const s of this.glints) {
      const t = s.age / s.life;
      const size = s.size * Math.sin(Math.PI * t);
      const thin = size * 0.13;
      g.fillStyle = rgba(WHITE, 0.85 * Math.sin(Math.PI * t) * Math.min(1, this.rays * 2));
      g.beginPath();
      g.moveTo(s.x, s.y - size);
      g.lineTo(s.x + thin, s.y - thin);
      g.lineTo(s.x + size, s.y);
      g.lineTo(s.x + thin, s.y + thin);
      g.lineTo(s.x, s.y + size);
      g.lineTo(s.x - thin, s.y + thin);
      g.lineTo(s.x - size, s.y);
      g.lineTo(s.x - thin, s.y - thin);
      g.closePath();
      g.fill();
    }
  }

  /** 한 점에서 뻗어 나가며 흐려지는 빛기둥 */
  private cone(ax: number, ay: number, ang: number, half: number, len: number, color: RGB, alpha: number) {
    const g = this.g!;
    const grad = g.createLinearGradient(ax, ay, ax + Math.cos(ang) * len, ay + Math.sin(ang) * len);
    grad.addColorStop(0, rgba(color, alpha));
    grad.addColorStop(0.5, rgba(color, alpha * 0.36));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(ax + Math.cos(ang - half) * len, ay + Math.sin(ang - half) * len);
    g.lineTo(ax + Math.cos(ang + half) * len, ay + Math.sin(ang + half) * len);
    g.closePath();
    g.fill();
  }

  /** 가운데에서 사방으로 퍼지는 빛살 한 겹 */
  private burst(cx: number, cy: number, radius: number, count: number, turn: number, alpha: number, seed: number) {
    const g = this.g!;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, rgba(GOLD, 0));
    grad.addColorStop(0.12, rgba(GOLD, alpha));
    grad.addColorStop(0.5, rgba(GOLD, alpha * 0.3));
    grad.addColorStop(1, rgba(GOLD, 0));
    g.fillStyle = grad;
    g.beginPath();
    const slice = TAU / count;
    for (let i = 0; i < count; i++) {
      const s = this.seeds[(i + seed) % this.seeds.length];
      const a = turn + (i + s * 0.5) * slice;
      const half = slice * (0.13 + s * 0.2);
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a - half) * radius, cy + Math.sin(a - half) * radius);
      g.lineTo(cx + Math.cos(a + half) * radius, cy + Math.sin(a + half) * radius);
      g.closePath();
    }
    g.fill();
  }
}
