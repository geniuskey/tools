import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExifSegment, insertSegment, crc32, downscaleSteps, exifSummary, fitSize, fitToBytes, formatBytes, outputNames, readExif, savedPercent, sniff, zipStore } from '../src/lib/convert/core';

const bytes = (...parts: (string | number[])[]) => Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

test('형식 알아내기: 확장자가 아니라 내용으로', () => {
  assert.equal(sniff(bytes([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.equal(sniff(bytes([0x89], 'PNG\r\n')), 'png');
  assert.equal(sniff(bytes('GIF89a')), 'gif');
  assert.equal(sniff(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ')), 'webp');
  assert.equal(sniff(bytes([0, 0, 0, 24], 'ftypheic')), 'heic');
  assert.equal(sniff(bytes([0, 0, 0, 24], 'ftypmif1')), 'heic');
  assert.equal(sniff(bytes([0, 0, 0, 24], 'ftypavif')), 'avif');
  assert.equal(sniff(bytes('  <svg xmlns="http://www.w3.org/2000/svg">')), 'svg');
  assert.equal(sniff(bytes('<?xml version="1.0"?>\n<svg>')), 'svg');
  assert.equal(sniff(bytes('hello world')), '');
});

test('크기: 비율을 지키고, 키우지 않는다', () => {
  const src = { w: 4000, h: 3000 };
  assert.deepEqual(fitSize(src, { mode: 'none' }), src);
  assert.deepEqual(fitSize(src, { mode: 'long', px: 1600 }), { w: 1600, h: 1200 });
  assert.deepEqual(fitSize({ w: 3000, h: 4000 }, { mode: 'long', px: 1600 }), { w: 1200, h: 1600 });
  assert.deepEqual(fitSize(src, { mode: 'long', px: 8000 }), src);
  assert.deepEqual(fitSize(src, { mode: 'fit', w: 1000, h: 1000 }), { w: 1000, h: 750 });
  assert.deepEqual(fitSize(src, { mode: 'fit', w: 0, h: 600 }), { w: 800, h: 600 });
  assert.deepEqual(fitSize(src, { mode: 'percent', percent: 50 }), { w: 2000, h: 1500 });
  assert.deepEqual(fitSize(src, { mode: 'percent', percent: 200 }), src);
  assert.deepEqual(fitSize({ w: 5000, h: 3 }, { mode: 'long', px: 100 }), { w: 100, h: 1 });
  // 절반씩 줄여 가다 마지막에 목표 크기
  assert.deepEqual(downscaleSteps({ w: 4000, h: 3000 }, { w: 400, h: 300 }), [{ w: 2000, h: 1500 }, { w: 1000, h: 750 }, { w: 500, h: 375 }, { w: 400, h: 300 }]);
  assert.deepEqual(downscaleSteps({ w: 1000, h: 800 }, { w: 600, h: 480 }), [{ w: 600, h: 480 }]);
});

test('목표 용량: 넘지 않는 가장 좋은 품질', async () => {
  // 용량이 품질과 픽셀 수에 따라 늘어나는 가짜 인코더
  let calls = 0;
  const encode = async (q: number, s: number) => {
    calls++;
    const size = Math.round(2_000_000 * s * s * (0.1 + q * q));
    return { blob: `${q}@${s}`, size };
  };
  const r = await fitToBytes(encode, 500_000);
  assert.ok(r.met && r.size <= 500_000, JSON.stringify(r));
  assert.equal(r.scale, 1);
  // 한 단계만 더 높여도 넘친다
  assert.ok((await encode(r.quality + 0.02, 1)).size > 500_000, `품질 ${r.quality}`);
  assert.ok(calls <= 10, `인코딩 ${calls}번`);
  // 넉넉하면 가장 좋은 품질 그대로, 한 번만 인코딩
  calls = 0;
  const easy = await fitToBytes(encode, 10_000_000);
  assert.deepEqual([easy.quality, easy.scale, calls], [0.95, 1, 1]);
  // 가장 낮은 품질로도 안 되면 크기를 줄인다
  const tiny = await fitToBytes(encode, 60_000);
  assert.ok(tiny.met && tiny.size <= 60_000 && tiny.scale < 1, JSON.stringify(tiny));
  // 무손실은 크기만 줄인다
  const png = await fitToBytes(async (_q, s) => ({ blob: s, size: Math.round(3_000_000 * s * s) }), 1_000_000, { adjustable: false });
  assert.ok(png.met && png.size <= 1_000_000 && png.scale < 0.6 && png.quality === 1, JSON.stringify(png));
  // 도저히 안 되면 가장 작은 것을 돌려주고 못 맞췄다고 알린다
  const never = await fitToBytes(async () => ({ blob: 0, size: 5000 }), 100);
  assert.equal(never.met, false);
});

test('용량 표시와 파일 이름', () => {
  assert.deepEqual([0, 999, 1024, 1536, 150_000, 1_048_576, 5_400_000].map(formatBytes), ['0B', '999B', '1KB', '1.5KB', '146KB', '1MB', '5.15MB']);
  assert.deepEqual([savedPercent(1000, 280), savedPercent(1000, 1300), savedPercent(1000, 1000)], ['−72%', '+30%', '±0%']);
  const plain = { prefix: '', suffix: '', numbered: false };
  assert.deepEqual(outputNames(['IMG_1.HEIC', 'img_1.png', '사진 1.jpeg', 'a/b:c.jpg', '.jpg'], 'jpg', plain), ['IMG_1.jpg', 'img_1-2.jpg', '사진 1.jpg', 'b_c.jpg', 'image.jpg']);
  assert.deepEqual(outputNames(['a.png', 'b.png'], 'webp', { prefix: '행사-', suffix: '-small', numbered: false }), ['행사-a-small.webp', '행사-b-small.webp']);
  assert.deepEqual(outputNames(['x.png', 'y.png'], 'jpg', { prefix: '사진', suffix: '', numbered: true }), ['사진001.jpg', '사진002.jpg']);
});

/** 테스트용 EXIF 가 든 JPEG 앞부분을 만든다 */
function jpegWithExif(le: boolean): Uint8Array {
  const tiff = new Uint8Array(400);
  const v = new DataView(tiff.buffer);
  const put = (at: number, s: string) => [...s].forEach((c, i) => (tiff[at + i] = c.charCodeAt(0)));
  put(0, le ? 'II' : 'MM');
  v.setUint16(2, 42, le);
  v.setUint32(4, 8, le);
  let e = 10;
  const entry = (tag: number, type: number, count: number, value: number, short = false) => {
    v.setUint16(e, tag, le);
    v.setUint16(e + 2, type, le);
    v.setUint32(e + 4, count, le);
    if (short) v.setUint16(e + 8, value, le);
    else v.setUint32(e + 8, value, le);
    e += 12;
  };
  // IFD0: 방향 6, 제조사, 모델, Exif IFD, GPS IFD
  v.setUint16(8, 5, le);
  entry(0x0112, 3, 1, 6, true);
  entry(0x010f, 2, 6, 100);
  put(100, 'Apple\0');
  entry(0x0110, 2, 10, 110);
  put(110, 'iPhone 15\0');
  entry(0x8769, 4, 1, 150);
  entry(0x8825, 4, 1, 200);
  // Exif IFD: 찍은 시각
  v.setUint16(150, 1, le);
  e = 152;
  entry(0x9003, 2, 20, 170);
  put(170, '2026:05:17 14:03:22\0');
  // GPS IFD: 북위 37°33'59.4", 동경 126°58'40.8"
  v.setUint16(200, 4, le);
  e = 202;
  entry(1, 2, 2, 0);
  put(e - 4, 'N\0');
  entry(2, 5, 3, 260);
  entry(3, 2, 2, 0);
  put(e - 4, 'E\0');
  entry(4, 5, 3, 300);
  const rat = (at: number, vals: [number, number][]) => vals.forEach(([n, d], i) => (v.setUint32(at + i * 8, n, le), v.setUint32(at + i * 8 + 4, d, le)));
  rat(260, [[37, 1], [33, 1], [594, 10]]);
  rat(300, [[126, 1], [58, 1], [408, 10]]);
  const app0 = [0xff, 0xe0, 0, 4, 1, 2];
  const len = tiff.length + 8;
  return Uint8Array.from([0xff, 0xd8, ...app0, 0xff, 0xe1, len >> 8, len & 255, ...bytes('Exif\0\0'), ...tiff, 0xff, 0xda, 0, 2]);
}

test('EXIF: 방향 · 기기 · 찍은 시각 · 위치', () => {
  for (const le of [true, false]) {
    const e = readExif(jpegWithExif(le))!;
    assert.equal(e.orientation, 6);
    assert.deepEqual([e.make, e.model, e.taken], ['Apple', 'iPhone 15', '2026:05:17 14:03:22']);
    assert.ok(e.hasGps && e.gps);
    assert.ok(Math.abs(e.gps.lat - 37.5665) < 1e-4 && Math.abs(e.gps.lon - 126.978) < 1e-4, JSON.stringify(e.gps));
    assert.deepEqual(exifSummary(e), ['위치', '기기', '찍은 시각']);
  }
  assert.equal(readExif(bytes([0xff, 0xd8, 0xff, 0xda, 0, 2])), null);
  assert.equal(readExif(bytes([0x89], 'PNG')), null);
  // 깨진 데이터에도 죽지 않는다
  const broken = jpegWithExif(true);
  for (let i = 20; i < 120; i++) broken[i] = 0xff;
  assert.doesNotThrow(() => readExif(broken));
  assert.doesNotThrow(() => readExif(jpegWithExif(true).subarray(0, 60)));
  assert.deepEqual(exifSummary(null), []);
  // 예시 사진에 넣는 조각도 같은 판독기로 읽힌다
  const made = readExif(insertSegment(bytes([0xff, 0xd8, 0xff, 0xda, 0, 2]), buildExifSegment({ make: 'tools', model: 'Sample Camera', taken: '2026:11:13 10:00:00', lat: 37.5665, lon: -126.978, orientation: 3 })))!;
  assert.deepEqual([made.make, made.model, made.taken, made.orientation], ['tools', 'Sample Camera', '2026:11:13 10:00:00', 3]);
  assert.ok(Math.abs(made.gps!.lat - 37.5665) < 1e-4 && Math.abs(made.gps!.lon + 126.978) < 1e-4, JSON.stringify(made.gps));
});

test('ZIP: 다른 프로그램이 그대로 푼다', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const big = new Uint8Array(70_000).map((_, i) => (i * 31) & 255);
  const zip = zipStore(
    [
      { name: '사진 1.jpg', data: new TextEncoder().encode('hello') },
      { name: 'b.bin', data: big },
      { name: 'empty.txt', data: new Uint8Array(0) },
    ],
    new Date(2026, 10, 13, 9, 30, 40),
  );
  assert.equal(new DataView(zip.buffer).getUint32(0, true), 0x04034b50);
  assert.equal(new DataView(zip.buffer).getUint16(zip.length - 12, true), 3);
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const path = join(dir, 't.zip');
  writeFileSync(path, zip);
  let unzip = true;
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
  } catch {
    unzip = false;
  }
  if (!unzip) return;
  execFileSync('unzip', ['-tq', path]);
  assert.equal(execFileSync('unzip', ['-p', path, 'b.bin']).length, 70_000);
  assert.ok(execFileSync('unzip', ['-p', path, 'b.bin']).equals(Buffer.from(big)));
  // 한글 이름은 다른 구현(파이썬)으로 확인한다
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
  } catch {
    return;
  }
  const names = execFileSync('python3', ['-c', 'import sys,zipfile,json; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', path]).toString();
  assert.deepEqual(JSON.parse(names), ['사진 1.jpg', 'b.bin', 'empty.txt']);
});
