<script lang="ts">
  import { onMount } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import Stage from '$lib/timer/Stage.svelte';
  import { TimerStore } from '$lib/timer/store.svelte';
  import { tone, unlock } from '$lib/raffle/sound';
  import { adjust, advance, clockText, durationText, goto, initial, parseAgenda, pause, phaseOf, remaining, retext, sampleText, schedule, start, type OverMode, type Shared } from '$lib/timer/core';

  const store = new TimerStore();
  const s = $derived(store.s);
  const agenda = $derived(parseAgenda(s.text));

  let now = $state(Date.now());
  /** 발표자 화면: 무대만 보여 주는 두 번째 창 */
  let display = $state(false);
  let mounted = $state(false);
  let stageEl = $state<HTMLElement>();
  let fullscreen = $state(false);
  let draft = $state('');

  // 다른 창에서 상태가 바뀌어 들어오면 시계도 그 순간으로 맞춘다 (낡은 시각으로 계산하면 1초 어긋나 보인다)
  $effect(() => {
    store.s;
    now = Date.now();
  });

  const rem = $derived(remaining(s, now));
  const seg = $derived(agenda[s.index]);
  const phase = $derived(phaseOf(rem, s.warn));
  const total = $derived((seg?.seconds ?? 0) * 1000);
  const finished = $derived(!s.running && rem <= 0 && s.index >= agenda.length - 1 && s.over !== 'count');
  const ends = $derived(schedule(s, agenda, now));
  const hhmm = (t: number) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const nextText = $derived.by(() => {
    const n = agenda[s.index + 1];
    return n ? `다음 · ${n.name} (${durationText(n.seconds)})` : agenda.length > 1 ? '마지막 순서' : '';
  });
  const sum = $derived(agenda.reduce((n, a) => n + a.seconds, 0));

  const set = (next: Shared) => store.set(next);
  const act = {
    toggle: () => {
      unlock();
      set(s.running ? pause(s, Date.now()) : start(rem <= 0 && s.over !== 'count' ? goto(s, agenda, s.index, Date.now()) : s, Date.now()));
    },
    go: (i: number) => set(goto(s, agenda, i, Date.now())),
    add: (ms: number) => set(adjust(s, ms, Date.now())),
    restart: () => set({ ...goto(s, agenda, 0, Date.now()), running: false }),
    message: (m: string) => set({ ...s, message: m.trim() }),
  };

  // 경고음 · 종료음 (발표자 화면에서는 울리지 않는다: 한 대에서 두 번 울리지 않게)
  let heard = { index: -1, rem: 0 };
  function sounds(cur: number) {
    const fresh = heard.index !== s.index || Math.abs(heard.rem - cur) > 1500;
    if (!fresh && s.sound && !display && s.running) {
      if (heard.rem > s.warn * 1000 && cur <= s.warn * 1000 && cur > 0) {
        tone(880, 0, 0.25, 0.12, 'sine');
        tone(880, 0.3, 0.25, 0.12, 'sine');
      } else if (heard.rem > 0 && cur <= 0) {
        for (const [f, at] of [[784, 0], [659, 0.35], [523, 0.7]]) {
          tone(f, at, 0.9, 0.16, 'triangle');
          tone(f * 2, at, 0.6, 0.05, 'sine');
        }
      }
    }
    heard = { index: s.index, rem: cur };
  }

  function tick() {
    const t = Date.now();
    sounds(remaining(store.s, t));
    const next = advance(store.s, parseAgenda(store.s.text), t);
    if (next !== store.s) store.set(next);
    now = t;
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageEl?.requestFullscreen();
    } catch {}
  }
  function openDisplay() {
    window.open('/timer?view=display', 'tools-timer-display', 'popup,width=1280,height=720');
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as HTMLElement).closest('input, textarea, select, button, a, dialog')) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter') act.toggle();
    else if (k === 'arrowright' || k === 'n') act.go(s.index + 1);
    else if (k === 'arrowleft' || k === 'p') act.go(s.index - 1);
    else if (k === 'r') act.go(s.index);
    else if (k === 'arrowup') act.add(60_000);
    else if (k === 'arrowdown') act.add(-60_000);
    else if (k === 'f') toggleFullscreen();
    else if (k === 'escape' && s.message) act.message('');
    else return;
    e.preventDefault();
  }

  onMount(() => {
    display = new URLSearchParams(location.search).get('view') === 'display';
    if (display) document.title = '발표자 화면 — 타이머';
    const stop = store.init();
    draft = store.s.message;
    mounted = true;
    tick();
    const timer = setInterval(tick, 100);
    const onFs = () => (fullscreen = !!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      stop();
      clearInterval(timer);
      document.removeEventListener('fullscreenchange', onFs);
    };
  });

  // 달리는 동안에는 화면이 꺼지지 않게 한다
  $effect(() => {
    if (!s.running || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let gone = false;
    const get = () =>
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (gone) l.release().catch(() => {});
          else lock = l;
        })
        .catch(() => {});
    const onVisible = () => document.visibilityState === 'visible' && get();
    get();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      gone = true;
      lock?.release().catch(() => {});
      document.removeEventListener('visibilitychange', onVisible);
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet stage()}
  <Stage
    name={seg?.name ?? '순서표를 채워 주세요'}
    time={clockText(rem)}
    {phase}
    progress={total ? 1 - rem / total : 0}
    running={s.running}
    position={agenda.length > 1 ? `${s.index + 1} / ${agenda.length}` : ''}
    next={nextText}
    message={s.message}
    clock={s.clock && mounted ? hhmm(now) : ''}
    {finished}
  />
{/snippet}

{#if display}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="display" bind:this={stageEl} ondblclick={toggleFullscreen}>
    {@render stage()}
    {#if !fullscreen}<button class="fs" onclick={toggleFullscreen}>전체 화면 (F)</button>{/if}
  </div>
{:else}
  <ToolShell tool="timer">
    {#snippet actions()}
      <button class="btn sm" onclick={openDisplay} title="프로젝터나 발표자 모니터에 띄울 창을 엽니다. 이 창에서 조작하면 함께 움직입니다.">발표자 화면 열기</button>
    {/snippet}

    <div class="page">
      <section class="panel">
        <div class="head">
          <h2>순서표</h2>
          <span class="sum">{agenda.length}개 · {durationText(sum)}</span>
        </div>
        <textarea
          class="field"
          value={s.text}
          oninput={(e) => set(retext(s, e.currentTarget.value, Date.now()))}
          spellcheck="false"
          aria-label="순서표"
          placeholder={'한 줄에 하나씩: 이름 시간\n\n발표 15\n질의응답 5:30\n쉬는 시간 10분\n\n숫자만 쓰면 분입니다.'}
        ></textarea>
        {#if agenda.length}
          <ol class="list">
            {#each agenda as a, i (i)}
              <li>
                <button class:cur={i === s.index} class:past={i < s.index} onclick={() => act.go(i)} title="이 순서로 이동">
                  <span class="no">{i + 1}</span>
                  <span class="nm">{a.name}</span>
                  <span class="du" class:guess={a.guessed} title={a.guessed ? '시간을 적지 않아 5분으로 잡았습니다' : ''}>{durationText(a.seconds)}</span>
                  <span class="at">{ends[i] && mounted ? `~${hhmm(ends[i]!)}` : ''}</span>
                </button>
              </li>
            {/each}
          </ol>
        {:else}
          <button class="btn sm" onclick={() => set(retext(s, sampleText, Date.now()))}>예시 넣기</button>
        {/if}

        <h2 class="sub">설정</h2>
        <label class="row">
          시간이 다 되면
          <select class="field" value={s.over} onchange={(e) => set({ ...s, over: e.currentTarget.value as OverMode })}>
            <option value="count">초과 시간을 센다</option>
            <option value="next">다음 순서로 넘어간다</option>
            <option value="stop">멈춘다</option>
          </select>
        </label>
        <label class="row">
          경고 색으로 바꾸기
          <select class="field" value={s.warn} onchange={(e) => set({ ...s, warn: +e.currentTarget.value })}>
            {#each [[0, '안 함'], [10, '10초 전'], [30, '30초 전'], [60, '1분 전'], [120, '2분 전'], [300, '5분 전']] as [v, name] (v)}
              <option value={v}>{name}</option>
            {/each}
          </select>
        </label>
        <label class="check"><input type="checkbox" checked={s.sound} onchange={(e) => set({ ...s, sound: e.currentTarget.checked })} /> 경고 · 종료 소리</label>
        <label class="check"><input type="checkbox" checked={s.clock} onchange={(e) => set({ ...s, clock: e.currentTarget.checked })} /> 지금 시각 표시</label>
        <button class="btn sm ghost danger reset" onclick={() => (set({ ...initial(), text: s.text, left: (agenda[0]?.seconds ?? 300) * 1000 }), (draft = ''))}>처음 상태로</button>
      </section>

      <section class="main">
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="stage-box" bind:this={stageEl} ondblclick={toggleFullscreen}>
          {@render stage()}
        </div>

        <div class="controls">
          <button class="btn" onclick={() => act.go(s.index - 1)} disabled={s.index === 0} title="이전 순서 (←)">◀ 이전</button>
          <button class="btn primary go" onclick={act.toggle} disabled={!agenda.length} title="Space">{s.running ? '일시 정지' : rem < total && rem > 0 ? '이어서' : '시작'}</button>
          <button class="btn" onclick={() => act.go(s.index + 1)} disabled={s.index >= agenda.length - 1} title="다음 순서 (→)">다음 ▶</button>
          <span class="gap"></span>
          <button class="btn" onclick={() => act.add(-60_000)} title="1분 줄이기 (↓)">−1분</button>
          <button class="btn" onclick={() => act.add(60_000)} title="1분 늘리기 (↑)">+1분</button>
          <button class="btn" onclick={() => act.go(s.index)} title="이 순서를 처음부터 (R)">다시</button>
          <button class="btn" onclick={act.restart} title="첫 순서로 돌아가 멈춥니다">맨 처음</button>
          <button class="btn" onclick={toggleFullscreen} title="전체 화면 (F)">전체 화면</button>
        </div>

        <form
          class="message"
          onsubmit={(e) => {
            e.preventDefault();
            act.message(draft);
          }}
        >
          <input class="field" bind:value={draft} placeholder="발표자에게 보낼 말 (화면에 크게 띄웁니다)" aria-label="발표자에게 보낼 말" maxlength="80" />
          <button class="btn primary" type="submit" disabled={!draft.trim()}>띄우기</button>
          <button class="btn" type="button" disabled={!s.message} onclick={() => act.message('')}>내리기</button>
          <div class="quick">
            {#each ['5분 남았습니다', '마무리해 주세요', '마이크를 가까이', '질문 받겠습니다'] as q (q)}
              <button type="button" onclick={() => ((draft = q), act.message(q))}>{q}</button>
            {/each}
          </div>
        </form>
        <p class="tips"><kbd>Space</kbd> 시작/정지 · <kbd>←</kbd> <kbd>→</kbd> 순서 · <kbd>↑</kbd> <kbd>↓</kbd> 1분 · <kbd>R</kbd> 다시 · <kbd>F</kbd> 전체 화면</p>
      </section>
    </div>
  </ToolShell>
{/if}

<style>
  .display {
    position: fixed;
    inset: 0;
    background: #0c0e13;
  }
  .fs {
    position: absolute;
    right: 14px;
    bottom: 14px;
    padding: 6px 12px;
    border: 1px solid rgb(255 255 255 / 0.25);
    border-radius: 8px;
    background: rgb(0 0 0 / 0.4);
    color: #fff;
    font-size: 12.5px;
    opacity: 0.6;
  }
  .fs:hover {
    opacity: 1;
  }

  .page {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(270px, 340px) minmax(0, 1fr);
    gap: 14px;
    padding: 14px;
    max-width: 1500px;
    width: 100%;
    margin: 0 auto;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    overflow-y: auto;
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .panel h2 {
    font-size: 15px;
  }
  .sub {
    margin-top: 8px;
  }
  .sum {
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .panel textarea {
    flex: none;
    height: 132px;
    font-size: 13.5px;
    line-height: 1.6;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .list button {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto 50px;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 8px;
    background: none;
    text-align: left;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .list button:hover {
    background: var(--surface-2);
  }
  .list button.cur {
    background: var(--app-soft);
    box-shadow: inset 3px 0 0 var(--app);
    font-weight: 650;
  }
  .list button.past {
    color: var(--faint);
  }
  .no {
    color: var(--faint);
    font-size: 12px;
    text-align: right;
  }
  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .du {
    color: var(--muted);
    font-size: 12.5px;
    white-space: nowrap;
  }
  .du.guess {
    text-decoration: underline dotted;
  }
  .at {
    color: var(--faint);
    font-size: 12px;
    text-align: right;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 13px;
    color: var(--muted);
  }
  .row select {
    width: 168px;
    color: var(--text);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
  }
  .check input {
    accent-color: var(--app);
    margin: 0;
  }
  .reset {
    align-self: flex-start;
    margin-top: auto;
  }

  .main {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    min-height: 0;
  }
  .stage-box {
    flex: 1;
    min-height: 200px;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: var(--shadow-md);
    background: #0c0e13;
  }
  .controls {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .controls .btn {
    height: 38px;
  }
  .go {
    min-width: 108px;
    font-size: 15px;
  }
  .gap {
    flex: 1;
  }
  .message {
    flex: none;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 6px;
  }
  .quick {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .quick button {
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: 99px;
    background: var(--surface);
    font-size: 12px;
    color: var(--muted);
  }
  .quick button:hover {
    border-color: var(--app);
    color: var(--text);
  }
  .tips {
    flex: none;
    font-size: 12px;
    color: var(--faint);
  }

  @media (max-width: 860px) {
    .page {
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 10px;
    }
    /* 무대와 조작 버튼이 먼저, 순서표는 아래 */
    .main {
      order: -1;
    }
    .panel,
    .main {
      flex: none;
      overflow: visible;
    }
    .stage-box {
      flex: none;
      height: 44vh;
    }
    .gap,
    .tips {
      display: none;
    }
  }
</style>
