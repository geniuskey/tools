/// <reference lib="webworker" />
// 정규식은 따로 떨어진 작업자에서 돌린다. 끝나지 않는 식을 만나도 화면이 멈추지 않고, 밖에서 끊을 수 있다.
import { runRegex } from './regex';

export interface Request {
  id: number;
  pattern: string;
  flags: string;
  text: string;
  replacement: string | null;
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, pattern, flags, text, replacement } = e.data;
  try {
    self.postMessage({ id, result: runRegex(pattern, flags, text, replacement) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
