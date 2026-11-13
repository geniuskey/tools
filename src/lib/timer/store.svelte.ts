// 타이머 상태. 같은 브라우저의 다른 창(발표자 화면)과 BroadcastChannel 로 맞춘다. 서버는 거치지 않는다.
import { load, save } from '$lib/storage';
import { initial, isShared, type Shared } from './core';

const KEY = 'tools:timer:v1';

export class TimerStore {
  s = $state.raw<Shared>(initial());
  private channel: BroadcastChannel | null = null;

  /** 저장된 상태를 불러오고 다른 창의 변경을 듣는다. 정리 함수를 돌려준다. */
  init(): () => void {
    const saved = load<unknown>(KEY, null);
    if (isShared(saved)) this.s = { ...initial(), anchor: 0, span: 0, ...saved };
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('tools:timer');
      this.channel.onmessage = (e) => {
        if (isShared(e.data)) this.s = e.data;
      };
    }
    // BroadcastChannel 이 없는 브라우저에서는 저장소 변경으로 대신 듣는다
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY || this.channel) return;
      const v = load<unknown>(KEY, null);
      if (isShared(v)) this.s = v;
    };
    addEventListener('storage', onStorage);
    return () => {
      this.channel?.close();
      this.channel = null;
      removeEventListener('storage', onStorage);
    };
  }

  set(next: Shared) {
    if (next === this.s) return;
    this.s = next;
    save(KEY, next);
    this.channel?.postMessage(next);
  }
}
