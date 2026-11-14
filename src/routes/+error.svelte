<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { toolById, tools, type ToolInfo } from '$lib/tools';
  import { charDiff, guess } from '$lib/notfound';
  import { evaluate, formatNumber } from '$lib/calc/engine';
  import { formatBase } from '$lib/calc/programmer';
  import { convert, fmt as fmtUnit, rat } from '$lib/unit/core';
  import { findRuns, parse as parseCron } from '$lib/cron/core';
  import { describe } from '$lib/cron/explain';
  import { addWorkdays, defaultRules } from '$lib/date/work';
  import { fmt as fmtDay, today } from '$lib/date/core';
  import { parseColor } from '$lib/color/parse';
  import { fmtRatio, ratio } from '$lib/color/contrast';
  import { base64Encode, textStats, utf8Encode } from '$lib/encode/codec';
  import { randomInt } from '$lib/raffle/core';
  import Logo from '$lib/ui/Logo.svelte';
  import ThemeToggle from '$lib/ui/ThemeToggle.svelte';
  import ToolDrawer from '$lib/ui/ToolDrawer.svelte';

  const status = $derived(page.status);
  const missing = $derived(status === 404);

  const path = $derived.by(() => {
    try {
      return decodeURIComponent(page.url.pathname);
    } catch {
      return page.url.pathname;
    }
  });
  const found = $derived(missing ? guess(page.url.pathname) : null);
  const diff = $derived(found && found.via !== 'keyword' ? charDiff(found.typed, found.word) : null);

  // ── 404 를 도구에 넣어 본 결과. 적어 둔 값이 아니라 각 도구의 엔진이 그 자리에서 계산한다. ──
  interface Fact {
    tool: ToolInfo;
    ask: string;
    answer: string;
    note: string;
    swatch?: string;
    mono?: boolean;
  }

  /** 도구 하나가 실패해도 나머지 카드는 보여 준다 */
  function attempt(make: () => Fact): Fact | null {
    try {
      return make();
    } catch {
      return null;
    }
  }

  const facts = $derived.by(() => {
    const n = String(status);
    const list = [
      attempt(() => {
        const prog = { bits: 32 as const, signed: false };
        return {
          tool: toolById('calculator'),
          ask: `√${n}`,
          answer: formatNumber(evaluate(`√${n}`, { angle: 'deg' }), { digits: 12 }),
          note: `16진수 ${formatBase(BigInt(status), 16, prog)} · 2진수 ${formatBase(BigInt(status), 2, prog).replace(/^(0000 )+/, '')}`,
        };
      }),
      attempt(() => ({
        tool: toolById('unit'),
        ask: `${n}평`,
        answer: `${fmtUnit(convert(rat(status), 'pyeong', 'm2')!)} m²`,
        note: `어림값이 아니라 정확히 ${status * 400}/121 m²`,
      })),
      attempt(() => {
        const moved = addWorkdays(today(), status, defaultRules);
        return {
          tool: toolById('date'),
          ask: `오늘부터 근무일 ${n}일 뒤`,
          answer: fmtDay(moved.day),
          note: `주말 · 공휴일 ${moved.skipped.length}일을 건너뜁니다`,
        };
      }),
      attempt(() => {
        const expr = `${n[0]} ${n[1]} ${n[2]} * *`;
        const spec = parseCron(expr, 'unix').spec!;
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const next = findRuns(spec, tz, Date.now(), 1).runs[0];
        const when = next ? new Date(next.utc).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: tz }) : '';
        return { tool: toolById('cron'), ask: expr, answer: describe(spec), note: when ? `다음 실행은 ${when}` : '', mono: true };
      }),
      attempt(() => ({
        tool: toolById('encode'),
        ask: '이 주소를 Base64 로',
        answer: base64Encode(utf8Encode(path)),
        note: `${n} 는 ${base64Encode(utf8Encode(n))}`,
      })),
      attempt(() => {
        const hex = `#${n}${n}`;
        const r = ratio(parseColor('#fff')!.color, parseColor(hex)!.color);
        return {
          tool: toolById('color'),
          ask: hex,
          answer: `${fmtRatio(r)} : 1`,
          note: `흰 글자와의 대비 · ${r >= 7 ? 'AAA 통과' : r >= 4.5 ? 'AA 통과' : 'AA 미달'}`,
          swatch: hex,
        };
      }),
      attempt(() => {
        const s = textStats(path);
        return { tool: toolById('text'), ask: path, answer: `${s.chars}글자 · ${s.bytes}바이트`, note: s.chars > 24 ? '없는 주소치고는 꽤 깁니다' : '짧지만 없는 주소입니다', mono: true };
      }),
    ];
    return list.filter((f): f is Fact => f !== null);
  });

  // ── 여기서 헤맨 시간 ──
  let lost = $state(0);
  const clock = $derived(`${Math.floor(lost / 60)}:${String(lost % 60).padStart(2, '0')}`);
  const timerTool = toolById('timer');

  // ── 아무 도구나 뽑기 ──
  let drawn = $state<ToolInfo | null>(null);
  let spinning = $state(false);
  let spin = 0;
  let resultLink = $state<HTMLAnchorElement | null>(null);

  function draw() {
    if (spinning) return;
    const winner = tools[randomInt(tools.length)];
    const steps = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 20;
    spinning = true;
    let i = 0;
    const next = () => {
      if (i >= steps) {
        drawn = winner;
        spinning = false;
        requestAnimationFrame(() => resultLink?.focus({ preventScroll: true }));
        return;
      }
      let t: ToolInfo;
      do t = tools[randomInt(tools.length)];
      while (t === drawn);
      drawn = t;
      i++;
      // 릴처럼 점점 느려진다
      spin = window.setTimeout(next, 45 + 240 * (i / steps) ** 2.4);
    };
    next();
  }

  onMount(() => {
    const started = Date.now();
    const tick = window.setInterval(() => (lost = Math.floor((Date.now() - started) / 1000)), 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(spin);
    };
  });
</script>

<svelte:head>
  <title>{missing ? '없는 주소' : '오류'} ({status}) — tools.euiyun.com</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#snippet icon(t: ToolInfo, size = 16)}
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={t.icon} /></svg>
{/snippet}

<div class="wrap">
  <header>
    <ToolDrawer />
    <a class="brand" href="/" aria-label="tools.euiyun.com">
      <Logo size={24} />
      <span>tools<span class="dim">.euiyun.com</span></span>
    </a>
    <nav><ThemeToggle /></nav>
  </header>

  <main>
    <section class="hero">
      <p class="digits" aria-hidden="true">
        {#each String(status) as ch, i (i)}<span style:--i={i}>{ch}</span>{/each}
      </p>

      {#if missing}
        <h1>여기엔 도구가 없습니다.</h1>
        <p class="lead"><code>{path}</code> 라는 주소는 없습니다. 주소를 잘못 적었거나, 아직 만들지 않은 도구입니다.</p>
      {:else}
        <h1>문제가 생겼습니다.</h1>
        <p class="lead">{page.error?.message ?? '알 수 없는 오류'} <span class="code">({status})</span></p>
      {/if}

      {#if found}
        <div class="guess app-scope" style:--app={found.tool.color}>
          <p class="guess-title">혹시 이 도구를 찾으셨나요?</p>
          {#if diff}
            <div class="diff" aria-label="적은 주소 /{found.typed}, 있는 주소 {found.tool.href}">
              <div class="del"><i>−</i><code>/{#each diff.segA as s, i (i)}{#if s.changed}<del>{s.text}</del>{:else}{s.text}{/if}{/each}{#if found.via === 'exact' && path.replace(/\/$/, '').toLowerCase() !== `/${found.typed}`}<del>…</del>{/if}</code></div>
              <div class="add"><i>+</i><code>/{#each diff.segB as s, i (i)}{#if s.changed}<ins>{s.text}</ins>{:else}{s.text}{/if}{/each}</code></div>
            </div>
          {/if}
          <a class="go" href={found.tool.href}>
            <span class="tile">{@render icon(found.tool, 20)}</span>
            <span class="go-text">
              <b>{found.tool.name}</b>
              <small>
                {#if found.via === 'keyword'}‘{found.typed}’ 은(는) 여기서 다룹니다 · {found.tool.short}
                {:else if found.word !== found.tool.href.slice(1)}‘{found.word}’ 을(를) 찾으셨다면 · {found.tool.short}
                {:else}{found.tool.short}{/if}
              </small>
            </span>
            <span class="arrow" aria-hidden="true">→</span>
          </a>
        </div>
      {/if}

      <div class="actions">
        <a class="btn primary" href="/">모든 도구 보기</a>
        {#if !missing}
          <button class="btn" onclick={() => location.reload()}>다시 시도</button>
        {/if}
        <button class="btn" onclick={draw} disabled={spinning}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="3.5" /><path d="M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01" stroke-width="2.4" />
          </svg>
          {drawn && !spinning ? '다시 뽑기' : '아무 도구나 뽑기'}
        </button>
        {#if drawn}
          {#if spinning}
            <span class="slot app-scope" style:--app={drawn.color} aria-hidden="true">
              {#key drawn.id}
                <span class="slot-in"><span class="tile sm">{@render icon(drawn)}</span>{drawn.name}</span>
              {/key}
            </span>
          {:else}
            <a class="slot won app-scope" style:--app={drawn.color} href={drawn.href} bind:this={resultLink}>
              <span class="slot-in"><span class="tile sm">{@render icon(drawn)}</span>{drawn.name}<span class="arrow" aria-hidden="true">→</span></span>
            </a>
          {/if}
        {/if}
        <span class="sr-only" role="status">{drawn && !spinning ? `${drawn.name} 이(가) 뽑혔습니다` : ''}</span>
      </div>
    </section>

    {#if missing}
      <section class="facts" aria-labelledby="facts-title">
        <h2 id="facts-title">온 김에, 404 를 도구에 넣어 봤습니다</h2>
        <div class="grid">
          {#each facts as f (f.tool.id)}
            <a class="fact app-scope" href={f.tool.href} style:--app={f.tool.color}>
              <span class="fact-tool"><span class="tile sm">{@render icon(f.tool)}</span>{f.tool.name}</span>
              <span class="ask" class:mono={f.mono}>{f.ask}</span>
              <strong>
                {#if f.swatch}<i class="swatch" style:background={f.swatch}>Aa</i>{/if}
                <span>{f.answer}</span>
              </strong>
              <span class="note">{f.note}</span>
            </a>
          {/each}
          <a class="fact app-scope" href={timerTool.href} style:--app={timerTool.color}>
            <span class="fact-tool"><span class="tile sm">{@render icon(timerTool)}</span>{timerTool.name}</span>
            <span class="ask">여기서 헤맨 시간</span>
            <strong class="clock"><span>{clock}</span></strong>
            <span class="note">{lost < 20 ? '아직은 괜찮습니다' : lost < 60 ? '슬슬 다른 데로 가실 때입니다' : '이 정도면 이 페이지도 도구입니다'}</span>
          </a>
        </div>
      </section>
    {/if}
  </main>
</div>

<style>
  .wrap {
    max-width: 1080px;
    margin: 0 auto;
    padding: 0 20px 56px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 60px;
  }
  header nav {
    margin-left: auto;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
    font-weight: 750;
    font-size: 16px;
    letter-spacing: -0.02em;
    text-decoration: none;
  }
  .dim {
    color: var(--faint);
    font-weight: 550;
  }

  .hero {
    padding: 36px 0 8px;
    max-width: 640px;
  }

  /* 로고의 네모를 닮은 숫자 타일. 삐뚤게 놓였다가, 올리면 바로 선다. */
  .digits {
    display: flex;
    gap: 10px;
    margin-bottom: 26px;
  }
  .digits span {
    display: grid;
    place-items: center;
    width: clamp(72px, 19vw, 104px);
    aspect-ratio: 1 / 1.08;
    border-radius: 22%;
    background: var(--c-calc);
    color: #fff;
    font-size: clamp(50px, 13.5vw, 74px);
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    box-shadow: var(--shadow-md);
    transform: rotate(-7deg);
    transition: transform 0.35s cubic-bezier(0.3, 1.6, 0.5, 1);
    animation: drop 0.6s cubic-bezier(0.3, 1.5, 0.5, 1) backwards;
    animation-delay: calc(var(--i) * 90ms);
    user-select: none;
  }
  .digits span:nth-child(2) {
    background: var(--c-raffle);
    transform: rotate(5deg) translateY(9px);
  }
  .digits span:nth-child(3) {
    background: var(--c-image);
    transform: rotate(-3deg) translateY(-3px);
  }
  .digits span:nth-child(n + 4) {
    background: var(--c-diff);
  }
  .digits span:hover {
    transform: none;
  }
  :global(:root[data-theme='dark']) .digits span {
    color: var(--on-app);
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .digits span {
      color: var(--on-app);
    }
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-46px) rotate(18deg);
    }
  }

  h1 {
    font-size: clamp(30px, 5.4vw, 44px);
    line-height: 1.16;
    letter-spacing: -0.045em;
    font-weight: 800;
  }
  .lead {
    margin-top: 14px;
    font-size: 16px;
    line-height: 1.7;
    color: var(--muted);
  }
  .lead code {
    padding: 1px 6px;
    border-radius: 6px;
    background: var(--surface-3);
    color: var(--text);
    font-family: var(--mono);
    font-size: 0.9em;
  }
  .code {
    color: var(--faint);
  }

  .tile {
    flex: none;
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 11px;
    background: var(--app-soft);
    color: var(--app);
  }
  .tile.sm {
    width: 24px;
    height: 24px;
    border-radius: 7px;
  }
  .arrow {
    color: var(--app);
    transition: transform 0.16s ease;
  }

  /* 짐작한 도구: 비교 도구처럼 달라진 글자를 짚는다 */
  .guess {
    margin-top: 24px;
    border-radius: 16px;
    background: var(--surface);
    border: 1px solid var(--app-line);
    box-shadow: var(--shadow-md);
    overflow: hidden;
  }
  .guess-title {
    padding: 12px 16px 10px;
    font-size: 12.5px;
    font-weight: 650;
    color: var(--muted);
  }
  .diff {
    border-block: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 14px;
    line-height: 2.2;
  }
  .diff div {
    display: flex;
    gap: 10px;
    padding: 0 16px;
    background: color-mix(in srgb, var(--bad) 9%, var(--surface));
  }
  .diff .add {
    background: color-mix(in srgb, var(--ok) 11%, var(--surface));
  }
  .diff i {
    font-style: normal;
    color: var(--faint);
    user-select: none;
  }
  .diff code {
    font: inherit;
    min-width: 0;
  }
  .diff del,
  .diff ins {
    text-decoration: none;
    border-radius: 3px;
    padding: 2px 1px;
    background: color-mix(in srgb, var(--bad) 30%, var(--surface));
  }
  .diff ins {
    background: color-mix(in srgb, var(--ok) 34%, var(--surface));
  }
  .go {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    text-decoration: none;
  }
  .go:hover {
    background: var(--app-soft);
  }
  .go:hover .arrow,
  .slot.won:hover .arrow {
    transform: translateX(4px);
  }
  .go-text {
    display: grid;
    min-width: 0;
    flex: 1;
  }
  .go-text b {
    font-size: 16px;
    letter-spacing: -0.02em;
  }
  .go-text small {
    font-size: 12.5px;
    color: var(--muted);
  }
  .go .arrow {
    font-size: 18px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 24px;
  }
  .actions .btn {
    height: 38px;
    padding: 0 14px;
    font-size: 14px;
    text-decoration: none;
  }
  .slot {
    display: inline-flex;
    align-items: center;
    height: 38px;
    min-width: 172px;
    padding: 0 12px 0 7px;
    border-radius: var(--radius-sm);
    border: 1px dashed var(--app-line);
    background: var(--app-soft);
    font-size: 14px;
    font-weight: 650;
    text-decoration: none;
    overflow: hidden;
  }
  .slot-in {
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
    animation: roll 0.12s ease-out;
  }
  .slot .tile {
    background: var(--surface);
  }
  .slot.won {
    min-width: 0;
    border-style: solid;
    border-color: var(--app);
    animation: pop 0.4s cubic-bezier(0.3, 1.7, 0.5, 1);
  }
  .slot.won .slot-in {
    animation: none;
  }
  @keyframes roll {
    from {
      opacity: 0.2;
      transform: translateY(-70%);
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.9);
    }
  }

  .facts {
    margin-top: 52px;
  }
  .facts h2 {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
    font-size: 13px;
    font-weight: 650;
    letter-spacing: 0.02em;
    color: var(--muted);
  }
  .facts h2::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
  }
  .fact {
    display: grid;
    align-content: start;
    gap: 4px;
    min-width: 0;
    padding: 14px 16px 15px;
    border-radius: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    text-decoration: none;
    transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
  }
  .fact:hover {
    transform: translateY(-3px);
    box-shadow: var(--shadow-lg);
    border-color: var(--app-line);
  }
  .fact-tool {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 12.5px;
    font-weight: 650;
    color: var(--muted);
  }
  .ask {
    font-size: 12.5px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ask.mono {
    font-family: var(--mono);
  }
  .fact strong {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.3;
    color: var(--app);
    font-variant-numeric: tabular-nums;
  }
  .fact strong span {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fact strong.clock {
    font-size: 26px;
    line-height: 1;
    padding: 3px 0;
  }
  .swatch {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 26px;
    border-radius: 7px;
    color: #fff;
    font-style: normal;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0;
  }
  .note {
    font-size: 12px;
    color: var(--faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 980px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 520px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .hero {
      padding-top: 20px;
    }
  }
</style>
