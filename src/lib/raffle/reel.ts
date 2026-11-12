// 릴(이름이 돌아가는 통)의 움직임 계산. 화면과 무관한 순수 함수만 둔다.

const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * 시간(0~1) → 이동 비율(0~1) 곡선.
 * 잠깐 가속한 뒤 길게 줄어들지만 끝에서도 완전히 서지 않고 "딸깍" 하고 멈춘다.
 * 미끄러지듯 서면 어디서 설지 미리 보여서 마지막 긴장이 사라진다.
 *
 * @param tail 가장 빠를 때 대비 끝 속도
 * @param accel 가속에 쓰는 시간 비율
 * @param power 클수록 일찍 느려진다
 */
export function reelCurve(tail = 0.09, accel = 0.08, power = 2.2): (u: number) => number {
  const N = 256;
  const speed = (u: number) => (u >= accel ? 1 : smooth(u / accel)) * ((1 - u) ** power + tail);
  // 속도를 적분해 거리 표를 만들어 둔다
  const sum = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) sum[i] = sum[i - 1] + (speed((i - 1) / N) + speed(i / N)) / 2;
  const total = sum[N];
  return (u) => {
    if (!(u > 0)) return 0;
    if (u >= 1) return 1;
    const x = u * N;
    const i = Math.floor(x);
    return (sum[i] + (sum[i + 1] - sum[i]) * (x - i)) / total;
  };
}

/** 주어진 시간 동안 지나갈 이름 수. 평균 초당 10개쯤이면 처음엔 흐릿하게, 끝에는 읽을 수 있게 지나간다. */
export function reelSteps(ms: number): number {
  return Math.max(8, Math.round((ms / 1000) * 10.5));
}

/**
 * 릴에 차례로 지나갈 이름들. [steps] 자리가 당첨자이고, 그 뒤 둘은 멈췄을 때 위로 살짝 보이는 이름이다.
 * 같은 이름이 연달아 나오지 않게 하고, 끝 무렵에는 당첨자 이름이 미리 지나가지 않게 한다.
 *
 * @param first 첫 자리에 둘 이름 (방금까지 화면에 있던 이름에서 이어 돌릴 때)
 */
export function reelNames(steps: number, winner: string, sample: () => string, first?: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < steps + 3; i++) {
    if (i === steps) out.push(winner);
    else if (i === 0 && first !== undefined) out.push(first);
    else {
      let name = sample();
      for (let tries = 0; tries < 8 && (name === out[i - 1] || (i > steps - 6 && name === winner)); tries++) name = sample();
      out.push(name);
    }
  }
  return out;
}

export interface Pose {
  /** 세로 위치 (em). 위가 음수 */
  y: number;
  sx: number;
  sy: number;
  alpha: number;
}

/**
 * 원통에 붙은 글자가 가운데에서 o 칸 떨어져 있을 때 정면에서 보이는 모습.
 * o 가 양수면 아직 오지 않은 이름으로, 위쪽에서 내려온다.
 *
 * @param radius 원통 반지름 (em)
 * @param step 한 칸의 각도 (rad)
 * @param depth 눈과의 거리 (em). 작을수록 뒤로 넘어가는 글자가 더 작아진다
 */
export function drumPose(o: number, radius: number, step: number, depth = 6): Pose {
  const a = o * step;
  if (Math.abs(a) >= Math.PI / 2) return { y: 0, sx: 1, sy: 0, alpha: 0 };
  const c = Math.cos(a);
  const near = depth / (depth + radius * (1 - c));
  return {
    y: -radius * Math.sin(a) * near,
    sx: near,
    sy: c * near,
    // 가운데를 벗어나면 빠르게 어두워진다
    alpha: c ** 1.2 * (1 - 0.5 * Math.min(1, Math.abs(o))),
  };
}
