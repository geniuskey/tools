<script lang="ts">
  import { onMount } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import { load, save } from '$lib/storage';
  import { downloadBlob, timestamp } from '$lib/download';
  import { encodeQr, maxLength, pickMode, type Ecl, type Qr } from '$lib/qr/core';
  import { contactPayload, emailPayload, linkPayload, smsPayload, wifiPayload, type Contact, type Wifi } from '$lib/qr/payload';
  import { contrast, defaultStyle, isDarker, renderSvg, type Dots, type Eyes, type Style } from '$lib/qr/render';

  type Kind = 'text' | 'wifi' | 'contact' | 'email' | 'sms';
  const kinds: [Kind, string][] = [
    ['text', '링크 · 글'],
    ['wifi', 'Wi-Fi'],
    ['contact', '연락처'],
    ['email', '이메일'],
    ['sms', '전화 · 문자'],
  ];
  const KEY = 'tools:qr:v1';

  let kind = $state<Kind>('text');
  let text = $state('https://tools.euiyun.com');
  let wifi = $state<Wifi>({ ssid: '', password: '', security: 'WPA', hidden: false });
  let contact = $state<Contact>({ name: '', phone: '', email: '', org: '', title: '', url: '' });
  let mail = $state({ to: '', subject: '', body: '' });
  let sms = $state({ phone: '', message: '' });
  let showPass = $state(false);

  let style = $state<Style>({ ...defaultStyle });
  let ecl = $state<Ecl>('M');
  let pngSize = $state(1024);
  let ready = false;
  let toast = $state('');

  const payload = $derived.by(() => {
    switch (kind) {
      case 'text':
        return linkPayload(text);
      case 'wifi':
        return wifiPayload(wifi);
      case 'contact':
        return contactPayload(contact);
      case 'email':
        return emailPayload(mail.to, mail.subject, mail.body);
      default:
        return smsPayload(sms.phone, sms.message);
    }
  });

  // 로고가 무늬를 가리므로 오류 정정을 가장 높게 쓴다
  const wantEcl = $derived<Ecl>(style.logo ? 'H' : ecl);
  const made = $derived.by<{ qr: Qr | null; tooLong: boolean }>(() => {
    if (!payload) return { qr: null, tooLong: false };
    try {
      return { qr: encodeQr(payload, { ecl: wantEcl }), tooLong: false };
    } catch {
      return { qr: null, tooLong: true };
    }
  });
  const qr = $derived(made.qr);
  const svg = $derived(qr ? renderSvg(qr, style) : '');

  const warnings = $derived.by(() => {
    const out: string[] = [];
    if (!qr) return out;
    if (!style.transparent && contrast(style.fg, style.bg) < 3.5) out.push('무늬와 배경의 색 차이가 작아 읽히지 않을 수 있습니다.');
    else if (!style.transparent && !isDarker(style.fg, style.bg)) out.push('밝은 무늬 · 어두운 배경은 일부 스캐너가 읽지 못합니다.');
    if (style.transparent) out.push('투명 배경은 밝은 바탕 위에 올려야 읽힙니다.');
    if (style.margin < 2) out.push('여백이 좁으면 주변 그림과 붙어 읽기 어려워집니다 (권장 4칸).');
    if (qr.version > 20) out.push('내용이 길어 무늬가 촘촘합니다. 작게 인쇄하면 읽기 어렵습니다.');
    return out;
  });

  // 실제로 읽히는지 브라우저의 바코드 인식기로 확인한다 (지원하는 브라우저에서만)
  type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
  let detector = $state.raw<Detector | null>(null);
  let verdict = $state<'none' | 'checking' | 'ok' | 'fail'>('none');
  $effect(() => {
    const s = svg;
    const expected = payload;
    const d = detector;
    if (!d || !s) {
      verdict = 'none';
      return;
    }
    verdict = 'checking';
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const found = await d.detect(await toCanvas(s, 640, true));
        if (!stale) verdict = found.some((f) => f.rawValue === expected) ? 'ok' : 'fail';
      } catch {
        if (!stale) verdict = 'none';
      }
    }, 350);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  });

  async function toCanvas(source: string, px: number, white = false): Promise<HTMLCanvasElement> {
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = px;
      const g = c.getContext('2d')!;
      if (white) {
        g.fillStyle = '#fff';
        g.fillRect(0, 0, px, px);
      }
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, px, px);
      return c;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const pngBlob = async () => {
    const c = await toCanvas(renderSvg(qr!, style, pngSize), pngSize);
    return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
  };

  function say(msg: string) {
    toast = msg;
    setTimeout(() => toast === msg && (toast = ''), 2200);
  }
  async function savePng() {
    if (qr) downloadBlob(await pngBlob(), `qr-${timestamp()}.png`);
  }
  function saveSvg() {
    if (qr) downloadBlob(new Blob([renderSvg(qr, style, 1024)], { type: 'image/svg+xml' }), `qr-${timestamp()}.svg`);
  }
  async function copyPng() {
    if (!qr) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]);
      say('이미지를 복사했습니다');
    } catch {
      say('복사하지 못했습니다');
    }
  }

  async function pickLogo(f: File | undefined) {
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      const s = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * s));
      c.height = Math.max(1, Math.round(bmp.height * s));
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
      style.logo = c.toDataURL('image/png');
    } catch {
      say('이미지로 읽을 수 없습니다');
    }
  }

  const modeName = { numeric: '숫자', alphanumeric: '영숫자', byte: '바이트' };
  const eclName: Record<Ecl, string> = { L: '낮음 (7%)', M: '보통 (15%)', Q: '높음 (25%)', H: '최고 (30%)' };

  onMount(() => {
    const s = load<{ style?: Partial<Style>; ecl?: Ecl; pngSize?: number }>(KEY, {});
    style = { ...defaultStyle, ...s.style, logo: '' };
    if (s.ecl && 'LMQH'.includes(s.ecl)) ecl = s.ecl;
    if (s.pngSize) pngSize = s.pngSize;
    ready = true;
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (BD) {
      try {
        detector = new BD({ formats: ['qr_code'] });
      } catch {}
    }
  });
  $effect(() => {
    // 내용(비밀번호 등)과 로고는 저장하지 않는다. 모양만 기억한다.
    const snap = { style: { ...$state.snapshot(style), logo: '' }, ecl, pngSize };
    if (ready) save(KEY, snap);
  });
</script>

<ToolShell tool="qr">
  <div class="page">
    <section class="panel">
      <h2>내용</h2>
      <div class="kinds" role="group" aria-label="내용 종류">
        {#each kinds as [id, name] (id)}
          <button aria-pressed={kind === id} onclick={() => (kind = id)}>{name}</button>
        {/each}
      </div>

      {#if kind === 'text'}
        <label class="f">
          <span>주소나 글</span>
          <textarea class="field" rows="5" bind:value={text} spellcheck="false" placeholder="https://example.com"></textarea>
        </label>
        {#if payload !== text.trim() && payload}<p class="note">주소로 보여 <code>https://</code> 를 붙였습니다.</p>{/if}
      {:else if kind === 'wifi'}
        <label class="f"><span>네트워크 이름 (SSID)</span><input class="field" bind:value={wifi.ssid} autocomplete="off" spellcheck="false" /></label>
        <label class="f">
          <span>비밀번호</span>
          <span class="with-btn">
            <input class="field" type={showPass ? 'text' : 'password'} bind:value={wifi.password} disabled={wifi.security === 'nopass'} autocomplete="off" spellcheck="false" />
            <button class="btn sm" onclick={() => (showPass = !showPass)}>{showPass ? '가리기' : '보기'}</button>
          </span>
        </label>
        <label class="f">
          <span>보안</span>
          <select class="field" bind:value={wifi.security}>
            <option value="WPA">WPA / WPA2 / WPA3</option>
            <option value="WEP">WEP</option>
            <option value="nopass">비밀번호 없음</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" bind:checked={wifi.hidden} /> 숨겨진 네트워크</label>
        <p class="note">휴대폰 카메라로 비추면 바로 연결됩니다. 비밀번호는 이 화면을 벗어나면 남지 않습니다.</p>
      {:else if kind === 'contact'}
        <label class="f"><span>이름</span><input class="field" bind:value={contact.name} autocomplete="off" /></label>
        <label class="f"><span>전화</span><input class="field" type="tel" bind:value={contact.phone} autocomplete="off" /></label>
        <label class="f"><span>이메일</span><input class="field" type="email" bind:value={contact.email} autocomplete="off" /></label>
        <div class="two">
          <label class="f"><span>회사 · 소속</span><input class="field" bind:value={contact.org} autocomplete="off" /></label>
          <label class="f"><span>직함</span><input class="field" bind:value={contact.title} autocomplete="off" /></label>
        </div>
        <label class="f"><span>홈페이지</span><input class="field" bind:value={contact.url} autocomplete="off" spellcheck="false" /></label>
      {:else if kind === 'email'}
        <label class="f"><span>받는 사람</span><input class="field" type="email" bind:value={mail.to} autocomplete="off" /></label>
        <label class="f"><span>제목</span><input class="field" bind:value={mail.subject} /></label>
        <label class="f"><span>내용</span><textarea class="field" rows="4" bind:value={mail.body}></textarea></label>
      {:else}
        <label class="f"><span>전화번호</span><input class="field" type="tel" bind:value={sms.phone} autocomplete="off" /></label>
        <label class="f"><span>문자 내용 (비우면 전화 걸기)</span><textarea class="field" rows="4" bind:value={sms.message}></textarea></label>
      {/if}

      {#if payload && kind !== 'text'}
        <details class="raw">
          <summary>QR 에 담기는 글 보기</summary>
          <pre>{kind === 'wifi' && !showPass && wifi.password ? payload.replace(/P:.*?(?<!\\);/, 'P:••••••;') : payload}</pre>
        </details>
      {/if}
    </section>

    <section class="center">
      <div class="preview" class:checker={style.transparent} class:empty={!qr}>
        {#if qr}
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html svg}
        {:else if made.tooLong}
          <p>내용이 너무 깁니다.<br /><small>지금 설정으로는 최대 {maxLength(pickMode(payload), wantEcl).toLocaleString('ko-KR')}{pickMode(payload) === 'byte' ? '바이트' : '자'}까지 담을 수 있습니다.</small></p>
        {:else}
          <p>왼쪽에 내용을 넣으면<br />QR 코드가 여기에 나타납니다.</p>
        {/if}
      </div>
      {#if qr}
        <div class="info">
          <span>{qr.size} × {qr.size}칸 (버전 {qr.version})</span>
          <span>{modeName[qr.mode]} {qr.length.toLocaleString('ko-KR')}{qr.mode === 'byte' ? '바이트' : '자'}</span>
          <span>오류 정정 {qr.ecl}</span>
          {#if verdict === 'ok'}<span class="ok">✓ 읽기 확인됨</span>{:else if verdict === 'fail'}<span class="bad">✕ 읽히지 않습니다</span>{/if}
        </div>
        {#if verdict === 'fail'}<p class="warn bad">이 브라우저의 인식기로 읽어 보았지만 실패했습니다. 색 대비를 높이거나 로고를 줄여 보세요.</p>{/if}
        {#each warnings as w (w)}<p class="warn">{w}</p>{/each}
        <div class="export">
          <button class="btn primary" onclick={savePng}>PNG 저장</button>
          <select class="field" bind:value={pngSize} aria-label="PNG 크기">
            {#each [256, 512, 1024, 2048, 4096] as s (s)}<option value={s}>{s}px</option>{/each}
          </select>
          <button class="btn" onclick={saveSvg} title="인쇄물에 넣을 때는 SVG 가 깨끗합니다">SVG 저장</button>
          <button class="btn" onclick={copyPng}>이미지 복사</button>
        </div>
        {#if toast}<p class="toast" role="status">{toast}</p>{/if}
      {/if}
    </section>

    <section class="panel">
      <h2>모양</h2>
      <div class="f">
        <span>점</span>
        <div class="seg" role="group" aria-label="점 모양">
          {#each [['square', '네모'], ['rounded', '둥글게'], ['dots', '동그라미']] as [id, name] (id)}
            <button aria-pressed={style.dots === id} onclick={() => (style.dots = id as Dots)}>{name}</button>
          {/each}
        </div>
      </div>
      <div class="f">
        <span>귀퉁이</span>
        <div class="seg" role="group" aria-label="귀퉁이 모양">
          {#each [['square', '네모'], ['rounded', '둥글게'], ['circle', '원']] as [id, name] (id)}
            <button aria-pressed={style.eyes === id} onclick={() => (style.eyes = id as Eyes)}>{name}</button>
          {/each}
        </div>
      </div>
      <div class="two">
        <label class="f"><span>무늬 색</span><input type="color" bind:value={style.fg} /></label>
        <label class="f"><span>배경 색</span><input type="color" bind:value={style.bg} disabled={style.transparent} /></label>
      </div>
      <label class="check"><input type="checkbox" bind:checked={style.transparent} /> 배경 투명</label>
      <label class="f">
        <span>여백 <b>{style.margin}칸</b></span>
        <input type="range" min="0" max="8" bind:value={style.margin} />
      </label>
      <label class="f">
        <span>오류 정정 {#if style.logo}<small>— 로고가 있어 최고로 고정</small>{/if}</span>
        <select class="field" bind:value={ecl} disabled={!!style.logo}>
          {#each ['L', 'M', 'Q', 'H'] as e (e)}<option value={e}>{eclName[e as Ecl]}</option>{/each}
        </select>
      </label>
      <p class="note">높을수록 일부가 가려지거나 더러워져도 읽히지만, 무늬가 촘촘해집니다. 자리가 남으면 자동으로 더 높은 수준을 씁니다.</p>

      <div class="f">
        <span>가운데 로고</span>
        <div class="logo-row">
          <label class="btn sm">
            {style.logo ? '바꾸기' : '이미지 고르기'}
            <input
              type="file"
              accept="image/*"
              hidden
              onchange={(e) => {
                pickLogo(e.currentTarget.files?.[0]);
                e.currentTarget.value = '';
              }}
            />
          </label>
          {#if style.logo}
            <img src={style.logo} alt="" />
            <button class="btn sm ghost danger" onclick={() => (style.logo = '')}>빼기</button>
          {/if}
        </div>
      </div>
      {#if style.logo}
        <label class="f">
          <span>로고 크기 <b>{Math.round(style.logoScale * 100)}%</b></span>
          <input type="range" min="0.12" max="0.3" step="0.01" bind:value={style.logoScale} />
        </label>
      {/if}
      <button class="btn sm ghost reset" onclick={() => ((style = { ...defaultStyle }), (ecl = 'M'))}>모양 처음으로</button>
    </section>
  </div>
</ToolShell>

<style>
  .page {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(260px, 340px) minmax(0, 1fr) minmax(250px, 300px);
    gap: 14px;
    padding: 14px;
    max-width: 1320px;
    width: 100%;
    margin: 0 auto;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    overflow-y: auto;
  }
  .panel h2 {
    font-size: 15px;
  }
  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .kinds button {
    height: 30px;
    padding: 0 11px;
    border: 1px solid var(--border-strong);
    border-radius: 99px;
    background: var(--surface);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
  }
  .kinds button[aria-pressed='true'] {
    border-color: var(--app);
    background: var(--app-soft);
    color: var(--text);
  }
  .f {
    display: grid;
    gap: 5px;
    font-size: 12.5px;
    color: var(--muted);
    min-width: 0;
  }
  .f > span b {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .f small {
    color: var(--faint);
  }
  .f .field {
    width: 100%;
    color: var(--text);
  }
  .f input[type='range'] {
    width: 100%;
    accent-color: var(--app);
    margin: 0;
  }
  .f input[type='color'] {
    width: 100%;
    height: 34px;
    padding: 2px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .f input[type='color']:disabled {
    opacity: 0.4;
  }
  .f .seg {
    display: flex;
  }
  .f .seg button {
    flex: 1;
    padding: 0 6px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .with-btn {
    display: flex;
    gap: 6px;
  }
  .with-btn .btn {
    height: 34px;
    flex: none;
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
    font-size: 12px;
    color: var(--faint);
    line-height: 1.6;
  }
  .note code {
    font-family: var(--mono);
  }
  .raw summary {
    font-size: 12px;
    color: var(--muted);
    cursor: pointer;
  }
  .raw pre {
    margin: 6px 0 0;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--surface-2);
    font: 11.5px/1.6 var(--mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .logo-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .logo-row img {
    width: 30px;
    height: 30px;
    object-fit: contain;
    border-radius: 6px;
    background: #fff;
    box-shadow: 0 0 0 1px var(--border);
  }
  .reset {
    align-self: flex-start;
    margin-top: auto;
  }

  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    min-height: 0;
    padding: 8px 0;
    overflow-y: auto;
  }
  .preview {
    flex: none;
    width: min(100%, 420px);
    aspect-ratio: 1;
    border-radius: 14px;
    overflow: hidden;
    background: #fff;
    box-shadow: var(--shadow-md), 0 0 0 1px var(--border);
  }
  .preview.checker {
    background: repeating-conic-gradient(#e4e7ec 0 25%, #fff 0 50%) 0 0 / 20px 20px;
  }
  .preview.empty {
    display: grid;
    place-items: center;
    background: var(--surface);
    box-shadow: none;
    border: 1.5px dashed var(--border-strong);
    text-align: center;
    color: var(--faint);
    font-size: 13.5px;
    line-height: 1.7;
    padding: 20px;
  }
  .preview :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .info {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 14px;
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .ok {
    color: var(--ok);
    font-weight: 650;
  }
  .bad {
    color: var(--bad);
    font-weight: 650;
  }
  .warn {
    max-width: 420px;
    padding: 6px 12px;
    border-radius: 10px;
    font-size: 12.5px;
    text-align: center;
    color: color-mix(in srgb, #f08c00 70%, var(--text));
    background: color-mix(in srgb, #f08c00 12%, var(--surface));
  }
  .warn.bad {
    color: var(--bad);
    background: color-mix(in srgb, var(--bad) 10%, var(--surface));
  }
  .export {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 4px;
  }
  .export select {
    width: 96px;
  }
  .toast {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ok);
  }

  @media (max-width: 980px) {
    .page {
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 10px;
      gap: 10px;
    }
    .panel,
    .center {
      overflow: visible;
      flex: none;
    }
    .preview {
      width: min(100%, 320px);
    }
  }
</style>
