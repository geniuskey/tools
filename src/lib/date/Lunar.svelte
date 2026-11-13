<script lang="ts">
  import { fmt, fromDay, iso } from './core';
  import { fromLunar, ganji, leapMonthOf, lunarMonths, toLunar } from './lunar';
  import { st } from './state.svelte';

  // 양력 → 음력
  const solar = $derived(st.day(st.solar));
  const lunar = $derived(toLunar(solar));
  const zodiac = $derived(ganji(lunar.year));
  const lunarText = $derived(`음력 ${lunar.year}년 ${lunar.leap ? '윤' : ''}${lunar.month}월 ${lunar.day}일`);

  // 음력 → 양력
  const year = $derived(Math.max(1900, Math.min(2100, Math.trunc(Number(st.lunarYear) || 0))));
  const leapMonth = $derived(leapMonthOf(year));
  const canLeap = $derived(leapMonth === st.lunarMonth);
  const leap = $derived(st.lunarLeap && canLeap);
  const length = $derived.by(() => {
    const m = lunarMonths(year).find((x) => x.month === st.lunarMonth && x.leap === leap);
    return m ? m.end - m.start : 30;
  });
  const result = $derived(fromLunar(year, st.lunarMonth, st.lunarDay, leap));

  // 해마다: 음력 생일 · 제사. 윤달은 평달로, 30일이 없는 해는 그 달 말일로 센다
  const base = fromDay(st.today).y;
  const yearly = $derived(
    Array.from({ length: 12 }, (_, i) => {
      const y = base + i;
      const m = lunarMonths(y).find((x) => x.month === st.lunarMonth && !x.leap)!;
      const len = m.end - m.start;
      const d = Math.min(st.lunarDay, len);
      return { y, day: m.start + d - 1, short: d !== st.lunarDay };
    }),
  );
  const yearlyText = $derived(yearly.map((r) => `음력 ${st.lunarMonth}월 ${st.lunarDay}일\t${fmt(r.day)}`).join('\n'));

  function useSolar() {
    st.lunarYear = lunar.year;
    st.lunarMonth = lunar.month;
    st.lunarDay = lunar.day;
    st.lunarLeap = lunar.leap;
  }
</script>

<div class="page lunar">
  <div class="col">
    <section class="card" aria-labelledby="h-s2l">
      <h2 id="h-s2l">양력 → 음력</h2>
      <label class="f"><span>양력 날짜</span><input class="field" type="date" min="1900-01-01" max="2100-12-31" value={iso(solar)} onchange={(e) => e.currentTarget.value && (st.solar = st.keep(st.day(e.currentTarget.value)))} /></label>
      <div class="result" aria-live="polite">
        <strong class="big" data-testid="lunar">{lunarText}</strong>
        <p class="sub">
          <span>{zodiac.name}년 · {zodiac.animal}띠</span>
          <span>{lunar.length === 30 ? '큰달 (30일)' : '작은달 (29일)'}</span>
          <span>{fmt(solar)}</span>
        </p>
      </div>
      <div class="foot">
        <button class="btn sm" onclick={useSolar} title="이 음력 날짜가 해마다 양력으로 언제인지 봅니다">해마다 언제인지 보기</button>
        <button class="btn sm" onclick={() => st.copy(`${fmt(solar)} = ${lunarText}`, '결과를')}>복사</button>
      </div>
    </section>

    <section class="card" aria-labelledby="h-l2s">
      <h2 id="h-l2s">음력 → 양력</h2>
      <div class="ymd">
        <label class="f"><span>해</span><input class="field" type="number" min="1900" max="2100" bind:value={st.lunarYear} aria-label="음력 해" /></label>
        <label class="f"><span>달</span>
          <select class="field" bind:value={st.lunarMonth} aria-label="음력 달">
            {#each Array(12) as _, i (i)}<option value={i + 1}>{i + 1}월</option>{/each}
          </select>
        </label>
        <label class="f"><span>날</span>
          <select class="field" bind:value={st.lunarDay} aria-label="음력 날">
            {#each Array(30) as _, i (i)}<option value={i + 1}>{i + 1}일</option>{/each}
          </select>
        </label>
        <label class="check" class:off={!canLeap}><input type="checkbox" bind:checked={st.lunarLeap} disabled={!canLeap} /> 윤달</label>
      </div>
      <div class="result" aria-live="polite">
        {#if result != null}
          <strong class="big" data-testid="solar">{fmt(result)}</strong>
          <p class="sub"><span>음력 {year}년 {leap ? '윤' : ''}{st.lunarMonth}월 {st.lunarDay}일</span><span>{ganji(year).name}년</span></p>
        {:else}
          <p class="warn">음력 {year}년 {leap ? '윤' : ''}{st.lunarMonth}월은 {length}일까지 있습니다.</p>
        {/if}
      </div>
      <p class="hint">{leapMonth ? `${year}년에는 윤${leapMonth}월이 있습니다.` : `${year}년에는 윤달이 없습니다.`} 1961년 이전은 그때의 표준시가 달라 하루 차이가 날 수 있습니다.</p>
    </section>
  </div>

  <div class="col">
    <section class="card" aria-labelledby="h-yearly">
      <div class="headrow">
        <h2 id="h-yearly">음력 {st.lunarMonth}월 {st.lunarDay}일은 해마다</h2>
        <button class="btn sm" onclick={() => st.copy(yearlyText, '표를')}>복사</button>
      </div>
      <table class="yearly">
        <tbody>
          {#each yearly as r (r.y)}
            <tr class:now={r.y === base}>
              <td>{r.y}년</td>
              <td><b>{fmt(r.day).replace(/^\d+년 /, '')}</b>{#if r.short}<i>말일</i>{/if}</td>
              <td class="r">{r.day - st.today === 0 ? '오늘' : r.day > st.today ? `${(r.day - st.today).toLocaleString('ko-KR')}일 뒤` : '지남'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="hint">음력 생일 · 제사처럼 해마다 돌아오는 날입니다. 윤달에 태어났다면 평달로 세고, 30일이 없는 해에는 그 달 말일(29일)로 셉니다.</p>
    </section>
  </div>
</div>

<style>
  .lunar {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    align-items: start;
  }
  .big {
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.2;
    color: var(--app);
  }
  .ymd {
    display: grid;
    grid-template-columns: 1.2fr 1fr 1fr auto;
    align-items: end;
    gap: 8px;
  }
  .ymd .check {
    height: 34px;
  }
  .off {
    opacity: 0.5;
  }
  .headrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .yearly {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
    font-variant-numeric: tabular-nums;
  }
  .yearly td {
    padding: 6px;
    border-top: 1px solid var(--border);
  }
  .yearly tr:first-child td {
    border-top: 0;
  }
  .yearly td:first-child {
    width: 64px;
    color: var(--muted);
  }
  .yearly b {
    font-weight: 650;
  }
  .yearly i {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 99px;
    background: var(--surface-3);
    font-style: normal;
    font-size: 11px;
    color: var(--muted);
  }
  .r {
    text-align: right;
    font-size: 12px;
    color: var(--faint);
  }
  .now td {
    background: var(--app-soft);
  }
  @media (max-width: 520px) {
    .big {
      font-size: 23px;
    }
    .ymd {
      grid-template-columns: 1fr 1fr 1fr;
    }
  }
</style>
