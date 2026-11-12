import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addToHistogram, buildPalette, GifEncoder, mapPixels, newHistogram } from '../src/lib/recorder/gif';

/** 인코더와 따로 짠 디코더. 프레임을 차례로 겹쳐 그린 결과(팔레트 번호)와 표시 시간을 돌려준다. */
function decode(gif: Uint8Array) {
  assert.equal(String.fromCharCode(...gif.subarray(0, 6)), 'GIF89a');
  const u16 = (p: number) => gif[p] | (gif[p + 1] << 8);
  const W = u16(6);
  const H = u16(8);
  assert.equal(gif[10], 0xf7);
  const palette = gif.subarray(13, 13 + 768);
  let p = 13 + 768;
  const canvas = new Uint8Array(W * H);
  const frames: { image: Uint8Array; delay: number }[] = [];
  let delay = 0;
  let transparent = -1;
  let loop = -1;
  for (;;) {
    const b = gif[p++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = gif[p++];
      if (label === 0xf9) {
        assert.equal(gif[p], 4);
        transparent = gif[p + 1] & 1 ? gif[p + 4] : -1;
        delay = u16(p + 2);
        p += 6;
      } else {
        if (label === 0xff) loop = u16(p + 14);
        while (gif[p]) p += gif[p] + 1;
        p++;
      }
      continue;
    }
    assert.equal(b, 0x2c);
    const [x, y, w, h] = [u16(p), u16(p + 2), u16(p + 4), u16(p + 6)];
    p += 9;
    const min = gif[p++];
    const data: number[] = [];
    while (gif[p]) {
      for (let i = 0; i < gif[p]; i++) data.push(gif[p + 1 + i]);
      p += gif[p] + 1;
    }
    p++;
    // LZW
    const clear = 1 << min;
    const eoi = clear + 1;
    let size = min + 1;
    let dict: number[][] = [];
    const reset = () => {
      dict = [];
      for (let i = 0; i < clear; i++) dict.push([i]);
      dict.push([], []);
      size = min + 1;
    };
    reset();
    const pix: number[] = [];
    let acc = 0;
    let bits = 0;
    let prev: number[] | null = null;
    let di = 0;
    for (;;) {
      while (bits < size) {
        acc |= data[di++] << bits;
        bits += 8;
      }
      const code = acc & ((1 << size) - 1);
      acc >>>= size;
      bits -= size;
      if (code === clear) {
        reset();
        prev = null;
        continue;
      }
      if (code === eoi) break;
      let entry: number[];
      if (code < dict.length) entry = dict[code];
      else {
        assert.equal(code, dict.length);
        entry = [...prev!, prev![0]];
      }
      for (const v of entry) pix.push(v);
      if (prev && dict.length < 4096) {
        dict.push([...prev, entry[0]]);
        if (dict.length === 1 << size && size < 12) size++;
      }
      prev = entry;
    }
    assert.equal(pix.length, w * h);
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const v = pix[yy * w + xx];
        if (v !== transparent) canvas[(y + yy) * W + x + xx] = v;
      }
    frames.push({ image: canvas.slice(), delay });
  }
  assert.equal(p, gif.length);
  return { W, H, palette, frames, loop };
}

test('팔레트: 색이 적으면 그대로, 많으면 가까운 색으로', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255]);
  const hist = newHistogram();
  addToHistogram(hist, rgba);
  const { palette, count, lut } = buildPalette(hist);
  assert.equal(count, 3);
  const idx = mapPixels(rgba, lut);
  assert.equal(idx[0], idx[3]);
  assert.deepEqual([...palette.subarray(idx[2] * 3, idx[2] * 3 + 3)], [255, 0, 0]);
  assert.deepEqual([...palette.subarray(idx[1] * 3, idx[1] * 3 + 3)], [0, 0, 0]);

  // 색이 아주 많은 경우
  const many = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) many.set([(i * 7) & 255, (i * 13) & 255, (i * 29) & 255, 255], i * 4);
  const h2 = newHistogram();
  addToHistogram(h2, many);
  const p2 = buildPalette(h2);
  assert.equal(p2.count, 255);
  const m = mapPixels(many, p2.lut);
  let err = 0;
  for (let i = 0; i < m.length; i++) for (let k = 0; k < 3; k++) err += Math.abs(many[i * 4 + k] - p2.palette[m[i] * 3 + k]);
  assert.ok(err / (m.length * 3) < 16, `평균 오차 ${err / (m.length * 3)}`);
});

test('인코딩 → 디코딩: 바뀐 부분만 기록해도 원래 화면이 나온다', () => {
  const W = 40;
  const H = 30;
  const palette = new Uint8Array(255 * 3).map((_, i) => (i * 37) & 255);
  const enc = new GifEncoder(W, H, palette);
  const frames: Uint8Array[] = [];
  const f0 = new Uint8Array(W * H).fill(3);
  for (let i = 0; i < 200; i++) f0[i * 5] = i % 250;
  const f1 = f0.slice();
  for (let y = 10; y < 14; y++) for (let x = 20; x < 29; x++) f1[y * W + x] = 77; // 작은 영역만 바뀜
  const f2 = f1.slice(); // 그대로
  const f3 = f1.slice();
  f3[0] = 9;
  f3[W * H - 1] = 9; // 양 끝이 바뀜
  frames.push(f0, f1, f2, f3);
  for (const f of frames) enc.addFrame(f, 10);
  const bytes = enc.finish();
  const out = decode(bytes);
  assert.deepEqual([out.W, out.H, out.loop], [W, H, 0]);
  assert.deepEqual([...out.palette.subarray(0, 765)], [...palette]);
  assert.equal(out.frames.length, 3);
  assert.deepEqual(out.frames.map((f) => f.delay), [10, 20, 10]);
  assert.deepEqual(out.frames[0].image, f0);
  assert.deepEqual(out.frames[1].image, f1);
  assert.deepEqual(out.frames[2].image, f3);
  // 두 번째 프레임은 바뀐 9x4 영역만 담는다
  assert.ok(bytes.length < 13 + 768 + 19 + W * H * 1.5 + 200);
});

test('LZW: 사전이 가득 차도(4096) 올바르다', () => {
  const W = 200;
  const H = 150;
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) >> 12) % 255;
  const noise = new Uint8Array(W * H).map(rnd);
  const flat = new Uint8Array(W * H).fill(200);
  const enc = new GifEncoder(W, H, new Uint8Array(765));
  enc.addFrame(noise, 5);
  enc.addFrame(flat, 5);
  enc.addFrame(noise, 5);
  const out = decode(enc.finish());
  assert.deepEqual(out.frames[0].image, noise);
  assert.deepEqual(out.frames[1].image, flat);
  assert.deepEqual(out.frames[2].image, noise);
  // 1x1
  const one = new GifEncoder(1, 1, new Uint8Array(3));
  one.addFrame(new Uint8Array([0]), 1);
  const o = decode(one.finish());
  assert.equal(o.frames.length, 1);
  assert.equal(o.frames[0].delay, 2); // 너무 짧은 시간은 브라우저가 무시하므로 올린다
});
