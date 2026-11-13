<script lang="ts">
  import { WEEKDAYS, fmtShort, fromDay, iso, weekday } from './core';
  import { ONE_OFF_UNTIL } from './holidays';
  import { leapMonthOf, ganji } from './lunar';
  import { fmtRange, holidaysIcs, yearSummary } from './work';
  import { downloadBlob } from '$lib/download';
  import { st } from './state.svelte';

  const KIND = { holiday: '', substitute: '대체', temp: '임시 · 선거', labor: '노동절' } as const;
  const n = (v: number) => v.toLocaleString('ko-KR');

  const sum = $derived(yearSummary(st.year, st.rules));
  const rows = $derived(
    sum.holidays.map((h) => {
      const wd = weekday(h.day);
      return { ...h, wd, weekend: wd === 0 || wd === 6, diff: h.day - st.today };
    }),
  );
  const next = $derived(rows.find((r) => r.diff >= 0)?.day ?? null);
  const maxWork = $derived(Math.max(...sum.monthWork));
  const leap = $derived(leapMonthOf(st.year));
  const zodiac = $derived(ganji(st.year));

  function move(k: number) {
    st.year = Math.max(2000, Math.min(2100, st.year + k));
  }
  function copyList() {
    const text = rows.map((r) => `${iso(r.day)} (${WEEKDAYS[r.wd]})\t${r.name}`).join('\n');
    st.copy(text, `${st.year}년 공휴일을`);
  }
  function download() {
    downloadBlob(new Blob([holidaysIcs(sum.holidays)], { type: 'text/calendar;charset=utf-8' }), `공휴일-${st.year}.ics`);
    st.say('달력 파일을 받았습니다. 달력 앱에서 열면 들어갑니다');
  }
  /** 연차를 낼 날: "2월 19일 (목) · 20일 (금)" */
  const leaveText = (days: number[]) => days.map((d, i) => (i && fromDay(d).m === fromDay(days[0]).m ? `${fromDay(d).d}일 (${WEEKDAYS[weekday(d)]})` : fmtShort(d))).join(' · ');
</script>

<div class="page year">
  <div class="col">
    <section class="card">
      <div class="head">
        <div class="nav">
          <button class="btn sm ghost" onclick={() => move(-1)} disabled={st.year <= 2000} aria-label="앞 해">‹</button>
          <h2 aria-live="polite">{st.year}년</h2>
          <button class="btn sm ghost" onclick={() => move(1)} disabled={st.year >= 2100} aria-label="다음 해">›</button>
        </div>
        <span class="era">{zodiac.name}년 · {zodiac.animal}띠 해{leap ? ` · 윤${leap}월` : ''}</span>
        <button class="btn sm" onclick={copyList}>복사</button>
        <button class="btn sm" onclick={download} title="달력 앱(구글 · 아웃룩 · 애플)에 넣을 수 있는 파일">달력 파일 (.ics)</button>
      </div>
      <table class="hols">
        <caption class="sr-only">{st.year}년 공휴일</caption>
        <tbody>
          {#each rows as r (r.day)}
            <tr class:weekend={r.weekend} class:next={r.day === next} class:past={r.diff < 0}>
              <td class="d">{fromDay(r.day).m}월 {fromDay(r.day).d}일</td>
              <td class="w" class:sun={r.wd === 0} class:sat={r.wd === 6}>{WEEKDAYS[r.wd]}</td>
              <td class="nm">{r.name}{#if KIND[r.kind]}<i>{KIND[r.kind]}</i>{/if}</td>
              <td class="r">{r.day === next ? (r.diff ? `D-${r.diff}` : '오늘') : r.weekend ? '주말' : ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="hint">
        설 · 추석 · 부처님오신날은 달의 움직임을 계산해 구하고, 대체공휴일은 규정대로 따집니다.
        {#if st.year > ONE_OFF_UNTIL}선거일과 임시공휴일은 {ONE_OFF_UNTIL}년까지만 알고 있습니다 — 그 뒤는 ‘쉬는 날 기준’에 직접 적어 주세요.{:else}갑자기 정해지는 임시공휴일은 ‘날짜’ 탭의 ‘쉬는 날 기준’에 직접 적을 수 있습니다.{/if}
      </p>
    </section>
  </div>

  <div class="col">
    <section class="card" aria-labelledby="h-work">
      <h2 id="h-work">근무일</h2>
      <div class="bigrow">
        <strong class="total" data-testid="year-work">{n(sum.work)}<small>일</small></strong>
        <span class="sub"><span>평일에 걸린 쉬는 날 {sum.weekdayHolidays}일</span><span>한 달 평균 {(sum.work / 12).toFixed(1)}일</span></span>
      </div>
      <ol class="months" aria-label="달마다 근무일">
        {#each sum.monthWork as w, i (i)}
          <li title="{i + 1}월 근무일 {w}일"><i style:height="{(w / maxWork) * 100}%"></i><b>{w}</b><span>{i + 1}월</span></li>
        {/each}
      </ol>
    </section>

    <section class="card" aria-labelledby="h-runs">
      <h2 id="h-runs">이어서 쉬는 날</h2>
      {#if sum.runs.length}
        <ul class="runs">
          {#each sum.runs as r (r.from)}
            <li><b>{r.days}일</b><span>{fmtRange(r.from, r.to)}</span><em>{r.names.join(' · ')}</em></li>
          {/each}
        </ul>
      {:else}
        <p class="hint">사흘 넘게 이어지는 연휴가 없습니다.</p>
      {/if}
    </section>

    <section class="card" aria-labelledby="h-bridge">
      <h2 id="h-bridge">연차 붙이기 좋은 날</h2>
      {#if sum.bridges.length}
        <ul class="runs bridges">
          {#each sum.bridges as b (b.leave[0])}
            <li class:past={b.leave[0] < st.today}>
              <b>{b.days}일</b>
              <span><strong>{leaveText(b.leave)}</strong>에 연차 {b.leave.length}일</span>
              <em>{fmtRange(b.from, b.to)} · {b.names.join(' · ')}</em>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="hint">하루 이틀로 이을 수 있는 징검다리가 없습니다.</p>
      {/if}
    </section>
  </div>
</div>

<style>
  .year {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .head .nav h2 {
    min-width: 76px;
    text-align: center;
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .nav .ghost {
    width: 28px;
    padding: 0;
    font-size: 17px;
  }
  .era {
    margin-right: auto;
    font-size: 12.5px;
    color: var(--muted);
  }
  .hols {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
  }
  .hols td {
    padding: 6px 6px;
    border-top: 1px solid var(--border);
  }
  .hols tr:first-child td {
    border-top: 0;
  }
  .d {
    width: 86px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .w {
    width: 26px;
    color: var(--muted);
  }
  .w.sun {
    color: var(--bad);
  }
  .w.sat {
    color: var(--accent);
  }
  .nm {
    font-weight: 600;
  }
  .nm i {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 99px;
    background: var(--surface-3);
    font-style: normal;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    white-space: nowrap;
  }
  .r {
    width: 52px;
    text-align: right;
    font-size: 12px;
    color: var(--faint);
    white-space: nowrap;
  }
  .weekend .nm,
  .weekend .d {
    color: var(--faint);
    font-weight: 400;
  }
  .past {
    opacity: 0.55;
  }
  .next td {
    background: var(--app-soft);
  }
  .next .r {
    font-weight: 750;
    color: var(--app);
  }
  .bigrow {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 16px;
  }
  .total {
    font-size: 34px;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.15;
    color: var(--app);
    font-variant-numeric: tabular-nums;
  }
  .total small {
    margin-left: 2px;
    font-size: 15px;
    color: var(--muted);
  }
  .months {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 4px;
    height: 96px;
  }
  .months li {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    min-width: 0;
    padding-bottom: 16px;
  }
  .months i {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 16px;
    max-height: calc(100% - 16px);
    border-radius: 5px 5px 2px 2px;
    background: var(--app-soft);
    border: 1px solid var(--app-line);
  }
  .months b {
    position: relative;
    padding-bottom: 3px;
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }
  .months span {
    position: absolute;
    bottom: 0;
    font-size: 10.5px;
    color: var(--faint);
    white-space: nowrap;
  }
  .runs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .runs li {
    display: grid;
    grid-template-columns: 44px 1fr;
    gap: 0 8px;
    padding: 6px 8px;
    border-radius: 8px;
    font-size: 13.5px;
  }
  .runs li:hover {
    background: var(--surface-2);
  }
  .runs b {
    grid-row: span 2;
    align-self: center;
    font-size: 16px;
    font-weight: 800;
    color: var(--app);
    font-variant-numeric: tabular-nums;
  }
  .runs em {
    font-style: normal;
    font-size: 12px;
    color: var(--muted);
  }
  .bridges strong {
    font-weight: 700;
  }
  @media (max-width: 520px) {
    .months b {
      font-size: 10.5px;
    }
    .months span {
      font-size: 9px;
    }
  }
</style>
