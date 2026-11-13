<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import { load, save } from '$lib/storage';
  import { downloadBlob, timestamp } from '$lib/download';
  import { receive } from '$lib/handoff';
  import { EXT, FORMAT_NAME, exifSummary, formatBytes, lossy, outputNames, savedPercent, zipStore, type ExifInfo, type Format, type Resize } from '$lib/convert/core';
  import { ConvertError, convert, probe, sampleFiles, supportedFormats, targetFormat, type Converted, type Settings } from '$lib/convert/pipeline';

  interface Item {
    id: number;
    file: File;
    kind: string;
    exif: ExifInfo | null;
    status: 'wait' | 'work' | 'done' | 'error';
    error: string;
    result: Converted | null;
    /** 결과 그림 주소 (비교 · 미리보기) */
    url: string;
    thumb: string;
  }

  const KEY = 'tools:convert:v1';
  const LIMIT = 3;
  const KIND_NAME: Record<string, string> = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', gif: 'GIF', bmp: 'BMP', heic: 'HEIC', avif: 'AVIF', svg: 'SVG' };

  const TARGETS: [number, 'KB' | 'MB'][] = [[200, 'KB'], [500, 'KB'], [1, 'MB'], [2, 'MB'], [5, 'MB']];

  let items = $state<Item[]>([]);
  let supported = $state<Format[]>(['jpeg', 'png', 'webp']);
  let ready = $state(false);
  let dragging = $state(false);
  let toast = $state('');
  let zipping = $state(false);

  // 설정
  let format = $state<Format | 'same'>('jpeg');
  let resizeMode = $state<Resize['mode']>('long');
  let longPx = $state(1920);
  let fitW = $state(1920);
  let fitH = $state(1080);
  let percent = $state(50);
  let sizing = $state<'quality' | 'target'>('quality');
  let quality = $state(82);
  let targetValue = $state(500);
  let targetUnit = $state<'KB' | 'MB'>('KB');
  let background = $state('#ffffff');
  let naming = $state({ prefix: '', suffix: '', numbered: false });

  const num = (v: unknown, lo: number, hi: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : fallback;
  };
  const settings = $derived<Settings>({
    format,
    resize:
      resizeMode === 'long'
        ? { mode: 'long', px: Math.round(num(longPx, 16, 16384, 1920)) }
        : resizeMode === 'fit'
          ? { mode: 'fit', w: Math.round(num(fitW, 1, 16384, 0)), h: Math.round(num(fitH, 1, 16384, 0)) }
          : resizeMode === 'percent'
            ? { mode: 'percent', percent: num(percent, 1, 100, 100) }
            : { mode: 'none' },
    sizing,
    quality: num(quality, 30, 100, 82) / 100,
    targetBytes: Math.round(num(targetValue, 0.001, 100000, 500) * (targetUnit === 'MB' ? 1024 * 1024 : 1024)),
    background,
  });
  const settingsKey = $derived(JSON.stringify(settings));

  const formats = $derived(items.map((it) => targetFormat(it.kind, settings, supported)));
  const names = $derived(outputNames(items.map((it) => it.file.name), formats.map((f) => EXT[f]), naming));
  const done = $derived(items.filter((it) => it.status === 'done' && it.result));
  const busy = $derived(items.some((it) => it.status === 'wait' || it.status === 'work'));
  const totals = $derived({
    before: done.reduce((n, it) => n + it.file.size, 0),
    after: done.reduce((n, it) => n + it.result!.blob.size, 0),
  });
  const gpsCount = $derived(items.filter((it) => it.exif?.hasGps).length);
  // 모든 결과가 무손실 형식이면 품질 조절이 듣지 않는다
  const noQuality = $derived(format === 'png' || (format === 'same' && items.length > 0 && formats.every((f) => !lossy(f))));

  // ── 변환 줄 세우기: 설정이 바뀌면 지금 하던 것은 버리고 처음부터 ──
  let gen = 0;
  let running = 0;
  let nextId = 1;

  function pump() {
    while (running < LIMIT) {
      const it = items.find((x) => x.status === 'wait');
      if (!it) return;
      run(it, gen);
    }
  }
  async function run(it: Item, g: number) {
    it.status = 'work';
    running++;
    const s = untrack(() => $state.snapshot(settings)) as Settings;
    try {
      const r = await convert(it.file, it.kind, s, supported, !it.thumb);
      if (g !== gen || !items.includes(it)) return;
      if (it.url) URL.revokeObjectURL(it.url);
      it.result = r;
      it.url = URL.createObjectURL(r.blob);
      if (r.thumb) it.thumb = r.thumb;
      it.error = '';
      it.status = 'done';
    } catch (e) {
      if (g !== gen || !items.includes(it)) return;
      it.error = e instanceof ConvertError ? e.message : '변환하지 못했습니다.';
      it.status = 'error';
    } finally {
      running--;
      pump();
    }
  }
  function redoAll() {
    gen++;
    for (const it of items) it.status = 'wait';
    pump();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void settingsKey;
    if (!ready) return;
    clearTimeout(timer);
    timer = setTimeout(() => untrack(redoAll), 300);
  });

  async function addFiles(list: Iterable<File>) {
    const files = [...list];
    if (!files.length) return;
    let skipped = 0;
    for (const file of files) {
      const p = await probe(file);
      if (!p.kind && !file.type.startsWith('image/')) {
        skipped++;
        continue;
      }
      items.push({ id: nextId++, file, kind: p.kind, exif: p.exif, status: 'wait', error: '', result: null, url: '', thumb: '' });
    }
    if (skipped) say(`그림이 아닌 파일 ${skipped}개는 뺐습니다`);
    pump();
  }
  function remove(it: Item) {
    if (it.url) URL.revokeObjectURL(it.url);
    items.splice(items.indexOf(it), 1);
  }
  function clearAll() {
    for (const it of items) if (it.url) URL.revokeObjectURL(it.url);
    items = [];
    gen++;
  }

  function say(msg: string) {
    toast = msg;
    setTimeout(() => toast === msg && (toast = ''), 2600);
  }

  function saveOne(it: Item) {
    if (it.result) downloadBlob(it.result.blob, names[items.indexOf(it)]);
  }
  async function saveAll() {
    if (!done.length || zipping) return;
    if (done.length === 1) return saveOne(done[0]);
    zipping = true;
    try {
      const entries = await Promise.all(done.map(async (it) => ({ name: names[items.indexOf(it)], data: new Uint8Array(await it.result!.blob.arrayBuffer()) })));
      downloadBlob(new Blob([zipStore(entries) as BlobPart], { type: 'application/zip' }), `images-${timestamp()}.zip`);
    } catch (e) {
      say(e instanceof Error ? e.message : 'ZIP 을 만들지 못했습니다');
    } finally {
      zipping = false;
    }
  }

  // ── 앞뒤 비교 ──
  let dialog: HTMLDialogElement;
  let compare = $state<{ item: Item; before: string } | null>(null);
  let split = $state(50);
  let swipeEl = $state<HTMLDivElement>();
  function openCompare(it: Item) {
    if (!it.result) return;
    compare = { item: it, before: URL.createObjectURL(it.kind === 'svg' ? new Blob([it.file], { type: 'image/svg+xml' }) : it.file) };
    split = 50;
    dialog.showModal();
  }
  function closeCompare() {
    if (compare) URL.revokeObjectURL(compare.before);
    compare = null;
  }
  function drag(e: PointerEvent) {
    if (!swipeEl || (e.type === 'pointermove' && !(e.buttons & 1))) return;
    const r = swipeEl.getBoundingClientRect();
    split = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
  }
  function onPaste(e: ClipboardEvent) {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  }
  function onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && done.length) {
      e.preventDefault();
      saveAll();
    }
  }

  onMount(() => {
    // 다른 도구(이미지 편집기)에서 넘어온 그림
    receive().then((h) => {
      if (h?.kind === 'image') addFiles([new File([h.blob], h.name, { type: h.blob.type })]);
    });
    const s = load<Record<string, any>>(KEY, {});
    if (['same', 'jpeg', 'png', 'webp', 'avif'].includes(s.format)) format = s.format;
    if (['none', 'long', 'fit', 'percent'].includes(s.resizeMode)) resizeMode = s.resizeMode;
    longPx = num(s.longPx, 16, 16384, longPx);
    fitW = num(s.fitW, 1, 16384, fitW);
    fitH = num(s.fitH, 1, 16384, fitH);
    percent = num(s.percent, 1, 100, percent);
    if (s.sizing === 'target' || s.sizing === 'quality') sizing = s.sizing;
    quality = num(s.quality, 30, 100, quality);
    targetValue = num(s.targetValue, 0.001, 100000, targetValue);
    if (s.targetUnit === 'MB' || s.targetUnit === 'KB') targetUnit = s.targetUnit;
    if (/^#[0-9a-f]{6}$/i.test(s.background)) background = s.background;
    if (s.naming) naming = { prefix: String(s.naming.prefix ?? ''), suffix: String(s.naming.suffix ?? ''), numbered: !!s.naming.numbered };
    supportedFormats().then((f) => {
      if (f.length) supported = f;
      if (format !== 'same' && !supported.includes(format)) format = 'jpeg';
      ready = true;
    });
  });
  $effect(() => {
    const snap = { format, resizeMode, longPx, fitW, fitH, percent, sizing, quality, targetValue, targetUnit, background, naming: $state.snapshot(naming) };
    if (ready) save(KEY, snap);
  });

  const dims = (s: { w: number; h: number }) => `${s.w.toLocaleString('ko-KR')} × ${s.h.toLocaleString('ko-KR')}`;
</script>

<svelte:window onpaste={onPaste} onkeydown={onKey} />

<ToolShell tool="convert">
  {#snippet actions()}
    <button class="btn primary sm" disabled={!done.length || zipping} onclick={saveAll}>
      {zipping ? '묶는 중…' : done.length > 1 ? `모두 받기 (ZIP · ${done.length}장)` : '받기'}
    </button>
  {/snippet}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="page"
    class:dragging
    ondragover={(e) => {
      e.preventDefault();
      dragging = true;
    }}
    ondragleave={(e) => {
      if (e.currentTarget === e.target) dragging = false;
    }}
    ondrop={onDrop}
  >
    <section class="panel">
      <div class="f">
        <span>형식</span>
        <div class="chips" role="group" aria-label="바꿀 형식">
          <button aria-pressed={format === 'same'} onclick={() => (format = 'same')}>원본과 같게</button>
          {#each supported as f (f)}
            <button aria-pressed={format === f} onclick={() => (format = f)}>{FORMAT_NAME[f]}</button>
          {/each}
        </div>
        {#if format === 'same'}<small>형식은 두고 크기 · 용량만 줄입니다. 저장할 수 없는 형식(HEIC · GIF 등)은 JPG 로 바꿉니다.</small>{/if}
      </div>

      <div class="f">
        <span>크기</span>
        <div class="seg" role="group" aria-label="크기 줄이기">
          <button aria-pressed={resizeMode === 'none'} onclick={() => (resizeMode = 'none')}>그대로</button>
          <button aria-pressed={resizeMode === 'long'} onclick={() => (resizeMode = 'long')}>긴 쪽</button>
          <button aria-pressed={resizeMode === 'fit'} onclick={() => (resizeMode = 'fit')}>가로 · 세로</button>
          <button aria-pressed={resizeMode === 'percent'} onclick={() => (resizeMode = 'percent')}>비율</button>
        </div>
        {#if resizeMode === 'long'}
          <div class="inline">
            <input class="field" type="number" min="16" max="16384" bind:value={longPx} aria-label="긴 쪽 픽셀" /><span>px 이하</span>
          </div>
          <div class="presets">
            {#each [1280, 1920, 2560, 3840] as p (p)}<button class:on={longPx === p} onclick={() => (longPx = p)}>{p}</button>{/each}
          </div>
        {:else if resizeMode === 'fit'}
          <div class="inline">
            <input class="field" type="number" min="1" max="16384" bind:value={fitW} aria-label="가로 픽셀" /><span>×</span>
            <input class="field" type="number" min="1" max="16384" bind:value={fitH} aria-label="세로 픽셀" /><span>px 안에</span>
          </div>
        {:else if resizeMode === 'percent'}
          <div class="inline">
            <input class="field" type="number" min="1" max="100" bind:value={percent} aria-label="비율" /><span>%</span>
          </div>
          <div class="presets">
            {#each [25, 50, 75] as p (p)}<button class:on={percent === p} onclick={() => (percent = p)}>{p}%</button>{/each}
          </div>
        {/if}
        {#if resizeMode !== 'none'}<small>비율은 그대로 두고, 원본보다 키우지는 않습니다.</small>{/if}
      </div>

      <div class="f">
        <span>용량</span>
        <div class="seg" role="group" aria-label="용량 정하기">
          <button aria-pressed={sizing === 'quality'} onclick={() => (sizing = 'quality')}>품질로</button>
          <button aria-pressed={sizing === 'target'} onclick={() => (sizing = 'target')}>목표 용량으로</button>
        </div>
        {#if sizing === 'quality'}
          <label class="slider">
            <input type="range" min="30" max="100" bind:value={quality} disabled={noQuality} aria-label="품질" />
            <b>{noQuality ? '—' : quality}</b>
          </label>
          <small>{noQuality ? 'PNG 는 화질을 잃지 않는 형식이라 품질을 고를 수 없습니다. 용량을 줄이려면 크기를 줄이세요.' : '80 안팎이면 눈으로는 차이를 알기 어렵습니다.'}</small>
        {:else}
          <div class="inline">
            <input class="field" type="number" min="1" step="any" bind:value={targetValue} aria-label="목표 용량" />
            <select class="field" bind:value={targetUnit} aria-label="단위">
              <option>KB</option>
              <option>MB</option>
            </select>
            <span>이하</span>
          </div>
          <div class="presets">
            {#each TARGETS as [v, u] (v + u)}
              <button class:on={targetValue === v && targetUnit === u} onclick={() => ((targetValue = v), (targetUnit = u))}>{v}{u}</button>
            {/each}
          </div>
          <small>{noQuality ? 'PNG 는 품질이 없어, 넘치면 크기를 줄여 맞춥니다.' : '넘지 않는 가장 좋은 품질을 한 장씩 찾습니다. 품질로 안 되면 크기도 줄입니다.'}</small>
        {/if}
      </div>

      {#if format === 'jpeg' || format === 'same'}
        <label class="f color">
          <span>투명한 곳 색 <small>— JPG 는 투명을 담지 못합니다</small></span>
          <input type="color" bind:value={background} />
        </label>
      {/if}

      <div class="f">
        <span>파일 이름</span>
        <div class="inline name">
          <input class="field" bind:value={naming.prefix} placeholder="앞에 붙일 말" aria-label="앞에 붙일 말" maxlength="40" />
          <span class="stem">{naming.numbered ? '001' : '이름'}</span>
          <input class="field" bind:value={naming.suffix} placeholder="뒤에 붙일 말" aria-label="뒤에 붙일 말" maxlength="40" />
        </div>
        <label class="check"><input type="checkbox" bind:checked={naming.numbered} /> 원래 이름 대신 번호 매기기</label>
      </div>

      <p class="note">
        <b>사진에 든 정보는 모두 빠집니다.</b> 찍은 위치 · 기기 · 시각(EXIF)은 결과에 담지 않고, 옆으로 누운 사진은 바로 세워 둡니다. 사진은 이 기기 밖으로 나가지 않습니다.
      </p>
    </section>

    <section class="main">
      {#if !items.length}
        <div class="empty">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h9A1.5 1.5 0 0 1 16 6.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 13.5zM8 18.5h10.5a1.5 1.5 0 0 0 1.5-1.5V9M4.5 12.5l3-3 3 3 2-2 3 3" />
          </svg>
          <h2>사진을 여기에 놓으세요</h2>
          <p>여러 장을 한꺼번에 끌어다 놓거나, 복사한 그림을 <kbd>Ctrl</kbd>+<kbd>V</kbd> 로 붙여넣을 수 있습니다.<br />JPG · PNG · WebP · GIF · BMP · SVG · AVIF 를 읽습니다. HEIC 는 Safari 에서 읽습니다.</p>
          <div class="row">
            <label class="btn primary">
              사진 고르기
              <input type="file" accept="image/*,.heic,.heif" multiple hidden onchange={(e) => (addFiles(e.currentTarget.files ?? []), (e.currentTarget.value = ''))} />
            </label>
            <button class="btn" onclick={async () => addFiles(await sampleFiles())}>예시 사진</button>
          </div>
        </div>
      {:else}
        <div class="bar">
          <span class="sum">
            <b>{items.length}장</b>
            {#if done.length}
              · {formatBytes(totals.before)} → <b>{formatBytes(totals.after)}</b>
              <em class:up={totals.after > totals.before}>{savedPercent(totals.before, totals.after)}</em>
            {/if}
            {#if busy}<span class="working">변환 중…</span>{/if}
          </span>
          {#if gpsCount}<span class="gps" title="결과에는 위치 정보가 들어가지 않습니다">위치 정보 {gpsCount}장 지움</span>{/if}
          <span class="grow"></span>
          <label class="btn sm">
            더 넣기
            <input type="file" accept="image/*,.heic,.heif" multiple hidden onchange={(e) => (addFiles(e.currentTarget.files ?? []), (e.currentTarget.value = ''))} />
          </label>
          <button class="btn sm ghost danger" onclick={clearAll}>모두 빼기</button>
        </div>
        <ul class="list">
          {#each items as it, i (it.id)}
            {@const r = it.result}
            <li class:stale={it.status !== 'done' && it.status !== 'error'} class:failed={it.status === 'error'}>
              <button class="thumb" disabled={!r} onclick={() => openCompare(it)} aria-label="{it.file.name} 앞뒤 비교" title="앞뒤 비교">
                {#if it.thumb}<img src={it.thumb} alt="" />{:else}<i></i>{/if}
              </button>
              <div class="info">
                <div class="names">
                  <span class="from">{it.file.name}</span>
                  {#if it.status !== 'error' && names[i] !== it.file.name}<span class="arrow">→</span><span class="to">{names[i]}</span>{/if}
                </div>
                {#if it.status === 'error'}
                  <div class="meta bad">{it.error}</div>
                {:else if r}
                  <div class="meta">
                    <span>{KIND_NAME[it.kind] ?? '그림'} → {FORMAT_NAME[r.format]}</span>
                    <span>{dims(r.src)}{#if r.out.w !== r.src.w || r.out.h !== r.src.h}{' → ' + dims(r.out)}{/if}</span>
                    {#if sizing === 'target' && lossy(r.format)}<span>품질 {Math.round(r.quality * 100)}</span>{/if}
                    {#if r.shrunk}<span class="tag">용량에 맞추려 크기도 줄임</span>{/if}
                    {#if !r.met}<span class="tag warn">목표보다 큼</span>{/if}
                    {#if it.exif?.hasGps}<span class="tag ok">위치 정보 지움</span>{:else if exifSummary(it.exif).length}<span class="tag">{exifSummary(it.exif).join(' · ')} 지움</span>{/if}
                  </div>
                {:else}
                  <div class="meta">{KIND_NAME[it.kind] ?? '그림'} · 기다리는 중</div>
                {/if}
              </div>
              <div class="size">
                {#if r}
                  <span class="before">{formatBytes(it.file.size)}</span>
                  <b>{formatBytes(r.blob.size)}</b>
                  <em class:up={r.blob.size > it.file.size}>{savedPercent(it.file.size, r.blob.size)}</em>
                {:else if it.status !== 'error'}
                  <span class="before">{formatBytes(it.file.size)}</span>
                  <span class="spin" aria-label="변환 중"></span>
                {/if}
              </div>
              <div class="acts">
                <button class="btn sm" disabled={!r} onclick={() => saveOne(it)}>받기</button>
                <button class="x" onclick={() => remove(it)} aria-label="{it.file.name} 빼기">×</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
      {#if toast}<p class="toast" role="status">{toast}</p>{/if}
    </section>

    {#if dragging}<div class="dropmask">여기에 놓으면 바로 변환합니다</div>{/if}
  </div>
</ToolShell>

<dialog bind:this={dialog} class="compare app-scope" onclose={closeCompare} onclick={(e) => e.target === dialog && dialog.close()}>
  {#if compare?.item.result}
    {@const r = compare.item.result}
    <header>
      <span class="l">원본 <b>{formatBytes(compare.item.file.size)}</b></span>
      <span class="t">{compare.item.file.name}</span>
      <span class="r">변환 <b>{formatBytes(r.blob.size)}</b> <em class:up={r.blob.size > compare.item.file.size}>{savedPercent(compare.item.file.size, r.blob.size)}</em></span>
      <button class="x" onclick={() => dialog.close()} aria-label="닫기">×</button>
    </header>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="swipe"
      bind:this={swipeEl}
      style:aspect-ratio="{r.src.w} / {r.src.h}"
      style:--w={r.src.w}
      style:--h={r.src.h}
      style:--split="{split}%"
      role="slider"
      tabindex="0"
      aria-label="원본과 변환 결과 나누는 자리"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(split)}
      onpointerdown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), drag(e))}
      onpointermove={drag}
      onkeydown={(e) => {
        if (e.key === 'ArrowLeft') split = Math.max(0, split - 5);
        else if (e.key === 'ArrowRight') split = Math.min(100, split + 5);
      }}
    >
      <img class="after" src={compare.item.url} alt="변환 결과" draggable="false" />
      <img class="before" src={compare.before} alt="원본" draggable="false" />
      <i class="handle"></i>
    </div>
    <p class="hint">가운데 선을 끌어 원본(왼쪽)과 변환 결과(오른쪽)를 견주어 보세요.</p>
  {/if}
</dialog>

<style>
  .page {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
    gap: 14px;
    padding: 14px;
    max-width: 1320px;
    width: 100%;
    margin: 0 auto;
    position: relative;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    overflow-y: auto;
  }
  .f {
    display: grid;
    gap: 7px;
    min-width: 0;
  }
  .f > span {
    font-size: 12.5px;
    font-weight: 650;
    color: var(--muted);
  }
  .f small {
    font-size: 12px;
    font-weight: 400;
    color: var(--faint);
    line-height: 1.55;
  }
  .chips,
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chips button {
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--border-strong);
    border-radius: 99px;
    background: var(--surface);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
  }
  .chips button[aria-pressed='true'] {
    border-color: var(--app);
    background: var(--app-soft);
    color: var(--text);
  }
  .presets button {
    height: 24px;
    padding: 0 9px;
    border: 0;
    border-radius: 6px;
    background: var(--surface-2);
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .presets button.on {
    background: var(--app-soft);
    color: var(--text);
    font-weight: 650;
  }
  .f .seg {
    display: flex;
  }
  .f .seg button {
    flex: 1;
    padding: 0 4px;
  }
  .inline {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
    color: var(--muted);
  }
  .inline .field {
    width: 92px;
    color: var(--text);
  }
  .inline select.field {
    width: 68px;
  }
  .inline.name .field {
    flex: 1;
    width: 0;
  }
  .stem {
    flex: none;
    padding: 2px 7px;
    border-radius: 6px;
    background: var(--surface-2);
    font-size: 12px;
  }
  .slider {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .slider input {
    flex: 1;
    accent-color: var(--app);
    margin: 0;
  }
  .slider b {
    width: 30px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .color {
    grid-template-columns: 1fr 56px;
    align-items: center;
  }
  .color input {
    width: 56px;
    height: 30px;
    padding: 2px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
  }
  .check input {
    accent-color: var(--app);
    margin: 0;
  }
  .note {
    margin-top: auto;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--app-soft);
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--muted);
  }
  .note b {
    color: var(--text);
  }

  .main {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    position: relative;
  }
  .empty {
    flex: 1;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 10px;
    padding: 30px 20px;
    border: 1.5px dashed var(--border-strong);
    border-radius: 16px;
    text-align: center;
    color: var(--muted);
  }
  .empty svg {
    color: var(--app);
  }
  .empty h2 {
    font-size: 19px;
    color: var(--text);
    letter-spacing: -0.02em;
  }
  .empty p {
    font-size: 13.5px;
    line-height: 1.75;
    max-width: 480px;
  }
  .row {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 2px 10px;
    font-size: 13.5px;
  }
  .grow {
    flex: 1;
  }
  .sum {
    font-variant-numeric: tabular-nums;
  }
  em {
    font-style: normal;
    font-weight: 700;
    color: var(--ok);
    font-variant-numeric: tabular-nums;
  }
  em.up {
    color: var(--bad);
  }
  .working {
    margin-left: 8px;
    font-size: 12.5px;
    color: var(--faint);
  }
  .gps {
    padding: 2px 9px;
    border-radius: 99px;
    font-size: 12px;
    font-weight: 650;
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 12%, var(--surface));
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    align-content: start;
    gap: 6px;
  }
  .list li {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 12px;
    padding: 8px 10px 8px 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .list li.failed {
    border-color: color-mix(in srgb, var(--bad) 40%, var(--border));
  }
  .list li.stale .size b,
  .list li.stale .size em,
  .list li.stale .meta {
    opacity: 0.45;
  }
  .thumb {
    width: 56px;
    height: 56px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    overflow: hidden;
    background: repeating-conic-gradient(var(--surface-3) 0 25%, var(--surface) 0 50%) 0 0 / 12px 12px;
  }
  .thumb:disabled {
    cursor: default;
  }
  .thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .thumb i {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--surface-2);
  }
  .info {
    min-width: 0;
    display: grid;
    gap: 3px;
  }
  .names {
    display: flex;
    gap: 6px;
    min-width: 0;
    font-size: 13.5px;
    font-weight: 600;
  }
  .names span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .names .arrow {
    flex: none;
    color: var(--faint);
  }
  .names .from:not(:last-child) {
    color: var(--faint);
    font-weight: 500;
    flex: 0 1 auto;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .meta.bad {
    color: var(--bad);
  }
  .tag {
    padding: 0 7px;
    border-radius: 99px;
    background: var(--surface-2);
  }
  .tag.ok {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 12%, var(--surface));
  }
  .tag.warn {
    color: color-mix(in srgb, #f08c00 70%, var(--text));
    background: color-mix(in srgb, #f08c00 14%, var(--surface));
  }
  .size {
    display: grid;
    justify-items: end;
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
    min-width: 76px;
  }
  .size .before {
    font-size: 11.5px;
    color: var(--faint);
    text-decoration: line-through;
  }
  .size b {
    font-size: 14px;
  }
  .size em {
    font-size: 12px;
  }
  .spin {
    width: 16px;
    height: 16px;
    margin-top: 4px;
    border: 2px solid var(--surface-3);
    border-top-color: var(--app);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .x {
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--faint);
    font-size: 18px;
    line-height: 1;
  }
  .x:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .toast {
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    padding: 7px 14px;
    border-radius: 99px;
    background: var(--text);
    color: var(--bg);
    font-size: 12.5px;
    font-weight: 600;
    white-space: nowrap;
  }
  .dropmask {
    position: absolute;
    inset: 8px;
    display: grid;
    place-items: center;
    border: 2px dashed var(--app);
    border-radius: 18px;
    background: color-mix(in srgb, var(--app) 14%, var(--bg) 80%);
    font-size: 18px;
    font-weight: 700;
    pointer-events: none;
  }

  .compare {
    width: min(96vw, 1100px);
    max-width: none;
    max-height: 94dvh;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }
  .compare::backdrop {
    background: rgb(0 0 0 / 0.6);
  }
  .compare header {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 10px 10px 10px 16px;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .compare .t {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40vw;
  }
  .compare .r {
    text-align: right;
  }
  .swipe {
    position: relative;
    /* 창 안에 다 들어오게: 너비와 높이 한계 중 작은 쪽에 맞춘다 */
    width: min(100%, calc((94dvh - 100px) * var(--w) / var(--h)));
    margin: 0 auto;
    background: repeating-conic-gradient(var(--surface-3) 0 25%, var(--surface) 0 50%) 0 0 / 16px 16px;
    cursor: ew-resize;
    touch-action: none;
    user-select: none;
  }
  .swipe img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .swipe .before {
    clip-path: inset(0 calc(100% - var(--split)) 0 0);
  }
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--split);
    width: 2px;
    margin-left: -1px;
    background: #fff;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35);
  }
  .handle::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 30px;
    height: 30px;
    margin: -15px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 6px rgb(0 0 0 / 0.5);
  }
  .hint {
    padding: 8px 16px 12px;
    font-size: 12px;
    color: var(--faint);
    text-align: center;
  }

  @media (max-width: 860px) {
    .page {
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 10px;
      gap: 10px;
    }
    .panel,
    .list {
      overflow: visible;
      flex: none;
    }
    .main {
      order: -1;
      flex: none;
      min-height: 220px;
    }
    .note {
      margin-top: 0;
    }
    .list li {
      grid-template-columns: 44px minmax(0, 1fr) auto;
      gap: 8px;
    }
    .thumb {
      width: 44px;
      height: 44px;
    }
    .acts {
      grid-column: 2 / -1;
      justify-content: flex-end;
    }
    .names {
      flex-wrap: wrap;
    }
  }
</style>
