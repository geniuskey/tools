<script lang="ts">
  import { downloadBlob, timestamp } from '$lib/download';
  import { pixelDiff } from './image';

  let { active = true }: { active?: boolean } = $props();

  type Side = 'a' | 'b';
  type Mode = 'swipe' | 'diff' | 'blend' | 'side';
  interface Pic {
    name: string;
    w: number;
    h: number;
    bitmap: ImageBitmap;
  }
  const MAX_PIXELS = 40_000_000;
  const label = { a: '원본', b: '바뀐 이미지' };

  let pics = $state.raw<{ a: Pic | null; b: Pic | null }>({ a: null, b: null });
  let mode = $state<Mode>('swipe');
  let swipe = $state(50);
  let opacity = $state(50);
  let tolerance = $state(10);
  let actual = $state(false);
  let notice = $state('');
  let dragging = $state<Side | null>(null);
  let boxW = $state(0);
  let boxH = $state(0);

  const W = $derived(Math.max(pics.a?.w ?? 0, pics.b?.w ?? 0));
  const H = $derived(Math.max(pics.a?.h ?? 0, pics.b?.h ?? 0));
  const both = $derived(!!pics.a && !!pics.b);
  const sizeDiffers = $derived(both && (pics.a!.w !== pics.b!.w || pics.a!.h !== pics.b!.h));

  // 크기가 다르면 왼쪽 위를 맞추고 큰 쪽에 맞춰 투명하게 채운다
  function raster(p: Pic, w: number, h: number): ImageData {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(p.bitmap, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  }
  const dataA = $derived(both ? raster(pics.a!, W, H) : null);
  const dataB = $derived(both ? raster(pics.b!, W, H) : null);

  // 슬라이더를 끄는 동안 매번 다시 계산하지 않는다
  let tol = $state(10);
  $effect(() => {
    const v = tolerance;
    const t = setTimeout(() => (tol = v), 80);
    return () => clearTimeout(t);
  });

  const diff = $derived.by(() => {
    if (!dataA || !dataB) return null;
    const img = new ImageData(W, H);
    const r = pixelDiff(dataA.data, dataB.data, W, H, tol / 100, img.data);
    return { img, ...r, ratio: r.count / (W * H) };
  });

  const frame = $derived.by(() => {
    if (!W || !H) return { w: 0, h: 0 };
    if (actual) return { w: W, h: H };
    const availW = mode === 'side' ? (boxW - 12) / 2 : boxW;
    const s = Math.min(availW / W, boxH / H, 1);
    return { w: Math.max(1, Math.floor(W * s)), h: Math.max(1, Math.floor(H * s)) };
  });

  function paint(canvas: HTMLCanvasElement, data: ImageData | null) {
    const draw = (d: ImageData | null) => {
      if (!d) return;
      canvas.width = d.width;
      canvas.height = d.height;
      canvas.getContext('2d')!.putImageData(d, 0, 0);
    };
    draw(data);
    return { update: draw };
  }

  function flash(msg: string) {
    notice = msg;
    setTimeout(() => notice === msg && (notice = ''), 4000);
  }

  async function readFile(side: Side, f: File | Blob, name = 'name' in f ? f.name : '붙여넣은 이미지') {
    try {
      const bitmap = await createImageBitmap(f);
      if (bitmap.width * bitmap.height > MAX_PIXELS) {
        bitmap.close();
        return flash(`${name}: 이미지가 너무 큽니다 (최대 4천만 화소)`);
      }
      pics[side]?.bitmap.close();
      pics = { ...pics, [side]: { name, w: bitmap.width, h: bitmap.height, bitmap } };
    } catch {
      flash(`${name}: 이미지로 읽을 수 없습니다`);
    }
  }

  function takeFiles(side: Side, list: FileList | File[] | null | undefined) {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return list?.length ? flash('이미지 파일이 아닙니다') : undefined;
    if (files.length >= 2) {
      readFile('a', files[0]);
      readFile('b', files[1]);
    } else readFile(side, files[0]);
  }

  function onPaste(e: ClipboardEvent) {
    if (!active) return;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    takeFiles(!pics.a ? 'a' : 'b', files);
  }

  function clear(side: Side) {
    pics[side]?.bitmap.close();
    pics = { ...pics, [side]: null };
  }
  function swap() {
    pics = { a: pics.b, b: pics.a };
  }

  // 예시: 같은 화면을 두 번 그리되 몇 군데만 다르게
  async function sample() {
    const make = (v: 0 | 1) => {
      const c = document.createElement('canvas');
      c.width = 960;
      c.height = 600;
      const g = c.getContext('2d')!;
      g.fillStyle = '#f4f5f7';
      g.fillRect(0, 0, 960, 600);
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 960, 64);
      g.fillStyle = '#17181c';
      g.font = '700 22px sans-serif';
      g.fillText('Dashboard', 32, 41);
      g.fillStyle = v ? '#0c8599' : '#2563eb';
      g.beginPath();
      g.roundRect(800, 16, 128, 34, 8);
      g.fill();
      g.fillStyle = '#fff';
      g.font = '600 14px sans-serif';
      g.fillText(v ? 'New report' : 'New', v ? 824 : 848, 38);
      for (let i = 0; i < 3; i++) {
        g.fillStyle = '#fff';
        g.beginPath();
        g.roundRect(32 + i * 304, 96, 288, 132, 12);
        g.fill();
        g.fillStyle = '#8a909b';
        g.font = '500 13px sans-serif';
        g.fillText(['Visitors', 'Sign-ups', 'Revenue'][i], 52 + i * 304, 128);
        g.fillStyle = '#17181c';
        g.font = '700 34px sans-serif';
        g.fillText([['12,480', '12,480'], ['342', '357'], ['$8,210', '$8,210']][i][v], 52 + i * 304, 180);
      }
      g.fillStyle = '#fff';
      g.beginPath();
      g.roundRect(32, 256, 896, 312, 12);
      g.fill();
      for (let i = 0; i < 14; i++) {
        const h = 60 + ((i * 53) % 150) + (v && i === 9 ? 46 : 0);
        g.fillStyle = v && i === 9 ? '#e8590c' : '#c5d0e6';
        g.fillRect(64 + i * 60, 540 - h, 36 + (v ? 1 : 0) * (i === 3 ? 2 : 0), h);
      }
      return new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
    };
    await readFile('a', await make(0), 'before.png');
    await readFile('b', await make(1), 'after.png');
  }

  function saveDiff() {
    if (!diff) return;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    c.getContext('2d')!.putImageData(diff.img, 0, 0);
    c.toBlob((b) => b && downloadBlob(b, `diff-${timestamp()}.png`), 'image/png');
  }

  let swiping = false;
  function onSwipe(e: PointerEvent) {
    if (e.type === 'pointerdown') {
      swiping = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (!swiping) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    swipe = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
  }
  function onSwipeKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft') swipe = Math.max(0, swipe - step);
    else if (e.key === 'ArrowRight') swipe = Math.min(100, swipe + step);
    else return;
    e.preventDefault();
  }

  const pct = (r: number) => (r === 0 ? '0%' : r < 0.0001 ? '0.01% 미만' : `${(r * 100).toFixed(2)}%`);
</script>

<svelte:window onpaste={onPaste} />

{#snippet slot(side: Side)}
  {@const p = pics[side]}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="slot"
    class:dragging={dragging === side}
    ondragover={(e) => {
      e.preventDefault();
      dragging = side;
    }}
    ondragleave={() => (dragging = null)}
    ondrop={(e) => {
      e.preventDefault();
      dragging = null;
      takeFiles(side, e.dataTransfer?.files);
    }}
  >
    <b>{label[side]}</b>
    {#if p}
      <span class="name" title={p.name}>{p.name}</span>
      <span class="meta">{p.w} × {p.h}</span>
    {:else}
      <span class="hint">끌어다 놓기 · 붙여넣기(Ctrl+V)</span>
    {/if}
    <label class="btn sm ghost">
      파일
      <input
        type="file"
        accept="image/*"
        hidden
        onchange={(e) => {
          takeFiles(side, e.currentTarget.files);
          e.currentTarget.value = '';
        }}
      />
    </label>
    <button class="btn sm ghost" disabled={!p} onclick={() => clear(side)}>지우기</button>
  </div>
{/snippet}

<div class="imgdiff">
  <section class="slots" aria-label="비교할 이미지">
    {@render slot('a')}
    {@render slot('b')}
  </section>

  <div class="bar">
    <div class="seg" role="group" aria-label="보기 방식">
      <button aria-pressed={mode === 'swipe'} onclick={() => (mode = 'swipe')}>슬라이더</button>
      <button aria-pressed={mode === 'diff'} onclick={() => (mode = 'diff')}>차이 강조</button>
      <button aria-pressed={mode === 'blend'} onclick={() => (mode = 'blend')}>겹쳐 보기</button>
      <button aria-pressed={mode === 'side'} onclick={() => (mode = 'side')}>나란히</button>
    </div>
    <button class="btn sm" onclick={swap} disabled={!pics.a && !pics.b}>⇄ 바꾸기</button>
    <label class="opt" title="압축 잡음처럼 눈에 안 띄는 차이를 걸러냅니다">
      허용 오차
      <input type="range" min="0" max="50" bind:value={tolerance} />
      <span class="num">{tolerance}%</span>
    </label>
    {#if mode === 'blend'}
      <label class="opt">
        원본 투명도
        <input type="range" min="0" max="100" bind:value={opacity} />
      </label>
    {/if}
    <label class="opt"><input type="checkbox" bind:checked={actual} /> 실제 크기</label>

    <div class="right">
      {#if notice}<span class="notice" role="status">{notice}</span>{/if}
      {#if diff}
        {#if sizeDiffers}<span class="warn">크기가 다릅니다</span>{/if}
        <span class="stats" class:same={!diff.count}>
          {#if diff.count}
            다른 픽셀 {diff.count.toLocaleString('ko-KR')}개 ({pct(diff.ratio)})
          {:else}
            ✓ 두 이미지가 같습니다
          {/if}
        </span>
        <button class="btn sm" disabled={!diff.count} onclick={saveDiff}>차이 이미지 저장</button>
      {/if}
    </div>
  </div>

  {#if !both}
    <div class="empty">
      <h2>두 이미지를 비교합니다</h2>
      <p>
        픽셀 단위로 달라진 곳을 찾아 표시합니다. 스크린샷 두 장을 차례로 붙여넣거나, 파일 두 개를 한꺼번에 끌어다 놓으세요.
        <br />이미지는 이 브라우저 밖으로 나가지 않습니다.
      </p>
      <button class="btn primary" onclick={sample}>예시로 보기</button>
    </div>
  {:else}
    <div class="stage" class:actual bind:clientWidth={boxW} bind:clientHeight={boxH}>
      {#if mode === 'side'}
        <div class="pair">
          <div class="frame" style:width="{frame.w}px" style:height="{frame.h}px"><canvas use:paint={dataA}></canvas></div>
          <div class="frame" style:width="{frame.w}px" style:height="{frame.h}px"><canvas use:paint={dataB}></canvas></div>
        </div>
      {:else}
        <div class="frame" style:width="{frame.w}px" style:height="{frame.h}px">
          {#if mode === 'diff'}
            <canvas use:paint={diff?.img ?? null}></canvas>
            {#if diff?.box}
              <div
                class="box"
                style:left="{(diff.box.x / W) * 100}%"
                style:top="{(diff.box.y / H) * 100}%"
                style:width="{(diff.box.w / W) * 100}%"
                style:height="{(diff.box.h / H) * 100}%"
              ></div>
            {/if}
          {:else}
            <canvas use:paint={dataB}></canvas>
            <canvas
              class="over"
              use:paint={dataA}
              style:clip-path={mode === 'swipe' ? `inset(0 ${100 - swipe}% 0 0)` : undefined}
              style:opacity={mode === 'blend' ? opacity / 100 : undefined}
            ></canvas>
            {#if mode === 'swipe'}
              <div
                class="swipe"
                role="slider"
                tabindex="0"
                aria-label="원본과 바뀐 이미지의 경계"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={Math.round(swipe)}
                onpointerdown={onSwipe}
                onpointermove={onSwipe}
                onpointerup={() => (swiping = false)}
                onpointercancel={() => (swiping = false)}
                onkeydown={onSwipeKey}
              >
                <span class="tag l">원본</span>
                <span class="tag r">바뀐 이미지</span>
                <i style:left="{swipe}%"><b></b></i>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .imgdiff {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .slots {
    flex: none;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 10px 12px 0;
  }
  .slot {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 44px;
    padding: 0 6px 0 14px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: 13px;
  }
  .slot.dragging {
    border-color: var(--app);
    border-style: solid;
    box-shadow: 0 0 0 3px var(--app-soft);
  }
  .slot b {
    white-space: nowrap;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 12px;
  }
  .meta,
  .hint {
    color: var(--faint);
    font-size: 12px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .hint {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .slot label {
    margin-left: auto;
  }

  .bar {
    flex: none;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 12px;
    padding: 10px 12px;
  }
  .bar .seg button {
    height: 24px;
    font-size: 12.5px;
  }
  .opt {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--muted);
    white-space: nowrap;
  }
  .opt input {
    accent-color: var(--app);
    margin: 0;
  }
  .opt input[type='range'] {
    width: 96px;
  }
  .num {
    min-width: 3.2ch;
    font-variant-numeric: tabular-nums;
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
  .warn {
    font-size: 12px;
    font-weight: 650;
    padding: 2px 9px;
    border-radius: 99px;
    color: color-mix(in srgb, #f08c00 70%, var(--text));
    background: color-mix(in srgb, #f08c00 14%, var(--surface));
  }
  .stats {
    font-size: 12.5px;
    font-weight: 650;
    color: var(--bad);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .stats.same {
    color: var(--ok);
  }

  .empty {
    flex: 1;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 10px;
    padding: 24px;
    text-align: center;
  }
  .empty h2 {
    font-size: 18px;
    letter-spacing: -0.02em;
  }
  .empty p {
    max-width: 460px;
    color: var(--muted);
    font-size: 13.5px;
    line-height: 1.7;
  }
  .empty .btn {
    margin-top: 6px;
  }

  .stage {
    flex: 1;
    min-height: 0;
    margin: 0 12px 12px;
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  .stage.actual {
    overflow: auto;
    place-items: start;
  }
  .pair {
    display: flex;
    gap: 12px;
  }
  .frame {
    position: relative;
    flex: none;
    border-radius: 6px;
    overflow: hidden;
    box-shadow: 0 0 0 1px var(--border-strong);
    background: repeating-conic-gradient(var(--surface-3) 0 25%, var(--surface) 0 50%) 0 0 / 16px 16px;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .over {
    position: absolute;
    inset: 0;
  }
  .box {
    position: absolute;
    border: 1.5px dashed var(--app);
    border-radius: 3px;
    pointer-events: none;
  }
  .swipe {
    position: absolute;
    inset: 0;
    cursor: ew-resize;
    touch-action: none;
    outline-offset: -2px;
  }
  .swipe i {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: #fff;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35);
  }
  .swipe b {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 30px;
    height: 30px;
    margin: -15px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 6px rgb(0 0 0 / 0.4);
  }
  .swipe b::before {
    content: '‹ ›';
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #333;
    font: 700 13px/1 var(--font);
    font-style: normal;
  }
  .tag {
    position: absolute;
    top: 8px;
    padding: 2px 8px;
    border-radius: 99px;
    background: rgb(0 0 0 / 0.6);
    color: #fff;
    font-size: 11.5px;
    font-weight: 600;
    pointer-events: none;
  }
  .tag.l {
    left: 8px;
  }
  .tag.r {
    right: 8px;
  }

  @media (max-width: 760px) {
    .slots {
      grid-template-columns: 1fr;
      gap: 6px;
      padding: 8px 8px 0;
    }
    .bar {
      padding: 8px;
    }
    .right {
      margin-left: 0;
    }
    .stage {
      margin: 0 8px 8px;
    }
  }
</style>
