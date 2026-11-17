<script lang="ts">
  import { monthly } from './core';
  import { hourly, WEEKS_PER_MONTH } from './hourly';
  import { mixed } from './money';
  import { RATES } from './rates';
  import { num, st, won, type HourlyTax } from './state.svelte';
  import { withhold } from './withhold';

  const h = $derived(hourly({ wage: st.hWage, hoursPerDay: st.hDay, daysPerWeek: st.hDays, nightPerWeek: st.hNight, five: st.hFive }));
  const taxed = $derived.by(() => {
    if (st.hTax === 'business') {
      const w = withhold(h.monthly, 'business');
      return { net: w.net, rows: [['소득세 3%', w.incomeTax], ['지방소득세 0.3%', w.localTax]] as [string, number][] };
    }
    if (st.hTax === 'insurance') {
      const r = monthly({ ...st.base, annual: h.monthly * 12, severanceIncluded: false, nonTax: 0 });
      return {
        net: r.net,
        rows: [
          ['국민연금', r.pension],
          ['건강보험', r.health],
          ['장기요양보험', r.care],
          ['고용보험', r.employment],
          ['근로소득세', r.incomeTax],
          ['지방소득세', r.localTax],
        ] as [string, number][],
      };
    }
    return { net: h.monthly, rows: [] as [string, number][] };
  });
  const TAX: [HourlyTax, string][] = [
    ['none', '떼지 않음'],
    ['business', '3.3% (프리랜서)'],
    ['insurance', '4대 보험 · 근로소득세'],
  ];
  const WAGES = [RATES.minWage.hourly, 11_000, 12_000, 13_000, 15_000];
  const lines = $derived(
    [
      ['기본', `${num(h.weekHours)}시간 × ${won(st.hWage)}`, h.base, true],
      ['주휴수당', h.holidayOk ? `${+h.holidayHours.toFixed(2)}시간 (소정 ${+h.regularHours.toFixed(2)}시간 ÷ 40 × 8)` : '한 주 15시간 미만이라 없음', h.holiday, true],
      ['연장 가산 50%', st.hFive ? `하루 8시간 · 한 주 40시간 넘은 ${+h.overtimeHours.toFixed(2)}시간` : '5명 미만 사업장은 가산 없음', h.overtime, h.overtimeHours > 0],
      ['야간 가산 50%', st.hFive ? `밤 10시 ~ 아침 6시 ${+h.nightHours.toFixed(2)}시간` : '5명 미만 사업장은 가산 없음', h.night, h.nightHours > 0],
    ] as [string, string, number, boolean][],
  );
</script>

<div class="page two">
  <section class="col pane" aria-label="근무 조건">
    <div class="card ask">
      <label class="lab" for="pay-wage">시급</label>
      <div class="money">
        <input id="pay-wage" class="field big" type="number" min="0" step="10" bind:value={st.hWage} />
        <span>원</span>
      </div>
      <div class="chips" role="group" aria-label="자주 보는 시급">
        {#each WAGES as w (w)}<button aria-pressed={st.hWage === w} onclick={() => (st.hWage = w)}>{w === RATES.minWage.hourly ? `최저 ${num(w)}` : num(w)}</button>{/each}
      </div>
      {#if h.underMin}<p class="warn">{RATES.year}년 최저임금 시급 {won(RATES.minWage.hourly)}보다 적습니다.</p>{/if}
    </div>

    <div class="card">
      <div class="grid2">
        <label class="f">
          <span>하루 일하는 시간 <small>쉬는 시간 빼고</small></span>
          <input class="field" type="number" min="0" max="24" step="0.5" bind:value={st.hDay} />
        </label>
        <label class="f">
          <span>한 주 야간 시간 <small>밤 10시 ~ 아침 6시</small></span>
          <input class="field" type="number" min="0" max="168" step="0.5" bind:value={st.hNight} />
        </label>
      </div>
      <div class="f">
        <span>한 주 며칠</span>
        <div class="seg" role="group" aria-label="한 주 며칠">
          {#each [1, 2, 3, 4, 5, 6, 7] as d (d)}<button aria-pressed={st.hDays === d} onclick={() => (st.hDays = d)}>{d}일</button>{/each}
        </div>
      </div>
      <label class="check"><input type="checkbox" bind:checked={st.hFive} /> 상시 5명 이상 사업장 <small>(연장 · 야간 · 휴일에 50% 더)</small></label>
      <div class="f">
        <span>떼는 돈</span>
        <div class="seg" role="group" aria-label="떼는 돈">
          {#each TAX as [v, name] (v)}<button aria-pressed={st.hTax === v} onclick={() => (st.hTax = v)}>{name}</button>{/each}
        </div>
        {#if st.hTax === 'insurance'}<small class="hint">가족 · 감면 조건은 실수령액 탭 그대로입니다. 한 달 60시간 미만이면 국민연금 · 건강보험은 보통 내지 않습니다.</small>{/if}
      </div>
    </div>
  </section>

  <section class="col results" aria-label="계산 결과">
    <div class="card hero-card">
      <p class="said">한 달 {st.hTax === 'none' ? '' : '실수령 '}<small>세전 {won(h.monthly)} · 월 {h.monthHours}시간{h.overtimeHours || h.nightHours ? ' + 가산' : ''}</small></p>
      <button class="hero" onclick={() => st.copy(String(taxed.net), `${won(taxed.net)}을`)} title="눌러서 복사">{num(taxed.net)}<small>원</small></button>
      <p class="sub">주급 {won(h.weekly)} · 연 {mixed(BigInt(Math.round((h.monthly * 12) / 10000) * 10000))}원 쯤 · 주휴 넣은 시급 {won(h.effective)}</p>
    </div>

    <div class="card">
      <h2>한 주에 받는 돈</h2>
      <ul class="rows">
        {#each lines as [name, how, v, show] (name)}
          <li class:off={!show && !v}>
            <span class="u"><b>{name}</b><small>{how}</small></span>
            <span class="v static">{num(v)}</span>
          </li>
        {/each}
        <li class="sum">
          <span class="u"><b>주급</b><small>한 달은 한 해 평균 {WEEKS_PER_MONTH.toFixed(3)}주</small></span>
          <span class="v static">{num(h.weekly)}</span>
        </li>
      </ul>
    </div>

    {#if taxed.rows.length}
      <div class="card">
        <h2>한 달에 떼는 돈</h2>
        <ul class="rows">
          {#each taxed.rows as [name, v] (name)}
            <li><span class="u"><b>{name}</b></span><span class="v static">{num(v)}</span></li>
          {/each}
          <li class="sum"><span class="u"><b>합계</b></span><span class="v static">{num(h.monthly - taxed.net)}</span></li>
        </ul>
      </div>
    {/if}

    <div class="card">
      <h2>알아 둘 것</h2>
      <p class="hint">
        주휴수당은 한 주 소정근로 15시간 이상, 정해진 날을 모두 나오면 받습니다 (사업장 크기와 관계없이). 소정근로는 하루 8시간 · 한 주 40시간까지라 그 위는 연장입니다.
        월급은 고용노동부 방식대로 (소정근로 + 주휴) × {WEEKS_PER_MONTH.toFixed(3)}주를 시간으로 반올림해 셉니다 — 주 40시간이면 209시간, {RATES.year}년 최저 월급 {won(RATES.minWage.monthly)}.
        1년 이상, 한 주 15시간 이상 일하면 퇴직금도 받습니다.
      </p>
    </div>
  </section>
</div>

<style>
  .lab {
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
  }
  .money {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .money span {
    font-weight: 700;
    color: var(--muted);
  }
  .money .field {
    flex: 1;
    min-width: 0;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .seg {
    flex-wrap: wrap;
  }
  .rows li {
    grid-template-columns: minmax(0, 1fr) auto !important;
  }
  .rows li.off {
    opacity: 0.55;
  }
  .rows li.sum {
    border-top: 1px solid var(--border-strong) !important;
  }
  .rows li.sum .v {
    font-weight: 800;
  }
  .rows .u {
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
  }
  .warn {
    padding: 8px 10px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--bad) 10%, var(--surface));
    color: var(--bad);
    font-size: 12.5px;
  }
  @media (max-width: 860px) {
    /* 페이지의 .col { display: grid } 보다 앞서야 한다 */
    .pane,
    .results {
      display: contents !important;
    }
    .ask {
      order: 1;
    }
    .results > :global(*) {
      order: 2;
    }
    .pane > :global(*:not(.ask)) {
      order: 3;
    }
  }
  @media (max-width: 520px) {
    .grid2 {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
