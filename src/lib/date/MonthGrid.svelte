<script lang="ts">
  import { WEEKDAYS, fmt, fromDay, monthLength, toDay, weekday, type Day } from './core';
  import { toLunar } from './lunar';
  import { offOf, type Rules } from './work';

  let {
    y = $bindable(),
    m = $bindable(),
    rules,
    today,
    range = null,
    ring = null,
    dot = null,
    onpick,
  }: {
    y: number;
    m: number;
    rules: Rules;
    today: Day;
    /** 칠할 구간 (양 끝 포함) */
    range?: [Day, Day] | null;
    /** 테두리로 표시할 날 (계산 결과) */
    ring?: Day | null;
    /** 점으로 표시할 날 (기준일) */
    dot?: Day | null;
    onpick: (day: Day) => void;
  } = $props();

  const cells = $derived.by(() => {
    const first = toDay(y, m, 1);
    const lead = weekday(first);
    const count = Math.ceil((lead + monthLength(y, m)) / 7) * 7;
    return Array.from({ length: count }, (_, i) => {
      const day = first - lead + i;
      const off = offOf(day, rules);
      const lunar = toLunar(day);
      return {
        day,
        date: fromDay(day).d,
        out: fromDay(day).m !== m,
        wd: weekday(day),
        off,
        // 쉬는 이유가 있으면 그 이름을, 없으면 음력 초하루 · 보름만 작게
        note: off && off.kind !== 'weekend' ? off.name.replace(/^대체공휴일.*/, '대체공휴일') : lunar.day === 1 || lunar.day === 15 ? `음 ${lunar.leap ? '윤' : ''}${lunar.month}.${lunar.day}` : '',
      };
    });
  });

  function move(n: number) {
    const idx = y * 12 + (m - 1) + n;
    if (idx < 1900 * 12 || idx > 2100 * 12 + 11) return;
    y = Math.floor(idx / 12);
    m = (idx % 12) + 1;
  }
</script>

<div class="cal">
  <div class="nav">
    <button class="btn sm ghost" onclick={() => move(-1)} aria-label="앞 달">‹</button>
    <strong aria-live="polite">{y}년 {m}월</strong>
    <button class="btn sm ghost" onclick={() => move(1)} aria-label="다음 달">›</button>
    <button class="btn sm" onclick={() => ({ y, m } = fromDay(today))}>오늘</button>
  </div>
  <div class="grid" role="grid" aria-label="{y}년 {m}월 달력">
    {#each WEEKDAYS as w, i (w)}<span class="wd" class:sun={i === 0} class:sat={i === 6}>{w}</span>{/each}
    {#each cells as c (c.day)}
      <button
        class="cell"
        class:out={c.out}
        class:sun={c.wd === 0 || (c.off && c.off.kind !== 'weekend')}
        class:sat={c.wd === 6 && (!c.off || c.off.kind === 'weekend')}
        class:today={c.day === today}
        class:in={range && c.day >= range[0] && c.day <= range[1]}
        class:end={range && (c.day === range[0] || c.day === range[1])}
        class:ring={c.day === ring}
        class:dot={c.day === dot}
        aria-label="{fmt(c.day)}{c.off && c.off.kind !== 'weekend' ? ` ${c.off.name}` : ''}"
        title={c.off && c.off.kind !== 'weekend' ? c.off.name : undefined}
        onclick={() => onpick(c.day)}
      >
        <b>{c.date}</b>
        <small>{c.note}</small>
      </button>
    {/each}
  </div>
</div>

<style>
  .cal {
    display: grid;
    gap: 8px;
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .nav strong {
    min-width: 104px;
    text-align: center;
    font-size: 15px;
    font-variant-numeric: tabular-nums;
  }
  .nav .btn:last-child {
    margin-left: auto;
  }
  .nav .ghost {
    width: 28px;
    padding: 0;
    font-size: 17px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 2px;
  }
  .wd {
    padding: 2px 0 4px;
    text-align: center;
    font-size: 11.5px;
    font-weight: 650;
    color: var(--faint);
  }
  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    min-width: 0;
    height: 46px;
    padding: 5px 1px 0;
    border: 1.5px solid transparent;
    border-radius: 9px;
    background: transparent;
  }
  .cell:hover {
    background: var(--surface-2);
  }
  .cell b {
    display: grid;
    place-items: center;
    width: 24px;
    height: 22px;
    border-radius: 99px;
    font-size: 13.5px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .cell small {
    max-width: 100%;
    overflow: hidden;
    font-size: 9.5px;
    line-height: 1.2;
    color: var(--faint);
    white-space: nowrap;
    text-overflow: clip;
    letter-spacing: -0.03em;
  }
  .sun,
  .sun small {
    color: var(--bad);
  }
  .sat {
    color: var(--accent);
  }
  .out {
    opacity: 0.38;
  }
  .today b {
    box-shadow: inset 0 0 0 1.5px currentColor;
  }
  .in {
    background: var(--app-soft);
    border-radius: 4px;
  }
  .in:hover {
    background: var(--app-line);
  }
  .end b {
    background: var(--app);
    color: var(--on-app);
    box-shadow: none;
  }
  .ring {
    border-color: var(--app);
    border-style: dashed;
  }
  .dot b {
    box-shadow: inset 0 -2.5px 0 var(--app);
    border-radius: 3px;
  }
</style>
