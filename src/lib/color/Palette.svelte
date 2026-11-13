<script lang="ts">
  import ColorField from './ColorField.svelte';
  import { EXPORTS, HARMONIES, exportScale, harmony, scale, slug } from './palette';
  import { CVDS, simulate } from './cvd';
  import { fmtRatio, ratio } from './contrast';
  import { toHex } from './format';
  import { rgb, type Rgb } from './space';
  import { downloadBlob } from '$lib/download';
  import { st } from './state.svelte';

  const WHITE = rgb(1, 1, 1);
  const BLACK = rgb(0, 0, 0);
  const swatches = $derived(scale(st.baseColor));
  const show = (c: Rgb) => toHex(simulate(c, st.cvd));
  const grade = (r: number) => (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? '큰 글자' : '—');
  const harm = $derived(HARMONIES.find((h) => h[0] === st.harmony)!);
  const harmColors = $derived(harmony(st.baseColor, harm[2]));
  const code = $derived(exportScale(st.paletteName, swatches, st.exportKind));

  function pair(fg: string, bg: string) {
    st.fg = fg;
    st.bg = bg;
    st.remember(bg);
    st.mode = 'contrast';
  }
  function useBase(hex: string) {
    st.set('base', hex);
  }
  function download() {
    const ext = st.exportKind === 'json' ? 'json' : st.exportKind === 'scss' ? 'scss' : st.exportKind === 'tailwind3' ? 'js' : 'css';
    downloadBlob(new Blob([code + '\n'], { type: 'text/plain' }), `${slug(st.paletteName)}-palette.${ext}`);
  }
</script>

<div class="page">
  <section class="card" aria-labelledby="h-scale">
    <div class="top">
      <h2 id="h-scale">밝기 단계</h2>
      <div class="base-in"><ColorField target="base" label="기준 색" /></div>
      <label class="f cvd">
        <span>보기</span>
        <select class="field" bind:value={st.cvd}>
          {#each CVDS as [id, name] (id)}<option value={id}>{id === 'none' ? '그대로 보기' : `${name}으로 보기`}</option>{/each}
        </select>
      </label>
    </div>
    <ol class="strip" aria-label="밝기 단계">
      {#each swatches as s (s.step)}
        <li>
          <button class:base={s.base} style:background={show(s.color)} style:color={ratio(s.color, WHITE) >= ratio(s.color, BLACK) ? '#fff' : '#000'} onclick={() => st.copy(s.hex)} aria-label="{s.step} {s.hex} 복사{s.base ? ' (기준 색)' : ''}">
            <b>{s.step}</b>
            <code>{s.hex.slice(1)}</code>
            {#if s.base}<i aria-hidden="true">기준</i>{/if}
          </button>
        </li>
      {/each}
    </ol>
    <p class="hint">기준 색을 밝기가 가장 가까운 단계에 그대로 두고, 나머지는 OKLCH 밝기를 고르게 나눠 만들었습니다. 누르면 HEX 를 복사합니다.</p>
  </section>

  <div class="two">
    <section class="card" aria-labelledby="h-grid">
      <h2 id="h-grid">단계별 대비 <small>칸을 누르면 대비 탭에서 봅니다</small></h2>
      <table class="grid">
        <thead><tr><th>단계</th><th>흰 글자</th><th>검은 글자</th></tr></thead>
        <tbody>
          {#each swatches as s (s.step)}
            {@const w = ratio(WHITE, s.color)}
            {@const b = ratio(BLACK, s.color)}
            <tr>
              <th scope="row"><span class="dot" style:background={show(s.color)}></span>{s.step}</th>
              {#each [[w, '#ffffff'], [b, '#000000']] as const as [r, ink] (ink)}
                <td>
                  <button class="cell" class:fail={r < 3} style:background={show(s.color)} style:color={ink} onclick={() => pair(ink, s.hex)} aria-label="{s.step} 바탕에 {ink === '#ffffff' ? '흰' : '검은'} 글자 {fmtRatio(r)} 대 1">
                    <span>Aa</span>
                    <b>{fmtRatio(r)}</b>
                    <em>{grade(r)}</em>
                  </button>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <div class="col">
      <section class="card" aria-labelledby="h-harm">
        <h2 id="h-harm">어울리는 색</h2>
        <div class="chips" role="group" aria-label="어울리는 색 종류">
          {#each HARMONIES as [id, name] (id)}<button aria-pressed={st.harmony === id} onclick={() => (st.harmony = id)}>{name}</button>{/each}
        </div>
        <ul class="harm">
          {#each harmColors as c, i (i)}
            {@const hex = toHex(c)}
            <li>
              <button class="hs" style:background={show(c)} onclick={() => st.copy(hex)} aria-label="{hex} 복사"></button>
              <code>{hex}</code>
              {#if i > 0 || harm[2][0] !== 0}<button class="btn sm ghost" onclick={() => useBase(hex)}>기준으로</button>{:else}<small>기준</small>{/if}
            </li>
          {/each}
        </ul>
        <p class="hint">OKLCH 에서 밝기와 채도는 두고 색상각만 돌렸습니다. 그래서 같은 무게로 보입니다.</p>
      </section>

      <section class="card" aria-labelledby="h-exp">
        <h2 id="h-exp">내보내기</h2>
        <div class="exp-top">
          <label class="f"><span>이름</span><input class="field" bind:value={st.paletteName} spellcheck="false" autocomplete="off" /></label>
          <label class="f">
            <span>형식</span>
            <select class="field" bind:value={st.exportKind}>
              {#each EXPORTS as [id, name] (id)}<option value={id}>{name}</option>{/each}
            </select>
          </label>
        </div>
        <pre class="code" aria-label="내보낼 코드">{code}</pre>
        <div class="foot">
          <button class="btn sm" onclick={download}>파일로 받기</button>
          <button class="btn sm primary" onclick={() => st.copy(code, '코드를')}>복사</button>
        </div>
      </section>
    </div>
  </div>
</div>

<style>
  h2 small {
    font-weight: 600;
    color: var(--faint);
    margin-left: 4px;
  }
  .top {
    display: grid;
    grid-template-columns: auto minmax(0, 340px) auto;
    align-items: end;
    gap: 12px;
  }
  .top h2 {
    align-self: center;
  }
  .cvd {
    justify-self: end;
  }
  .strip {
    display: grid;
    grid-template-columns: repeat(11, minmax(0, 1fr));
    margin: 0;
    padding: 0;
    list-style: none;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  }
  .strip button {
    position: relative;
    display: grid;
    align-content: end;
    width: 100%;
    height: 96px;
    padding: 8px 6px;
    border: 0;
    text-align: left;
  }
  .strip button:hover {
    filter: brightness(1.04);
  }
  .strip button.base {
    box-shadow: inset 0 0 0 3px currentColor;
  }
  .strip b {
    font-size: 13px;
  }
  .strip code {
    font-family: var(--mono);
    font-size: 11px;
    opacity: 0.85;
  }
  .strip i {
    position: absolute;
    top: 7px;
    left: 7px;
    font-style: normal;
    font-size: 10.5px;
    font-weight: 700;
  }
  .two {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }
  .grid {
    width: 100%;
    border-collapse: separate;
    border-spacing: 4px 3px;
    font-size: 13px;
  }
  .grid thead th {
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
    text-align: left;
    padding: 0 4px;
  }
  .grid tbody th {
    width: 70px;
    font-weight: 650;
    text-align: left;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .dot {
    display: inline-block;
    width: 12px;
    height: 12px;
    margin-right: 6px;
    border-radius: 3px;
    vertical-align: -1px;
    border: 1px solid color-mix(in srgb, var(--text) 15%, transparent);
  }
  .cell {
    display: grid;
    grid-template-columns: 30px 1fr auto;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 30px;
    padding: 0 9px;
    border: 0;
    border-radius: 7px;
    font-variant-numeric: tabular-nums;
    text-align: left;
  }
  .cell span {
    font-weight: 750;
    font-size: 14px;
  }
  .cell b {
    font-size: 12.5px;
  }
  .cell em {
    font-style: normal;
    font-size: 11px;
    font-weight: 700;
  }
  .cell.fail {
    opacity: 0.55;
  }
  .cell:hover {
    outline: 2px solid var(--app);
    outline-offset: 1px;
  }
  .harm {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .harm li {
    display: grid;
    justify-items: center;
    gap: 3px;
  }
  .hs {
    width: 64px;
    height: 64px;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  }
  .harm code {
    font-family: var(--mono);
    font-size: 12px;
  }
  .harm small {
    font-size: 11.5px;
    color: var(--faint);
    line-height: 28px;
  }
  .exp-top {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .code {
    margin: 0;
    max-height: 260px;
    overflow: auto;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--surface-2);
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.6;
    white-space: pre;
  }
  @media (max-width: 920px) {
    .two {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 680px) {
    .top {
      grid-template-columns: minmax(0, 1fr);
    }
    .cvd {
      justify-self: stretch;
    }
    .strip {
      grid-template-columns: repeat(6, minmax(0, 1fr));
    }
    .strip button {
      height: 72px;
    }
  }
</style>
