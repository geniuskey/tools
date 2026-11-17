<script lang="ts">
  import { mixed } from './money';
  import { severance, iso } from './severance';
  import { num, st, won } from './state.svelte';

  /** 월 임금을 비워 두면 실수령액 탭의 세전 월급 */
  const fallback = $derived(st.result?.gross ?? 0);
  const wage = $derived(st.sMonthly || fallback);
  const s = $derived(severance({ start: st.sStart, last: st.sLast, monthly: wage, bonus: st.sBonus, leave: st.sLeave }));
  const t = $derived(s?.tax);
  const kdate = (d: Date) => `${d.getUTCFullYear()}. ${d.getUTCMonth() + 1}. ${d.getUTCDate()}.`;
  const span = (days: number) => {
    const y = Math.floor(days / 365);
    const d = days - y * 365;
    return y ? `${y}년 ${d}일` : `${d}일`;
  };
  const rate = $derived(s && s.pay ? (s.tax.total / s.pay) * 100 : 0);
  const YEARS = [1, 3, 5, 10, 20];
  function since(y: number) {
    const last = new Date(st.sLast + 'T00:00:00Z');
    if (Number.isNaN(last.getTime())) return;
    const start = new Date(Date.UTC(last.getUTCFullYear() - y, last.getUTCMonth(), last.getUTCDate() + 1));
    st.sStart = iso(start);
  }
</script>

<div class="page two">
  <section class="col pane" aria-label="근무 기간과 임금">
    <div class="card ask">
      <div class="grid2">
        <label class="f">
          <span>입사일</span>
          <input class="field" type="date" bind:value={st.sStart} />
        </label>
        <label class="f">
          <span>마지막 근무일 <small>퇴직일은 그다음 날</small></span>
          <input class="field" type="date" bind:value={st.sLast} />
        </label>
      </div>
      <div class="chips" role="group" aria-label="근무 기간">
        {#each YEARS as y (y)}<button onclick={() => since(y)}>{y}년 일함</button>{/each}
      </div>
    </div>

    <div class="card">
      <label class="f">
        <span>퇴직 전 3개월 월 임금 (세전) <small>— 기본급과 매달 받는 수당. 비과세 식대도 넣습니다</small></span>
        <input class="field" type="number" min="0" step="10000" bind:value={st.sMonthly} placeholder={fallback ? `${num(fallback)} (실수령액 탭의 세전 월급)` : '3,500,000'} />
      </label>
      {#if !st.sMonthly && fallback}<p class="hint">비워 두면 실수령액 탭의 세전 월급 {won(fallback)}을 씁니다.</p>{/if}
      <div class="grid2">
        <label class="f">
          <span>퇴직 전 1년 상여금</span>
          <input class="field" type="number" min="0" step="10000" bind:value={st.sBonus} />
        </label>
        <label class="f">
          <span>퇴직 전 1년 연차수당</span>
          <input class="field" type="number" min="0" step="10000" bind:value={st.sLeave} />
        </label>
      </div>
      <p class="hint">상여금 · 연차수당은 1년 치의 3/12 을 3개월 임금에 더합니다. 성과급은 정해진 규칙대로 주는 것만 넣습니다.</p>
    </div>
  </section>

  <section class="col results" aria-label="계산 결과">
    {#if !s}
      <div class="card"><p class="hint">입사일과 마지막 근무일을 바르게 적으세요.</p></div>
    {:else}
      <div class="card hero-card">
        <p class="said">퇴직금 <small>{span(s.days)} 일함 · 세금 뗀 뒤 {won(s.net)}</small></p>
        <button class="hero" onclick={() => st.copy(String(s.pay), `${won(s.pay)}을`)} title="눌러서 복사">{num(s.pay)}<small>원</small></button>
        <p class="sub">
          {#if s.eligible}{mixed(BigInt(Math.round(s.pay / 10000) * 10000))}원 쯤 · 퇴직소득세 {won(s.tax.total)} (실효 {rate.toFixed(2)}%){:else}1년(365일)을 채우지 못해 퇴직금이 없습니다 — {365 - s.days}일 더 일하면 받습니다{/if}
        </p>
      </div>

      <div class="card">
        <h2>퇴직금 계산</h2>
        <ul class="rows">
          <li><span class="u"><b>재직일수</b><small>{st.sStart} ~ {st.sLast} (퇴직일 {kdate(s.end)})</small></span><span class="v static">{num(s.days)}일</span></li>
          <li><span class="u"><b>3개월 기간</b><small>{kdate(s.periodFrom)} ~ {kdate(new Date(s.end.getTime() - 86_400_000))}</small></span><span class="v static">{s.periodDays}일</span></li>
          <li><span class="u"><b>3개월 임금 총액</b><small>월 {won(wage)} × 3{st.sBonus ? ` + 상여 ${num(st.sBonus)} × 3/12` : ''}{st.sLeave ? ` + 연차수당 ${num(st.sLeave)} × 3/12` : ''}</small></span><span class="v static">{num(s.wages)}</span></li>
          <li><span class="u"><b>1일 평균임금</b><small>3개월 임금 ÷ {s.periodDays}일</small></span><span class="v static">{num(s.daily)}</span></li>
          <li class="sum"><span class="u"><b>퇴직금</b><small>1일 평균임금 × 30일 × {num(s.days)}일 ÷ 365</small></span><span class="v static">{num(s.pay)}</span></li>
        </ul>
      </div>

      {#if s.eligible && t}
        <div class="card">
          <h2>퇴직소득세 <small>근속연수 {t.years}년 (1년 안 되는 끝은 1년으로)</small></h2>
          <ul class="rows">
            <li><span class="u"><b>근속연수공제</b><small>근속연수에 따라</small></span><span class="v static">{num(t.serviceDeduction)}</span></li>
            <li><span class="u"><b>환산급여</b><small>(퇴직금 − 근속연수공제) × 12 ÷ {t.years}</small></span><span class="v static">{num(t.converted)}</span></li>
            <li><span class="u"><b>환산급여공제</b><small>환산급여 구간에 따라 35~100%</small></span><span class="v static">{num(t.convertedDeduction)}</span></li>
            <li><span class="u"><b>과세표준</b><small>환산급여 − 환산급여공제</small></span><span class="v static">{num(t.base)}</span></li>
            <li><span class="u"><b>환산산출세액</b><small>과세표준에 기본세율 6~45%</small></span><span class="v static">{num(t.convertedTax)}</span></li>
            <li><span class="u"><b>퇴직소득세</b><small>환산산출세액 × {t.years} ÷ 12</small></span><span class="v static">{num(t.incomeTax)}</span></li>
            <li><span class="u"><b>지방소득세</b><small>퇴직소득세 × 10%</small></span><span class="v static">{num(t.localTax)}</span></li>
            <li class="sum"><span class="u"><b>받는 돈</b><small>퇴직금 − 세금 {won(t.total)}</small></span><span class="v static">{num(s.net)}</span></li>
          </ul>
          <p class="hint">
            퇴직금은 IRP 계좌로 받습니다. 일시금으로 찾으면 위 세금을 떼고, 연금으로 나눠 받으면 퇴직소득세를 30%(11년 차부터 40%) 덜 냅니다.
            평균임금이 통상임금보다 적으면 통상임금으로 셈하고, 중간정산 · 회사의 퇴직연금(DC형)이 있으면 달라집니다.
          </p>
        </div>
      {/if}
    {/if}
  </section>
</div>

<style>
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .rows li {
    grid-template-columns: minmax(0, 1fr) auto !important;
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
