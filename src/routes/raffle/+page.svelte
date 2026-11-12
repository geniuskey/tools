<script lang="ts">
  import { onMount } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import Stage, { type StageSettings } from '$lib/raffle/Stage.svelte';
  import { load, save } from '$lib/storage';
  import { downloadBlob, timestamp } from '$lib/download';
  import {
    dedupeText,
    parseParticipants,
    rangeText,
    remaining,
    resultsCsv,
    resultsText,
    sampleText,
    validWinners,
    type Prize,
    type Winner,
  } from '$lib/raffle/core';

  const STORE = 'tools:raffle:v1';
  const uid = () => Math.random().toString(36).slice(2, 10);

  let title = $state('');
  let text = $state('');
  let prizes = $state<Prize[]>([{ id: uid(), name: '1등', count: 1, winners: [] }]);
  let settings = $state<StageSettings>({ allowRepeat: false, sound: true, mask: false, showInfo: true, speed: 'normal', batch: 'one' });
  let current = $state(0);
  let stageOpen = $state(false);
  let ready = $state(false);
  let copied = $state(false);
  let confirmReset = $state(false);
  let dragging = $state(false);

  let rangeDialog: HTMLDialogElement;
  let range = $state({ from: 1, to: 100, prefix: '', suffix: '번', replace: true });
  let fileInput: HTMLInputElement;

  const parsed = $derived(parseParticipants(text));
  const total = $derived(prizes.reduce((n, p) => n + p.count, 0));
  const drawn = $derived(prizes.reduce((n, p) => n + validWinners(p).length, 0));
  const anyWinner = $derived(prizes.some((p) => p.winners.length > 0));
  const shortage = $derived(!settings.allowRepeat && total > parsed.list.length && parsed.list.length > 0);
  const canOpen = $derived(parsed.list.length > 0 && prizes.length > 0);

  onMount(() => {
    const s = load<Record<string, any> | null>(STORE, null);
    if (s) {
      if (typeof s.title === 'string') title = s.title;
      if (typeof s.text === 'string') text = s.text;
      if (Array.isArray(s.prizes) && s.prizes.length) prizes = s.prizes;
      if (s.settings) settings = { ...settings, ...s.settings };
      if (Number.isInteger(s.current)) current = Math.min(s.current, prizes.length - 1);
    }
    ready = true;
  });

  // 새로고침해도 명단과 결과가 남도록 바로바로 저장한다
  $effect(() => {
    const snapshot = { title, text, prizes: $state.snapshot(prizes), settings: $state.snapshot(settings), current };
    if (ready) save(STORE, snapshot);
  });

  function addPrize() {
    prizes.push({ id: uid(), name: `${prizes.length + 1}등`, count: 1, winners: [] });
  }
  function removePrize(i: number) {
    prizes.splice(i, 1);
    current = Math.max(0, Math.min(current, prizes.length - 1));
  }
  function movePrize(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= prizes.length) return;
    [prizes[i], prizes[j]] = [prizes[j], prizes[i]];
  }
  function setCount(p: Prize, v: string) {
    const n = Math.floor(Number(v));
    p.count = Number.isFinite(n) ? Math.max(1, Math.min(9999, n)) : 1;
  }

  function onWin(prizeId: string, winners: Winner[]) {
    prizes.find((p) => p.id === prizeId)?.winners.push(...winners);
  }
  function onVoid(prizeId: string, key: string) {
    const w = prizes.find((p) => p.id === prizeId)?.winners.find((x) => x.key === key && !x.void);
    if (w) w.void = true;
  }

  function resetResults() {
    if (!confirmReset) {
      confirmReset = true;
      setTimeout(() => (confirmReset = false), 3000);
      return;
    }
    for (const p of prizes) p.winners = [];
    current = 0;
    confirmReset = false;
  }

  async function readFile(file: File) {
    const buf = await file.arrayBuffer();
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      // 예전 엑셀이 저장한 CSV 는 EUC-KR 인 경우가 많다
      content = new TextDecoder('euc-kr').decode(buf);
    }
    content = content.replace(/^﻿/, '');
    text = text.trim() ? `${text.trimEnd()}\n${content}` : content;
  }

  function onFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) readFile(f);
    (e.target as HTMLInputElement).value = '';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) readFile(f);
  }

  function applyRange(e: SubmitEvent) {
    e.preventDefault();
    const from = Math.floor(range.from);
    const to = Math.floor(range.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || Math.abs(to - from) > 100000) return;
    const t = rangeText(from, to, range.prefix, range.suffix);
    text = range.replace || !text.trim() ? t : `${text.trimEnd()}\n${t}`;
    rangeDialog.close();
  }

  async function copyResults() {
    try {
      await navigator.clipboard.writeText(resultsText(prizes));
      copied = true;
      setTimeout(() => (copied = false), 1300);
    } catch {}
  }

  function downloadCsv() {
    downloadBlob(new Blob([resultsCsv(prizes)], { type: 'text/csv;charset=utf-8' }), `추첨결과-${timestamp()}.csv`);
  }

  function openStage(i = current) {
    if (!canOpen) return;
    current = Math.min(i, prizes.length - 1);
    stageOpen = true;
  }

  const time = (at: number) => new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
</script>

<ToolShell tool="raffle">
  {#snippet actions()}
    <button class="btn primary sm" disabled={!canOpen} onclick={() => openStage()}>무대 열기</button>
  {/snippet}

  <div class="page">
    <section class="panel people">
      <div class="head">
        <h2>참가자</h2>
        <span class="count" class:zero={!parsed.list.length}>{parsed.list.length.toLocaleString('ko-KR')}명</span>
        {#if parsed.duplicates}
          <button class="warn-chip" onclick={() => (text = dedupeText(text))} title="완전히 같은 줄을 하나만 남깁니다">
            중복 {parsed.duplicates}건 · 정리하기
          </button>
        {/if}
      </div>
      <div class="tools">
        <button class="btn sm" onclick={() => fileInput.click()}>파일 열기</button>
        <button class="btn sm" onclick={() => rangeDialog.showModal()}>번호 범위</button>
        <button class="btn sm" onclick={() => (text = sampleText(300))}>예시 명단</button>
        <button class="btn sm ghost danger" disabled={!text} onclick={() => (text = '')}>비우기</button>
        <input bind:this={fileInput} type="file" accept=".txt,.csv,.tsv,text/plain,text/csv" hidden onchange={onFile} />
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="drop"
        class:dragging
        ondragover={(e) => {
          e.preventDefault();
          dragging = true;
        }}
        ondragleave={() => (dragging = false)}
        ondrop={onDrop}
      >
        <textarea
          class="field"
          bind:value={text}
          spellcheck="false"
          aria-label="참가자 명단"
          placeholder={'한 줄에 한 명씩 입력하거나, 엑셀에서 복사해 붙여넣으세요.\n\n김하늘\t개발팀\n이서연\t디자인팀\n박민준\n\n첫 칸은 이름, 다음 칸은 소속 같은 부가 정보입니다.\n동명이인은 부가 정보로 구분합니다.'}
        ></textarea>
      </div>
      <p class="foot">명단은 이 브라우저에만 저장되며 서버로 전송되지 않습니다.</p>
    </section>

    <section class="panel setup">
      <div class="head">
        <h2>경품</h2>
        <span class="count">총 {total.toLocaleString('ko-KR')}명 추첨</span>
      </div>

      <label class="event">
        <span>행사 이름</span>
        <input class="field" bind:value={title} placeholder="예: 2026 송년회 경품 추첨" maxlength="60" />
      </label>

      <ol class="prizes">
        {#each prizes as p, i (p.id)}
          <li class:current={i === current}>
            <div class="order">
              <button disabled={i === 0} onclick={() => movePrize(i, -1)} aria-label="위로">▲</button>
              <button disabled={i === prizes.length - 1} onclick={() => movePrize(i, 1)} aria-label="아래로">▼</button>
            </div>
            <input class="field name" bind:value={p.name} aria-label="경품 이름" placeholder="경품 이름" maxlength="40" />
            <input
              class="field num"
              type="number"
              min="1"
              max="9999"
              value={p.count}
              onchange={(e) => setCount(p, e.currentTarget.value)}
              aria-label="당첨 인원"
            />
            <span class="unit">명</span>
            <button class="progress" onclick={() => openStage(i)} disabled={!canOpen} title="이 경품부터 무대 열기">
              {#if remaining(p) === 0}완료{:else}{validWinners(p).length}/{p.count}{/if}
            </button>
            <button class="del" onclick={() => removePrize(i)} disabled={prizes.length === 1} aria-label="경품 삭제">×</button>
          </li>
        {/each}
      </ol>
      <button class="btn sm add" onclick={addPrize}>+ 경품 추가</button>

      {#if shortage}
        <p class="alert">추첨 인원({total}명)이 참가자({parsed.list.length}명)보다 많습니다. 참가자가 모자라면 남은 자리는 추첨되지 않습니다.</p>
      {/if}

      <div class="options">
        <h3>옵션</h3>
        <label><input type="checkbox" bind:checked={settings.allowRepeat} /> 한 사람이 여러 경품에 당첨될 수 있음</label>
        <label><input type="checkbox" bind:checked={settings.showInfo} /> 소속 등 부가 정보를 무대에 표시</label>
        <label><input type="checkbox" bind:checked={settings.mask} /> 무대에서 이름 가운데를 가림 (김＊늘)</label>
        <label><input type="checkbox" bind:checked={settings.sound} /> 효과음</label>
        <div class="opt-row">
          <span>연출 길이</span>
          <div class="seg">
            <button aria-pressed={settings.speed === 'fast'} onclick={() => (settings.speed = 'fast')}>짧게</button>
            <button aria-pressed={settings.speed === 'normal'} onclick={() => (settings.speed = 'normal')}>보통</button>
            <button aria-pressed={settings.speed === 'long'} onclick={() => (settings.speed = 'long')}>길게</button>
          </div>
        </div>
      </div>

      <button class="btn primary open" disabled={!canOpen} onclick={() => openStage()}>
        무대 열기
      </button>
      <p class="keys">
        무대에서 <kbd>Space</kbd> 추첨 · <kbd>F</kbd> 전체 화면 · <kbd>←</kbd><kbd>→</kbd> 경품 이동 · <kbd>A</kbd> 한 명씩/한꺼번에 · <kbd>M</kbd> 소리
      </p>
    </section>

    <section class="panel results">
      <div class="head">
        <h2>결과</h2>
        <span class="count">{drawn}/{total}명</span>
        <div class="head-actions">
          <button class="btn sm" disabled={!drawn} onclick={copyResults}>{copied ? '복사됨' : '복사'}</button>
          <button class="btn sm" disabled={!anyWinner} onclick={downloadCsv}>CSV 저장</button>
          <button class="btn sm ghost danger" disabled={!anyWinner} onclick={resetResults}>{confirmReset ? '정말 지울까요?' : '초기화'}</button>
        </div>
      </div>
      {#if !anyWinner}
        <p class="empty">아직 추첨 결과가 없습니다.<br />무대를 열고 <kbd>Space</kbd> 를 누르면 추첨이 시작됩니다.</p>
      {:else}
        <div class="result-list">
          {#each prizes as p (p.id)}
            {#if p.winners.length}
              <h3>{p.name} <span>{validWinners(p).length}/{p.count}</span></h3>
              <ol>
                {#each p.winners as w, i (w.key + i)}
                  <li class:void={w.void}>
                    <span class="w-name">{w.name}</span>
                    <span class="w-info">{w.info}</span>
                    <span class="w-time">{w.void ? '취소됨' : time(w.at)}</span>
                  </li>
                {/each}
              </ol>
            {/if}
          {/each}
        </div>
      {/if}
    </section>
  </div>
</ToolShell>

<dialog bind:this={rangeDialog} class="dialog app-scope">
  <form onsubmit={applyRange}>
    <h2>번호 범위로 명단 만들기</h2>
    <p>입장 번호나 좌석 번호로 추첨할 때 씁니다.</p>
    <div class="row">
      <label>시작 <input class="field" type="number" bind:value={range.from} required /></label>
      <label>끝 <input class="field" type="number" bind:value={range.to} required /></label>
    </div>
    <div class="row">
      <label>앞 글자 <input class="field" bind:value={range.prefix} placeholder="예: A-" maxlength="12" /></label>
      <label>뒷 글자 <input class="field" bind:value={range.suffix} placeholder="예: 번" maxlength="12" /></label>
    </div>
    <p class="example">예: {range.prefix}{range.from}{range.suffix} ~ {range.prefix}{range.to}{range.suffix}</p>
    <label class="check"><input type="checkbox" bind:checked={range.replace} /> 지금 명단을 지우고 새로 만들기</label>
    <div class="dialog-actions">
      <button type="button" class="btn" onclick={() => rangeDialog.close()}>취소</button>
      <button type="submit" class="btn primary">만들기</button>
    </div>
  </form>
</dialog>

{#if stageOpen}
  <Stage
    {title}
    participants={parsed.list}
    {prizes}
    bind:settings
    bind:current
    onwin={onWin}
    onvoid={onVoid}
    onclose={() => (stageOpen = false)}
  />
{/if}

<style>
  .page {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(280px, 1fr) minmax(340px, 1.05fr) minmax(280px, 0.95fr);
    gap: 14px;
    padding: 14px;
    max-width: 1500px;
    width: 100%;
    margin: 0 auto;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    overflow: auto;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    min-height: 28px;
  }
  .head h2 {
    font-size: 16px;
    letter-spacing: -0.01em;
  }
  .count {
    font-size: 13px;
    font-weight: 650;
    color: var(--app);
    font-variant-numeric: tabular-nums;
  }
  .count.zero {
    color: var(--faint);
  }
  .head-actions {
    margin-left: auto;
    display: flex;
    gap: 4px;
  }
  .warn-chip {
    border: 1px solid color-mix(in srgb, #f08c00 50%, var(--surface));
    background: color-mix(in srgb, #f08c00 12%, var(--surface));
    color: color-mix(in srgb, #f08c00 70%, var(--text));
    border-radius: 99px;
    font-size: 12px;
    font-weight: 650;
    padding: 2px 10px;
  }
  .tools {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .tools .danger {
    margin-left: auto;
  }
  .drop {
    flex: 1;
    min-height: 220px;
    display: flex;
    border-radius: var(--radius-sm);
  }
  .drop.dragging {
    outline: 2px dashed var(--app);
    outline-offset: 2px;
  }
  textarea {
    flex: 1;
    width: 100%;
    resize: none !important;
    font-size: 13.5px;
    line-height: 1.6;
    tab-size: 14;
    white-space: pre;
    overflow: auto;
  }
  .foot {
    font-size: 12px;
    color: var(--faint);
  }

  .event {
    display: grid;
    gap: 4px;
    font-size: 12.5px;
    color: var(--muted);
    font-weight: 600;
  }
  .prizes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .prizes li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
    border-radius: 10px;
    background: var(--surface-2);
    border: 1px solid transparent;
  }
  .prizes li.current {
    border-color: var(--app-line);
  }
  .order {
    display: grid;
    flex: none;
  }
  .order button {
    border: 0;
    background: transparent;
    font-size: 8px;
    line-height: 1;
    padding: 3px 4px;
    color: var(--muted);
    border-radius: 4px;
  }
  .order button:hover:not(:disabled) {
    background: var(--surface-3);
  }
  .order button:disabled {
    opacity: 0.25;
    cursor: default;
  }
  .name {
    flex: 1;
  }
  .num {
    width: 68px;
    text-align: right;
    flex: none;
  }
  .unit {
    font-size: 13px;
    color: var(--muted);
  }
  .progress {
    flex: none;
    min-width: 48px;
    height: 26px;
    border: 0;
    border-radius: 99px;
    background: var(--app-soft);
    color: var(--app);
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .progress:hover:not(:disabled) {
    background: var(--app);
    color: var(--on-app);
  }
  .del {
    flex: none;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--faint);
    font-size: 17px;
    line-height: 1;
  }
  .del:hover:not(:disabled) {
    background: var(--surface-3);
    color: var(--bad);
  }
  .del:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .add {
    align-self: flex-start;
  }
  .alert {
    font-size: 12.5px;
    padding: 8px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, #f08c00 12%, var(--surface));
    color: color-mix(in srgb, #f08c00 60%, var(--text));
  }
  .options {
    display: grid;
    gap: 7px;
    padding-top: 12px;
    margin-top: 4px;
    border-top: 1px solid var(--border);
    font-size: 13.5px;
  }
  .options h3 {
    font-size: 12.5px;
    color: var(--muted);
  }
  .options label {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .options input[type='checkbox'],
  .check input {
    accent-color: var(--app);
    width: 15px;
    height: 15px;
  }
  .opt-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .open {
    height: 46px;
    font-size: 16px;
    font-weight: 750;
    border-radius: 12px;
    margin-top: 6px;
  }
  .keys {
    font-size: 12px;
    color: var(--faint);
    line-height: 2;
    text-align: center;
  }

  .empty {
    margin: auto;
    padding: 30px 10px;
    text-align: center;
    color: var(--faint);
    font-size: 13.5px;
    line-height: 1.9;
  }
  .result-list h3 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 14px;
    margin: 12px 0 4px;
  }
  .result-list h3:first-child {
    margin-top: 0;
  }
  .result-list h3 span {
    font-size: 12px;
    color: var(--faint);
    font-weight: 600;
  }
  .result-list ol {
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: w;
  }
  .result-list li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 5px 4px;
    border-bottom: 1px solid var(--border);
    font-size: 13.5px;
  }
  .result-list li:not(.void) {
    counter-increment: w;
  }
  .result-list li::before {
    content: counter(w);
    flex: none;
    width: 22px;
    color: var(--faint);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .result-list li.void::before {
    content: '–';
  }
  .result-list li.void .w-name {
    text-decoration: line-through;
    color: var(--faint);
  }
  .w-name {
    font-weight: 650;
  }
  .w-info {
    color: var(--muted);
    font-size: 12.5px;
    flex: 1;
    min-width: 0;
  }
  .w-time {
    color: var(--faint);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .dialog {
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 22px;
    width: min(400px, calc(100vw - 32px));
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
    --app: var(--c-raffle);
  }
  .dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  .dialog form {
    display: grid;
    gap: 12px;
  }
  .dialog h2 {
    font-size: 17px;
  }
  .dialog p {
    font-size: 13px;
    color: var(--muted);
  }
  .dialog .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .dialog label:not(.check) {
    display: grid;
    gap: 4px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
  }
  .dialog .check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13.5px;
  }
  .dialog .example {
    font-variant-numeric: tabular-nums;
  }
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  @media (max-width: 1100px) {
    .page {
      grid-template-columns: 1fr 1fr;
      overflow: auto;
      align-content: start;
    }
    .panel {
      overflow: visible;
    }
    .results {
      grid-column: 1 / -1;
    }
    .drop {
      min-height: 320px;
    }
  }
  @media (max-width: 720px) {
    .page {
      grid-template-columns: 1fr;
      padding: 10px;
    }
    .drop {
      min-height: 240px;
    }
  }
</style>
