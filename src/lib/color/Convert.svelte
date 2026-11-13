<script lang="ts">
  import ColorField from './ColorField.svelte';
  import Swatches from './Swatches.svelte';
  import { describe, fmtNum, nearestName, toHex } from './format';
  import { fmtRatio, luminance, ratio } from './contrast';
  import { oklch, rgb } from './space';
  import { st } from './state.svelte';

  const d = $derived(describe(st.baseColor));
  const hex = $derived(toHex(d.srgb));
  const okText = $derived(d.formats.find((f) => f.id === 'oklch')!.text);
  const name = $derived(nearestName(d.srgb));
  const o = $derived(oklch(d.srgb));
  const onWhite = $derived(ratio(d.srgb, rgb(1, 1, 1)));
  const onBlack = $derived(ratio(d.srgb, rgb(0, 0, 0)));
  // 이 색 위에 올릴 글자는 흰색과 검은색 중 대비가 큰 쪽
  const ink = $derived(onWhite >= onBlack ? '#ffffff' : '#000000');

  function send(role: 'fg' | 'bg') {
    st.set(role, hex);
    st.mode = 'contrast';
    st.say(`${hex} 를 ${role === 'fg' ? '글자' : '배경'} 색으로 넣었습니다`);
  }
</script>

<div class="page two">
  <div class="col">
    <section class="card" aria-labelledby="h-in">
      <h2 id="h-in">색</h2>
      <ColorField target="base" label="아무 표기로나 붙여넣으세요" big />
      <div class="swatch" class:split={d.mapped}>
        <div class="half" style:background={hex} style:color={ink}>
          <b>{hex}</b>
          {#if d.mapped}<small>sRGB 로 맞춘 색</small>{/if}
        </div>
        {#if d.mapped}
          <div class="half" style:background={okText} style:color={ink}>
            <b>원래 색</b>
            <small>넓은 색역 화면에서만 제대로 보입니다</small>
          </div>
        {/if}
      </div>
      {#if d.mapped}
        <p class="warn" role="note">sRGB 밖의 색입니다. HEX · RGB · HSL 에는 밝기와 색상은 그대로 두고 채도만 줄여 가장 가까운 색을 적었습니다 (CSS Color 4 방식). OKLCH · Lab · P3 는 원래 값입니다.</p>
      {/if}
      <dl class="facts">
        <div><dt>가까운 이름</dt><dd>{name.exact ? '' : '≈ '}<code>{name.name}</code>{#if !name.exact} <span class="chip-dot" style:background={name.hex}></span>{/if}</dd></div>
        <div><dt>밝기 (OKLCH L)</dt><dd>{fmtNum(o.l * 100, 1)}%</dd></div>
        <div><dt>상대 휘도</dt><dd>{fmtNum(luminance(d.srgb), 4)}</dd></div>
        <div><dt>흰 바탕에서</dt><dd>{fmtRatio(onWhite)} : 1</dd></div>
        <div><dt>검은 바탕에서</dt><dd>{fmtRatio(onBlack)} : 1</dd></div>
        {#if d.original.alpha < 0.9995}<div><dt>불투명도</dt><dd>{fmtNum(d.original.alpha * 100, 1)}%</dd></div>{/if}
      </dl>
      <div class="foot">
        <button class="btn sm" onclick={() => send('fg')}>글자 색으로 대비 보기</button>
        <button class="btn sm" onclick={() => send('bg')}>배경 색으로 대비 보기</button>
        <button class="btn sm" onclick={() => (st.mode = 'palette')}>팔레트 만들기</button>
      </div>
    </section>
    <Swatches current={st.base} />
  </div>

  <section class="card" aria-labelledby="h-fmt">
    <h2 id="h-fmt">표기 <small>누르면 복사</small></h2>
    <ul class="formats">
      {#each d.formats as f (f.id)}
        <li>
          <button onclick={() => st.copy(f.text, f.label)} aria-label="{f.label} {f.text} 복사">
            <span class="label">{f.label}</span>
            <code>{f.text}</code>
            {#if f.note}<small>{f.note}</small>{/if}
            <span class="cp" aria-hidden="true">복사</span>
          </button>
        </li>
      {/each}
    </ul>
  </section>
</div>

<style>
  h2 small {
    font-weight: 600;
    color: var(--faint);
    margin-left: 4px;
  }
  .swatch {
    display: grid;
    height: 120px;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
    background: repeating-conic-gradient(#d9dce1 0 25%, #fff 0 50%) 0 0 / 14px 14px;
  }
  .swatch.split {
    grid-template-columns: 1fr 1fr;
  }
  .half {
    display: grid;
    align-content: end;
    padding: 10px 14px;
  }
  .half b {
    font-family: var(--mono);
    font-size: 16px;
  }
  .half small {
    font-size: 11.5px;
    opacity: 0.85;
  }
  .warn {
    font-size: 12.5px;
    line-height: 1.6;
    padding: 8px 10px;
    border-radius: 10px;
    background: color-mix(in srgb, #f59f00 13%, var(--surface));
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px 14px;
    margin: 0;
  }
  .facts div {
    display: grid;
    gap: 1px;
  }
  .facts dt {
    font-size: 11.5px;
    color: var(--faint);
  }
  .facts dd {
    margin: 0;
    font-size: 13.5px;
    font-variant-numeric: tabular-nums;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .facts code {
    font-family: var(--mono);
    font-size: 12.5px;
  }
  .chip-dot {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    border: 1px solid color-mix(in srgb, var(--text) 15%, transparent);
  }
  .foot {
    justify-content: flex-start;
  }
  .formats {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .formats li + li {
    border-top: 1px solid var(--border);
  }
  .formats button {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 0 10px;
    width: 100%;
    padding: 8px 6px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    text-align: left;
  }
  .formats button:hover {
    background: var(--app-soft);
  }
  .label {
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
  }
  .formats code {
    font-family: var(--mono);
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .formats small {
    grid-column: 2;
    font-size: 11.5px;
    color: var(--faint);
  }
  .cp {
    grid-row: 1;
    grid-column: 3;
    font-size: 12px;
    font-weight: 650;
    color: var(--app);
    opacity: 0;
  }
  .formats button:hover .cp,
  .formats button:focus-visible .cp {
    opacity: 1;
  }
  @media (max-width: 520px) {
    .formats button {
      grid-template-columns: 78px minmax(0, 1fr);
    }
    .cp {
      display: none;
    }
  }
</style>
