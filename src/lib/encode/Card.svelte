<script lang="ts">
  // 풀기 결과 한 장: 제목 · 까닭 · 풀어낸 내용 · 복사 · 다시 풀기
  import { downloadBlob } from '$lib/download';
  import { base64Decode, formatBytes, gunzip, hexDump, utf8Encode } from './codec';
  import { confidenceLabel, payload, type Candidate } from './detect';
  import { canVerify, describeAlg, explainClaims, verifyHmac } from './jwt';

  let {
    c,
    now,
    first = false,
    oncopy,
    onagain,
  }: {
    c: Candidate;
    now: number;
    first?: boolean;
    oncopy: (text: string, what: string) => void;
    onagain: (text: string, label: string) => void;
  } = $props();

  /** 화면에 그리는 글자 수 · 바이트 수의 한도 (복사 · 내려받기는 모두) */
  const TEXT_MAX = 20_000;
  const DUMP_MAX = 256;
  const n = (v: number) => v.toLocaleString('ko-KR');
  const clip = (s: string) => (s.length > TEXT_MAX ? s.slice(0, TEXT_MAX) : s);

  // ── JWT 서명 확인 (키는 어디에도 저장하지 않는다) ──
  let secret = $state('');
  let secretIsBase64 = $state(false);
  let verified = $state<'none' | 'ok' | 'bad' | 'badkey'>('none');
  const claims = $derived(c.jwt ? explainClaims(c.jwt.payload, now) : []);
  $effect(() => {
    const jwt = c.jwt;
    const key = secret;
    const b64 = secretIsBase64;
    if (!jwt || !key || !canVerify(jwt.alg)) {
      verified = 'none';
      return;
    }
    const bytes = b64 ? base64Decode(key) : utf8Encode(key);
    if (!bytes) {
      verified = 'badkey';
      return;
    }
    let stale = false;
    verifyHmac(jwt, bytes).then(
      (ok) => !stale && (verified = ok ? 'ok' : 'bad'),
      () => !stale && (verified = 'bad'),
    );
    return () => {
      stale = true;
    };
  });

  // ── 이미지 미리보기 ──
  let preview = $state('');
  $effect(() => {
    if (!c.bytes || !c.file?.image) {
      preview = '';
      return;
    }
    const url = URL.createObjectURL(new Blob([c.bytes as BlobPart], { type: c.file.mime }));
    preview = url;
    return () => URL.revokeObjectURL(url);
  });

  // ── gzip 이면 한 겹 더 푼다 ──
  let inner = $state.raw<ReturnType<typeof payload> | null>(null);
  let innerState = $state<'none' | 'busy' | 'done' | 'failed'>('none');
  $effect(() => {
    inner = null;
    if (!c.bytes || c.file?.ext !== 'gz') {
      innerState = 'none';
      return;
    }
    let stale = false;
    innerState = 'busy';
    gunzip(c.bytes).then((out) => {
      if (stale) return;
      inner = out ? payload(out) : null;
      innerState = out ? 'done' : 'failed';
    });
    return () => {
      stale = true;
    };
  });

  function download(bytes: Uint8Array, ext: string, mime: string) {
    downloadBlob(new Blob([bytes as BlobPart], { type: mime }), `decoded.${ext}`);
  }
  const level = $derived(c.confidence >= 0.9 ? 'sure' : c.confidence >= 0.6 ? 'likely' : 'maybe');
</script>

{#snippet bytesView(bytes: Uint8Array, file: Candidate['file'])}
  <p class="file">
    <b>{file ? file.name : '글이 아닌 바이트'}</b> · {formatBytes(bytes.length)}
  </p>
  {#if file?.image && bytes === c.bytes && preview}
    <img class="preview" src={preview} alt="풀어낸 이미지 미리보기" />
  {/if}
  <pre class="out dump" aria-label="{c.title} 바이트">{hexDump(bytes, DUMP_MAX)}</pre>
  {#if bytes.length > DUMP_MAX}<p class="cut">앞 {DUMP_MAX}바이트만 보여 줍니다. 내려받으면 모두 들어갑니다.</p>{/if}
{/snippet}

<article class="card" class:first aria-label={c.title}>
  <header>
    <h2>{c.title}</h2>
    <span class="conf {level}">{confidenceLabel(c.confidence)}</span>
    <p class="reason">{c.reason}</p>
  </header>

  {#each c.notes ?? [] as note (note.text)}
    <p class="note {note.tone ?? ''}">{note.text}</p>
  {/each}

  {#if c.jwt}
    <dl class="rows">
      <div>
        <dt>알고리즘</dt>
        <dd><span class="v">{c.jwt.alg}</span><small>{describeAlg(c.jwt.alg)}</small></dd>
      </div>
      {#each claims as cl (cl.key)}
        <div>
          <dt>{cl.name} <code>{cl.key}</code></dt>
          <dd><span class="v">{cl.value}</span>{#if cl.note}<small class={cl.tone ?? ''}>{cl.note}</small>{/if}</dd>
        </div>
      {/each}
    </dl>
    <div class="part">
      <h3>머리 <button class="btn sm ghost" onclick={() => oncopy(c.jwt!.headerJson, '머리를')}>복사</button></h3>
      <pre class="out" aria-label="JWT 머리">{c.jwt.headerJson}</pre>
    </div>
    <div class="part">
      <h3>내용 <button class="btn sm ghost" onclick={() => oncopy(c.jwt!.payloadJson, '내용을')}>복사</button></h3>
      <pre class="out" aria-label="JWT 내용">{clip(c.jwt.payloadJson)}</pre>
    </div>
    <div class="part">
      <h3>서명</h3>
      {#if canVerify(c.jwt.alg)}
        <div class="secret">
          <input class="field mono" type="text" bind:value={secret} aria-label="서명 확인용 비밀 키" placeholder="비밀 키를 넣으면 서명을 확인합니다" spellcheck="false" autocomplete="off" autocapitalize="off" />
          <label class="check"><input type="checkbox" bind:checked={secretIsBase64} /> 키가 Base64</label>
        </div>
        <p class="sig {verified}" role="status">
          {#if verified === 'ok'}
            서명이 맞습니다 — 이 키로 만든 토큰이고 내용이 바뀌지 않았습니다.
          {:else if verified === 'bad'}
            서명이 맞지 않습니다 — 키가 다르거나 내용이 바뀌었습니다.
          {:else if verified === 'badkey'}
            키를 Base64 로 읽을 수 없습니다.
          {:else}
            서명은 확인하지 않았습니다 — 내용은 누구나 읽을 수 있습니다.
          {/if}
        </p>
        <p class="cut">키는 이 화면에서만 쓰고 저장하지 않습니다.</p>
      {:else if /^none$/i.test(c.jwt.alg)}
        <p class="sig bad">서명이 없는 토큰입니다.</p>
      {:else}
        <p class="sig none">서명은 확인하지 않았습니다 — 내용은 누구나 읽을 수 있습니다.</p>
        <p class="cut">{c.jwt.alg} 서명은 공개 키가 있어야 확인할 수 있어 여기서는 하지 않습니다. 서명 길이 {c.jwt.signature.length}바이트.</p>
      {/if}
    </div>
  {:else}
    {#if c.rows?.length}
      <dl class="rows">
        {#each c.rows as row, i (i)}
          <div>
            <dt>{row.label}</dt>
            <dd>
              <span class="v">{row.value === '' ? '(빈 값)' : clip(row.value)}</span>
              {#if row.note}<small class={row.tone ?? (row.note.startsWith('두 번') ? 'warn' : '')}>{row.note}</small>{/if}
            </dd>
            <span class="acts">
              {#if row.value}<button class="btn sm ghost" aria-label="{row.label} 복사" onclick={() => oncopy(row.value, `${row.label} 값을`)}>복사</button>{/if}
              {#if row.again}<button class="btn sm ghost" aria-label="{row.label} 다시 풀기" onclick={() => onagain(row.value, row.label)}>다시 풀기</button>{/if}
            </span>
          </div>
        {/each}
      </dl>
    {/if}

    {#if c.text != null}
      <pre class="out" aria-label="{c.title} 결과">{clip(c.text)}</pre>
      {#if c.text.length > TEXT_MAX}<p class="cut">앞 {n(TEXT_MAX)}자만 보여 줍니다 (모두 {n(c.text.length)}자). 복사하면 모두 들어갑니다.</p>{/if}
    {/if}

    {#if c.bytes}
      {@render bytesView(c.bytes, c.file)}
      {#if innerState === 'busy'}
        <p class="cut">gzip 을 푸는 중…</p>
      {:else if innerState === 'failed'}
        <p class="cut">gzip 을 풀지 못했습니다 (내용이 잘렸거나 이 브라우저가 지원하지 않습니다).</p>
      {:else if inner}
        <div class="part">
          <h3>gzip 을 풀면</h3>
          {#if inner.text != null}
            <pre class="out" aria-label="gzip 을 푼 결과">{clip(inner.text)}</pre>
            {#if inner.text.length > TEXT_MAX}<p class="cut">앞 {n(TEXT_MAX)}자만 보여 줍니다. 복사하면 모두 들어갑니다.</p>{/if}
          {:else if inner.bytes}
            {@render bytesView(inner.bytes, inner.file)}
          {/if}
        </div>
      {/if}
    {/if}
  {/if}

  {#if c.text != null || c.bytes}
    <footer>
      {#if c.text != null}
        <button class="btn sm primary" onclick={() => oncopy(c.text!, '결과를')}>복사</button>
        {#if c.again}<button class="btn sm" onclick={() => onagain(c.text!, c.title)}>이걸 다시 풀기</button>{/if}
      {/if}
      {#if c.bytes}
        <button class="btn sm primary" onclick={() => download(c.bytes!, c.file?.ext ?? 'bin', c.file?.mime ?? 'application/octet-stream')}>내려받기</button>
      {/if}
      {#if inner?.text != null}
        <button class="btn sm" onclick={() => oncopy(inner!.text!, '푼 내용을')}>푼 내용 복사</button>
        {#if inner.again}<button class="btn sm" onclick={() => onagain(inner!.text!, 'gzip')}>푼 내용 다시 풀기</button>{/if}
      {:else if inner?.bytes}
        <button class="btn sm" onclick={() => download(inner!.bytes!, inner!.file?.ext ?? 'bin', inner!.file?.mime ?? 'application/octet-stream')}>푼 내용 내려받기</button>
      {/if}
    </footer>
  {/if}
</article>

<style>
  .card {
    display: grid;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    min-width: 0;
  }
  .card.first {
    border-color: var(--app-line);
    box-shadow: inset 3px 0 0 var(--app);
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
  }
  h2 {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .conf {
    padding: 1px 8px;
    border-radius: 99px;
    background: var(--surface-2);
    font-size: 11.5px;
    font-weight: 650;
    color: var(--muted);
  }
  .conf.sure {
    background: var(--app-soft);
    color: var(--text);
  }
  .reason {
    flex-basis: 100%;
    font-size: 13px;
    color: var(--muted);
    line-height: 1.55;
  }
  .note {
    padding: 7px 10px;
    border-radius: 9px;
    background: var(--surface-2);
    font-size: 12.5px;
    color: var(--muted);
    line-height: 1.55;
  }
  .note.warn {
    background: color-mix(in srgb, #f59f00 14%, var(--surface));
    color: var(--text);
  }
  .note.bad {
    background: color-mix(in srgb, var(--bad) 12%, var(--surface));
    color: var(--bad);
    font-weight: 600;
  }
  .rows {
    display: grid;
    margin: 0;
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }
  .rows > div {
    display: grid;
    grid-template-columns: minmax(84px, 150px) minmax(0, 1fr) auto;
    gap: 2px 10px;
    align-items: start;
    padding: 6px 10px;
    font-size: 13px;
  }
  .rows > div + div {
    border-top: 1px solid var(--border);
  }
  dt {
    color: var(--muted);
    font-size: 12.5px;
    padding-top: 1px;
    overflow-wrap: anywhere;
  }
  dt code {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--faint);
  }
  dd {
    margin: 0;
    display: grid;
    gap: 1px;
    min-width: 0;
  }
  .v {
    font-family: var(--mono);
    font-size: 12.5px;
    overflow-wrap: anywhere;
    word-break: break-all;
    white-space: pre-wrap;
  }
  small {
    font-size: 12px;
    color: var(--muted);
  }
  small.bad {
    color: var(--bad);
    font-weight: 650;
  }
  small.ok {
    color: var(--ok);
    font-weight: 650;
  }
  small.warn {
    color: #b06a00;
    font-weight: 650;
  }
  :global([data-theme='dark']) small.warn {
    color: #f5b942;
  }
  .acts {
    display: flex;
    gap: 2px;
    margin: -3px -6px -3px 0;
  }
  .part {
    display: grid;
    gap: 5px;
    min-width: 0;
  }
  h3 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 28px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .out {
    margin: 0;
    padding: 10px 12px;
    max-height: 420px;
    overflow: auto;
    border-radius: 10px;
    background: var(--surface-2);
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.65;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-all;
    tab-size: 2;
  }
  .out.dump {
    white-space: pre;
    word-break: normal;
    overflow-wrap: normal;
    font-size: 11.5px;
  }
  .file {
    font-size: 13px;
    color: var(--muted);
  }
  .file b {
    color: var(--text);
  }
  .preview {
    max-width: 100%;
    max-height: 240px;
    min-width: 32px;
    min-height: 32px;
    object-fit: contain;
    image-rendering: pixelated;
    justify-self: start;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: repeating-conic-gradient(var(--surface-2) 0 25%, var(--surface) 0 50%) 0 0 / 16px 16px;
  }
  .cut {
    font-size: 12px;
    color: var(--faint);
  }
  .secret {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
  }
  .secret .field {
    flex: 1;
    min-width: 180px;
  }
  .mono {
    font-family: var(--mono);
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    color: var(--muted);
    white-space: nowrap;
  }
  .sig {
    font-size: 13px;
    color: var(--muted);
  }
  .sig.ok {
    color: var(--ok);
    font-weight: 650;
  }
  .sig.bad,
  .sig.badkey {
    color: var(--bad);
    font-weight: 650;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  @media (max-width: 520px) {
    .rows > div {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    dt {
      grid-column: 1;
    }
    dd {
      grid-column: 1 / -1;
      grid-row: 2;
    }
    .acts {
      grid-column: 2;
      grid-row: 1;
    }
  }
</style>
