<script lang="ts">
  import type { Phase } from './core';

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
  } = $props();
</script>

<div class="stage {phase}" class:paused={!running} class:long={time.length > 5} class:has-msg={!!message}>
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
  .stage {
    --ink: #f4f5f7;
    --tone: #8ce99a;
    position: relative;
    container-type: size;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    color: var(--ink);
    background: radial-gradient(120% 90% at 50% 0%, #1d2330, #0c0e13 70%);
    transition: background 0.4s;
    font-variant-numeric: tabular-nums;
    user-select: none;
  }
  .stage.warn {
    --tone: #ffd43b;
    background: radial-gradient(120% 90% at 50% 0%, #4a3a08, #14110a 72%);
  }
  .stage.over {
    --tone: #ff8787;
    background: radial-gradient(120% 90% at 50% 0%, #5c1616, #170a0a 72%);
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
    color: var(--tone);
    text-shadow: 0 0 0.25em color-mix(in srgb, var(--tone) 35%, transparent);
  }
  .long .time {
    font-size: min(21cqw, 52cqh);
  }
  .normal .time {
    color: var(--ink);
    text-shadow: none;
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
    color: var(--tone);
    min-height: 1.5em;
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
