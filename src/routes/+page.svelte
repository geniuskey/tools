<script lang="ts">
  import { groupedTools } from '$lib/tools';
  import { encodeQr } from '$lib/qr/core';
  import { renderSvg, defaultStyle } from '$lib/qr/render';

  const qrPreview = renderSvg(encodeQr('https://tools.euiyun.com/qr', { ecl: 'M' }), { ...defaultStyle, dots: 'rounded', eyes: 'rounded', transparent: true, margin: 0, fg: '#3b5bdb' });
  import Logo from '$lib/ui/Logo.svelte';
  import ThemeToggle from '$lib/ui/ThemeToggle.svelte';
  import ToolDrawer from '$lib/ui/ToolDrawer.svelte';
</script>

<svelte:head>
  <title>tools.euiyun.com — 제대로 만든 웹 도구</title>
  <meta name="description" content="데이터 뷰어, 비교, 텍스트(정규식 · 글자 수), 계산기, 단위 변환, 날짜 계산기(근무일 · 공휴일), cron 풀이, 인코딩 · 해시, 이미지 편집기, 이미지 일괄 변환, 화면 녹화, 색상 · 대비, QR 코드, 행사 타이머, 조 편성 · 사다리, 이름표 · 좌석표, 추첨기. 단순해 보이지만 끝까지 만든 웹 도구 모음. 설치와 가입 없이 브라우저 안에서만 동작합니다." />
</svelte:head>

<div class="wrap">
  <header>
    <span class="menu"><ToolDrawer /></span>
    <a class="brand" href="/" aria-label="tools.euiyun.com">
      <Logo size={24} />
      <span>tools<span class="dim">.euiyun.com</span></span>
    </a>
    <nav>
      <a href="https://office.euiyun.com" rel="noopener">office ↗</a>
      <ThemeToggle />
    </nav>
  </header>

  <section class="hero">
    <h1>단순한 도구를,<br /><em>끝까지</em> 만들었습니다.</h1>
    <p>
      자주 쓰는 도구일수록 대충 만든 것이 많습니다. 여기 있는 도구는 하나하나 실제 업무와 행사에서 쓸 수 있는 수준으로 다듬었습니다.
      설치도 가입도 없고, 파일과 명단은 브라우저 밖으로 나가지 않습니다.
    </p>
  </section>

  {#each groupedTools as g (g.id)}
  <section class="group" aria-labelledby="group-{g.id}">
    <h2 class="group-title" id="group-{g.id}">{g.name}</h2>
    <div class="grid">
    {#each g.tools as t (t.id)}
      <a class="card app-scope" href={t.href} style:--app={t.color}>
        <div class="preview" aria-hidden="true">
          {#if t.id === 'calculator'}
            <div class="pv-calc">
              <div class="pv-display">
                <span class="pv-expr">0.1 + 0.2</span>
                <span class="pv-res">= 0.3</span>
              </div>
              <div class="pv-keys">
                {#each ['sin', '7', '8', '9', '÷', 'ln', '4', '5', '6', '×', '√', '1', '2', '3', '='] as k, i (i)}
                  <span class:op={'÷×'.includes(k)} class:eq={k === '='} class:fn={k.length > 1 || k === '√'}>{k}</span>
                {/each}
              </div>
            </div>
          {:else if t.id === 'image'}
            <svg class="pv-image" viewBox="0 0 280 150" preserveAspectRatio="xMidYMid slice">
              <rect width="280" height="150" fill="var(--app-soft)" />
              <rect x="34" y="20" width="212" height="140" rx="8" fill="var(--surface)" stroke="var(--border-strong)" />
              <circle cx="46" cy="32" r="3" fill="var(--border-strong)" />
              <circle cx="56" cy="32" r="3" fill="var(--border-strong)" />
              <circle cx="66" cy="32" r="3" fill="var(--border-strong)" />
              <rect x="48" y="50" width="90" height="8" rx="4" fill="var(--surface-3)" />
              <rect x="48" y="66" width="130" height="8" rx="4" fill="var(--surface-3)" />
              <g>
                {#each Array(24) as _, i (i)}
                  <rect x={48 + (i % 8) * 9} y={84 + Math.floor(i / 8) * 9} width="9" height="9" fill="var(--text)" opacity={0.12 + ((i * 7) % 5) * 0.07} />
                {/each}
              </g>
              <rect x="148" y="88" width="84" height="42" rx="5" fill="none" stroke="#e03131" stroke-width="3" />
              <path d="M112 44 L150 80" stroke="#e03131" stroke-width="4" stroke-linecap="round" />
              <path d="M152 82 l-13 -3.5 l9.5 -9.5 z" fill="#e03131" />
              <circle cx="104" cy="38" r="11" fill="#e03131" />
              <text x="104" y="42.5" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">1</text>
            </svg>
          {:else if t.id === 'diff'}
            <div class="pv-diff">
              <div><span>12</span><code>일시: 3월 <del>14</del>일 오후 2시</code><code class="add">일시: 3월 <ins>21</ins>일 오후 2시</code></div>
              <div><span>13</span><code>장소: 본사 <del>3층</del></code><code class="add">장소: 본사 <ins>5층</ins></code></div>
              <div class="same"><span>14</span><code>대상: 개발팀</code><code>대상: 개발팀</code></div>
              <div><span>15</span><code class="void"></code><code class="add"><ins>문의: 운영팀</ins></code></div>
            </div>
          {:else if t.id === 'recorder'}
            <div class="pv-rec">
              <div class="pv-screen">
                <i class="pv-crop"></i>
                <span class="pv-live"><b></b>0:12</span>
              </div>
              <div class="pv-track"><i></i><b></b></div>
            </div>
          {:else if t.id === 'data'}
            <div class="pv-data">
              <div><i class="open"></i><b>orders</b> <u>[240]</u></div>
              <div class="d1"><i class="open"></i><u>0</u> <u>{'{'}6{'}'}</u></div>
              <div class="d2"><i></i><b>id</b>: <em class="n">1001</em></div>
              <div class="d2 on"><i></i><b>city</b>: <em>"서울"</em></div>
              <div class="d2"><i></i><b>paid</b>: <em class="b">true</em></div>
              <div class="d1"><i class="shut"></i><u>1</u> <u>{'{'}6{'}'}</u></div>
            </div>
          {:else if t.id === 'qr'}
            <div class="pv-qr">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html qrPreview}
            </div>
          {:else if t.id === 'timer'}
            <div class="pv-timer">
              <span class="pv-seg">발표 · 2 / 4</span>
              <span class="pv-time">4:59</span>
              <span class="pv-bar"><i></i></span>
            </div>
          {:else if t.id === 'convert'}
            <div class="pv-conv">
              {#each [['IMG_2041.HEIC', '4.8MB', '412KB', 9], ['제주 02.jpg', '6.1MB', '498KB', 8], ['단체사진.png', '11MB', '487KB', 5]] as [name, from, to, pct], i (i)}
                <div>
                  <i style:background="hsl({200 + i * 70} 60% 62%)"></i>
                  <span>{name}</span>
                  <del>{from}</del>
                  <b>{to}</b>
                  <u><s style:width="{pct}%"></s></u>
                </div>
              {/each}
            </div>
          {:else if t.id === 'team'}
            <div class="pv-team">
              <svg viewBox="0 0 120 120" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <g stroke="var(--border-strong)" stroke-width="2.5">
                  <path d="M20 8v104M60 8v104M100 8v104M20 30h40M60 52h40M20 74h40M60 94h40" />
                </g>
                <path d="M20 8v22h40v22h40v42h-40v18" stroke="var(--app)" stroke-width="4.5" />
              </svg>
              <div>
                {#each [['1조', ['김하늘', '박민준', '이서연']], ['2조', ['최지우', '정도윤', '한수아']]] as [name, members] (name)}
                  <section><b>{name}</b>{#each members as m (m)}<span>{m}</span>{/each}</section>
                {/each}
              </div>
            </div>
          {:else if t.id === 'text'}
            <div class="pv-text">
              <code class="pv-re"><i>/</i>01\d-<b>(\d{'{'}4{'}'})</b>-\d{'{'}4{'}'}<i>/g</i></code>
              <p>김하늘 <mark>010-1234-5678</mark><br />이서연 <mark>011-9876-5432</mark><br />박민준 02-123-4567</p>
              <span><b>\d{'{'}4{'}'}</b> 숫자 하나 — 정확히 4번</span>
            </div>
          {:else if t.id === 'date'}
            <div class="pv-date">
              <span class="pv-q">11월 13일에서 근무일 <b>10일</b> 뒤</span>
              <strong>11월 27일 <small>(금)</small></strong>
              <div class="pv-days">
                {#each Array(15) as _, i (i)}
                  <i class:off={[1, 2, 8, 9].includes(i)} class:from={i === 0} class:hit={i === 14}>{13 + i}</i>
                {/each}
              </div>
              <span class="pv-skip">주말 4일을 건너뛰었습니다</span>
            </div>
          {:else if t.id === 'encode'}
            <div class="pv-encode">
              <code class="pv-in">eyJhbGciOiJIUzI1NiJ9<i>.</i>eyJzdWIiOiLtmY0<i>.</i>SflKxw…</code>
              <div class="pv-card">
                <p><b>JWT</b><em>거의 확실</em></p>
                <dl>
                  <div><dt>만료 exp</dt><dd>11-13 20:45 KST <span>3시간 12분 뒤</span></dd></div>
                  <div><dt>sub</dt><dd>홍길동</dd></div>
                </dl>
              </div>
            </div>
          {:else if t.id === 'badge'}
            <div class="pv-badge">
              <div class="pv-tag">
                <b>2026 환영회</b>
                <strong>김 솔</strong>
                <span>개발팀</span>
              </div>
              <div class="pv-tag">
                <b>2026 환영회</b>
                <strong class="long">제갈공명선생님</strong>
                <span>디자인팀 · 팀장</span>
              </div>
              <div class="pv-seats">
                <i></i>
                {#each ['하늘', '서연', '민준', '지우', '도윤', '수아'] as n, k (n)}
                  <em style:--a="{k * 60 - 90}deg">{n}</em>
                {/each}
              </div>
            </div>
          {:else if t.id === 'color'}
            <div class="pv-color">
              <div class="pv-pair">
                <span class="pv-aa">Aa</span>
                <div>
                  <strong>5.25<small> : 1</small></strong>
                  <span><b>✓</b> AA 본문 <b class="no">✕</b> AAA</span>
                </div>
              </div>
              <div class="pv-scale">
                {#each ['#fef2f4', '#fce2e6', '#f8cbd3', '#f1a8b6', '#e97591', '#de4372', '#c2255c', '#a71e4e', '#881c40', '#6f2138', '#481423'] as c (c)}<i style:background={c}></i>{/each}
              </div>
            </div>
          {:else if t.id === 'unit'}
            <div class="pv-unit">
              <span class="pv-ask">32평<i></i></span>
              <strong>105.785 <small>m²</small></strong>
              <ul>
                {#each [['ft²', '1,138.66'], ['에이커', '0.0261'], ['단보', '0.1067']] as [u, v] (u)}<li><span>{u}</span><b>{v}</b></li>{/each}
              </ul>
            </div>
          {:else if t.id === 'cron'}
            <div class="pv-cron">
              <div class="pv-toks">
                {#each [['0', '분'], ['9', '시'], ['*', '일'], ['*', '월'], ['1-5', '요일']] as [v, k], i (i)}
                  <span class:on={i === 4}><b>{v}</b><i>{k}</i></span>
                {/each}
              </div>
              <strong>평일 오전 9시</strong>
              <ol>
                <li><span>11월 16일 (월) 9:00</span><em>2일 뒤</em></li>
                <li><span>11월 17일 (화) 9:00</span><em>3일 뒤</em></li>
              </ol>
            </div>
          {:else if t.id === 'raffle'}
            <div class="pv-raffle">
              {#each Array(14) as _, i (i)}
                <i style:left="{(i * 37 + 11) % 100}%" style:top="{(i * 53 + 7) % 90}%" style:background={['#ffd43b', '#ff6b6b', '#63e6be', '#74c0fc', '#f783ac'][i % 5]} style:transform="rotate({i * 40}deg)"></i>
              {/each}
              <span class="pv-prize">1등 · 3명</span>
              <span class="pv-name">김하늘</span>
              <span class="pv-count">참가자 428명</span>
            </div>
          {/if}
        </div>
        <div class="body">
          <h3>{t.name}<span class="go" aria-hidden="true">→</span></h3>
          <p>{t.tagline}</p>
          <ul>
            {#each t.features as f (f)}<li>{f}</li>{/each}
          </ul>
        </div>
      </a>
    {/each}
    </div>
  </section>
  {/each}

  <section class="principles" aria-label="원칙">
    <div>
      <h3>브라우저 안에서만</h3>
      <p>이미지도, 참가자 명단도 서버로 보내지 않습니다. 서버로 보내는 코드 자체가 없고, 보안 정책(CSP)으로도 막아 두었습니다.</p>
    </div>
    <div>
      <h3>한 번 열면 오프라인에서도</h3>
      <p>행사장 와이파이가 끊겨도 추첨은 계속됩니다. 처음 열 때 필요한 것을 모두 내려받아 둡니다.</p>
    </div>
    <div>
      <h3>키보드 먼저</h3>
      <p>모든 도구는 마우스 없이도 빠르게 쓸 수 있도록 단축키를 갖추고 있습니다.</p>
    </div>
  </section>

  <footer>
    <span>문서 작업은 <a href="https://office.euiyun.com" rel="noopener">office.euiyun.com</a></span>
    <span>© euiyun.com</span>
  </footer>
</div>

<style>
  .wrap {
    max-width: 1280px;
    margin: 0 auto;
    padding: 0 20px 40px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 60px;
  }
  .menu {
    display: contents;
  }
  header nav {
    margin-left: auto;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
    font-weight: 750;
    font-size: 16px;
    letter-spacing: -0.02em;
    text-decoration: none;
  }
  .dim {
    color: var(--faint);
    font-weight: 550;
  }
  nav {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  nav a {
    font-size: 13.5px;
    color: var(--muted);
    text-decoration: none;
    padding: 6px 10px;
    border-radius: 8px;
  }
  nav a:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .hero {
    padding: 56px 0 44px;
    max-width: 640px;
  }
  .hero h1 {
    font-size: clamp(34px, 6vw, 54px);
    line-height: 1.14;
    letter-spacing: -0.045em;
    font-weight: 800;
  }
  .hero em {
    font-style: normal;
    background: linear-gradient(100deg, var(--c-calc), var(--c-raffle) 55%, var(--c-image));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .hero p {
    margin-top: 18px;
    font-size: 16.5px;
    line-height: 1.7;
    color: var(--muted);
  }

  .group + .group {
    margin-top: 40px;
  }
  .group-title {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
    font-size: 13px;
    font-weight: 650;
    letter-spacing: 0.02em;
    color: var(--muted);
  }
  .group-title::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .grid {
    display: grid;
    /* 열 수를 고정: 한 장뿐인 분류도 카드 폭을 그대로 지킨다 */
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 18px;
  }
  .card {
    display: flex;
    flex-direction: column;
    text-decoration: none;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 18px;
    overflow: hidden;
    transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
  }
  .card:hover {
    transform: translateY(-3px);
    box-shadow: var(--shadow-lg);
    border-color: var(--app-line);
  }
  .preview {
    height: 170px;
    background: var(--app-soft);
    border-bottom: 1px solid var(--border);
    position: relative;
    overflow: hidden;
  }
  .body {
    padding: 18px 20px 20px;
  }
  .body h3 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 19px;
    letter-spacing: -0.02em;
  }
  .go {
    color: var(--app);
    transition: transform 0.16s ease;
  }
  .card:hover .go {
    transform: translateX(4px);
  }
  .body p {
    margin-top: 6px;
    color: var(--muted);
    font-size: 14px;
  }
  .body ul {
    list-style: none;
    margin: 14px 0 0;
    padding: 0;
    display: grid;
    gap: 5px;
    font-size: 13px;
  }
  .body li {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .body li::before {
    content: '';
    flex: none;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--app);
    transform: translateY(-2px);
  }

  /* 미리보기: 계산기 */
  .pv-calc {
    position: absolute;
    left: 50%;
    top: 18px;
    width: 210px;
    transform: translateX(-50%);
    padding: 10px;
    border-radius: 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-md);
  }
  .pv-display {
    display: grid;
    text-align: right;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--surface-2);
    font-variant-numeric: tabular-nums;
  }
  .pv-expr {
    font-size: 19px;
    font-weight: 550;
  }
  .pv-res {
    font-size: 12.5px;
    color: var(--muted);
  }
  .pv-keys {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
    margin-top: 8px;
  }
  .pv-keys span {
    display: grid;
    place-items: center;
    height: 26px;
    border-radius: 6px;
    background: var(--surface-2);
    font-size: 12px;
  }
  .pv-keys .fn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
    font-size: 10.5px;
  }
  .pv-keys .op {
    background: var(--app-soft);
    color: var(--app);
  }
  .pv-keys .eq {
    background: var(--app);
    color: var(--on-app);
  }

  .pv-image {
    width: 100%;
    height: 100%;
    display: block;
  }

  /* 미리보기: 비교 */
  .pv-diff {
    position: absolute;
    inset: 22px 18px auto;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-md);
    overflow: hidden;
    font-family: var(--mono);
    font-size: 10.5px;
    line-height: 2.5;
  }
  .pv-diff div {
    display: grid;
    grid-template-columns: 24px 1fr 1fr;
  }
  .pv-diff span {
    text-align: right;
    padding-right: 6px;
    color: var(--faint);
  }
  .pv-diff code {
    font: inherit;
    padding: 0 6px;
    white-space: nowrap;
    overflow: hidden;
    background: color-mix(in srgb, var(--bad) 10%, var(--surface));
  }
  .pv-diff code.add {
    background: color-mix(in srgb, var(--ok) 12%, var(--surface));
  }
  .pv-diff .same code {
    background: none;
  }
  .pv-diff code.void {
    background: repeating-linear-gradient(-45deg, transparent 0 4px, var(--surface-2) 4px 5.5px);
  }
  .pv-diff del,
  .pv-diff ins {
    text-decoration: none;
    border-radius: 3px;
    padding: 1px 0;
    background: color-mix(in srgb, var(--bad) 30%, var(--surface));
  }
  .pv-diff ins {
    background: color-mix(in srgb, var(--ok) 34%, var(--surface));
  }

  /* 미리보기: 화면 녹화 */
  .pv-rec {
    position: absolute;
    inset: 18px 28px;
    display: grid;
    grid-template-rows: 1fr 14px;
    gap: 10px;
  }
  .pv-screen {
    position: relative;
    border-radius: 8px;
    background: linear-gradient(135deg, #2b2d33, #17181c);
    box-shadow: var(--shadow-md);
    overflow: hidden;
  }
  .pv-crop {
    position: absolute;
    inset: 22% 14% 18% 30%;
    border: 1.5px solid #fff;
    border-radius: 2px;
    background: color-mix(in srgb, var(--app) 30%, #2b2d33);
    box-shadow: 0 0 0 999px rgb(0 0 0 / 0.35);
  }
  .pv-live {
    position: absolute;
    left: 8px;
    top: 8px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 1px 8px;
    border-radius: 99px;
    background: rgb(0 0 0 / 0.6);
    color: #fff;
    font: 600 10.5px/1.7 var(--mono);
  }
  .pv-live b {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #ff6b6b;
  }
  .pv-track {
    position: relative;
    border-radius: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .pv-track i {
    position: absolute;
    inset: -1px 24% -1px 18%;
    border-radius: 4px;
    border: 2px solid var(--app);
    background: var(--app-soft);
  }
  .pv-track b {
    position: absolute;
    left: 46%;
    top: -3px;
    bottom: -3px;
    width: 2px;
    background: var(--text);
  }

  /* 미리보기: 일괄 변환 */
  .pv-conv {
    position: absolute;
    inset: 22px 26px auto;
    display: grid;
    gap: 7px;
  }
  .pv-conv div {
    display: grid;
    grid-template-columns: 26px 1fr auto auto;
    align-items: center;
    column-gap: 8px;
    padding: 6px 10px 6px 6px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }
  .pv-conv i {
    grid-row: span 2;
    width: 26px;
    height: 26px;
    border-radius: 6px;
  }
  .pv-conv span {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pv-conv del {
    color: var(--faint);
    font-size: 10.5px;
  }
  .pv-conv b {
    color: var(--app);
  }
  .pv-conv u {
    grid-column: 2 / -1;
    height: 3px;
    border-radius: 99px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .pv-conv s {
    display: block;
    height: 100%;
    background: var(--app);
  }

  /* 미리보기: 조 편성 · 사다리 */
  .pv-team {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: 96px auto;
    justify-content: center;
    align-items: center;
    gap: 18px;
  }
  .pv-team svg {
    width: 96px;
    height: 124px;
  }
  .pv-team div {
    display: flex;
    gap: 8px;
  }
  .pv-team section {
    display: grid;
    gap: 3px;
    width: 66px;
    padding-bottom: 6px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    overflow: hidden;
    font-size: 11.5px;
    text-align: center;
  }
  .pv-team b {
    padding: 3px 0;
    background: var(--app);
    color: var(--on-app);
  }

  /* 미리보기: 날짜 계산기 */
  .pv-date {
    position: absolute;
    inset: 18px 24px auto;
    display: grid;
    justify-items: start;
    gap: 5px;
  }
  .pv-q {
    font-size: 12px;
    color: var(--muted);
  }
  .pv-q b {
    color: var(--text);
  }
  .pv-date strong {
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -0.035em;
    line-height: 1.1;
    color: var(--app);
  }
  .pv-date small {
    font-size: 17px;
  }
  .pv-days {
    display: grid;
    grid-template-columns: repeat(15, minmax(0, 1fr));
    gap: 2px;
    width: 100%;
    margin-top: 4px;
  }
  .pv-days i {
    padding: 4px 0;
    border-radius: 5px;
    background: var(--surface);
    font-style: normal;
    font-size: 9.5px;
    font-weight: 600;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .pv-days .off {
    background: transparent;
    color: var(--bad);
    opacity: 0.7;
  }
  .pv-days .from {
    box-shadow: inset 0 0 0 1.5px var(--app);
  }
  .pv-days .hit {
    background: var(--app);
    color: var(--on-app);
  }
  .pv-skip {
    font-size: 11px;
    color: var(--muted);
  }

  /* 미리보기: 인코딩 · 해시 */
  .pv-encode {
    position: absolute;
    inset: 16px 26px auto;
    display: grid;
    gap: 7px;
    font-size: 12px;
  }
  .pv-in {
    padding: 6px 10px;
    border-radius: 9px;
    background: var(--surface);
    border: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pv-in i {
    font-style: normal;
    font-weight: 700;
    color: var(--app);
  }
  .pv-card {
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--app-line);
    box-shadow: inset 3px 0 0 var(--app), var(--shadow);
  }
  .pv-card p {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
  }
  .pv-card em {
    padding: 0 7px;
    border-radius: 99px;
    background: var(--app-soft);
    font-style: normal;
    font-size: 10.5px;
    font-weight: 650;
  }
  .pv-card dl {
    display: grid;
    gap: 2px;
    margin: 5px 0 0;
    font-size: 11px;
  }
  .pv-card dl div {
    display: grid;
    grid-template-columns: 58px 1fr;
    gap: 6px;
  }
  .pv-card dt {
    color: var(--muted);
  }
  .pv-card dd {
    margin: 0;
    font-family: var(--mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pv-card dd span {
    font-family: var(--font);
    font-weight: 650;
    color: var(--ok);
  }

  /* 미리보기: 이름표 · 좌석표 */
  .pv-badge {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: 84px 84px 100px;
    justify-content: center;
    align-items: center;
    gap: 8px;
  }
  .pv-tag {
    display: grid;
    justify-items: center;
    align-content: start;
    height: 66px;
    border-radius: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    overflow: hidden;
    white-space: nowrap;
  }
  .pv-tag b {
    width: 100%;
    padding: 2px 0;
    background: var(--app);
    color: var(--on-app);
    font-size: 9px;
    text-align: center;
  }
  .pv-tag strong {
    margin-top: 3px;
    font-size: 22px;
    font-weight: 800;
    line-height: 1.25;
  }
  .pv-tag strong.long {
    font-size: 11px;
    line-height: 2.5;
  }
  .pv-tag span {
    font-size: 9.5px;
    color: var(--muted);
  }
  .pv-seats {
    position: relative;
    width: 100px;
    height: 108px;
  }
  .pv-seats i {
    position: absolute;
    inset: 32px 28px;
    border-radius: 50%;
    background: var(--surface);
    border: 1.5px solid var(--app);
  }
  .pv-seats em {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 30px;
    margin: -8px 0 0 -15px;
    border-radius: 5px;
    background: var(--surface);
    border: 1px solid var(--border);
    font-style: normal;
    font-size: 9.5px;
    line-height: 15px;
    text-align: center;
    transform: rotate(var(--a)) translate(38px) rotate(calc(-1 * var(--a)));
  }

  /* 미리보기: 텍스트 */
  .pv-text {
    position: absolute;
    inset: 16px 26px auto;
    display: grid;
    gap: 7px;
    font-size: 12px;
  }
  .pv-re {
    padding: 6px 10px;
    border-radius: 9px;
    background: var(--surface);
    border: 1.5px solid var(--app);
    font-family: var(--mono);
    font-size: 12.5px;
    box-shadow: var(--shadow);
  }
  .pv-re i {
    font-style: normal;
    color: var(--faint);
  }
  .pv-re b {
    color: var(--app);
  }
  .pv-text p {
    padding: 6px 10px;
    border-radius: 9px;
    background: var(--surface);
    border: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 11.5px;
    line-height: 1.7;
  }
  .pv-text mark {
    border-radius: 3px;
    background: color-mix(in srgb, var(--app) 26%, transparent);
    color: inherit;
  }
  .pv-text span {
    justify-self: start;
    padding: 2px 9px;
    border-radius: 99px;
    background: var(--surface);
    border: 1px solid var(--border);
    font-size: 11px;
    color: var(--muted);
  }
  .pv-text span b {
    font-family: var(--mono);
    color: var(--text);
  }

  /* 미리보기: 데이터 */
  .pv-data {
    position: absolute;
    inset: 20px 30px auto;
    padding: 8px 0;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-md);
    font-family: var(--mono);
    font-size: 11px;
    line-height: 2;
  }
  .pv-data div {
    display: flex;
    align-items: center;
    gap: 5px;
    padding-left: 12px;
  }
  .pv-data .d1 {
    padding-left: 28px;
  }
  .pv-data .d2 {
    padding-left: 44px;
  }
  .pv-data .on {
    background: var(--app-soft);
    box-shadow: inset 2px 0 0 var(--app);
  }
  .pv-data i {
    width: 8px;
    height: 8px;
  }
  .pv-data i.open,
  .pv-data i.shut {
    border: 4px solid transparent;
    border-left-color: var(--faint);
    border-right: 0;
  }
  .pv-data i.open {
    transform: rotate(90deg);
  }
  .pv-data b {
    color: var(--app);
  }
  .pv-data u {
    text-decoration: none;
    color: var(--faint);
  }
  .pv-data em {
    font-style: normal;
    color: var(--ok);
  }
  .pv-data em.n {
    color: var(--accent);
  }
  .pv-data em.b {
    color: var(--c-image);
  }

  /* 미리보기: QR */
  .pv-qr {
    position: absolute;
    left: 50%;
    top: 16px;
    width: 138px;
    height: 138px;
    padding: 12px;
    transform: translateX(-50%);
    border-radius: 14px;
    background: #fff;
    box-shadow: var(--shadow-md);
  }
  .pv-qr :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* 미리보기: 타이머 */
  .pv-timer {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    background: radial-gradient(120% 90% at 50% 0%, #4a3a08, #14110a 72%);
    color: #fff;
    font-variant-numeric: tabular-nums;
  }
  .pv-seg {
    font-size: 12px;
    font-weight: 650;
    opacity: 0.75;
  }
  .pv-time {
    font-size: 62px;
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1.15;
    color: #ffd43b;
    text-shadow: 0 0 22px rgb(255 212 59 / 0.35);
  }
  .pv-bar {
    width: 190px;
    height: 5px;
    margin-top: 6px;
    border-radius: 99px;
    background: rgb(255 255 255 / 0.15);
    overflow: hidden;
  }
  .pv-bar i {
    display: block;
    width: 68%;
    height: 100%;
    background: #ffd43b;
  }

  /* 미리보기: 추첨 */
  .pv-raffle {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 2px;
    background: radial-gradient(120% 90% at 50% 0%, #3b1d4f, #15121f 70%);
    color: #fff;
  }
  .pv-raffle i {
    position: absolute;
    width: 7px;
    height: 11px;
    border-radius: 1.5px;
    opacity: 0.85;
  }
  .pv-prize {
    font-size: 11.5px;
    font-weight: 650;
    padding: 2px 10px;
    border-radius: 99px;
    background: rgb(255 255 255 / 0.14);
    position: relative;
  }
  .pv-name {
    font-size: 46px;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.2;
    position: relative;
    text-shadow: 0 4px 24px rgb(240 101 149 / 0.6);
  }
  .pv-count {
    font-size: 11px;
    opacity: 0.6;
    position: relative;
  }

  /* 미리보기: 색상 · 대비 */
  .pv-color {
    position: absolute;
    inset: 20px 24px auto;
    display: grid;
    gap: 12px;
  }
  .pv-pair {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-md);
  }
  .pv-aa {
    display: grid;
    place-items: center;
    width: 62px;
    height: 62px;
    border-radius: 10px;
    background: #fff4f6;
    color: #c2255c;
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  .pv-pair div {
    display: grid;
  }
  .pv-pair strong {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
  }
  .pv-pair small {
    font-size: 15px;
    color: var(--muted);
  }
  .pv-pair div span {
    font-size: 11.5px;
    color: var(--muted);
  }
  .pv-pair b {
    color: var(--ok);
  }
  .pv-pair b.no {
    margin-left: 4px;
    color: var(--bad);
  }
  .pv-scale {
    display: grid;
    grid-template-columns: repeat(11, 1fr);
    height: 30px;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: var(--shadow);
  }
  .pv-scale i:nth-child(7) {
    box-shadow: inset 0 0 0 2px #fff;
  }

  /* 미리보기: 단위 변환 */
  .pv-unit {
    position: absolute;
    inset: 16px 26px auto;
    display: grid;
    justify-items: start;
    gap: 4px;
    font-variant-numeric: tabular-nums;
  }
  .pv-ask {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 5px 10px;
    border-radius: 9px;
    background: var(--surface);
    border: 1.5px solid var(--app);
    font-size: 14px;
    font-weight: 650;
    box-shadow: var(--shadow);
  }
  .pv-ask i {
    width: 1.5px;
    height: 15px;
    margin-left: 2px;
    background: var(--app);
  }
  .pv-unit strong {
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.2;
  }
  .pv-unit strong small {
    font-size: 16px;
    color: var(--app);
  }
  .pv-unit ul {
    list-style: none;
    margin: 0;
    padding: 0;
    width: 100%;
    display: grid;
    gap: 2px;
  }
  .pv-unit li {
    display: flex;
    justify-content: space-between;
    padding: 2px 8px;
    border-radius: 6px;
    background: var(--surface);
    font-size: 11.5px;
  }
  .pv-unit li span {
    color: var(--muted);
  }

  /* 미리보기: cron 풀이 */
  .pv-cron {
    position: absolute;
    inset: 16px 26px auto;
    display: grid;
    gap: 7px;
  }
  .pv-toks {
    display: flex;
    gap: 4px;
  }
  .pv-toks span {
    display: grid;
    justify-items: center;
    min-width: 34px;
    padding: 2px 7px 1px;
    border-radius: 7px;
    background: var(--surface);
    border: 1px solid var(--border);
    font-family: var(--mono);
  }
  .pv-toks span.on {
    border-color: var(--app);
    box-shadow: inset 0 0 0 1px var(--app);
  }
  .pv-toks b {
    font-size: 13px;
  }
  .pv-toks i {
    font-family: var(--font);
    font-style: normal;
    font-size: 9.5px;
    color: var(--muted);
  }
  .pv-cron strong {
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.03em;
    color: var(--app);
  }
  .pv-cron ol {
    list-style: none;
    margin: 0;
    padding: 4px 10px;
    border-radius: 9px;
    background: var(--surface);
    border: 1px solid var(--border);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }
  .pv-cron li {
    display: flex;
    justify-content: space-between;
    line-height: 1.9;
  }
  .pv-cron li + li {
    border-top: 1px solid var(--border);
  }
  .pv-cron em {
    font-style: normal;
    color: var(--muted);
  }

  .principles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 28px;
    margin-top: 56px;
    padding-top: 32px;
    border-top: 1px solid var(--border);
  }
  .principles h3 {
    font-size: 15px;
    letter-spacing: -0.01em;
  }
  .principles p {
    margin-top: 6px;
    font-size: 13.5px;
    color: var(--muted);
    line-height: 1.65;
  }

  footer {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 48px;
    font-size: 12.5px;
    color: var(--faint);
  }
  footer a {
    color: var(--muted);
  }

  @media (max-width: 1200px) {
    .grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (max-width: 920px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 600px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .hero {
      padding: 32px 0 28px;
    }
  }
</style>
