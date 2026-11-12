// 캔버스 색종이와 불꽃. 끝나면 스스로 멈춘다.
interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  tilt: number;
  vt: number;
  color: string;
  /** 0 네모 · 1 동그라미 · 2 리본 */
  kind: 0 | 1 | 2;
  /** 공기 저항. 클수록 금방 느려져 팔랑팔랑 떨어진다 */
  drag: number;
  sway: number;
  phase: number;
  life: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  max: number;
}

const COLORS = ['#ffd43b', '#ffe066', '#ff6b6b', '#63e6be', '#74c0fc', '#f783ac', '#b197fc', '#ffa94d', '#ffffff'];
const TAU = Math.PI * 2;
const LIFE = 7;
/** 연달아 뽑아도 조각이 한없이 쌓이지 않게 한다 */
const MOST = 900;

export class Confetti {
  private pieces: Piece[] = [];
  private sparkles: Spark[] = [];
  private raf = 0;
  private last = 0;
  /** 위에서 내리는 색종이: 남은 시간(초)과 아직 못 뿌린 조각 수 */
  private rainLeft = 0;
  private rainDebt = 0;

  constructor(private canvas: HTMLCanvasElement) {}

  private get still() {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    return { w, h, dpr };
  }

  private piece(x: number, y: number, vx: number, vy: number, scale: number): Piece {
    const r = Math.random();
    const kind = r < 0.72 ? 0 : r < 0.9 ? 1 : 2;
    return {
      x,
      y,
      vx,
      vy,
      w: (kind === 2 ? 5 + Math.random() * 3 : 7 + Math.random() * 7) * scale,
      h: (kind === 2 ? 34 + Math.random() * 30 : 10 + Math.random() * 10) * scale,
      rot: Math.random() * TAU,
      vr: (Math.random() - 0.5) * (kind === 2 ? 3 : 12),
      tilt: Math.random() * TAU,
      vt: 4 + Math.random() * 7,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      kind,
      drag: 1.7 + Math.random() * 1.1,
      sway: (20 + Math.random() * 60) * scale,
      phase: Math.random() * TAU,
      life: 0,
    };
  }

  private run() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** 양쪽 아래에서 가운데 위로 쏘아 올린다 */
  burst(amount = 220) {
    if (this.still) return;
    const { w, h } = this.resize();
    const scale = Math.max(1, w / 1200);
    const reach = Math.hypot(w, h) * 0.62;
    for (let i = 0; i < amount; i++) {
      const left = i % 2 === 0;
      const angle = (left ? -Math.PI / 3 : (-2 * Math.PI) / 3) + (Math.random() - 0.5) * 0.95;
      const p = this.piece(left ? -10 : w + 10, h * (0.78 + Math.random() * 0.2), 0, 0, scale);
      // 저항이 큰 조각도 같은 높이까지 올라가도록 그만큼 세게 쏜다
      const speed = p.drag * reach * (0.35 + Math.random() * 0.65);
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      this.pieces.push(p);
    }
    if (this.pieces.length > MOST) this.pieces.splice(0, this.pieces.length - MOST);
    this.run();
  }

  /** 위에서 천천히 내린다 */
  rain(seconds = 2.4) {
    if (this.still) return;
    this.rainLeft = Math.max(this.rainLeft, seconds);
    this.run();
  }

  /** 한 점에서 튀는 불꽃 */
  sparks(x: number, y: number, amount = 60, power = 1) {
    if (this.still) return;
    const { w } = this.resize();
    const scale = Math.max(1, w / 1200);
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * TAU;
      const speed = (260 + Math.random() ** 2 * 1500) * power * scale;
      this.sparkles.push({
        x,
        y,
        vx: Math.cos(a) * speed * 1.5,
        vy: Math.sin(a) * speed - 120 * power * scale,
        size: (1.1 + Math.random() * 2.1) * scale,
        life: 0,
        max: 0.4 + Math.random() * 0.75,
      });
    }
    this.run();
  }

  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const { w, h, dpr } = this.resize();
    const g = this.canvas.getContext('2d')!;
    const scale = Math.max(1, w / 1200);
    const gravity = 720 * (h / 900);

    if (this.rainLeft > 0) {
      this.rainLeft -= dt;
      this.rainDebt += dt * 70 * (w / 1200);
      while (this.rainDebt >= 1) {
        this.rainDebt--;
        if (this.pieces.length < MOST)
          this.pieces.push(this.piece(Math.random() * w, -20 * scale, (Math.random() - 0.5) * 160, 60 + Math.random() * 240, scale));
      }
    }

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';

    const alive: Piece[] = [];
    for (const p of this.pieces) {
      p.life += dt;
      p.vy += gravity * dt;
      const keep = Math.exp(-p.drag * dt);
      p.vx *= keep;
      p.vy *= keep;
      p.x += (p.vx + Math.sin(p.phase + p.life * 4.5) * p.sway) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.tilt += p.vt * dt;
      if (p.y > h + 60 * scale || p.life > LIFE) continue;
      alive.push(p);
      const flip = Math.cos(p.tilt);
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      // 뒤집힌 면은 조금 어둡게
      g.globalAlpha = Math.min(1, LIFE - p.life) * (flip < 0 ? 0.72 : 1);
      if (p.kind === 0) {
        g.fillStyle = p.color;
        g.fillRect(-p.w / 2, (-p.h / 2) * flip, p.w, p.h * flip);
      } else if (p.kind === 1) {
        g.fillStyle = p.color;
        g.beginPath();
        g.ellipse(0, 0, p.w * 0.55, Math.max(0.6, p.w * 0.55 * Math.abs(flip)), 0, 0, TAU);
        g.fill();
      } else {
        // 리본: 물결치는 띠
        g.strokeStyle = p.color;
        g.lineWidth = p.w * 0.5;
        g.beginPath();
        for (let k = 0; k <= 6; k++) {
          const y = (k / 6 - 0.5) * p.h;
          const x = Math.sin(p.phase + p.life * 9 + k * 1.1) * p.w * 0.9;
          if (k === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      g.restore();
    }
    this.pieces = alive;

    if (this.sparkles.length) {
      const glowing: Spark[] = [];
      g.globalCompositeOperation = 'lighter';
      for (const s of this.sparkles) {
        s.life += dt;
        if (s.life >= s.max) continue;
        glowing.push(s);
        s.vy += gravity * 0.8 * dt;
        const keep = Math.exp(-3.2 * dt);
        s.vx *= keep;
        s.vy *= keep;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        // 흰빛으로 튀어 금빛으로 식는다
        const t = s.life / s.max;
        g.strokeStyle = `rgba(255,${Math.round(246 - 70 * t)},${Math.round(214 - 150 * t)},${(1 - t * t).toFixed(3)})`;
        g.lineWidth = s.size * (1 - t * 0.5);
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.lineTo(s.x - s.vx * 0.035, s.y - s.vy * 0.035);
        g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
      this.sparkles = glowing;
    }

    if (alive.length || this.sparkles.length || this.rainLeft > 0) this.raf = requestAnimationFrame(this.frame);
    else {
      this.raf = 0;
      g.clearRect(0, 0, w, h);
    }
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.rainLeft = 0;
    this.pieces = [];
    this.sparkles = [];
  }
}
