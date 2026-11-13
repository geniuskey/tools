<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import { load, save } from '$lib/storage';
  import { toDay } from '$lib/date/core';
  import { defaultRules, offOf } from '$lib/date/work';
  import { CITIES, cityName, fmtOffset, isZone, wallOf } from '$lib/date/zones';
  import { DIALECTS, FIELD_NAME, WEEKDAY_KO, findRuns, parse, type Dialect, type Run, type Token } from '$lib/cron/core';
  import { clock, describe, rows, whyNever } from '$lib/cron/explain';
  import { EVERY, convert, defaultPlan, planOf, planText, snippets, type Every, type MonthMode, type Plan, type Snippet } from '$lib/cron/format';

  const KEY = 'tools:cron:v1';
  const MAX_RUNS = 100;
  type Want = Dialect | 'auto';
  type Tab = 'formats' | Snippet['id'];

  const EXAMPLES: [string, string][] = [
    ['평일 오전 9시', '0 9 * * 1-5'],
    ['15분마다', '*/15 * * * *'],
    ['매일 자정', '0 0 * * *'],
    ['업무 시간 매시 정각', '0 9-18 * * 1-5'],
    ['매주 월요일 오전 10시', '0 10 * * 1'],
    ['매달 1일 오전 9시', '0 9 1 * *'],
    ['매달 마지막 금요일 (Quartz)', '0 30 18 ? * 6L'],
    ['Spring: 30초마다', '*/30 * * * * *'],
    ['AWS: 평일 오전 9시', 'cron(0 0 ? * MON-FRI *)'],
    ['GitHub Actions', "- cron: '30 23 * * 0-4'"],
    ['함정: 13일 또는 금요일', '0 0 13 * 5'],
    ['함정: 45분마다?', '*/45 * * * *'],
  ];

  let ready = $state(false);
  let toast = $state('');
  let now = $state(Date.now());
  const myZone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
    } catch {
      return 'Asia/Seoul';
    }
  })();

  let expr = $state('0 9 * * 1-5');
  let want = $state<Want>('auto');
  let zone = $state('Asia/Seoul');
  let count = $state(10);
  let tab = $state<Tab>('formats');
  let caret = $state<number | null>(null);
  let inputEl = $state<HTMLTextAreaElement>();

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

  const n = (v: number) => v.toLocaleString('ko-KR');
  const p2 = (v: number) => String(v).padStart(2, '0');

  // ── 읽기 ──
  const parsed = $derived(parse(expr, want));
  const spec = $derived(parsed.spec);
  const sentence = $derived(spec ? describe(spec) : '');
  const fieldRows = $derived(spec ? rows(spec) : []);
  /** 다른 형식으로 읽으면 뜻이 달라질 때만 알려 준다 (Quartz 6L = 금요일, Spring 6L = 토요일) */
  const others = $derived(
    parsed.alternatives
      .map((d) => {
        const o = parse(expr, d).spec;
        return { d, text: o ? describe(o) + (o.command ? ` (명령 ${o.command.text})` : '') : '' };
      })
      .filter((o) => o.text && o.text !== sentence),
  );
  const dialectName = (d: Dialect) => DIALECTS.find((x) => x.id === d)!.name;
  const hasSec = $derived(!!spec && (spec.sec.length > 1 || spec.sec[0] !== 0));
  /** 식이 정한 시간대가 먼저다 */
  const tz = $derived(spec?.tz && isZone(spec.tz.name) ? spec.tz.name : zone);

  /** 커서가 가리키는 칸 */
  const active = $derived.by(() => {
    if (caret == null) return -1;
    return parsed.tokens.findIndex((t) => caret! >= t.start && caret! <= t.end);
  });
  const activeKey = $derived(active >= 0 ? parsed.tokens[active].key : null);
  function trackCaret() {
    const el = inputEl;
    if (!el || document.activeElement !== el) return;
    caret = el.selectionStart === el.selectionEnd ? el.selectionStart : el.selectionStart;
  }
  async function pick(t: Token) {
    if (!inputEl) return;
    inputEl.focus();
    inputEl.setSelectionRange(t.start, t.end);
    caret = t.start;
    await tick();
  }

  // ── 다음 실행 ──
  const search = $derived(spec && !spec.special ? findRuns(spec, tz, now, count) : null);
  const prev = $derived(spec && !spec.special ? findRuns(spec, tz, now, 1, -1).runs[0] ?? null : null);

  function fmtRel(ms: number): string {
    const a = Math.abs(ms);
    const after = ms > 0;
    const sfx = after ? '뒤' : '전';
    if (a < 60_000) return after ? `${Math.max(1, Math.round(a / 1000))}초 뒤` : '방금';
    const min = Math.floor(a / 60_000);
    if (min < 60) return `${min}분 ${sfx}`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}시간${min % 60 && h < 6 ? ` ${min % 60}분` : ''} ${sfx}`;
    const d = Math.floor(h / 24);
    if (d < 60) return `${d}일 ${sfx}`;
    if (d < 730) return `${Math.floor(d / 30.44)}개월 ${sfx}`;
    return `${Math.floor(d / 365.25)}년 ${sfx}`;
  }
  function whenText(utc: number, z: string) {
    const w = wallOf(z, utc);
    const s = ((Math.floor(utc / 1000) % 60) + 60) % 60;
    const nowY = wallOf(z, now).y;
    return {
      date: `${w.y !== nowY ? `${w.y}년 ` : ''}${w.m}월 ${w.d}일 (${WEEKDAY_KO[w.wd]})`,
      time: `${w.h < 12 ? '오전' : '오후'} ${w.h % 12 || 12}:${p2(w.mi)}${hasSec ? `:${p2(s)}` : ''}`,
      w,
    };
  }
  /** 쉬는 날은 한국 날짜로 본다 */
  function offText(utc: number): { name: string; holiday: boolean } | null {
    const k = wallOf('Asia/Seoul', utc);
    const off = offOf(toDay(k.y, k.m, k.d), defaultRules);
    return off ? { name: off.name, holiday: off.kind !== 'weekend' } : null;
  }
  function dstText(r: Run): string {
    const at = `${r.planned.h}:${p2(r.planned.mi)}`;
    if (r.dst === 'gap') return `서머타임이 시작되는 날이라 ${at} 이 없습니다 — 밀려서 이 시각에 돕니다`;
    if (r.dst === 'overlap') return `서머타임이 끝나는 날이라 ${at} 이 두 번 옵니다 — 처음 한 번만 돕니다`;
    return '';
  }
  const zoneHasDst = $derived.by(() => {
    const y = new Date(now).getUTCFullYear();
    return wallOf(tz, Date.UTC(y, 0, 15)).offset !== wallOf(tz, Date.UTC(y, 6, 15)).offset;
  });
  const zoneOffset = $derived(wallOf(tz, now).offset);
  const zones = $derived.by(() => {
    const list = CITIES.map((c) => ({ tz: c.tz, name: c.name }));
    for (const z of [zone, myZone, spec?.tz?.name]) if (z && isZone(z) && !list.some((c) => c.tz === z)) list.unshift({ tz: z, name: cityName(z) });
    return list;
  });
  /** 내 시간대로도 보여 줄지 */
  const showMine = $derived(myZone !== tz && wallOf(myZone, now).offset !== zoneOffset);

  // ── 형식 바꾸기 · 붙여 넣기 ──
  const formats = $derived(spec ? (['unix', 'spring', 'quartz', 'aws'] as Dialect[]).map((d) => ({ d, out: convert(spec, d) })) : []);
  const snips = $derived(spec && !spec.special ? snippets(spec, tz, now) : []);
  const snip = $derived(snips.find((s) => s.id === tab));
  const TABS: [Tab, string][] = [
    ['formats', '형식'],
    ['crontab', 'crontab'],
    ['github', 'GitHub'],
    ['k8s', 'Kubernetes'],
    ['spring', 'Spring'],
    ['aws', 'AWS'],
  ];

  function useFormat(d: Dialect, text: string) {
    expr = text;
    want = 'auto';
    if (parse(text).dialect !== d) want = d;
  }

  // ── 빌더 ──
  let plan = $state<Plan>({ ...defaultPlan, days: [...defaultPlan.days] });
  const fitsPlan = $derived(spec ? planOf(spec) : null);
  $effect(() => {
    const p = fitsPlan;
    if (p) untrack(() => (plan = p));
  });
  const planDialect = $derived<Dialect>(want !== 'auto' ? want : parsed.empty ? 'unix' : parsed.dialect);
  const planOut = $derived(planText(plan, planDialect));
  function setPlan(change: Partial<Plan>) {
    plan = { ...plan, ...change };
    const out = planText(plan, planDialect);
    if (out.text) {
      // 시간대 줄 · 명령은 그대로 둔다
      const before = spec?.tz ? `${spec.tz.kind}=${spec.tz.name} ` : '';
      const after = spec?.command && planDialect === 'unix' ? ` ${spec.command.text}` : '';
      expr = before + out.text + after;
      if (want === 'auto' && parse(expr).dialect !== planDialect) want = planDialect;
    }
  }
  const timeValue = $derived(`${p2(plan.hour)}:${p2(plan.minute)}`);
  function onTime(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    const m = /^(\d{2}):(\d{2})/.exec(v);
    if (m) setPlan({ hour: +m[1], minute: +m[2] });
  }
  const needsTime = $derived(!['minute', 'minutes', 'hourly', 'hours'].includes(plan.every));
  const MODES: [MonthMode, string][] = [
    ['day', '며칠'],
    ['last', '마지막 날'],
    ['lastWeekday', '마지막 평일'],
    ['nth', '몇째 요일'],
  ];
  const ORD: [number, string][] = [
    [1, '첫째'],
    [2, '둘째'],
    [3, '셋째'],
    [4, '넷째'],
    [5, '다섯째'],
    [0, '마지막'],
  ];

  function clampInt(v: string, lo: number, hi: number, fallback: number) {
    const x = Math.trunc(Number(v));
    return Number.isFinite(x) && x >= lo && x <= hi ? x : fallback;
  }

  // ── 저장 ──
  onMount(() => {
    const s = load<Record<string, any>>(KEY, {});
    if (typeof s.expr === 'string') expr = s.expr.slice(0, 2000);
    if (['auto', 'unix', 'spring', 'quartz', 'aws'].includes(s.want)) want = s.want;
    if (typeof s.zone === 'string' && isZone(s.zone)) zone = s.zone;
    if (Number.isInteger(s.count) && s.count >= 10 && s.count <= MAX_RUNS) count = s.count;
    if (TABS.some(([id]) => id === s.tab)) tab = s.tab;
    ready = true;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !t.closest('input, textarea, select, [contenteditable]')) {
        e.preventDefault();
        inputEl?.focus();
        inputEl?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    const sel = () => trackCaret();
    document.addEventListener('selectionchange', sel);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('selectionchange', sel);
    };
  });
  // 초 단위 식이면 1초마다, 아니면 가끔 시계를 맞춘다
  $effect(() => {
    const ms = hasSec ? 1000 : 15_000;
    const t = setInterval(() => (now = Date.now()), ms);
    return () => clearInterval(t);
  });
  $effect(() => {
    const snap = { expr, want, zone, count, tab };
    if (ready) save(KEY, snap);
  });

  const lines = $derived(Math.min(6, Math.max(1, expr.split('\n').length)));
  const firstError = $derived(parsed.errors[0]);
</script>

<ToolShell tool="cron">
  {#snippet actions()}
    <button class="btn sm" disabled={!expr.trim()} onclick={() => copy(expr.trim(), '식을')} title="식 복사">식 복사</button>
  {/snippet}

  <div class="cron">
    <div class="page">
      <div class="col">
        <section class="card" aria-labelledby="h-expr">
          <div class="head">
            <h2 id="h-expr">cron 식</h2>
            <div class="seg dialects" role="group" aria-label="형식">
              <button aria-pressed={want === 'auto'} onclick={() => (want = 'auto')}>자동</button>
              {#each DIALECTS as d (d.id)}
                <button aria-pressed={want === d.id} onclick={() => (want = d.id)} title={`${d.layout} — ${d.where}`}>{d.name}</button>
              {/each}
            </div>
          </div>
          <textarea
            class="field expr"
            bind:this={inputEl}
            bind:value={expr}
            rows={lines}
            aria-label="cron 식"
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            placeholder="0 9 * * 1-5"
            oninput={trackCaret}
            onfocus={trackCaret}
            onblur={() => (caret = null)}
          ></textarea>

          {#if parsed.tokens.length}
            <div class="ribbon" role="group" aria-label="칸">
              {#each parsed.tokens as t, i (i)}
                <button class="tok" class:on={i === active} class:bad={t.bad} class:aux={t.key === 'command' || t.key === 'tz' || t.key === 'wrap'} onclick={() => pick(t)} title={`${t.label}: ${t.text}`}>
                  <code>{t.text}</code>
                  <span>{t.label}</span>
                </button>
              {/each}
            </div>
          {/if}

          {#if parsed.empty}
            <p class="hint">cron 식을 적거나 붙여넣으세요. crontab 한 줄, GitHub Actions 의 <code>- cron:</code>, AWS 의 <code>cron(…)</code>, Spring 의 <code>@Scheduled</code> 도 그대로 됩니다. <kbd>/</kbd> 를 누르면 여기로 옵니다.</p>
          {:else if firstError}
            <div class="error" role="alert">
              <p><b>{firstError.field ? `${FIELD_NAME[firstError.field]} 칸: ` : ''}</b>{firstError.text}</p>
              {#if firstError.start != null && firstError.end != null}
                <pre class="mark" aria-hidden="true">{expr.slice(Math.max(0, firstError.start - 30), firstError.start)}<u>{expr.slice(firstError.start, Math.max(firstError.end, firstError.start + 1)) || ' '}</u>{expr.slice(Math.max(firstError.end, firstError.start + 1), firstError.end + 30)}</pre>
              {/if}
              {#if firstError.fix}<p class="fix">{firstError.fix}</p>{/if}
              {#if parsed.errors.length > 1}<p class="more">고칠 곳이 {parsed.errors.length - 1}군데 더 있습니다</p>{/if}
            </div>
          {:else if spec}
            <div class="result" aria-live="polite">
              <strong class="sentence">{sentence}</strong>
              <p class="sub">
                <span>{parsed.why}</span>
                {#if spec.tz}<span>시간대 {cityName(spec.tz.name)} ({spec.tz.kind})</span>{/if}
                {#if spec.command}<span>명령 <code>{spec.command.text}</code></span>{/if}
                {#if spec.macro?.expands}<span><code>{spec.macro.text}</code> = <code>{spec.macro.expands}</code></span>{/if}
              </p>
              {#if others.length}
                <p class="alt">
                  다르게 읽기:
                  {#each others as o (o.d)}
                    <button class="link" onclick={() => (want = o.d)}>{dialectName(o.d)} — {o.text}</button>
                  {/each}
                </p>
              {/if}
            </div>
          {/if}

          {#if spec?.warnings.length}
            <ul class="warns" aria-label="주의할 점">
              {#each spec.warnings as w, i (i)}
                <li>
                  <p>{w.text}</p>
                  {#if w.fix}<p class="fix">{w.fix}</p>{/if}
                </li>
              {/each}
            </ul>
          {/if}

          <div class="chips" role="group" aria-label="예시">
            {#each EXAMPLES as [label, e] (e)}
              <button aria-pressed={expr === e} onclick={() => ((expr = e), (want = 'auto'))} title={e}>{label}</button>
            {/each}
          </div>
        </section>

        {#if fieldRows.length}
          <section class="card" aria-labelledby="h-rows">
            <h2 id="h-rows">칸마다</h2>
            <ol class="rows">
              {#each fieldRows as r (r.key)}
                <li class:on={activeKey === r.key}>
                  <span class="k">{r.label}</span>
                  <button class="v" onclick={() => pick({ ...r, key: r.key })} title="식에서 이 칸 고르기"><code>{r.text}</code></button>
                  <span class="d">{r.desc}</span>
                </li>
              {/each}
            </ol>
            {#if spec && spec.join === 'or'}
              <p class="hint">일과 요일을 둘 다 정해서, 둘 중 하나만 맞아도 돕니다 (Unix cron 의 규칙).</p>
            {/if}
          </section>
        {/if}

        <section class="card" aria-labelledby="h-plan">
          <div class="head">
            <h2 id="h-plan">말로 만들기</h2>
            <span class="tag">{dialectName(planDialect)} 형식으로</span>
          </div>
          {#if spec && !fitsPlan}
            <p class="hint">지금 식은 여기서 고를 수 있는 모양이 아닙니다. 아래에서 고르면 새 식으로 바뀝니다.</p>
          {/if}
          <div class="chips" role="group" aria-label="얼마나 자주">
            {#each EVERY as [id, name] (id)}
              <button aria-pressed={fitsPlan != null && plan.every === id} onclick={() => setPlan({ every: id as Every })}>{name}</button>
            {/each}
          </div>
          <div class="plan">
            {#if plan.every === 'minutes'}
              <label class="f"><span>간격</span><span class="unit"><input class="field" type="number" min="1" max="59" value={plan.n} onchange={(e) => setPlan({ n: clampInt(e.currentTarget.value, 1, 59, 15) })} aria-label="몇 분마다" />분마다</span></label>
              <div class="chips" role="group" aria-label="자주 쓰는 간격">
                {#each [5, 10, 15, 20, 30] as v (v)}<button aria-pressed={plan.n === v} onclick={() => setPlan({ n: v })}>{v}분</button>{/each}
              </div>
            {:else if plan.every === 'hours'}
              <label class="f"><span>간격</span><span class="unit"><input class="field" type="number" min="1" max="23" value={plan.n} onchange={(e) => setPlan({ n: clampInt(e.currentTarget.value, 1, 23, 2) })} aria-label="몇 시간마다" />시간마다</span></label>
              <label class="f"><span>몇 분에</span><span class="unit"><input class="field" type="number" min="0" max="59" value={plan.minute} onchange={(e) => setPlan({ minute: clampInt(e.currentTarget.value, 0, 59, 0) })} aria-label="몇 분에" />분</span></label>
            {:else if plan.every === 'hourly'}
              <label class="f"><span>몇 분에</span><span class="unit"><input class="field" type="number" min="0" max="59" value={plan.minute} onchange={(e) => setPlan({ minute: clampInt(e.currentTarget.value, 0, 59, 0) })} aria-label="몇 분에" />분</span></label>
            {/if}
            {#if plan.every === 'weekly'}
              <div class="f">
                <span>요일</span>
                <div class="days" role="group" aria-label="요일">
                  {#each [1, 2, 3, 4, 5, 6, 0] as d (d)}
                    <button aria-pressed={plan.days.includes(d)} class:sun={d === 0} class:sat={d === 6} onclick={() => setPlan({ days: plan.days.includes(d) ? plan.days.filter((x) => x !== d) : [...plan.days, d] })}>{WEEKDAY_KO[d]}</button>
                  {/each}
                </div>
              </div>
            {/if}
            {#if plan.every === 'yearly'}
              <label class="f"><span>월</span>
                <select class="field" value={plan.month} onchange={(e) => setPlan({ month: +e.currentTarget.value })} aria-label="몇 월">
                  {#each Array(12) as _, i (i)}<option value={i + 1}>{i + 1}월</option>{/each}
                </select>
              </label>
            {/if}
            {#if plan.every === 'monthly' || plan.every === 'yearly'}
              <label class="f"><span>날</span>
                <select class="field" value={plan.monthMode} onchange={(e) => setPlan({ monthMode: e.currentTarget.value as MonthMode })} aria-label="어느 날">
                  {#each MODES as [id, name] (id)}<option value={id}>{name}</option>{/each}
                </select>
              </label>
              {#if plan.monthMode === 'day'}
                <label class="f"><span>며칠</span><span class="unit"><input class="field" type="number" min="1" max="31" value={plan.day} onchange={(e) => setPlan({ day: clampInt(e.currentTarget.value, 1, 31, 1) })} aria-label="며칠" />일</span></label>
              {:else if plan.monthMode === 'nth'}
                <label class="f"><span>몇째</span>
                  <select class="field" value={plan.nth} onchange={(e) => setPlan({ nth: +e.currentTarget.value })} aria-label="몇째">
                    {#each ORD as [v, name] (v)}<option value={v}>{name}</option>{/each}
                  </select>
                </label>
                <label class="f"><span>요일</span>
                  <select class="field" value={plan.nthDay} onchange={(e) => setPlan({ nthDay: +e.currentTarget.value })} aria-label="무슨 요일">
                    {#each [1, 2, 3, 4, 5, 6, 0] as d (d)}<option value={d}>{WEEKDAY_KO[d]}요일</option>{/each}
                  </select>
                </label>
              {/if}
            {/if}
            {#if needsTime}
              <label class="f"><span>시각</span><input class="field" type="time" value={timeValue} onchange={onTime} aria-label="시각" /></label>
            {/if}
          </div>
          {#if planOut.error}
            <p class="warn">{planOut.error}</p>
          {:else if fitsPlan == null}
            <p class="hint">고르면 이 식이 됩니다: <code>{planOut.text}</code></p>
          {/if}
        </section>
      </div>

      <div class="col">
        <section class="card" aria-labelledby="h-runs">
          <div class="head">
            <h2 id="h-runs">다음 실행</h2>
            {#if spec && !spec.special}<span class="tag">{cityName(tz)} · UTC{fmtOffset(zoneOffset)}</span>{/if}
          </div>
          <div class="zone">
            <label class="f grow">
              <span>시간대 {spec?.tz ? '(식에 적힌 시간대)' : ''}</span>
              <select class="field" value={tz} disabled={!!spec?.tz} onchange={(e) => (zone = e.currentTarget.value)} aria-label="시간대">
                {#each zones as z (z.tz)}<option value={z.tz}>{z.name}{z.tz === myZone ? ' (내 시간대)' : ''}</option>{/each}
              </select>
            </label>
            <div class="chips" role="group" aria-label="시간대 빨리 고르기">
              <button aria-pressed={tz === 'UTC'} disabled={!!spec?.tz} onclick={() => (zone = 'UTC')} title="GitHub Actions · AWS EventBridge 규칙은 UTC 로 돕니다">UTC</button>
              <button aria-pressed={tz === 'Asia/Seoul'} disabled={!!spec?.tz} onclick={() => (zone = 'Asia/Seoul')}>서울</button>
              {#if myZone !== 'Asia/Seoul' && myZone !== 'UTC'}<button aria-pressed={tz === myZone} disabled={!!spec?.tz} onclick={() => (zone = myZone)}>내 시간대</button>{/if}
            </div>
          </div>
          {#if spec && tz !== 'UTC' && !spec.tz && (parsed.dialect === 'aws' || /^\s*-?\s*cron\s*:/m.test(expr))}
            <p class="warn">{parsed.dialect === 'aws' ? 'EventBridge 규칙(rule)의 cron 은 UTC 로 돕니다.' : 'GitHub Actions 는 UTC 로 돕니다.'} <button class="link" onclick={() => (zone = 'UTC')}>UTC 로 보기</button></p>
          {/if}

          {#if !spec}
            <p class="hint">{parsed.empty ? '식을 적으면 언제 도는지 보여 줍니다.' : '식을 고치면 언제 도는지 보여 줍니다.'}</p>
          {:else if spec.special?.kind === 'reboot'}
            <p class="hint">시각이 없습니다. cron 데몬이 시작될 때(대개 컴퓨터를 켤 때) 한 번 돕니다.</p>
          {:else if spec.special?.kind === 'rate'}
            <p class="hint">rate 는 달력의 시각이 아니라 일정을 만든(켠) 때부터 간격을 셉니다. 그래서 정확한 시각은 미리 알 수 없습니다. 정해진 시각이 필요하면 cron( … ) 을 쓰세요.</p>
          {:else if search}
            {#if prev}
              {@const w = whenText(prev.utc, tz)}
              <p class="prev">지난 실행 <b>{w.date} {w.time}</b> <span>{fmtRel(prev.utc - now)}</span></p>
            {/if}
            {#if search.runs.length}
              <ol class="runs" aria-label="다음 실행 시각">
                {#each search.runs as r, i (r.utc)}
                  {@const w = whenText(r.utc, tz)}
                  {@const off = offText(r.utc)}
                  <li class:first={i === 0}>
                    <span class="no">{i + 1}</span>
                    <span class="when">
                      <span class="date">{w.date}</span>
                      <b class="time">{w.time}</b>
                      {#if showMine}{@const m = whenText(r.utc, myZone)}<span class="mine">내 시간대 {m.date} {m.time}</span>{/if}
                      {#if r.dst}<span class="dst">{dstText(r)}</span>{/if}
                    </span>
                    <span class="side">
                      <span class="rel">{fmtRel(r.utc - now)}</span>
                      {#if off}<span class="off" class:holiday={off.holiday}>{off.name}</span>{/if}
                    </span>
                  </li>
                {/each}
              </ol>
              <div class="foot">
                <span class="hint">공휴일 · 주말은 한국 날짜로 표시합니다. cron 은 쉬는 날에도 돕니다.</span>
                {#if count < MAX_RUNS && search.runs.length === count}<button class="btn sm" onclick={() => (count = Math.min(MAX_RUNS, count + 10))}>10개 더</button>{/if}
                {#if count > 10}<button class="btn sm ghost" onclick={() => (count = 10)}>줄이기</button>{/if}
                <button class="btn sm" onclick={() => copy(search!.runs.map((r) => { const w = whenText(r.utc, tz); return `${w.date} ${w.time}`; }).join('\n'), '실행 시각을')}>목록 복사</button>
              </div>
              {#if zoneHasDst}
                <p class="hint">서머타임이 있는 시간대입니다. 없는 시각(봄)에 걸린 실행을 cronie 는 시계가 바뀐 바로 뒤에, Spring · Quartz 는 한 시간 밀린 시각에 돌립니다. 여기서는 한 시간 밀린 시각으로 보여 줍니다. 두 번 오는 시각(가을)에는 한 번만 돕니다.</p>
              {/if}
            {:else}
              <div class="error" role="status">
                <p><b>이 식은 한 번도 돌지 않습니다.</b> {whyNever(spec, wallOf(tz, now).y)}.</p>
              </div>
            {/if}
          {/if}
        </section>

        {#if spec && !spec.special}
          <section class="card" aria-labelledby="h-out">
            <div class="head">
              <h2 id="h-out">옮겨 적기</h2>
              <div class="seg tabs" role="tablist" aria-label="어디에">
                {#each TABS as [id, name] (id)}<button role="tab" aria-selected={tab === id} onclick={() => (tab = id)}>{name}</button>{/each}
              </div>
            </div>
            {#if tab === 'formats'}
              <ul class="formats">
                {#each formats as { d, out } (d)}
                  <li class:cur={d === parsed.dialect}>
                    <span class="k">{dialectName(d)}</span>
                    {#if out.text}
                      <code>{out.text}</code>
                      <span class="act">
                        <button class="btn sm ghost" onclick={() => copy(out.text!, `${dialectName(d)} 식을`)} aria-label={`${dialectName(d)} 식 복사`}>복사</button>
                        {#if d !== parsed.dialect}<button class="btn sm ghost" onclick={() => useFormat(d, out.text!)} aria-label={`${dialectName(d)} 식으로 바꾸기`}>바꾸기</button>{/if}
                      </span>
                    {:else}
                      <span class="no-fmt">{out.error}</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            {:else if snip}
              {#if snip.code}
                <pre class="code">{snip.code}</pre>
                <div class="foot">
                  {#if snip.note}<span class="hint">{snip.note}</span>{/if}
                  <button class="btn sm primary" onclick={() => copy(snip.code!, `${snip.name} 설정을`)}>복사</button>
                </div>
              {:else}
                <p class="warn">{snip.error}</p>
              {/if}
            {/if}
          </section>
        {/if}
      </div>
    </div>
  </div>
  {#if toast}<p class="toast" role="status">{toast}</p>{/if}
</ToolShell>

<style>
  .cron {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .page {
    display: grid;
    grid-template-columns: minmax(0, 1.08fr) minmax(0, 1fr);
    align-items: start;
    gap: 12px;
    padding: 14px;
    max-width: 1180px;
    width: 100%;
    margin: 0 auto;
  }
  .col {
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
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  h2 {
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
  }
  .tag {
    font-size: 12px;
    color: var(--faint);
  }
  .seg button {
    height: 26px;
    padding: 0 9px;
    font-size: 12.5px;
  }
  code,
  pre {
    font-family: var(--mono);
  }
  .hint code,
  .sub code {
    font-size: 0.92em;
    padding: 0 4px;
    border-radius: 4px;
    background: var(--surface-2);
  }

  .expr {
    width: 100%;
    min-height: 52px;
    padding: 11px 14px;
    resize: none;
    font-family: var(--mono);
    font-size: 22px;
    line-height: 1.35;
    letter-spacing: 0.01em;
    white-space: pre;
    overflow-x: auto;
  }
  .expr:focus {
    outline: none;
    border-color: var(--app);
    box-shadow: 0 0 0 3px var(--app-soft);
  }

  .ribbon {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .tok {
    display: grid;
    justify-items: center;
    gap: 1px;
    min-width: 44px;
    padding: 4px 9px 3px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface-2);
    transition: background 0.12s, border-color 0.12s;
  }
  .tok code {
    font-size: 14px;
    font-weight: 650;
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tok span {
    font-size: 11px;
    color: var(--muted);
  }
  .tok:hover {
    border-color: var(--app-line);
  }
  .tok.on {
    border-color: var(--app);
    background: var(--app-soft);
  }
  .tok.aux {
    background: transparent;
    border-style: dashed;
  }
  .tok.bad {
    border-color: var(--bad);
    background: color-mix(in srgb, var(--bad) 10%, var(--surface));
  }
  .tok.bad span {
    color: var(--bad);
  }

  .result {
    display: grid;
    gap: 4px;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--app-soft);
  }
  .sentence {
    font-size: 21px;
    font-weight: 750;
    letter-spacing: -0.02em;
    line-height: 1.35;
  }
  .sub {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .alt {
    font-size: 12.5px;
    color: var(--muted);
  }
  .link {
    padding: 0;
    margin-left: 6px;
    border: 0;
    background: none;
    color: var(--app);
    font-size: inherit;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 2px;
    text-align: left;
  }

  .error {
    display: grid;
    gap: 6px;
    padding: 11px 14px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--bad) 9%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--bad) 30%, var(--surface));
    font-size: 13.5px;
  }
  .error b {
    color: var(--bad);
  }
  .mark {
    margin: 0;
    font-size: 13px;
    white-space: pre-wrap;
    color: var(--muted);
  }
  .mark u {
    color: var(--bad);
    font-weight: 700;
    text-decoration: underline wavy;
    text-underline-offset: 4px;
  }
  .fix {
    font-size: 12.5px;
    color: var(--muted);
  }
  .fix::before {
    content: '→ ';
  }
  .more {
    font-size: 12px;
    color: var(--faint);
  }
  .warns {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .warns li {
    display: grid;
    gap: 2px;
    padding: 8px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, #f59f00 12%, var(--surface));
    border-left: 3px solid #f59f00;
    font-size: 13px;
  }
  .warn {
    font-size: 13px;
    color: var(--bad);
  }
  .hint {
    font-size: 12px;
    line-height: 1.7;
    color: var(--faint);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .chips button {
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: 99px;
    background: var(--surface);
    font-size: 12px;
    color: var(--muted);
  }
  .chips button:hover:not(:disabled) {
    border-color: var(--app-line);
    color: var(--text);
  }
  .chips button[aria-pressed='true'] {
    border-color: var(--app);
    background: var(--app-soft);
    color: var(--text);
    font-weight: 650;
  }
  .chips button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .rows li {
    display: grid;
    grid-template-columns: 34px minmax(56px, auto) 1fr;
    gap: 10px;
    align-items: baseline;
    padding: 4px 8px;
    border-radius: 8px;
    font-size: 13px;
    transition: background 0.12s;
  }
  .rows li.on {
    background: var(--app-soft);
    box-shadow: inset 3px 0 0 var(--app);
  }
  .rows .k {
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
  }
  .rows .v {
    justify-self: start;
    padding: 0 7px;
    border: 0;
    border-radius: 5px;
    background: var(--surface-2);
    font-size: 13px;
    font-weight: 650;
  }
  .rows li.on .v {
    background: var(--surface);
  }
  .rows .d {
    color: var(--muted);
  }

  .plan {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
  }
  .f {
    display: grid;
    gap: 4px;
    min-width: 0;
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
  }
  .f .field {
    font-weight: 400;
    color: var(--text);
  }
  .f.grow {
    flex: 1;
  }
  .unit {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    color: var(--text);
    font-size: 13px;
  }
  .unit .field {
    width: 72px;
    font-variant-numeric: tabular-nums;
  }
  .days {
    display: inline-flex;
    gap: 3px;
  }
  .days button {
    width: 32px;
    height: 32px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--surface);
    font-size: 13px;
    font-weight: 600;
  }
  .days .sun {
    color: var(--bad);
  }
  .days .sat {
    color: var(--accent);
  }
  .days button[aria-pressed='true'] {
    border-color: var(--app);
    background: var(--app);
    color: var(--on-app);
  }

  .zone {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 8px;
  }
  .zone .chips {
    padding-bottom: 4px;
  }
  .prev {
    font-size: 13px;
    color: var(--muted);
  }
  .prev span {
    color: var(--faint);
    margin-left: 4px;
  }
  .runs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .runs li {
    display: grid;
    grid-template-columns: 24px 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 7px 4px;
    border-top: 1px solid var(--border);
    font-variant-numeric: tabular-nums;
  }
  .runs li:first-child {
    border-top: 0;
  }
  .runs li.first .time {
    color: var(--app);
  }
  .no {
    font-size: 11px;
    color: var(--faint);
    text-align: right;
  }
  .when {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 10px;
    min-width: 0;
  }
  .date {
    font-size: 13.5px;
  }
  .time {
    font-size: 15px;
    font-weight: 700;
  }
  .mine,
  .dst {
    flex-basis: 100%;
    font-size: 12px;
    color: var(--muted);
  }
  .dst {
    color: #c77700;
  }
  .side {
    display: grid;
    justify-items: end;
    gap: 2px;
  }
  .rel {
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
  }
  .off {
    padding: 0 7px;
    border-radius: 99px;
    background: var(--surface-2);
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
  }
  .off.holiday {
    background: color-mix(in srgb, var(--bad) 13%, var(--surface));
    color: var(--bad);
    font-weight: 650;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
  }
  .foot .hint {
    margin-right: auto;
  }

  .formats {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .formats li {
    display: grid;
    grid-template-columns: 58px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    min-height: 38px;
    padding: 4px 0;
    border-top: 1px solid var(--border);
  }
  .formats li:first-child {
    border-top: 0;
  }
  .formats .k {
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
  }
  .formats li.cur .k {
    color: var(--app);
  }
  .formats code {
    font-size: 13.5px;
    overflow-wrap: anywhere;
  }
  .formats .act {
    display: flex;
    gap: 2px;
  }
  .no-fmt {
    grid-column: 2 / -1;
    font-size: 12.5px;
    color: var(--faint);
  }
  .code {
    margin: 0;
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--surface-2);
    font-size: 12.5px;
    line-height: 1.6;
    overflow-x: auto;
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

  @media (max-width: 860px) {
    .page {
      grid-template-columns: minmax(0, 1fr);
      padding: 10px;
      gap: 10px;
    }
  }
  @media (max-width: 520px) {
    .card {
      padding: 12px;
    }
    .expr {
      font-size: 18px;
    }
    .sentence {
      font-size: 18px;
    }
    .seg.tabs {
      overflow-x: auto;
      max-width: 100%;
    }
    .formats li {
      grid-template-columns: 1fr auto;
    }
    .formats .k {
      grid-column: 1 / -1;
    }
    .formats code {
      grid-column: 1;
    }
  }
</style>
