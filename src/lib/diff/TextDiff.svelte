<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { EditorState, type Range, type Text } from '@codemirror/state';
  import { setDeco, decoField, Spacer, Fold, H } from './editor';
  import {
    EditorView,
    Decoration,
    keymap,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
    placeholder,
    type DecorationSet,
  } from '@codemirror/view';
  import { history, historyKeymap, defaultKeymap, undo as cmUndo, redo as cmRedo, undoDepth, redoDepth, insertTab } from '@codemirror/commands';
  import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
  import { load, save } from '$lib/storage';
  import { downloadBlob, timestamp } from '$lib/download';
  import { diffLines, normalizeJson, unifiedPatch, type DiffResult, type Row, type Seg, type WsMode } from './core';
  import { sampleJson, sampleText } from './samples';

  let { json = false, active = true }: { json?: boolean; active?: boolean } = $props();

  // 왼쪽 · 오른쪽 창은 그냥 글 편집기다. 마음대로 고치면 알아서 다시 비교해
  // 바뀐 줄을 칠하고, 같은 줄끼리 높이가 맞게 빈 자리(빗금)를 끼워 넣는다.
  // 화면의 한 줄 높이가 고정이라 줄 · 빈 자리 · 접힌 줄 모두 H 의 배수다.

  type Side = 'a' | 'b';
  const SIDES: Side[] = ['a', 'b'];
  const KEY = 'tools:diff:v1';
  const CONTEXT = 3;
  const MAX_FILE = 40 * 1024 * 1024;
  const label = { a: '원본', b: '바뀐 내용' };

  let opts = $state({ ws: 'none' as WsMode, ignoreCase: false, fold: false, sortKeys: true });
  let ready = false;
  let notice = $state('');
  let copied = $state(false);
  let dropSide = $state<Side | null>(null);
  let names = $state({ a: '', b: '' });
  const eol = { a: '\n', b: '\n' };
  /** 화면에 보여 줄 각 쪽 정보 (비교할 때마다 갱신) */
  let info = $state({ a: { lines: 0, chars: 0, err: '' }, b: { lines: 0, chars: 0, err: '' } });
  let hist = $state({ a: { u: 0, r: 0 }, b: { u: 0, r: 0 } });
  let lastSide: Side = 'a';

  // ── 편집기 ────────────────────────────────────────────────
  const views: Partial<Record<Side, EditorView>> = {};
  let hosts: Partial<Record<Side, HTMLElement>> = $state({});

  function makeView(side: Side, parent: HTMLElement) {
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: '',
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          history(),
          search(),
          highlightSelectionMatches(),
          keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap, { key: 'Tab', run: insertTab }]),
          placeholder(placeholderText(side)),
          decoField,
          EditorView.contentAttributes.of({ 'aria-label': label[side], spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', 'data-side': side }),
          EditorView.updateListener.of((u) => {
            if (u.focusChanged && u.view.hasFocus) lastSide = side;
            if (u.geometryChanged && side === 'a') measure();
            if (!u.docChanged) return;
            hist[side] = { u: undoDepth(u.state), r: redoDepth(u.state) };
            // JSON 모드에서 빈 칸에 붙여넣으면 바로 보기 좋게 정리한다
            if (json && u.startState.doc.length === 0 && u.transactions.some((t) => t.isUserEvent('input.paste'))) {
              setTimeout(() => tidy(side));
            }
            schedule();
          }),
        ],
      }),
    });
    view.scrollDOM.addEventListener('scroll', () => onScroll(side));
    return view;
  }

  function placeholderText(side: Side) {
    return `${label[side]}을 붙여넣거나 파일을 끌어다 놓으세요.\n파일 두 개를 한꺼번에 놓으면 양쪽에 들어갑니다.\n\n내용은 이 브라우저 밖으로 나가지 않습니다.`;
  }

  const textOf = (side: Side) => views[side]?.state.doc.toString() ?? '';

  /** 한 쪽 내용을 통째로 바꾼다 (실행 취소할 수 있게 기록에 남긴다) */
  function setText(side: Side, text: string, userEvent = 'input.replace') {
    const v = views[side];
    if (!v) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, userEvent, scrollIntoView: false });
  }

  /** 다른 도구에서 넘어온 두 글을 양쪽에 넣는다 */
  export function fill(a: string, b: string) {
    setText('a', a);
    setText('b', b);
  }

  // ── 비교 ──────────────────────────────────────────────────
  type RowItem = { k: 'row'; row: Row; block: number };
  type Item = { k: 'fold'; key: number; count: number; a0: number; a1: number; b0: number; b1: number } | RowItem;
  interface Block {
    at: number;
    n: number;
    a0: number;
    a1: number;
    b0: number;
    b1: number;
  }

  let res = $state.raw<DiffResult | null>(null);
  let both = $state(false);
  let jsonSame = $state<null | boolean>(null);
  let rawSame = $state(false);
  let items = $state.raw<Item[]>([]);
  let blocks = $state.raw<Block[]>([]);
  let expanded = new Set<number>();
  let cur = $state(-1);

  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule() {
    clearTimeout(timer);
    const size = (views.a?.state.doc.length ?? 0) + (views.b?.state.doc.length ?? 0);
    timer = setTimeout(recompute, size > 1_000_000 ? 400 : size > 200_000 ? 150 : 30);
  }

  function recompute() {
    clearTimeout(timer);
    if (!views.a || !views.b) return;
    // 한글 조합 중에는 장식을 바꾸지 않는다 (조합이 끊기지 않게)
    if (views.a.composing || views.b.composing) {
      timer = setTimeout(recompute, 150);
      return;
    }
    const a = textOf('a');
    const b = textOf('b');
    const errs = { a: '', b: '' };
    jsonSame = null;
    if (json && a.trim() && b.trim()) {
      const na = normalizeJson(a, opts.sortKeys);
      const nb = normalizeJson(b, opts.sortKeys);
      if (!na.ok) errs.a = na.error;
      if (!nb.ok) errs.b = nb.error;
      if (na.ok && nb.ok) jsonSame = na.text === nb.text;
    } else if (json) {
      for (const s of SIDES) {
        const t = s === 'a' ? a : b;
        const n = normalizeJson(t, opts.sortKeys);
        if (!n.ok) errs[s] = n.error;
      }
    }
    for (const s of SIDES) {
      const t = s === 'a' ? a : b;
      info[s] = { lines: views[s]!.state.doc.lines - (t === '' || t.endsWith('\n') ? 1 : 0), chars: t.length, err: errs[s] };
    }
    both = a !== '' && b !== '';
    rawSame = a === b;
    res = both ? diffLines(a, b, { ws: opts.ws, ignoreCase: opts.ignoreCase }) : null;
    rebuild();
  }

  /** 비교 결과로 화면의 줄 목록을 만들고 양쪽 편집기에 장식을 입힌다 */
  function rebuild() {
    const va = views.a;
    const vb = views.b;
    if (!va || !vb) return;
    const out: Item[] = [];
    const blks: Block[] = [];
    if (res) {
      const rows = res.rows;
      // 커서가 있는 줄은 접지 않는다
      const hold = SIDES.map((s) => {
        const v = views[s]!;
        return v.hasFocus ? v.state.doc.lineAt(v.state.selection.main.head).number - 1 : -1;
      });
      let i = 0;
      while (i < rows.length) {
        let e = i;
        if (!rows[i].changed) {
          while (e < rows.length && !rows[e].changed) e++;
          const head = i === 0 ? 0 : CONTEXT;
          const tail = e === rows.length ? 0 : CONTEXT;
          const f0 = i + head;
          const f1 = e - tail;
          const key = rows[i].a!;
          const holds = f1 > f0 && ((rows[f0].a! <= hold[0] && hold[0] <= rows[f1 - 1].a!) || (rows[f0].b! <= hold[1] && hold[1] <= rows[f1 - 1].b!));
          if (opts.fold && (head || tail) && e - i > head + tail + 1 && !expanded.has(key) && !holds) {
            for (let r = i; r < f0; r++) out.push({ k: 'row', row: rows[r], block: -1 });
            out.push({ k: 'fold', key, count: f1 - f0, a0: rows[f0].a!, a1: rows[f1 - 1].a!, b0: rows[f0].b!, b1: rows[f1 - 1].b! });
            for (let r = f1; r < e; r++) out.push({ k: 'row', row: rows[r], block: -1 });
          } else {
            for (let r = i; r < e; r++) out.push({ k: 'row', row: rows[r], block: -1 });
          }
        } else {
          while (e < rows.length && rows[e].changed) e++;
          let a0 = -1;
          let b0 = -1;
          let a1 = -1;
          let b1 = -1;
          for (let r = i; r < e; r++) {
            const { a, b } = rows[r];
            if (a !== null) {
              if (a0 < 0) a0 = a;
              a1 = a + 1;
            }
            if (b !== null) {
              if (b0 < 0) b0 = b;
              b1 = b + 1;
            }
          }
          // 한쪽에 줄이 없으면 그 자리(다음 줄 앞)를 쓴다
          const prev = i > 0 ? rows[i - 1] : null;
          if (a0 < 0) a0 = a1 = prev ? prev.a! + 1 : 0;
          if (b0 < 0) b0 = b1 = prev ? prev.b! + 1 : 0;
          blks.push({ at: out.length, n: e - i, a0, a1, b0, b1 });
          for (let r = i; r < e; r++) out.push({ k: 'row', row: rows[r], block: blks.length - 1 });
        }
        i = e;
      }
    }
    items = out;
    blocks = blks;
    if (cur >= blks.length) cur = -1;
    for (const s of SIDES) {
      const v = views[s]!;
      v.dispatch({ effects: setDeco.of(decorate(s, v.state.doc, out)) });
    }
  }

  const lineStart = (doc: Text, i: number) => (i < doc.lines ? doc.line(i + 1).from : doc.length);

  function decorate(side: Side, doc: Text, list: Item[]): DecorationSet {
    if (!list.length || (res && !res.added && !res.removed && !res.modified && !opts.fold)) return Decoration.none;
    const out: Range<Decoration>[] = [];
    const cls = side === 'a' ? 'cm-del' : 'cm-ins';
    const lineDeco = Decoration.line({ class: cls });
    const mark = Decoration.mark({ class: 'cm-chg' });
    let gap = 0;
    let next = 0; // 이 쪽에서 다음에 나올 줄 번호
    const flushGap = () => {
      if (!gap) return;
      const pos = lineStart(doc, next);
      const end = next >= doc.lines;
      out.push(Decoration.widget({ widget: new Spacer(gap), block: true, side: end ? 1 : -1 }).range(pos));
      gap = 0;
    };
    for (const it of list) {
      if (it.k === 'fold') {
        flushGap();
        const l0 = side === 'a' ? it.a0 : it.b0;
        const l1 = side === 'a' ? it.a1 : it.b1;
        if (l1 >= doc.lines) continue;
        out.push(Decoration.replace({ widget: new Fold(it.key, it.count, expand), block: true }).range(doc.line(l0 + 1).from, doc.line(l1 + 1).to));
        next = l1 + 1;
        continue;
      }
      const r = it.row;
      const line = r[side];
      if (line === null) {
        gap++;
        continue;
      }
      next = line;
      flushGap();
      next = line + 1;
      if (!r.changed || line >= doc.lines) continue;
      const l = doc.line(line + 1);
      out.push(lineDeco.range(l.from));
      const segs: Seg[] | undefined = side === 'a' ? r.segA : r.segB;
      if (segs) {
        let p = l.from;
        for (const g of segs) {
          const q = Math.min(l.to, p + g.text.length);
          if (g.changed && q > p) out.push(mark.range(p, q));
          p = q;
        }
      }
    }
    flushGap();
    return Decoration.set(out, true);
  }

  function expand(key: number) {
    expanded.add(key);
    rebuild();
  }

  const changes = $derived(res ? res.added + res.removed + res.modified : 0);
  const same = $derived(json && jsonSame !== null ? jsonSame : both && !!res && !changes);

  // ── 스크롤: 두 창이 같이 움직인다 ───────────────────────────
  let top = $state(0);
  let vh = $state(600);
  let sh = $state(1);
  let syncing: Side | null = null;
  function measure() {
    const el = views.a?.scrollDOM;
    if (!el) return;
    top = el.scrollTop;
    vh = el.clientHeight;
    sh = Math.max(el.scrollHeight, 1);
  }
  function onScroll(side: Side) {
    const from = views[side]?.scrollDOM;
    const other = views[side === 'a' ? 'b' : 'a']?.scrollDOM;
    if (!from || !other) return;
    top = from.scrollTop;
    vh = from.clientHeight;
    sh = Math.max(from.scrollHeight, 1);
    if (syncing === side) {
      syncing = null;
      return;
    }
    if (Math.abs(other.scrollTop - from.scrollTop) > 0.5 || Math.abs(other.scrollLeft - from.scrollLeft) > 0.5) {
      syncing = side === 'a' ? 'b' : 'a';
      other.scrollTop = from.scrollTop;
      other.scrollLeft = from.scrollLeft;
    }
  }

  function reveal(index: number) {
    const el = views.a?.scrollDOM;
    if (el) el.scrollTop = Math.max(0, index * H - el.clientHeight / 2 + H / 2);
  }

  function go(delta: number) {
    const n = blocks.length;
    if (!n) return;
    cur = cur < 0 || cur >= n ? (delta > 0 ? 0 : n - 1) : (cur + delta + n) % n;
    const b = blocks[cur];
    reveal(b.at);
    // 커서도 그 차이로 옮겨 바로 고칠 수 있게 한다
    const v = views[lastSide]!;
    const pos = lineStart(v.state.doc, lastSide === 'a' ? b.a0 : b.b0);
    v.dispatch({ selection: { anchor: pos } });
  }

  // 가운데 띠: 보이는 차이 블록만 그린다
  const bands = $derived(blocks.map((b, i) => ({ ...b, i })).filter((b) => (b.at + b.n) * H >= top && b.at * H <= top + vh));

  // 스크롤 옆 지도: 전체에서 바뀐 곳이 어디쯤인지
  const map = $derived.by(() => {
    const n = Math.min(items.length, 220);
    const cells = new Array<string>(n).fill('');
    if (!changes) return cells;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.k !== 'row' || !it.row.changed) continue;
      const kind = it.row.a === null ? 'ins' : it.row.b === null ? 'del' : 'mod';
      const c = Math.floor((i / items.length) * n);
      cells[c] = cells[c] && cells[c] !== kind ? 'mod' : kind;
    }
    return cells;
  });

  function onMap(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    reveal(Math.min(items.length - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * items.length))));
  }

  // ── 블록 복사 · 되돌리기 ──────────────────────────────────
  function copyBlock(b: Block, to: Side) {
    const from: Side = to === 'a' ? 'b' : 'a';
    const src = views[from]!.state.doc;
    const dst = views[to]!;
    const doc = dst.state.doc;
    const [s0, s1] = from === 'a' ? [b.a0, b.a1] : [b.b0, b.b1];
    const [x0, x1] = to === 'a' ? [b.a0, b.a1] : [b.b0, b.b1];
    let insert = src.sliceString(lineStart(src, s0), lineStart(src, s1));
    let p0 = lineStart(doc, x0);
    const p1 = lineStart(doc, x1);
    const len = doc.length;
    const openEnd = len > 0 && p1 === len && doc.sliceString(len - 1) !== '\n';
    if (insert && !insert.endsWith('\n') && p1 < len) insert += '\n';
    if (openEnd) {
      // 마지막 줄 뒤에 줄바꿈이 없는 문서: 줄바꿈 위치를 맞춘다
      insert = insert.replace(/\n$/, '');
      if (p0 === p1 && insert) insert = '\n' + insert;
      else if (p0 < p1 && !insert && p0 > 0) p0--;
    }
    lastSide = to;
    dst.dispatch({ changes: { from: p0, to: p1, insert }, userEvent: 'input.copy-block', scrollIntoView: false });
    recompute();
  }

  function undo() {
    const s = hist[lastSide].u ? lastSide : lastSide === 'a' ? 'b' : 'a';
    if (views[s]) cmUndo(views[s]!);
  }
  function redo() {
    const s = hist[lastSide].r ? lastSide : lastSide === 'a' ? 'b' : 'a';
    if (views[s]) cmRedo(views[s]!);
  }

  // ── 파일 · 입력 ───────────────────────────────────────────
  function put(side: Side, text: string, name: string) {
    eol[side] = text.includes('\r\n') ? '\r\n' : '\n';
    names[side] = name;
    expanded = new Set();
    if (json) {
      const n = normalizeJson(text, opts.sortKeys);
      if (n.ok && n.text) text = n.text;
    }
    setText(side, text.replace(/\r\n?/g, '\n'));
  }

  async function readFile(side: Side, f: File) {
    if (f.size > MAX_FILE) return flash(`${f.name}: 파일이 너무 큽니다 (최대 40MB)`);
    const text = await f.text();
    if (text.slice(0, 4000).includes('\u0000')) return flash(`${f.name}: 텍스트 파일이 아닙니다`);
    put(side, text, f.name);
  }

  // 파일 두 개를 한꺼번에 놓으면 왼쪽 · 오른쪽에 차례로 넣는다
  function takeFiles(side: Side, files: FileList | null | undefined) {
    if (!files?.length) return;
    if (files.length >= 2) {
      readFile('a', files[0]);
      readFile('b', files[1]);
    } else readFile(side, files[0]);
  }

  function sideAt(e: DragEvent): Side {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? 'a' : 'b';
  }
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

  function flash(msg: string) {
    notice = msg;
    setTimeout(() => notice === msg && (notice = ''), 4000);
  }

  function swap() {
    const a = textOf('a');
    const b = textOf('b');
    names = { a: names.b, b: names.a };
    [eol.a, eol.b] = [eol.b, eol.a];
    expanded = new Set();
    setText('a', b);
    setText('b', a);
  }
  function clear(side: Side) {
    names[side] = '';
    setText(side, '', 'delete');
  }
  function sample() {
    const s = json ? sampleJson : sampleText;
    put('a', s.a, '');
    put('b', s.b, '');
  }
  /** JSON 을 키 정렬 · 들여쓰기 2칸으로 정리한다 */
  function tidy(side: Side) {
    const n = normalizeJson(textOf(side), opts.sortKeys);
    if (n.ok && n.text && n.text !== textOf(side)) setText(side, n.text);
  }
  function saveSide(side: Side) {
    const text = eol[side] === '\n' ? textOf(side) : textOf(side).replace(/\n/g, eol[side]);
    downloadBlob(new Blob([text], { type: 'text/plain' }), names[side] || `${side === 'a' ? 'left' : 'right'}-${timestamp()}.${json ? 'json' : 'txt'}`);
  }

  function patch() {
    return unifiedPatch(textOf('a'), textOf('b'), names.a || 'a', names.b || 'b');
  }
  async function copyPatch() {
    try {
      await navigator.clipboard.writeText(patch());
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      flash('클립보드에 복사하지 못했습니다');
    }
  }
  function savePatch() {
    downloadBlob(new Blob([patch()], { type: 'text/x-diff' }), `diff-${timestamp()}.patch`);
  }

  function onKeydown(e: KeyboardEvent) {
    if (!active) return;
    const typing = !!(e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]');
    if ((e.metaKey || e.ctrlKey) && !typing && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      e.preventDefault();
      if (e.key === 'y' || e.shiftKey) redo();
      else undo();
      return;
    }
    const down = (e.altKey && e.key === 'ArrowDown') || (e.key === 'F7' && !e.shiftKey);
    const up = (e.altKey && e.key === 'ArrowUp') || (e.key === 'F7' && e.shiftKey);
    if (!down && !up) return;
    e.preventDefault();
    go(down ? 1 : -1);
  }

  const ignored = $derived([opts.ws !== 'none' && '공백', opts.ignoreCase && '대소문자', json && opts.sortKeys && '키 순서'].filter(Boolean).join(' · '));
  const blank = $derived(!info.a.chars && !info.b.chars);

  // 옵션 · 모드가 바뀌면 다시 비교한다
  $effect(() => {
    void [opts.ws, opts.ignoreCase, opts.fold, opts.sortKeys, json];
    if (!opts.fold) expanded = new Set();
    untrack(recompute);
  });

  // 숨겨졌다 다시 보이면 크기를 다시 잰다
  $effect(() => {
    if (active) for (const s of SIDES) views[s]?.requestMeasure();
  });

  onMount(() => {
    const saved = load<Record<string, unknown>>(KEY, {});
    delete saved.view;
    opts = { ...opts, ...saved };
    ready = true;
    for (const s of SIDES) views[s] = makeView(s, hosts[s]!);
    recompute();
    return () => {
      clearTimeout(timer);
      for (const s of SIDES) views[s]?.destroy();
    };
  });
  $effect(() => {
    const snapOpts = $state.snapshot(opts);
    if (ready) save(KEY, snapOpts);
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="diff">
  <div class="bar">
    <button class="btn sm" onclick={swap} disabled={blank} title="왼쪽과 오른쪽을 바꿉니다">⇄ 바꾸기</button>
    <span class="nav">
      <button class="btn sm" disabled={!hist.a.u && !hist.b.u} onmousedown={(e) => e.preventDefault()} onclick={undo} title="실행 취소 (Ctrl+Z)" aria-label="실행 취소">↶</button>
      <button class="btn sm" disabled={!hist.a.r && !hist.b.r} onmousedown={(e) => e.preventDefault()} onclick={redo} title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행">↷</button>
    </span>
    <label class="opt">
      공백
      <select class="field" bind:value={opts.ws}>
        <option value="none">그대로 비교</option>
        <option value="edge">줄 앞뒤 무시</option>
        <option value="all">모두 무시</option>
      </select>
    </label>
    <label class="opt"><input type="checkbox" bind:checked={opts.ignoreCase} /> 대소문자 무시</label>
    <label class="opt"><input type="checkbox" bind:checked={opts.fold} /> 같은 부분 접기</label>
    {#if json}
      <label class="opt" title="키 순서만 다른 것은 차이로 보지 않습니다"><input type="checkbox" bind:checked={opts.sortKeys} /> 키 정렬</label>
      <button class="btn sm" disabled={blank} onclick={() => SIDES.forEach(tidy)} title="양쪽 JSON 을 같은 모양(들여쓰기 2칸{opts.sortKeys ? ', 키 정렬' : ''})으로 맞춥니다">정리</button>
    {/if}
    {#if blank}<button class="btn sm primary" onclick={sample}>예시로 보기</button>{/if}

    <div class="right">
      {#if notice}<span class="notice" role="status">{notice}</span>{/if}
      {#if same}
        <span class="same" role="status" title={ignored ? `${ignored} 차이는 빼고 본 결과입니다` : ''}>✓ 두 내용이 같습니다{json && !rawSame && changes ? ' (형식만 다름)' : ''}</span>
      {:else if res}
        <span class="stats" aria-label="차이 요약">
          <span class="ins">추가 {res.added.toLocaleString('ko-KR')}</span>
          <span class="del">삭제 {res.removed.toLocaleString('ko-KR')}</span>
          <span class="mod">수정 {res.modified.toLocaleString('ko-KR')}</span>
        </span>
      {/if}
      {#if res}
        <span class="nav">
          <button class="btn sm" disabled={!blocks.length} onclick={() => go(-1)} title="이전 차이 (Alt+↑ · Shift+F7)" aria-label="이전 차이">↑</button>
          <span class="pos">{cur < 0 || cur >= blocks.length ? '–' : cur + 1} / {blocks.length.toLocaleString('ko-KR')}</span>
          <button class="btn sm" disabled={!blocks.length} onclick={() => go(1)} title="다음 차이 (Alt+↓ · F7)" aria-label="다음 차이">↓</button>
        </span>
        <button class="btn sm" disabled={!changes} onclick={copyPatch} title="git apply 로 적용할 수 있는 형식">{copied ? '복사됨' : '패치 복사'}</button>
        <button class="btn sm" disabled={!changes} onclick={savePatch}>.patch 저장</button>
      {/if}
    </div>
  </div>

  <div class="frame">
    <div class="heads">
      {#each SIDES as side (side)}
        <div class="head h{side}">
          <b>{label[side]}</b>
          {#if names[side]}<span class="name" title={names[side]}>{names[side]}</span>{/if}
          {#if info[side].err}
            <span class="err" title={info[side].err}>JSON 형식이 올바르지 않습니다 — {info[side].err}</span>
          {:else}
            <span class="meta">{info[side].lines.toLocaleString('ko-KR')}줄</span>
          {/if}
          <span class="acts">
            <label class="btn sm ghost">
              파일
              <input
                type="file"
                hidden
                onchange={(e) => {
                  takeFiles(side, e.currentTarget.files);
                  e.currentTarget.value = '';
                }}
              />
            </label>
            <button class="btn sm ghost" disabled={!info[side].chars} onclick={() => saveSide(side)}>저장</button>
            <button class="btn sm ghost" disabled={!info[side].chars} onclick={() => clear(side)}>지우기</button>
          </span>
        </div>
        {#if side === 'a'}<div class="gap"></div>{/if}
      {/each}
      <div></div>
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="out"
      ondragovercapture={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dropSide = sideAt(e);
      }}
      ondragleave={(e) => !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node) && (dropSide = null)}
      ondropcapture={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const s = sideAt(e);
        dropSide = null;
        takeFiles(s, e.dataTransfer?.files);
      }}
    >
      {#each SIDES as side (side)}
        <div class="pane p{side}" class:drop={dropSide === side} bind:this={hosts[side]}>
          {#if dropSide === side}<div class="drop-hint">여기에 놓으면 {label[side]}을 바꿉니다</div>{/if}
        </div>
        {#if side === 'a'}
          <div class="gut">
            {#each bands as b (b.i)}
              <div class="band" class:cur={b.i === cur} style:top="{b.at * H - top}px" style:height="{b.n * H}px">
                <button class="cp" onclick={() => copyBlock(b, 'b')} title="이 차이를 오른쪽에 덮어씁니다" aria-label="오른쪽으로 복사">→</button>
                <button class="cp" onclick={() => copyBlock(b, 'a')} title="이 차이를 왼쪽에 덮어씁니다" aria-label="왼쪽으로 복사">←</button>
              </div>
            {/each}
          </div>
        {/if}
      {/each}

      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="map" onclick={onMap} title="눌러서 그 위치로 이동">
        {#each map as c, i (i)}<i class={c}></i>{/each}
        {#if sh > vh + 1}
          <span class="view" style:top="{(top / sh) * 100}%" style:height="{Math.max(2, (vh / sh) * 100)}%"></span>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .diff {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    --add: color-mix(in srgb, var(--ok) 13%, var(--surface));
    --add-hl: color-mix(in srgb, var(--ok) 36%, var(--surface));
    --rem: color-mix(in srgb, var(--bad) 11%, var(--surface));
    --rem-hl: color-mix(in srgb, var(--bad) 32%, var(--surface));
    --mod: #c77700;
    --gw: 40px;
    --cols: minmax(0, 1fr) var(--gw) minmax(0, 1fr) 14px;
  }

  .bar {
    flex: none;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    padding: 10px 12px;
  }
  .opt {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    color: var(--muted);
    white-space: nowrap;
  }
  .opt select {
    height: 28px;
    font-size: 12.5px;
    padding: 0 6px;
    color: var(--text);
  }
  .opt input {
    accent-color: var(--app);
    margin: 0;
  }
  .right {
    margin-left: auto;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
  }
  .notice {
    font-size: 12.5px;
    color: var(--bad);
  }
  .same {
    font-size: 12.5px;
    font-weight: 650;
    color: var(--ok);
    white-space: nowrap;
  }
  .stats {
    display: inline-flex;
    gap: 10px;
    font-size: 12.5px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .stats .ins {
    color: var(--ok);
  }
  .stats .del {
    color: var(--bad);
  }
  .stats .mod {
    color: var(--mod);
  }
  .nav {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .nav .btn {
    width: 28px;
    padding: 0;
  }
  .pos {
    min-width: 54px;
    text-align: center;
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .frame {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    margin: 0 12px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }

  .heads {
    flex: none;
    display: grid;
    grid-template-columns: var(--cols);
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
    font-size: 13px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 36px;
    padding: 0 4px 0 10px;
  }
  .head b {
    white-space: nowrap;
  }
  .head .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 12px;
  }
  .head .meta {
    color: var(--faint);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .head .err {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--bad);
  }
  .acts {
    margin-left: auto;
    display: inline-flex;
    flex: none;
  }
  .gap {
    border-inline: 1px solid var(--border);
  }

  .out {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: var(--cols);
  }
  .pane {
    position: relative;
    min-width: 0;
    min-height: 0;
  }
  .pane.drop {
    box-shadow: inset 0 0 0 2px var(--app);
  }
  .drop-hint {
    position: absolute;
    z-index: 5;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--app);
    color: #fff;
    font-size: 13px;
    pointer-events: none;
    white-space: nowrap;
  }

  /* ── 편집기 ── */
  .pane :global(.cm-editor) {
    height: 100%;
    background: var(--surface);
    color: var(--text);
    font-size: 12.5px;
  }
  .pane :global(.cm-editor.cm-focused) {
    outline: none;
  }
  .pane :global(.cm-scroller) {
    font-family: var(--mono);
    line-height: 20px;
    tab-size: 4;
  }
  .pane :global(.cm-content) {
    padding: 0;
    caret-color: var(--text);
  }
  .pane :global(.cm-line) {
    padding: 0 8px;
  }
  .pane :global(.cm-cursor) {
    border-left-color: var(--text);
  }
  .pane :global(.cm-gutters) {
    background: var(--surface);
    border-right: 0;
    color: var(--faint);
    font-size: 11.5px;
  }
  .pane :global(.cm-lineNumbers .cm-gutterElement) {
    padding: 0 6px 0 10px;
    font-variant-numeric: tabular-nums;
  }
  .pane :global(.cm-activeLine) {
    background: color-mix(in srgb, var(--app) 6%, transparent);
  }
  .pane :global(.cm-activeLineGutter) {
    background: transparent;
    color: var(--text);
  }
  .pane :global(.cm-selectionBackground) {
    background: color-mix(in srgb, var(--app) 22%, transparent) !important;
  }
  .pane :global(.cm-focused .cm-selectionBackground) {
    background: color-mix(in srgb, var(--app) 32%, transparent) !important;
  }
  .pane :global(.cm-selectionMatch) {
    background: color-mix(in srgb, var(--app) 16%, transparent);
  }
  .pane :global(.cm-placeholder) {
    color: var(--faint);
  }
  .pane :global(.cm-line.cm-del) {
    background: var(--rem);
  }
  .pane :global(.cm-line.cm-ins) {
    background: var(--add);
  }
  .pane :global(.cm-del .cm-chg) {
    background: var(--rem-hl);
    border-radius: 3px;
  }
  .pane :global(.cm-ins .cm-chg) {
    background: var(--add-hl);
    border-radius: 3px;
  }
  .pane :global(.cm-spacer) {
    background: repeating-linear-gradient(-45deg, transparent 0 5px, var(--surface-2) 5px 6.5px);
  }
  .pane :global(.cm-fold) {
    display: block;
    width: 100%;
    height: 20px;
    padding: 0 12px;
    border: 0;
    box-shadow:
      inset 0 1px 0 var(--border),
      inset 0 -1px 0 var(--border);
    background: var(--surface-2);
    color: var(--muted);
    font-family: var(--font);
    font-size: 12px;
    line-height: 20px;
    text-align: center;
    cursor: pointer;
  }
  .pane :global(.cm-fold:hover) {
    background: var(--app-soft);
    color: var(--text);
  }
  .pane :global(.cm-panels) {
    background: var(--surface-2);
    color: var(--text);
    border-color: var(--border);
  }
  .pane :global(.cm-panel.cm-search) {
    font-family: var(--font);
    font-size: 12px;
  }
  .pane :global(.cm-panel.cm-search input),
  .pane :global(.cm-panel.cm-search button) {
    font: inherit;
    color: var(--text);
  }
  .pane :global(.cm-textfield) {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .pane :global(.cm-button) {
    background: var(--surface);
    background-image: none;
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .pane :global(.cm-searchMatch) {
    background: color-mix(in srgb, #f5c400 35%, transparent);
  }
  .pane :global(.cm-searchMatch-selected) {
    background: color-mix(in srgb, #f59a00 55%, transparent);
  }

  /* ── 가운데 띠 ── */
  .gut {
    position: relative;
    overflow: hidden;
    border-inline: 1px solid var(--border);
    background: var(--surface-2);
    user-select: none;
  }
  .band {
    position: absolute;
    inset-inline: 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: 1px;
    padding-top: 1px;
    background: color-mix(in srgb, var(--mod) 14%, var(--surface-2));
  }
  .band.cur {
    box-shadow:
      inset 2px 0 0 var(--app),
      inset -2px 0 0 var(--app);
  }
  .cp {
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    font-family: var(--font);
    font-size: 12px;
    line-height: 18px;
  }
  .cp:hover {
    background: var(--app);
    color: #fff;
  }

  .map {
    position: relative;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--border);
    background: var(--surface-2);
    cursor: pointer;
  }
  .map i {
    flex: 1;
    min-height: 0;
  }
  .map .ins {
    background: var(--ok);
  }
  .map .del {
    background: var(--bad);
  }
  .map .mod {
    background: var(--mod);
  }
  .map .view {
    position: absolute;
    inset-inline: 0;
    border: 1px solid var(--muted);
    border-radius: 2px;
    background: color-mix(in srgb, var(--text) 8%, transparent);
    pointer-events: none;
  }

  @media (max-width: 760px) {
    .diff {
      --gw: 26px;
    }
    .bar {
      padding: 8px;
    }
    .right {
      margin-left: 0;
    }
    .frame {
      margin: 0 8px 8px;
    }
    .head .name,
    .head .meta,
    .head b {
      display: none;
    }
    .head {
      padding-left: 2px;
    }
    .acts {
      margin-left: 0;
      flex-wrap: wrap;
    }
    .cp {
      width: 12px;
      font-size: 11px;
    }
    .pane :global(.cm-editor) {
      font-size: 11.5px;
    }
    .pane :global(.cm-lineNumbers .cm-gutterElement) {
      padding: 0 4px 0 4px;
    }
  }
</style>
