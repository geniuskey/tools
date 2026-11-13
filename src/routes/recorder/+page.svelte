<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import { downloadBlob, timestamp } from '$lib/download';
  import { sendTo } from '$lib/handoff';
  import { addToHistogram, buildPalette, GifEncoder, mapPixels, newHistogram } from '$lib/recorder/gif';

  type Phase = 'idle' | 'recording' | 'edit';
  interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  let phase = $state<Phase>('idle');
  let notice = $state('');
  let dragOver = $state(false);

  // ── 녹화 ──────────────────────────────────────────────
  let withMic = $state(false);
  let withSystem = $state(true);
  let paused = $state(false);
  let elapsed = $state(0);
  let recBytes = $state(0);
  let live = $state<HTMLVideoElement>();
  let recorder: MediaRecorder | null = null;
  let streams: MediaStream[] = [];
  let audioCtx: AudioContext | null = null;
  let timer = 0;

  const canCapture = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  function pickMime(kind: 'webm' | 'mp4'): string {
    const list =
      kind === 'webm'
        ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        : ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'];
    if (typeof MediaRecorder === 'undefined') return '';
    return list.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  }
  const mp4 = pickMime('mp4');
  const webm = pickMime('webm');

  function flash(msg: string) {
    notice = msg;
    setTimeout(() => notice === msg && (notice = ''), 5000);
  }

  function stopStreams() {
    for (const s of streams) for (const t of s.getTracks()) t.stop();
    streams = [];
    audioCtx?.close().catch(() => {});
    audioCtx = null;
    clearInterval(timer);
  }

  async function startRecording() {
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: withSystem });
    } catch {
      return; // 사용자가 화면 선택을 취소했다
    }
    streams = [display];
    const audio: MediaStreamTrack[] = [...display.getAudioTracks()];
    if (withMic) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        streams.push(mic);
        audio.push(...mic.getAudioTracks());
      } catch {
        flash('마이크를 쓸 수 없어 마이크 없이 녹화합니다');
      }
    }
    const tracks: MediaStreamTrack[] = [...display.getVideoTracks()];
    if (audio.length > 1) {
      // 시스템 소리와 마이크를 한 트랙으로 섞는다
      audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      for (const t of audio) audioCtx.createMediaStreamSource(new MediaStream([t])).connect(dest);
      tracks.push(...dest.stream.getAudioTracks());
    } else tracks.push(...audio);

    const chunks: Blob[] = [];
    const mimeType = webm || mp4;
    try {
      recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: mimeType || undefined, videoBitsPerSecond: 8_000_000 });
    } catch {
      stopStreams();
      return flash('이 브라우저에서는 녹화할 수 없습니다');
    }
    recorder.ondataavailable = (e) => {
      if (e.data.size) {
        chunks.push(e.data);
        recBytes += e.data.size;
      }
    };
    const startedAt = performance.now();
    let pausedFor = 0;
    let pausedAt = 0;
    recorder.onpause = () => (pausedAt = performance.now());
    recorder.onresume = () => (pausedFor += performance.now() - pausedAt);
    recorder.onstop = () => {
      const seconds = elapsed;
      stopStreams();
      recorder = null;
      const blob = new Blob(chunks, { type: (mimeType || 'video/webm').split(';')[0] });
      if (!blob.size) {
        phase = 'idle';
        return flash('녹화된 내용이 없습니다');
      }
      loadVideo(blob, `recording-${timestamp()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`, seconds);
    };
    // 브라우저의 "공유 중지" 를 눌러도 끝난다
    display.getVideoTracks()[0].addEventListener('ended', () => recorder?.state !== 'inactive' && recorder?.stop());

    elapsed = 0;
    recBytes = 0;
    paused = false;
    phase = 'recording';
    await tick();
    if (live) live.srcObject = display;
    recorder.start(500);
    timer = window.setInterval(() => {
      if (!paused) elapsed = (performance.now() - startedAt - pausedFor) / 1000;
    }, 200);
  }

  function togglePause() {
    if (!recorder) return;
    if (recorder.state === 'recording') recorder.pause();
    else recorder.resume();
    paused = recorder.state === 'paused';
  }

  // ── 편집 ──────────────────────────────────────────────
  let video = $state<HTMLVideoElement>();
  let source = $state.raw<{ blob: Blob; name: string; url: string } | null>(null);
  let duration = $state(0);
  let vw = $state(0);
  let vh = $state(0);
  let now = $state(0);
  let start = $state(0);
  let end = $state(0);
  let playing = $state(false);
  let crop = $state<Rect | null>(null);
  let boxW = $state(0);
  let boxH = $state(0);

  let format = $state<'gif' | 'video'>('gif');
  let fps = $state(10);
  let width = $state(720);
  let busy = $state<{ label: string; progress: number } | null>(null);
  let cancelled = false;
  let result = $state.raw<{ blob: Blob; url: string; name: string; kind: 'gif' | 'video' } | null>(null);

  const once = (el: EventTarget, type: string, ms = 5000) =>
    new Promise<void>((res) => {
      const done = () => {
        clearTimeout(t);
        el.removeEventListener(type, done);
        res();
      };
      const t = setTimeout(done, ms);
      el.addEventListener(type, done);
    });

  async function loadVideo(blob: Blob, name: string, knownSeconds = 0) {
    clearResult();
    if (source) URL.revokeObjectURL(source.url);
    source = { blob, name, url: URL.createObjectURL(blob) };
    crop = null;
    duration = 0;
    phase = 'edit';
    await tick();
    const v = video!;
    v.src = source.url;
    await once(v, 'loadedmetadata');
    if (!v.videoWidth) {
      closeEdit();
      return flash(`${name}: 영상으로 읽을 수 없습니다`);
    }
    // 방금 녹화한 파일에는 길이 정보가 없다. 끝까지 찾아가게 해서 알아낸다.
    if (!Number.isFinite(v.duration)) {
      v.currentTime = 1e101;
      for (let i = 0; i < 20 && !Number.isFinite(v.duration); i++) await once(v, 'durationchange', 250);
    }
    duration = Number.isFinite(v.duration) ? v.duration : knownSeconds;
    v.currentTime = 0;
    await once(v, 'seeked', 2000);
    vw = v.videoWidth;
    vh = v.videoHeight;
    start = 0;
    end = duration;
    now = 0;
  }

  function closeEdit() {
    video?.pause();
    clearResult();
    if (source) URL.revokeObjectURL(source.url);
    source = null;
    phase = 'idle';
  }

  function clearResult() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
  }

  function openFiles(list: FileList | null | undefined) {
    const f = list?.[0];
    if (!f) return;
    if (!f.type.startsWith('video/')) return flash('영상 파일이 아닙니다');
    loadVideo(f, f.name);
  }

  // 재생: 고른 구간 안에서만 돈다
  let raf = 0;
  function loop() {
    const v = video;
    if (!v) return;
    now = v.currentTime;
    if (!busy && playing && (v.currentTime >= end - 0.02 || v.ended)) {
      v.currentTime = start;
      if (v.paused) v.play().catch(() => {});
    }
    raf = requestAnimationFrame(loop);
  }
  $effect(() => {
    if (phase !== 'edit') return;
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  function togglePlay() {
    const v = video;
    if (!v || busy) return;
    if (v.paused) {
      if (v.currentTime < start || v.currentTime >= end - 0.02) v.currentTime = start;
      v.play().catch(() => {});
    } else v.pause();
  }
  function seekTo(t: number) {
    if (!video || busy) return;
    video.currentTime = Math.min(duration, Math.max(0, t));
    now = video.currentTime;
  }

  // 타임라인
  let dragKind: 'start' | 'end' | 'seek' | null = null;
  function onTrack(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    if (e.type === 'pointerdown') {
      dragKind = ((e.target as HTMLElement).dataset.h as 'start' | 'end' | undefined) ?? 'seek';
      el.setPointerCapture(e.pointerId);
    }
    if (!dragKind || !duration || busy) return;
    const r = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration;
    const gap = Math.min(0.2, duration);
    if (dragKind === 'start') {
      start = Math.min(t, end - gap);
      seekTo(start);
    } else if (dragKind === 'end') {
      end = Math.max(t, start + gap);
      seekTo(end);
    } else seekTo(t);
  }

  // 자르기 영역 (0..1 좌표)
  const view = $derived.by(() => {
    if (!vw || !vh || !boxW || !boxH) return { w: 0, h: 0 };
    const s = Math.min(boxW / vw, boxH / vh, 1);
    return { w: Math.floor(vw * s), h: Math.floor(vh * s) };
  });
  let cropDrag: { kind: string; ox: number; oy: number; from: Rect } | null = null;
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  function onCrop(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const px = clamp01((e.clientX - r.left) / r.width);
    const py = clamp01((e.clientY - r.top) / r.height);
    if (e.type === 'pointerdown') {
      if (busy) return;
      el.setPointerCapture(e.pointerId);
      const kind = (e.target as HTMLElement).dataset.c ?? 'new';
      cropDrag = { kind, ox: px, oy: py, from: crop && kind !== 'new' ? { ...crop } : { x: px, y: py, w: 0, h: 0 } };
      if (kind === 'new') crop = null;
      return;
    }
    if (!cropDrag) return;
    const { kind, ox, oy, from } = cropDrag;
    if (e.type === 'pointermove') {
      if (kind === 'move') {
        crop = { ...from, x: Math.min(1 - from.w, Math.max(0, from.x + px - ox)), y: Math.min(1 - from.h, Math.max(0, from.y + py - oy)) };
      } else {
        // 모서리를 끌 때는 맞은편 모서리가 고정된다
        const ax = kind === 'new' ? ox : kind.includes('w') ? from.x + from.w : from.x;
        const ay = kind === 'new' ? oy : kind.includes('n') ? from.y + from.h : from.y;
        const next = { x: Math.min(ax, px), y: Math.min(ay, py), w: Math.abs(px - ax), h: Math.abs(py - ay) };
        if (kind !== 'new' || next.w > 0.01 || next.h > 0.01) crop = next;
      }
      return;
    }
    cropDrag = null;
    if (crop && (crop.w < 0.02 || crop.h < 0.02)) crop = null;
    if (!crop && kind === 'new') togglePlay(); // 그냥 누른 것은 재생/정지
  }

  // 내보낼 크기
  const geo = $derived.by(() => {
    const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
    const sx = Math.round(c.x * vw);
    const sy = Math.round(c.y * vh);
    const sw = Math.max(2, Math.min(vw - sx, Math.round(c.w * vw)));
    const sh = Math.max(2, Math.min(vh - sy, Math.round(c.h * vh)));
    let ow = width ? Math.min(width, sw) : sw;
    let oh = Math.max(2, Math.round((ow * sh) / sw));
    if (format === 'video') {
      ow -= ow % 2;
      oh -= oh % 2;
    }
    return { sx, sy, sw, sh, ow, oh };
  });
  const span = $derived(Math.max(0, end - start));
  const frameCount = $derived(Math.max(1, Math.round(span * fps)));
  const MAX_FRAMES = 900;

  /** 지금 멈춘 장면(자른 영역만)을 이미지 편집기로 넘긴다. 녹화는 이 탭에 그대로 남는다 */
  function frameToImage() {
    const v = video;
    if (!v || !vw) return;
    v.pause();
    const c = document.createElement('canvas');
    c.width = geo.sw;
    c.height = geo.sh;
    c.getContext('2d')!.drawImage(v, geo.sx, geo.sy, geo.sw, geo.sh, 0, 0, geo.sw, geo.sh);
    const png = new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
    const ok = sendTo('/image', png.then((blob) => ({ kind: 'image' as const, blob, name: `장면-${timestamp()}` })));
    if (!ok) flash('새 탭을 열 수 없습니다. 팝업 차단을 풀어 주세요');
  }

  async function seekExact(t: number) {
    const v = video!;
    v.currentTime = t;
    await once(v, 'seeked', 4000);
  }

  async function exportGif() {
    const v = video!;
    v.pause();
    cancelled = false;
    clearResult();
    const { sx, sy, sw, sh, ow, oh } = geo;
    const n = Math.min(frameCount, MAX_FRAMES);
    const step = span / n;
    const canvas = document.createElement('canvas');
    canvas.width = ow;
    canvas.height = oh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    const grab = async (i: number) => {
      await seekExact(Math.min(duration, start + i * step + 0.001));
      ctx.drawImage(v, sx, sy, sw, sh, 0, 0, ow, oh);
      return ctx.getImageData(0, 0, ow, oh).data;
    };
    try {
      // 1) 전체에서 고르게 뽑은 장면으로 팔레트를 만든다
      busy = { label: '색 분석 중', progress: 0 };
      const hist = newHistogram();
      const samples = Math.min(n, 16);
      for (let s = 0; s < samples && !cancelled; s++) {
        addToHistogram(hist, await grab(Math.floor((s * n) / samples)), 2);
        busy = { label: '색 분석 중', progress: (s + 1) / samples / 8 };
      }
      const { palette, lut } = buildPalette(hist, 255);
      // 2) 프레임을 차례로 담는다
      const enc = new GifEncoder(ow, oh, palette);
      const idx = new Uint8Array(ow * oh);
      let shownCs = 0;
      for (let i = 0; i < n && !cancelled; i++) {
        mapPixels(await grab(i), lut, idx);
        const until = Math.round((i + 1) * step * 100);
        enc.addFrame(idx, until - shownCs);
        shownCs = until;
        busy = { label: `프레임 ${i + 1} / ${n}`, progress: 1 / 8 + ((i + 1) / n) * (7 / 8) };
      }
      if (!cancelled) {
        const blob = new Blob([enc.finish()], { type: 'image/gif' });
        result = { blob, url: URL.createObjectURL(blob), name: `recording-${timestamp()}.gif`, kind: 'gif' };
      }
    } catch {
      flash('GIF 를 만들지 못했습니다');
    } finally {
      busy = null;
      seekTo(start);
    }
  }

  // 구간 · 영역을 적용한 영상은 실제 속도로 다시 재생하면서 녹화한다
  async function exportVideo() {
    const v = video!;
    const mimeType = mp4 || webm;
    if (!mimeType) return flash('이 브라우저에서는 영상으로 내보낼 수 없습니다');
    v.pause();
    cancelled = false;
    clearResult();
    const { sx, sy, sw, sh, ow, oh } = geo;
    const canvas = document.createElement('canvas');
    canvas.width = ow;
    canvas.height = oh;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    const draw = () => ctx.drawImage(v, sx, sy, sw, sh, 0, 0, ow, oh);
    busy = { label: '영상 만드는 중', progress: 0 };
    try {
      await seekExact(start);
      draw();
      const stream = canvas.captureStream(30);
      try {
        const captured = (v as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
        for (const t of captured?.getAudioTracks() ?? []) stream.addTrack(t);
      } catch {}
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise<void>((res) => (rec.onstop = () => res()));
      rec.start(500);
      await v.play();
      await new Promise<void>((res) => {
        const frame = () => {
          draw();
          busy = { label: '영상 만드는 중', progress: Math.min(1, (v.currentTime - start) / span) };
          if (cancelled || v.ended || v.currentTime >= end) return res();
          requestAnimationFrame(frame);
        };
        frame();
      });
      v.pause();
      rec.stop();
      await stopped;
      if (!cancelled) {
        const type = mimeType.split(';')[0];
        const blob = new Blob(chunks, { type });
        result = { blob, url: URL.createObjectURL(blob), name: `recording-${timestamp()}.${type.endsWith('mp4') ? 'mp4' : 'webm'}`, kind: 'video' };
      }
    } catch {
      flash('영상을 만들지 못했습니다');
    } finally {
      busy = null;
      seekTo(start);
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (phase !== 'edit' || busy || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as HTMLElement).closest('input, select, textarea, button, a')) return;
    const k = e.key.toLowerCase();
    if (k === ' ') togglePlay();
    else if (k === 'i') start = Math.min(now, end - 0.2);
    else if (k === 'o') end = Math.max(now, start + 0.2);
    else if (k === 'arrowleft') seekTo(now - (e.shiftKey ? 1 : 1 / 30));
    else if (k === 'arrowright') seekTo(now + (e.shiftKey ? 1 : 1 / 30));
    else if (k === 'escape') crop = null;
    else return;
    e.preventDefault();
  }

  const clock = (t: number, tenths = true) => {
    const s = Math.max(0, t);
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return `${m}:${tenths ? r.toFixed(1).padStart(4, '0') : String(Math.floor(r)).padStart(2, '0')}`;
  };
  const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))}KB` : `${(b / 1024 / 1024).toFixed(1)}MB`);
  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`;

  onDestroy(() => {
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.stop();
    }
    stopStreams();
    if (source) URL.revokeObjectURL(source.url);
    if (result) URL.revokeObjectURL(result.url);
  });
</script>

<svelte:window onkeydown={onKeydown} />

<ToolShell tool="recorder">
  {#snippet actions()}
    {#if phase === 'edit'}
      <button class="btn sm" disabled={!!busy} onclick={closeEdit}>새로 시작</button>
    {/if}
  {/snippet}

  {#if phase === 'idle'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="idle"
      class:over={dragOver}
      ondragover={(e) => {
        e.preventDefault();
        dragOver = true;
      }}
      ondragleave={() => (dragOver = false)}
      ondrop={(e) => {
        e.preventDefault();
        dragOver = false;
        openFiles(e.dataTransfer?.files);
      }}
    >
      <div class="card">
        <div class="dot" aria-hidden="true"></div>
        <h2>화면을 녹화해 GIF 나 영상으로</h2>
        <p>전체 화면 · 창 · 탭 가운데 하나를 골라 녹화하고, 필요한 구간과 영역만 잘라 내보냅니다. 녹화한 영상은 이 브라우저 밖으로 나가지 않습니다.</p>
        {#if canCapture}
          <button class="btn primary big" onclick={startRecording}>녹화 시작</button>
          <div class="opts">
            <label><input type="checkbox" bind:checked={withSystem} /> 시스템 · 탭 소리</label>
            <label><input type="checkbox" bind:checked={withMic} /> 마이크</label>
          </div>
        {:else}
          <p class="unsupported">이 기기의 브라우저는 화면 녹화를 지원하지 않습니다. 가지고 있는 영상을 GIF 로 바꿀 수는 있습니다.</p>
        {/if}
        <label class="btn file">
          영상 파일 열기
          <input
            type="file"
            accept="video/*"
            hidden
            onchange={(e) => {
              openFiles(e.currentTarget.files);
              e.currentTarget.value = '';
            }}
          />
        </label>
        <p class="hint">가지고 있는 영상을 끌어다 놓아도 됩니다 (영상 → GIF 변환)</p>
        {#if notice}<p class="notice" role="status">{notice}</p>{/if}
      </div>
    </div>
  {:else if phase === 'recording'}
    <div class="rec">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={live} autoplay muted playsinline></video>
      <div class="rec-bar">
        <span class="live" class:paused><i></i>{paused ? '일시 정지' : '녹화 중'}</span>
        <span class="time">{clock(elapsed, false)}</span>
        <span class="bytes">{size(recBytes)}</span>
        <button class="btn" onclick={togglePause}>{paused ? '이어서 녹화' : '일시 정지'}</button>
        <button class="btn primary" onclick={() => recorder?.stop()}>녹화 끝내기</button>
      </div>
      {#if notice}<p class="notice" role="status">{notice}</p>{/if}
    </div>
  {:else}
    <div class="edit">
      <div class="main">
        <div class="stage" bind:clientWidth={boxW} bind:clientHeight={boxH}>
          <div class="frame" style:width="{view.w}px" style:height="{view.h}px">
            <!-- svelte-ignore a11y_media_has_caption -->
            <video bind:this={video} playsinline preload="auto" onplay={() => (playing = true)} onpause={() => (playing = false)}></video>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="cropper" onpointerdown={onCrop} onpointermove={onCrop} onpointerup={onCrop} onpointercancel={onCrop}>
              {#if crop}
                <div class="crop" data-c="move" style:left="{crop.x * 100}%" style:top="{crop.y * 100}%" style:width="{crop.w * 100}%" style:height="{crop.h * 100}%">
                  {#each ['nw', 'ne', 'sw', 'se'] as c (c)}<i class={c} data-c={c}></i>{/each}
                  <span>{geo.sw} × {geo.sh}</span>
                </div>
              {/if}
            </div>
          </div>
        </div>

        <div class="transport">
          <button class="btn play" onclick={togglePlay} disabled={!!busy} aria-label={playing ? '정지' : '재생'} title="재생 / 정지 (Space)">
            {#if playing}
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
            {:else}
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            {/if}
          </button>
          <span class="now">{clock(now)}</span>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="track" onpointerdown={onTrack} onpointermove={onTrack} onpointerup={() => (dragKind = null)} onpointercancel={() => (dragKind = null)}>
            <div class="range" style:left={pct(start)} style:width={pct(span)}></div>
            <div class="head" style:left={pct(now)}></div>
            <button class="handle" data-h="start" style:left={pct(start)} aria-label="시작 지점" title="시작 지점 (I)"></button>
            <button class="handle end" data-h="end" style:left={pct(end)} aria-label="끝 지점" title="끝 지점 (O)"></button>
          </div>
          <span class="len">{clock(duration)}</span>
        </div>
        <p class="tips">
          영상 위를 끌어서 <b>영역</b>을, 아래 막대의 손잡이를 끌어서 <b>구간</b>을 고릅니다.
          <kbd>Space</kbd> 재생 · <kbd>I</kbd> <kbd>O</kbd> 시작/끝 · <kbd>←</kbd> <kbd>→</kbd> 한 프레임
        </p>
      </div>

      <aside class="side">
        <h2>내보내기</h2>
        <div class="seg" role="group" aria-label="형식">
          <button aria-pressed={format === 'gif'} onclick={() => (format = 'gif')}>GIF</button>
          <button aria-pressed={format === 'video'} onclick={() => (format = 'video')}>영상 ({mp4 ? 'MP4' : 'WebM'})</button>
        </div>

        <dl>
          <dt>구간</dt>
          <dd>{clock(start)} – {clock(end)} <small>({span.toFixed(1)}초)</small></dd>
          <dt>영역</dt>
          <dd>
            {#if crop}
              {geo.sw} × {geo.sh} <button class="link" onclick={() => (crop = null)}>전체로</button>
            {:else}
              전체 ({vw} × {vh})
            {/if}
          </dd>
        </dl>

        <label class="row">
          너비
          <select class="field" bind:value={width}>
            <option value={0}>원본 그대로</option>
            {#each [1280, 960, 720, 480, 320] as w (w)}<option value={w}>{w}px</option>{/each}
          </select>
        </label>
        {#if format === 'gif'}
          <label class="row">
            초당 프레임
            <select class="field" bind:value={fps}>
              {#each [5, 8, 10, 12, 15, 20] as f (f)}<option value={f}>{f}</option>{/each}
            </select>
          </label>
        {/if}
        <p class="est">
          {geo.ow} × {geo.oh}
          {#if format === 'gif'}
            · {Math.min(frameCount, MAX_FRAMES).toLocaleString('ko-KR')}프레임
            {#if frameCount > MAX_FRAMES}<br /><span class="warn">너무 길어 앞의 {MAX_FRAMES}프레임만 담습니다. 구간을 줄이거나 프레임 수를 낮추세요.</span>{/if}
          {:else}
            · 약 {Math.ceil(span)}초 걸립니다 (실제 속도로 다시 녹화)
          {/if}
        </p>

        {#if busy}
          <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(busy.progress * 100)}>
            <div style:width="{busy.progress * 100}%"></div>
          </div>
          <div class="busy-row">
            <span>{busy.label}</span>
            <button class="btn sm" onclick={() => (cancelled = true)}>취소</button>
          </div>
        {:else}
          <button class="btn primary" disabled={!duration} onclick={format === 'gif' ? exportGif : exportVideo}>
            {format === 'gif' ? 'GIF 만들기' : '영상 만들기'}
          </button>
          <button class="btn" disabled={!source} onclick={() => source && downloadBlob(source.blob, source.name)}>
            원본 저장{source ? ` (${size(source.blob.size)})` : ''}
          </button>
          <button class="btn" disabled={!duration} onclick={frameToImage} title="지금 보이는 장면을 이미지 편집기에서 엽니다 (자른 영역만). 새 탭에서 열립니다">이 장면을 이미지 편집기로 ↗</button>
        {/if}
        {#if notice}<p class="notice" role="status">{notice}</p>{/if}

        {#if result}
          <div class="result">
            {#if result.kind === 'gif'}
              <img src={result.url} alt="만든 GIF 미리보기" />
            {:else}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video src={result.url} controls playsinline></video>
            {/if}
            <div class="result-row">
              <span>{result.kind === 'gif' ? 'GIF' : '영상'} · {size(result.blob.size)}</span>
              <button class="btn primary sm" onclick={() => result && downloadBlob(result.blob, result.name)}>저장</button>
            </div>
          </div>
        {/if}
      </aside>
    </div>
  {/if}
</ToolShell>

<style>
  .notice {
    font-size: 12.5px;
    color: var(--bad);
  }

  /* 시작 화면 */
  .idle {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 20px;
    overflow: auto;
  }
  .card {
    display: grid;
    justify-items: center;
    gap: 12px;
    width: min(460px, 100%);
    padding: 36px 28px 28px;
    text-align: center;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 20px;
  }
  .idle.over .card {
    border-color: var(--app);
    box-shadow: 0 0 0 4px var(--app-soft);
  }
  .dot {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: var(--app);
    box-shadow: 0 0 0 8px var(--app-soft);
    margin-bottom: 8px;
  }
  .card h2 {
    font-size: 20px;
    letter-spacing: -0.02em;
  }
  .card p {
    color: var(--muted);
    font-size: 13.5px;
    line-height: 1.7;
  }
  .big {
    height: 44px;
    padding: 0 28px;
    font-size: 15px;
    margin-top: 6px;
  }
  .opts {
    display: flex;
    gap: 16px;
    font-size: 13px;
    color: var(--muted);
  }
  .opts label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .opts input {
    accent-color: var(--app);
    margin: 0;
  }
  .file {
    margin-top: 10px;
  }
  .card .hint {
    font-size: 12px;
    color: var(--faint);
  }
  .card .unsupported {
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--surface-2);
  }

  /* 녹화 중 */
  .rec {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 14px;
  }
  .rec video {
    flex: 1;
    min-height: 0;
    max-width: 100%;
    border-radius: 10px;
    background: #000;
    box-shadow: 0 0 0 1px var(--border-strong);
  }
  .rec-bar {
    flex: none;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px 14px;
    padding: 10px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
  }
  .live {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
    font-weight: 650;
    color: var(--app);
  }
  .live i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--app);
    animation: blink 1.2s ease-in-out infinite;
  }
  .live.paused {
    color: var(--muted);
  }
  .live.paused i {
    background: var(--faint);
    animation: none;
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  .time {
    font: 650 20px/1 var(--mono);
    font-variant-numeric: tabular-nums;
  }
  .bytes {
    font-size: 12.5px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
    min-width: 52px;
  }

  /* 편집 */
  .edit {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
  }
  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    padding: 14px 14px 10px;
    gap: 10px;
  }
  .stage {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  .frame {
    position: relative;
    overflow: hidden;
    border-radius: 6px;
    background: #000;
    box-shadow: 0 0 0 1px var(--border-strong);
  }
  .frame video {
    display: block;
    width: 100%;
    height: 100%;
  }
  .cropper {
    position: absolute;
    inset: 0;
    cursor: crosshair;
    touch-action: none;
  }
  .crop {
    position: absolute;
    border: 1.5px solid #fff;
    box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.55);
    cursor: move;
  }
  .crop i {
    position: absolute;
    width: 14px;
    height: 14px;
    background: #fff;
    border: 1px solid rgb(0 0 0 / 0.5);
    border-radius: 3px;
  }
  .crop .nw {
    left: -7px;
    top: -7px;
    cursor: nwse-resize;
  }
  .crop .ne {
    right: -7px;
    top: -7px;
    cursor: nesw-resize;
  }
  .crop .sw {
    left: -7px;
    bottom: -7px;
    cursor: nesw-resize;
  }
  .crop .se {
    right: -7px;
    bottom: -7px;
    cursor: nwse-resize;
  }
  .crop span {
    position: absolute;
    left: 6px;
    top: 6px;
    padding: 1px 7px;
    border-radius: 99px;
    background: rgb(0 0 0 / 0.65);
    color: #fff;
    font: 600 11px/1.6 var(--mono);
    pointer-events: none;
    white-space: nowrap;
  }

  .transport {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px 8px 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .play {
    width: 34px;
    padding: 0;
    flex: none;
  }
  .now,
  .len {
    flex: none;
    font: 550 12.5px/1 var(--mono);
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    min-width: 46px;
  }
  .len {
    text-align: right;
    color: var(--faint);
  }
  .track {
    position: relative;
    flex: 1;
    height: 34px;
    border-radius: 6px;
    background: var(--surface-3);
    cursor: pointer;
    touch-action: none;
  }
  .range {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--app-soft);
    border-block: 2px solid var(--app);
    pointer-events: none;
  }
  .head {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 2px;
    margin-left: -1px;
    background: var(--text);
    pointer-events: none;
  }
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 12px;
    margin-left: -12px;
    padding: 0;
    border: 0;
    border-radius: 6px 0 0 6px;
    background: var(--app);
    cursor: ew-resize;
    touch-action: none;
  }
  .handle.end {
    margin-left: 0;
    border-radius: 0 6px 6px 0;
  }
  .handle::after {
    content: '';
    position: absolute;
    left: 5px;
    top: 10px;
    bottom: 10px;
    width: 2px;
    border-radius: 1px;
    background: var(--on-app);
    opacity: 0.8;
  }
  .tips {
    flex: none;
    font-size: 12px;
    color: var(--faint);
    text-align: center;
  }
  .tips b {
    color: var(--muted);
    font-weight: 650;
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    background: var(--surface);
    border-left: 1px solid var(--border);
    overflow-y: auto;
  }
  .side h2 {
    font-size: 15px;
  }
  .side .seg {
    display: flex;
  }
  .side .seg button {
    flex: 1;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 12px;
    margin: 0;
    font-size: 13px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  dd small {
    color: var(--faint);
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    margin-left: 4px;
    color: var(--app);
    font-size: 12.5px;
    text-decoration: underline;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 13px;
    color: var(--muted);
  }
  .row select {
    width: 140px;
    color: var(--text);
  }
  .est {
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .warn {
    color: var(--bad);
  }
  .progress {
    height: 8px;
    border-radius: 99px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .progress div {
    height: 100%;
    background: var(--app);
    transition: width 0.15s linear;
  }
  .busy-row,
  .result-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .result {
    display: grid;
    gap: 8px;
    margin-top: 4px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  .result img,
  .result video {
    width: 100%;
    max-height: 240px;
    object-fit: contain;
    border-radius: 8px;
    background: var(--surface-2);
    box-shadow: 0 0 0 1px var(--border);
  }

  @media (max-width: 820px) {
    .edit {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(300px, 1fr) auto;
      overflow-y: auto;
    }
    .main {
      min-height: 360px;
      padding: 10px 10px 6px;
    }
    .side {
      border-left: 0;
      border-top: 1px solid var(--border);
      overflow: visible;
    }
    .tips {
      display: none;
    }
  }
</style>
