// 작업자에게 정규식을 맡기고, 너무 오래 걸리면 끊는다.
import type { RunResult } from './regex';
import type { Request } from './match.worker';

export type Outcome = { kind: 'ok'; result: RunResult } | { kind: 'timeout' } | { kind: 'error'; message: string } | { kind: 'stale' };

export class RegexRunner {
  private worker: Worker | null = null;
  private seq = 0;
  private pending: { id: number; done: (o: Outcome) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private limit: number;

  constructor(limitMs = 1500) {
    this.limit = limitMs;
  }

  private spawn(): Worker {
    const w = new Worker(new URL('./match.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; result?: RunResult; error?: string }>) => {
      const p = this.pending;
      if (!p || p.id !== e.data.id) return;
      clearTimeout(p.timer);
      this.pending = null;
      p.done(e.data.result ? { kind: 'ok', result: e.data.result } : { kind: 'error', message: e.data.error ?? '' });
    };
    return w;
  }

  private kill() {
    this.worker?.terminate();
    this.worker = null;
  }

  /** 앞서 맡긴 일이 아직 돌고 있으면 그 일은 버린다 (마지막 것만 중요하다) */
  run(req: Omit<Request, 'id'>): Promise<Outcome> {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.done({ kind: 'stale' });
      this.pending = null;
      this.kill();
    }
    this.worker ??= this.spawn();
    const id = ++this.seq;
    return new Promise((done) => {
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.pending = null;
        this.kill();
        done({ kind: 'timeout' });
      }, this.limit);
      this.pending = { id, done, timer };
      this.worker!.postMessage({ ...req, id } satisfies Request);
    });
  }

  dispose() {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
    this.kill();
  }
}
