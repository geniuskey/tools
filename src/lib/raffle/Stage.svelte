<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { Tween } from 'svelte/motion';
  import { Backdrop } from './backdrop';
  import { Confetti } from './confetti';
  import * as sound from './sound';
  import { drumPose, reelCurve, reelNames, reelSteps } from './reel';
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
    final: Participant;
    done: boolean;
    /** 릴 없이 글자만 바꿔 보여줄 때의 이름 */
    flick: string;
  }

  /** 릴 하나의 진행 상태. 프레임마다 바뀌므로 화면 상태와 따로 둔다 */
  interface Reel {
    start: number;
    stopAt: number;
    steps: number;
    /** 차례로 지나갈 이름. 비어 있으면 릴 없이 글자만 바꾼다 */
    names: string[];
    center: number;
    pos: number;
    seen: number;
    /** 지금 걸려 있는 흐림 단계 */
    blur: number;
    nextFlip: number;
  }

  /** 한꺼번에 이보다 많이 뽑으면 릴을 돌리지 않고 글자만 바꾼다 */
  const REEL_MAX = 48;
  /** 한 명을 뽑을 때 이름이 붙어 도는 원통: 반지름(em)과 한 칸의 각도 */
  const DRUM_RADIUS = 1.5;
  const DRUM_STEP = 0.8;
  /** 여러 명을 뽑을 때 창 안에서 이름이 지나가는 간격 (em) */
  const PITCH = 1.12;
  /** 당첨 순간 화면이 한 번 흔들린다 */
  const SHAKE: Keyframe[] = [
    { transform: 'translate(0, 0)' },
    { transform: 'translate(-0.5vh, 1vh) rotate(-0.3deg)', offset: 0.12 },
    { transform: 'translate(0.6vh, -0.7vh) rotate(0.22deg)', offset: 0.28 },
    { transform: 'translate(-0.4vh, 0.4vh) rotate(-0.12deg)', offset: 0.46 },
    { transform: 'translate(0.24vh, -0.2vh)', offset: 0.66 },
    { transform: 'translate(-0.1vh, 0.08vh)', offset: 0.84 },
    { transform: 'translate(0, 0)' },
  ];

  const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let root: HTMLDivElement;
  let backCanvas: HTMLCanvasElement;
  let canvas: HTMLCanvasElement;
  let flash: HTMLDivElement;
  let flare: HTMLDivElement;
  let center = $state<HTMLDivElement>();
  let cardsEl = $state<HTMLDivElement>();
  const cardEls: HTMLElement[] = [];
  const drumEls: HTMLElement[] = [];
  let confetti: Confetti | null = null;
  let backdrop: Backdrop | null = null;

  let phase = $state<'idle' | 'rolling' | 'done'>('idle');
  let slots = $state<Slot[]>([]);
  let notice = $state('');
  let fullscreen = $state(false);
  let canFullscreen = $state(false);
  let idle = $state(false);
  let confirmVoid = $state<string | null>(null);
  /** 무대가 막 열리는 중: 막이 걷히고, 글자들은 그 뒤에 나온다 */
  let opening = $state(!still());
  let curtain = $state(!still());
  /** 경품을 넘긴 방향 (다음 1, 이전 -1) */
  let dir = $state(1);
  /** 이번 추첨의 연출 길이 (ms) */
  let lead = $state(2800);

  let reels: Reel[] = [];
  let curve = reelCurve();
  let raf = 0;
  let rollStart = 0;
  let rollEnd = 0;
  let aimed = false;
  let lastTick = 0;
  let idleTimer = 0;
  let noticeTimer = 0;

  const prize = $derived(prizes[Math.min(current, prizes.length - 1)]);
  const winners = $derived(prize ? validWinners(prize) : []);
  const left = $derived(prize ? remaining(prize) : 0);
  const pool = $derived(prize ? eligible(participants, prizes, prize, settings.allowRepeat) : []);
  const drawable = $derived(Math.min(left, pool.length));
  const hasNext = $derived(current < prizes.length - 1);
  /** 부가 정보가 하나도 없는 명단이면 그 줄을 비워 두지 않는다 */
  const withInfo = $derived(settings.showInfo && participants.some((p) => p.info));

  const shown = (name: string) => (settings.mask ? maskName(name) : name);
  const visualLen = (s: string) => [...s].reduce((n, ch) => n + (ch.codePointAt(0)! > 0x2e7f ? 1 : 0.58), 0);
  const maxLen = $derived(Math.min(14, Math.max(3, ...participants.slice(0, 5000).map((p) => visualLen(p.name)))));

  /** 무대 가운데에 보여줄 카드들: 추첨 중에는 이번에 뽑는 사람들, 그 외에는 이 경품의 당첨자 전체 */
  const cards = $derived.by((): { name: string; info: string; done: boolean; key: string }[] => {
    if (phase !== 'idle') return slots.map((s, i) => ({ name: shown(s.done ? s.final.name : s.flick), info: s.final.info, done: s.done, key: `s${i}` }));
    return winners.map((w) => ({ name: shown(w.name), info: w.info, done: true, key: w.key }));
  });
  const single = $derived(cards.length === 1);
  const live = $derived(phase !== 'idle');
  const lite = $derived(live && slots.length > REEL_MAX);
  /** 방금 뽑힌 사람들 (아래 목록에서 새로 튀어나온다) */
  const fresh = $derived(new Set(phase === 'done' ? slots.map((s) => s.final.key) : []));

  const layout = $derived.by(() => {
    const n = Math.max(1, cards.length);
    const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n * 1.9));
    const rows = Math.ceil(n / cols);
    const cellW = 92 / cols;
    const cellH = 58 / rows;
    const infoRoom = withInfo ? 0.42 : 0.6;
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

  /** 글자를 하나씩 따로 움직여도 모양이 깨지지 않는 이름 (한글 · 한자 · 가나 · 로마자 · 숫자) */
  const SPLITTABLE = /^[\uac00-\ud7a3\u3131-\u318e\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u30fcA-Za-z\u00c0-\u024f\p{Nd}\p{P}\p{Zs}]+$/u;
  function letters(text: string): string[] {
    const s = text.normalize('NFC');
    return SPLITTABLE.test(s) ? [...s] : [text];
  }

  // 추첨 대상 인원은 0 부터 세어 올라간다
  const poolShown = new Tween(0, { duration: 900, easing: cubicOut });
  let countedFor: string | null = null;
  $effect(() => {
    const id = prize?.id ?? null;
    const n = pool.length;
    untrack(() => {
      if (still()) poolShown.set(n, { duration: 0 });
      else if (id !== countedFor) {
        countedFor = id;
        poolShown.set(0, { duration: 0 });
        poolShown.set(n, { delay: opening ? 1150 : 380 });
      } else poolShown.set(n, { duration: 300 });
    });
  });

  // 당첨자를 띄워 둔 동안에만 빛살이 남는다
  $effect(() => {
    if (phase === 'idle') backdrop?.rest();
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
    const span = settings.speed === 'fast' ? 900 : settings.speed === 'long' ? 5200 : 2800;
    const gap = n > 1 ? Math.min(380, 4200 / n) : 0;
    const instant = still();
    const now = performance.now();
    // 한 명씩 뽑을 때는 방금 화면에 있던 이름에서 이어서 돌린다
    const first = n === 1 && cards.length === 1 ? cards[0].name : undefined;
    curve = reelCurve(settings.speed === 'fast' ? 0.14 : settings.speed === 'long' ? 0.06 : 0.09);
    reels = picked.map((p, i) => {
      const stopAt = instant ? now : now + span + i * gap;
      const steps = reelSteps(stopAt - now);
      const names = instant || n > REEL_MAX ? [] : reelNames(steps, shown(p.name), () => shown(randomName()), i === 0 ? first : undefined);
      return { start: now, stopAt, steps, names, center: -1, pos: 0, seen: now, blur: 0, nextFlip: now };
    });
    slots = picked.map((p) => ({ final: p, done: false, flick: randomName() }));
    rollStart = now;
    rollEnd = now + span + (n - 1) * gap;
    lead = span;
    aimed = false;
    backdrop?.rest();
    phase = 'rolling';
    confirmVoid = null;
    if (settings.sound) sound.unlock();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  function randomName(): string {
    // 남은 사람이 몇 없으면 같은 이름만 돌게 되므로 전체 명단에서 고른다
    const src = pool.length >= 12 ? pool : participants;
    return src[(Math.random() * src.length) | 0]?.name ?? '';
  }

  /** 지금 이름이 나오는 자리의 가운데 (무대 기준 px) 와 무대 크기 */
  function spot() {
    const stage = root.getBoundingClientRect();
    const el = slots.length === 1 ? cardEls[0]?.querySelector('.slot') : cardsEl;
    const box = (el ?? root).getBoundingClientRect();
    return { x: box.x + box.width / 2 - stage.x, y: box.y + box.height / 2 - stage.y, w: stage.width, h: stage.height };
  }

  function frame(now: number) {
    if (!aimed && cardsEl) {
      aimed = true;
      const s = spot();
      backdrop?.setFocus(s.x / s.w, s.y / s.h, slots.length === 1 ? 1 : 1.5);
    }
    let pending = 0;
    let ticked = false;
    for (let i = 0; i < reels.length; i++) {
      const r = reels[i];
      const s = slots[i];
      if (s.done) continue;
      if (now >= r.stopAt) {
        land(i);
        continue;
      }
      pending++;
      const u = (now - r.start) / (r.stopAt - r.start);
      if (r.names.length) {
        const pos = r.steps * curve(u);
        const speed = ((pos - r.pos) / Math.max(1, now - r.seen)) * 1000;
        r.pos = pos;
        r.seen = now;
        if (paint(i, r, speed)) ticked = true;
      } else if (now >= r.nextFlip) {
        s.flick = randomName();
        r.nextFlip = now + 45 + 300 * u * u * u;
        ticked = true;
      }
    }
    if (ticked) {
      backdrop?.tick();
      if (settings.sound && now - lastTick > 70) {
        lastTick = now;
        sound.tick();
      }
    }
    // 끝으로 갈수록 조명이 빨라지고 먼지가 세차게 날아간다
    // (프레임 시각은 추첨을 누른 시각보다 조금 이를 수 있다)
    const through = Math.min(1, Math.max(0, (now - rollStart) / Math.max(1, rollEnd - rollStart)));
    backdrop?.setEnergy(0.4 + 0.6 * through ** 1.6);
    if (pending) raf = requestAnimationFrame(frame);
    else finish();
  }

  /** 릴 한 칸을 지금 위치대로 그린다. 가운데 이름이 넘어갔으면 true */
  function paint(i: number, r: Reel, speed: number): boolean {
    const drumEl = drumEls[i];
    const lines = drumEl?.children as HTMLCollectionOf<HTMLElement> | undefined;
    if (!lines?.length) return false;
    const half = (lines.length - 1) / 2;
    const c = Math.round(r.pos);
    const moved = c !== r.center;
    if (moved) {
      r.center = c;
      for (let k = 0; k < lines.length; k++) lines[k].textContent = r.names[c + k - half] ?? '';
    }
    // 빠를수록 세로로 늘이고 흐리게 해서 잔상처럼 보이게 한다
    const smear = Math.min(1, Math.max(0, (speed - 6) / 18));
    const drum = lines.length > 3;
    if (drum) {
      const blur = Math.round(smear * 8);
      if (blur !== r.blur) {
        r.blur = blur;
        drumEl.style.filter = blur ? `blur(${(blur * 0.007).toFixed(3)}em)` : '';
      }
    }
    for (let k = 0; k < lines.length; k++) {
      const o = c + k - half - r.pos;
      const el = lines[k];
      if (drum) {
        const p = drumPose(o, DRUM_RADIUS, DRUM_STEP);
        el.style.transform = `translate(-50%, -50%) translateY(${p.y.toFixed(3)}em) scale(${p.sx.toFixed(3)}, ${(p.sy * (1 + smear * 0.7)).toFixed(3)})`;
        el.style.opacity = (p.alpha * (1 - smear * 0.3)).toFixed(3);
      } else {
        el.style.transform = `translate(-50%, -50%) translateY(${(-o * PITCH).toFixed(3)}em) scaleY(${(1 + smear * 0.55).toFixed(3)})`;
        el.style.opacity = (1 - smear * 0.35).toFixed(3);
      }
    }
    return moved && c > 0;
  }

  /** 릴 하나가 멈춘다 */
  function land(i: number) {
    slots[i].done = true;
    if (settings.sound) sound.stop();
    if (slots.length > 1 && reels[i].names.length) {
      // 여러 명일 때는 멈추는 칸마다 작은 불꽃이 튄다
      const box = cardEls[i]?.getBoundingClientRect();
      const stage = root.getBoundingClientRect();
      if (box) confetti?.sparks(box.x + box.width / 2 - stage.x, box.y + box.height * 0.4 - stage.y, 9, 0.4);
    }
  }

  function finish() {
    raf = 0;
    phase = 'done';
    const at = Date.now();
    onwin(
      prize.id,
      slots.map((s) => ({ key: s.final.key, no: s.final.no, name: s.final.name, info: s.final.info, at })),
    );
    if (settings.sound) sound.fanfare();
    celebrate();
  }

  /** 당첨 순간의 연출: 섬광 · 충격파 · 빛살 · 불꽃 · 색종이 */
  function celebrate() {
    if (still()) return;
    const many = slots.length > 1;
    const s = spot();
    root.style.setProperty('--fx', `${s.x}px`);
    root.style.setProperty('--fy', `${s.y}px`);
    backdrop?.reveal(s.x / s.w, s.y / s.h, many ? 1.5 : 1);
    confetti?.sparks(s.x, s.y, many ? 70 : 110, 1);
    confetti?.burst(many ? 320 : 240);
    confetti?.rain(many ? 3 : 2.4);
    flash.animate([{ opacity: many ? 0.5 : 0.75 }, { opacity: 0 }], { duration: 650, easing: 'cubic-bezier(0.2, 0.6, 0.3, 1)' });
    flare.animate(
      [
        { opacity: 0, transform: 'scale(0.12, 1)' },
        { opacity: 1, transform: 'scale(0.75, 1)', offset: 0.16 },
        { opacity: 0, transform: 'scale(1, 0.3)' },
      ],
      { duration: 700, easing: 'ease-out' },
    );
    center?.animate(SHAKE, { duration: 460 });
  }

  function skip() {
    const now = performance.now();
    for (const r of reels) r.stopAt = now;
  }

  function go(delta: number) {
    if (phase === 'rolling') return;
    const next = current + delta;
    if (next < 0 || next >= prizes.length) return;
    dir = delta < 0 ? -1 : 1;
    opening = false;
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
    backdrop = new Backdrop(backCanvas);
    // 막이 걷히는 데 맞춰 조명이 하나씩 켜진다
    backdrop.start(opening ? 0.45 : 0);
    const openTimer = window.setTimeout(() => (opening = false), 2600);
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
      clearTimeout(openTimer);
      confetti?.destroy();
      backdrop?.destroy();
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div
  class="stage"
  class:idle
  class:opening
  class:rolling={phase === 'rolling'}
  class:solo={single}
  style:--dir={dir}
  style:--lead="{lead}ms"
  bind:this={root}
  tabindex="-1"
  role="application"
  aria-label="추첨 무대"
  onpointermove={wake}
  onpointerdown={wake}
  onclick={refocus}
>
  <canvas class="back" bind:this={backCanvas} aria-hidden="true"></canvas>
  <div class="vignette" aria-hidden="true"></div>

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
    <div class="center" bind:this={center}>
      {#key prize.id}
        <div class="prize">
          <span class="prize-name">{prize.name}</span>
          <span class="prize-count">
            {#key winners.length}
              <span class="turn">{#if left === 0}당첨자 {winners.length}명{:else}{prize.count}명 중 {winners.length}명 추첨됨{/if}</span>
            {/key}
          </span>
        </div>

        {#if cards.length === 0}
          <div class="intro">
            <p class="intro-big">
              <span class="sr-only">{prize.count}명을 추첨합니다</span>
              <span aria-hidden="true">
                {#each [`${prize.count}명을`, '추첨합니다'] as word, w}
                  <span class="word">
                    {#each [...word] as ch, j}<span class="rise" class:num={w === 0 && ch >= '0' && ch <= '9'} style:--j={w * 4 + j}>{ch}</span>{/each}
                  </span>{' '}
                {/each}
              </span>
            </p>
            <p class="intro-sub">추첨 대상 {Math.round(poolShown.current).toLocaleString('ko-KR')}명</p>
          </div>
        {:else}
          <div
            class="cards"
            class:single
            class:live
            class:lite
            style:--cols={layout.cols}
            style:--font={layout.font}
            style:--reel={withInfo ? 0.5 : 0.42}
            aria-live="polite"
            bind:this={cardsEl}
          >
            {#each cards as c, i (c.key)}
              <div class="card" class:done={c.done} class:rolling={!c.done} style:--i={i} bind:this={cardEls[i]}>
                <span class="slot">
                  {#if single && live}<span class="band" aria-hidden="true"></span>{/if}
                  {#if !c.done && !lite}
                    <span class="drum" aria-hidden="true" bind:this={drumEls[i]}>
                      {#each { length: single ? 5 : 3 } as _}<span class="line"></span>{/each}
                    </span>
                  {/if}
                  <span class="name">
                    {#if !c.done}
                      {lite ? c.name : '\u00a0'}
                    {:else if single && live}
                      {@const chars = letters(c.name)}
                      <span class="sr-only">{c.name}</span>
                      <span class="chars" aria-hidden="true">
                        {#each chars as ch, j}<span class="ch" data-ch={ch} style:--j={Math.abs(j - (chars.length - 1) / 2)}>{ch}</span>{/each}
                      </span>
                    {:else}
                      {c.name}
                    {/if}
                  </span>
                </span>
                {#if withInfo}<span class="info">{(c.done && c.info) || '\u00a0'}</span>{/if}
              </div>
            {/each}
          </div>
        {/if}
      {/key}
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
              <button class="chip" class:fresh={fresh.has(w.key)} style:--i={i} onclick={() => (confirmVoid = w.key)} title="부재 등으로 당첨 취소">
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
        <button class="primary" class:ready={action.kind === 'draw'} disabled={action.kind === 'none'} onclick={primary}>
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

  <div class="flash" bind:this={flash} aria-hidden="true"></div>
  <div class="flare" bind:this={flare} aria-hidden="true"></div>
  <canvas class="front" bind:this={canvas} aria-hidden="true"></canvas>

  {#if curtain}
    <div class="curtain" aria-hidden="true"></div>
    <div class="curtain right" aria-hidden="true" onanimationend={() => (curtain = false)}></div>
  {/if}

  {#if notice}<div class="notice" role="status">{notice}</div>{/if}
</div>

<style>
  .stage {
    /* 무대가 열리는 동안 글자들이 기다리는 시간 */
    --wait: 0s;
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
  .stage.opening {
    --wait: 0.62s;
  }
  .stage.idle {
    cursor: none;
  }

  /* 뒤: 조명 · 가운데: 글자 · 앞: 색종이와 불꽃 */
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .back,
  .vignette {
    z-index: 1;
  }
  .front,
  .flash,
  .flare {
    z-index: 3;
  }
  .vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(ellipse at 50% 46%, transparent 36%, rgb(4 2 10 / 0.66) 100%);
    opacity: 0.5;
    transition: opacity 0.9s ease;
  }
  .stage.rolling .vignette {
    opacity: 1;
  }
  .flash {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0;
    background: radial-gradient(circle at var(--fx, 50%) var(--fy, 50%), rgb(255 250 235 / 0.95), rgb(255 214 110 / 0.5) 22%, transparent 62%);
  }
  /* 당첨 순간 가로로 길게 번지는 빛 */
  .flare {
    position: absolute;
    left: var(--fx, 50%);
    top: var(--fy, 50%);
    width: 150vw;
    height: 8vh;
    translate: -50% -50%;
    pointer-events: none;
    opacity: 0;
    background: radial-gradient(ellipse 50% 50% at center, rgb(255 252 240 / 0.95), rgb(255 206 120 / 0.35) 28%, transparent 68%);
  }

  /* 막: 가운데에서 갈라져 양옆으로 주름지며 걷힌다 */
  .curtain {
    --edge: 90deg;
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 50.5%;
    z-index: 9;
    pointer-events: none;
    transform-origin: left center;
    background:
      linear-gradient(var(--edge), transparent calc(100% - 0.3vw), rgb(255 214 110 / 0.8) calc(100% - 0.3vw)),
      linear-gradient(var(--edge), transparent 78%, rgb(0 0 0 / 0.55)),
      linear-gradient(180deg, rgb(0 0 0 / 0.5), transparent 22%, transparent 62%, rgb(0 0 0 / 0.75)),
      repeating-linear-gradient(90deg, #26081a 0, #6b1840 1.3vw, #9c2a5b 2.1vw, #5a1436 3vw, #1c0612 4.4vw, #26081a 5vw);
    animation: curtain 1.15s cubic-bezier(0.72, 0, 0.16, 1) 0.14s both;
  }
  .curtain.right {
    --edge: 270deg;
    left: auto;
    right: 0;
    transform-origin: right center;
  }
  @keyframes curtain {
    to {
      transform: scaleX(0);
    }
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
  .stage.opening .event {
    animation: drop 0.7s cubic-bezier(0.2, 0.9, 0.3, 1) 0.5s backwards;
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-1.2em);
    }
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
    transition: scale 0.6s cubic-bezier(0.2, 1.5, 0.4, 1);
  }
  /* 추첨하는 동안 천천히 다가간다 */
  .stage.rolling .center {
    scale: 1.045;
    transition: scale var(--lead) cubic-bezier(0.4, 0, 0.9, 0.6);
  }
  .prize {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8dvh;
    text-align: center;
    transition: opacity 0.4s ease;
  }
  .stage.rolling .prize {
    opacity: 0.7;
  }
  /* 한 명을 뽑을 때는 릴이 위아래로 넓게 돌아서 자리를 비켜 준다 */
  .stage.rolling.solo .prize-count {
    opacity: 0;
  }
  .prize-name {
    font-size: clamp(22px, 5dvh, 72px);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.15;
    /* 위 겹은 가끔 스쳐 지나가는 빛 */
    background:
      linear-gradient(105deg, transparent 42%, rgb(255 255 255 / 0.95) 50%, transparent 58%) 140% 0 / 260% 100% no-repeat,
      linear-gradient(180deg, #fff3bf, #ffd43b 60%, #fab005);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation:
      title-in 0.75s cubic-bezier(0.2, 0.9, 0.25, 1) var(--wait) backwards,
      sheen 7s ease-in-out calc(var(--wait) + 0.9s) infinite;
  }
  @keyframes title-in {
    from {
      opacity: 0;
      transform: translateX(calc(var(--dir) * 6vw)) scale(0.84);
      filter: blur(0.14em);
    }
  }
  @keyframes sheen {
    from {
      background-position:
        140% 0,
        0 0;
    }
    16%,
    to {
      background-position:
        -40% 0,
        0 0;
    }
  }
  .prize-count {
    font-size: clamp(13px, 2dvh, 26px);
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
    transition: opacity 0.3s ease;
    animation: fade-up 0.6s ease-out calc(var(--wait) + 0.12s) backwards;
  }
  .turn {
    display: inline-block;
    animation: turn 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.2) backwards;
  }
  @keyframes turn {
    from {
      opacity: 0;
      transform: translateY(0.7em) scaleY(0.4);
    }
  }
  @keyframes fade-up {
    from {
      opacity: 0;
      transform: translateY(0.9em);
    }
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
  .word {
    display: inline-block;
    white-space: nowrap;
  }
  /* 글자가 하나씩 솟아오른다 */
  .rise {
    display: inline-block;
    animation: rise 0.65s cubic-bezier(0.2, 0.9, 0.3, 1.25) calc(var(--wait) + 0.14s + var(--j) * 38ms) backwards;
  }
  .rise.num {
    background: linear-gradient(180deg, #fff3bf, #ffd43b 60%, #fab005);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translate(calc(var(--dir) * 0.25em), 0.6em) scale(0.7);
      filter: blur(0.08em);
    }
  }
  .intro-sub {
    margin-top: 1.5dvh;
    font-size: clamp(14px, 2.6dvh, 34px);
    opacity: 0.6;
    font-variant-numeric: tabular-nums;
    animation: fade-up 0.6s ease-out calc(var(--wait) + 0.5s) backwards;
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
  /* 이름이 놓이는 자리. 추첨 중에는 이 안에서 릴이 돈다 */
  .slot {
    position: relative;
    display: flex;
    justify-content: center;
    width: 100%;
    border-radius: 0.16em;
    transition:
      background 0.5s ease,
      box-shadow 0.5s ease;
  }
  .name {
    flex: none;
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
  .card.done .name {
    text-shadow: 0 0 0.5em rgb(255 212 59 / 0.45);
  }

  /* 이미 뽑힌 당첨자를 다시 볼 때는 차례로 떠오른다 */
  .cards:not(.live) .card {
    animation: card-in 0.55s cubic-bezier(0.2, 0.9, 0.3, 1.2) calc(var(--wait) + min(var(--i) * 26ms, 0.8s)) backwards;
  }
  @keyframes card-in {
    from {
      opacity: 0;
      transform: translateY(0.35em) scale(0.86);
    }
  }

  /* 릴: 이름이 위에서 내려와 가운데를 지나간다 */
  .drum {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .line {
    position: absolute;
    left: 50%;
    top: 50%;
    font-weight: 800;
    letter-spacing: -0.03em;
    white-space: nowrap;
    opacity: 0;
    transform: translate(-50%, -50%);
    will-change: transform, opacity;
  }
  /* 여러 명: 칸마다 작은 창 */
  .cards.live:not(.single, .lite) .card.rolling .slot {
    overflow: hidden;
    background: rgb(255 255 255 / 0.055);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.09);
  }
  .cards.live:not(.single) .card.done .name {
    animation: pop 0.6s cubic-bezier(0.3, 0, 0.3, 1) backwards;
  }
  @keyframes pop {
    from {
      transform: scale(1);
      color: #ffe066;
    }
    28% {
      transform: scale(1.24);
      color: #ffe066;
    }
  }
  /* 인원이 아주 많으면 릴 없이 글자만 바뀐다 */
  .cards.lite .card.rolling .name {
    opacity: 0.55;
    filter: blur(0.012em);
  }

  /* 한 명: 화면 가운데에서 큰 원통이 돈다. 당첨자 이름보다 작게 돌다가 멈추는 순간 커진다 */
  .cards.single .drum {
    inset: auto;
    left: 50%;
    top: 50%;
    width: 100vw;
    height: 3em;
    translate: -50% -50%;
    font-size: calc(var(--reel) * 1em);
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 26%, #000 74%, transparent);
    mask-image: linear-gradient(to bottom, transparent, #000 26%, #000 74%, transparent);
    animation: drum-in 0.32s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
  }
  @keyframes drum-in {
    from {
      opacity: 0.3;
      transform: scale(calc(1 / var(--reel)));
    }
  }
  /* 가운데 줄을 가리키는 두 금빛 선 */
  .band {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 100vw;
    height: 1.36em;
    font-size: calc(var(--reel) * 1em);
    translate: -50% -50%;
    pointer-events: none;
    opacity: 0;
    background: linear-gradient(90deg, transparent 12%, rgb(255 255 255 / 0.05) 38%, rgb(255 255 255 / 0.05) 62%, transparent 88%);
  }
  .band::before,
  .band::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: max(2px, 0.02em);
    background: linear-gradient(90deg, transparent 8%, rgb(255 212 59 / 0.85) 34%, #fff8dc 50%, rgb(255 212 59 / 0.85) 66%, transparent 92%);
  }
  .band::before {
    top: 0;
  }
  .band::after {
    bottom: 0;
  }
  .card.rolling .band {
    animation: band-in 0.45s cubic-bezier(0.2, 0.9, 0.2, 1) forwards;
  }
  .card.done .band {
    animation: band-out 0.5s ease-out;
  }
  @keyframes band-in {
    from {
      opacity: 0;
      transform: scaleX(0.2);
    }
    to {
      opacity: 1;
    }
  }
  @keyframes band-out {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
      transform: scale(1.2, 2.8);
    }
  }
  /* 당첨자: 릴 크기에서 글자가 가운데부터 튀어 오르고, 달아오른 금빛이 식으며 흰색이 된다 */
  .chars {
    display: inline-block;
  }
  .ch {
    position: relative;
    display: inline-block;
    white-space: pre;
    animation: punch 0.7s cubic-bezier(0.16, 1.5, 0.3, 1) calc(var(--j) * 34ms) backwards;
  }
  .ch::after {
    content: attr(data-ch);
    position: absolute;
    left: 0;
    top: 0;
    color: #ffe066;
    text-shadow: 0 0 0.3em #ffb300;
    opacity: 0;
    animation: cool 1.2s ease-out calc(var(--j) * 34ms) backwards;
  }
  @keyframes punch {
    from {
      transform: scale(var(--reel));
    }
  }
  @keyframes cool {
    from {
      opacity: 1;
    }
    30% {
      opacity: 1;
    }
  }
  .cards.single.live .card.done .info {
    animation: fade-up 0.6s ease-out 0.28s backwards;
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
  .chip.fresh {
    animation: chip-in 0.5s cubic-bezier(0.2, 1.6, 0.4, 1) calc(0.3s + min(var(--i) * 28ms, 0.7s)) backwards;
  }
  @keyframes chip-in {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.6);
    }
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
  .stage.opening .controls {
    animation: fade-up 0.7s cubic-bezier(0.2, 0.9, 0.3, 1) 0.75s backwards;
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
    position: relative;
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
    transition: transform 0.12s ease;
  }
  .primary:hover:not(:disabled) {
    filter: brightness(1.06);
  }
  .primary:active:not(:disabled) {
    transform: scale(0.96);
  }
  .primary:disabled {
    opacity: 0.4;
    cursor: default;
    box-shadow: none;
  }
  /* 추첨할 차례가 되면 버튼 둘레로 빛이 퍼진다 */
  .primary.ready::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    animation: beckon 2.4s ease-out infinite;
  }
  @keyframes beckon {
    from {
      box-shadow: 0 0 0 0 rgb(255 212 59 / 0.55);
    }
    60%,
    to {
      box-shadow: 0 0 0 16px rgb(255 212 59 / 0);
    }
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
    animation: notice-in 0.3s cubic-bezier(0.2, 1.4, 0.4, 1) backwards;
  }
  @keyframes notice-in {
    from {
      opacity: 0;
      transform: translate(-50%, 0.9em) scale(0.92);
    }
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
  /* 움직임을 줄이도록 설정한 사람에게는 연출 없이 결과만 보여 준다 */
  @media (prefers-reduced-motion: reduce) {
    .stage *,
    .stage *::before,
    .stage *::after {
      animation: none !important;
    }
    .curtain {
      display: none;
    }
  }
</style>
