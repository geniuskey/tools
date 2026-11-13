// 한 도구의 결과를 다른 도구로 넘긴다. 받는 도구를 새 탭으로 열어서, 하던 작업(녹화 · 편집)은 그대로 남는다.
// 내용은 같은 브라우저 안의 탭끼리만 오간다 (BroadcastChannel). 주소나 저장소에는 번호표만 남는다.
import { replaceState } from '$app/navigation';

export type Payload = { kind: 'image'; blob: Blob; name: string } | { kind: 'diff'; a: string; b: string; json: boolean };

const CHANNEL = 'tools:handoff';

/**
 * 새 탭으로 도구를 열고, 그 탭이 준비되면 내용을 건넨다.
 * 팝업으로 막히지 않게 누른 그 자리에서 불러야 한다 — 만드는 데 시간이 걸리는 내용은 Promise 로 넘긴다.
 * 탭을 열지 못하면 false.
 */
export function sendTo(href: string, payload: Payload | Promise<Payload>): boolean {
  const id = crypto.randomUUID();
  const ch = new BroadcastChannel(CHANNEL);
  const timer = setTimeout(() => ch.close(), 60_000);
  ch.onmessage = async (e) => {
    if (e.data?.type !== 'want' || e.data.id !== id) return;
    clearTimeout(timer);
    try {
      ch.postMessage({ type: 'give', id, payload: await payload });
    } catch {
      ch.postMessage({ type: 'fail', id });
    }
    ch.close();
  };
  if (window.open(`${href}#from=${id}`, '_blank')) return true;
  clearTimeout(timer);
  ch.close();
  return false;
}

/** 받는 쪽: 주소에 번호표(#from=…)가 있으면 넘어온 내용을 기다린다. 없거나 받지 못하면 null */
export function receive(): Promise<Payload | null> {
  const id = /^#from=([\w-]+)$/.exec(location.hash)?.[1];
  if (!id || typeof BroadcastChannel === 'undefined') return Promise.resolve(null);
  // 새로 고쳤을 때 다시 기다리지 않게 번호표를 지운다
  setTimeout(() => {
    try {
      replaceState(location.pathname + location.search, {});
    } catch {}
  }, 300);
  return new Promise((resolve) => {
    const ch = new BroadcastChannel(CHANNEL);
    const done = (p: Payload | null) => {
      clearTimeout(timer);
      ch.close();
      resolve(p);
    };
    const timer = setTimeout(() => done(null), 8000);
    ch.onmessage = (e) => {
      if (e.data?.id !== id) return;
      if (e.data.type === 'give') done(e.data.payload as Payload);
      else if (e.data.type === 'fail') done(null);
    };
    ch.postMessage({ type: 'want', id });
  });
}
