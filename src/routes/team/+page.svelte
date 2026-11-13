<script lang="ts">
  import { onMount } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import { load, save } from '$lib/storage';
  import { downloadBlob, timestamp } from '$lib/download';
  import { dedupeText, parseParticipants, randomInt, sampleText } from '$lib/raffle/core';
  import { ladderResults, makeLadder, mix, parseGroups, splitTeams, teamName, teamsCsv, teamsText, trace, type Ladder, type Team, type TeamStyle } from '$lib/team/core';

  const KEY = 'tools:team:v1';
  const RAFFLE_KEY = 'tools:raffle:v1';
  const LADDER_MAX = 30;
  const STYLES: TeamStyle[] = ['1조', 'A조', '1팀', 'A팀'];

  let mode = $state<'team' | 'ladder'>('team');
  let text = $state('');
  let ready = $state(false);
  let toast = $state('');
  let raffleText = $state('');

  // 조 편성
  let by = $state<'count' | 'size'>('count');
  let count = $state(4);
  let per = $state(5);
  let style = $state<TeamStyle>('1조');
  let balance = $state(true);
  let leader = $state(false);
  let apartText = $state('');
  let togetherText = $state('');
  let teams = $state<Team[] | null>(null);
  let unmet = $state<string[]>([]);
  let round = $state(0);
  let resultEl = $state<HTMLElement>();

  // 사다리
  let prizeText = $state('당첨');
  let hide = $state(true);
  let ladder = $state.raw<Ladder | null>(null);
  let riders = $state<string[]>([]);
  let prizes = $state<string[]>([]);
  let shown = $state<number[]>([]);
  let running = $state<number | null>(null);

  const parsed = $derived(parseParticipants(text));
  const people = $derived(parsed.list);
  const hasInfo = $derived(people.some((p) => p.info));
  const teamCount = $derived(
    Math.max(1, Math.min(people.length || 1, by === 'count' ? Math.floor(Number(count)) || 1 : Math.ceil(people.length / Math.max(1, Math.floor(Number(per)) || 1)))),
  );
  const sizeHint = $derived.by(() => {
    if (!people.length) return '';
    const lo = Math.floor(people.length / teamCount);
    const hi = Math.ceil(people.length / teamCount);
    return `${teamCount}개 조 · 조마다 ${lo === hi ? lo : `${lo}~${hi}`}명`;
  });
  const apart = $derived(parseGroups(apartText, people));
  const together = $derived(parseGroups(togetherText, people));
  const unknown = $derived([...new Set([...apart.unknown, ...together.unknown])]);

  function say(msg: string) {
    toast = msg;
    setTimeout(() => toast === msg && (toast = ''), 2200);
  }

  function split() {
    if (!people.length) return;
    const r = splitTeams(people, { teams: teamCount, balance: balance && hasInfo, apart: apart.groups, together: together.groups });
    teams = r.teams.map((idx, i) => {
      const lead = leader && idx.length ? idx[randomInt(idx.length)] : -1;
      return { name: teamName(i, style), members: idx.map((j) => ({ name: people[j].name, info: people[j].info, ...(j === lead ? { leader: true } : {}) })) };
    });
    unmet = r.unmet.map(([a, b]) => `${people[a].name} · ${people[b].name}`);
    round++;
  }
  async function copyTeams() {
    if (!teams) return;
    try {
      await navigator.clipboard.writeText(teamsText(teams));
      say('복사했습니다');
    } catch {
      say('복사하지 못했습니다');
    }
  }
  function saveCsv() {
    if (teams) downloadBlob(new Blob([teamsCsv(teams)], { type: 'text/csv;charset=utf-8' }), `조편성-${timestamp()}.csv`);
  }
  function fullscreen(el: HTMLElement | undefined) {
    if (document.fullscreenElement) document.exitFullscreen();
    else el?.requestFullscreen?.().catch(() => {});
  }

  // ── 사다리 ──
  const tooMany = $derived(people.length > LADDER_MAX);
  const colW = $derived(riders.length <= 8 ? 112 : riders.length <= 14 ? 86 : 66);
  const ROW = 26;
  const paths = $derived.by(() => {
    const l = ladder;
    if (!l) return [];
    return riders.map((_, c) => {
      const t = trace(l, c);
      return { end: t.end, d: t.points.map(([x, y], i) => `${i ? 'L' : 'M'}${(x + 0.5) * colW} ${(y + 1) * ROW}`).join(' '), bends: t.points.length };
    });
  });
  /** 아래 자리 → 도착한 사람 */
  const arrived = $derived.by(() => {
    const m = new Map<number, number>();
    for (const c of shown) if (paths[c]) m.set(paths[c].end, c);
    return m;
  });
  const hue = (c: number) => `hsl(${Math.round((c * 360) / Math.max(1, riders.length) + 20)} 75% 48%)`;

  function buildLadder() {
    if (people.length < 2 || tooMany) return;
    riders = people.map((p) => p.name);
    prizes = ladderResults(prizeText, riders.length);
    ladder = makeLadder(riders.length);
    shown = [];
    running = null;
  }
  function ride(c: number) {
    if (running != null || shown.includes(c)) return;
    running = c;
  }
  function landed() {
    if (running == null) return;
    shown.push(running);
    running = null;
  }
  function revealAll() {
    running = null;
    shown = riders.map((_, i) => i);
  }
  async function copyLadder() {
    try {
      await navigator.clipboard.writeText(riders.map((n, c) => `${n} → ${prizes[paths[c].end]}`).join('\n'));
      say('복사했습니다');
    } catch {
      say('복사하지 못했습니다');
    }
  }
  function presetPrizes(kind: 'win' | 'order' | 'penalty') {
    const n = Math.max(2, Math.min(people.length, LADDER_MAX));
    prizeText = kind === 'win' ? '당첨' : kind === 'penalty' ? '커피 사기' : Array.from({ length: n }, (_, i) => `${i + 1}번`).join('\n');
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select')) return;
    if (e.key === 'Enter' && !t.closest('button, a')) {
      e.preventDefault();
      if (mode === 'team') split();
      else buildLadder();
    } else if (e.key.toLowerCase() === 'f') fullscreen(resultEl);
  }

  onMount(() => {
    const s = load<Record<string, any>>(KEY, {});
    if (typeof s.text === 'string') text = s.text;
    if (s.mode === 'ladder') mode = 'ladder';
    if (s.by === 'size') by = 'size';
    if (Number(s.count) >= 1) count = Math.floor(Number(s.count));
    if (Number(s.per) >= 1) per = Math.floor(Number(s.per));
    if (STYLES.includes(s.style)) style = s.style;
    if (typeof s.balance === 'boolean') balance = s.balance;
    if (typeof s.leader === 'boolean') leader = s.leader;
    if (typeof s.apartText === 'string') apartText = s.apartText;
    if (typeof s.togetherText === 'string') togetherText = s.togetherText;
    if (typeof s.prizeText === 'string') prizeText = s.prizeText;
    if (typeof s.hide === 'boolean') hide = s.hide;
    if (Array.isArray(s.teams)) teams = s.teams;
    const r = load<{ text?: string } | null>(RAFFLE_KEY, null);
    if (r && typeof r.text === 'string') raffleText = r.text.trim();
    ready = true;
  });
  $effect(() => {
    const snap = { text, mode, by, count, per, style, balance, leader, apartText, togetherText, prizeText, hide, teams: $state.snapshot(teams) };
    if (ready) save(KEY, snap);
  });
</script>

<svelte:window onkeydown={onKey} />

<ToolShell tool="team">
  {#snippet actions()}
    <div class="seg" role="group" aria-label="무엇을 할까">
      <button aria-pressed={mode === 'team'} onclick={() => (mode = 'team')}>조 편성</button>
      <button aria-pressed={mode === 'ladder'} onclick={() => (mode = 'ladder')}>사다리</button>
    </div>
  {/snippet}

  <div class="page">
    <section class="panel people">
      <div class="head">
        <h2>참가자</h2>
        <span class="count" class:zero={!people.length}>{people.length.toLocaleString('ko-KR')}명</span>
        {#if parsed.duplicates}
          <button class="warn-chip" onclick={() => (text = dedupeText(text))}>중복 {parsed.duplicates}건 · 정리하기</button>
        {/if}
      </div>
      <div class="tools">
        <button class="btn sm" onclick={() => (text = sampleText(mode === 'ladder' ? 6 : 24))}>예시 명단</button>
        {#if raffleText && raffleText !== text.trim()}
          <button class="btn sm" onclick={() => (text = raffleText)} title="추첨기에 넣어 둔 명단을 가져옵니다">추첨기 명단 가져오기</button>
        {/if}
        <button class="btn sm ghost danger" disabled={!text} onclick={() => (text = '')}>비우기</button>
      </div>
      <textarea
        class="field list"
        bind:value={text}
        spellcheck="false"
        aria-label="참가자 명단"
        placeholder={'한 줄에 한 명씩 입력하거나, 엑셀에서 복사해 붙여넣으세요.\n\n김하늘\t개발팀\t남\n이서연\t디자인팀\t여\n박민준\n\n첫 칸은 이름, 다음 칸은 소속 · 성별 같은 부가 정보입니다.\n조를 나눌 때 부가 정보가 고르게 섞입니다.\n\n쉼표로 이어 써도 됩니다: 김하늘, 이서연, 박민준'}
      ></textarea>
      <p class="foot">명단은 이 브라우저에만 저장되며 서버로 전송되지 않습니다.</p>
    </section>

    {#if mode === 'team'}
      <section class="panel setup">
        <h2>나누는 방법</h2>
        <div class="f">
          <div class="seg" role="group" aria-label="나누는 기준">
            <button aria-pressed={by === 'count'} onclick={() => (by = 'count')}>조 수로</button>
            <button aria-pressed={by === 'size'} onclick={() => (by = 'size')}>조당 인원으로</button>
          </div>
          <div class="inline">
            {#if by === 'count'}
              <input class="field num" type="number" min="1" max="999" bind:value={count} aria-label="조 수" /><span>개 조로</span>
            {:else}
              <input class="field num" type="number" min="1" max="999" bind:value={per} aria-label="조당 인원" /><span>명씩</span>
            {/if}
            <small>{sizeHint}</small>
          </div>
        </div>
        <label class="f row">
          <span>조 이름</span>
          <select class="field" bind:value={style}>
            {#each STYLES as s (s)}<option value={s}>{teamName(0, s)}, {teamName(1, s)}, {teamName(2, s)} …</option>{/each}
          </select>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={balance} disabled={!hasInfo} />
          <span>소속 · 성별 등 부가 정보를 고르게 섞기{#if !hasInfo && people.length}<small> — 명단에 부가 정보가 없습니다</small>{/if}</span>
        </label>
        <label class="check"><input type="checkbox" bind:checked={leader} /> <span>조마다 조장 한 명 뽑기</span></label>

        <label class="f">
          <span>떨어뜨릴 사람 <small>— 한 줄에 한 묶음, 쉼표로</small></span>
          <textarea class="field" rows="2" bind:value={apartText} spellcheck="false" placeholder="김하늘, 이서연"></textarea>
        </label>
        <label class="f">
          <span>같은 조에 넣을 사람</span>
          <textarea class="field" rows="2" bind:value={togetherText} spellcheck="false" placeholder="박민준, 최지우"></textarea>
        </label>
        {#if unknown.length}<p class="alert">명단에 없는 이름: {unknown.join(', ')}</p>{/if}

        <button class="btn primary go" disabled={!people.length} onclick={split}>{teams ? '다시 섞기' : '조 나누기'}</button>
        <p class="keys"><kbd>Enter</kbd> 나누기 · <kbd>F</kbd> 크게 보기. 순서는 암호학적 난수로 정합니다.</p>
      </section>

      <section class="panel results" bind:this={resultEl}>
        <div class="head">
          <h2>결과</h2>
          {#if teams}<span class="count">{teams.length}개 조 · {teams.reduce((n, t) => n + t.members.length, 0)}명</span>{/if}
          <div class="head-actions">
            <button class="btn sm" disabled={!teams} onclick={copyTeams}>복사</button>
            <button class="btn sm" disabled={!teams} onclick={saveCsv}>CSV 저장</button>
            <button class="btn sm" disabled={!teams} onclick={() => fullscreen(resultEl)}>크게 보기</button>
          </div>
        </div>
        {#if unmet.length}<p class="alert">조 수보다 많아 떨어뜨리지 못했습니다: {unmet.join(' / ')}</p>{/if}
        {#if !teams}
          <p class="empty">명단을 넣고 <b>조 나누기</b>를 누르세요.<br />인원은 한 명 차이 안에서 고르게, 부가 정보는 조마다 비슷하게 섞습니다.</p>
        {:else}
          {#key round}
            <div class="teams">
              {#each teams as t, ti (ti)}
                <article>
                  <header><h3>{t.name}</h3><span>{t.members.length}명</span></header>
                  <ol>
                    {#each t.members as m, mi (mi)}
                      <li style:animation-delay="{Math.min(1800, (mi * teams.length + ti) * 28)}ms">
                        <span class="m-name">{m.name}{#if m.leader}<i title="조장">조장</i>{/if}</span>
                        <span class="m-info">{m.info}</span>
                      </li>
                    {/each}
                  </ol>
                  {#if mix(t.members).length}
                    <footer>{#each mix(t.members).slice(0, 6) as [v, n] (v)}<span>{v} <b>{n}</b></span>{/each}</footer>
                  {/if}
                </article>
              {/each}
            </div>
          {/key}
        {/if}
      </section>
    {:else}
      <section class="panel setup">
        <h2>사다리 아래에 놓을 것</h2>
        <label class="f">
          <span>한 줄에 하나 <small>— 모자란 자리는 ‘꽝’</small></span>
          <textarea class="field" rows="5" bind:value={prizeText} spellcheck="false" aria-label="사다리 결과" placeholder={'당첨\n2등'}></textarea>
        </label>
        <div class="tools">
          <button class="btn sm" onclick={() => presetPrizes('win')}>당첨 1명</button>
          <button class="btn sm" onclick={() => presetPrizes('penalty')}>벌칙 1명</button>
          <button class="btn sm" onclick={() => presetPrizes('order')}>순서 정하기</button>
        </div>
        <label class="check"><input type="checkbox" bind:checked={hide} /> <span>도착하기 전에는 결과 가리기</span></label>
        {#if tooMany}<p class="alert">사다리는 {LADDER_MAX}명까지 그립니다. 지금 {people.length}명입니다. 사람이 많으면 조 편성이나 추첨기를 쓰세요.</p>{/if}
        <button class="btn primary go" disabled={people.length < 2 || tooMany} onclick={buildLadder}>{ladder ? '새 사다리' : '사다리 만들기'}</button>
        <p class="keys">
          결과는 먼저 암호학적 난수로 공평하게 정하고, 그 결과가 나오도록 사다리를 그립니다. 사다리 모양으로는 결과를 짐작할 수 없습니다.
        </p>
      </section>

      <section class="panel results ladder" bind:this={resultEl}>
        <div class="head">
          <h2>사다리</h2>
          {#if ladder}<span class="count">{shown.length}/{riders.length}명 도착</span>{/if}
          <div class="head-actions">
            <button class="btn sm" disabled={!ladder || shown.length === riders.length} onclick={revealAll}>모두 공개</button>
            <button class="btn sm" disabled={!ladder || shown.length < riders.length} onclick={copyLadder}>결과 복사</button>
            <button class="btn sm" disabled={!ladder} onclick={() => fullscreen(resultEl)}>크게 보기</button>
          </div>
        </div>
        {#if !ladder}
          <p class="empty">두 명 이상 넣고 <b>사다리 만들기</b>를 누르세요.<br />이름을 누르면 사다리를 타고 내려갑니다.</p>
        {:else}
          <div class="scroll">
            <div class="board" style:width="{riders.length * colW}px" style:--col="{colW}px">
              <div class="tops">
                {#each riders as name, c (c)}
                  <button class:done={shown.includes(c)} class:run={running === c} style:--c={hue(c)} disabled={running != null && running !== c} onclick={() => ride(c)}>{name}</button>
                {/each}
              </div>
              <svg width={riders.length * colW} height={(ladder.rungs.length + 1) * ROW} role="img" aria-label="사다리">
                {#each riders as _, c (c)}
                  <line class="rail" x1={(c + 0.5) * colW} x2={(c + 0.5) * colW} y1="0" y2={(ladder.rungs.length + 1) * ROW} />
                {/each}
                {#each ladder.rungs as row, r (r)}
                  {#each row as on, c (c)}
                    {#if on}<line class="rail" x1={(c + 0.5) * colW} x2={(c + 1.5) * colW} y1={(ladder.y[r][c] + 1) * ROW} y2={(ladder.y[r][c] + 1) * ROW} />{/if}
                  {/each}
                {/each}
                {#each shown as c (c)}
                  <path class="way" d={paths[c].d} stroke={hue(c)} />
                {/each}
                {#if running != null}
                  {#key running}
                    <path class="way go" d={paths[running].d} stroke={hue(running)} pathLength="1" style:animation-duration="{Math.min(4.5, 1 + paths[running].bends * 0.09)}s" onanimationend={landed} />
                  {/key}
                {/if}
              </svg>
              <div class="bottoms">
                {#each prizes as p, slot (slot)}
                  {@const who = arrived.get(slot)}
                  <span class:hit={who != null} class:blank={p === '꽝'} style:--c={who != null ? hue(who) : ''}>
                    {#if who != null || !hide}{p}{:else}?{/if}
                    {#if who != null}<small>{riders[who]}</small>{/if}
                  </span>
                {/each}
              </div>
            </div>
          </div>
        {/if}
      </section>
    {/if}
    {#if toast}<p class="toast" role="status">{toast}</p>{/if}
  </div>
</ToolShell>

<style>
  .page {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(240px, 300px) minmax(260px, 320px) minmax(0, 1fr);
    gap: 14px;
    padding: 14px;
    max-width: 1500px;
    width: 100%;
    margin: 0 auto;
    position: relative;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    min-width: 0;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    overflow-y: auto;
  }
  h2 {
    font-size: 15px;
  }
  .head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .count {
    font-size: 12.5px;
    font-weight: 650;
    padding: 2px 9px;
    border-radius: 99px;
    background: var(--app-soft);
    font-variant-numeric: tabular-nums;
  }
  .count.zero {
    background: var(--surface-2);
    color: var(--faint);
  }
  .head-actions {
    margin-left: auto;
    display: flex;
    gap: 6px;
  }
  .warn-chip {
    border: 0;
    padding: 2px 9px;
    border-radius: 99px;
    font-size: 12px;
    font-weight: 650;
    color: color-mix(in srgb, #f08c00 70%, var(--text));
    background: color-mix(in srgb, #f08c00 14%, var(--surface));
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .list {
    flex: 1;
    min-height: 180px;
    resize: none;
    font-size: 13.5px;
    tab-size: 12;
  }
  .foot,
  .keys {
    font-size: 12px;
    color: var(--faint);
    line-height: 1.6;
  }
  .f {
    display: grid;
    gap: 6px;
    min-width: 0;
    font-size: 12.5px;
    color: var(--muted);
  }
  .f.row {
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 10px;
  }
  .f > span {
    font-weight: 650;
  }
  small {
    font-size: 12px;
    font-weight: 400;
    color: var(--faint);
  }
  .f .field {
    width: 100%;
    color: var(--text);
  }
  .f .seg {
    display: flex;
  }
  .f .seg button {
    flex: 1;
  }
  .inline {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .inline .num {
    width: 76px;
  }
  .inline small {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    font-size: 13px;
  }
  .check input {
    accent-color: var(--app);
    margin: 4px 0 0;
  }
  .alert {
    padding: 7px 11px;
    border-radius: 10px;
    font-size: 12.5px;
    color: color-mix(in srgb, #f08c00 70%, var(--text));
    background: color-mix(in srgb, #f08c00 12%, var(--surface));
  }
  .go {
    height: 42px;
    font-size: 15px;
    margin-top: 4px;
  }
  .empty {
    margin: auto;
    text-align: center;
    color: var(--faint);
    font-size: 13.5px;
    line-height: 1.8;
  }
  .empty b {
    color: var(--muted);
  }

  .teams {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 10px;
    align-items: start;
  }
  article {
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    background: var(--surface);
  }
  article header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--app-soft);
    border-bottom: 1px solid var(--app-line);
  }
  article h3 {
    font-size: 15px;
    letter-spacing: -0.01em;
  }
  article header span {
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  article ol {
    list-style: none;
    margin: 0;
    padding: 4px 0;
  }
  article li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 12px;
    font-size: 13.5px;
    animation: deal 0.32s cubic-bezier(0.2, 0.9, 0.3, 1.2) backwards;
  }
  @keyframes deal {
    from {
      opacity: 0;
      transform: translateY(-8px) scale(0.96);
    }
  }
  .m-name {
    font-weight: 600;
    white-space: nowrap;
  }
  .m-name i {
    margin-left: 6px;
    padding: 0 6px;
    border-radius: 99px;
    font-style: normal;
    font-size: 11px;
    background: var(--app);
    color: var(--on-app);
    vertical-align: 1px;
  }
  .m-info {
    font-size: 12px;
    color: var(--faint);
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  article footer {
    display: flex;
    flex-wrap: wrap;
    gap: 3px 10px;
    padding: 6px 12px 8px;
    border-top: 1px dashed var(--border);
    font-size: 11.5px;
    color: var(--faint);
  }
  article footer b {
    color: var(--muted);
  }

  .results:fullscreen {
    padding: 4vh 4vw;
    border-radius: 0;
    border: 0;
    background: var(--bg);
    font-size: 120%;
  }
  .results:fullscreen .teams {
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
  }
  .results:fullscreen article h3 {
    font-size: 24px;
  }
  .results:fullscreen article li {
    font-size: 20px;
    padding: 5px 16px;
  }
  .results:fullscreen .m-info {
    font-size: 15px;
  }
  .results:fullscreen .board {
    margin: auto;
  }

  /* 사다리 */
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
  }
  .board {
    flex: none;
    margin: 0 auto;
    padding: 4px 0 8px;
  }
  .tops,
  .bottoms {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: var(--col);
    justify-items: center;
  }
  .tops button {
    max-width: calc(var(--col) - 8px);
    min-width: 44px;
    height: 32px;
    padding: 0 9px;
    border: 1.5px solid var(--c);
    border-radius: 99px;
    background: var(--surface);
    font-size: 13px;
    font-weight: 650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tops button:hover:not(:disabled),
  .tops button.run,
  .tops button.done {
    background: var(--c);
    color: #fff;
  }
  .tops button:disabled {
    cursor: default;
    opacity: 0.6;
  }
  .tops button.done {
    cursor: default;
  }
  svg {
    display: block;
  }
  .rail {
    stroke: var(--border-strong);
    stroke-width: 2.5;
    stroke-linecap: round;
  }
  .way {
    fill: none;
    stroke-width: 5;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.85;
  }
  .way.go {
    opacity: 1;
    stroke-dasharray: 1;
    animation: ride linear forwards;
  }
  @keyframes ride {
    from {
      stroke-dashoffset: 1;
    }
    to {
      stroke-dashoffset: 0;
    }
  }
  .bottoms span {
    display: grid;
    justify-items: center;
    align-content: start;
    max-width: calc(var(--col) - 6px);
    min-width: 40px;
    min-height: 32px;
    padding: 5px 8px;
    border-radius: 10px;
    background: var(--surface-2);
    font-size: 13px;
    font-weight: 700;
    text-align: center;
    line-height: 1.3;
  }
  .bottoms span.blank {
    font-weight: 500;
    color: var(--faint);
  }
  .bottoms span.hit {
    background: color-mix(in srgb, var(--c) 16%, var(--surface));
    box-shadow: inset 0 0 0 1.5px var(--c);
    color: var(--text);
  }
  .bottoms small {
    font-size: 11px;
    color: var(--muted);
  }
  .toast {
    position: absolute;
    left: 50%;
    bottom: 22px;
    transform: translateX(-50%);
    padding: 7px 14px;
    border-radius: 99px;
    background: var(--text);
    color: var(--bg);
    font-size: 12.5px;
    font-weight: 600;
  }

  @media (max-width: 1080px) {
    .page {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
      overflow-y: auto;
    }
    .results {
      grid-column: 1 / -1;
      overflow: visible;
      min-height: 260px;
    }
    .panel.people,
    .panel.setup {
      max-height: 460px;
    }
  }
  @media (max-width: 640px) {
    .page {
      display: flex;
      flex-direction: column;
      padding: 10px;
      gap: 10px;
    }
    .panel {
      overflow: visible;
      flex: none;
      max-height: none !important;
    }
    .head-actions {
      margin-left: 0;
    }
    .scroll {
      overflow-x: auto;
    }
  }
</style>
