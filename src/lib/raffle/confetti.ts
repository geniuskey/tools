// 캔버스 색종이. 끝나면 스스로 멈춘다.
interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  color: string;
  tilt: number;
  life: number;
}

const COLORS = ['#ffd43b', '#ff6b6b', '#63e6be', '#74c0fc', '#f783ac', '#b197fc', '#ffa94d', '#ffffff'];

export class Confetti {
  private pieces: Piece[] = [];
  private raf = 0;
  private last = 0;

  constructor(private canvas: HTMLCanvasElement) {}

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

  burst(amount = 220) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const { w, h } = this.resize();
    const scale = Math.max(1, w / 1200);
    for (let i = 0; i < amount; i++) {
      // 양쪽 아래에서 가운데 위로 쏘아 올린다
      const left = i % 2 === 0;
      const angle = (left ? -Math.PI / 3 : (-2 * Math.PI) / 3) + (Math.random() - 0.5) * 0.9;
      const speed = (700 + Math.random() * 900) * Math.sqrt(scale);
      this.pieces.push({
        x: left ? -10 : w + 10,
        y: h * (0.75 + Math.random() * 0.2),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: (7 + Math.random() * 7) * scale,
        h: (10 + Math.random() * 10) * scale,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 12,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        tilt: Math.random() * Math.PI,
        life: 0,
      });
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const { w, h, dpr } = this.resize();
    const g = this.canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const alive: Piece[] = [];
    for (const p of this.pieces) {
      p.life += dt;
      p.vy += 900 * dt;
      p.vx *= 1 - 0.9 * dt;
      p.vy *= 1 - 0.6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.tilt += 6 * dt;
      if (p.y > h + 40 || p.life > 7) continue;
      alive.push(p);
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.globalAlpha = Math.min(1, 7 - p.life);
      g.fillStyle = p.color;
      g.fillRect(-p.w / 2, (-p.h / 2) * Math.cos(p.tilt), p.w, p.h * Math.cos(p.tilt));
      g.restore();
    }
    this.pieces = alive;
    if (alive.length) this.raf = requestAnimationFrame(this.frame);
    else {
      this.raf = 0;
      g.clearRect(0, 0, w, h);
    }
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.pieces = [];
  }
}
