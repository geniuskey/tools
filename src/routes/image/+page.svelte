<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import { load, save } from '$lib/storage';
  import { downloadBlob, timestamp } from '$lib/download';
  import { receive, sendTo } from '$lib/handoff';
  import { BACKGROUNDS, COLORS, Editor } from '$lib/image/editor.svelte';
  import { blankCanvas, canvasFromBlob, canvasToBlob, captureScreen, isNeutral, NO_ADJUST, type ExportFormat } from '$lib/image/raster';
  import type { Fill, Tool } from '$lib/image/shapes';

  const editor = new Editor();
  const PREFS = 'tools:image:prefs';

  let canvas: HTMLCanvasElement;
  let stage: HTMLDivElement;
  let fileInput: HTMLInputElement;
  let textInput = $state<HTMLTextAreaElement | null>(null);

  let dragging = $state(false);
  let saveOpen = $state(false);
  let sideOpen = $state(false);
  let format = $state<ExportFormat>('png');
  let quality = $state(90);
  let busy = $state(false);
  let canCapture = $state(false);
  let isMac = $state(false);

  let rw = $state(0);
  let rh = $state(0);
  let lockRatio = $state(true);

  const mod = $derived(isMac ? '⌘' : 'Ctrl+');

  const TOOLS: { id: Tool; name: string; key: string; icon: string }[] = [
    { id: 'select', name: '선택 · 이동', key: 'V', icon: 'M5 3l14 8-6.5 1.8L10.5 19z' },
    { id: 'arrow', name: '화살표', key: 'A', icon: 'M5 19L19 5M19 5h-8M19 5v8' },
    { id: 'rect', name: '사각형', key: 'R', icon: 'M5 6h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z' },
    { id: 'ellipse', name: '타원', key: 'O', icon: 'M12 5c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7-8.5-3.1-8.5-7 3.800-7 8.500-7z' },
    { id: 'line', name: '직선', key: 'L', icon: 'M5 19L19 5' },
    { id: 'pen', name: '펜', key: 'P', icon: 'M4 20l4.500-1L19.500 8l-3.500-3.500L5 15.500zM14 6.500l3.500 3.500' },
    { id: 'marker', name: '형광펜', key: 'H', icon: 'M9.500 14.500l6-9.500 4 2.600-6 9.500zM9.500 14.500L8 19l5.500-1.900M3.500 21h9' },
    { id: 'text', name: '텍스트', key: 'T', icon: 'M5 7V4.500h14V7M12 4.500v15M9 19.500h6' },
    { id: 'step', name: '번호', key: 'N', icon: 'M12 3.500a8.500 8.500 0 1 0 0 17 8.500 8.500 0 0 0 0-17zM10.300 9.800L12.500 8v8' },
    { id: 'mosaic', name: '모자이크', key: 'M', icon: 'M4 4h5v5H4zM9.500 9.500h5v5h-5zM15 4h5v5h-5zM4 15h5v5H4zM15 15h5v5h-5z' },
    { id: 'blur', name: '블러', key: 'B', icon: 'M12 3.500c4 4.800 6 8 6 10.800a6 6 0 0 1-12 0c0-2.800 2-6 6-10.800z' },
    { id: 'crop', name: '자르기', key: 'C', icon: 'M6.500 2v15.500H22M2 6.500h15.500V22' },
  ];

  const ASPECTS: { label: string; v: number | null }[] = [
    { label: '자유', v: null },
    { label: '1:1', v: 1 },
    { label: '4:3', v: 4 / 3 },
    { label: '16:9', v: 16 / 9 },
    { label: '3:4', v: 3 / 4 },
    { label: '9:16', v: 9 / 16 },
  ];

  const FILLS: { v: Fill; label: string }[] = [
    { v: 'none', label: '테두리' },
    { v: 'soft', label: '반투명' },
    { v: 'solid', label: '채움' },
  ];

  /** 옵션 막대가 보여줄 대상: 선택된 도형이 있으면 그 종류, 없으면 현재 도구 */
  const kind = $derived(editor.selected?.type ?? editor.tool);
  const has = $derived({
    color: ['rect', 'ellipse', 'arrow', 'line', 'pen', 'marker', 'text', 'step'].includes(kind),
    width: ['rect', 'ellipse', 'arrow', 'line', 'pen'].includes(kind),
    fill: kind === 'rect' || kind === 'ellipse',
    font: kind === 'text' || kind === 'step',
    boxed: kind === 'text',
    strength: kind === 'mosaic' || kind === 'blur',
  });

  $effect(() => {
    rw = editor.width;
    rh = editor.height;
  });

  $effect(() => {
    const prefs = { format, quality };
    if (canvas) save(PREFS, prefs);
  });

  // 글상자가 열리면 바로 입력할 수 있게 초점을 준다
  $effect(() => {
    if (editor.editing && textInput && document.activeElement !== textInput) {
      textInput.focus();
      textInput.setSelectionRange(textInput.value.length, textInput.value.length);
    }
  });

  onMount(() => {
    const p = load<{ format?: ExportFormat; quality?: number }>(PREFS, {});
    if (p.format === 'png' || p.format === 'jpeg' || p.format === 'webp') format = p.format;
    if (typeof p.quality === 'number') quality = Math.max(10, Math.min(100, p.quality));
    canCapture = !!navigator.mediaDevices?.getDisplayMedia;
    isMac = /Mac|iPhone|iPad/.test(navigator.platform);

    editor.attach(canvas);
    // 다른 도구(화면 녹화)에서 넘어온 그림
    receive().then((h) => {
      if (h?.kind === 'image') openBlob(h.blob, h.name);
    });
    const ro = new ResizeObserver(() => editor.resizeView());
    ro.observe(canvas);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (editor.canUndo) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      ro.disconnect();
      editor.detach();
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  });

  async function openBlob(blob: Blob, name = 'image', asLayer = false) {
    try {
      const c = await canvasFromBlob(blob);
      if (asLayer && editor.hasImage) editor.addImage(c);
      else editor.load(c, name);
    } catch {
      editor.say('이미지를 읽을 수 없습니다');
    }
  }

  function onFile(e: Event) {
    const el = e.target as HTMLInputElement;
    const f = el.files?.[0];
    if (f) openBlob(f, f.name);
    el.value = '';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (f) openBlob(f, f.name, e.shiftKey);
    else editor.say('이미지 파일만 열 수 있습니다');
  }

  function onPaste(e: ClipboardEvent) {
    if (isTyping(e.target)) return;
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    const f = item?.getAsFile();
    if (!f) return;
    e.preventDefault();
    openBlob(f, `붙여넣기-${timestamp()}`, true);
  }

  async function capture() {
    try {
      const c = await captureScreen();
      editor.load(c, `캡처-${timestamp()}`);
    } catch (err) {
      // 사용자가 공유 창을 닫은 경우는 조용히 넘어간다
      if ((err as Error)?.name !== 'NotAllowedError') editor.say('화면을 캡처할 수 없습니다');
    }
  }

  function newBlank() {
    editor.load(blankCanvas(1280, 720, '#ffffff'), '새 캔버스');
  }

  async function copyImage() {
    if (!editor.hasImage || busy) return;
    busy = true;
    try {
      const blob = canvasToBlob(editor.exportCanvas(), 'png', 1);
      // 사파리는 ClipboardItem 에 Promise 를 넘겨야 사용자 동작으로 인정한다
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      editor.say('이미지를 클립보드에 복사했습니다');
    } catch {
      editor.say('이 브라우저에서는 이미지 복사를 쓸 수 없습니다. 저장을 이용하세요');
    } finally {
      busy = false;
    }
  }

  /** 지금 그림을 일괄 변환으로 넘긴다 (목표 용량 · 다른 형식). 편집기는 그대로 남는다 */
  function toConvert() {
    if (!editor.hasImage) return;
    const name = `${editor.name}.png`;
    const ok = sendTo('/convert', canvasToBlob(editor.exportCanvas(), 'png', 1).then((blob) => ({ kind: 'image' as const, blob, name })));
    if (!ok) editor.say('새 탭을 열 수 없습니다. 팝업 차단을 풀어 주세요');
    saveOpen = false;
  }

  async function saveImage() {
    if (!editor.hasImage || busy) return;
    busy = true;
    try {
      const blob = await canvasToBlob(editor.exportCanvas(), format, quality / 100);
      downloadBlob(blob, `${editor.name}.${format === 'jpeg' ? 'jpg' : format}`);
      saveOpen = false;
    } catch {
      editor.say('이미지를 저장할 수 없습니다');
    } finally {
      busy = false;
    }
  }

  function isTyping(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    if (!el?.closest) return false;
    if (el.closest('textarea, select, [contenteditable]')) return true;
    const input = el.closest('input');
    return !!input && !['range', 'checkbox', 'radio', 'button', 'color'].includes(input.type);
  }

  function onKeydown(e: KeyboardEvent) {
    if (isTyping(e.target)) return;
    const cmd = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();

    if (e.key === ' ' && !cmd) {
      if (!(e.target as HTMLElement).closest('button')) e.preventDefault();
      editor.spaceDown = true;
      editor.cursor = 'grab';
      return;
    }
    if (cmd) {
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (k === 'y') {
        e.preventDefault();
        editor.redo();
      } else if (k === 's') {
        e.preventDefault();
        saveImage();
      } else if (k === 'c' && !getSelection()?.toString()) {
        e.preventDefault();
        copyImage();
      } else if (k === 'd') {
        e.preventDefault();
        editor.duplicateSelected();
      } else if (k === 'o') {
        e.preventDefault();
        fileInput.click();
      } else if (k === '0') {
        e.preventDefault();
        editor.fit();
      } else if (k === '1') {
        e.preventDefault();
        editor.zoomTo(1);
      } else if (k === '=' || k === '+') {
        e.preventDefault();
        editor.zoomBy(1.25);
      } else if (k === '-') {
        e.preventDefault();
        editor.zoomBy(0.8);
      }
      return;
    }
    if (e.altKey) return;

    if (e.key === 'Escape') {
      if (saveOpen) saveOpen = false;
      else if (editor.tool === 'crop') editor.cancelCrop();
      else if (editor.selectedId) editor.deselect();
      else editor.setTool('select');
      return;
    }
    if (e.key === 'Enter' && editor.tool === 'crop') {
      e.preventDefault();
      editor.applyCrop();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (editor.selectedId) {
        e.preventDefault();
        editor.deleteSelected();
      }
      return;
    }
    if (e.key.startsWith('Arrow') && editor.selectedId) {
      const step = (e.shiftKey ? 10 : 1) / Math.min(1, editor.zoom);
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      if (editor.nudge(dx, dy)) e.preventDefault();
      return;
    }
    if (e.key === ']') return editor.reorder('front');
    if (e.key === '[') return editor.reorder('back');
    if (e.key === '+' || e.key === '=') return editor.zoomBy(1.25);
    if (e.key === '-') return editor.zoomBy(0.8);
    const t = TOOLS.find((x) => x.key.toLowerCase() === k);
    if (t) editor.setTool(t.id);
  }

  function onKeyup(e: KeyboardEvent) {
    if (e.key === ' ') {
      editor.spaceDown = false;
      editor.cursor = 'default';
    }
  }

  function onCanvasPointerDown(e: PointerEvent) {
    // 슬라이더 등에 남은 초점을 풀어야 단축키가 다시 동작한다
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && a !== textInput) a.blur();
    saveOpen = false;
    editor.pointerDown(e);
  }

  function onTextKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      editor.endEdit();
    }
  }

  function setW(v: number) {
    rw = v;
    if (lockRatio && editor.width) rh = Math.max(1, Math.round((v * editor.height) / editor.width));
  }
  function setH(v: number) {
    rh = v;
    if (lockRatio && editor.height) rw = Math.max(1, Math.round((v * editor.width) / editor.height));
  }
  function applyResize() {
    if (rw >= 1 && rh >= 1) editor.resize(rw, rh);
  }

  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
</script>

<svelte:window onkeydown={onKeydown} onkeyup={onKeyup} onpaste={onPaste} onblur={() => (editor.spaceDown = false)} />

{#snippet icon(d: string)}
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path {d} /></svg>
{/snippet}

{#snippet slider(label: string, value: number, min: number, max: number, oninput: (v: number) => void, onchange: (v: number) => void, unit = '')}
  <label class="slider">
    <span class="s-label">{label}</span>
    <input type="range" {min} {max} {value} oninput={(e) => oninput(num(e))} onchange={(e) => onchange(num(e))} />
    <span class="s-val">{Math.round(value)}{unit}</span>
  </label>
{/snippet}

<ToolShell tool="image">
  {#snippet actions()}
    <button class="btn sm" onclick={() => fileInput.click()} title="이미지 열기 ({mod}O)">열기</button>
    {#if canCapture}<button class="btn sm hide-s" onclick={capture} title="화면이나 창을 캡처">화면 캡처</button>{/if}
    <span class="divider"></span>
    <button class="btn sm ghost iconbtn" disabled={!editor.canUndo} onclick={() => editor.undo()} title="실행 취소 ({mod}Z)" aria-label="실행 취소">
      {@render icon('M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3')}
    </button>
    <button class="btn sm ghost iconbtn" disabled={!editor.canRedo} onclick={() => editor.redo()} title="다시 실행 ({mod}⇧Z)" aria-label="다시 실행">
      {@render icon('M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3')}
    </button>
    <span class="divider"></span>
    <button class="btn sm" disabled={!editor.hasImage || busy} onclick={copyImage} title="클립보드에 복사 ({mod}C)">복사</button>
    <div class="save-wrap">
      <button class="btn sm primary" disabled={!editor.hasImage} onclick={() => (saveOpen = !saveOpen)} aria-expanded={saveOpen}>저장</button>
      {#if saveOpen}
        <div class="popover" role="dialog" aria-label="저장 옵션">
          <div class="seg">
            <button aria-pressed={format === 'png'} onclick={() => (format = 'png')}>PNG</button>
            <button aria-pressed={format === 'jpeg'} onclick={() => (format = 'jpeg')}>JPEG</button>
            <button aria-pressed={format === 'webp'} onclick={() => (format = 'webp')}>WebP</button>
          </div>
          {#if format !== 'png'}
            {@render slider('품질', quality, 10, 100, (v) => (quality = v), (v) => (quality = v))}
          {:else}
            <p class="pop-note">무손실. 스크린샷과 글자에 알맞습니다.</p>
          {/if}
          <label class="fname">
            <span>파일 이름</span>
            <input class="field" bind:value={editor.name} spellcheck="false" />
          </label>
          <button class="btn primary" disabled={busy} onclick={saveImage}>내려받기 <kbd>{mod}S</kbd></button>
          <button class="btn" onclick={toConvert} title="목표 용량에 맞추거나 다른 형식으로 바꿉니다. 새 탭에서 열립니다">일괄 변환으로 보내기 ↗</button>
        </div>
      {/if}
    </div>
    <button class="btn sm ghost side-toggle" onclick={() => (sideOpen = !sideOpen)} aria-expanded={sideOpen}>조정</button>
  {/snippet}

  <input bind:this={fileInput} type="file" accept="image/*" hidden onchange={onFile} />

  <div class="editor">
    <div class="toolbar" role="toolbar" aria-label="도구" aria-orientation="vertical">
      {#each TOOLS as t (t.id)}
        <button
          class="tool"
          aria-pressed={editor.tool === t.id}
          aria-label="{t.name} ({t.key})"
          disabled={!editor.hasImage && t.id !== 'select'}
          onclick={() => editor.setTool(t.id)}
        >
          {@render icon(t.icon)}
          <span class="tip">{t.name} <kbd>{t.key}</kbd></span>
        </button>
      {/each}
    </div>

    <div class="work">
      <div class="options" class:empty={!editor.hasImage}>
        {#if !editor.hasImage}
          <span class="hint">이미지를 열면 편집 도구를 쓸 수 있습니다.</span>
        {:else if editor.tool === 'crop'}
          <span class="opt-title">자르기</span>
          <div class="seg">
            {#each ASPECTS as a (a.label)}
              <button aria-pressed={editor.cropAspect === a.v} onclick={() => editor.setCropAspect(a.v)}>{a.label}</button>
            {/each}
          </div>
          {#if editor.crop}
            <span class="dim">{Math.round(editor.crop.w)} × {Math.round(editor.crop.h)}</span>
          {/if}
          <span class="spacer"></span>
          <button class="btn sm" onclick={() => editor.cancelCrop()}>취소 <kbd>Esc</kbd></button>
          <button class="btn sm primary" onclick={() => editor.applyCrop()}>자르기 적용 <kbd>Enter</kbd></button>
        {:else}
          {#if has.color}
            <div class="swatches" role="group" aria-label="색">
              {#each COLORS as c (c)}
                <button
                  class="swatch"
                  style:--c={c}
                  aria-pressed={editor.style.color.toLowerCase() === c}
                  aria-label="색 {c}"
                  onclick={() => editor.setStyle({ color: c })}
                ></button>
              {/each}
              <label class="swatch custom" title="다른 색" style:--c={editor.style.color}>
                <input
                  type="color"
                  value={editor.style.color}
                  oninput={(e) => editor.setStyle({ color: e.currentTarget.value }, false)}
                  onchange={(e) => editor.setStyle({ color: e.currentTarget.value })}
                  aria-label="다른 색 고르기"
                />
              </label>
            </div>
          {/if}
          {#if has.width}
            {@render slider('굵기', editor.style.width, 1, 40, (v) => editor.setStyle({ width: v }, false), () => editor.commitIfSelected())}
          {/if}
          {#if has.fill}
            <div class="seg">
              {#each FILLS as f (f.v)}
                <button aria-pressed={editor.style.fill === f.v} onclick={() => editor.setStyle({ fill: f.v })}>{f.label}</button>
              {/each}
            </div>
          {/if}
          {#if has.font}
            {@render slider('크기', editor.style.fontSize, 8, 200, (v) => editor.setStyle({ fontSize: v }, false), () => editor.commitIfSelected())}
          {/if}
          {#if has.boxed}
            <div class="seg">
              <button aria-pressed={!editor.style.boxed} onclick={() => editor.setStyle({ boxed: false })}>글자만</button>
              <button aria-pressed={editor.style.boxed} onclick={() => editor.setStyle({ boxed: true })}>배경 상자</button>
            </div>
          {/if}
          {#if has.strength}
            {@render slider('강도', editor.style.strength, 2, 80, (v) => editor.setStyle({ strength: v }, false), () => editor.commitIfSelected())}
            <span class="dim note">민감한 정보는 <button class="link" onclick={() => { editor.setTool('rect'); editor.setStyle({ fill: 'solid', color: '#111111' }); }}>채운 사각형</button>으로 가리는 것이 가장 안전합니다.</span>
          {/if}
          {#if kind === 'select'}
            <span class="hint">도형을 눌러 선택하거나, 빈 곳을 끌어 화면을 옮깁니다. <kbd>{mod}V</kbd> 로 이미지를 더 얹을 수 있어요.</span>
          {/if}
          {#if editor.selected}
            <span class="spacer"></span>
            <button class="btn sm ghost" onclick={() => editor.duplicateSelected()} title="복제 ({mod}D)">복제</button>
            <button class="btn sm ghost" onclick={() => editor.reorder('front')} title="맨 앞으로 ( ] )">앞으로</button>
            <button class="btn sm ghost" onclick={() => editor.reorder('back')} title="맨 뒤로 ( [ )">뒤로</button>
            <button class="btn sm ghost danger" onclick={() => editor.deleteSelected()} title="삭제 (Delete)">삭제</button>
          {/if}
        {/if}
      </div>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="stage"
        class:dragging
        bind:this={stage}
        ondragover={(e) => {
          e.preventDefault();
          dragging = true;
        }}
        ondragleave={(e) => {
          if (e.target === stage) dragging = false;
        }}
        ondrop={onDrop}
      >
        <canvas
          bind:this={canvas}
          style:cursor={editor.cursor}
          onpointerdown={onCanvasPointerDown}
          onpointermove={(e) => editor.pointerMove(e)}
          onpointerup={(e) => editor.pointerUp(e)}
          onpointercancel={(e) => editor.pointerUp(e)}
          onmousedown={(e) => e.preventDefault()}
          ondblclick={(e) => editor.dblClick(e)}
          onwheel={(e) => editor.wheel(e)}
          oncontextmenu={(e) => e.preventDefault()}
        ></canvas>

        {#if editor.editing}
          <textarea
            bind:this={textInput}
            class="text-edit"
            class:boxed={editor.editing.boxed}
            style:left="{editor.editing.left}px"
            style:top="{editor.editing.top}px"
            style:font-size="{editor.editing.fontSize}px"
            style:--c={editor.editing.color}
            rows={editor.editing.text.split('\n').length}
            value={editor.editing.text}
            spellcheck="false"
            placeholder="글자 입력"
            aria-label="글자 입력"
            oninput={(e) => editor.updateEditText(e.currentTarget.value)}
            onkeydown={onTextKeydown}
            onblur={() => editor.endEdit()}
          ></textarea>
        {/if}

        {#if !editor.hasImage}
          <div class="empty-state">
            <div class="drop-card">
              <svg viewBox="0 0 48 48" width="52" height="52" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="6" y="9" width="36" height="30" rx="4" />
                <circle cx="17" cy="19" r="3.500" />
                <path d="M6 33l10-9 7 6 6-5 13 11" />
              </svg>
              <h2>스크린샷을 붙여넣으세요</h2>
              <p><kbd>{mod}V</kbd> 로 붙여넣거나, 이미지 파일을 여기로 끌어다 놓으세요.</p>
              <div class="empty-actions">
                <button class="btn primary" onclick={() => fileInput.click()}>이미지 열기</button>
                {#if canCapture}<button class="btn" onclick={capture}>화면 캡처</button>{/if}
                <button class="btn" onclick={newBlank}>빈 캔버스</button>
              </div>
              <p class="privacy">이미지는 이 브라우저 안에서만 처리되며 어디로도 전송되지 않습니다.</p>
            </div>
          </div>
        {/if}

        {#if dragging}<div class="drop-overlay">여기에 놓아 열기</div>{/if}
        {#if editor.toast}<div class="toast" role="status">{editor.toast}</div>{/if}
      </div>

      <div class="status">
        {#if editor.hasImage}
          <span>{editor.width} × {editor.height}px</span>
          {#if editor.shapeCount}<span>주석 {editor.shapeCount}개</span>{/if}
          <span class="spacer"></span>
          <button class="zbtn" onclick={() => editor.zoomBy(0.8)} aria-label="축소">−</button>
          <button class="zval" onclick={() => editor.zoomTo(1)} title="100% 로 보기 ({mod}1)">{Math.round(editor.zoom * 100)}%</button>
          <button class="zbtn" onclick={() => editor.zoomBy(1.25)} aria-label="확대">+</button>
          <button class="zfit" onclick={() => editor.fit()} title="화면에 맞추기 ({mod}0)">맞춤</button>
        {:else}
          <span>PNG · JPEG · WebP · GIF · SVG · AVIF 를 열 수 있습니다</span>
        {/if}
      </div>
    </div>

    <aside class="side" class:open={sideOpen} aria-label="이미지 조정">
      <fieldset disabled={!editor.hasImage}>
        <section>
          <h3>이미지</h3>
          <div class="size-row">
            <label>너비 <input class="field" type="number" min="1" max="16384" value={rw} oninput={(e) => setW(num(e))} /></label>
            <button class="lock" aria-pressed={lockRatio} onclick={() => (lockRatio = !lockRatio)} title="비율 고정" aria-label="비율 고정">
              {@render icon(lockRatio ? 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z' : 'M7 11V8a5 5 0 0 1 9.500-2M6 11h12v9H6z')}
            </button>
            <label>높이 <input class="field" type="number" min="1" max="16384" value={rh} oninput={(e) => setH(num(e))} /></label>
          </div>
          <div class="btn-row">
            {#each [0.5, 0.75, 2] as f (f)}
              <button class="btn sm" onclick={() => { rw = Math.round(editor.width * f); rh = Math.round(editor.height * f); }}>{f * 100}%</button>
            {/each}
            <button class="btn sm primary" disabled={rw === editor.width && rh === editor.height} onclick={applyResize}>크기 적용</button>
          </div>
          <div class="btn-row four">
            <button class="btn sm" onclick={() => editor.rotate('ccw')} title="왼쪽으로 90° 회전" aria-label="왼쪽으로 회전">{@render icon('M4 9V4M4 9h5M4.500 9A8 8 0 1 1 4 13')}</button>
            <button class="btn sm" onclick={() => editor.rotate('cw')} title="오른쪽으로 90° 회전" aria-label="오른쪽으로 회전">{@render icon('M20 9V4M20 9h-5M19.500 9A8 8 0 1 0 20 13')}</button>
            <button class="btn sm" onclick={() => editor.flip('h')} title="좌우 뒤집기" aria-label="좌우 뒤집기">{@render icon('M12 3v18M8 7l-5 5 5 5zM16 7l5 5-5 5z')}</button>
            <button class="btn sm" onclick={() => editor.flip('v')} title="상하 뒤집기" aria-label="상하 뒤집기">{@render icon('M3 12h18M7 8l5-5 5 5zM7 16l5 5 5-5z')}</button>
          </div>
        </section>

        <section>
          <h3>
            보정
            <button class="link" disabled={isNeutral(editor.adjust)} onclick={() => editor.setAdjust({ ...NO_ADJUST }, true)}>초기화</button>
          </h3>
          {@render slider('밝기', editor.adjust.brightness, -100, 100, (v) => editor.setAdjust({ brightness: v }, false), (v) => editor.setAdjust({ brightness: v }, true))}
          {@render slider('대비', editor.adjust.contrast, -100, 100, (v) => editor.setAdjust({ contrast: v }, false), (v) => editor.setAdjust({ contrast: v }, true))}
          {@render slider('채도', editor.adjust.saturation, -100, 100, (v) => editor.setAdjust({ saturation: v }, false), (v) => editor.setAdjust({ saturation: v }, true))}
          <div class="checks">
            <label><input type="checkbox" checked={editor.adjust.gray} onchange={(e) => editor.setAdjust({ gray: e.currentTarget.checked }, true)} /> 흑백</label>
            <label><input type="checkbox" checked={editor.adjust.invert} onchange={(e) => editor.setAdjust({ invert: e.currentTarget.checked }, true)} /> 색 반전</label>
          </div>
        </section>

        <section>
          <h3>
            배경 꾸미기
            <label class="switch">
              <input type="checkbox" checked={editor.frame.enabled} onchange={(e) => editor.setFrame({ enabled: e.currentTarget.checked }, true)} />
              <span></span>
            </label>
          </h3>
          {#if editor.frame.enabled}
            <div class="bgs" role="group" aria-label="배경">
              {#each BACKGROUNDS as b (b.id)}
                <button
                  class="bg"
                  class:none={b.stops.length === 0}
                  style:background={b.stops.length > 1 ? `linear-gradient(135deg, ${b.stops.join(', ')})` : b.stops[0]}
                  aria-pressed={editor.frame.bg === b.id}
                  aria-label={b.name}
                  title={b.name}
                  onclick={() => editor.setFrame({ bg: b.id }, true)}
                ></button>
              {/each}
            </div>
            {@render slider('여백', editor.frame.padding, 0, 400, (v) => editor.setFrame({ padding: v }, false), (v) => editor.setFrame({ padding: v }, true))}
            {@render slider('둥글기', editor.frame.radius, 0, 80, (v) => editor.setFrame({ radius: v }, false), (v) => editor.setFrame({ radius: v }, true))}
            {@render slider('그림자', editor.frame.shadow, 0, 120, (v) => editor.setFrame({ shadow: v }, false), (v) => editor.setFrame({ shadow: v }, true))}
          {:else}
            <p class="side-note">스크린샷 둘레에 배경과 그림자를 넣어 발표 자료나 SNS 에 올리기 좋게 만듭니다.</p>
          {/if}
        </section>

        <section>
          <h3>단축키</h3>
          <dl class="keys">
            <dt><kbd>Space</kbd> + 끌기</dt><dd>화면 이동</dd>
            <dt><kbd>{mod}</kbd> + 휠</dt><dd>확대 · 축소</dd>
            <dt><kbd>Shift</kbd> + 끌기</dt><dd>정사각형 · 45° · 직선</dd>
            <dt><kbd>←↑↓→</kbd></dt><dd>선택한 도형 옮기기</dd>
            <dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>맨 뒤 · 맨 앞으로</dd>
            <dt>두 번 누르기</dt><dd>글자 고치기</dd>
          </dl>
          <button class="btn sm ghost danger clear" disabled={!editor.shapeCount} onclick={() => editor.clearShapes()}>주석 모두 지우기</button>
        </section>
      </fieldset>
    </aside>
  </div>
</ToolShell>

<style>
  .divider {
    width: 1px;
    height: 18px;
    background: var(--border);
    margin: 0 2px;
  }
  .iconbtn {
    width: 30px;
    padding: 0;
  }
  .save-wrap {
    position: relative;
  }
  .popover {
    position: absolute;
    z-index: 30;
    top: calc(100% + 8px);
    right: 0;
    width: 260px;
    display: grid;
    gap: 12px;
    padding: 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--shadow-lg);
  }
  .popover .seg {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }
  .pop-note {
    font-size: 12.5px;
    color: var(--muted);
  }
  .fname {
    display: grid;
    gap: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }
  .popover .btn kbd {
    background: transparent;
    border-color: color-mix(in srgb, var(--on-app) 40%, transparent);
    color: inherit;
  }
  .side-toggle {
    display: none;
  }

  .editor {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) 272px;
  }
  .toolbar {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 0;
    background: var(--surface);
    border-right: 1px solid var(--border);
    overflow: visible;
    z-index: 5;
  }
  .tool {
    position: relative;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--muted);
  }
  .tool:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }
  .tool[aria-pressed='true'] {
    background: var(--app);
    color: var(--on-app);
  }
  .tool:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .tip {
    position: absolute;
    left: calc(100% + 8px);
    top: 50%;
    transform: translateY(-50%);
    display: none;
    align-items: center;
    gap: 6px;
    padding: 5px 9px;
    border-radius: 8px;
    background: var(--text);
    color: var(--bg);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    pointer-events: none;
  }
  .tip kbd {
    background: transparent;
    border-color: color-mix(in srgb, var(--bg) 40%, transparent);
    color: inherit;
  }
  .tool:hover .tip,
  .tool:focus-visible .tip {
    display: inline-flex;
  }

  .work {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .options {
    flex: none;
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 46px;
    padding: 6px 12px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    white-space: nowrap;
  }
  .opt-title {
    font-weight: 700;
    font-size: 13.5px;
  }
  .hint,
  .dim {
    font-size: 12.5px;
    color: var(--faint);
  }
  .dim {
    font-variant-numeric: tabular-nums;
  }
  .spacer {
    flex: 1;
  }
  .link {
    border: 0;
    background: transparent;
    padding: 0;
    color: var(--app);
    font-size: inherit;
    font-weight: 650;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link:disabled {
    color: var(--faint);
    text-decoration: none;
    cursor: default;
  }
  .swatches {
    display: flex;
    gap: 5px;
    flex: none;
  }
  .swatch {
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid rgb(128 128 128 / 0.45);
    background: var(--c);
    position: relative;
    flex: none;
  }
  .swatch[aria-pressed='true'] {
    outline: 2px solid var(--app);
    outline-offset: 2px;
  }
  .swatch.custom {
    background: conic-gradient(#f03e3e, #fab005, #40c057, #228be6, #be4bdb, #f03e3e);
    cursor: pointer;
    overflow: hidden;
  }
  .swatch.custom::after {
    content: '';
    position: absolute;
    inset: 5px;
    border-radius: 50%;
    background: var(--c);
    border: 1px solid rgb(128 128 128 / 0.4);
  }
  .swatch.custom input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
  }

  .slider {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    flex: none;
  }
  .s-label {
    color: var(--muted);
    font-weight: 600;
    flex: none;
  }
  .slider input {
    width: 110px;
    accent-color: var(--app);
    min-width: 0;
  }
  .s-val {
    width: 30px;
    text-align: right;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    flex: none;
  }

  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background-color: var(--surface-3);
    background-image: radial-gradient(color-mix(in srgb, var(--faint) 30%, transparent) 1px, transparent 1px);
    background-size: 18px 18px;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
  }
  .text-edit {
    position: absolute;
    z-index: 3;
    margin: 0;
    padding: 0;
    border: 0;
    outline: 1.5px dashed var(--app);
    outline-offset: 4px;
    background: transparent;
    color: var(--c);
    font-family: var(--font);
    font-weight: 650;
    line-height: 1.3;
    resize: none;
    overflow: hidden;
    white-space: pre;
    min-width: 2em;
    field-sizing: content;
    caret-color: var(--app);
  }
  .text-edit.boxed {
    outline-offset: calc(0.38em + 2px);
    box-shadow: 0 0 0 0.38em var(--c);
    background: var(--c);
    color: #fff;
    border-radius: 0.01em;
    mix-blend-mode: normal;
  }
  .text-edit::placeholder {
    color: var(--c);
    opacity: 0.45;
  }
  .text-edit.boxed::placeholder {
    color: #fff;
  }

  .empty-state {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 20px;
    overflow: auto;
  }
  .drop-card {
    display: grid;
    justify-items: center;
    gap: 10px;
    max-width: 460px;
    padding: 38px 30px 30px;
    text-align: center;
    background: var(--surface);
    border: 1.5px dashed var(--border-strong);
    border-radius: 20px;
    color: var(--muted);
  }
  .drop-card svg {
    color: var(--app);
  }
  .drop-card h2 {
    font-size: 21px;
    letter-spacing: -0.02em;
    color: var(--text);
  }
  .drop-card p {
    font-size: 14px;
  }
  .empty-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin: 10px 0 6px;
  }
  .privacy {
    font-size: 12px !important;
    color: var(--faint);
  }
  .drop-overlay {
    position: absolute;
    inset: 10px;
    z-index: 6;
    display: grid;
    place-items: center;
    border: 2px dashed var(--app);
    border-radius: 16px;
    background: color-mix(in srgb, var(--app) 14%, transparent);
    color: var(--app);
    font-size: 18px;
    font-weight: 700;
    pointer-events: none;
  }
  .toast {
    position: absolute;
    z-index: 7;
    left: 50%;
    bottom: 18px;
    transform: translateX(-50%);
    padding: 8px 16px;
    border-radius: 99px;
    background: var(--text);
    color: var(--bg);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: var(--shadow-md);
    max-width: calc(100% - 24px);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 30px;
    padding: 0 8px 0 12px;
    background: var(--surface);
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
  }
  .status button {
    border: 0;
    background: transparent;
    height: 22px;
    border-radius: 5px;
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .status button:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .zbtn {
    width: 22px;
    font-size: 15px !important;
  }
  .zval {
    min-width: 46px;
  }
  .status .spacer + button {
    margin-left: -8px;
  }

  .side {
    background: var(--surface);
    border-left: 1px solid var(--border);
    overflow-y: auto;
    min-height: 0;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  fieldset:disabled {
    opacity: 0.45;
  }
  .side section {
    display: grid;
    gap: 10px;
    padding: 14px;
    border-bottom: 1px solid var(--border);
  }
  .side h3 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--muted);
  }
  .side h3 .link {
    font-size: 12px;
  }
  .side .slider {
    display: grid;
    grid-template-columns: 44px 1fr 34px;
  }
  .side .slider input {
    width: 100%;
  }
  .size-row {
    display: grid;
    grid-template-columns: 1fr 30px 1fr;
    align-items: end;
    gap: 6px;
  }
  .size-row label {
    display: grid;
    gap: 3px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--faint);
  }
  .size-row .field {
    width: 100%;
    height: 30px;
    font-size: 13px;
    padding: 0 8px;
  }
  .lock {
    display: grid;
    place-items: center;
    height: 30px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--faint);
  }
  .lock[aria-pressed='true'] {
    color: var(--app);
    background: var(--app-soft);
  }
  .btn-row {
    display: flex;
    gap: 5px;
  }
  .btn-row .btn {
    flex: 1;
    padding: 0 6px;
  }
  .btn-row .primary {
    flex: 1.6;
  }
  .checks {
    display: flex;
    gap: 16px;
    font-size: 13px;
  }
  .checks label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .checks input {
    accent-color: var(--app);
  }
  .switch {
    position: relative;
    display: inline-flex;
    cursor: pointer;
  }
  .switch input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
    z-index: 1;
    width: 100%;
    height: 100%;
  }
  .switch span {
    width: 34px;
    height: 20px;
    border-radius: 99px;
    background: var(--border-strong);
    transition: background 0.15s;
    position: relative;
  }
  .switch span::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
  }
  .switch input:checked + span {
    background: var(--app);
  }
  .switch input:checked + span::after {
    transform: translateX(14px);
  }
  .switch input:focus-visible + span {
    outline: 2px solid var(--app);
    outline-offset: 2px;
  }
  .bgs {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 6px;
  }
  .bg {
    aspect-ratio: 1;
    border-radius: 8px;
    border: 1px solid rgb(128 128 128 / 0.35);
    padding: 0;
  }
  .bg.none {
    background:
      repeating-conic-gradient(#d5d8dd 0% 25%, #fff 0% 50%) 50% / 10px 10px;
  }
  .bg[aria-pressed='true'] {
    outline: 2px solid var(--app);
    outline-offset: 2px;
  }
  .side-note {
    font-size: 12.5px;
    color: var(--faint);
    line-height: 1.6;
  }
  .keys {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 12px;
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
  .keys dd {
    margin: 0;
    color: var(--faint);
  }
  .clear {
    justify-self: start;
    margin-top: 4px;
  }

  @media (max-width: 900px) {
    .editor {
      grid-template-columns: 48px minmax(0, 1fr);
    }
    .side-toggle {
      display: inline-flex;
    }
    .side {
      position: fixed;
      z-index: 25;
      top: 48px;
      right: 0;
      bottom: 0;
      width: min(290px, 88vw);
      transform: translateX(100%);
      transition: transform 0.2s ease;
      box-shadow: var(--shadow-lg);
      visibility: hidden;
    }
    .side.open {
      transform: none;
      visibility: visible;
    }
  }
  @media (max-width: 600px) {
    .editor {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
    }
    .toolbar {
      grid-row: 2;
      flex-direction: row;
      justify-content: flex-start;
      padding: 6px 8px max(6px, env(safe-area-inset-bottom));
      border-right: 0;
      border-top: 1px solid var(--border);
      overflow-x: auto;
    }
    .tool {
      flex: none;
      width: 40px;
      height: 40px;
    }
    .tip {
      display: none !important;
    }
    :global(.hide-s),
    .divider {
      display: none;
    }
    .note {
      display: none;
    }
  }
</style>
