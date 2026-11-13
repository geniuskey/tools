<script lang="ts">
  import { onMount } from 'svelte';
  import { WEEKDAYS, fromDay, iso, toDay, weekday } from './core';
  import { CITIES, cityName, daySlots, findOverlap, fmtClock, fmtDiff, fmtOffset, isZone, utcOf, wallOf, type Span } from './zones';
  import { st } from './state.svelte';

  const STEP = 30;
  const p2 = (v: number) => String(v).padStart(2, '0');

  // 고른 순간. 날짜와 시각은 첫 줄(기준) 도시의 것
  let date = $state('');
  let minutes = $state(600);
  let live = $state(true);

  const home = $derived(st.zones[0]);
  function setNow() {
    const w = wallOf(home, Date.now());
    date = iso(toDay(w.y, w.m, w.d));
    minutes = Math.floor((w.h * 60 + w.mi) / STEP) * STEP;
    live = true;
  }
  onMount(setNow);

  const ymd = $derived(fromDay(st.day(date)));
  const hours = $derived({ from: st.workFrom * 60, to: st.workTo * 60 });
  const slots = $derived(daySlots(st.zones, ymd.y, ymd.m, ymd.d, hours, STEP));
  const utc = $derived(utcOf(home, ymd.y, ymd.m, ymd.d, Math.floor(minutes / 60), minutes % 60));
  // 서머타임으로 하루가 23 · 25시간인 날에도 맞는 칸을 찾는다
  const cursor = $derived(Math.max(0, slots.findLastIndex((s) => s.utc <= utc)));
  const overlap = $derived(findOverlap(slots));
  const rows = $derived(
    st.zones.map((tz, i) => {
      const w = wallOf(tz, utc);
      return { tz, i, w, name: cityName(tz), diff: w.offset - wallOf(home, utc).offset, cells: slots.map((s) => ({ w: s.walls[i], state: s.states[i] })) };
    }),
  );

  const dayText = (w: { m: number; d: number; wd: number }) => `${w.m}월 ${w.d}일 (${WEEKDAYS[w.wd]})`;
  function pick(i: number) {
    const w = slots[i].walls[0];
    minutes = w.h * 60 + w.mi;
    live = false;
  }
  function spanText(s: Span) {
    const a = slots[s.from].walls[0];
    const last = slots[s.to - 1].walls[0];
    const end = last.h * 60 + last.mi + STEP;
    const len = (s.to - s.from) * STEP;
    return `${fmtClock(a.h, a.mi)} ~ ${fmtClock(Math.floor(end / 60) % 24, end % 60)} (${len >= 60 ? `${Math.floor(len / 60)}시간` : ''}${len % 60 ? ` ${len % 60}분` : ''})`.replace('( ', '(');
  }
  function onKey(e: KeyboardEvent) {
    const k = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!k) return;
    e.preventDefault();
    pick(Math.max(0, Math.min(slots.length - 1, cursor + k)));
  }
  const text = $derived(rows.map((r) => `${r.name} ${dayText(r.w)} ${fmtClock(r.w.h, r.w.mi)}${r.i ? ` (${fmtDiff(r.diff)})` : ''}`).join('\n'));

  // ── 도시 넣기 ──
  let query = $state('');
  let all: string[] = [];
  onMount(() => {
    try {
      all = Intl.supportedValuesOf('timeZone');
    } catch {}
  });
  const found = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const known = CITIES.filter((c) => `${c.name} ${c.find} ${c.tz}`.toLowerCase().includes(q)).map((c) => c.tz);
    const rest = all.filter((tz) => !known.includes(tz) && tz.toLowerCase().replace(/_/g, ' ').includes(q));
    return [...known, ...rest].filter((tz) => !st.zones.includes(tz)).slice(0, 8);
  });
  function add(tz: string) {
    if (!isZone(tz) || st.zones.includes(tz) || st.zones.length >= 8) return;
    st.zones.push(tz);
    query = '';
  }
  function makeHome(i: number) {
    const [tz] = st.zones.splice(i, 1);
    st.zones.unshift(tz);
    // 같은 순간을 새 기준 도시의 시각으로 다시 적는다
    const w = wallOf(tz, utc);
    date = iso(toDay(w.y, w.m, w.d));
    minutes = w.h * 60 + w.mi;
  }
</script>

<div class="page zones">
  <section class="card top">
    <div class="when">
      <label class="f"><span>{cityName(home)} 날짜</span><input class="field" type="date" min="1970-01-01" max="2100-12-31" value={iso(st.day(date))} onchange={(e) => e.currentTarget.value && ((date = e.currentTarget.value), (live = false))} /></label>
      <label class="f"><span>시각</span><input class="field" type="time" step="900" value="{p2(Math.floor(minutes / 60))}:{p2(minutes % 60)}" onchange={(e) => { const [h, m] = e.currentTarget.value.split(':').map(Number); if (Number.isFinite(h)) { minutes = h * 60 + (m || 0); live = false; } }} aria-label="시각" /></label>
      <button class="btn" onclick={setNow} aria-pressed={live}>지금</button>
      <label class="f hrs"><span>근무 시간</span>
        <span class="range">
          <select class="field" bind:value={st.workFrom} aria-label="근무 시작">{#each Array(24) as _, h (h)}<option value={h} disabled={h >= st.workTo}>{h}시</option>{/each}</select>
          ~
          <select class="field" bind:value={st.workTo} aria-label="근무 끝">{#each Array(24) as _, h (h)}<option value={h + 1} disabled={h + 1 <= st.workFrom}>{h + 1}시</option>{/each}</select>
        </span>
      </label>
      <button class="btn copy" onclick={() => st.copy(text, '시각을')}>복사</button>
    </div>
    <div class="verdict" class:bad={overlap.kind === 'none'} aria-live="polite" data-testid="overlap">
      {#if st.zones.length < 2}
        <span>도시를 더 넣으면 겹치는 근무 시간을 찾아 줍니다.</span>
      {:else if overlap.kind === 'all'}
        <b>모두 근무 시간</b>
      {:else if overlap.kind === 'awake'}
        <b>모두 근무 시간인 때는 없습니다.</b><span>그나마 모두 깨어 있는 때</span>
      {:else}
        <b>겹치는 때가 없습니다.</b><span>이날은 어느 시각이든 누군가는 한밤중(오후 10시 ~ 오전 7시)입니다.</span>
      {/if}
      {#each overlap.spans as s (s.from)}
        <button class="span" onclick={() => pick(s.from)}>{cityName(home)} {spanText(s)}</button>
      {/each}
    </div>
  </section>

  <section class="card board" aria-label="도시마다 시각">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="rows" role="slider" tabindex="0" aria-label="시각 고르기 (좌우 화살표로 30분씩)" aria-valuemin={0} aria-valuemax={slots.length - 1} aria-valuenow={cursor} aria-valuetext={fmtClock(Math.floor(minutes / 60), minutes % 60)} onkeydown={onKey}>
      {#each rows as r (r.tz)}
        <div class="row" class:home={r.i === 0}>
          <div class="who">
            <b>{r.name}</b>
            <span class="clock" data-testid="clock">{fmtClock(r.w.h, r.w.mi)}</span>
            <span class="meta">{dayText(r.w)} · {r.i ? fmtDiff(r.diff) : `UTC${fmtOffset(r.w.offset)}`}</span>
            <span class="acts">
              {#if r.i}<button class="btn sm ghost" onclick={() => makeHome(r.i)} title="이 도시를 기준으로">기준으로</button>{/if}
              {#if st.zones.length > 1}<button class="btn sm ghost" onclick={() => st.zones.splice(r.i, 1)} aria-label="{r.name} 빼기">✕</button>{/if}
            </span>
          </div>
          <div class="strip" style:--n={slots.length}>
            {#each r.cells as c, i (i)}
              <button
                class={c.state}
                class:cur={i === cursor}
                class:midnight={c.w.h === 0 && c.w.mi === 0 && i > 0}
                tabindex="-1"
                aria-label="{r.name} {dayText(c.w)} {fmtClock(c.w.h, c.w.mi)}"
                onclick={() => pick(i)}
              >{#if c.w.mi === 0}<span>{c.w.h}</span>{/if}</button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
    <div class="legend">
      <span><i class="work"></i>근무 시간 (평일 {st.workFrom}시 ~ {st.workTo}시)</span>
      <span><i class="awake"></i>깨어 있는 시간</span>
      <span><i class="night"></i>밤</span>
    </div>
    <div class="adder">
      <input class="field" bind:value={query} placeholder="도시 · 나라 넣기 (예: 뉴욕, 베트남, berlin)" aria-label="도시 넣기" disabled={st.zones.length >= 8} onkeydown={(e) => e.key === 'Enter' && found[0] && add(found[0])} />
      {#if found.length}
        <ul class="found">
          {#each found as tz (tz)}
            <li><button onclick={() => add(tz)}><b>{cityName(tz)}</b><span>{tz} · UTC{fmtOffset(wallOf(tz, utc).offset)}</span></button></li>
          {/each}
        </ul>
      {:else if query.trim()}
        <p class="hint">찾지 못했습니다. 영어 도시 이름이나 Asia/Almaty 같은 시간대 이름으로도 찾을 수 있습니다.</p>
      {/if}
    </div>
  </section>
</div>

<style>
  .zones {
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
  }
  .when {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 8px;
  }
  .when .btn[aria-pressed='true'] {
    border-color: var(--app);
    background: var(--app-soft);
  }
  .range {
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: 400;
  }
  .copy {
    margin-left: auto;
  }
  .verdict {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    font-size: 13.5px;
    color: var(--muted);
  }
  .verdict b {
    color: var(--text);
  }
  .verdict.bad b {
    color: var(--bad);
  }
  .span {
    padding: 3px 11px;
    border: 1px solid var(--app-line);
    border-radius: 99px;
    background: var(--app-soft);
    font-size: 13px;
    font-weight: 650;
  }
  .span:hover {
    border-color: var(--app);
  }
  .rows {
    display: grid;
    gap: 10px;
    border-radius: 8px;
  }
  .row {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
  }
  .who {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0 6px;
    min-width: 0;
  }
  .who b {
    font-size: 13.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .home .who b::after {
    content: '기준';
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 99px;
    background: var(--surface-3);
    font-size: 10.5px;
    font-weight: 600;
    color: var(--muted);
  }
  .clock {
    grid-column: 1;
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .meta {
    grid-column: 1 / -1;
    font-size: 12px;
    color: var(--muted);
  }
  .acts {
    grid-column: 2;
    grid-row: 1 / span 2;
    display: flex;
    align-items: start;
  }
  .acts .btn {
    height: 24px;
    padding: 0 6px;
    font-size: 11.5px;
    color: var(--faint);
  }
  .strip {
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    height: 38px;
    border-radius: 8px;
    overflow: hidden;
  }
  .strip button {
    min-width: 0;
    padding: 0;
    border: 0;
    border-left: 2px solid transparent;
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    position: relative;
  }
  /* 숫자는 옆 칸 위로 넘쳐도 보이게 띄운다 */
  .strip span {
    position: absolute;
    left: 2px;
    top: 50%;
    z-index: 2;
    transform: translateY(-50%);
    pointer-events: none;
    white-space: nowrap;
  }
  .strip .work {
    background: color-mix(in srgb, var(--app) 62%, var(--surface));
    color: var(--on-app);
    font-weight: 700;
  }
  .strip .awake {
    background: var(--app-soft);
    color: var(--muted);
  }
  .strip .night {
    background: var(--surface-3);
    color: var(--faint);
  }
  .strip .midnight {
    border-left-color: var(--text);
  }
  .strip .cur {
    box-shadow: inset 0 0 0 2px var(--text);
    position: relative;
    z-index: 1;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 12px;
    color: var(--muted);
  }
  .legend i {
    display: inline-block;
    width: 12px;
    height: 12px;
    margin-right: 5px;
    border-radius: 3px;
    vertical-align: -1px;
  }
  .legend .work {
    background: color-mix(in srgb, var(--app) 62%, var(--surface));
  }
  .legend .awake {
    background: var(--app-soft);
    box-shadow: inset 0 0 0 1px var(--app-line);
  }
  .legend .night {
    background: var(--surface-3);
  }
  .adder {
    display: grid;
    gap: 6px;
    max-width: 460px;
  }
  .found {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .found button {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    font-size: 13.5px;
  }
  .found button:hover {
    background: var(--app-soft);
  }
  .found span {
    font-size: 12px;
    color: var(--faint);
  }
  @media (max-width: 820px) {
    .row {
      grid-template-columns: 1fr;
      gap: 4px;
    }
    .who {
      grid-template-columns: minmax(0, auto) auto 1fr;
      align-items: baseline;
      gap: 0 8px;
    }
    .clock {
      grid-column: 2;
      grid-row: 1;
      font-size: 15px;
      white-space: nowrap;
    }
    .meta {
      grid-column: 1 / -1;
      grid-row: 2;
    }
    .acts {
      grid-column: 3;
      grid-row: 1;
      justify-self: end;
    }
    .strip button {
      font-size: 9.5px;
      border-left-width: 1px;
    }
    .strip span {
      left: 1px;
    }
    /* 좁으면 세 시간마다만 적는다 */
    .strip button:not(:nth-child(6n + 1)) span {
      display: none;
    }
    .copy {
      margin-left: 0;
    }
  }
</style>
