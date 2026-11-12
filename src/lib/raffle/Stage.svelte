<script lang="ts">
  import { onMount } from 'svelte';
  import { Confetti } from './confetti';
  import * as sound from './sound';
  import { eligible, maskName, pick, remaining, validWinners, type Participant, type Prize, type Winner } from './core';

  export interface StageSettings {
    allowRepeat: boolean;
    sound: boolean;
    mask: boolean;
    showInfo: boolean;
    speed: 'fast' | 'normal' | 'long';
    batch: 'one' | 'all';
  }

  let {
    title,
    participants,
    prizes,
    settings = $bindable(),
    current = $bindable(0),
    onwin,
    onvoid,
    onclose,
  }: {
    title: string;
    participants: Participant[];
    prizes: Prize[];
    settings: StageSettings;
    current: number;
    onwin: (prizeId: string, winners: Winner[]) => void;
    onvoid: (prizeId: string, key: string) => void;
    onclose: () => void;
  } = $props();

  interface Slot {
    name: string;
    info: string;
    final: Participant;
    stopAt: number;
    nextFlip: number;
    done: boolean;
  }

  let root: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let confetti: Confetti | null = null;

  let phase = $state<'idle' | 'rolling' | 'done'>('idle');
  let slots = $state<Slot[]>([]);
  let notice = $state('');
  let fullscreen = $state(false);
  let canFullscreen = $state(false);
  let idle = $state(false);
  let confirmVoid = $state<string | null>(null);

  let raf = 0;
  let rollStart = 0;
  let lastTick = 0;
  let idleTimer = 0;
  let noticeTimer = 0;

  const prize = $derived(prizes[Math.min(current, prizes.length - 1)]);
  const winners = $derived(prize ? validWinners(prize) : []);
  const left = $derived(prize ? remaining(prize) : 0);
  const pool = $derived(prize ? eligible(participants, prizes, prize, settings.allowRepeat) : []);
  const drawable = $derived(Math.min(left, pool.length));
  const hasNext = $derived(current < prizes.length - 1);

  const shown = (name: string) => (settings.mask ? maskName(name) : name);
  const visualLen = (s: string) => [...s].reduce((n, ch) => n + (ch.codePointAt(0)! > 0x2e7f ? 1 : 0.58), 0);
  const maxLen = $derived(Math.min(14, Math.max(3, ...participants.slice(0, 5000).map((p) => visualLen(p.name)))));

  /** 무대 가운데에 보여줄 카드들: 추첨 중에는 이번에 뽑는 사람들, 그 외에는 이 경품의 당첨자 전체 */
  const cards = $derived.by((): { name: string; info: string; done: boolean; key: string }[] => {
    if (phase !== 'idle') return slots.map((s, i) => ({ name: shown(s.name), info: s.info, done: s.done, key: `s${i}` }));
    return winners.map((w) => ({ name: shown(w.name), info: w.info, done: true, key: w.key }));
  });

  const layout = $derived.by(() => {
    const n = Math.max(1, cards.length);
    const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n * 1.9));
    const rows = Math.ceil(n / cols);
    const cellW = 92 / cols;
    const cellH = 58 / rows;
    const infoRoom = settings.showInfo ? 0.42 : 0.6;
    return { cols, font: `min(${(cellH * infoRoom).toFixed(2)}dvh, ${((cellW * 0.86) / maxLen).toFixed(2)}vw)` };
  });

  const action = $derived.by((): { label: string; kind: 'skip' | 'draw' | 'review' | 'next' | 'none' } => {
    if (phase === 'rolling') return { label: '건너뛰기', kind: 'skip' };
    if (drawable > 0) {
      const n = settings.batch === 'all' ? drawable : 1;
      return { label: n > 1 ? `${n}명 추첨` : '추첨', kind: 'draw' };
    }
    if (phase === 'done' && winners.length > slots.length) return { label: '당첨자 모두 보기', kind: 'review' };
    if (hasNext) return { label: '다음 경품', kind: 'next' };
    return { label: '추첨 완료', kind: 'none' };
  });

  function say(msg: string) {
    notice = msg;
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => (notice = ''), 2600);
  }

  function draw() {
    if (!prize || phase === 'rolling') return;
    if (drawable === 0) {
      say(left === 0 ? '이 경품은 추첨이 끝났습니다' : '추첨할 수 있는 참가자가 남지 않았습니다');
      return;
    }
    const n = settings.batch === 'all' ? drawable : 1;
    // 당첨자는 연출과 무관하게 여기서 확정된다
    const picked = pick(pool, n);
    const lead = settings.speed === 'fast' ? 900 : settings.speed === 'long' ? 5200 : 2800;
    const gap = n > 1 ? Math.min(380, 4200 / n) : 0;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const now = performance.now();
    rollStart = now;
    slots = picked.map((p, i) => ({
      name: randomName(),
      info: '',
      final: p,
      stopAt: reduce ? now : now + lead + i * gap,
      nextFlip: now,
      done: false,
    }));
    phase = 'rolling';
    confirmVoid = null;
    if (settings.sound) sound.unlock();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  function randomName(): string {
    const src = pool.length ? pool : participants;
    return src[(Math.random() * src.length) | 0]?.name ?? '';
  }

  function frame(now: number) {
    let pending = 0;
    let flipped = false;
    for (const s of slots) {
      if (s.done) continue;
      if (now >= s.stopAt) {
        s.name = s.final.name;
        s.info = s.final.info;
        s.done = true;
        if (settings.sound) sound.stop();
        continue;
      }
      pending++;
      if (now >= s.nextFlip) {
        s.name = randomName();
        const p = Math.min(1, (now - rollStart) / (s.stopAt - rollStart));
        s.nextFlip = now + 45 + 300 * p * p * p;
        flipped = true;
      }
    }
    if (flipped && settings.sound && now - lastTick > 70) {
      lastTick = now;
      sound.tick();
    }
    if (pending) raf = requestAnimationFrame(frame);
    else finish();
  }

  function finish() {
    raf = 0;
    phase = 'done';
    const at = Date.now();
    onwin(
      prize.id,
      slots.map((s) => ({ key: s.final.key, no: s.final.no, name: s.final.name, info: s.final.info, at })),
    );
    confetti?.burst(slots.length > 1 ? 320 : 240);
    if (settings.sound) sound.fanfare();
  }

  function skip() {
    const now = performance.now();
    for (const s of slots) s.stopAt = now;
  }

  function go(delta: number) {
    if (phase === 'rolling') return;
    const next = current + delta;
    if (next < 0 || next >= prizes.length) return;
    current = next;
    phase = 'idle';
    slots = [];
    confirmVoid = null;
  }

  function primary() {
    switch (action.kind) {
      case 'skip':
        return skip();
      case 'draw':
        return draw();
      case 'review':
        phase = 'idle';
        return;
      case 'next':
        return go(1);
      default:
        say('모든 추첨이 끝났습니다');
    }
  }

  function voidWinner(key: string) {
    onvoid(prize.id, key);
    confirmVoid = null;
    phase = 'idle';
    slots = [];
    say('당첨을 취소했습니다. 빈 자리를 다시 추첨할 수 있습니다');
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.requestFullscreen();
    } catch {
      say('이 브라우저에서는 전체 화면을 쓸 수 없습니다');
    }
  }

  function close() {
    if (phase === 'rolling') skip();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onclose();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    // Tab 으로 버튼에 초점을 둔 경우에는 그 버튼이 눌리게 둔다
    if ((k === ' ' || k === 'Enter') && (e.target as HTMLElement).closest('button')) return wake();
    if (k === ' ' || k === 'Enter') {
      e.preventDefault();
      primary();
    } else if (k === 'ArrowRight' || k === 'n' || k === 'N') go(1);
    else if (k === 'ArrowLeft' || k === 'p' || k === 'P') go(-1);
    else if (k === 'f' || k === 'F') toggleFullscreen();
    else if (k === 'm' || k === 'M') settings.sound = !settings.sound;
    else if (k === 'a' || k === 'A') settings.batch = settings.batch === 'all' ? 'one' : 'all';
    else if (k === 'Escape') {
      if (confirmVoid) confirmVoid = null;
      else if (!document.fullscreenElement) close();
    } else return;
    wake();
  }

  function refocus(e: MouseEvent) {
    // 마우스로 누른 뒤에도 Space 가 항상 추첨으로 동작하도록 초점을 무대로 돌려놓는다
    if (!(e.target as HTMLElement).closest('.confirm')) root.focus();
  }

  function wake() {
    idle = false;
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => (idle = true), 3500);
  }

  onMount(() => {
    confetti = new Confetti(canvas);
    canFullscreen = !!root.requestFullscreen;
    const onFs = () => (fullscreen = document.fullscreenElement === root);
    document.addEventListener('fullscreenchange', onFs);
    wake();
    root.focus();

    // 추첨 도중 화면이 꺼지지 않도록
    let lock: WakeLockSentinel | null = null;
    const acquire = () => {
      navigator.wakeLock
        ?.request('screen')
        .then((l) => (lock = l))
        .catch(() => {});
    };
    acquire();
    const onVisible = () => document.visibilityState === 'visible' && acquire();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(idleTimer);
      clearTimeout(noticeTimer);
      confetti?.destroy();
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div class="stage" class:idle={idle} bind:this={root} tabindex="-1" role="application" aria-label="추첨 무대" onpointermove={wake} onpointerdown={wake} onclick={refocus}>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>

  <header class="chrome">
    <span class="event">{title || '추첨'}</span>
    <div class="right">
      <button class="icon" onclick={() => (settings.sound = !settings.sound)} aria-pressed={settings.sound} title="효과음 (M)">
        {settings.sound ? '소리 켜짐' : '소리 꺼짐'}
      </button>
      {#if canFullscreen}
        <button class="icon" onclick={toggleFullscreen} title="전체 화면 (F)">{fullscreen ? '전체 화면 끝내기' : '전체 화면'}</button>
      {/if}
      <button class="icon" onclick={close} title="무대 닫기 (Esc)">닫기</button>
    </div>
  </header>

  {#if prize}
    <div class="center">
      <div class="prize">
        <span class="prize-name">{prize.name}</span>
        <span class="prize-count">
          {#if left === 0}당첨자 {winners.length}명{:else}{prize.count}명 중 {winners.length}명 추첨됨{/if}
        </span>
      </div>

      {#if cards.length === 0}
        <div class="intro">
          <p class="intro-big">{prize.count}명을 추첨합니다</p>
          <p class="intro-sub">추첨 대상 {pool.length.toLocaleString('ko-KR')}명</p>
        </div>
      {:else}
        <div class="cards" class:single={cards.length === 1} style:--cols={layout.cols} style:--font={layout.font} aria-live="polite">
          {#each cards as c (c.key)}
            <div class="card" class:done={c.done} class:rolling={!c.done}>
              <span class="name">{c.name}</span>
              {#if settings.showInfo}<span class="info">{c.done ? c.info : ' '}</span>{/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <footer class="chrome">
      {#if winners.length && phase !== 'rolling'}
        <div class="chips" aria-label="이 경품의 당첨자">
          {#each winners as w, i (w.key)}
            {#if confirmVoid === w.key}
              <span class="chip confirm">
                {shown(w.name)} 당첨을 취소할까요?
                <button onclick={() => voidWinner(w.key)}>취소하기</button>
                <button onclick={() => (confirmVoid = null)}>아니오</button>
              </span>
            {:else}
              <button class="chip" onclick={() => (confirmVoid = w.key)} title="부재 등으로 당첨 취소">
                <b>{i + 1}</b>{shown(w.name)}
              </button>
            {/if}
          {/each}
        </div>
      {/if}

      <div class="controls">
        <button class="nav" disabled={current === 0 || phase === 'rolling'} onclick={() => go(-1)} aria-label="이전 경품">←</button>
        <div class="batch" role="group" aria-label="추첨 방식">
          <button aria-pressed={settings.batch === 'one'} onclick={() => (settings.batch = 'one')}>한 명씩</button>
          <button aria-pressed={settings.batch === 'all'} onclick={() => (settings.batch = 'all')}>한꺼번에</button>
        </div>
        <button class="primary" disabled={action.kind === 'none'} onclick={primary}>
          {action.label}
          <kbd>Space</kbd>
        </button>
        <span class="pos">{current + 1} / {prizes.length}</span>
        <button class="nav" disabled={!hasNext || phase === 'rolling'} onclick={() => go(1)} aria-label="다음 경품">→</button>
      </div>
    </footer>
  {:else}
    <div class="center"><p class="intro-big">경품을 먼저 추가하세요</p></div>
  {/if}

  {#if notice}<div class="notice" role="status">{notice}</div>{/if}
</div>

<style>
  .stage {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    color: #fff;
    background:
      radial-gradient(90% 70% at 50% 0%, rgb(214 51 108 / 0.34), transparent 70%),
      radial-gradient(70% 60% at 85% 100%, rgb(103 65 217 / 0.3), transparent 70%),
      radial-gradient(60% 50% at 10% 90%, rgb(232 89 12 / 0.16), transparent 70%),
      #0d0b14;
    outline: 0;
    overflow: hidden;
    user-select: none;
  }
  .stage.idle {
    cursor: none;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 3;
  }
  .chrome {
    position: relative;
    z-index: 4;
    transition: opacity 0.5s ease;
  }
  .stage.idle .chrome :is(.right, .controls) {
    opacity: 0;
    transition: opacity 0.8s ease;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2.2dvh 2.4vw;
    gap: 16px;
  }
  .event {
    font-size: clamp(15px, 2.2dvh, 30px);
    font-weight: 700;
    letter-spacing: -0.01em;
    opacity: 0.85;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .right {
    display: flex;
    gap: 6px;
    flex: none;
    transition: opacity 0.2s;
  }
  .icon {
    border: 1px solid rgb(255 255 255 / 0.2);
    background: rgb(255 255 255 / 0.06);
    color: rgb(255 255 255 / 0.85);
    border-radius: 99px;
    height: 32px;
    padding: 0 13px;
    font-size: 12.5px;
    font-weight: 600;
  }
  .icon:hover {
    background: rgb(255 255 255 / 0.16);
  }

  .center {
    position: relative;
    z-index: 2;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3dvh;
    padding: 0 4vw;
  }
  .prize {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8dvh;
    text-align: center;
  }
  .prize-name {
    font-size: clamp(22px, 5dvh, 72px);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.15;
    background: linear-gradient(180deg, #fff3bf, #ffd43b 60%, #fab005);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .prize-count {
    font-size: clamp(13px, 2dvh, 26px);
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }
  .intro {
    text-align: center;
  }
  .intro-big {
    font-size: clamp(30px, 9dvh, 130px);
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1.2;
  }
  .intro-sub {
    margin-top: 1.5dvh;
    font-size: clamp(14px, 2.6dvh, 34px);
    opacity: 0.6;
    font-variant-numeric: tabular-nums;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    gap: 1.2dvh 1vw;
    width: 92vw;
    max-height: 62dvh;
    justify-items: center;
    align-content: center;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-width: 0;
    font-size: var(--font);
    line-height: 1.12;
    text-align: center;
  }
  .name {
    font-weight: 800;
    letter-spacing: -0.03em;
    white-space: nowrap;
  }
  .info {
    font-size: 0.3em;
    font-weight: 600;
    opacity: 0.72;
    margin-top: 0.25em;
    white-space: nowrap;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: 0;
  }
  .cards:not(.single) .info {
    font-size: max(0.34em, 11px);
  }
  .card.rolling .name {
    opacity: 0.55;
    filter: blur(0.012em);
  }
  .card.done .name {
    text-shadow: 0 0 0.5em rgb(255 212 59 / 0.45);
    animation: pop 0.5s cubic-bezier(0.2, 1.6, 0.4, 1);
  }
  @keyframes pop {
    from {
      transform: scale(0.72);
      opacity: 0.4;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  footer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.6dvh;
    padding: 1.5dvh 2.4vw max(2.4dvh, env(safe-area-inset-bottom));
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    max-height: 9dvh;
    overflow: auto;
    max-width: 94vw;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 11px 0 4px;
    border-radius: 99px;
    border: 1px solid rgb(255 255 255 / 0.16);
    background: rgb(255 255 255 / 0.07);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
  }
  .chip b {
    display: grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding: 0 4px;
    border-radius: 99px;
    background: rgb(255 212 59 / 0.9);
    color: #1a1400;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  button.chip:hover {
    background: rgb(255 255 255 / 0.18);
  }
  .chip.confirm {
    padding: 0 4px 0 12px;
    background: rgb(255 107 107 / 0.25);
    border-color: rgb(255 107 107 / 0.7);
  }
  .chip.confirm button {
    border: 0;
    height: 20px;
    padding: 0 9px;
    border-radius: 99px;
    font-size: 11.5px;
    font-weight: 700;
    background: #fff;
    color: #111;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 10px;
    transition: opacity 0.2s;
  }
  .nav {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 1px solid rgb(255 255 255 / 0.2);
    background: rgb(255 255 255 / 0.06);
    color: #fff;
    font-size: 17px;
  }
  .nav:hover:not(:disabled) {
    background: rgb(255 255 255 / 0.16);
  }
  .nav:disabled {
    opacity: 0.25;
    cursor: default;
  }
  .batch {
    display: flex;
    padding: 3px;
    border-radius: 99px;
    background: rgb(255 255 255 / 0.1);
  }
  .batch button {
    border: 0;
    background: transparent;
    color: rgb(255 255 255 / 0.7);
    height: 30px;
    padding: 0 13px;
    border-radius: 99px;
    font-size: 12.5px;
    font-weight: 650;
  }
  .batch button[aria-pressed='true'] {
    background: #fff;
    color: #111;
  }
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    height: 46px;
    padding: 0 22px;
    border: 0;
    border-radius: 99px;
    background: linear-gradient(180deg, #ffe066, #fab005);
    color: #1a1400;
    font-size: 16px;
    font-weight: 800;
    box-shadow: 0 6px 24px rgb(250 176 5 / 0.35);
  }
  .primary:hover:not(:disabled) {
    filter: brightness(1.06);
  }
  .primary:disabled {
    opacity: 0.4;
    cursor: default;
    box-shadow: none;
  }
  .primary kbd {
    background: rgb(0 0 0 / 0.12);
    border-color: rgb(0 0 0 / 0.25);
    color: inherit;
  }
  .pos {
    font-size: 12.5px;
    opacity: 0.6;
    font-variant-numeric: tabular-nums;
    min-width: 40px;
    text-align: center;
  }
  .notice {
    position: absolute;
    z-index: 5;
    left: 50%;
    bottom: 16dvh;
    transform: translateX(-50%);
    padding: 9px 18px;
    border-radius: 99px;
    background: rgb(0 0 0 / 0.72);
    border: 1px solid rgb(255 255 255 / 0.2);
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
  }
  @media (max-width: 560px) {
    .primary kbd,
    .pos {
      display: none;
    }
    .controls {
      gap: 6px;
    }
  }
</style>
