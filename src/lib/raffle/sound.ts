// 효과음. 파일 없이 WebAudio 로 직접 합성한다.
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function tone(freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** 사용자 동작 직후 한 번 불러 오디오를 깨운다 */
export function unlock() {
  audio();
}

export function tick() {
  tone(880, 0, 0.035, 0.05, 'square');
}

export function stop() {
  tone(660, 0, 0.12, 0.12, 'triangle');
  tone(990, 0.02, 0.16, 0.08, 'sine');
}

export function fanfare() {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => {
    tone(f, i * 0.09, 0.28, 0.14, 'triangle');
    tone(f * 2, i * 0.09, 0.2, 0.04, 'sine');
  });
  for (const f of [523.25, 659.25, 783.99, 1046.5]) tone(f, 0.4, 0.9, 0.09, 'triangle');
}
