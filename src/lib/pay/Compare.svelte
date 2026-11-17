<script lang="ts">
  import { employerCost, monthly } from './core';
  import { mixed } from './money';
  import { RATES } from './rates';
  import { MAX_OFFERS, num, readSalary, st, won } from './state.svelte';

  const cols = $derived(
    st.offers.map((o) => {
      const read = readSalary(o.salary, 'annual');
      const annual = read?.value ?? 0;
      const r = read ? monthly({ ...st.base, annual, severanceIncluded: o.severance, nonTax: o.nonTax || 0 }) : null;
      const e = r ? employerCost(r, st.base, RATES.employer.stability[st.firm]?.[1] ?? 0, (st.accident || 0) / 100) : null;
      return { o, read, annual, r, e };
    }),
  );
  const first = $derived(cols[0]);
  type Col = (typeof cols)[number];
  const LINES: [string, (c: Col) => number][] = [
    ['월 세전', (c) => c.r!.gross],
    ['월 공제', (c) => c.r!.deductions],
    ['월 실수령액', (c) => c.r!.net],
    ['연 실수령액', (c) => c.r!.net * 12],
    ['회사가 쓰는 돈 (연)', (c) => c.e!.total * 12],
  ];
  const pctDiff = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0);
  const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '±');
  const signed = (v: number) => `${sign(v)}${num(Math.abs(v))}`;
  const signedPct = (v: number) => `${sign(v)}${Math.abs(v).toFixed(1)}%`;

  // 가장 크게 오른 쪽과 첫째를 견줘 한 줄로
  const best = $derived(cols.slice(1).filter((c) => c.r && first?.r).sort((a, b) => b.r!.net - a.r!.net)[0]);
  const summary = $derived.by(() => {
    if (!best || !first?.r || !best.r) return '';
    const dGross = (best.r.gross - first.r.gross) * 12;
    const dNet = (best.r.net - first.r.net) * 12;
    if (dGross <= 0) return '';
    return `${best.o.name || '둘째'}: 세전으로 한 해 ${mixed(BigInt(Math.round(dGross / 10000) * 10000))}원 (${signedPct(pctDiff(best.r.gross, first.r.gross))}) 더 받으면, 손에 남는 돈은 한 해 ${mixed(BigInt(Math.round(dNet / 10000) * 10000))}원 (${signedPct(pctDiff(best.r.net, first.r.net))}) 늘어납니다. 늘어난 세전 금액의 ${((dNet / dGross) * 100).toFixed(0)}%입니다.`;
  });

  const RAISES = [3, 5, 7, 10, 15, 20, 30];
  function addRaise(p: number) {
    if (!first || st.offers.length >= MAX_OFFERS) return;
    const a = Math.round((first.annual * (1 + p / 100)) / 10000) * 10000;
    st.offers = [...st.offers, { ...first.o, name: `${p}% 인상`, salary: mixed(BigInt(a)) }];
  }
  function add() {
    if (st.offers.length >= MAX_OFFERS) return;
    const last = st.offers[st.offers.length - 1];
    st.offers = [...st.offers, { ...last, name: `안 ${st.offers.length + 1}` }];
  }
  function remove(i: number) {
    st.offers = st.offers.filter((_, k) => k !== i);
  }
  function detail(i: number) {
    const c = cols[i];
    if (!c.read) return;
    st.unit = 'annual';
    st.salary = c.o.salary;
    st.severance = c.o.severance;
    st.nonTax = c.o.nonTax;
    st.mode = 'net';
  }
  function tsv() {
    const rows: (string | number)[][] = [['', ...cols.map((c) => c.o.name)]];
    rows.push(['연봉', ...cols.map((c) => (c.r ? c.annual : ''))]);
    for (const [name, f] of LINES) rows.push([name, ...cols.map((c) => (c.r ? f(c) : ''))]);
    return rows.map((r) => r.join('\t')).join('\n') + '\n';
  }
  const conds = $derived([`가족 ${st.family}명`, st.children ? `자녀 ${st.children}명` : '', st.ratio !== 1 ? `원천징수 ${st.ratio * 100}%` : '', st.sme ? '중소기업 감면' : ''].filter(Boolean).join(' · '));
</script>

<div class="page">
  <div class="card">
    <div class="head">
      <h2>연봉 비교 <small>{conds} — 실수령액 탭의 가족 · 감면 조건 그대로</small></h2>
      <div class="tools">
        <button class="btn sm ghost" onclick={() => st.copy(tsv(), '비교표를')}>엑셀로 복사</button>
        <button class="btn sm" onclick={add} disabled={st.offers.length >= MAX_OFFERS}>+ 안 더하기</button>
      </div>
    </div>
    <div class="raise">
      <span>{first?.o.name || '첫째'}에서</span>
      <div class="chips" role="group" aria-label="인상률로 더하기">
        {#each RAISES as p (p)}<button onclick={() => addRaise(p)} disabled={st.offers.length >= MAX_OFFERS || !first?.read}>+{p}%</button>{/each}
      </div>
    </div>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th scope="col" class="lead"></th>
            {#each st.offers as o, i (i)}
              <th scope="col" class:base={i === 0}>
                <div class="name">
                  <input class="field" bind:value={o.name} aria-label="{i + 1}번째 이름" maxlength="30" />
                  {#if st.offers.length > 1}<button class="x" onclick={() => remove(i)} aria-label="{o.name || i + 1 + '번째'} 빼기" title="빼기">×</button>{/if}
                </div>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">연봉</th>
            {#each st.offers as o, i (i)}
              <td class:base={i === 0}>
                <input class="field sal" bind:value={o.salary} aria-label="{o.name || i + 1 + '번째'} 연봉" inputmode="text" autocomplete="off" spellcheck="false" />
                <small class:bad={!cols[i].read && o.salary.trim() !== ''}>{cols[i].read ? won(cols[i].annual) : '금액으로 읽지 못했습니다'}</small>
              </td>
            {/each}
          </tr>
          <tr>
            <th scope="row">비과세 (월)</th>
            {#each st.offers as o, i (i)}
              <td class:base={i === 0}><input class="field num" type="number" min="0" step="10000" bind:value={o.nonTax} aria-label="{o.name || i + 1 + '번째'} 비과세" /></td>
            {/each}
          </tr>
          <tr>
            <th scope="row">퇴직금 포함</th>
            {#each st.offers as o, i (i)}
              <td class:base={i === 0}><label class="check"><input type="checkbox" bind:checked={o.severance} /> <small>13으로 나눔</small></label></td>
            {/each}
          </tr>
          {#each LINES as [name, f] (name)}
            <tr class:hl={name === '월 실수령액'}>
              <th scope="row">{name}</th>
              {#each cols as c, i (i)}
                <td class:base={i === 0}>
                  {#if c.r}
                    <b>{num(f(c))}</b>
                    {#if i > 0 && first?.r && name !== '월 공제'}
                      {@const d = f(c) - f(first)}
                      <small class:up={d > 0} class:down={d < 0}>{signed(d)} ({signedPct(pctDiff(f(c), f(first)))})</small>
                    {/if}
                  {:else}<span class="faint">—</span>{/if}
                </td>
              {/each}
            </tr>
          {/each}
          <tr>
            <th scope="row"></th>
            {#each cols as c, i (i)}
              <td class:base={i === 0}><button class="btn sm ghost" disabled={!c.read} onclick={() => detail(i)}>자세히</button></td>
            {/each}
          </tr>
        </tbody>
      </table>
    </div>
    {#if summary}<p class="say">{summary}</p>{/if}
    <p class="hint">
      차이는 맨 왼쪽({first?.o.name || '첫째'})과 견준 값입니다. 오른 연봉의 일부는 4대 보험 · 세금으로 나가고, 세율 구간이 바뀌면 더 많이 나갑니다.
      성과급 · 사이닝 보너스처럼 해마다 다른 돈은 연봉에 넣지 말고 따로 견주세요. 회사가 쓰는 돈은 회사 몫 보험료 · 산재 · 퇴직금 적립을 더한 값입니다.
    </p>
  </div>
</div>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .tools {
    display: flex;
    gap: 6px;
  }
  .raise {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .raise button:disabled {
    opacity: 0.45;
  }
  .scroll {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 7px 10px;
    border-bottom: 1px solid var(--border);
    text-align: right;
    vertical-align: top;
    min-width: 150px;
  }
  tbody tr:last-child th,
  tbody tr:last-child td {
    border-bottom: 0;
  }
  th.lead,
  tbody th {
    position: sticky;
    left: 0;
    z-index: 1;
    min-width: 96px;
    background: var(--surface);
    text-align: left;
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
    white-space: nowrap;
  }
  thead th {
    background: var(--surface-2);
  }
  .base {
    background: color-mix(in srgb, var(--surface-2) 50%, var(--surface));
  }
  .name {
    display: flex;
    gap: 4px;
  }
  .name .field {
    flex: 1;
    min-width: 0;
    height: 30px;
    font-weight: 700;
    text-align: right;
  }
  .x {
    width: 26px;
    border: 0;
    border-radius: 7px;
    background: none;
    font-size: 16px;
    color: var(--faint);
  }
  .x:hover {
    background: var(--surface-3);
    color: var(--bad);
  }
  .sal,
  .num {
    width: 100%;
    height: 32px;
    text-align: right;
    font-weight: 650;
  }
  td small {
    display: block;
    margin-top: 2px;
    font-size: 11.5px;
    color: var(--faint);
  }
  td .check {
    justify-content: flex-end;
  }
  td .check small {
    display: inline;
    margin: 0;
  }
  td b {
    font-size: 14px;
  }
  tr.hl td b {
    font-size: 16px;
    font-weight: 800;
    color: var(--app);
  }
  .up {
    color: var(--ok) !important;
  }
  .down {
    color: var(--bad) !important;
  }
  .faint {
    color: var(--faint);
  }
  @media (max-width: 520px) {
    th,
    td {
      min-width: 118px;
      padding: 6px 7px;
    }
    th.lead,
    tbody th {
      min-width: 72px;
      white-space: normal;
    }
  }
  .say {
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--app-soft);
    font-size: 13.5px;
    line-height: 1.6;
  }
</style>
