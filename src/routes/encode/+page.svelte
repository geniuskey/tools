<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import { load, save } from '$lib/storage';
  import Card from '$lib/encode/Card.svelte';
  import { base64Encode, encodeAll, formatBytes, hexEncode, textStats, utf8Encode } from '$lib/encode/codec';
  import { detect, type Candidate } from '$lib/encode/detect';
  import { Crc32, HASH_NAMES, Md5, SHA_ALGS, hashByHexLength, hmac, normalizeChecksum, sha, type ShaAlg } from '$lib/encode/hash';
  import { password, passwordBits, passwordSets, strengthNote, token, tokenBits, ulid, uuidV4, uuidV7, type TokenKind } from '$lib/encode/ids';
  import { signHs256 } from '$lib/encode/jwt';
  import { kst, utcIso } from '$lib/encode/time';

  const KEY = 'tools:encode:v1';
  /** 이보다 긴 글은 저장하지 않는다 */
  const SAVE_MAX = 200_000;
  /** 이보다 긴 글은 치는 동안 잠깐 기다렸다가 알아본다 */
  const SLOW = 50_000;
  /** 표 한 칸에 그리는 글자 수 */
  const CELL_MAX = 3000;
  /** SHA 는 한 번에 읽어야 해서 이보다 큰 파일은 건너뛴다 */
  const SHA_MAX = 256 * 1024 * 1024;
  const DATA_URI_MAX = 20 * 1024 * 1024;
  const CHUNK = 4 * 1024 * 1024;
  const LIST_MAX = 200;

  type Mode = 'decode' | 'encode' | 'hash' | 'gen';
  const MODES: [Mode, string][] = [
    ['decode', '풀기'],
    ['encode', '만들기'],
    ['hash', '해시'],
    ['gen', '생성'],
  ];

  let mode = $state<Mode>('decode');
  let ready = $state(false);
  let toast = $state('');
  /** 1초마다 가는 시계 (생성 탭) 와, 가끔만 바뀌는 시계 (풀기 결과의 "3일 전") */
  let clock = $state(Date.now());
  let slowClock = $state(Date.now());

  const n = (v: number) => v.toLocaleString('ko-KR');
  const cell = (s: string) => (s.length > CELL_MAX ? s.slice(0, CELL_MAX) + '…' : s);

  function say(msg: string) {
    toast = msg;
    setTimeout(() => toast === msg && (toast = ''), 2200);
  }
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      say(`${what} 복사했습니다`);
    } catch {
      say('복사하지 못했습니다');
    }
  }

  // ── 풀기 ──
  let input = $state('');
  /** 다시 풀기로 들어온 길. 마지막이 지금 보고 있는 글이다 */
  let trail = $state<{ label: string; text: string }[]>([]);
  let found = $state.raw<Candidate[]>([]);
  let thinking = $state(false);
  const inputStats = $derived(textStats(input));

  $effect(() => {
    const text = input;
    if (text.length <= SLOW) {
      found = detect(text, slowClock);
      thinking = false;
      return;
    }
    thinking = true;
    const t = setTimeout(() => {
      found = detect(text, untrack(() => slowClock));
      thinking = false;
    }, 250);
    return () => clearTimeout(t);
  });

  function again(text: string, label: string) {
    if (!trail.length) trail.push({ label: '처음', text: input });
    trail.push({ label, text });
    input = text;
    document.querySelector<HTMLElement>('.results')?.scrollTo({ top: 0 });
  }
  function back(i: number) {
    input = trail[i].text;
    trail = i === 0 ? [] : trail.slice(0, i + 1);
  }
  function typed() {
    // 손으로 고치거나 새로 붙여넣으면 새 글이다 — 풀어 온 길은 지운다
    if (trail.length) trail = [];
  }
  function setInput(text: string) {
    trail = [];
    input = text;
  }
  async function paste() {
    try {
      setInput(await navigator.clipboard.readText());
    } catch {
      say('붙여넣지 못했습니다 — 상자를 누르고 Ctrl+V 를 누르세요');
    }
  }

  const b64 = (s: string) => base64Encode(utf8Encode(s));
  const EXAMPLES: { name: string; hint: string; make: () => string | Promise<string> }[] = [
    {
      name: 'JWT',
      hint: '로그인 토큰 — 만료 시각과 서명 (비밀 키는 secret)',
      make: () => {
        const now = Math.floor(Date.now() / 1000);
        return signHs256({ iss: 'https://auth.example.kr', sub: 'user-1024', name: '홍길동', role: 'admin', iat: now - 48 * 60, exp: now + 3 * 3600 + 12 * 60 }, 'secret');
      },
    },
    {
      name: '한글이 든 주소',
      hint: '쿼리 값 · 두 번 인코딩 · 안에 든 Base64',
      make: () => `https://search.example.kr/find?q=${encodeURIComponent('서울 날씨').replace(/%20/g, '+')}&next=${encodeURIComponent(encodeURIComponent('/home?tab=1'))}&state=${encodeURIComponent(b64('{"user":"홍길동","from":"메일"}'))}#${encodeURIComponent('결과')}`,
    },
    { name: '유닉스 시간', hint: '10자리 숫자 → 한국 시간', make: () => '1700000000' },
    { name: 'Base64', hint: '풀면 한글', make: () => b64('안녕하세요, 반갑습니다!') },
    { name: '깨진 글', hint: 'ì•ˆë…• 처럼 깨진 한글 되살리기', make: () => 'ì•ˆë…•í•˜ì„¸ìš”' },
    { name: 'UUID v7', hint: '안에 든 만든 시각', make: () => uuidV7() },
    { name: 'HTML 엔티티', hint: '&#44032; · &amp;', make: () => '&lt;p&gt;&#44032;&#45208;&#xB2E4; &amp; &copy; 2026&lt;/p&gt;' },
    { name: '\\u 이스케이프', hint: '\\uc548\\ub155', make: () => '\\uc548\\ub155\\ud558\\uc138\\uc694 \\ud83d\\ude00' },
  ];
  async function example(e: (typeof EXAMPLES)[number]) {
    setInput(await e.make());
  }

  // ── 만들기 ──
  let plain = $state('');
  let dataUri = $state.raw<{ name: string; size: number; value: string } | null>(null);
  let over = $state(false);
  const encoded = $derived(encodeAll(plain));
  const plainStats = $derived(textStats(plain));

  async function toDataUri(file: File) {
    if (file.size > DATA_URI_MAX) return say(`파일이 너무 큽니다 (${formatBytes(DATA_URI_MAX)} 까지)`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      dataUri = { name: file.name, size: file.size, value: `data:${file.type || 'application/octet-stream'};base64,${base64Encode(bytes)}` };
    } catch {
      say('파일을 읽지 못했습니다');
    }
  }

  // ── 해시 ──
  let hashText = $state('');
  let hashFile = $state.raw<File | null>(null);
  let hashOut = $state<'hex' | 'base64'>('hex');
  let hmacKey = $state('');
  let hmacAlg = $state<ShaAlg>('SHA-256');
  let expected = $state('');
  let digests = $state.raw<Record<string, Uint8Array>>({});
  /** HMAC 을 만들 원본 (글이거나, 한 번에 읽을 수 있는 크기의 파일) */
  let hashData = $state.raw<Uint8Array | null>(null);
  let hmacDigest = $state.raw<Uint8Array | null>(null);
  let progress = $state(0);
  let hashing = $state(false);
  let shaSkipped = $state(false);
  let hashError = $state('');
  let run = 0;

  async function hashAll(text: string, file: File | null) {
    const id = ++run;
    hashError = '';
    shaSkipped = false;
    try {
      if (!file) {
        const bytes = utf8Encode(text);
        const next: Record<string, Uint8Array> = { MD5: new Md5().update(bytes).digest(), CRC32: new Crc32().update(bytes).digest() };
        for (const alg of SHA_ALGS) next[alg] = await sha(alg, bytes);
        if (id !== run) return;
        digests = next;
        hashData = bytes;
        hashing = false;
        return;
      }
      hashing = true;
      progress = 0;
      digests = {};
      hashData = null;
      // MD5 · CRC32 는 조각씩 읽어 넣는다 — 큰 파일도 화면이 멈추지 않는다
      const md = new Md5();
      const crc = new Crc32();
      for (let off = 0; off < file.size; off += CHUNK) {
        const buf = new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer());
        if (id !== run) return;
        md.update(buf);
        crc.update(buf);
        progress = Math.min(1, (off + buf.length) / file.size);
      }
      progress = 1;
      const next: Record<string, Uint8Array> = { MD5: md.digest(), CRC32: crc.digest() };
      digests = next;
      if (file.size > SHA_MAX) shaSkipped = true;
      else {
        const all = new Uint8Array(await file.arrayBuffer());
        for (const alg of SHA_ALGS) {
          const d = await sha(alg, all);
          if (id !== run) return;
          next[alg] = d;
          digests = { ...next };
        }
        hashData = all;
      }
      hashing = false;
    } catch {
      if (id !== run) return;
      hashing = false;
      hashError = '파일을 읽지 못했습니다. 다시 골라 보세요.';
    }
  }
  $effect(() => {
    const text = hashText;
    const file = hashFile;
    if (!ready || mode !== 'hash') return;
    if (file || text.length <= SLOW) {
      untrack(() => hashAll(text, file));
      return;
    }
    const t = setTimeout(() => hashAll(text, file), 200);
    return () => clearTimeout(t);
  });
  $effect(() => {
    const data = hashData;
    const key = hmacKey;
    const alg = hmacAlg;
    if (!data || !key) {
      hmacDigest = null;
      return;
    }
    let stale = false;
    hmac(alg, utf8Encode(key), data).then(
      (d) => !stale && (hmacDigest = d),
      () => !stale && (hmacDigest = null),
    );
    return () => {
      stale = true;
    };
  });

  const show = (d: Uint8Array | undefined | null) => (d ? (hashOut === 'hex' ? hexEncode(d) : base64Encode(d)) : '');
  const hashRows = $derived([
    ...HASH_NAMES.map((name) => ({ name, digest: digests[name] as Uint8Array | undefined })),
    ...(hmacKey ? [{ name: `HMAC-${hmacAlg}`, digest: hmacDigest ?? undefined }] : []),
  ]);
  const want = $derived(normalizeChecksum(expected));
  const verdict = $derived.by(() => {
    if (!expected.trim()) return null;
    if (!want) return { tone: 'bad', text: '해시로 보이지 않습니다. 16진수나 Base64 로 적힌 MD5 · SHA · CRC32 값을 넣으세요.', hit: '' };
    const same = hashRows.filter((r) => r.digest && r.digest.length * 2 === want.length);
    const hit = same.find((r) => hexEncode(r.digest!) === want);
    if (hit) return { tone: 'ok', text: `일치 — ${hit.name} 값이 같습니다.`, hit: hit.name };
    const name = hashByHexLength(want.length);
    if (!same.length) return { tone: 'wait', text: hashing ? '계산이 끝나면 견줍니다…' : `${name} 길이인데, 견줄 값이 아직 없습니다.`, hit: '' };
    return { tone: 'bad', text: `다름 — ${same.map((r) => r.name).join(' · ')} 길이인데 값이 다릅니다.`, hit: '' };
  });
  function rowState(r: { name: string; digest?: Uint8Array }): '' | 'match' | 'differ' {
    if (!want || !r.digest || r.digest.length * 2 !== want.length) return '';
    return hexEncode(r.digest) === want ? 'match' : verdict?.hit ? '' : 'differ';
  }
  function pickHashFile(file: File | undefined) {
    if (file) hashFile = file;
  }

  // ── 생성 ──
  type GenKind = 'uuid4' | 'uuid7' | 'ulid' | 'token' | 'password';
  const GEN: [GenKind, string, string][] = [
    ['uuid4', 'UUID v4', '무작위 122비트. 가장 흔히 쓰는 식별자입니다.'],
    ['uuid7', 'UUID v7', '앞쪽이 만든 시각이라 만든 순서대로 줄 섭니다. 데이터베이스 키로 좋습니다.'],
    ['ulid', 'ULID', '시각 + 무작위 80비트를 26글자로. 헷갈리는 글자(I L O U)를 쓰지 않습니다.'],
    ['token', '무작위 토큰', 'API 키 · 세션 번호처럼 맞힐 수 없어야 하는 값.'],
    ['password', '비밀번호', '고른 글자 종류가 적어도 하나씩 들어갑니다.'],
  ];
  let genKind = $state<GenKind>('uuid4');
  let count = $state(5);
  let tokenLen = $state(32);
  let tokenKind = $state<TokenKind>('hex');
  let pw = $state({ length: 20, lower: true, upper: true, digits: true, symbols: true, noAmbiguous: true });
  let made = $state.raw<string[]>([]);
  let round = $state(0);

  const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
    const x = Math.floor(Number(v));
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;
  };
  const pwOptions = $derived({ ...pw, length: clamp(pw.length, 4, 128, 20) });
  const bits = $derived(genKind === 'password' ? passwordBits(pwOptions) : genKind === 'token' ? tokenBits(clamp(tokenLen, 4, 512, 32), tokenKind) : 0);
  const strength = $derived(strengthNote(bits));
  const noSets = $derived(genKind === 'password' && !passwordSets(pwOptions).length);

  $effect(() => {
    void round;
    const total = clamp(count, 1, 1000, 5);
    const kind = genKind;
    const tl = clamp(tokenLen, 4, 512, 32);
    const tk = tokenKind;
    const po = pwOptions;
    if (!ready) return;
    const out: string[] = [];
    const now = Date.now();
    for (let i = 0; i < total; i++) {
      out.push(kind === 'uuid4' ? uuidV4() : kind === 'uuid7' ? uuidV7(now) : kind === 'ulid' ? ulid(now) : kind === 'token' ? token(tl, tk) : password(po));
    }
    made = out.filter(Boolean);
  });

  const nowRows = $derived([
    ['유닉스 시간 (초)', String(Math.floor(clock / 1000))],
    ['유닉스 시간 (밀리초)', String(clock)],
    ['한국 시간', kst(Math.floor(clock / 1000) * 1000)],
    ['UTC (ISO 8601)', utcIso(Math.floor(clock / 1000) * 1000)],
  ]);

  // ── 저장 · 시계 ──
  onMount(() => {
    const s = load<Record<string, any>>(KEY, {});
    if (MODES.some(([m]) => m === s.mode)) mode = s.mode;
    if (typeof s.input === 'string') input = s.input;
    if (typeof s.plain === 'string') plain = s.plain;
    if (typeof s.hashText === 'string') hashText = s.hashText;
    if (s.hashOut === 'base64') hashOut = 'base64';
    if (SHA_ALGS.includes(s.hmacAlg)) hmacAlg = s.hmacAlg;
    if (GEN.some(([k]) => k === s.genKind)) genKind = s.genKind;
    count = clamp(s.count, 1, 1000, 5);
    tokenLen = clamp(s.tokenLen, 4, 512, 32);
    if (['hex', 'base64url', 'alnum'].includes(s.tokenKind)) tokenKind = s.tokenKind;
    if (s.pw && typeof s.pw === 'object') {
      pw = {
        length: clamp(s.pw.length, 4, 128, 20),
        lower: s.pw.lower !== false,
        upper: s.pw.upper !== false,
        digits: s.pw.digits !== false,
        symbols: s.pw.symbols !== false,
        noAmbiguous: s.pw.noAmbiguous !== false,
      };
    }
    ready = true;
    const tick = setInterval(() => {
      clock = Date.now();
      if (clock - slowClock >= 20_000) slowClock = clock;
    }, 1000);
    return () => clearInterval(tick);
  });
  $effect(() => {
    // 파일 · 비밀 키 · 만든 비밀번호는 저장하지 않는다
    const snap = {
      mode,
      input: input.length < SAVE_MAX ? input : '',
      plain: plain.length < SAVE_MAX ? plain : '',
      hashText: hashText.length < SAVE_MAX ? hashText : '',
      hashOut,
      hmacAlg,
      genKind,
      count,
      tokenLen,
      tokenKind,
      pw: { ...pw },
    };
    if (ready) save(KEY, snap);
  });

  function dropFile(e: DragEvent, use: (f: File) => void) {
    e.preventDefault();
    over = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) use(f);
  }
  function dragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      over = true;
    }
  }
</script>

<ToolShell tool="encode">
  {#snippet actions()}
    <div class="seg" role="group" aria-label="무엇을 할까">
      {#each MODES as [m, name] (m)}
        <button aria-pressed={mode === m} onclick={() => (mode = m)}>{name}</button>
      {/each}
    </div>
  {/snippet}

  {#if mode === 'decode'}
    <div class="page">
      <section class="pane" aria-label="풀 글">
        {#if trail.length}
          <nav class="trail" aria-label="풀어 온 길">
            {#each trail as step, i (i)}
              {#if i}<span aria-hidden="true">›</span>{/if}
              {#if i < trail.length - 1}
                <button onclick={() => back(i)} title="이 단계로 돌아가기">{step.label}</button>
              {:else}
                <b aria-current="step">{step.label}</b>
              {/if}
            {/each}
          </nav>
        {/if}
        <textarea
          class="field text"
          bind:value={input}
          oninput={typed}
          spellcheck="false"
          autocapitalize="off"
          aria-label="풀 글"
          placeholder={'여기에 붙여넣으세요.\n\nBase64, 주소(URL), JWT, 유닉스 시간, 16진수, UUID …\n무엇인지 알아보고 풀어 줍니다.'}
        ></textarea>
        <div class="foot">
          <span class="count">{#if input}글자 {n(inputStats.chars)} · UTF-8 {n(inputStats.bytes)}바이트{/if}</span>
          <button class="btn sm" onclick={paste}>붙여넣기</button>
          <button class="btn sm ghost danger" disabled={!input} onclick={() => setInput('')}>비우기</button>
        </div>
        <p class="hint">붙여넣은 글은 이 브라우저 안에서만 풉니다. 서버로 보내지 않습니다.</p>
      </section>

      <section class="results" aria-label="풀어낸 결과" aria-live="polite">
        {#if !input.trim()}
          <div class="empty">
            <h2>무엇이든 붙여넣으세요</h2>
            <p>어떤 형식인지 고를 필요가 없습니다. 그럴듯한 읽기를 모두 보여 주고, 가장 확실한 것을 맨 위에 둡니다. 겹겹이 싸인 것은 "다시 풀기" 로 한 겹씩 벗깁니다.</p>
            <ul class="examples" aria-label="예시">
              {#each EXAMPLES as e (e.name)}
                <li>
                  <button onclick={() => example(e)}><b>{e.name}</b><span>{e.hint}</span></button>
                </li>
              {/each}
            </ul>
          </div>
        {:else if thinking && !found.length}
          <p class="plainmsg">알아보는 중…</p>
        {:else if !found.length}
          <div class="empty">
            <h2>특별한 형식으로 보이지 않습니다</h2>
            <p>Base64 · URL 인코딩 · JWT · 시각 · 식별자 어느 것으로도 읽히지 않는 보통 글입니다.</p>
            <dl class="mini">
              <div><dt>글자</dt><dd>{n(inputStats.chars)}</dd></div>
              <div><dt>UTF-8 바이트</dt><dd>{n(inputStats.bytes)}</dd></div>
              <div><dt>줄</dt><dd>{n(inputStats.lines)}</dd></div>
            </dl>
            <div class="row">
              <button class="btn sm" onclick={() => ((plain = input), (mode = 'encode'))}>이 글을 인코딩하기</button>
              <button class="btn sm" onclick={() => ((hashText = input), (hashFile = null), (mode = 'hash'))}>이 글의 해시 보기</button>
            </div>
          </div>
        {:else}
          {#if found[0].confidence < 0.6}<p class="plainmsg">확실하지 않습니다. 아래처럼 읽을 수는 있습니다.</p>{/if}
          {#each found as c, i (c.kind + i)}
            <Card {c} now={slowClock} first={i === 0} oncopy={copy} onagain={again} />
          {/each}
        {/if}
      </section>
    </div>
  {:else if mode === 'encode'}
    <div class="page">
      <section class="pane" class:over aria-label="바꿀 글" ondragover={dragOver} ondragleave={() => (over = false)} ondrop={(e) => dropFile(e, toDataUri)}>
        <textarea class="field text" bind:value={plain} spellcheck="false" aria-label="바꿀 글" placeholder={'여기에 글을 적으세요.\n\n적는 대로 Base64 · URL · 16진수 · HTML 엔티티 · \\u 이스케이프로 바꿔 보여 줍니다.'}></textarea>
        <div class="foot">
          <span class="count">{#if plain}글자 {n(plainStats.chars)} · UTF-8 {n(plainStats.bytes)}바이트{/if}</span>
          <label class="btn sm">
            파일 → data: 주소
            <input class="sr-only" type="file" aria-label="data: 주소로 바꿀 파일" onchange={(e) => (e.currentTarget.files?.[0] && toDataUri(e.currentTarget.files[0]), (e.currentTarget.value = ''))} />
          </label>
          <button class="btn sm ghost danger" disabled={!plain} onclick={() => (plain = '')}>비우기</button>
        </div>
        <p class="hint">파일을 여기에 끌어다 놓으면 data: 주소로 바꿉니다 (CSS · HTML 에 그림을 바로 넣을 때). 파일은 브라우저 밖으로 나가지 않습니다.</p>
      </section>

      <section class="results" aria-label="바꾼 결과">
        {#if dataUri}
          <div class="out-row">
            <div class="head">
              <h3>data: 주소 <small>{dataUri.name} · {formatBytes(dataUri.size)} → {n(dataUri.value.length)}자</small></h3>
              <button class="btn sm" onclick={() => copy(dataUri!.value, 'data: 주소를')}>복사</button>
              <button class="btn sm ghost" aria-label="data: 주소 지우기" onclick={() => (dataUri = null)}>지우기</button>
            </div>
            <code class="val">{cell(dataUri.value)}</code>
          </div>
        {/if}
        {#if !plain && !dataUri}
          <div class="empty">
            <h2>글을 적으면 모든 꼴로 한꺼번에</h2>
            <p>Base64, Base64URL, URL 인코딩, 16진수, HTML 엔티티, \u 이스케이프, JSON 문자열. 한글 도메인을 적으면 Punycode 도 나옵니다.</p>
            <div class="row">
              <button class="btn sm" onclick={() => (plain = '안녕하세요, tools! <b>&</b> 😀')}>예시 글 넣기</button>
              <button class="btn sm" onclick={() => (plain = '한글도메인.한국')}>한글 도메인 예시</button>
            </div>
          </div>
        {:else if plain}
          {#each encoded as row (row.id)}
            <div class="out-row">
              <div class="head">
                <h3>{row.label} {#if row.hint}<small>{row.hint}</small>{/if}</h3>
                <button class="btn sm" aria-label="{row.label} 복사" onclick={() => copy(row.value, `${row.label} 을`)}>복사</button>
              </div>
              <code class="val" aria-label={row.label}>{cell(row.value)}</code>
              {#if row.value.length > CELL_MAX}<p class="hint">앞 {n(CELL_MAX)}자만 보여 줍니다. 복사하면 모두 들어갑니다.</p>{/if}
            </div>
          {/each}
        {/if}
      </section>
    </div>
  {:else if mode === 'hash'}
    <div class="page">
      <section class="pane" class:over aria-label="해시를 만들 글이나 파일" ondragover={dragOver} ondragleave={() => (over = false)} ondrop={(e) => dropFile(e, pickHashFile)}>
        {#if hashFile}
          <div class="filebox">
            <b>{hashFile.name}</b>
            <span>{formatBytes(hashFile.size)}</span>
            {#if hashing}
              <progress value={progress} max="1" aria-label="읽는 중"></progress>
              <span role="status">{progress < 1 ? `읽는 중 ${Math.round(progress * 100)}%` : 'SHA 계산 중…'}</span>
            {:else if hashError}
              <span class="bad" role="status">{hashError}</span>
            {:else}
              <span role="status">다 읽었습니다</span>
            {/if}
            <button class="btn sm" onclick={() => (hashFile = null)}>글로 돌아가기</button>
          </div>
        {:else}
          <textarea class="field text" bind:value={hashText} spellcheck="false" aria-label="해시를 만들 글" placeholder={'여기에 글을 적거나, 파일을 끌어다 놓으세요.\n\nMD5 · SHA-1 · SHA-256 · SHA-384 · SHA-512 · CRC32 를 한꺼번에 만듭니다.'}></textarea>
        {/if}
        <div class="foot">
          <span class="count">{#if !hashFile}UTF-8 {n(textStats(hashText).bytes)}바이트{/if}</span>
          <label class="btn sm">
            파일 고르기
            <input class="sr-only" type="file" aria-label="해시를 만들 파일" onchange={(e) => (pickHashFile(e.currentTarget.files?.[0]), (e.currentTarget.value = ''))} />
          </label>
          {#if !hashFile}<button class="btn sm ghost danger" disabled={!hashText} onclick={() => (hashText = '')}>비우기</button>{/if}
        </div>
        <p class="hint">파일은 브라우저 밖으로 나가지 않습니다. 이 기기에서 조각조각 읽어 계산합니다.</p>

        <div class="opts">
          <label class="f">
            <span>HMAC 키 <small>(넣으면 키로 서명한 값도 만듭니다)</small></span>
            <span class="with">
              <input class="field mono" type="text" bind:value={hmacKey} aria-label="HMAC 키" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="비워 두면 만들지 않습니다" />
              <select class="field" bind:value={hmacAlg} aria-label="HMAC 해시">
                {#each SHA_ALGS as a (a)}<option value={a}>{a}</option>{/each}
              </select>
            </span>
          </label>
          <label class="f">
            <span>비교 <small>(내려받은 파일의 체크섬을 붙여넣으세요)</small></span>
            <input class="field mono" type="text" bind:value={expected} aria-label="비교할 체크섬" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="예: 9f86d081884c7d65…" />
          </label>
          {#if verdict}<p class="verdict {verdict.tone}" role="status">{verdict.text}</p>{/if}
        </div>
      </section>

      <section class="results" aria-label="해시">
        <div class="bar">
          <div class="seg" role="group" aria-label="적는 꼴">
            <button aria-pressed={hashOut === 'hex'} onclick={() => (hashOut = 'hex')}>16진수</button>
            <button aria-pressed={hashOut === 'base64'} onclick={() => (hashOut = 'base64')}>Base64</button>
          </div>
          {#if !hashFile && !hashText}<span class="hint">빈 글의 해시입니다.</span>{/if}
        </div>
        {#each hashRows as r (r.name)}
          <div class="out-row {rowState(r)}">
            <div class="head">
              <h3>
                {r.name}
                {#if rowState(r) === 'match'}<em class="ok">일치</em>{:else if rowState(r) === 'differ'}<em class="bad">다름</em>{/if}
              </h3>
              <button class="btn sm" disabled={!r.digest} aria-label="{r.name} 복사" onclick={() => copy(show(r.digest), `${r.name} 값을`)}>복사</button>
            </div>
            <code class="val" aria-label={r.name}>
              {#if r.digest}{show(r.digest)}{:else if shaSkipped && r.name !== 'MD5' && r.name !== 'CRC32'}파일이 {formatBytes(SHA_MAX)} 보다 커서 건너뛰었습니다{:else}…{/if}
            </code>
          </div>
        {/each}
        <p class="hint">MD5 와 SHA-1 은 파일이 온전한지 확인하는 데는 쓸 수 있지만, 보안 용도(서명 · 비밀번호)로는 쓰면 안 됩니다.</p>
      </section>
    </div>
  {:else}
    <div class="page">
      <section class="pane" aria-label="만들 것">
        <div class="kinds" role="group" aria-label="만들 것">
          {#each GEN as [k, name] (k)}
            <button aria-pressed={genKind === k} onclick={() => (genKind = k)}>{name}</button>
          {/each}
        </div>
        <p class="hint">{GEN.find(([k]) => k === genKind)![2]}</p>

        <div class="opts">
          {#if genKind === 'token'}
            <label class="f inline">
              <span>길이 (글자)</span>
              <input class="field num" type="number" min="4" max="512" bind:value={tokenLen} aria-label="토큰 길이" />
            </label>
            <div class="f">
              <span>글자</span>
              <div class="seg" role="group" aria-label="토큰 글자">
                <button aria-pressed={tokenKind === 'hex'} onclick={() => (tokenKind = 'hex')}>16진수</button>
                <button aria-pressed={tokenKind === 'base64url'} onclick={() => (tokenKind = 'base64url')}>Base64URL</button>
                <button aria-pressed={tokenKind === 'alnum'} onclick={() => (tokenKind = 'alnum')}>영문 · 숫자</button>
              </div>
            </div>
          {:else if genKind === 'password'}
            <label class="f inline">
              <span>길이 (글자)</span>
              <input class="field num" type="number" min="4" max="128" bind:value={pw.length} aria-label="비밀번호 길이" />
            </label>
            <div class="checks" role="group" aria-label="넣을 글자">
              <label class="check"><input type="checkbox" bind:checked={pw.lower} /> 소문자 a–z</label>
              <label class="check"><input type="checkbox" bind:checked={pw.upper} /> 대문자 A–Z</label>
              <label class="check"><input type="checkbox" bind:checked={pw.digits} /> 숫자 0–9</label>
              <label class="check"><input type="checkbox" bind:checked={pw.symbols} /> 기호 !@#$…</label>
              <label class="check wide"><input type="checkbox" bind:checked={pw.noAmbiguous} /> 헷갈리는 글자 빼기 <code>0 O 1 l I</code></label>
            </div>
          {/if}
          {#if genKind === 'token' || genKind === 'password'}
            {#if noSets}
              <p class="verdict bad" role="status">글자 종류를 하나 이상 고르세요.</p>
            {:else}
              <div class="strength s{strength.level}" role="status" aria-label="세기">
                <div class="meter"><i style:width="{Math.min(100, (bits / 128) * 100)}%"></i></div>
                <p><b>{strength.label}</b> · 엔트로피 {Math.round(bits)}비트</p>
                <p class="hint">{strength.note}</p>
              </div>
            {/if}
          {/if}
          <label class="f inline">
            <span>개수 <small>(1–1000)</small></span>
            <input class="field num" type="number" min="1" max="1000" bind:value={count} aria-label="개수" />
          </label>
          <p class="hint">모든 값은 브라우저의 암호학적 난수(crypto.getRandomValues)로 만들고, 나머지 연산의 치우침 없이 고릅니다. 만든 값은 저장하지 않습니다.</p>
        </div>

        <div class="now" aria-label="지금 시각">
          <h3>지금 시각</h3>
          {#each nowRows as [label, value] (label)}
            <button onclick={() => copy(value, `${label} 을`)} title="눌러서 복사" aria-label="{label} 복사">
              <span>{label}</span><code>{value}</code>
            </button>
          {/each}
        </div>
      </section>

      <section class="results" aria-label="만든 값">
        <div class="bar">
          <button class="btn sm primary" onclick={() => round++}>다시 만들기</button>
          <button class="btn sm" disabled={!made.length} onclick={() => copy(made.join('\n'), `${n(made.length)}개를`)}>모두 복사</button>
          <span class="hint">{n(made.length)}개 · 눌러서 하나만 복사</span>
        </div>
        <ol class="made" aria-label="만든 값 목록">
          {#each made.slice(0, LIST_MAX) as v, i (i)}
            <li><button onclick={() => copy(v, '값을')} title="눌러서 복사"><span class="no">{i + 1}</span><code>{v}</code></button></li>
          {/each}
        </ol>
        {#if made.length > LIST_MAX}<p class="hint">목록에는 처음 {LIST_MAX}개만 보입니다. "모두 복사" 에는 {n(made.length)}개가 다 들어갑니다.</p>{/if}
      </section>
    </div>
  {/if}
  {#if toast}<p class="toast" role="status">{toast}</p>{/if}
</ToolShell>

<style>
  .page {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    gap: 12px;
    padding: 14px;
    max-width: 1400px;
    width: 100%;
    margin: 0 auto;
  }
  .pane {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
    border-radius: 14px;
  }
  .pane.over {
    outline: 2px dashed var(--app);
    outline-offset: 3px;
  }
  .text {
    flex: 1;
    min-height: 160px;
    padding: 14px 16px;
    border-radius: 14px;
    border-color: var(--border);
    resize: none;
    font-family: var(--mono);
    font-size: 13.5px;
    line-height: 1.7;
    word-break: break-all;
  }
  .text:focus-visible {
    outline: none;
    border-color: var(--app);
  }
  .foot,
  .row,
  .bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .count {
    flex: 1;
    min-width: 100px;
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .hint {
    font-size: 12px;
    color: var(--faint);
    line-height: 1.65;
  }
  code {
    font-family: var(--mono);
    font-size: 0.95em;
  }
  .trail {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    padding: 6px 10px;
    border-radius: 10px;
    background: var(--app-soft);
    font-size: 12.5px;
    color: var(--muted);
  }
  .trail button {
    padding: 1px 6px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .trail button:hover {
    background: var(--surface);
    color: var(--text);
  }
  .trail b {
    padding: 1px 6px;
    color: var(--text);
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
  }
  .empty {
    display: grid;
    gap: 10px;
    padding: 18px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
  }
  .empty h2 {
    font-size: 16px;
    letter-spacing: -0.01em;
  }
  .empty p {
    font-size: 13.5px;
    color: var(--muted);
    line-height: 1.65;
  }
  .examples {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 6px;
  }
  .examples button {
    display: grid;
    gap: 1px;
    width: 100%;
    height: 100%;
    padding: 8px 11px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    text-align: left;
    font-size: 13px;
  }
  .examples button:hover {
    border-color: var(--app-line);
    background: var(--app-soft);
  }
  .examples span {
    font-size: 12px;
    color: var(--muted);
  }
  .plainmsg {
    padding: 2px 4px;
    font-size: 13px;
    color: var(--muted);
  }
  .mini {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin: 0;
  }
  .mini div {
    padding: 7px 10px;
    border-radius: 9px;
    background: var(--surface-2);
  }
  .mini dt {
    font-size: 11.5px;
    color: var(--muted);
  }
  .mini dd {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  /* 만들기 · 해시: 한 줄에 하나씩 */
  .out-row {
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    min-width: 0;
  }
  .out-row.match {
    border-color: var(--ok);
    background: color-mix(in srgb, var(--ok) 8%, var(--surface));
  }
  .out-row.differ {
    border-color: var(--bad);
    background: color-mix(in srgb, var(--bad) 7%, var(--surface));
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .head h3 {
    flex: 1;
    min-width: 0;
    font-size: 13px;
  }
  .head small {
    margin-left: 4px;
    font-size: 12px;
    font-weight: 400;
    color: var(--faint);
  }
  .head em {
    margin-left: 6px;
    padding: 1px 8px;
    border-radius: 99px;
    font-style: normal;
    font-size: 11.5px;
    color: #fff;
  }
  em.ok {
    background: var(--ok);
  }
  em.bad {
    background: var(--bad);
  }
  :global([data-theme='dark']) .head em {
    color: #111;
  }
  .val {
    display: block;
    max-height: 132px;
    overflow: auto;
    padding: 7px 10px;
    border-radius: 8px;
    background: var(--surface-2);
    font-size: 12.5px;
    line-height: 1.6;
    word-break: break-all;
    white-space: pre-wrap;
  }

  .filebox {
    flex: 1;
    min-height: 160px;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 6px;
    padding: 18px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    text-align: center;
    font-size: 13px;
    color: var(--muted);
  }
  .filebox b {
    font-size: 15px;
    color: var(--text);
    word-break: break-all;
  }
  .filebox progress {
    width: 200px;
    accent-color: var(--app);
  }
  .bad {
    color: var(--bad);
  }
  .opts {
    display: grid;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
  }
  .f {
    display: grid;
    gap: 5px;
    font-size: 12.5px;
    font-weight: 650;
    color: var(--muted);
  }
  .f small {
    font-weight: 400;
    color: var(--faint);
  }
  .f .field {
    width: 100%;
    font-weight: 400;
    color: var(--text);
  }
  .f.inline {
    grid-template-columns: 1fr auto;
    align-items: center;
  }
  .f .num {
    width: 88px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .with {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px;
  }
  .with select {
    width: auto;
  }
  .mono {
    font-family: var(--mono);
  }
  .verdict {
    padding: 7px 10px;
    border-radius: 9px;
    font-size: 13px;
    font-weight: 650;
  }
  .verdict.ok {
    background: color-mix(in srgb, var(--ok) 13%, var(--surface));
    color: var(--ok);
  }
  .verdict.bad {
    background: color-mix(in srgb, var(--bad) 11%, var(--surface));
    color: var(--bad);
  }
  .verdict.wait {
    background: var(--surface-2);
    color: var(--muted);
    font-weight: 400;
  }

  /* 생성 */
  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .kinds button {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--border-strong);
    border-radius: 99px;
    background: var(--surface);
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }
  .kinds button[aria-pressed='true'] {
    border-color: var(--app);
    background: var(--app-soft);
    color: var(--text);
  }
  .checks {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 10px;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .check.wide {
    grid-column: 1 / -1;
  }
  .check code {
    color: var(--muted);
  }
  .strength {
    display: grid;
    gap: 4px;
    font-size: 13px;
  }
  .meter {
    height: 6px;
    border-radius: 99px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .meter i {
    display: block;
    height: 100%;
    border-radius: 99px;
    background: var(--bad);
    transition: width 0.15s;
  }
  .s1 .meter i {
    background: #f59f00;
  }
  .s2 .meter i,
  .s3 .meter i {
    background: var(--ok);
  }
  .now {
    display: grid;
    gap: 2px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
  }
  .now h3 {
    margin-bottom: 4px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .now button {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 2px 10px;
    padding: 4px 8px;
    margin: 0 -8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    text-align: left;
    font-size: 12.5px;
  }
  .now button:hover,
  .made button:hover {
    background: var(--app-soft);
  }
  .now span {
    color: var(--muted);
  }
  .now code {
    font-variant-numeric: tabular-nums;
  }
  .made {
    list-style: none;
    margin: 0;
    padding: 6px;
    display: grid;
    gap: 1px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
  }
  .made button {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    text-align: left;
    font-size: 13.5px;
  }
  .made code {
    word-break: break-all;
  }
  .no {
    color: var(--faint);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    text-align: right;
    padding-top: 2px;
  }

  .toast {
    position: fixed;
    left: 50%;
    bottom: 22px;
    transform: translateX(-50%);
    padding: 7px 14px;
    border-radius: 99px;
    background: var(--text);
    color: var(--bg);
    font-size: 12.5px;
    font-weight: 600;
    white-space: nowrap;
    z-index: 5;
  }

  @media (max-width: 820px) {
    .page {
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 10px;
      gap: 10px;
    }
    .pane,
    .results {
      flex: none;
      overflow: visible;
    }
    .text {
      flex: none;
      height: 170px;
    }
    .filebox {
      flex: none;
    }
  }
</style>
