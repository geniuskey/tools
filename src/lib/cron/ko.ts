// 우리말 조사: 앞말에 받침이 있는지 보고 은/는 · 이/가 · 을/를 · 과/와 · 으로/로 를 고른다. 숫자는 읽는 소리로 따진다.

/** 숫자를 읽었을 때 끝소리: 받침이 있는지, 그 받침이 ㄹ 인지 */
function numberEnd(digits: string): { batchim: boolean; rieul: boolean } {
  const s = digits.replace(/^0+(?=\d)/, '');
  const last = s[s.length - 1];
  if (last !== '0' || s === '0') {
    // 영 일 이 삼 사 오 육 칠 팔 구
    const b = [true, true, false, true, false, false, true, true, true, false][+last];
    return { batchim: b, rieul: last === '1' || last === '7' || last === '8' };
  }
  // 십 · 백 · 천 · 만
  const zeros = s.length - s.replace(/0+$/, '').length;
  return { batchim: zeros !== 3, rieul: false };
}

function endOf(word: string): { batchim: boolean; rieul: boolean } {
  const w = word.replace(/[\s)\]'"」』.]+$/, '');
  const digits = /(\d+)$/.exec(w);
  if (digits) return numberEnd(digits[1]);
  const c = w.charCodeAt(w.length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) {
    const jong = (c - 0xac00) % 28;
    return { batchim: jong !== 0, rieul: jong === 8 };
  }
  // 영문 · 기호: 읽는 소리를 알 수 없으니 받침 없는 쪽으로 (L 엘, * 별표 같은 예외는 부르는 쪽에서)
  if (/[LMN]$/i.test(w)) return { batchim: true, rieul: /L$/i.test(w) };
  return { batchim: false, rieul: false };
}

type Pair = '은' | '이' | '을' | '과' | '으로' | '이라서';

/** 앞말에 맞는 조사를 붙인다: j('분', '은') → '분은', j('시', '은') → '시는' */
export function j(word: string, pair: Pair): string {
  const { batchim, rieul } = endOf(word);
  switch (pair) {
    case '은':
      return word + (batchim ? '은' : '는');
    case '이':
      return word + (batchim ? '이' : '가');
    case '을':
      return word + (batchim ? '을' : '를');
    case '과':
      return word + (batchim ? '과' : '와');
    case '으로':
      return word + (batchim && !rieul ? '으로' : '로');
    case '이라서':
      return word + (batchim ? '이라서' : '라서');
  }
}
