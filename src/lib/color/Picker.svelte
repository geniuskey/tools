<script lang="ts">
  import { dominant, fmtShare, type Dominant } from './palette';
  import { toHex } from './format';
  import { rgb } from './space';
  import { st, TARGET_NAMES, type Target } from './state.svelte';

  /** 이보다 큰 사진은 줄여서 그린다 (메모리) */
  const MAX_SIDE = 4096;
  const ZOOM_CELLS = 11;
  const ZOOM_PX = 132;

  let canvas = $state<HTMLCanvasElement>();
  let zoom = $state<HTMLCanvasElement>();
  let ctx: CanvasRenderingContext2D | null = null;
  let size = $state<{ w: number; h: number } | null>(null);
  let colors = $state<Dominant[]>([]);
  let probe = $state<{ x: number; y: number } | null>(null);
  /** 돋보기를 놓을 화면 위치 (그림 상자 기준) */
  let lens = $state<{ left: number; top: number } | null>(null);
  let dragging = $state(false);
  let error = $state('');
  let name = $state('');

  const canDrop = typeof window !== 'undefined' && 'EyeDropper' in window;
  const here = $derived(probe && ctx ? sampleAt(probe.x, probe.y) : null);

  $effect(() => {
    const img = st.image;
    if (img && canvas) open(img.blob, img.name);
  });

  async function open(blob: Blob, label: string) {
    error = '';
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(blob);
    } catch {
      error = '그림으로 읽을 수 없는 파일입니다. PNG · JPG · WebP · GIF 를 넣어 주세요.';
      return;
    }
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    canvas!.width = w;
    canvas!.height = h;
    ctx = canvas!.getContext('2d', { willReadFrequently: true });
    ctx!.drawImage(bmp, 0, 0, w, h);
    size = { w, h };
    name = label;
    probe = null;
    lens = null;
    // 주요 색은 작게 줄인 그림에서
    const s = Math.min(1, 160 / Math.max(w, h));
    const small = new OffscreenCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
    const sc = small.getContext('2d')!;
    sc.drawImage(bmp, 0, 0, small.width, small.height);
    colors = dominant(sc.getImageData(0, 0, small.width, small.height).data, 6);
    bmp.close();
  }

  function sampleAt(x: number, y: number) {
    if (!ctx || !size) return null;
    const n = st.sample;
    const x0 = Math.max(0, x - (n >> 1));
    const y0 = Math.max(0, y - (n >> 1));
    const w = Math.min(n, size.w - x0);
    const h = Math.min(n, size.h - y0);
    const d = ctx.getImageData(x0, y0, w, h).data;
    let [r, g, b, a] = [0, 0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      r += d[i] * d[i + 3];
      g += d[i + 1] * d[i + 3];
      b += d[i + 2] * d[i + 3];
      a += d[i + 3];
    }
    if (!a) return '#00000000';
    const cnt = d.length / 4;
    return toHex(rgb(r / a / 255, g / a / 255, b / a / 255, a / cnt / 255));
  }

  function drawZoom() {
    if (!zoom || !ctx || !probe || !size) return;
    const z = zoom.getContext('2d')!;
    const cell = ZOOM_PX / ZOOM_CELLS;
    const half = ZOOM_CELLS >> 1;
    z.imageSmoothingEnabled = false;
    z.fillStyle = '#888';
    z.fillRect(0, 0, ZOOM_PX, ZOOM_PX);
    z.drawImage(canvas!, probe.x - half, probe.y - half, ZOOM_CELLS, ZOOM_CELLS, 0, 0, ZOOM_PX, ZOOM_PX);
    const box = st.sample;
    const o = (half - (box >> 1)) * cell;
    z.lineWidth = 2;
    z.strokeStyle = '#fff';
    z.strokeRect(o, o, cell * box, cell * box);
    z.lineWidth = 1;
    z.strokeStyle = '#000';
    z.strokeRect(o - 1.5, o - 1.5, cell * box + 3, cell * box + 3);
  }
  $effect(() => {
    void probe;
    void st.sample;
    drawZoom();
  });

  function toPixel(e: PointerEvent) {
    const r = canvas!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * size!.w);
    const y = Math.floor(((e.clientY - r.top) / r.height) * size!.h);
    return { x: Math.max(0, Math.min(size!.w - 1, x)), y: Math.max(0, Math.min(size!.h - 1, y)) };
  }
  function place(clientX: number, clientY: number) {
    const r = canvas!.getBoundingClientRect();
    const box = canvas!.parentElement!.getBoundingClientRect();
    let left = clientX - box.left + 18;
    let top = clientY - box.top + 18;
    if (left + ZOOM_PX + 8 > box.width) left = clientX - box.left - ZOOM_PX - 18;
    if (top + ZOOM_PX + 34 > Math.max(box.height, r.height)) top = clientY - box.top - ZOOM_PX - 48;
    lens = { left: Math.max(0, left), top: Math.max(0, top) };
  }
  function onmove(e: PointerEvent) {
    if (!size) return;
    probe = toPixel(e);
    place(e.clientX, e.clientY);
  }
  function placeFromProbe() {
    if (!probe || !size) return;
    const r = canvas!.getBoundingClientRect();
    place(r.left + ((probe.x + 0.5) / size.w) * r.width, r.top + ((probe.y + 0.5) / size.h) * r.height);
  }
  function take() {
    const hex = here;
    if (!hex) return;
    st.set(st.target, hex);
    st.say(`${hex} 를 ${TARGET_NAMES[st.target]}에 넣었습니다`);
  }
  function onkey(e: KeyboardEvent) {
    if (!size) return;
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      const p = probe ?? { x: size.w >> 1, y: size.h >> 1 };
      probe = { x: Math.max(0, Math.min(size.w - 1, p.x + moves[e.key][0])), y: Math.max(0, Math.min(size.h - 1, p.y + moves[e.key][1])) };
      placeFromProbe();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!probe) {
        probe = { x: size.w >> 1, y: size.h >> 1 };
        placeFromProbe();
      } else take();
    } else if (e.key === 'Escape') {
      probe = null;
      lens = null;
    }
  }

  function pickFile(f: File | undefined) {
    if (f) st.image = { blob: f, name: f.name };
  }
  function ondrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (f) pickFile(f);
    else error = '그림 파일을 놓아 주세요.';
  }

  async function screen() {
    if (!canDrop) return;
    try {
      const r = await new (window as any).EyeDropper().open();
      st.set(st.target, r.sRGBHex);
      st.say(`${r.sRGBHex} 를 ${TARGET_NAMES[st.target]}에 넣었습니다`);
    } catch {}
  }
</script>

<div class="page">
  <section class="card" aria-labelledby="h-pick">
    <div class="bar">
      <h2 id="h-pick">색 따오기</h2>
      <div class="f inline">
        <span>넣을 곳</span>
        <div class="seg" role="group" aria-label="따온 색을 넣을 곳">
          {#each ['fg', 'bg', 'base'] as const as t (t)}<button aria-pressed={st.target === t} onclick={() => (st.target = t as Target)}>{TARGET_NAMES[t]}</button>{/each}
        </div>
      </div>
      <div class="f inline">
        <span>한 번에</span>
        <div class="seg" role="group" aria-label="평균 낼 넓이">
          {#each [1, 3, 5] as const as n (n)}<button aria-pressed={st.sample === n} onclick={() => (st.sample = n)}>{n === 1 ? '1점' : `${n}×${n} 평균`}</button>{/each}
        </div>
      </div>
      <span class="grow"></span>
      <button class="btn" onclick={screen} disabled={!canDrop} title={canDrop ? '다른 창 · 화면 어디서든 색을 따옵니다' : ''}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 6.5l3 3M19.6 4.4a2.1 2.1 0 0 0-3 0l-2.1 2.1-1-1-1.4 1.4 1 1-7.6 7.6-.5 2.6-1 1 1.4 1.4 1-1 2.6-.5 7.6-7.6 1 1 1.4-1.4-1-1 2.1-2.1a2.1 2.1 0 0 0 0-3z" /></svg>
        화면에서 따오기
      </button>
      <label class="btn">
        사진 열기
        <input
          type="file"
          accept="image/*"
          hidden
          onchange={(e) => {
            pickFile(e.currentTarget.files?.[0]);
            e.currentTarget.value = '';
          }}
        />
      </label>
    </div>
    {#if !canDrop}<p class="hint">이 브라우저는 화면 어디서나 색을 따오는 기능(EyeDropper)을 지원하지 않습니다 — 크롬 · 엣지에서 됩니다. 대신 스크린샷을 찍어 <kbd>Ctrl</kbd>+<kbd>V</kbd> 로 붙여넣으면 여기서 따올 수 있습니다.</p>{/if}

    <div
      class="stage"
      class:empty={!size}
      class:drag={dragging}
      role="presentation"
      ondragover={(e) => {
        e.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      {ondrop}
    >
      <canvas
        bind:this={canvas}
        class:hidden={!size}
        tabindex={size ? 0 : -1}
        aria-label="사진. 화살표로 움직이고 Enter 로 색을 따옵니다"
        onpointermove={onmove}
        onpointerleave={() => {
          probe = null;
          lens = null;
        }}
        onclick={take}
        onkeydown={onkey}
      ></canvas>
      {#if !size}
        <div class="drop">
          <p><b>스크린샷을 붙여넣거나</b> (<kbd>Ctrl</kbd>+<kbd>V</kbd>) 사진을 여기로 끌어 오세요.</p>
          <p class="hint">사진은 이 브라우저 안에서만 열립니다. 어디로도 보내지 않습니다.</p>
        </div>
      {/if}
      {#if lens && here}
        <div class="lens" style:left="{lens.left}px" style:top="{lens.top}px" aria-hidden="true">
          <canvas bind:this={zoom} width={ZOOM_PX} height={ZOOM_PX}></canvas>
          <span><i style:background={here}></i>{here}</span>
        </div>
      {/if}
    </div>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    {#if size}
      <p class="hint" aria-live="polite">
        {name} · {size.w.toLocaleString('ko-KR')} × {size.h.toLocaleString('ko-KR')}px —
        {#if here && probe}<b>{here}</b> ({probe.x}, {probe.y}) · 누르면 {TARGET_NAMES[st.target]}에 넣습니다{:else}사진 위를 누르면 그 자리의 색이 {TARGET_NAMES[st.target]}에 들어갑니다. 키보드로는 화살표 · Enter{/if}
      </p>
    {/if}
  </section>

  {#if colors.length}
    <section class="card" aria-labelledby="h-dom">
      <h2 id="h-dom">이 사진의 주요 색 <small>누르면 {TARGET_NAMES[st.target]}에</small></h2>
      <ul class="dom">
        {#each colors as c (c.hex)}
          <li>
            <button style:background={c.hex} onclick={() => st.set(st.target, c.hex)} aria-label="{c.hex}, 사진의 {fmtShare(c.share)}"></button>
            <code>{c.hex}</code>
            <small>{fmtShare(c.share)}</small>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
  }
  .inline {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .grow {
    flex: 1;
  }
  h2 small {
    font-weight: 600;
    color: var(--faint);
    margin-left: 4px;
  }
  .stage {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 220px;
    border-radius: 12px;
    background: repeating-conic-gradient(var(--surface-2) 0 25%, var(--surface) 0 50%) 0 0 / 16px 16px;
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .stage.empty {
    border: 2px dashed var(--border-strong);
    background: var(--surface);
  }
  .stage.drag {
    border-color: var(--app);
    background: var(--app-soft);
  }
  .stage > canvas {
    display: block;
    max-width: 100%;
    max-height: 62vh;
    cursor: crosshair;
    image-rendering: auto;
  }
  .stage > canvas.hidden {
    display: none;
  }
  .drop {
    display: grid;
    gap: 6px;
    padding: 30px 20px;
    text-align: center;
    font-size: 14px;
  }
  .lens {
    position: absolute;
    display: grid;
    gap: 4px;
    pointer-events: none;
    z-index: 2;
  }
  .lens canvas {
    width: 132px;
    height: 132px;
    border-radius: 50%;
    border: 3px solid #fff;
    box-shadow: var(--shadow-lg);
  }
  .lens span {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 2px 8px;
    border-radius: 99px;
    background: rgb(0 0 0 / 0.75);
    color: #fff;
    font-family: var(--mono);
    font-size: 12px;
  }
  .lens i {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    border: 1px solid #fff;
  }
  .err {
    font-size: 13px;
    color: var(--bad);
  }
  .dom {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .dom li {
    display: grid;
    justify-items: center;
    gap: 2px;
  }
  .dom button {
    width: 68px;
    height: 52px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  }
  .dom code {
    font-family: var(--mono);
    font-size: 12px;
  }
  .dom small {
    font-size: 11.5px;
    color: var(--faint);
  }
  @media (max-width: 520px) {
    .grow {
      display: none;
    }
  }
</style>
