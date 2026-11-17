<script lang="ts">
  import { contract, english, englishCheque, formal, grouped, hanja, korean, mixed, parseMoney, rough, vatFromSupply, vatFromTotal } from './money';
  import { st } from './state.svelte';
  import { grossFor, withhold } from './withhold';

  const read = $derived(parseMoney(st.words));
  const v = $derived(read?.value ?? null);
  const LIMIT = 10n ** 20n;
  const big = $derived(v !== null && v >= LIMIT);

  const rows = $derived(
    v === null || big
      ? []
      : [
          { id: 'contract', name: '계약서 · 영수증', value: contract(v, st.one), hint: '고쳐 쓰지 못하게 "일금 … 원정"' },
          { id: 'korean', name: '한글', value: `${korean(v, { one: st.one })}원`, hint: '' },
          { id: 'spaced', name: '한글 (띄어 쓰기)', value: `${korean(v, { one: st.one, spaced: true })} 원`, hint: '만 단위로 띄어 씁니다 (한글 맞춤법 제44항)' },
          { id: 'mixed', name: '숫자 + 단위', value: `${mixed(v)}원`, hint: '' },
          { id: 'grouped', name: '숫자', value: `${grouped(v)}원`, hint: '' },
          { id: 'receipt', name: '금액 칸', value: `${contract(v, st.one)} (₩${grouped(v)})`, hint: '견적서 · 차용증 · 세금계산서' },
          { id: 'formal', name: '갖은자', value: `金 ${formal(v)} 圓整`, hint: '수표 · 어음처럼 숫자를 고치지 못하게 쓰는 한자' },
          { id: 'hanja', name: '한자', value: `${hanja(v)}원`, hint: '' },
          { id: 'english', name: '영어', value: `${english(v)} won`, hint: '' },
          { id: 'cheque', name: '영문 인보이스', value: englishCheque(v), hint: '' },
        ],
  );
  const vat = $derived(v === null || big ? null : st.vatFrom === 'supply' ? vatFromSupply(v) : vatFromTotal(v));
  const small = $derived(v !== null && !big && v < 10n ** 15n ? Number(v) : null);
  const wh = $derived(small === null ? null : withhold(st.wFrom === 'gross' ? small : grossFor(small, st.wKind), st.wKind));
  const EXAMPLES = ['1,000,000', '35,000', '1억 2,345만', '4.5천만', '일금 일백만원정', '壹萬圓'];
</script>

<div class="page two">
  <section class="col" aria-label="금액 입력">
    <div class="card ask">
      <label class="lab" for="pay-words">금액</label>
      <input id="pay-words" class="field big" bind:value={st.words} inputmode="text" autocomplete="off" spellcheck="false" placeholder="1234567 · 1억 2천만 · 일금 일백만원정" />
      <p class="read" class:bad={st.words.trim() !== '' && (v === null || big)}>
        {#if big}
          너무 큰 금액입니다 (1해 미만까지)
        {:else if v !== null}
          <b>{grouped(v)}원</b> · {rough(v)}{#if read?.truncated} · 원 아래는 버렸습니다{/if}
        {:else if st.words.trim()}
          금액으로 읽지 못했습니다
        {:else}
          숫자 · 한글 · 한자로 적은 금액을 모두 읽습니다
        {/if}
      </p>
      <div class="chips" role="group" aria-label="예시">
        {#each EXAMPLES as ex (ex)}<button onclick={() => (st.words = ex)}>{ex}</button>{/each}
      </div>
      <label class="check"><input type="checkbox" bind:checked={st.one} /> 일백 · 일천 · 일만처럼 '일' 을 붙이기 <small>(계약서 관행)</small></label>
    </div>

    <div class="card">
      <h2>부가세 10%</h2>
      <div class="seg" role="group" aria-label="적은 금액이">
        <button aria-pressed={st.vatFrom === 'supply'} onclick={() => (st.vatFrom = 'supply')}>공급가액이다</button>
        <button aria-pressed={st.vatFrom === 'total'} onclick={() => (st.vatFrom = 'total')}>부가세 포함 합계다</button>
      </div>
      {#if vat}
        <ul class="rows">
          {#each [['공급가액', vat.supply], ['부가세', vat.vat], ['합계', vat.total]] as const as [name, x] (name)}
            <li>
              <span class="u"><b>{name}</b><small>{korean(x, { one: st.one })}원</small></span>
              <button class="v" onclick={() => st.copy(String(x), `${name} ${grouped(x)}원을`)}>{grouped(x)}</button>
            </li>
          {/each}
        </ul>
        <p class="hint">{st.vatFrom === 'supply' ? '부가세는 원 아래를 버립니다.' : '공급가액은 합계 ÷ 1.1 을 반올림하고, 부가세는 합계에서 뺀 나머지라 합계가 꼭 맞습니다.'}</p>
      {/if}
    </div>

    <div class="card">
      <h2>원천징수 <small>프리랜서 · 강사료 · 원고료</small></h2>
      <div class="seg" role="group" aria-label="소득 종류">
        <button aria-pressed={st.wKind === 'business'} onclick={() => (st.wKind = 'business')}>사업소득 3.3%</button>
        <button aria-pressed={st.wKind === 'other'} onclick={() => (st.wKind = 'other')}>기타소득 8.8%</button>
      </div>
      <div class="seg" role="group" aria-label="적은 금액이">
        <button aria-pressed={st.wFrom === 'gross'} onclick={() => (st.wFrom = 'gross')}>주는 돈이다 (세전)</button>
        <button aria-pressed={st.wFrom === 'net'} onclick={() => (st.wFrom = 'net')}>받을 돈이다 (세후)</button>
      </div>
      {#if wh}
        <ul class="rows">
          {#each [['지급액', wh.gross], ['소득세', wh.incomeTax], ['지방소득세', wh.localTax], ['실수령액', wh.net]] as const as [name, x] (name)}
            <li>
              <span class="u"><b>{name}</b><small>{korean(BigInt(x), { one: st.one })}원</small></span>
              <button class="v" onclick={() => st.copy(String(x), `${name} ${grouped(BigInt(x))}원을`)}>{grouped(BigInt(x))}</button>
            </li>
          {/each}
        </ul>
        <p class="hint">
          {st.wKind === 'business'
            ? '계속 · 반복해서 하는 일의 대가(프리랜서 · 강사)는 사업소득으로 3% + 지방 0.3%를 뗍니다.'
            : '어쩌다 한 번 받는 강연료 · 원고료 · 심사료는 기타소득으로, 60%를 필요경비로 빼고 20% + 지방 2%를 뗍니다. 한 번에 125,000원 이하면 떼지 않습니다.'}
          세금은 10원 미만을 버립니다.
        </p>
      {/if}
    </div>
  </section>

  <section class="col" aria-label="표기">
    <div class="card">
      <h2>이렇게 씁니다 <small>누르면 복사</small></h2>
      {#if rows.length}
        <ul class="list">
          {#each rows as r (r.id)}
            <li>
              <span class="name">{r.name}{#if r.hint}<small>{r.hint}</small>{/if}</span>
              <button class="val" class:mono={r.id === 'grouped'} onclick={() => st.copy(r.value, `${r.name} 표기를`)}>{r.value}</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="hint">왼쪽에 금액을 적으세요.</p>
      {/if}
    </div>
  </section>
</div>

<style>
  .lab {
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
  }
  .list {
    list-style: none;
    margin: 0 -8px;
    padding: 0;
    display: grid;
  }
  .list li {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    gap: 10px;
    align-items: start;
    padding: 4px 0;
  }
  .list li + li {
    border-top: 1px solid var(--border);
  }
  .name {
    padding: 8px;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--muted);
  }
  .name small {
    display: block;
    margin-top: 2px;
    font-size: 11.5px;
    font-weight: 400;
    color: var(--faint);
  }
  .val {
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: none;
    text-align: left;
    font-size: 15px;
    font-weight: 650;
    line-height: 1.5;
    overflow-wrap: anywhere;
    word-break: keep-all;
  }
  .val:hover {
    background: var(--app-soft);
  }
  .val.mono {
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 520px) {
    .list li {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
    .name {
      padding-bottom: 0;
    }
  }
</style>
