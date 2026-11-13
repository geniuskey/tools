<script lang="ts">
  import { untrack } from 'svelte';
  import type { Phase, Scene } from './core';
  import { createBackdrop, toneOf, type RGB } from './backdrops';

  let {
    name,
    time,
    phase,
    progress,
    running,
    position,
    next,
    message,
    clock,
    finished,
    backdrop = 'water',
  }: {
    name: string;
    time: string;
    phase: Phase;
    /** 0..1 지난 비율 */
    progress: number;
    running: boolean;
    /** "2 / 4" */
    position: string;
    next: string;
    message: string;
    /** 지금 시각 (빈 글자면 숨김) */
    clock: string;
    finished: boolean;
    backdrop?: Scene;
  } = $props();

  // 뒤에서 흐르는 배경. 그림은 backdrops.ts 가 그리고, 여기서는 진행 · 색 · 빠르기를 부드럽게 다듬어 넘긴다
  let canvas: HTMLCanvasElement;

  $effect(() => {
    const scene = backdrop;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const paint = createBackdrop(scene);
    if (!paint) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 1;
    let H = 1;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      W = canvas.clientWidth || 1;
      H = canvas.clientHeight || 1;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (still) draw(0);
    });
    ro.observe(canvas);

    // 1 을 넘으면 시간을 넘긴 것. 넘긴 만큼은 따로 넘겨준다 (모래는 계속 쌓인다)
    const target = () => Math.min(4, Math.max(0, progress));
    // 처음 값만 읽는다. 여기서 값을 따라가면 초마다 배경이 처음부터 다시 그려진다
    const first = untrack(() => ({ running, tone: toneOf(scene, phase), p: target() }));
    let t = Math.random() * 100;
    let speed = first.running ? 1 : 0.12;
    let p = first.p;
    let energy = first.tone.energy;
    const top: RGB = [...first.tone.top];
    const deep: RGB = [...first.tone.deep];

    function draw(dt: number) {
      const k = still ? 1 : 1 - Math.exp(-dt * 2.5);
      const kc = still ? 1 : 1 - Math.exp(-dt * 0.6); // 색은 몇 초에 걸쳐 은은하게 넘어간다
      const tone = toneOf(scene, phase);
      speed += ((running ? 1 : 0.12) - speed) * k;
      p += (target() - p) * k;
      energy += ((running ? tone.energy : 0.35) - energy) * k;
      for (let i = 0; i < 3; i++) {
        top[i] += (tone.top[i] - top[i]) * kc;
        deep[i] += (tone.deep[i] - deep[i]) * kc;
      }
      t += dt * speed;
      ctx!.clearRect(0, 0, W, H);
      paint!({ ctx: ctx!, W, H, t, dt: dt * speed, p: Math.min(1, p), more: Math.max(0, p - 1), energy, top, deep, running, phase, still });
    }

    if (still) {
      // 움직임을 줄인 환경: 진행과 색만 따라간다
      $effect(() => {
        void [progress, phase, running];
        draw(0);
      });
      return () => ro.disconnect();
    }
    let raf = 0;
    let prev = performance.now();
    const loop = (nowMs: number) => {
      draw(Math.min(0.05, (nowMs - prev) / 1000));
      prev = nowMs;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  });
</script>

<div class="stage {phase}" class:paused={!running} class:long={time.length > 5} class:has-msg={!!message}>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
  <div class="top">
    <span class="pos">{position}</span>
    {#if clock}<span class="clock">{clock}</span>{/if}
  </div>
  <div class="mid">
    <div class="name">{name}</div>
    <div class="time" role="timer" aria-live="off">{time}</div>
    <div class="state">
      {#if finished}모든 순서가 끝났습니다{:else if phase === 'over'}시간 초과{:else if !running}일시 정지{:else}&nbsp;{/if}
    </div>
  </div>
  <div class="bottom">
    <div class="bar"><i style:width="{Math.min(1, Math.max(0, progress)) * 100}%"></i></div>
    <div class="next">{next}</div>
  </div>
  {#if message}
    <div class="msg" role="status"><span>{message}</span></div>
  {/if}
</div>

<style>
  /* 색을 값으로 등록해 두어야 그라데이션까지 부드럽게 넘어간다 */
  @property --tm-tone {
    syntax: '<color>';
    inherits: true;
    initial-value: #8ce99a;
  }
  @property --tm-time {
    syntax: '<color>';
    inherits: true;
    initial-value: #f4f5f7;
  }
  @property --tm-glow {
    syntax: '<color>';
    inherits: true;
    initial-value: transparent;
  }
  @property --tm-bg1 {
    syntax: '<color>';
    inherits: true;
    initial-value: #1d2330;
  }
  @property --tm-bg2 {
    syntax: '<color>';
    inherits: true;
    initial-value: #0c0e13;
  }
  .stage {
    --ink: #f4f5f7;
    --tm-tone: #8ce99a;
    --tm-time: #f4f5f7; /* 숫자 색: 평소에는 흰색, 경고부터 색을 입는다 */
    --tm-glow: rgb(140 233 154 / 0);
    --tm-bg1: #1d2330;
    --tm-bg2: #0c0e13;
    --tone: var(--tm-tone);
    position: relative;
    container-type: size;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    color: var(--ink);
    background: radial-gradient(120% 90% at 50% 0%, var(--tm-bg1), var(--tm-bg2) 71%);
    transition:
      --tm-tone 4s ease-in-out,
      --tm-time 4s ease-in-out,
      --tm-glow 4s ease-in-out,
      --tm-bg1 4s ease-in-out,
      --tm-bg2 4s ease-in-out;
    font-variant-numeric: tabular-nums;
    user-select: none;
  }
  .stage.warn {
    --tm-tone: #ffd43b;
    --tm-time: #ffd43b;
    --tm-glow: rgb(255 212 59 / 0.35);
    --tm-bg1: #4a3a08;
    --tm-bg2: #14110a;
  }
  .stage.over {
    --tm-tone: #ff8787;
    --tm-time: #ff8787;
    --tm-glow: rgb(255 135 135 / 0.35);
    --tm-bg1: #5c1616;
    --tm-bg2: #170a0a;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .top,
  .mid,
  .bottom {
    position: relative;
  }
  .top,
  .bottom {
    flex: none;
    padding: 3cqh 4cqw;
  }
  .top {
    display: flex;
    justify-content: space-between;
    font-size: clamp(11px, 3.2cqh, 30px);
    font-weight: 600;
    opacity: 0.7;
  }
  .mid {
    flex: 1;
    min-height: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    text-align: center;
  }
  .name,
  .state,
  .top,
  .next {
    text-shadow: 0 1px 0.3em rgb(0 0 0 / 0.5);
  }
  .name {
    max-width: 92cqw;
    font-size: clamp(14px, min(6cqw, 9cqh), 90px);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .time {
    font-size: min(30cqw, 52cqh);
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: -0.04em;
    color: var(--tm-time);
    text-shadow:
      0 0.02em 0.08em rgb(0 0 0 / 0.45),
      0 0 0.25em var(--tm-glow);
  }
  .long .time {
    font-size: min(21cqw, 52cqh);
  }
  .paused .time {
    opacity: 0.55;
  }
  .over:not(.paused) .time {
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.6;
    }
  }
  .state {
    font-size: clamp(11px, 3.4cqh, 30px);
    font-weight: 650;
    color: var(--tm-time);
    min-height: 1.5em;
    transition: opacity 4s ease-in-out;
  }
  .normal .state {
    color: var(--ink);
    opacity: 0.6;
  }
  .bar {
    height: max(4px, 1.4cqh);
    border-radius: 99px;
    background: rgb(255 255 255 / 0.12);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    border-radius: 99px;
    background: var(--tone);
    transition: width 0.25s linear;
  }
  .next {
    margin-top: 2cqh;
    font-size: clamp(11px, 3.2cqh, 30px);
    opacity: 0.7;
    min-height: 1.5em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .msg {
    position: absolute;
    inset: auto 0 0 0;
    display: grid;
    place-items: center;
    min-height: 30cqh;
    padding: 3cqh 5cqw;
    background: #fff;
    color: #111;
    text-align: center;
    font-size: clamp(16px, min(7cqw, 11cqh), 120px);
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.25;
    box-shadow: 0 -8px 40px rgb(0 0 0 / 0.5);
    animation: rise 0.25s ease-out;
  }
  @keyframes rise {
    from {
      transform: translateY(100%);
    }
  }
</style>
