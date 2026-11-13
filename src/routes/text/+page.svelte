<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { EditorState, type Range } from '@codemirror/state';
  import { Decoration, EditorView, drawSelection, keymap, placeholder } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import { load, save } from '$lib/storage';
  import { decoField, setDeco } from '$lib/diff/editor';
  import { randomInt } from '$lib/raffle/core';
  import { MAX_MATCHES, PRESETS, explain, patternError, type Match, type Preset } from '$lib/text/regex';
  import { RegexRunner } from '$lib/text/runner';
  import { applyOp, stats, type OpId } from '$lib/text/lines';

  const KEY = 'tools:text:v1';
  const FLAGS: [string, string, string][] = [
    ['g', '모두 찾기', '끄면 첫 번째 일치만 찾습니다'],
    ['i', '대소문자 무시', 'A 와 a 를 같은 글자로 봅니다'],
    ['m', '줄마다', '^ 와 $ 가 줄마다의 시작 · 끝에 맞습니다'],
    ['s', '. 이 줄바꿈도', '. 이 줄바꿈까지 포함합니다'],
    ['u', '유니코드', '\\p{…} 와 이모지를 제대로 다룹니다'],
  ];
  const SAMPLE = PRESETS[3];

  let mode = $state<'regex' | 'lines'>('regex');
  let ready = $state(false);
  let toast = $state('');

  // ── 정규식 ──
  let pattern = $state(SAMPLE.pattern);
  let flags = $state(SAMPLE.flags);
  let subject = $state(SAMPLE.sample);
  let replacement = $state('$<year>년 $<month>월 $<day>일');
  let side = $state<'explain' | 'matches' | 'replace' | 'presets'>('explain');
  let matches = $state.raw<Match[]>([]);
  let truncated = $state(false);
  let replaced = $state('');
  let status = $state<'idle' | 'running' | 'ok' | 'timeout'>('idle');
  let current = $state(-1);

  const error = $derived(pattern ? patternError(pattern, flags) : null);
  const parts = $derived(pattern && !error ? explain(pattern, flags) : []);
  // 묶음 번호와 이름은 식에서 읽는다 (여는 괄호가 나온 순서)
  const groupNames = $derived(
    parts
      .filter((p) => p.kind === 'group' && (p.text === '(' || /^\(\?<[^=!]/.test(p.text)))
      .map((p, i) => (p.text === '(' ? `${i + 1}` : `${i + 1} · ${p.text.slice(3, -1)}`)),
  );

  let host = $state<HTMLElement>();
  let view: EditorView | undefined;
  let runner: RegexRunner | undefined;

  function toggleFlag(f: string) {
    flags = flags.includes(f) ? flags.replace(f, '') : [...FLAGS.map((x) => x[0])].filter((x) => x === f || flags.includes(x)).join('');
  }

  function paint() {
    if (!view) return;
    const marks: Range<Decoration>[] = [];
    matches.forEach((m, i) => {
      if (m.end > m.index && m.end <= view!.state.doc.length) marks.push(Decoration.mark({ class: i === current ? 'cm-hit cm-cur' : i % 2 ? 'cm-hit cm-alt' : 'cm-hit' }).range(m.index, m.end));
    });
    view.dispatch({ effects: setDeco.of(Decoration.set(marks)) });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const req = { pattern, flags, text: subject, replacement: side === 'replace' ? replacement : null };
    const bad = error;
    if (!ready) return;
    clearTimeout(timer);
    if (!req.pattern || bad) {
      matches = [];
      truncated = false;
      replaced = '';
      status = 'idle';
      current = -1;
      untrack(paint);
      return;
    }
    timer = setTimeout(async () => {
      status = 'running';
      const out = await runner!.run(req);
      if (out.kind === 'stale') return;
      if (out.kind === 'ok') {
        matches = out.result.matches;
        truncated = out.result.truncated;
        replaced = out.result.replaced ?? '';
        status = 'ok';
      } else {
        matches = [];
        truncated = false;
        replaced = '';
        status = out.kind === 'timeout' ? 'timeout' : 'idle';
      }
      current = -1;
      paint();
    }, 120);
  });

  function jump(i: number) {
    const m = matches[i];
    if (!m || !view) return;
    current = i;
    paint();
    view.dispatch({ selection: { anchor: m.index, head: m.end }, effects: EditorView.scrollIntoView(m.index, { y: 'center' }) });
  }
  function setSubject(text: string) {
    view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }
  function usePreset(p: Preset) {
    pattern = p.pattern;
    flags = p.flags;
    setSubject(p.sample);
    side = 'explain';
  }
  function applyReplace() {
    if (status !== 'ok') return;
    setSubject(replaced);
    say('바꾼 결과를 시험할 글에 넣었습니다');
  }

  // ── 줄 정리 ──
  let lines = $state('');
  let delimiter = $state(', ');
  let prefix = $state("'");
  let suffix = $state("'");
  let note = $state('');
  let undo = $state<string[]>([]);
  let redo = $state<string[]>([]);
  const count = $derived(stats(lines));
  const selCount = $state({ chars: 0 });
  let area = $state<HTMLTextAreaElement>();

  const OPS: { title: string; items: [OpId, string][] }[] = [
    { title: '순서', items: [['sort', '가나다순'], ['sortDesc', '거꾸로'], ['sortLength', '짧은 줄부터'], ['reverse', '뒤집기'], ['shuffle', '섞기']] },
    { title: '지우기', items: [['dedupe', '겹치는 줄'], ['dropBlank', '빈 줄'], ['trim', '앞뒤 공백'], ['squeeze', '이어진 공백']] },
    { title: '글자', items: [['upper', 'ABC'], ['lower', 'abc'], ['title', 'Abc'], ['number', '줄 번호']] },
  ];

  function run(id: OpId) {
    const r = applyOp(id, lines, { delimiter, prefix, suffix, rand: randomInt });
    note = r.note;
    if (r.text === lines) return;
    undo.push(lines);
    if (undo.length > 100) undo.shift();
    redo = [];
    lines = r.text;
  }
  function step(from: string[], to: string[]) {
    const prev = from.pop();
    if (prev == null) return;
    to.push(lines);
    lines = prev;
    note = '';
  }
  function onSelect() {
    if (!area) return;
    selCount.chars = stats(area.value.slice(area.selectionStart, area.selectionEnd)).chars;
  }

  function say(msg: string) {
    toast = msg;
    setTimeout(() => toast === msg && (toast = ''), 2200);
  }
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      say(`${what} 복사했습니다`);
    } catch {
      say('복사하지 못했습니다');
    }
  }

  onMount(() => {
    const s = load<Record<string, any>>(KEY, {});
    if (s.mode === 'lines') mode = 'lines';
    if (typeof s.pattern === 'string') pattern = s.pattern;
    if (typeof s.flags === 'string' && /^[gimsu]*$/.test(s.flags)) flags = s.flags;
    if (typeof s.subject === 'string') subject = s.subject;
    if (typeof s.replacement === 'string') replacement = s.replacement;
    if (typeof s.lines === 'string') lines = s.lines;
    if (typeof s.delimiter === 'string') delimiter = s.delimiter;
    if (typeof s.prefix === 'string') prefix = s.prefix;
    if (typeof s.suffix === 'string') suffix = s.suffix;
    runner = new RegexRunner();
    ready = true;
    if (view) setSubject(subject);
    return () => runner?.dispose();
  });
  // 편집기는 정규식 탭이 보일 때 만든다
  $effect(() => {
    if (!host || view) return;
    const parent = host;
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: untrack(() => subject),
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          keymap.of([...historyKeymap, ...defaultKeymap]),
          placeholder('여기에 시험할 글을 붙여넣으세요.\n식에 맞는 곳이 바로 색으로 표시됩니다.'),
          decoField,
          EditorView.contentAttributes.of({ 'aria-label': '시험할 글', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) subject = u.state.doc.toString();
          }),
        ],
      }),
    });
    untrack(paint);
    return () => {
      view?.destroy();
      view = undefined;
    };
  });
  $effect(() => {
    // 너무 큰 글은 저장하지 않는다 (저장 공간을 다 쓰지 않게)
    const snap = { mode, pattern, flags, subject: subject.length < 200_000 ? subject : '', replacement, lines: lines.length < 200_000 ? lines : '', delimiter, prefix, suffix };
    if (ready) save(KEY, snap);
  });

  const n = (v: number) => v.toLocaleString('ko-KR');
  const visible = (s: string | null) => (s == null ? '—' : s === '' ? '(빈 글)' : s.replace(/\n/g, '↵').replace(/\t/g, '→'));
</script>

<ToolShell tool="text">
  {#snippet actions()}
    <div class="seg" role="group" aria-label="무엇을 할까">
      <button aria-pressed={mode === 'regex'} onclick={() => (mode = 'regex')}>정규식</button>
      <button aria-pressed={mode === 'lines'} onclick={() => (mode = 'lines')}>줄 정리 · 글자 수</button>
    </div>
  {/snippet}

  {#if mode === 'regex'}
    <div class="page regex">
      <div class="top">
        <div class="expr" class:bad={!!error}>
          <span class="slash">/</span>
          <input bind:value={pattern} aria-label="정규식" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="정규식을 적으세요" />
          <span class="slash">/{flags}</span>
        </div>
        <div class="flags" role="group" aria-label="옵션">
          {#each FLAGS as [f, name, tip] (f)}
            <button aria-pressed={flags.includes(f)} title={tip} onclick={() => toggleFlag(f)}><code>{f}</code> {name}</button>
          {/each}
        </div>
        <p class="state" class:bad={!!error || status === 'timeout'} role="status">
          {#if error}
            {error}
          {:else if !pattern}
            식을 적으면 아래 글에서 맞는 곳을 찾아 줍니다.
          {:else if status === 'timeout'}
            너무 오래 걸려 멈췄습니다. 반복 안에 반복이 든 식(예: <code>(a+)+</code>)은 글이 길면 끝나지 않을 수 있습니다.
          {:else if status === 'ok'}
            <b>{n(matches.length)}{truncated ? '+' : ''}곳</b> 일치
            {#if truncated}— 처음 {n(MAX_MATCHES)}곳만 보여 줍니다{/if}
            {#if !flags.includes('g') && matches.length}— <code>g</code> 가 꺼져 있어 첫 번째만 찾습니다{/if}
          {:else}
            찾는 중…
          {/if}
        </p>
      </div>

      <div class="editor" bind:this={host}></div>

      <aside class="side">
        <div class="seg tabs" role="tablist">
          <button role="tab" aria-selected={side === 'explain'} onclick={() => (side = 'explain')}>풀이</button>
          <button role="tab" aria-selected={side === 'matches'} onclick={() => (side = 'matches')}>일치 {matches.length ? n(matches.length) : ''}</button>
          <button role="tab" aria-selected={side === 'replace'} onclick={() => (side = 'replace')}>바꾸기</button>
          <button role="tab" aria-selected={side === 'presets'} onclick={() => (side = 'presets')}>모음</button>
        </div>

        {#if side === 'explain'}
          {#if parts.length}
            <ol class="explain">
              {#each parts as p, i (i)}
                <li class={p.kind} style:--d={p.depth}><code>{p.text}</code><span>{p.desc}</span></li>
              {/each}
            </ol>
          {:else}
            <p class="hint">{error ? '식을 고치면 여기에 한 조각씩 풀어 줍니다.' : '식을 적으면 한 조각씩 우리말로 풀어 줍니다.'}</p>
          {/if}
        {:else if side === 'matches'}
          {#if matches.length}
            <div class="row">
              <button class="btn sm" onclick={() => copy(matches.map((m) => m.text).join('\n'), '일치한 글을')}>일치한 글 복사</button>
              {#if groupNames.length}
                <button class="btn sm" onclick={() => copy(matches.map((m) => [m.text, ...m.groups.map((g) => g ?? '')].join('\t')).join('\n'), '표를')} title="엑셀에 붙여넣을 수 있게 탭으로 나눕니다">묶음까지 표로 복사</button>
              {/if}
            </div>
            <ol class="matches">
              {#each matches.slice(0, 300) as m, i (i)}
                <li>
                  <button class:on={current === i} onclick={() => jump(i)}>
                    <span class="no">{i + 1}</span>
                    <span class="what">
                      <b>{visible(m.text)}</b>
                      {#each m.groups as g, gi (gi)}
                        <span class="grp"><i>{groupNames[gi]}</i>{visible(g)}</span>
                      {/each}
                    </span>
                  </button>
                </li>
              {/each}
            </ol>
            {#if matches.length > 300}<p class="hint">목록에는 처음 300곳만 보입니다. 복사하면 모두 들어갑니다.</p>{/if}
          {:else}
            <p class="hint">일치하는 곳이 없습니다.</p>
          {/if}
        {:else if side === 'replace'}
          <label class="f">
            <span>바꿀 말</span>
            <input class="field mono" bind:value={replacement} aria-label="바꿀 말" spellcheck="false" autocapitalize="off" />
          </label>
          <p class="hint"><code>$1</code> 첫 묶음 · <code>$&lt;이름&gt;</code> 이름 붙은 묶음 · <code>$&amp;</code> 일치한 글 전체 · <code>$$</code> 달러 기호</p>
          <label class="f grow">
            <span>바꾼 결과</span>
            <textarea class="field mono" readonly aria-label="바꾼 결과" value={status === 'ok' ? replaced : ''}></textarea>
          </label>
          <div class="row">
            <button class="btn sm primary" disabled={status !== 'ok'} onclick={() => copy(replaced, '바꾼 결과를')}>결과 복사</button>
            <button class="btn sm" disabled={status !== 'ok' || !matches.length} onclick={applyReplace}>시험할 글에 반영</button>
          </div>
        {:else}
          <ul class="presets">
            {#each PRESETS as p (p.name)}
              <li>
                <button onclick={() => usePreset(p)}><b>{p.name}</b><code>{p.pattern}</code></button>
              </li>
            {/each}
          </ul>
          <p class="hint">누르면 식과 예시 글을 함께 넣습니다.</p>
        {/if}
      </aside>
    </div>
  {:else}
    <div class="page lines">
      <div class="work">
        <textarea
          class="field text"
          bind:this={area}
          bind:value={lines}
          onselect={onSelect}
          onkeyup={onSelect}
          onmouseup={onSelect}
          spellcheck="false"
          aria-label="정리할 글"
          placeholder={'여기에 글을 붙여넣으세요.\n\n오른쪽 단추로 줄을 정렬하고, 겹치는 줄을 지우고, 한 줄로 이을 수 있습니다.\n글자 수는 적는 대로 셉니다.'}
        ></textarea>
        <div class="foot">
          <span class="note" role="status">{note}</span>
          <button class="btn sm" disabled={!undo.length} onclick={() => step(undo, redo)}>되돌리기</button>
          <button class="btn sm" disabled={!redo.length} onclick={() => step(redo, undo)}>다시</button>
          <button class="btn sm" disabled={!lines} onclick={() => copy(lines, '글을')}>복사</button>
          <button class="btn sm ghost danger" disabled={!lines} onclick={() => (undo.push(lines), (redo = []), (lines = ''), (note = ''))}>비우기</button>
        </div>
      </div>
      <aside class="side">
        <dl class="stats" aria-label="글자 수">
          <div class="big"><dt>글자</dt><dd>{n(count.chars)}</dd></div>
          <div class="big"><dt>공백 빼고</dt><dd>{n(count.charsNoSpace)}</dd></div>
          <div><dt>낱말</dt><dd>{n(count.words)}</dd></div>
          <div><dt>줄</dt><dd>{n(count.lines)}</dd></div>
          <div title="한글 한 글자를 2바이트로 셉니다. 지원서 · 문자 메시지에서 흔히 쓰는 기준입니다"><dt>바이트 (한글 2)</dt><dd>{n(count.euckr)}</dd></div>
          <div title="UTF-8. 한글 한 글자가 3바이트입니다"><dt>바이트 (UTF-8)</dt><dd>{n(count.utf8)}</dd></div>
          <div><dt>원고지 (200자)</dt><dd>{n(count.pages)}장</dd></div>
          <div><dt>고른 부분</dt><dd>{selCount.chars ? `${n(selCount.chars)}자` : '—'}</dd></div>
        </dl>
        {#each OPS as g (g.title)}
          <div class="ops">
            <h3>{g.title}</h3>
            <div>{#each g.items as [id, name] (id)}<button class="btn sm" disabled={!lines} onclick={() => run(id)}>{name}</button>{/each}</div>
          </div>
        {/each}
        <div class="ops">
          <h3>잇기 · 나누기</h3>
          <div class="with">
            <input class="field mono" bind:value={delimiter} aria-label="구분자" spellcheck="false" />
            <button class="btn sm" disabled={!lines} onclick={() => run('join')}>한 줄로 잇기</button>
            <button class="btn sm" disabled={!lines} onclick={() => run('split')}>줄로 나누기</button>
          </div>
          <div class="with">
            <input class="field mono" bind:value={prefix} aria-label="줄 앞에 붙일 말" spellcheck="false" placeholder="앞" />
            <input class="field mono" bind:value={suffix} aria-label="줄 뒤에 붙일 말" spellcheck="false" placeholder="뒤" />
            <button class="btn sm" disabled={!lines} onclick={() => run('wrap')}>줄마다 붙이기</button>
          </div>
          <p class="hint">구분자에 <code>\n</code> 줄바꿈, <code>\t</code> 탭을 쓸 수 있습니다. 섞기는 암호학적 난수를 씁니다.</p>
        </div>
      </aside>
    </div>
  {/if}
  {#if toast}<p class="toast" role="status">{toast}</p>{/if}
</ToolShell>

<style>
  .page {
    flex: 1;
    min-height: 0;
    display: grid;
    gap: 12px;
    padding: 14px;
    max-width: 1400px;
    width: 100%;
    margin: 0 auto;
  }
  .regex {
    grid-template-columns: minmax(0, 1fr) minmax(300px, 400px);
    grid-template-rows: auto minmax(0, 1fr);
  }
  .top {
    grid-column: 1 / -1;
    display: grid;
    gap: 8px;
  }
  .expr {
    display: flex;
    align-items: center;
    height: 46px;
    padding: 0 12px;
    border: 1.5px solid var(--border-strong);
    border-radius: 12px;
    background: var(--surface);
    font-family: var(--mono);
    font-size: 16px;
  }
  .expr:focus-within {
    border-color: var(--app);
  }
  .expr.bad {
    border-color: var(--bad);
  }
  .expr input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 6px;
    border: 0;
    outline: 0;
    background: transparent;
    font: inherit;
  }
  .slash {
    color: var(--faint);
  }
  .flags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .flags button {
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: 99px;
    background: var(--surface);
    font-size: 12.5px;
    color: var(--muted);
  }
  .flags button[aria-pressed='true'] {
    border-color: var(--app);
    background: var(--app-soft);
    color: var(--text);
    font-weight: 600;
  }
  code {
    font-family: var(--mono);
    font-size: 0.95em;
  }
  .flags code {
    font-weight: 700;
    color: var(--app);
  }
  .state {
    min-height: 20px;
    font-size: 13px;
    color: var(--muted);
  }
  .state.bad {
    color: var(--bad);
  }
  .state b {
    color: var(--text);
  }

  .editor {
    min-height: 0;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    overflow: hidden;
  }
  .editor :global(.cm-editor) {
    height: 100%;
    font-size: 14px;
  }
  .editor :global(.cm-editor.cm-focused) {
    outline: none;
  }
  .editor :global(.cm-scroller) {
    font-family: var(--mono);
    line-height: 1.75;
    overflow: auto;
  }
  .editor :global(.cm-content) {
    padding: 12px 14px;
    caret-color: var(--text);
  }
  .editor :global(.cm-line) {
    padding: 0;
  }
  .editor :global(.cm-cursor) {
    border-left-color: var(--text);
  }
  .editor :global(.cm-selectionBackground) {
    background: var(--surface-3) !important;
  }
  .editor :global(.cm-placeholder) {
    color: var(--faint);
  }
  .editor :global(.cm-hit) {
    border-radius: 3px;
    background: color-mix(in srgb, var(--app) 26%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--app) 45%, transparent);
  }
  .editor :global(.cm-hit.cm-alt) {
    background: color-mix(in srgb, var(--app) 13%, transparent);
  }
  .editor :global(.cm-hit.cm-cur) {
    background: color-mix(in srgb, #f59f00 45%, transparent);
    box-shadow: 0 0 0 1.5px #f59f00;
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    min-width: 0;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    overflow-y: auto;
  }
  .tabs {
    display: flex;
    flex: none;
  }
  .tabs button {
    flex: 1;
    padding: 0 4px;
    white-space: nowrap;
  }
  .hint {
    font-size: 12px;
    color: var(--faint);
    line-height: 1.7;
  }
  .hint code {
    padding: 0 4px;
    border-radius: 4px;
    background: var(--surface-2);
    color: var(--muted);
  }
  .explain {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .explain li {
    display: grid;
    grid-template-columns: minmax(56px, auto) 1fr;
    gap: 10px;
    align-items: baseline;
    margin-left: calc(var(--d) * 14px);
    padding: 4px 8px;
    border-radius: 7px;
    font-size: 13px;
    line-height: 1.5;
  }
  .explain li:hover {
    background: var(--surface-2);
  }
  .explain code {
    justify-self: start;
    padding: 0 6px;
    border-radius: 5px;
    background: var(--app-soft);
    color: var(--text);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .explain .group code,
  .explain .alt code {
    background: var(--surface-3);
  }
  .explain .anchor code {
    background: color-mix(in srgb, #f59f00 20%, var(--surface));
  }
  .explain .literal code {
    background: var(--surface-2);
  }
  .explain span {
    color: var(--muted);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .matches {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .matches button {
    display: grid;
    grid-template-columns: 30px 1fr;
    gap: 6px;
    width: 100%;
    padding: 5px 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    text-align: left;
    font-size: 13px;
  }
  .matches button:hover,
  .matches button.on {
    background: var(--app-soft);
  }
  .no {
    color: var(--faint);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    text-align: right;
    padding-top: 2px;
  }
  .what {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 8px;
    min-width: 0;
    font-family: var(--mono);
    overflow-wrap: anywhere;
  }
  .what b {
    flex-basis: 100%;
    font-weight: 600;
  }
  .grp {
    font-size: 12px;
    color: var(--muted);
  }
  .grp i {
    margin-right: 4px;
    padding: 0 5px;
    border-radius: 4px;
    background: var(--surface-3);
    font-style: normal;
    font-size: 11px;
    font-family: var(--font);
  }
  .f {
    display: grid;
    gap: 5px;
    font-size: 12.5px;
    font-weight: 650;
    color: var(--muted);
  }
  .f.grow {
    flex: 1;
    min-height: 120px;
    grid-template-rows: auto 1fr;
  }
  .f .field {
    width: 100%;
    font-weight: 400;
    color: var(--text);
  }
  .f textarea {
    resize: none;
  }
  .mono {
    font-family: var(--mono);
  }
  .presets {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .presets button {
    display: grid;
    gap: 2px;
    width: 100%;
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface);
    text-align: left;
    font-size: 13px;
  }
  .presets button:hover {
    border-color: var(--app-line);
    background: var(--app-soft);
  }
  .presets code {
    font-size: 11.5px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 줄 정리 */
  .lines {
    grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
  }
  .work {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    min-width: 0;
  }
  .text {
    flex: 1;
    min-height: 0;
    padding: 14px 16px;
    border-radius: 14px;
    border-color: var(--border);
    resize: none;
    font-size: 14.5px;
    line-height: 1.75;
    tab-size: 4;
  }
  .foot {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .note {
    flex: 1;
    min-width: 120px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin: 0;
  }
  .stats div {
    padding: 7px 10px;
    border-radius: 9px;
    background: var(--surface-2);
  }
  .stats .big {
    background: var(--app-soft);
  }
  .stats dt {
    font-size: 11.5px;
    color: var(--muted);
  }
  .stats dd {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .stats .big dd {
    font-size: 24px;
    letter-spacing: -0.02em;
  }
  .ops {
    display: grid;
    gap: 6px;
  }
  .ops h3 {
    font-size: 12.5px;
    color: var(--muted);
  }
  .ops > div {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .with .field {
    width: 64px;
    height: 28px;
    padding: 0 8px;
    font-size: 12.5px;
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
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 10px;
      gap: 10px;
    }
    .editor {
      flex: none;
      height: 240px;
    }
    .side {
      flex: none;
      overflow: visible;
    }
    .work {
      flex: none;
    }
    .text {
      flex: none;
      height: 260px;
    }
  }
</style>
