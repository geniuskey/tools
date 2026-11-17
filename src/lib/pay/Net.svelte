<script lang="ts">
  import { childCredit, pensionPeriod, tableRow } from './core';
  import { mixed } from './money';
  import { RATES } from './rates';
  import { num, st, won } from './state.svelte';

  const r = $derived(st.result);
  const pct = (v: number) => (r && r.gross ? (v / r.gross) * 100 : 0);
  const items = $derived(
    r
      ? [
          { id: 'pension', name: '국민연금', v: r.pension, how: `과세 월급 × ${(RATES.pension.rate * 100).toFixed(2)}% · 기준소득월액 ${num(pensionPeriod(st.month).min / 10000)}만~${num(pensionPeriod(st.month).max / 10000)}만 원`, off: st.noPension },
          { id: 'health', name: '건강보험', v: r.health, how: `과세 월급 × ${(RATES.health.rate * 100).toFixed(3)}%` },
          { id: 'care', name: '장기요양보험', v: r.care, how: `건강보험료 × ${(RATES.health.care * 100).toFixed(4)}% ÷ ${(RATES.health.total * 100).toFixed(2)}%` },
          { id: 'employment', name: '고용보험', v: r.employment, how: `과세 월급 × ${(RATES.employment * 100).toFixed(1)}%`, off: st.noEmployment },
          { id: 'tax', name: '근로소득세', v: r.incomeTax, how: `간이세액표 · 가족 ${st.family}명${st.children ? ` · 자녀 ${st.children}명 (−${num(childCredit(st.children))}원)` : ''}${st.ratio !== 1 ? ` · ${st.ratio * 100}%` : ''}` },
          { id: 'local', name: '지방소득세', v: r.localTax, how: '근로소득세 × 10%' },
        ]
      : [],
  );
  const row = $derived(r ? tableRow(r.taxable) : null);
  const hourly = $derived(r ? r.gross / 209 : 0);
  const underMin = $derived(!!r && r.gross > 0 && r.gross < RATES.minWage.monthly);
  const famMax = 11;

  function setUnit(u: 'annual' | 'monthly') {
    if (u === st.unit || !st.read) {
      st.unit = u;
      return;
    }
    // 적은 값을 바꾼 단위로 다시 적는다
    const v = u === 'annual' ? st.read.value * (st.severance ? 13 : 12) : Math.floor(st.read.value / (st.severance ? 13 : 12));
    st.unit = u;
    st.salary = u === 'annual' ? mixed(BigInt(Math.round(v / 10000) * 10000)) : num(v);
  }
  const SALARIES = ['3,000만', '4,000만', '5,000만', '6,000만', '8,000만', '1억'];
  const NONTAX: [number, string][] = [
    [0, '없음'],
    [200_000, '식대 20만'],
    [400_000, '식대 + 보육 20만'],
  ];
</script>

<div class="page two">
  <section class="col pane" aria-label="급여 조건">
    <div class="card ask">
      <div class="seg" role="group" aria-label="연봉 · 월급">
        <button aria-pressed={st.unit === 'annual'} onclick={() => setUnit('annual')}>연봉</button>
        <button aria-pressed={st.unit === 'monthly'} onclick={() => setUnit('monthly')}>월급</button>
      </div>
      <label class="sr-only" for="pay-salary">{st.unit === 'annual' ? '연봉' : '월급'}</label>
      <div class="money">
        <input id="pay-salary" class="field big" bind:value={st.salary} inputmode="text" autocomplete="off" spellcheck="false" placeholder={st.unit === 'annual' ? '4,500만 · 45000000 · 4.5천만' : '350만 · 3,500,000'} />
        <span>원</span>
      </div>
      <p class="read" class:bad={!st.read && st.salary.trim() !== ''}>
        {#if st.read}
          {st.unit === 'annual' ? '연봉' : '월급'} <b>{won(st.read.value)}</b>{#if st.read.note} · {st.read.note}{/if}
        {:else if st.salary.trim()}
          금액으로 읽지 못했습니다
        {:else}
          연봉이나 월급을 적으세요
        {/if}
      </p>
      {#if st.unit === 'annual'}
        <div class="chips" role="group" aria-label="자주 보는 연봉">
          {#each SALARIES as s (s)}<button aria-pressed={st.salary === s} onclick={() => (st.salary = s)}>{s}</button>{/each}
        </div>
      {/if}
      <label class="check"><input type="checkbox" bind:checked={st.severance} /> 퇴직금 포함 연봉 <small>(13으로 나눕니다)</small></label>
    </div>

    <div class="card">
      <div class="f">
        <span>비과세 (월) <small>— 식대는 월 20만 원까지 세금 · 보험료를 떼지 않습니다</small></span>
        <div class="line">
          <input class="field num" type="number" min="0" step="10000" bind:value={st.nonTax} aria-label="비과세 금액" />
          <div class="chips">
            {#each NONTAX as [v, name] (v)}<button aria-pressed={st.nonTax === v} onclick={() => (st.nonTax = v)}>{name}</button>{/each}
          </div>
        </div>
      </div>
      <div class="f">
        <span>공제대상가족 <small>— 본인 포함, 연 소득 100만 원 이하인 배우자 · 부모 · 자녀</small></span>
        <div class="stepper" role="group" aria-label="공제대상가족 수">
          <button aria-label="한 명 빼기" disabled={st.family <= 1} onclick={() => ((st.family = Math.max(1, st.family - 1)), (st.children = Math.min(st.children, st.family - 1)))}>−</button>
          <output>{st.family}명</output>
          <button aria-label="한 명 더하기" disabled={st.family >= 20} onclick={() => (st.family = Math.min(20, st.family + 1))}>+</button>
          {#if st.family > famMax}<small>11명이 넘으면 표의 주석대로 늘려 뺍니다</small>{/if}
        </div>
      </div>
      <div class="f">
        <span>그중 8세 이상 20세 이하 자녀 <small>— 한 명이면 {num(RATES.table.children[0])}원, 둘이면 {num(RATES.table.children[1])}원을 덜 뗍니다</small></span>
        <div class="stepper" role="group" aria-label="자녀 수">
          <button aria-label="자녀 한 명 빼기" disabled={st.children <= 0} onclick={() => (st.children = Math.max(0, st.children - 1))}>−</button>
          <output>{st.children}명</output>
          <button aria-label="자녀 한 명 더하기" disabled={st.children >= st.family - 1} onclick={() => (st.children = Math.min(st.family - 1, st.children + 1))}>+</button>
          {#if st.family === 1}<small>자녀를 넣으려면 가족 수를 먼저 늘리세요</small>{/if}
        </div>
      </div>
      <div class="f">
        <span>원천징수 비율 <small>— 회사에 신청해 고를 수 있습니다. 적게 떼면 연말정산 때 더 냅니다</small></span>
        <div class="seg" role="group" aria-label="원천징수 비율">
          {#each [0.8, 1, 1.2] as v (v)}<button aria-pressed={st.ratio === v} onclick={() => (st.ratio = v)}>{v * 100}%</button>{/each}
        </div>
      </div>
      <details>
        <summary>보험을 내지 않는 경우</summary>
        <label class="check"><input type="checkbox" bind:checked={st.noPension} /> 국민연금 안 냄 <small>(만 60세 이상 등)</small></label>
        <label class="check"><input type="checkbox" bind:checked={st.noEmployment} /> 고용보험 안 냄 <small>(만 65세 이후 새로 고용 등)</small></label>
      </details>
    </div>

    <div class="card">
      <h2>거꾸로 — 실수령액이 이만큼 되려면</h2>
      <div class="money">
        <input class="field" bind:value={st.target} inputmode="text" autocomplete="off" placeholder="월 실수령 300만" aria-label="원하는 월 실수령액" />
        <span>원</span>
      </div>
      {#if st.targetRead && st.needed}
        <p class="answer">
          연봉 <button class="link" onclick={() => ((st.unit = 'annual'), (st.salary = mixed(BigInt(st.needed!))))} title="이 연봉으로 계산">{mixed(BigInt(st.needed))}원</button>
          <small>이상 · 월 실수령 {won(st.targetRead.value)}{st.targetRead.note ? ` (${st.targetRead.note})` : ''}</small>
        </p>
      {:else if st.target.trim()}
        <p class="hint">금액을 읽지 못했습니다</p>
      {:else}
        <p class="hint">지금 고른 가족 · 비과세 조건으로, 만 원 단위의 가장 작은 연봉을 찾습니다.</p>
      {/if}
    </div>
  </section>

  <section class="col results" aria-label="계산 결과">
    {#if r}
      <div class="card hero-card">
        <p class="said">월 실수령액 <small>세전 {won(r.gross)}</small></p>
        <button class="hero" onclick={() => st.copy(String(r.net), `${won(r.net)}를`)} title="눌러서 복사">{num(r.net)}<small>원</small></button>
        <p class="sub">
          연 {mixed(BigInt(r.net * 12))}원 쯤 · 떼는 돈 월 {won(r.deductions)} ({pct(r.deductions).toFixed(1)}%)
        </p>
        <div class="bar" aria-hidden="true">
          <i class="net" style:width="{pct(r.net)}%"></i>
          {#each items as it (it.id)}{#if it.v}<i class={it.id} style:width="{pct(it.v)}%"></i>{/if}{/each}
        </div>
      </div>

      <div class="card">
        <h2>매달 떼는 돈 <small>값을 누르면 복사</small></h2>
        <ul class="rows">
          {#each items as it (it.id)}
            <li class:off={it.off}>
              <span class="dot {it.id}" aria-hidden="true"></span>
              <span class="u"><b>{it.name}</b><small>{it.off ? '내지 않음' : it.how}</small></span>
              <button class="v" onclick={() => st.copy(String(it.v), `${it.name} ${won(it.v)}를`)}>{num(it.v)}</button>
            </li>
          {/each}
          <li class="sum">
            <span class="dot" aria-hidden="true"></span>
            <span class="u"><b>합계</b><small>4대 보험 {won(r.pension + r.health + r.care + r.employment)} · 세금 {won(r.incomeTax + r.localTax)}</small></span>
            <span class="v static">{num(r.deductions)}</span>
          </li>
        </ul>
      </div>

      <div class="card">
        <h2>어떻게 계산했나</h2>
        <dl class="facts">
          <div><dt>세전 월급</dt><dd>{won(r.gross)}</dd><small>{st.severance ? '연봉 ÷ 13 (퇴직금 몫 제외)' : '연봉 ÷ 12'}</small></div>
          <div><dt>과세 대상 월급</dt><dd>{won(r.taxable)}</dd><small>비과세 {won(r.nonTax)} 제외</small></div>
          <div><dt>간이세액표 줄</dt><dd>{row ? (row[0] === row[1] ? `${num(row[0] / 1000)}천 원 이상` : `${num(row[0] / 1000)}~${num(row[1] / 1000)}천 원`) : '77만 원 미만'}</dd><small>{RATES.table.version}</small></div>
          <div><dt>시급으로 치면</dt><dd>{won(hourly)}</dd><small>월 209시간 · {RATES.year}년 최저 {won(RATES.minWage.hourly)}</small></div>
        </dl>
        {#if underMin}<p class="warn">월 {won(r.gross)}는 {RATES.year}년 최저임금 월 환산액 {won(RATES.minWage.monthly)}(주 40시간)보다 적습니다.</p>{/if}
        <p class="hint">
          매달 떼는 세금은 간이세액표로 미리 떼는 값입니다. 실제 세금은 연말정산에서 카드 · 의료비 · 보험료 공제 등으로 다시 계산해 돌려받거나 더 냅니다.
          보험료는 10원 미만을 버렸고, 국민연금은 {pensionPeriod(st.month).from.replace('-', '년 ')}월부터의 상한 · 하한을 씁니다.
        </p>
      </div>
    {/if}
  </section>
</div>

<style>
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
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .num {
    width: 120px !important;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .stepper button {
    width: 32px;
    height: 32px;
    border: 1px solid var(--border-strong);
    border-radius: 9px;
    background: var(--surface);
    font-size: 16px;
    font-weight: 700;
  }
  .stepper button:hover:not(:disabled) {
    border-color: var(--app);
    background: var(--app-soft);
  }
  .stepper button:disabled {
    opacity: 0.4;
  }
  .stepper output {
    min-width: 44px;
    text-align: center;
    font-size: 15px;
    font-weight: 750;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .stepper small {
    font-weight: 400;
    color: var(--faint);
  }
  details {
    font-size: 13px;
    display: grid;
    gap: 6px;
  }
  details summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 12.5px;
  }
  details[open] summary {
    margin-bottom: 6px;
  }
  details .check {
    display: flex;
    margin-top: 4px;
  }
  .answer {
    font-size: 15px;
    font-weight: 650;
  }
  .answer small {
    display: block;
    margin-top: 2px;
    font-size: 12px;
    font-weight: 400;
    color: var(--faint);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    font-size: 20px;
    font-weight: 800;
    color: var(--app);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .bar {
    display: flex;
    height: 12px;
    margin-top: 8px;
    border-radius: 99px;
    overflow: hidden;
    background: var(--surface-3);
  }
  .bar i {
    display: block;
    min-width: 2px;
  }
  .net,
  .dot.net {
    background: var(--app);
  }
  .pension {
    background: #f59f00;
  }
  .health {
    background: #20c997;
  }
  .care {
    background: #96f2d7;
  }
  .employment {
    background: #74c0fc;
  }
  .tax {
    background: #f06595;
  }
  .local {
    background: #fcc2d7;
  }
  .rows li {
    grid-template-columns: auto minmax(0, 1fr) auto !important;
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
  .dot {
    width: 10px;
    height: 10px;
    margin-left: 8px;
    border-radius: 3px;
  }
  .rows .u {
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
  }
  .facts small {
    display: block;
    margin-top: 2px;
    font-size: 11.5px;
    color: var(--faint);
  }
  /* 좁은 화면: 금액 → 답 → 나머지 */
  @media (max-width: 860px) {
    .pane,
    .results {
      display: contents;
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
  .warn {
    padding: 8px 10px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--bad) 10%, var(--surface));
    color: var(--bad);
    font-size: 12.5px;
  }
</style>
