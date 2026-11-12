<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import { load, save } from '$lib/storage';
  import { CalcError, Decimal, evaluate, formatNumber, toPlain, type AngleUnit, type Dec } from '$lib/calc/engine';
  import { evaluateProg, formatBase, wrap, type Base, type WordSize } from '$lib/calc/programmer';

  type Mode = 'basic' | 'sci' | 'prog';
  interface HistoryItem {
    expr: string;
    plain: string;
    shown: string;
    mode: Mode;
  }
  interface Key {
    label: string;
    ins?: string;
    act?: () => void;
    kind?: 'num' | 'op' | 'fn' | 'eq' | 'util';
    aria?: string;
    span?: number;
    disabled?: boolean;
    active?: boolean;
  }

  const SETTINGS = 'tools:calc:settings';
  const HISTORY = 'tools:calc:history';

  let mode = $state<Mode>('basic');
  let angle = $state<AngleUnit>('deg');
  let second = $state(false);
  let base = $state<Base>(10);
  let bits = $state<WordSize>(64);
  let signed = $state(true);

  let expr = $state('');
  let prevLine = $state('');
  let error = $state('');
  let justEvaluated = $state(false);
  let ans = $state<Dec | null>(null);
  let memory = $state<Dec | null>(null);
  let history = $state<HistoryItem[]>([]);
  let historyOpen = $state(false);
  let copied = $state(false);
  let ready = $state(false);

  let input: HTMLInputElement;

  const progCtx = $derived({ base, bits, signed });

  // 입력하는 동안 바로 보여주는 결과
  const live = $derived.by((): { dec?: Dec; big?: bigint; shown: string; plain: string } | null => {
    if (!expr.trim()) return null;
    try {
      if (mode === 'prog') {
        const v = evaluateProg(expr, progCtx);
        return { big: v, shown: formatBase(v, base, progCtx), plain: formatBase(v, base, progCtx, false) };
      }
      const v = evaluate(expr, { angle, ans });
      return { dec: v, shown: formatNumber(v), plain: toPlain(v) };
    } catch {
      return null;
    }
  });

  const progValue = $derived(live?.big ?? 0n);
  const isBareNumber = $derived(
    !!live && expr.replace(/[\s,]/g, '').replace('−', '-').toUpperCase() === live.plain.toUpperCase(),
  );
  const showPreview = $derived(!!live && !isBareNumber && !error);

  onMount(() => {
    const s = load<Record<string, unknown>>(SETTINGS, {});
    if (s.mode === 'basic' || s.mode === 'sci' || s.mode === 'prog') mode = s.mode;
    if (s.angle === 'deg' || s.angle === 'rad') angle = s.angle;
    if ([2, 8, 10, 16].includes(s.base as number)) base = s.base as Base;
    if ([8, 16, 32, 64].includes(s.bits as number)) bits = s.bits as WordSize;
    if (typeof s.signed === 'boolean') signed = s.signed;
    if (typeof s.memory === 'string') {
      try {
        memory = new Decimal(s.memory);
      } catch {}
    }
    history = load<HistoryItem[]>(HISTORY, []).slice(0, 200);
    ready = true;
    input?.focus();
  });

  $effect(() => {
    const snapshot = { mode, angle, base, bits, signed, memory: memory ? memory.toString() : null };
    if (ready) save(SETTINGS, snapshot);
  });
  $effect(() => {
    const snapshot = $state.snapshot(history);
    if (ready) save(HISTORY, snapshot);
  });

  function setCaret(pos: number) {
    tick().then(() => {
      input?.setSelectionRange(pos, pos);
      // 긴 수식에서 캐럿이 보이도록
      if (input && pos >= expr.length) input.scrollLeft = input.scrollWidth;
    });
  }

  const startsOperand = (text: string) => /^[0-9.A-Za-z(π√∛~]/.test(text) && !/^(mod|and|or|xor)\b/i.test(text.trim());

  function insert(text: string) {
    error = '';
    let s = input?.selectionStart ?? expr.length;
    let e = input?.selectionEnd ?? expr.length;
    if (justEvaluated) {
      justEvaluated = false;
      // 결과가 나온 뒤 숫자를 누르면 새 계산, 연산자를 누르면 이어서 계산
      if (startsOperand(text)) {
        expr = '';
        prevLine = '';
      }
      s = e = expr.length;
    }
    expr = expr.slice(0, s) + text + expr.slice(e);
    setCaret(s + text.length);
  }

  function backspace() {
    error = '';
    justEvaluated = false;
    let s = input?.selectionStart ?? expr.length;
    const e = input?.selectionEnd ?? expr.length;
    if (s === e) {
      if (s === 0) return;
      // sin( 같은 토큰은 한 번에 지운다
      const m = /([A-Za-z]+\(|\s(?:AND|OR|XOR|MOD|mod)\s|[A-Za-z]{2,}|<<|>>)$/.exec(expr.slice(0, s));
      s -= m ? m[0].length : 1;
    }
    expr = expr.slice(0, s) + expr.slice(e);
    setCaret(s);
  }

  function clearAll() {
    expr = '';
    prevLine = '';
    error = '';
    justEvaluated = false;
    setCaret(0);
  }

  function equals() {
    if (!expr.trim()) return;
    try {
      let plain: string;
      let shown: string;
      if (mode === 'prog') {
        const v = evaluateProg(expr, progCtx);
        plain = formatBase(v, base, progCtx, false);
        shown = `${formatBase(v, base, progCtx)}${base === 10 ? '' : ` (${base}진)`}`;
      } else {
        const v = evaluate(expr, { angle, ans });
        ans = v;
        plain = toPlain(v);
        shown = formatNumber(v);
      }
      const entered = expr.trim();
      if (entered.replace('−', '-') !== plain) {
        history = [{ expr: entered, plain, shown, mode }, ...history].slice(0, 200);
        prevLine = `${entered} =`;
      }
      expr = plain.replace(/^-/, '−');
      error = '';
      justEvaluated = true;
      setCaret(expr.length);
    } catch (e) {
      error = e instanceof CalcError ? e.message : '계산할 수 없습니다';
    }
  }

  function negate() {
    error = '';
    justEvaluated = false;
    const t = expr.trim();
    if (!t) return insert('−');
    if (/^[−-]\(.*\)$/.test(t)) expr = t.slice(2, -1);
    else if (/^[−-][0-9.,A-Fa-f]+$/.test(t)) expr = t.slice(1);
    else if (/^[0-9.,A-Fa-f]+$/.test(t)) expr = '−' + t;
    else expr = `−(${t})`;
    setCaret(expr.length);
  }

  function reciprocal() {
    const t = expr.trim();
    justEvaluated = false;
    if (!t) return insert('1÷');
    expr = `1÷(${t})`;
    setCaret(expr.length);
  }

  function currentValue(): Dec | null {
    if (mode === 'prog') return live?.big != null ? new Decimal(live.big.toString()) : null;
    return live?.dec ?? null;
  }

  function memAdd(sign: 1 | -1) {
    const v = currentValue();
    if (!v) return;
    memory = (memory ?? new Decimal(0)).plus(sign === 1 ? v : v.neg());
  }
  function memRecall() {
    if (!memory) return;
    if (mode === 'prog') {
      if (!memory.isInteger()) return;
      insert(formatBase(BigInt(memory.toFixed(0)), base, progCtx, false));
    } else insert(toPlain(memory).replace(/^-/, '−'));
  }

  function setMode(m: Mode) {
    if (m === mode) return;
    mode = m;
    second = false;
    clearAll();
    input?.focus();
  }

  function setBase(b: Base) {
    if (b === base) return;
    // 값이 있으면 새 진법으로 옮겨 적는다
    const v = live?.big;
    base = b;
    error = '';
    expr = v != null ? formatBase(v, b, { bits, signed }, false).replace(/^-/, '−') : '';
    prevLine = '';
    justEvaluated = false;
    setCaret(expr.length);
  }

  function toggleBit(i: number) {
    const v = BigInt.asUintN(bits, progValue) ^ (1n << BigInt(i));
    expr = formatBase(wrap(v, { bits, signed }), base, { bits, signed }, false).replace(/^-/, '−');
    error = '';
    prevLine = '';
    justEvaluated = false;
    setCaret(expr.length);
  }

  async function copyResult() {
    const text = live?.plain ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1200);
    } catch {}
  }

  function useHistory(h: HistoryItem, what: 'expr' | 'result') {
    if (h.mode !== mode && (h.mode === 'prog' || mode === 'prog')) setMode(h.mode);
    if (what === 'expr') {
      expr = h.expr;
      prevLine = '';
      error = '';
      justEvaluated = false;
      setCaret(expr.length);
    } else insert(h.plain.replace(/^-/, '−'));
    historyOpen = false;
    input?.focus();
  }

  // ── 키보드 ──
  function onBeforeInput(e: InputEvent) {
    if (justEvaluated && e.inputType === 'insertText' && e.data) {
      justEvaluated = false;
      if (startsOperand(e.data)) {
        input.value = '';
        prevLine = '';
      } else input.setSelectionRange(input.value.length, input.value.length);
    } else if (justEvaluated) justEvaluated = false;
  }

  function onInput() {
    error = '';
    const pos = input.selectionStart ?? input.value.length;
    let v = input.value.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
    if (mode === 'prog') v = v.toUpperCase();
    expr = v;
    if (v !== input.value) setCaret(pos);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || (e.key === '=' && !e.shiftKey)) {
      e.preventDefault();
      equals();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (historyOpen) historyOpen = false;
      else clearAll();
    }
  }

  function onWindowKeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t === input || e.metaKey || e.ctrlKey || e.altKey) return;
    if (t.closest('input, textarea, select')) return;
    if (e.key.length === 1 || e.key === 'Backspace') input?.focus();
    else if (e.key === 'Enter' && !t.closest('button')) {
      e.preventDefault();
      equals();
    } else if (e.key === 'Escape') {
      historyOpen = false;
      clearAll();
    }
  }

  // ── 키패드 정의 ──
  const K = (label: string, ins: string = label, kind: Key['kind'] = 'num', aria?: string): Key => ({ label, ins, kind, aria });

  const basicKeys = $derived<Key[]>([
    { label: 'AC', act: clearAll, kind: 'util', aria: '모두 지우기' },
    { label: '⌫', act: backspace, kind: 'util', aria: '한 글자 지우기' },
    K('%', '%', 'util', '퍼센트'),
    K('÷', '÷', 'op', '나누기'),
    K('7'), K('8'), K('9'),
    K('×', '×', 'op', '곱하기'),
    K('4'), K('5'), K('6'),
    K('−', '−', 'op', '빼기'),
    K('1'), K('2'), K('3'),
    K('+', '+', 'op', '더하기'),
    { label: '±', act: negate, kind: 'num', aria: '부호 바꾸기' },
    K('0'), K('.', '.', 'num', '소수점'),
    { label: '=', act: equals, kind: 'eq', aria: '계산' },
  ]);

  const sciKeys = $derived<Key[]>([
    { label: '2nd', act: () => (second = !second), kind: 'fn', active: second, aria: '보조 기능' },
    { label: angle === 'deg' ? 'DEG' : 'RAD', act: () => (angle = angle === 'deg' ? 'rad' : 'deg'), kind: 'fn', aria: '각도 단위 전환' },
    K('π', 'π', 'fn', '파이'),
    K('e', 'e', 'fn', '자연상수'),
    K('Ans', 'Ans', 'fn', '이전 결과'),
    second ? K('sin⁻¹', 'asin(', 'fn') : K('sin', 'sin(', 'fn'),
    second ? K('cos⁻¹', 'acos(', 'fn') : K('cos', 'cos(', 'fn'),
    second ? K('tan⁻¹', 'atan(', 'fn') : K('tan', 'tan(', 'fn'),
    K('(', '(', 'fn'), K(')', ')', 'fn'),
    second ? K('x³', '³', 'fn') : K('x²', '²', 'fn'),
    K('xʸ', '^', 'fn', '거듭제곱'),
    second ? K('∛', '∛(', 'fn', '세제곱근') : K('√', '√(', 'fn', '제곱근'),
    second ? K('ʸ√x', 'root(', 'fn', 'y 제곱근: root(x, y)') : K('n!', '!', 'fn', '팩토리얼'),
    { label: '1/x', act: reciprocal, kind: 'fn', aria: '역수' },
    second ? K('eˣ', 'e^', 'fn') : K('ln', 'ln(', 'fn'),
    second ? K('10ˣ', '10^', 'fn') : K('log', 'log(', 'fn'),
    second ? K('log₂', 'log2(', 'fn') : K('|x|', 'abs(', 'fn', '절댓값'),
    second ? K('nCr', 'nCr(', 'fn', '조합: nCr(n, r)') : K('mod', ' mod ', 'fn', '나머지'),
    second ? K(',', ', ', 'fn', '인자 구분') : K('EE', 'e', 'fn', '10의 거듭제곱 표기'),
  ]);

  const hexOk = (d: string) => '0123456789ABCDEF'.indexOf(d) < base;
  const D = (d: string): Key => ({ label: d, ins: d, kind: 'num', disabled: !hexOk(d) });

  const progKeys = $derived<Key[]>([
    K('AND', ' AND ', 'fn'), D('A'), K('<<', '<<', 'fn', '왼쪽 시프트'), K('>>', '>>', 'fn', '오른쪽 시프트'),
    { label: 'AC', act: clearAll, kind: 'util', aria: '모두 지우기' },
    { label: '⌫', act: backspace, kind: 'util', aria: '한 글자 지우기' },
    K('OR', ' OR ', 'fn'), D('B'), K('(', '(', 'fn'), K(')', ')', 'fn'), K('MOD', ' MOD ', 'fn', '나머지'), K('÷', '÷', 'op', '나누기'),
    K('XOR', ' XOR ', 'fn'), D('C'), D('7'), D('8'), D('9'), K('×', '×', 'op', '곱하기'),
    K('NOT', '~', 'fn', '비트 반전'), D('D'), D('4'), D('5'), D('6'), K('−', '−', 'op', '빼기'),
    { label: '±', act: negate, kind: 'fn', aria: '부호 바꾸기' }, D('E'), D('1'), D('2'), D('3'), K('+', '+', 'op', '더하기'),
    K('00', '00', 'fn'), D('F'), { ...D('0'), span: 2 },
    { label: '=', act: equals, kind: 'eq', aria: '계산', span: 2 },
  ]);

  const baseRows: { b: Base; name: string }[] = [
    { b: 16, name: 'HEX' },
    { b: 10, name: 'DEC' },
    { b: 8, name: 'OCT' },
    { b: 2, name: 'BIN' },
  ];

  const bitRows = $derived.by(() => {
    const u = BigInt.asUintN(64, progValue);
    const rows: { i: number; on: boolean; enabled: boolean }[][] = [];
    for (let r = 3; r >= 0; r--) {
      const row = [];
      for (let c = 15; c >= 0; c--) {
        const i = r * 16 + c;
        row.push({ i, on: ((u >> BigInt(i)) & 1n) === 1n, enabled: i < bits });
      }
      rows.push(row);
    }
    return bits <= 16 ? rows.slice(3) : bits === 32 ? rows.slice(2) : rows;
  });

  function press(k: Key) {
    if (k.act) k.act();
    else if (k.ins != null) insert(k.ins);
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet keyButton(k: Key)}
  <button
    class="key {k.kind ?? 'num'}"
    class:active={k.active}
    style:grid-column={k.span ? `span ${k.span}` : undefined}
    disabled={k.disabled}
    aria-label={k.aria ?? k.label}
    aria-pressed={k.active}
    title={k.aria}
    onpointerdown={(e) => e.preventDefault()}
    onclick={() => press(k)}
  >{k.label}</button>
{/snippet}

<ToolShell tool="calculator">
  {#snippet actions()}
    <button class="btn ghost sm history-toggle" onclick={() => (historyOpen = !historyOpen)} aria-expanded={historyOpen}>
      기록{history.length ? ` ${history.length}` : ''}
    </button>
  {/snippet}

  <div class="page">
    <section class="calc" class:wide={mode === 'sci'} class:prog={mode === 'prog'} aria-label="계산기">
      <div class="topbar">
        <div class="seg" role="tablist" aria-label="계산기 모드">
          <button role="tab" aria-selected={mode === 'basic'} onclick={() => setMode('basic')}>일반</button>
          <button role="tab" aria-selected={mode === 'sci'} onclick={() => setMode('sci')}>공학</button>
          <button role="tab" aria-selected={mode === 'prog'} onclick={() => setMode('prog')}>프로그래머</button>
        </div>
        {#if mode === 'prog'}
          <div class="prog-opts">
            <select class="field mini" bind:value={bits} aria-label="워드 크기">
              <option value={8}>8비트</option>
              <option value={16}>16비트</option>
              <option value={32}>32비트</option>
              <option value={64}>64비트</option>
            </select>
            <button class="btn sm" aria-pressed={signed} onclick={() => (signed = !signed)} title="부호 있는 정수(2의 보수)로 해석">
              {signed ? '부호 있음' : '부호 없음'}
            </button>
          </div>
        {:else if mode === 'sci'}
          <span class="angle-chip" aria-live="polite">{angle === 'deg' ? '각도: 도(°)' : '각도: 라디안'}</span>
        {/if}
      </div>

      <div class="display" class:has-error={!!error}>
        <div class="status">
          {#if memory}<span class="chip" title="메모리에 저장된 값">M = {formatNumber(memory, { digits: 10 })}</span>{/if}
          <span class="prev">{prevLine}</span>
        </div>
        <input
          bind:this={input}
          class="expr"
          class:long={expr.length > 16}
          class:xlong={expr.length > 28}
          type="text"
          value={expr}
          inputmode="none"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          aria-label="수식"
          placeholder="0"
          onbeforeinput={onBeforeInput}
          oninput={onInput}
          onkeydown={onKeydown}
        />
        <div class="result" aria-live="polite">
          {#if error}
            <span class="err">{error}</span>
          {:else if showPreview && live}
            <span class="eq">=</span>
            <span class="val">{live.shown}</span>
          {:else}
            <span class="hint">{expr ? ' ' : mode === 'prog' ? '0xFF, 0b1010 접두사를 쓸 수 있어요' : '키보드로 수식을 바로 입력할 수 있어요'}</span>
          {/if}
          {#if live && !error}
            <button class="copy" onclick={copyResult} onpointerdown={(e) => e.preventDefault()} aria-label="결과 복사">
              {copied ? '복사됨' : '복사'}
            </button>
          {/if}
        </div>
      </div>

      {#if mode === 'prog'}
        <div class="bases">
          {#each baseRows as row (row.b)}
            <button class="base-row" aria-pressed={base === row.b} onclick={() => setBase(row.b)} onpointerdown={(e) => e.preventDefault()}>
              <span class="base-name">{row.name}</span>
              <span class="base-val">{formatBase(progValue, row.b, progCtx)}</span>
            </button>
          {/each}
        </div>
        <div class="bits" aria-label="비트 편집">
          {#each bitRows as row, r (r)}
            <div class="bit-row">
              {#each row as bit (bit.i)}
                <button
                  class="bit"
                  class:on={bit.on}
                  class:gap={bit.i % 4 === 0 && bit.i % 16 !== 0}
                  disabled={!bit.enabled}
                  aria-label="비트 {bit.i}"
                  aria-pressed={bit.on}
                  onpointerdown={(e) => e.preventDefault()}
                  onclick={() => toggleBit(bit.i)}
                >{bit.on ? 1 : 0}</button>
              {/each}
              <span class="bit-idx">{row[row.length - 1].i}</span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="memory" aria-label="메모리">
        <button class="mkey" disabled={!memory} onclick={() => (memory = null)} onpointerdown={(e) => e.preventDefault()} title="메모리 지우기">MC</button>
        <button class="mkey" disabled={!memory} onclick={memRecall} onpointerdown={(e) => e.preventDefault()} title="메모리 값 불러오기">MR</button>
        <button class="mkey" disabled={!live} onclick={() => memAdd(1)} onpointerdown={(e) => e.preventDefault()} title="현재 값을 메모리에 더하기">M+</button>
        <button class="mkey" disabled={!live} onclick={() => memAdd(-1)} onpointerdown={(e) => e.preventDefault()} title="현재 값을 메모리에서 빼기">M−</button>
        {#if mode === 'basic'}
          <button class="mkey" onclick={() => insert('(')} onpointerdown={(e) => e.preventDefault()} aria-label="여는 괄호">(</button>
          <button class="mkey" onclick={() => insert(')')} onpointerdown={(e) => e.preventDefault()} aria-label="닫는 괄호">)</button>
        {/if}
      </div>

      <div class="pads">
        {#if mode === 'sci'}
          <div class="pad sci">
            {#each sciKeys as k (k.label)}{@render keyButton(k)}{/each}
          </div>
        {/if}
        {#if mode === 'prog'}
          <div class="pad progpad">
            {#each progKeys as k (k.label)}{@render keyButton(k)}{/each}
          </div>
        {:else}
          <div class="pad basic">
            {#each basicKeys as k (k.label)}{@render keyButton(k)}{/each}
          </div>
        {/if}
      </div>
    </section>

    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div class="scrim" class:open={historyOpen} onclick={() => (historyOpen = false)}></div>
    <aside class="history" class:open={historyOpen} aria-label="계산 기록">
      <div class="history-head">
        <h2>기록</h2>
        <button class="btn ghost sm" disabled={!history.length} onclick={() => (history = [])}>모두 지우기</button>
        <button class="btn ghost sm close" onclick={() => (historyOpen = false)} aria-label="기록 닫기">닫기</button>
      </div>
      {#if history.length === 0}
        <p class="empty">계산한 내용이 여기에 쌓입니다.<br />항목을 누르면 다시 쓸 수 있어요.</p>
      {:else}
        <ol>
          {#each history as h, i (i)}
            <li>
              <button class="h-expr" onclick={() => useHistory(h, 'expr')} title="수식 다시 쓰기">{h.expr}</button>
              <button class="h-res" onclick={() => useHistory(h, 'result')} title="결과 넣기">= {h.shown}</button>
            </li>
          {/each}
        </ol>
      {/if}
    </aside>
  </div>
</ToolShell>

<style>
  .page {
    flex: 1;
    min-height: 0;
    display: flex;
    justify-content: center;
    gap: 16px;
    padding: 20px 16px;
    overflow: auto;
  }
  .calc {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    max-width: 400px;
    align-self: flex-start;
    padding: 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 18px;
    box-shadow: var(--shadow-md);
  }
  .calc.wide {
    max-width: 760px;
  }
  .calc.prog {
    max-width: 560px;
  }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .prog-opts {
    display: flex;
    gap: 6px;
  }
  .field.mini {
    height: 28px;
    font-size: 12.5px;
    padding: 0 6px;
  }
  .angle-chip {
    font-size: 12px;
    color: var(--muted);
  }

  .display {
    display: flex;
    flex-direction: column;
    padding: 10px 14px 8px;
    border-radius: 12px;
    background: var(--surface-2);
    border: 1px solid transparent;
    min-width: 0;
  }
  .display:focus-within {
    border-color: var(--app-line);
  }
  .display.has-error {
    border-color: var(--bad);
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 20px;
    font-size: 12.5px;
    color: var(--faint);
  }
  .chip {
    flex: none;
    padding: 0 7px;
    border-radius: 99px;
    background: var(--app-soft);
    color: var(--app);
    font-weight: 650;
    font-size: 11.5px;
    line-height: 18px;
    font-variant-numeric: tabular-nums;
  }
  .prev {
    margin-left: auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    direction: rtl;
    unicode-bidi: plaintext;
    font-variant-numeric: tabular-nums;
  }
  .expr {
    width: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    text-align: right;
    font-size: 38px;
    font-weight: 500;
    letter-spacing: -0.02em;
    line-height: 1.25;
    padding: 2px 0;
    font-variant-numeric: tabular-nums;
    caret-color: var(--app);
  }
  .expr.long {
    font-size: 28px;
  }
  .expr.xlong {
    font-size: 21px;
  }
  .expr::placeholder {
    color: var(--faint);
  }
  .result {
    display: flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: 6px;
    min-height: 26px;
    font-size: 17px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .val {
    overflow-wrap: anywhere;
    text-align: right;
  }
  .eq {
    color: var(--faint);
  }
  .hint {
    font-size: 12px;
    color: var(--faint);
    margin-right: auto;
  }
  .err {
    color: var(--bad);
    font-size: 13.5px;
    font-weight: 600;
    margin-right: auto;
  }
  .copy {
    flex: none;
    border: 0;
    background: transparent;
    color: var(--app);
    font-size: 12px;
    font-weight: 650;
    padding: 2px 6px;
    border-radius: 6px;
  }
  .copy:hover {
    background: var(--app-soft);
  }

  .bases {
    display: grid;
    gap: 2px;
  }
  .base-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 3px 10px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    text-align: left;
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--muted);
  }
  .base-row:hover {
    background: var(--surface-2);
  }
  .base-row[aria-pressed='true'] {
    background: var(--app-soft);
    color: var(--text);
  }
  .base-name {
    flex: none;
    width: 30px;
    font-weight: 700;
    font-size: 11px;
    color: var(--faint);
  }
  .base-row[aria-pressed='true'] .base-name {
    color: var(--app);
  }
  .base-val {
    overflow-wrap: anywhere;
    min-width: 0;
  }
  .bits {
    display: grid;
    gap: 3px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--surface-2);
    overflow-x: auto;
  }
  .bit-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 1px;
  }
  .bit {
    width: 22px;
    height: 22px;
    flex: none;
    border: 0;
    border-radius: 5px;
    background: transparent;
    font-family: var(--mono);
    font-size: 13px;
    color: var(--faint);
    padding: 0;
  }
  .bit.gap {
    margin-right: 8px;
  }
  .bit.on {
    color: var(--app);
    font-weight: 700;
    background: var(--app-soft);
  }
  .bit:hover:not(:disabled) {
    background: var(--surface-3);
  }
  .bit:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .bit-idx {
    width: 22px;
    text-align: right;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--faint);
  }

  .memory {
    display: flex;
    gap: 6px;
  }
  .mkey {
    flex: 1;
    height: 30px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    font-size: 12.5px;
    font-weight: 650;
    color: var(--muted);
  }
  .mkey:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }
  .mkey:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .pads {
    display: flex;
    gap: 10px;
  }
  .pad {
    display: grid;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }
  .pad.basic {
    grid-template-columns: repeat(4, 1fr);
  }
  .pad.sci {
    grid-template-columns: repeat(5, 1fr);
    flex: 1.15;
    grid-auto-rows: 1fr;
  }
  .pad.progpad {
    grid-template-columns: repeat(6, 1fr);
  }
  .key {
    height: 54px;
    min-width: 0;
    border: 0;
    border-radius: 12px;
    background: var(--surface-2);
    font-size: 20px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    transition: background 0.08s, transform 0.08s;
    user-select: none;
    touch-action: manipulation;
  }
  .key:hover:not(:disabled) {
    background: var(--surface-3);
  }
  .key:active:not(:disabled) {
    transform: scale(0.96);
    background: var(--border-strong);
  }
  .key:disabled {
    opacity: 0.28;
    cursor: default;
  }
  .key.util {
    background: var(--surface-3);
    font-size: 17px;
    font-weight: 600;
  }
  .key.util:hover {
    background: var(--border-strong);
  }
  .key.op {
    background: var(--app-soft);
    color: var(--app);
    font-size: 24px;
  }
  .key.op:hover {
    background: color-mix(in srgb, var(--app) 22%, var(--surface));
  }
  .key.fn {
    background: transparent;
    border: 1px solid var(--border);
    font-size: 15px;
    color: var(--muted);
  }
  .key.fn:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }
  .key.fn.active {
    background: var(--app);
    border-color: var(--app);
    color: var(--on-app);
  }
  .key.eq {
    background: var(--app);
    color: var(--on-app);
    font-size: 26px;
  }
  .key.eq:hover {
    background: color-mix(in srgb, var(--app) 88%, #000);
  }
  .progpad .key {
    height: 46px;
    font-size: 17px;
  }
  .progpad .key.fn {
    font-size: 13px;
    font-weight: 650;
  }

  /* 기록 */
  .history {
    display: flex;
    flex-direction: column;
    width: 300px;
    flex: none;
    align-self: stretch;
    max-height: 640px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 18px;
    overflow: hidden;
  }
  .history-head {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px 10px 8px 16px;
    border-bottom: 1px solid var(--border);
  }
  .history-head h2 {
    font-size: 14px;
    margin-right: auto;
  }
  .history .close,
  .history-toggle,
  .scrim {
    display: none;
  }
  .empty {
    padding: 28px 18px;
    color: var(--faint);
    font-size: 13px;
    text-align: center;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 6px;
    overflow: auto;
    flex: 1;
  }
  li {
    display: grid;
    padding: 4px 0;
    border-bottom: 1px solid var(--border);
  }
  li:last-child {
    border-bottom: 0;
  }
  .h-expr,
  .h-res {
    border: 0;
    background: transparent;
    text-align: right;
    padding: 3px 10px;
    border-radius: 7px;
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
  }
  .h-expr {
    font-size: 12.5px;
    color: var(--muted);
  }
  .h-res {
    font-size: 16px;
    font-weight: 600;
  }
  .h-expr:hover,
  .h-res:hover {
    background: var(--surface-2);
  }

  @media (max-width: 1080px) {
    .history-toggle {
      display: inline-flex;
    }
    .history {
      position: fixed;
      z-index: 20;
      top: 0;
      right: 0;
      bottom: 0;
      max-height: none;
      width: min(340px, 92vw);
      border-radius: 0;
      border-width: 0 0 0 1px;
      transform: translateX(100%);
      transition: transform 0.2s ease;
      box-shadow: var(--shadow-lg);
      visibility: hidden;
    }
    .history.open {
      transform: none;
      visibility: visible;
    }
    .history .close {
      display: inline-flex;
    }
    .scrim.open {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 19;
      background: rgb(0 0 0 / 0.35);
    }
  }

  @media (max-width: 720px) {
    .page {
      padding: 0;
    }
    .calc,
    .calc.wide,
    .calc.prog {
      max-width: none;
      align-self: stretch;
      border: 0;
      border-radius: 0;
      box-shadow: none;
      padding: 10px 10px max(10px, env(safe-area-inset-bottom));
      gap: 8px;
    }
    .display {
      flex: 1;
      justify-content: flex-end;
      min-height: 110px;
    }
    .pads {
      flex-direction: column;
      gap: 6px;
    }
    .pad.sci .key {
      height: 36px;
      font-size: 13.5px;
      border-radius: 9px;
    }
    .key {
      height: clamp(44px, 8.2dvh, 64px);
    }
    .progpad .key {
      height: clamp(40px, 6.4dvh, 52px);
    }
    .bit {
      width: 19px;
      height: 20px;
      font-size: 12px;
    }
    .bit.gap {
      margin-right: 4px;
    }
    .bit-idx {
      display: none;
    }
  }
</style>
