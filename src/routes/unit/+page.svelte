<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import { load, save } from '$lib/storage';
  import { baseOf, duration, feetInches, fromBase, show, siSize, toBase, transferSeconds, windowsSize, type Ctx } from '$lib/unit/core';
  import { parse, write, type Part, type Reading } from '$lib/unit/parse';
  import { rat, value, type Rat } from '$lib/unit/rat';
  import { catById, categories, papers, unitById, unitOf, unitsOf, type CatId, type Paper } from '$lib/unit/units';

  const KEY = 'tools:unit:v1';
  const SIGS: [number, string][] = [
    [6, '보통'],
    [12, '자세히'],
    [30, '모두'],
  ];
  const DPIS = [72, 96, 150, 300, 600];
  const SPEED_UNITS = ['Mbps', 'Gbps', 'MBps', 'KBps'];
  const SPEEDS: [number, string][] = [
    [100, 'Mbps'],
    [500, 'Mbps'],
    [1, 'Gbps'],
    [10, 'Gbps'],
  ];
  const SIZES: [string, string][] = [
    ['5 MB', '사진 한 장'],
    ['100 MB', ''],
    ['1 GB', ''],
    ['4 GB', '영화 한 편쯤'],
    ['50 GB', '큰 게임'],
    ['1 TB', ''],
  ];
  const EXAMPLES = ['32평', '5ft 11in', '1 TB', '100 Mbps', '36.5도', '3근', '시속 100km', 'A4', '105㎡는 몇 평'];

  let text = $state('');
  let cat = $state<CatId>('area');
  /** 숫자만 적었을 때 쓰는 단위 (분류마다) */
  let from = $state<Record<string, string>>({});
  let sig = $state(6);
  let dpi = $state(96);
  let delta = $state(false);
  let withUnit = $state(false);
  let speed = $state(100);
  let speedUnit = $state('Mbps');
  let ready = $state(false);
  let toast = $state('');
  let inputEl = $state<HTMLInputElement>();

  const ctx = $derived<Ctx>({ dpi: Math.min(10000, Math.max(1, Number(dpi) || 96)), delta });
  const fromOf = (c: CatId) => (from[c] && unitById.get(from[c])?.cat === c ? from[c] : catById.get(c)!.first);

  function say(msg: string) {
    toast = msg;
    setTimeout(() => toast === msg && (toast = ''), 2200);
  }
  async function copy(t: string, what = '') {
    try {
      await navigator.clipboard.writeText(t);
      say(`${what || t} 복사했습니다`);
    } catch {
      say('복사하지 못했습니다');
    }
  }

  // ── 읽기 ──
  const parsed = $derived(parse(text, cat));
  /** 지금 바꾸는 값. 숫자만 · 빈칸이면 고른 단위로, 못 읽으면 null */
  const reading = $derived.by((): Reading | null => {
    if (parsed.kind === 'quantity') return parsed.readings[0];
    if (parsed.kind === 'number' || parsed.kind === 'empty') {
      const id = fromOf(cat);
      const part: Part = parsed.kind === 'number' ? { raw: parsed.raw, value: parsed.value, id } : { raw: '1', value: rat(1), id };
      return { cat, unit: id, parts: [part], text: write(part.raw, id) };
    }
    return null;
  });
  const alts = $derived(parsed.kind === 'quantity' ? parsed.readings.slice(1) : []);
  const target = $derived(parsed.kind === 'quantity' ? parsed.target : undefined);
  const paper = $derived(parsed.kind === 'paper' ? parsed.paper : null);

  // 못 읽는 동안에는 마지막으로 읽은 것을 그대로 보여 준다
  let lastGood = $state.raw<Reading | null>(null);
  $effect(() => {
    if (reading) lastGood = reading;
  });
  const shown = $derived(reading ?? lastGood);

  // 읽은 분류로 따라간다
  $effect(() => {
    const r = parsed.kind === 'quantity' ? parsed.readings[0] : null;
    if (r && (r.cat !== cat || from[r.cat] !== r.unit)) {
      cat = r.cat;
      from[r.cat] = r.unit;
    } else if (paper && cat !== 'print') cat = 'print';
  });

  const base = $derived(shown ? baseOf(shown.parts, ctx) : null);
  const rows = $derived(
    shown
      ? unitsOf(shown.cat).map((u) => {
          const v = base && fromBase(base, u, ctx);
          return { u, v, s: v ? show(v, sig) : null };
        })
      : [],
  );
  const heroId = $derived(shown ? (target ?? unitOf(shown.unit).hero ?? unitsOf(shown.cat).find((u) => u.id !== shown.unit)!.id) : '');
  const hero = $derived(rows.find((r) => r.u.id === heroId));
  const single = $derived(shown?.parts.length === 1);
  const said = $derived(shown ? shown.parts.map((p) => `${p.raw} ${unitOf(p.id).sym}`).join(' ') : '');

  // 분류마다 덧붙이는 것
  const extra = $derived.by(() => {
    if (!shown || !base) return '';
    const b = value(base);
    if (shown.cat === 'length' && b.gte('0.3') && b.lte(300) && !['ft', 'in'].includes(shown.unit)) return `${feetInches(base)} (피트 · 인치)`;
    if (shown.cat === 'time' && b.gte(60)) return duration(base);
    return '';
  });

  const isDecimalBytes = $derived(!!shown && ['KB', 'MB', 'GB', 'TB', 'PB'].includes(shown.unit));
  const win = $derived(shown?.cat === 'data' && base ? windowsSize(base) : null);
  const si = $derived(shown?.cat === 'data' && base ? siSize(base) : '');
  const speedBps = $derived.by(() => {
    const n = Number(speed);
    if (!(n > 0)) return null;
    return toBase(rat(String(n)), unitOf(speedUnit), ctx);
  });
  const transfer = $derived(shown?.cat === 'data' && base && speedBps ? transferSeconds(base, speedBps) : null);
  const rateTable = $derived.by(() => {
    if (shown?.cat !== 'rate' || !base || value(base).lte(0)) return [];
    return SIZES.map(([size, label]) => {
      const p = parse(size);
      const bytes = p.kind === 'quantity' ? baseOf(p.readings[0].parts, ctx) : null;
      const t = bytes && transferSeconds(bytes, base);
      return { size, label, time: t ? duration(t) : '—' };
    });
  });

  // ── 바꾸기 ──
  function setText(t: string) {
    text = t;
  }
  /** 이 단위로 다시 적기 */
  function useUnit(id: string) {
    const u = unitOf(id);
    if (shown && base && u.cat === shown.cat) {
      const v = fromBase(base, u, ctx);
      if (v) {
        cat = u.cat;
        from[u.cat] = id;
        setText(write(show(v, 12).plain, id));
        return;
      }
    }
    from[u.cat] = id;
  }
  function pickCat(c: CatId) {
    if (c === cat && reading) return;
    const raw = single && shown && parsed.kind !== 'empty' ? shown.parts[0].raw : '1';
    cat = c;
    const id = fromOf(c);
    setText(parsed.kind === 'empty' ? '' : write(raw, id));
  }
  /** 고른 단위로 같은 숫자를 다시 읽기 */
  function changeUnit(id: string) {
    from[cat] = id;
    if (shown && single && parsed.kind !== 'empty') setText(write(shown.parts[0].raw, id));
  }
  function rowText(r: { u: { sym: string }; s: { plain: string } | null }) {
    return r.s ? (withUnit ? `${r.s.plain} ${r.u.sym}` : r.s.plain) : '';
  }
  function copyRow(r: (typeof rows)[number]) {
    if (r.s) copy(rowText(r), `${r.s.text} ${r.u.sym} 를`);
  }
  function usePaper(p: Paper) {
    setText(p.name);
  }

  // ↑ ↓ 로 숫자를 하나씩 (Shift 는 10씩)
  function step(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      if (hero?.s) copyRow(hero);
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const m = /^(-?\d+(?:\.\d+)?)(\s*\D.*)?$/.exec(text.trim());
    if (!m) return;
    e.preventDefault();
    const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1);
    const places = m[1].split('.')[1]?.length ?? 0;
    const next = (Number(m[1]) + d).toFixed(places);
    setText(next + (m[2] ?? ''));
  }

  function onKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    if (e.key === '/' && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
      e.preventDefault();
      inputEl?.focus();
      inputEl?.select();
    }
  }

  // ── 용지 ──
  const paperDims = $derived.by(() => {
    if (!paper) return [];
    const mm = (v: number) => rat(String(v));
    const as = (v: number, id: string) => show(fromBase(toBase(mm(v), unitOf('mmP'), ctx)!, unitOf(id), ctx)!, 4).text;
    return [
      ['mm', `${paper.w} × ${paper.h}`],
      ['cm', `${as(paper.w, 'cmP')} × ${as(paper.h, 'cmP')}`],
      ['in', `${as(paper.w, 'inP')} × ${as(paper.h, 'inP')}`],
      ['pt', `${as(paper.w, 'pt')} × ${as(paper.h, 'pt')}`],
      [`px (${ctx.dpi} DPI)`, `${pxOf(paper.w)} × ${pxOf(paper.h)}`],
    ];
  });
  function pxOf(mmValue: number) {
    const v = fromBase(toBase(rat(String(mmValue)), unitOf('mmP'), ctx)!, unitOf('px'), ctx)!;
    return show(rat(value(v).toDecimalPlaces(0)), 15).text;
  }
  const paperGroups = $derived([...new Set(papers.map((p) => p.group))].map((g) => ({ g, list: papers.filter((p) => p.group === g) })));

  // ── 저장 ──
  onMount(() => {
    const s = load<Record<string, any>>(KEY, {});
    if (typeof s.text === 'string') text = s.text.slice(0, 500);
    if (catById.has(s.cat)) cat = s.cat;
    if (s.from && typeof s.from === 'object') {
      for (const [c, id] of Object.entries(s.from)) if (typeof id === 'string' && unitById.get(id)?.cat === c) from[c] = id;
    }
    if (SIGS.some(([n]) => n === s.sig)) sig = s.sig;
    if (Number.isFinite(s.dpi) && s.dpi >= 1 && s.dpi <= 10000) dpi = s.dpi;
    delta = s.delta === true;
    withUnit = s.withUnit === true;
    if (Number.isFinite(s.speed) && s.speed > 0) speed = s.speed;
    if (SPEED_UNITS.includes(s.speedUnit)) speedUnit = s.speedUnit;
    ready = true;
    if (matchMedia('(pointer: fine)').matches) tick().then(() => inputEl?.focus());
  });
  $effect(() => {
    const snap = { text, cat, from: { ...from }, sig, dpi, delta, withUnit, speed, speedUnit };
    if (ready) save(KEY, snap);
  });
</script>

<svelte:window onkeydown={onKey} />

<ToolShell tool="unit">
  {#snippet actions()}
    <div class="seg" role="group" aria-label="자릿수">
      {#each SIGS as [n, name] (n)}<button aria-pressed={sig === n} onclick={() => (sig = n)}>{name}</button>{/each}
    </div>
  {/snippet}

  <div class="unit">
    <div class="page">
      <section class="pane" aria-label="입력과 설정">
        <div class="card ask">
          <label class="sr-only" for="unit-input">바꿀 값</label>
          <input
            id="unit-input"
            class="field big"
            bind:this={inputEl}
            bind:value={text}
            onkeydown={step}
            type="text"
            inputmode="text"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="32평, 5ft 11in, 1.5 GB, 36.5도 …"
            aria-describedby="unit-read"
          />
          <p id="unit-read" class="read" class:bad={parsed.kind === 'error'} aria-live="polite">
            {#if parsed.kind === 'error'}
              {parsed.message}
            {:else if paper}
              <b>용지</b> · {paper.name} 로 읽었습니다
            {:else if parsed.kind === 'empty'}
              단위를 붙여 적으면 알아서 읽습니다. 숫자만 적으면 아래에서 고른 단위로.
            {:else if shown}
              <b>{catById.get(shown.cat)!.name}</b> · {said}{parsed.kind === 'number' ? ' (고른 단위)' : ''}{target ? ` → ${unitOf(target).sym}` : ''} 로 읽었습니다
            {/if}
          </p>
          {#if alts.length}
            <div class="alts" role="group" aria-label="다르게 읽기">
              <span>혹시</span>
              {#each alts as a (a.cat + a.text)}
                <button onclick={() => setText(a.text)}>{a.text} <small>{catById.get(a.cat)!.name}</small></button>
              {/each}
            </div>
          {/if}
          {#if paper && parsed.kind === 'paper' && parsed.others.length}
            <div class="alts" role="group" aria-label="다른 규격">
              <span>혹시</span>
              {#each parsed.others as o (o.id)}<button onclick={() => usePaper(o)}>{o.name} <small>{o.w} × {o.h}</small></button>{/each}
            </div>
          {/if}
          <div class="pick">
            <label class="f">
              <span>적은 단위</span>
              <select class="field" value={shown && shown.cat === cat ? shown.unit : fromOf(cat)} disabled={!single || !!paper} onchange={(e) => changeUnit(e.currentTarget.value)} aria-label="적은 단위">
                {#each unitsOf(cat) as u (u.id)}<option value={u.id}>{u.sym === u.name ? u.sym : `${u.sym} — ${u.name}`}</option>{/each}
              </select>
            </label>
          </div>
        </div>

        <div class="card">
          <h2>분류</h2>
          <div class="cats" role="group" aria-label="분류 고르기">
            {#each categories as c (c.id)}
              <button aria-pressed={cat === c.id} onclick={() => pickCat(c.id)}>{c.name}</button>
            {/each}
          </div>
        </div>

        <div class="card">
          <h2>이렇게 적어 보세요</h2>
          <div class="chips" role="group" aria-label="예시">
            {#each EXAMPLES as ex (ex)}<button onclick={() => setText(ex)}>{ex}</button>{/each}
          </div>
          <p class="hint"><kbd>/</kbd> 입력칸으로 · <kbd>↑</kbd> <kbd>↓</kbd> 숫자 하나씩 (<kbd>Shift</kbd> 10씩) · <kbd>Enter</kbd> 큰 답 복사</p>
        </div>

        <div class="card opts">
          <label class="check"><input type="checkbox" bind:checked={withUnit} /> 복사할 때 단위도 붙이기</label>
          {#if cat === 'temp'}
            <label class="check"><input type="checkbox" bind:checked={delta} /> 온도 차이로 바꾸기 <small>(0점을 무시: 10°C 차이 = 18°F 차이)</small></label>
          {/if}
          {#if cat === 'print'}
            <div class="f">
              <span>해상도 (DPI) <small>— px 을 셀 때</small></span>
              <div class="dpi">
                <div class="seg" role="group" aria-label="해상도">
                  {#each DPIS as d (d)}<button aria-pressed={ctx.dpi === d} onclick={() => (dpi = d)}>{d}</button>{/each}
                </div>
                <input class="field num" type="number" min="1" max="10000" bind:value={dpi} aria-label="해상도 직접 적기" />
              </div>
              <p class="hint">96 은 화면(CSS) 기준, 72 는 옛 Mac · PDF 의 pt, 300 은 보통 인쇄, 600 은 고급 인쇄입니다.</p>
            </div>
          {/if}
        </div>
      </section>

      <section class="results" aria-label="바꾼 결과">
        {#if paper}
          <div class="card hero-card">
            <p class="said">{paper.name} <small>{paper.group}</small></p>
            <button class="hero" onclick={() => copy(`${paper.w} × ${paper.h} mm`)} title="눌러서 복사">
              {paper.w} × {paper.h} <small>mm</small>
            </button>
            {#if paper.note}<p class="sub">{paper.note}</p>{/if}
            <p class="sub">가로로 놓으면 {paper.h} × {paper.w} mm</p>
          </div>
          <div class="card">
            <h2>{paper.name} 크기</h2>
            <ul class="rows" aria-label="용지 크기">
              {#each paperDims as [label, dims] (label)}
                <li>
                  <span class="u"><b>{label}</b></span>
                  <button class="v" onclick={() => copy(dims)}>{dims}</button>
                </li>
              {/each}
            </ul>
            <div class="f">
              <span>해상도 (DPI) <small>— px 을 셀 때</small></span>
              <div class="seg" role="group" aria-label="용지 해상도">
                {#each DPIS as d (d)}<button aria-pressed={ctx.dpi === d} onclick={() => (dpi = d)}>{d}</button>{/each}
              </div>
            </div>
          </div>
        {:else if shown && hero}
          <div class="card hero-card" class:stale={!reading}>
            <p class="said">{said} =</p>
            <button class="hero" onclick={() => copyRow(hero)} title="눌러서 복사" aria-label="{hero.s?.text ?? ''} {hero.u.sym} 복사">
              {#if hero.s}{hero.s.approx ? '≈ ' : ''}{hero.s.text} <small>{hero.u.sym}</small>{:else}—{/if}
            </button>
            {#if extra}<p class="sub">= {extra}</p>{/if}
            {#if !reading}<p class="sub bad">입력을 읽지 못해서, 마지막으로 읽은 값을 보여 줍니다.</p>{/if}
          </div>

          {#if shown.cat === 'data' && base}
            <div class="card">
              <h2>디스크에 보이는 크기</h2>
              <dl class="facts">
                <div><dt>제조사 · macOS</dt><dd>{si}</dd></div>
                <div><dt>Windows 탐색기</dt><dd>{win ?? si}</dd></div>
              </dl>
              {#if isDecimalBytes && win}
                <p class="hint">
                  "1 TB 디스크가 931 GB 로 보이는" 까닭: 제조사는 1 TB = 1000⁴ 바이트로 팔고, Windows 는 1024 로 나누면서도 단위는 GB 라고 적습니다 (사실은 GiB). 빠진 게 아니라 세는 법이 다릅니다.
                </p>
              {/if}
            </div>
            <div class="card">
              <h2>받는 데 걸리는 시간</h2>
              <div class="speed">
                <input class="field num" type="number" min="0" step="any" bind:value={speed} aria-label="속도" />
                <select class="field" bind:value={speedUnit} aria-label="속도 단위">
                  {#each SPEED_UNITS as id (id)}<option value={id}>{unitOf(id).sym}</option>{/each}
                </select>
                <div class="chips" role="group" aria-label="자주 쓰는 속도">
                  {#each SPEEDS as [n, id] (n + id)}<button aria-pressed={speed === n && speedUnit === id} onclick={() => ((speed = n), (speedUnit = id))}>{n} {unitOf(id).sym}</button>{/each}
                </div>
              </div>
              <p class="answer">{transfer ? duration(transfer) : '속도를 적으세요'}</p>
              <p class="hint">회선 속도 그대로 받을 때입니다. 실제로는 서버 · 와이파이 사정으로 보통 이보다 더 걸립니다.</p>
            </div>
          {/if}

          {#if rateTable.length}
            <div class="card">
              <h2>이 속도로 받으면</h2>
              <ul class="rows" aria-label="받는 시간">
                {#each rateTable as r (r.size)}
                  <li>
                    <span class="u"><b>{r.size}</b>{#if r.label}<small>{r.label}</small>{/if}</span>
                    <span class="v static">{r.time}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          <div class="card">
            <h2>{catById.get(shown.cat)!.name} — 모든 단위 <small>값을 누르면 복사, 단위를 누르면 그 단위로 적습니다</small></h2>
            <ul class="rows" aria-label="모든 단위">
              {#each rows as r (r.u.id)}
                <li class:src={r.u.id === shown.unit && single} class:hit={r.u.id === heroId} class:main={r.u.main}>
                  <button class="u" onclick={() => useUnit(r.u.id)} title="{r.u.sym} 로 적기">
                    <b>{r.u.sym}</b>
                    <span>{#if r.u.name !== r.u.sym}{r.u.name}{/if}{#if r.u.note}<small>{r.u.name !== r.u.sym ? ' · ' : ''}{r.u.note}</small>{/if}</span>
                  </button>
                  <button class="v" disabled={!r.s} onclick={() => copyRow(r)} aria-label="{r.u.name} 값 복사">
                    {#if r.s}{#if r.s.approx}<i aria-label="약">≈</i>{/if}{r.s.text}{:else}—{/if}
                  </button>
                </li>
              {/each}
            </ul>
            {#if catById.get(shown.cat)?.note}<p class="hint note">{catById.get(shown.cat)!.note}</p>{/if}
            <p class="hint">≈ 는 자른 값입니다. 위에서 "자세히" · "모두" 를 고르면 더 많은 자리를 보여 줍니다.</p>
          </div>
        {/if}

        {#if cat === 'print'}
          <div class="card">
            <h2>용지 크기 <small>누르면 크기를 봅니다</small></h2>
            {#each paperGroups as { g, list } (g)}
              <div class="papers">
                <span>{g}</span>
                <div class="chips">
                  {#each list as p (p.id)}<button aria-pressed={paper?.id === p.id} onclick={() => usePaper(p)}>{p.name}</button>{/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  </div>
  {#if toast}<p class="toast" role="status">{toast}</p>{/if}
</ToolShell>

<style>
  .unit {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .page {
    display: grid;
    grid-template-columns: minmax(300px, 400px) minmax(0, 1fr);
    align-items: start;
    gap: 12px;
    padding: 14px;
    max-width: 1180px;
    margin: 0 auto;
  }
  .pane,
  .results {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
  }
  .card h2 {
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
  }
  .card h2 small {
    margin-left: 6px;
    font-size: 12px;
    font-weight: 400;
    color: var(--faint);
  }
  .big {
    width: 100%;
    height: 48px;
    font-size: 19px;
    font-weight: 600;
    padding: 0 14px;
  }
  .big:focus {
    border-color: var(--app);
    outline: 3px solid var(--app-soft);
    outline-offset: 0;
  }
  .read {
    font-size: 13px;
    color: var(--muted);
  }
  .read b {
    color: var(--app);
  }
  .read.bad,
  .bad {
    color: var(--bad);
  }
  .alts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--muted);
  }
  .alts button {
    height: 26px;
    padding: 0 10px;
    border: 1px dashed var(--app-line);
    border-radius: 99px;
    background: var(--surface);
    font-size: 12.5px;
    font-weight: 600;
  }
  .alts button:hover {
    background: var(--app-soft);
  }
  .alts small {
    font-weight: 400;
    color: var(--faint);
  }
  .pick {
    display: grid;
    gap: 8px;
  }
  .f {
    display: grid;
    gap: 4px;
    min-width: 0;
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
  }
  .f small {
    font-weight: 400;
    color: var(--faint);
  }
  .f .seg {
    justify-self: start;
  }
  .f .hint {
    font-weight: 400;
  }
  .f .field {
    width: 100%;
    font-weight: 400;
    color: var(--text);
  }
  .cats,
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .cats button,
  .chips button {
    height: 28px;
    padding: 0 11px;
    border: 1px solid var(--border-strong);
    border-radius: 99px;
    background: var(--surface);
    font-size: 12.5px;
    color: var(--muted);
  }
  .chips button {
    height: 26px;
    font-size: 12px;
  }
  .cats button:hover,
  .chips button:hover {
    border-color: var(--app-line);
    color: var(--text);
  }
  .cats button[aria-pressed='true'],
  .chips button[aria-pressed='true'] {
    border-color: var(--app);
    background: var(--app-soft);
    color: var(--text);
    font-weight: 650;
  }
  .hint {
    font-size: 12px;
    line-height: 1.7;
    color: var(--faint);
  }
  .hint.note {
    color: var(--muted);
  }
  .opts {
    gap: 8px;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .check input {
    accent-color: var(--app);
  }
  .check small {
    font-size: 12px;
    color: var(--faint);
  }
  .dpi {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .num {
    width: 92px !important;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .hero-card {
    gap: 4px;
    background: var(--app-soft);
    border-color: var(--app-line);
  }
  .hero-card.stale {
    opacity: 0.75;
  }
  .said {
    font-size: 14px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .said small {
    margin-left: 4px;
    color: var(--faint);
  }
  .hero {
    justify-self: start;
    max-width: 100%;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    font-size: clamp(28px, 5vw, 40px);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
    border-radius: 8px;
  }
  .hero small {
    font-size: 0.55em;
    font-weight: 700;
    color: var(--app);
  }
  .hero:hover {
    color: color-mix(in srgb, var(--text) 80%, var(--app));
  }
  .sub {
    font-size: 13.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .rows {
    list-style: none;
    margin: 0 -8px;
    padding: 0;
    display: grid;
  }
  .rows li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    border-radius: 9px;
  }
  .rows li + li {
    border-top: 1px solid var(--border);
  }
  .rows li.src {
    background: var(--surface-2);
  }
  .rows li.hit {
    background: var(--app-soft);
    box-shadow: inset 3px 0 0 var(--app);
  }
  .rows li.hit + li,
  .rows li.src + li {
    border-top-color: transparent;
  }
  .u {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    padding: 7px 8px;
    border: 0;
    background: none;
    text-align: left;
    font-size: 13px;
    color: var(--muted);
    border-radius: 8px;
  }
  button.u:hover b {
    color: var(--app);
    text-decoration: underline;
  }
  .u b {
    flex: none;
    min-width: 58px;
    font-weight: 700;
    color: var(--text);
  }
  .main .u b {
    font-weight: 800;
  }
  .u span {
    min-width: 0;
  }
  .u small {
    font-size: 11.5px;
    color: var(--faint);
  }
  .v {
    padding: 7px 10px;
    border: 0;
    background: none;
    font-size: 15px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    text-align: right;
    border-radius: 8px;
    word-break: break-all;
  }
  button.v:hover:not(:disabled) {
    background: var(--app-soft);
    color: var(--text);
  }
  .v.static {
    font-weight: 600;
  }
  .v i {
    margin-right: 4px;
    font-style: normal;
    font-weight: 400;
    color: var(--faint);
  }
  .facts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 0;
  }
  .facts div {
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--surface-2);
  }
  .facts dt {
    font-size: 12px;
    color: var(--muted);
  }
  .facts dd {
    margin: 2px 0 0;
    font-size: 18px;
    font-weight: 750;
    font-variant-numeric: tabular-nums;
  }
  .speed {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .speed select {
    width: auto;
  }
  .answer {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--app);
  }
  .papers {
    display: grid;
    grid-template-columns: 70px minmax(0, 1fr);
    align-items: start;
    gap: 8px;
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
  }
  .papers span {
    padding-top: 5px;
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 22px;
    transform: translateX(-50%);
    padding: 7px 14px;
    border-radius: 99px;
    background: var(--text);
    color: var(--bg);
    font-size: 12.5px;
    font-weight: 600;
    white-space: nowrap;
    z-index: 5;
  }

  @media (max-width: 820px) {
    .page {
      grid-template-columns: minmax(0, 1fr);
      padding: 10px;
      gap: 10px;
    }
    /* 좁은 화면: 입력 → 답 → 나머지 */
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
  @media (max-width: 520px) {
    .card {
      padding: 12px;
    }
    .u b {
      min-width: 48px;
    }
    .u span {
      font-size: 12px;
    }
    .facts {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
