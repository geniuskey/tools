<script lang="ts">
  import { sendTo } from '$lib/handoff';
  import { monthly } from './core';
  import { mixed } from './money';
  import { RATES } from './rates';
  import { num, st } from './state.svelte';

  const STEPS: [number, string, number, number][] = [
    [1_000_000, '100만 원씩', 20_000_000, 100_000_000],
    [5_000_000, '500만 원씩', 20_000_000, 200_000_000],
    [10_000_000, '1,000만 원씩', 20_000_000, 300_000_000],
  ];
  const range = $derived(STEPS.find((s) => s[0] === st.step) ?? STEPS[0]);
  const rows = $derived.by(() => {
    const out = [];
    for (let a = range[2]; a <= range[3]; a += range[0]) out.push({ annual: a, ...monthly({ ...st.base, annual: a }) });
    return out;
  });
  // 지금 적은 연봉과 가장 가까운 줄
  const near = $derived(st.annual ? rows.reduce((b, r) => (Math.abs(r.annual - st.annual) < Math.abs(b.annual - st.annual) ? r : b), rows[0]).annual : -1);

  const HEAD = ['연봉', '월 세전', '국민연금', '건강보험', '장기요양', '고용보험', '소득세', '지방소득세', '공제 합계', '월 실수령액', '연 실수령액'];
  const cells = (r: (typeof rows)[number]) => [r.annual, r.gross, r.pension, r.health, r.care, r.employment, r.incomeTax, r.localTax, r.deductions, r.net, r.net * 12];
  const tsv = () => [HEAD, ...rows.map((r) => cells(r).map(String))].map((r) => r.join('\t')).join('\n') + '\n';
  const conds = $derived(
    [`가족 ${st.family}명`, st.children ? `자녀 ${st.children}명` : '', `비과세 월 ${num(st.nonTax || 0)}원`, st.severance ? '퇴직금 포함' : '', st.ratio !== 1 ? `원천징수 ${st.ratio * 100}%` : ''].filter(Boolean).join(' · '),
  );
  function pick(a: number) {
    st.unit = 'annual';
    st.salary = mixed(BigInt(a));
    st.mode = 'net';
  }
  function toTable() {
    if (!sendTo('/table', { kind: 'table', text: tsv() })) st.say('새 탭을 열지 못했습니다 (팝업 차단)');
  }
</script>

<div class="page">
  <div class="card">
    <div class="head">
      <h2>{RATES.year}년 연봉별 실수령액 <small>{conds} — 실수령액 탭에서 바꾼 조건 그대로</small></h2>
      <div class="tools">
        <div class="seg" role="group" aria-label="간격">
          {#each STEPS as [s, name] (s)}<button aria-pressed={st.step === s} onclick={() => (st.step = s)}>{name}</button>{/each}
        </div>
        <button class="btn sm ghost" onclick={() => st.copy(tsv(), '연봉표를')}>엑셀로 복사</button>
        <button class="btn sm ghost" onclick={toTable} title="표 변환에서 마크다운 · HTML 로">표 변환으로</button>
      </div>
    </div>
    <div class="scroll">
      <table>
        <thead>
          <tr>{#each HEAD as h (h)}<th scope="col">{h}</th>{/each}</tr>
        </thead>
        <tbody>
          {#each rows as r (r.annual)}
            <tr class:near={r.annual === near}>
              <th scope="row"><button onclick={() => pick(r.annual)} title="이 연봉으로 자세히">{mixed(BigInt(r.annual))}</button></th>
              {#each cells(r).slice(1) as v, i (i)}<td class:net={i === 8} class:sum={i === 7}>{num(v)}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="hint">원 단위입니다. 연 실수령액은 월 실수령액 × 12 로, 연말정산 결과는 들어 있지 않습니다. 연봉을 누르면 그 연봉의 자세한 계산을 봅니다.</p>
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
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .scroll {
    overflow: auto;
    max-height: calc(100dvh - 230px);
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
    white-space: nowrap;
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface-2);
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
  }
  tbody th {
    position: sticky;
    left: 0;
    background: var(--surface);
    text-align: left;
  }
  tbody th button {
    padding: 0;
    border: 0;
    background: none;
    font-weight: 700;
  }
  tbody th button:hover {
    color: var(--app);
    text-decoration: underline;
  }
  td.sum {
    color: var(--muted);
  }
  td.net {
    font-weight: 800;
    color: var(--app);
  }
  tr.near th,
  tr.near td {
    background: var(--app-soft);
  }
  tbody tr:hover td,
  tbody tr:hover th {
    background: var(--surface-2);
  }
</style>
