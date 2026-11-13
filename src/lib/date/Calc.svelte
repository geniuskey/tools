<script lang="ts">
  import { untrack } from 'svelte';
  import { WEEKDAYS, addMonths, dayOfYear, diffYmd, fmt, fmtShort, fromDay, iso, isoWeek, toDay, weekday, type Day } from './core';
  import { toLunar } from './lunar';
  import { addWorkdays, between, nearestWorkday, offOf } from './work';
  import { st, type Target, type Unit } from './state.svelte';
  import MonthGrid from './MonthGrid.svelte';

  const UNITS: [Unit, string][] = [
    ['work', '근무일'],
    ['day', '일'],
    ['week', '주'],
    ['month', '개월'],
    ['year', '년'],
  ];
  const TARGETS: [Target, string][] = [
    ['from', '시작'],
    ['to', '끝'],
    ['base', '기준'],
  ];
  const n = (v: number) => v.toLocaleString('ko-KR');

  const from = $derived(st.day(st.from));
  // 끝을 비워 두면 올해 마지막 날
  const to = $derived(st.to ? st.day(st.to) : toDay(fromDay(st.today).y, 12, 31));
  const base = $derived(st.day(st.base));

  // ── 두 날짜 사이 ──
  const gap = $derived(between(from, to, st.rules, st.includeStart));
  const parts = $derived.by(() => {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to) + (st.includeStart ? 1 : 0);
    const out: string[] = [];
    if (gap.days >= 7) out.push(`${Math.floor(gap.days / 7)}주${gap.days % 7 ? ` ${gap.days % 7}일` : ''}`);
    const d = diffYmd(lo, hi);
    if (d.years || d.months) out.push(`${d.years ? `${d.years}년 ` : ''}${d.months ? `${d.months}개월 ` : ''}${d.days ? `${d.days}일` : ''}`.trim());
    return out;
  });
  // 오늘부터 세는 중이면 D-day 로도 보여 준다
  const dday = $derived(st.includeStart || (from !== st.today && to !== st.today) || from === to ? '' : to === st.today ? `D+${n(gap.days)}` : gap.sign > 0 ? `D-${n(gap.days)}` : `D+${n(gap.days)}`);
  const gapText = $derived(`${fmt(from)} → ${fmt(to)}: ${n(gap.days)}일${gap.sign < 0 ? ' 전' : ''}, 근무일 ${n(gap.work)}일${st.includeStart ? ' (첫날 포함)' : ''}`);

  // ── 며칠 뒤 · 며칠 전 ──
  const amount = $derived(Math.max(0, Math.min(100_000, Math.trunc(Number(st.amount) || 0))));
  const moved = $derived.by(() => {
    const k = st.back ? -amount : amount;
    if (st.unit === 'work') {
      const r = addWorkdays(base, k, st.rules);
      return { day: r.day, skipped: r.skipped, clamped: false };
    }
    if (st.unit === 'month' || st.unit === 'year') return { ...addMonths(base, st.unit === 'year' ? k * 12 : k), skipped: [] };
    return { day: base + k * (st.unit === 'week' ? 7 : 1), skipped: [], clamped: false };
  });
  const valid = $derived(moved.day >= -25567 && moved.day <= 47846);
  const movedOff = $derived(st.unit === 'work' ? null : offOf(moved.day, st.rules));
  const skipText = $derived.by(() => {
    const weekend = moved.skipped.filter((s) => s.kind === 'weekend').length;
    const others = moved.skipped.filter((s) => s.kind !== 'weekend');
    const names = [...new Set(others.map((s) => s.name.replace(/ 연휴$/, '')))];
    const bits = [];
    if (weekend) bits.push(`주말 ${n(weekend)}일`);
    if (others.length) bits.push(`쉬는 날 ${n(others.length)}일${names.length <= 4 ? ` (${names.join(', ')})` : ''}`);
    return bits.length ? `${bits.join(', ')}을 건너뛰었습니다` : '';
  });
  const unitName = $derived(UNITS.find((u) => u[0] === st.unit)![1]);
  const movedText = $derived(`${fmt(base)}에서 ${st.unit === 'work' ? '근무일 기준 ' : ''}${n(amount)}${st.unit === 'work' ? '일' : unitName} ${st.back ? '전' : '뒤'}: ${fmt(moved.day)}`);

  // ── 달력 ──
  let view = $state(fromDay(untrack(() => st.day(st[st.target]))));
  function show(day: Day) {
    view = fromDay(day);
  }
  function setDate(target: Target, day: Day) {
    st[target] = target === 'to' ? fmtIso(day) : st.keep(day);
    st.target = target;
    show(day);
  }
  // 끝은 빈 값이 "올해 말" 이라 오늘도 그대로 적는다
  const fmtIso = iso;
  function onInput(target: Target, e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    const day = v ? st.day(v) : null;
    if (day == null) return;
    setDate(target, day);
  }
  function swap() {
    const [a, b] = [from, to];
    st.from = st.keep(b);
    st.to = fmtIso(a);
  }
  let picked = $state<Day | null>(null);
  const info = $derived(picked ?? st.day(st.target === 'to' ? fmtIso(to) : st[st.target]));
  const facts = $derived.by(() => {
    const l = toLunar(info);
    const off = offOf(info, st.rules);
    const w = isoWeek(info);
    const diff = info - st.today;
    return [
      off && off.kind !== 'weekend' ? off.name : '',
      `음력 ${l.leap ? '윤' : ''}${l.month}월 ${l.day}일`,
      `${fromDay(info).y}년의 ${dayOfYear(info)}번째 날`,
      `${w.week}주차`,
      diff === 0 ? '오늘' : diff > 0 ? `${n(diff)}일 뒤` : `${n(-diff)}일 전`,
    ].filter(Boolean);
  });

  // ── 기억할 날짜 ──
  let newName = $state('');
  let newDate = $state('');
  const saved = $derived(
    st.ddays
      .map((d, i) => ({ ...d, i, day: st.day(d.date) }))
      .sort((a, b) => a.day - b.day)
      .map((d) => ({ ...d, diff: d.day - st.today, work: between(st.today, d.day, st.rules).work })),
  );
  function addDday(e: Event) {
    e.preventDefault();
    if (!newName.trim() || !newDate) return;
    st.ddays.push({ name: newName.trim().slice(0, 40), date: newDate });
    newName = '';
    newDate = '';
  }

  const ruleLine = $derived(
    [st.sat && '토', st.sun && '일', st.holidays && '공휴일', st.labor && '노동절', st.custom.list.length && `회사 ${st.custom.list.length}일`].filter(Boolean).join(' · ') || '쉬는 날 없이 모두 근무일',
  );
</script>

<div class="page calc">
  <div class="col">
    <section class="card" aria-labelledby="h-gap">
      <h2 id="h-gap">두 날짜 사이</h2>
      <div class="pair">
        <label class="f"><span>시작</span><input class="field" type="date" min="1900-01-01" max="2100-12-31" value={fmtIso(from)} onchange={(e) => onInput('from', e)} onfocus={() => (st.target = 'from')} /></label>
        <button class="btn sm ghost swap" onclick={swap} aria-label="시작과 끝 바꾸기" title="시작과 끝 바꾸기">⇄</button>
        <label class="f"><span>끝</span><input class="field" type="date" min="1900-01-01" max="2100-12-31" value={fmtIso(to)} onchange={(e) => onInput('to', e)} onfocus={() => (st.target = 'to')} /></label>
      </div>
      <div class="chips" role="group" aria-label="끝 날짜 빨리 고르기">
        <button onclick={() => setDate('from', st.today)}>시작을 오늘로</button>
        <button onclick={() => setDate('to', addMonths(from, 1).day)}>한 달 뒤</button>
        <button onclick={() => setDate('to', from + 100)}>100일 뒤</button>
        <button onclick={() => setDate('to', addMonths(from, 12).day)}>1년 뒤</button>
        <button onclick={() => ((st.to = ''), (st.target = 'to'), show(to))}>올해 말</button>
      </div>
      <div class="result" aria-live="polite">
        <div class="bigrow">
          <strong class="big" data-testid="gap-days">{n(gap.days)}<small>일{gap.sign < 0 ? ' 전' : ''}</small></strong>
          <span class="big second" data-testid="gap-work"><small>근무일</small> {n(gap.work)}<small>일</small></span>
          {#if dday}<span class="tag">{dday}</span>{/if}
        </div>
        <p class="sub">
          {#each parts as p (p)}<span>{p}</span>{/each}
          <span>주말 {n(gap.weekend)}일</span>
          {#if gap.holidays.length}<span>평일에 쉬는 날 {n(gap.holidays.length)}일</span>{/if}
        </p>
        {#if gap.holidays.length}
          <ul class="hol">
            {#each gap.holidays.slice(0, 12) as h (h.day)}
              <li><button onclick={() => ((picked = h.day), show(h.day))}><b>{fmtShort(h.day)}</b> {h.name}</button></li>
            {/each}
            {#if gap.holidays.length > 12}<li class="more">… 그 밖에 {n(gap.holidays.length - 12)}일</li>{/if}
          </ul>
        {/if}
      </div>
      <div class="foot">
        <label class="check"><input type="checkbox" bind:checked={st.includeStart} /> 첫날도 세기 <small>행사 기간 · 휴가 일수</small></label>
        <button class="btn sm" onclick={() => st.copy(gapText, '결과를')}>복사</button>
      </div>
    </section>

    <section class="card" aria-labelledby="h-add">
      <h2 id="h-add">며칠 뒤 · 며칠 전</h2>
      <div class="adder">
        <label class="f"><span>기준</span><input class="field" type="date" min="1900-01-01" max="2100-12-31" value={fmtIso(base)} onchange={(e) => onInput('base', e)} onfocus={() => (st.target = 'base')} /></label>
        <label class="f num"><span>얼마나</span><input class="field" type="number" min="0" max="100000" step="1" inputmode="numeric" bind:value={st.amount} aria-label="얼마나" /></label>
        <label class="f"><span>단위</span>
          <select class="field" bind:value={st.unit} aria-label="단위">
            {#each UNITS as [id, name] (id)}<option value={id}>{name}</option>{/each}
          </select>
        </label>
        <div class="seg" role="group" aria-label="뒤 또는 전">
          <button aria-pressed={!st.back} onclick={() => (st.back = false)}>뒤</button>
          <button aria-pressed={st.back} onclick={() => (st.back = true)}>전</button>
        </div>
      </div>
      <div class="chips" role="group" aria-label="자주 쓰는 날 수">
        {#each [3, 5, 7, 10, 14, 15, 30, 90] as k (k)}<button aria-pressed={amount === k} onclick={() => (st.amount = k)}>{k}</button>{/each}
      </div>
      <div class="result" aria-live="polite">
        {#if valid}
          <button class="big date" data-testid="moved" onclick={() => ((picked = moved.day), show(moved.day))} title="달력에서 보기">{fmt(moved.day)}</button>
          <p class="sub">
            {#if st.unit === 'work'}
              <span>{skipText || '건너뛴 쉬는 날이 없습니다'}</span>
            {:else}
              <span>달력 날짜로 {n(Math.abs(moved.day - base))}일 {st.back ? '전' : '뒤'}</span>
              {#if moved.clamped}<span>그 달에는 {fromDay(base).d}일이 없어 말일로 맞췄습니다</span>{/if}
            {/if}
          </p>
          {#if movedOff}
            <p class="warn">
              이 날은 {movedOff.name}{movedOff.kind === 'weekend' ? '' : ` (${WEEKDAYS[weekday(moved.day)]}요일)`}입니다. 앞 근무일은 <b>{fmtShort(nearestWorkday(moved.day, st.rules, -1))}</b>, 다음 근무일은 <b>{fmtShort(nearestWorkday(moved.day, st.rules))}</b>.
            </p>
          {/if}
        {:else}
          <p class="warn">1900년부터 2100년까지만 계산합니다.</p>
        {/if}
      </div>
      <div class="foot">
        <button class="btn sm" disabled={!valid} onclick={() => setDate('to', moved.day)} title="이 날짜를 ‘두 날짜 사이’의 끝으로 넣습니다">끝 날짜로 넣기</button>
        <button class="btn sm" disabled={!valid} onclick={() => st.copy(movedText, '결과를')}>복사</button>
      </div>
    </section>

    <details class="card rules">
      <summary><h2>쉬는 날 기준</h2><span>{ruleLine}</span></summary>
      <div class="checks">
        <label class="check"><input type="checkbox" bind:checked={st.sat} /> 토요일</label>
        <label class="check"><input type="checkbox" bind:checked={st.sun} /> 일요일</label>
        <label class="check"><input type="checkbox" bind:checked={st.holidays} /> 공휴일 · 대체공휴일</label>
        <label class="check"><input type="checkbox" bind:checked={st.labor} /> 노동절 (5월 1일)</label>
      </div>
      <label class="f">
        <span>우리 회사가 따로 쉬는 날</span>
        <textarea class="field" rows="3" bind:value={st.customText} spellcheck="false" aria-label="우리 회사가 따로 쉬는 날" placeholder={'2026-12-31 종무식\n11/2 창립기념일  ← 해를 빼면 해마다'}></textarea>
      </label>
      {#if st.custom.bad.length}<p class="warn">읽지 못한 줄: {st.custom.bad.slice(0, 3).join(' / ')}</p>{/if}
    </details>
  </div>

  <div class="col">
    <section class="card" aria-label="달력">
      <MonthGrid bind:y={view.y} bind:m={view.m} rules={st.rules} today={st.today} range={[Math.min(from, to), Math.max(from, to)]} ring={valid ? moved.day : null} dot={base} onpick={(day) => ((picked = null), setDate(st.target, day))} />
      <div class="pick">
        <span>달력을 누르면</span>
        <div class="seg" role="group" aria-label="달력을 누르면 바뀌는 날짜">
          {#each TARGETS as [id, name] (id)}<button aria-pressed={st.target === id} onclick={() => ((st.target = id), (picked = null))}>{name}</button>{/each}
        </div>
        <span>날짜가 바뀝니다</span>
      </div>
      <p class="facts"><b>{fmt(info)}</b>{#each facts as f (f)}<span>{f}</span>{/each}</p>
    </section>

    <section class="card" aria-labelledby="h-dday">
      <h2 id="h-dday">기억할 날짜</h2>
      {#if saved.length}
        <ul class="ddays">
          {#each saved as d (d.i)}
            <li class:past={d.diff < 0}>
              <button class="dd" onclick={() => (setDate('from', st.today), setDate('to', d.day))} title="두 날짜 사이에 넣기">
                <b>{d.diff === 0 ? 'D-DAY' : d.diff > 0 ? `D-${n(d.diff)}` : `D+${n(-d.diff)}`}</b>
                <span class="nm">{d.name}</span>
                <span class="when">{fmt(d.day)}{d.diff > 0 ? ` · 근무일 ${n(d.work)}일` : ''}</span>
              </button>
              <button class="btn sm ghost" onclick={() => st.ddays.splice(d.i, 1)} aria-label="{d.name} 지우기">✕</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="hint">마감 · 출시 · 기념일을 적어 두면 며칠 남았는지, 근무일로는 며칠인지 보여 줍니다.</p>
      {/if}
      <form class="add" onsubmit={addDday}>
        <input class="field" bind:value={newName} placeholder="이름 (예: 보고서 마감)" aria-label="기억할 날짜 이름" maxlength="40" />
        <input class="field" type="date" min="1900-01-01" max="2100-12-31" bind:value={newDate} aria-label="언제" />
        <button class="btn sm primary" disabled={!newName.trim() || !newDate}>추가</button>
      </form>
    </section>
  </div>
</div>

<style>
  .calc {
    grid-template-columns: minmax(0, 1.15fr) minmax(320px, 1fr);
    align-items: start;
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: end;
    gap: 6px;
  }
  .swap {
    width: 30px;
    height: 34px;
    padding: 0;
    font-size: 15px;
  }
  .adder {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 0.8fr) minmax(0, 1fr) auto;
    align-items: end;
    gap: 8px;
  }
  .adder .seg {
    height: 34px;
  }
  .bigrow {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 18px;
  }
  .big {
    font-size: 34px;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
  }
  .big small {
    margin-left: 2px;
    font-size: 15px;
    font-weight: 650;
    letter-spacing: 0;
    color: var(--muted);
  }
  .big.second {
    font-size: 26px;
    color: var(--app);
  }
  .big.second small:first-child {
    margin: 0 2px 0 0;
  }
  .big.date {
    display: block;
    padding: 0;
    border: 0;
    background: transparent;
    font-size: 28px;
    text-align: left;
    color: var(--app);
  }
  .big.date:hover {
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 5px;
  }
  .tag {
    padding: 2px 9px;
    border-radius: 99px;
    background: var(--app);
    color: var(--on-app);
    font-size: 12.5px;
    font-weight: 750;
    align-self: center;
  }
  .hol {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .hol button {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 99px;
    background: var(--surface);
    font-size: 12px;
    color: var(--muted);
  }
  .hol button:hover {
    border-color: var(--app-line);
  }
  .hol b {
    font-weight: 600;
    color: var(--bad);
  }
  .more {
    font-size: 12px;
    color: var(--faint);
    align-self: center;
  }
  .rules summary {
    display: flex;
    align-items: baseline;
    gap: 10px;
    cursor: pointer;
    list-style: none;
  }
  .rules summary::-webkit-details-marker {
    display: none;
  }
  .rules summary::after {
    content: '▾';
    margin-left: auto;
    color: var(--faint);
  }
  .rules[open] summary::after {
    content: '▴';
  }
  .rules summary span {
    font-size: 12.5px;
    color: var(--muted);
  }
  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
  }
  .rules textarea {
    font-family: var(--mono);
    font-size: 12.5px;
  }
  .pick {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .pick .seg button {
    height: 24px;
    padding: 0 10px;
    font-size: 12.5px;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    font-size: 12.5px;
    color: var(--muted);
  }
  .facts b {
    flex-basis: 100%;
    font-size: 14px;
    color: var(--text);
  }
  .ddays {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .ddays li {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .dd {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 64px 1fr;
    gap: 0 10px;
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    text-align: left;
  }
  .dd:hover {
    border-color: var(--app-line);
    background: var(--app-soft);
  }
  .dd b {
    grid-row: span 2;
    align-self: center;
    font-size: 15px;
    font-weight: 800;
    color: var(--app);
    font-variant-numeric: tabular-nums;
  }
  .past .dd b {
    color: var(--faint);
  }
  .nm {
    font-size: 13.5px;
    font-weight: 650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .when {
    font-size: 12px;
    color: var(--muted);
  }
  .add {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 6px;
    align-items: center;
  }
  @media (max-width: 520px) {
    .adder {
      grid-template-columns: 1fr 1fr;
    }
    .add {
      grid-template-columns: 1fr auto;
    }
    .add .field:first-child {
      grid-column: 1 / -1;
    }
    .big {
      font-size: 30px;
    }
    .big.date {
      font-size: 23px;
    }
  }
</style>
