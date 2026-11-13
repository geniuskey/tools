<script lang="ts">
  import ColorField from './ColorField.svelte';
  import Swatches from './Swatches.svelte';
  import { LEVELS, apca, fmtRatio, ratio, suggest, visible, type Suggestion } from './contrast';
  import { CVDS, simulate } from './cvd';
  import { fmtNum, toHex } from './format';
  import { st } from './state.svelte';

  const r = $derived(ratio(st.fgColor, st.bgColor));
  const lc = $derived(apca(st.fgColor, st.bgColor));
  const vis = $derived(visible(st.fgColor, st.bgColor));
  const fgCss = $derived(toHex(st.fgColor));
  const bgCss = $derived(toHex(st.bgColor));
  const translucent = $derived(st.fgColor.alpha < 0.9995 || st.bgColor.alpha < 0.9995);

  const verdict = $derived(r >= 7 ? '아주 잘 읽힙니다' : r >= 4.5 ? '본문 글자로 충분합니다' : r >= 3 ? '큰 글자 · 아이콘에만 쓸 수 있습니다' : '글자로 읽기 어렵습니다');
  const tone = $derived(r >= 4.5 ? 'ok' : r >= 3 ? 'mid' : 'bad');
  const lcNote = $derived.by(() => {
    const a = Math.abs(lc);
    return a >= 90 ? '본문 어디에나' : a >= 75 ? '본문 글자' : a >= 60 ? '큰 글자 · 굵은 본문' : a >= 45 ? '제목 · 아이콘' : a >= 30 ? '부가 글자 · 테두리' : '글자로 쓰기 어려움';
  });

  const goal = $derived(st.level);
  const sugs = $derived(
    r >= goal.min
      ? null
      : {
          fg: suggest(st.fgColor, st.bgColor, goal.min, 'fg'),
          bg: suggest(st.bgColor, st.fgColor, goal.min, 'bg'),
        },
  );

  const tiles = $derived(
    CVDS.map(([id, name, note]) => {
      const f = simulate(vis.fg, id);
      const b = simulate(vis.bg, id);
      return { id, name, note, f: toHex(f), b: toHex(b), r: ratio(f, b) };
    }),
  );

  function apply(role: 'fg' | 'bg', s: Suggestion) {
    st.set(role, toHex(s.color));
    st.say(`${role === 'fg' ? '글자' : '배경'} 색을 ${toHex(s.color)} 로 바꿨습니다`);
  }

  function onkeydown(e: KeyboardEvent) {
    const t = e.target;
    if ((t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'x' || e.key === 'X') {
      e.preventDefault();
      st.swap();
    }
  }
</script>

<svelte:window {onkeydown} />

{#snippet sug(role: 'fg' | 'bg', s: { darker: Suggestion | null; lighter: Suggestion | null })}
  <div class="sug">
    <h3>{role === 'fg' ? '글자 색을 바꾸면' : '배경 색을 바꾸면'}</h3>
    {#each [['darker', '어둡게'], ['lighter', '밝게']] as const as [dir, name] (dir)}
      {@const x = s[dir]}
      {#if x}
        <button class="pick" onclick={() => apply(role, x)} aria-label="{role === 'fg' ? '글자' : '배경'} 색을 {name} — {toHex(x.color)}, 명암비 {fmtRatio(x.ratio)} 대 1">
          <span class="mini" style:background={role === 'bg' ? toHex(x.color) : bgCss} style:color={role === 'fg' ? toHex(x.color) : fgCss}>가</span>
          <span class="txt">
            <b>{toHex(x.color)}</b>
            <small>{name} · 밝기 {x.dl > 0 ? '+' : ''}{fmtNum(x.dl * 100, 1)} · {fmtRatio(x.ratio)} : 1</small>
          </span>
          <span class="go">적용</span>
        </button>
      {:else}
        <p class="none">{name} 해서는 {goal.min} : 1 에 닿지 않습니다</p>
      {/if}
    {/each}
  </div>
{/snippet}

<div class="page two">
  <div class="col">
    <section class="card" aria-labelledby="h-pair">
      <h2 id="h-pair">두 색</h2>
      <div class="pair">
        <ColorField target="fg" label="글자 색" />
        <button class="btn sm ghost swap" onclick={() => st.swap()} title="글자와 배경 바꾸기 (X)" aria-label="글자와 배경 바꾸기">⇅</button>
        <ColorField target="bg" label="배경 색" />
      </div>
    </section>

    <section class="card" aria-labelledby="h-ratio" aria-live="polite">
      <h2 id="h-ratio">명암비 <small>WCAG 2.2</small></h2>
      <div class="big {tone}">
        <strong data-testid="ratio">{fmtRatio(r)}<span> : 1</span></strong>
        <p>{verdict}</p>
      </div>
      <ul class="levels">
        {#each LEVELS as l (l.id)}
          <li class:ok={r >= l.min}>
            <span class="mark" aria-hidden="true">{r >= l.min ? '✓' : '✕'}</span>
            <b>{l.name}</b>
            <span class="need">{l.min} : 1</span>
            <small>{l.note}</small>
            <span class="sr-only">{r >= l.min ? '통과' : '미달'}</span>
          </li>
        {/each}
      </ul>
      <p class="apca">
        <span class="tag">초안</span>
        APCA <b>Lc {fmtNum(lc, 1)}</b> — {lcNote}
        <small>WCAG 3 에서 검토 중인 계산법입니다. 아직 공식 기준이 아니니 참고로만 보세요.</small>
      </p>
      {#if translucent}<p class="hint">반투명한 색은 겹쳐 보이는 색으로 계산했습니다 (배경 → 흰 바탕 위, 글자 → 배경 위). 보이는 색: 글자 {toHex(vis.fg)} · 배경 {toHex(vis.bg)}</p>{/if}
    </section>

    <section class="card" aria-labelledby="h-fix">
      <h2 id="h-fix">기준을 넘는 가까운 색</h2>
      <div class="chips" role="group" aria-label="목표 기준">
        {#each LEVELS as l (l.id)}
          <button aria-pressed={st.goal === l.id} onclick={() => (st.goal = l.id)}>{l.name} {l.min}</button>
        {/each}
      </div>
      {#if !sugs}
        <p class="pass">✓ 지금 두 색이 <b>{goal.name}</b> ({goal.min} : 1) 기준을 넘습니다.</p>
      {:else}
        <p class="hint">색상과 채도는 그대로 두고 밝기만 가장 적게 옮겨서 {goal.min} : 1 을 넘깁니다. 누르면 바로 바뀝니다.</p>
        <div class="sugs">
          {@render sug('fg', sugs.fg)}
          {@render sug('bg', sugs.bg)}
        </div>
      {/if}
    </section>
  </div>

  <div class="col">
    <section class="card" aria-labelledby="h-prev">
      <h2 id="h-prev">미리보기</h2>
      <div class="preview" style:background={bgCss} style:color={fgCss}>
        <p class="p24">제목은 이렇게 보입니다</p>
        <p class="p16">본문 글자는 대개 이 크기로 읽힙니다. The quick brown fox jumps over the lazy dog. 0123456789</p>
        <p class="p13">작은 글씨 · 각주 · 2026년 11월 13일 (금)</p>
        <div class="ui">
          <span class="fake-btn" style:border-color={fgCss}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            확인
          </span>
          <span class="fake-input" style:border-color={fgCss}>입력 칸 테두리</span>
        </div>
      </div>
      <div class="preview inverse" style:background={toHex(vis.fg)} style:color={toHex(vis.bg)}>
        <p class="p16">거꾸로: 배경 색 글자를 글자 색 위에 — 같은 명암비 {fmtRatio(r)} : 1</p>
      </div>
    </section>

    <section class="card" aria-labelledby="h-cvd">
      <h2 id="h-cvd">색을 다르게 보는 사람에게는</h2>
      <div class="tiles">
        {#each tiles as t (t.id)}
          <div class="tile" title={t.note}>
            <span class="sample" style:background={t.b} style:color={t.f}>가나다 Aa</span>
            <b>{t.name}</b>
            <small class:low={t.r < 3}>{fmtRatio(t.r)} : 1</small>
          </div>
        {/each}
      </div>
      <p class="hint">Machado · Oliveira · Fernandes (2009) 모형으로 흉내 낸 색입니다. 명암비는 밝기만 보므로 색각과 상관없이 거의 같습니다 — 빨강 · 초록처럼 <b>색으로만 구분하는 표시</b>가 안 보이는지 확인하세요.</p>
    </section>

    <Swatches current={st[st.target]} />
  </div>
</div>

<style>
  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: end;
    gap: 8px;
  }
  .swap {
    height: 34px;
    font-size: 16px;
  }
  h2 small {
    font-weight: 600;
    color: var(--faint);
    margin-left: 4px;
  }
  .big {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 14px;
    padding: 12px 16px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--bad) 10%, var(--surface));
  }
  .big.mid {
    background: color-mix(in srgb, #f59f00 14%, var(--surface));
  }
  .big.ok {
    background: color-mix(in srgb, var(--ok) 11%, var(--surface));
  }
  .big strong {
    font-size: 40px;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .big strong span {
    font-size: 22px;
    font-weight: 650;
    color: var(--muted);
  }
  .big p {
    font-size: 14px;
    font-weight: 650;
  }
  .levels {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .levels li {
    display: grid;
    grid-template-columns: 20px 92px 52px minmax(0, 1fr);
    align-items: baseline;
    gap: 6px;
    padding: 4px 0;
    font-size: 13px;
    border-bottom: 1px solid var(--border);
  }
  .levels li:last-child {
    border-bottom: 0;
  }
  .mark {
    font-weight: 800;
    color: var(--bad);
  }
  .levels li.ok .mark {
    color: var(--ok);
  }
  .need {
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .levels small {
    color: var(--faint);
    font-size: 12px;
  }
  .apca {
    font-size: 13px;
    line-height: 1.6;
  }
  .apca small {
    display: block;
    font-size: 12px;
    color: var(--faint);
  }
  .tag {
    display: inline-block;
    padding: 0 7px;
    margin-right: 4px;
    border-radius: 99px;
    border: 1px solid var(--border-strong);
    font-size: 11px;
    font-weight: 650;
    color: var(--muted);
  }
  .pass {
    font-size: 13.5px;
    color: var(--ok);
  }
  .sugs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .sug {
    display: grid;
    gap: 6px;
    align-content: start;
    min-width: 0;
  }
  .sug h3 {
    font-size: 12.5px;
    font-weight: 650;
    color: var(--muted);
  }
  .pick {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 6px 8px 6px 6px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--surface);
    text-align: left;
  }
  .pick:hover {
    border-color: var(--app);
    background: var(--app-soft);
  }
  .mini {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
    font-size: 17px;
    font-weight: 750;
  }
  .txt {
    display: grid;
    min-width: 0;
  }
  .txt b {
    font-family: var(--mono);
    font-size: 13px;
  }
  .txt small {
    font-size: 11.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .go {
    font-size: 12px;
    font-weight: 650;
    color: var(--app);
  }
  .none {
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px dashed var(--border-strong);
    font-size: 12px;
    color: var(--faint);
  }
  .preview {
    display: grid;
    gap: 8px;
    padding: 18px 20px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  }
  .p24 {
    font-size: 24px;
    font-weight: 750;
    letter-spacing: -0.02em;
    line-height: 1.3;
  }
  .p16 {
    font-size: 16px;
    line-height: 1.6;
  }
  .p13 {
    font-size: 13px;
  }
  .ui {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }
  .fake-btn,
  .fake-input {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 12px;
    border: 1.5px solid;
    border-radius: 8px;
    font-size: 13.5px;
    font-weight: 650;
  }
  .fake-input {
    font-weight: 400;
    min-width: 150px;
  }
  .inverse {
    padding: 10px 16px;
  }
  .inverse .p16 {
    font-size: 14px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
  }
  .tile {
    display: grid;
    gap: 2px;
    justify-items: center;
    text-align: center;
    min-width: 0;
  }
  .sample {
    display: grid;
    place-items: center;
    width: 100%;
    height: 54px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
    font-size: 15px;
    font-weight: 700;
    white-space: nowrap;
  }
  .tile b {
    font-size: 12px;
    margin-top: 2px;
  }
  .tile small {
    font-size: 11.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .tile small.low {
    color: var(--bad);
  }
  @media (max-width: 520px) {
    .pair {
      grid-template-columns: minmax(0, 1fr);
    }
    .swap {
      justify-self: center;
    }
    .sugs {
      grid-template-columns: minmax(0, 1fr);
    }
    .tiles {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .levels li {
      grid-template-columns: 18px 84px 46px;
    }
    .levels small {
      grid-column: 2 / -1;
    }
    .big strong {
      font-size: 34px;
    }
  }
</style>
