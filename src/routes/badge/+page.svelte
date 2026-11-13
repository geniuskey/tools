<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import Face from '$lib/badge/Face.svelte';
  import Plan, { type Layout, type OffChange } from '$lib/badge/Plan.svelte';
  import { load, save } from '$lib/storage';
  import { downloadBlob, timestamp } from '$lib/download';
  import { dedupeText, parseParticipants, sampleText } from '$lib/raffle/core';
  import { parseGroups } from '$lib/team/core';
  import { encodeQr } from '$lib/qr/core';
  import { contrast, defaultStyle, renderSvg } from '$lib/qr/render';
  import {
    DEFAULT_CUSTOM, PAPERS, PRESETS, assignSeats, badgeLayout, cellRects, checkGrid, customGrid, fillTemplate, lookup, lookupText, mm, paginate, perPage,
    offKey, openCount, openSlots, presetGrid, presetName, reshape, seatIndex, seated, seatingCsv, seatingText, suggestTables, swapSeats, tableName, tentGrid, toTables,
    type Band, type CustomSheet, type Measure, type Method, type Offs, type PaperId, type SeatRef, type SeatTable, type Shape,
  } from '$lib/badge/core';

  const KEY = 'tools:badge:v1';
  const SWATCHES = ['#9c5a2b', '#1971c2', '#2f9e44', '#d6336c', '#6741d9', '#e8590c', '#343a40'];
  const METHODS: [Method, string][] = [
    ['random', '무작위로'],
    ['mix', '소속을 섞어서'],
    ['group', '같은 소속끼리'],
    ['order', '명단 순서대로'],
  ];
  const CUSTOM_FIELDS: [keyof CustomSheet, string][] = [
    ['cellW', '칸 너비'],
    ['cellH', '칸 높이'],
    ['cols', '가로 칸 수'],
    ['rows', '세로 칸 수'],
    ['left', '왼쪽 여백'],
    ['top', '위 여백'],
    ['gapX', '가로 간격'],
    ['gapY', '세로 간격'],
  ];

  let mode = $state<'badge' | 'seat'>('badge');
  let text = $state('');
  let ready = $state(false);
  let toast = $state('');

  // 이름표
  let paper = $state<PaperId>('A4');
  let layoutId = $state('90x55');
  let custom = $state<CustomSheet>({ ...DEFAULT_CUSTOM });
  let start = $state(1);
  let cut = $state(true);
  let border = $state(false);
  let event = $state('');
  let accent = $state(SWATCHES[0]);
  let band = $state<Band>('top');
  let align = $state<'left' | 'center' | 'right'>('center');
  let logo = $state('');
  let logoAspect = $state(0);
  let showInfo = $state(true);
  let showNo = $state(false);
  let showTable = $state(false);
  let qrOn = $state(false);
  let qrText = $state('{이름} · {소속}');
  /** 사람마다 고친 것 (key → 적을 이름 · 크기) */
  let overrides = $state<Record<string, { text?: string; scale?: number }>>({});
  let editing = $state<number | null>(null);
  let previewW = $state(0);
  let measures = $state.raw<{ name: Measure; info: Measure } | null>(null);
  let logoInput = $state<HTMLInputElement>();

  // 좌석표
  let shape = $state<Shape>('round');
  // 테이블: n 자리 × m 열 × j 행. 줄 맞춤: n 자리 책상 × m 열 × j 행 (책상 사이는 통로)
  let seatsPer = $state(8);
  let tableCols = $state(3);
  let tableRows = $state(1);
  let deskSeats = $state(2);
  let deskCols = $state(3);
  let rowCount = $state(4);
  let method = $state<Method>('random');
  let apartText = $state('');
  let togetherText = $state('');
  let tables = $state<SeatTable[] | null>(null);
  let planShape = $state<Shape>('round');
  // 긴 탁자 방향, 손으로 옮긴 테이블 자리, 소속 색
  let longDir = $state<'h' | 'v'>('h');
  let planDir = $state<'h' | 'v'>('h');
  /** 배치도를 그릴 때의 열 수와 (줄 맞춤) 통로 간격 */
  let planCols = $state(3);
  let planBlock = $state(0);
  let layout = $state<Layout | null>(null);
  let colorBy = $state(false);
  let plan = $state<Plan>();
  let unmet = $state<string[]>([]);
  let picked = $state<SeatRef | null>(null);
  /** 배치도에서 막거나 치운 자리 · 책상 · 테이블 (격자 칸 기준) */
  let offs = $state<Offs>({});

  const parsed = $derived(parseParticipants(text));
  const people = $derived(parsed.list);
  const hasInfo = $derived(people.some((p) => p.info));
  const int = (v: unknown, lo = 1, hi = 999) => Math.max(lo, Math.min(hi, Math.floor(Number(v)) || lo));

  function say(msg: string) {
    toast = msg;
    setTimeout(() => toast === msg && (toast = ''), 2200);
  }
  async function copy(s: string) {
    try {
      await navigator.clipboard.writeText(s);
      say('복사했습니다');
    } catch {
      say('복사하지 못했습니다');
    }
  }

  // ── 이름표 ──
  const preset = $derived(PRESETS.find((p) => p.id === layoutId));
  const grid = $derived(layoutId === 'tent' ? tentGrid(PAPERS[paper]) : preset ? presetGrid(preset, PAPERS[paper]) : customGrid(custom, PAPERS[paper]));
  const gridError = $derived(checkGrid(grid));
  const shrunk = $derived(preset && (grid.cols < preset.cols || grid.rows < preset.rows) ? `${PAPERS[paper].id} 에는 ${grid.cols}×${grid.rows}칸까지 들어갑니다.` : '');
  const cells = $derived(gridError ? [] : cellRects(grid));
  const pages = $derived(gridError ? [] : paginate(people.length, grid, start));
  const seatOf = $derived(tables ? seatIndex(tables) : null);
  const accentOk = $derived(/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : SWATCHES[0]);
  const onAccent = $derived(contrast(accentOk, '#ffffff') >= 2.6 ? '#ffffff' : '#111111');
  const scale = $derived(previewW ? Math.min(1, previewW / ((grid.pageW * 96) / 25.4)) : 0.5);

  const display = (i: number) => overrides[people[i].key]?.text?.trim() || people[i].name;
  const tableText = (i: number) => (showTable ? (seatOf?.get(people[i].key)?.table ?? '') : '');
  const layouts = $derived.by(() => {
    const m = measures;
    if (!m || gridError) return [];
    const foot = showNo || (showTable && !!seatOf);
    return people.map((p, i) =>
      badgeLayout(
        grid.cellW,
        grid.cellH,
        { name: display(i), info: showInfo ? p.info : '', event, band, foot, qr: qrOn && !!qrs[i], logoAspect: logo ? logoAspect : 0, scale: overrides[p.key]?.scale },
        m.info,
        m.name,
      ),
    );
  });

  // QR 은 내용이 같으면 다시 만들지 않는다
  const qrCache = new Map<string, string>();
  const qrs = $derived.by(() => {
    if (!qrOn || !qrText.trim()) return [] as string[];
    let failed = 0;
    const out = people.map((p) => {
      const content = fillTemplate(qrText, p).trim();
      if (!content) return '';
      let svg = qrCache.get(content);
      if (svg == null) {
        try {
          svg = renderSvg(encodeQr(content, { ecl: 'M' }), { ...defaultStyle, margin: 1 });
        } catch {
          svg = '';
        }
        if (qrCache.size > 5000) qrCache.clear();
        qrCache.set(content, svg);
      }
      if (!svg) failed++;
      return svg;
    });
    return Object.assign(out, { failed });
  });
  const qrFailed = $derived((qrs as string[] & { failed?: number }).failed ?? 0);

  /** 재단선: 칸 가장자리를 종이 끝까지 잇는 가는 줄 */
  const cuts = $derived.by(() => {
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (const c of cells) {
      xs.add(c.x).add(Math.round((c.x + c.w) * 100) / 100);
      ys.add(c.y).add(Math.round((c.y + c.h) * 100) / 100);
    }
    const inside = (v: number, max: number) => v > 0.5 && v < max - 0.5;
    return { xs: [...xs].filter((x) => inside(x, grid.pageW)), ys: [...ys].filter((y) => inside(y, grid.pageH)) };
  });

  function makeMeasure(weight: number): Measure {
    const ctx = document.createElement('canvas').getContext('2d');
    const family = getComputedStyle(document.body).fontFamily;
    const cache = new Map<string, number>();
    return (t, size) => {
      let w = cache.get(t);
      if (w == null) {
        if (ctx) {
          ctx.font = `${weight} 100px ${family}`;
          w = ctx.measureText(t).width;
        } else w = [...t].length * 90;
        cache.set(t, w);
      }
      // 화면과 인쇄에서 글꼴이 조금 달라도 넘치지 않게 3% 넉넉히 잡는다
      return (w * 1.03 * size) / 100;
    };
  }

  function pickLogo(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return say('이미지 파일을 골라 주세요');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // 브라우저에 저장해 두므로 작게 줄여서 담는다
      const k = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight, 1));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round((img.naturalWidth || 300) * k));
      c.height = Math.max(1, Math.round((img.naturalHeight || 300) * k));
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
      logo = c.toDataURL('image/png');
      logoAspect = c.width / c.height;
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      say('이미지를 읽지 못했습니다');
    };
    img.src = url;
  }

  function setOverride(patch: { text?: string; scale?: number }) {
    if (editing == null || !people[editing]) return;
    const key = people[editing].key;
    const next = { ...overrides[key], ...patch };
    if (!next.text?.trim() || next.text.trim() === people[editing].name) delete next.text;
    if (!next.scale || next.scale === 1) delete next.scale;
    if (Object.keys(next).length) overrides[key] = next;
    else delete overrides[key];
  }
  const edited = $derived(Object.keys(overrides).length);

  // ── 좌석표 ──
  const rowsMode = $derived(shape === 'rows');
  const colsN = $derived(rowsMode ? int(deskCols, 1, 20) : int(tableCols, 1, 20));
  const rowsN = $derived(rowsMode ? int(rowCount, 1, 200) : int(tableRows, 1, 100));
  const blockN = $derived(rowsMode ? int(deskSeats, 1, 20) : int(seatsPer, 1, 30));
  /** 테이블(줄) 수와 한 테이블(줄)의 자리 수 */
  const groupsN = $derived(rowsMode ? rowsN : colsN * rowsN);
  const seatsN = $derived(rowsMode ? Math.min(120, blockN * colsN) : blockN);
  /** 칸마다 막거나 치운 자리 수 (치운 테이블은 Infinity) */
  const offPerSlot = $derived.by(() => {
    const m = new Map<number, number>();
    for (const [k, v] of Object.entries(offs)) {
      const [slot, seat] = k.split(':').map(Number);
      if (v === 'removed') m.set(slot, Infinity);
      else if (seat < seatsN) m.set(slot, (m.get(slot) ?? 0) + 1);
    }
    return m;
  });
  const openIn = (slot: number) => Math.max(0, seatsN - (offPerSlot.get(slot) ?? 0));
  const capacity = $derived(Array.from({ length: groupsN }, (_, i) => openIn(i)).reduce((a, b) => a + b, 0));
  /** 모두 앉으려면 몇 행이 필요한가 (막은 자리는 빼고) */
  const needRows = $derived.by(() => {
    const per = rowsMode ? 1 : colsN;
    let cap = 0;
    for (let r = 1; r <= 2000; r++) {
      for (let c = 0; c < per; c++) cap += openIn((r - 1) * per + c);
      if (cap >= people.length) return r;
    }
    return rowsN;
  });
  /** 치운 테이블(줄)의 칸 */
  const holes = $derived(Array.from({ length: groupsN }, (_, i) => i).filter((i) => offs[offKey(i)] === 'removed'));
  const apart = $derived(parseGroups(apartText, people));
  const together = $derived(parseGroups(togetherText, people));
  const unknown = $derived([...new Set([...apart.unknown, ...together.unknown])]);
  const constrained = $derived(method === 'random' || method === 'mix');
  const seatedN = $derived(tables ? seated(tables) : 0);
  /** 명단에는 있는데 자리가 없는 사람 (자리가 모자랐거나, 배치한 뒤에 명단이 바뀌었다) */
  const standing = $derived(tables && seatOf ? people.filter((p) => !seatOf.has(p.key)).map((p) => p.name) : []);
  const rowsOf = $derived(tables ? lookup(tables) : []);

  // 자리 · 열 · 행 칸: 비우는 중에는 그대로 두고, 숫자가 들어오면 지금 모양의 값을 바꾼다
  const typed = (v: string, set: (n: number) => void) => Number(v) >= 1 && set(Math.floor(Number(v)));
  const setBlock = (v: string) => typed(v, (n) => (rowsMode ? (deskSeats = n) : (seatsPer = n)));
  const setCols = (v: string) => typed(v, (n) => (rowsMode ? (deskCols = n) : (tableCols = n)));
  const setRows = (v: string) => typed(v, (n) => (rowsMode ? (rowCount = n) : (tableRows = n)));

  /** 명단이 비어 있어도 빈 자리로 배치도를 그려 모양을 보여 준다 */
  function assign() {
    // 고쳐 둔 테이블 이름은 다시 배치해도 남긴다 (자리 모양을 바꾸면 새로)
    const keep = (shape === planShape && tables?.map((t, i) => (t.name === tableName(i, planShape) ? '' : t.name))) || [];
    // 모양 · 열 · 자리 수가 바뀌면 막아 둔 칸이 다른 자리를 가리키니 비운다 (행 수만 바뀌면 그대로)
    if (tables && (shape !== planShape || colsN !== planCols || tables[0]?.seats.length !== seatsN)) offs = {};
    let g = openSlots(offs, groupsN, seatsN);
    if (!g.slots.length) (offs = {}), (g = openSlots(offs, groupsN, seatsN));
    const r = assignSeats(people, {
      tables: g.slots.length,
      seats: seatsN,
      caps: g.off.map((o) => o.filter((x) => !x).length),
      method,
      front: shape === 'rows',
      apart: constrained ? apart.groups : [],
      together: constrained ? together.groups : [],
    });
    // 모양이나 테이블 수가 바뀌면 옮겨 둔 자리는 맞지 않는다
    if (shape !== planShape || longDir !== planDir || colsN !== planCols || tables?.length !== r.tables.length || tables[0]?.seats.length !== seatsN) layout = null;
    tables = toTables(r, people, seatsN, shape, keep, g);
    planShape = shape;
    planDir = longDir;
    planCols = colsN;
    planBlock = rowsMode && colsN > 1 ? blockN : 0;
    if (method === 'group' && hasInfo) colorBy = true;
    unmet = r.unmet.map(([a, b]) => `${people[a].name} · ${people[b].name}`);
    picked = null;
  }
  // 설정을 바꾸면 바로 다시 앉힌다. 무엇이 바뀌었는지는 이 열쇠로 본다.
  // 떨어뜨리기 · 묶기는 이름이 명단과 맞아떨어진 묶음만 (치는 도중에는 그대로)
  const groupKey = (gs: number[][]) => gs.map((g) => g.map((i) => people[i]?.key));
  const settingsKey = $derived(
    JSON.stringify([shape, colsN, rowsN, blockN, method, shape === 'long' ? longDir : '', constrained ? [groupKey(apart.groups), groupKey(together.groups)] : []]),
  );
  let lastKey: string | null = null;
  $effect(() => {
    const key = settingsKey;
    if (!ready || mode !== 'seat') return;
    // 좌석표를 처음 열면: 저장해 둔 배치가 있으면 그대로, 없으면 바로 그린다
    if (lastKey === null) {
      lastKey = key;
      if (!untrack(() => tables)) untrack(assign);
    } else if (key !== lastKey) {
      lastKey = key;
      untrack(assign);
    }
  });
  // 빈 배치도에 명단이 들어오면 바로 앉힌다. 이미 앉은 사람이 있으면 손댄 자리를 지키고 알려만 준다
  $effect(() => {
    if (ready && mode === 'seat' && people.length && tables && seatedN === 0 && capacity > 0) untrack(assign);
  });
  function pick(t: number, s: number) {
    if (!tables) return;
    if (!picked) picked = [t, s];
    else if (picked[0] === t && picked[1] === s) picked = null;
    else {
      tables = swapSeats(tables, picked, [t, s]);
      picked = null;
    }
  }
  /** 배치도 오른쪽 클릭: 막기 · 치우기 · 되돌리기. 다시 섞지 않고 막힌 자리의 사람만 옮긴다 */
  function setOff(changes: OffChange[]) {
    const next = { ...offs };
    for (const [k, v] of changes) v == null ? delete next[k] : (next[k] = v);
    // 테이블을 모두 치울 수는 없다
    if (!openSlots(next, groupsN, seatsN).slots.length) return say('테이블을 모두 치울 수는 없습니다');
    offs = next;
    picked = null;
    if (!tables) return assign();
    // 자리가 없던 사람도 빈 자리가 생기면 앉힌다
    const waiting = seatOf ? people.filter((p) => !seatOf.has(p.key)).map((p) => ({ name: p.name, info: p.info, key: p.key })) : [];
    const r = reshape(tables, next, groupsN, seatsN, planShape, waiting);
    // 손으로 옮긴 테이블 자리는 칸을 따라간다. 되돌린 테이블이 있으면 가지런히 다시
    if (layout) {
      const old = new Map(tables.map((t, i) => [t.slot ?? i, layout!.at[i]]));
      const at = r.tables.map((t) => old.get(t.slot!));
      layout = at.every(Boolean) ? { w: layout.w, at: at as NonNullable<(typeof at)[number]>[] } : null;
    }
    tables = r.tables;
    const out = r.left.length - waiting.length;
    if (out > 0) say(`자리가 모자라 ${out}명이 빠졌습니다`);
  }
  const restoreAll = () => setOff(Object.keys(offs).map((k) => [k, null]));
  function swap(a: SeatRef, b: SeatRef) {
    if (!tables) return;
    tables = swapSeats(tables, a, b);
    picked = null;
  }
  function saveCsv() {
    if (tables) downloadBlob(new Blob([seatingCsv(tables)], { type: 'text/csv;charset=utf-8' }), `좌석표-${timestamp()}.csv`);
  }
  /** 둥근 테이블: 자리 수에 맞춘 반지름(px)과 자리마다의 위치 */
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    picked = null;
    editing = null;
  }

  // 인쇄할 종이 크기는 고른 규격을 따른다. 이름표는 여백 없이 실제 크기로.
  const pageCss = $derived(
    '<' + `style>@page { size: ${mode === 'badge' ? `${grid.pageW}mm ${grid.pageH}mm` : 'A4'}; margin: ${mode === 'badge' ? '0' : '12mm'}; }</` + 'style>',
  );

  onMount(() => {
    const s = load<Record<string, any>>(KEY, {});
    const bool = (k: string, set: (v: boolean) => void) => typeof s[k] === 'boolean' && set(s[k]);
    const str = (k: string, set: (v: string) => void) => typeof s[k] === 'string' && set(s[k]);
    const num = (k: string, set: (v: number) => void) => Number(s[k]) >= 1 && set(Math.floor(Number(s[k])));
    str('text', (v) => (text = v));
    if (s.mode === 'seat') mode = 'seat';
    if (s.paper === 'Letter') paper = 'Letter';
    if (['tent', 'custom', ...PRESETS.map((p) => p.id)].includes(s.layoutId)) layoutId = s.layoutId;
    if (s.custom && typeof s.custom === 'object') for (const [k] of CUSTOM_FIELDS) if (Number.isFinite(Number(s.custom[k]))) custom[k] = Number(s.custom[k]);
    num('start', (v) => (start = v));
    bool('cut', (v) => (cut = v));
    bool('border', (v) => (border = v));
    str('event', (v) => (event = v));
    if (/^#[0-9a-fA-F]{6}$/.test(s.accent)) accent = s.accent;
    if (['top', 'side', 'none'].includes(s.band)) band = s.band;
    if (['left', 'center', 'right'].includes(s.align)) align = s.align;
    if (typeof s.logo === 'string' && s.logo.startsWith('data:image/') && Number(s.logoAspect) > 0) (logo = s.logo), (logoAspect = Number(s.logoAspect));
    bool('showInfo', (v) => (showInfo = v));
    bool('showNo', (v) => (showNo = v));
    bool('showTable', (v) => (showTable = v));
    bool('qrOn', (v) => (qrOn = v));
    str('qrText', (v) => (qrText = v));
    if (s.overrides && typeof s.overrides === 'object') overrides = s.overrides;
    if (['round', 'long', 'pod', 'rows'].includes(s.shape)) shape = s.shape;
    num('seatsPer', (v) => (seatsPer = v));
    num('tableCols', (v) => (tableCols = v));
    num('tableRows', (v) => (tableRows = v));
    num('deskSeats', (v) => (deskSeats = v));
    num('deskCols', (v) => (deskCols = v));
    num('rowCount', (v) => (rowCount = v));
    // 예전에 저장한 '테이블 수' · '한 줄 자리'
    if (s.tableCols == null && Number(s.tableCount) >= 1) {
      tableCols = Math.min(4, Math.floor(Number(s.tableCount)));
      tableRows = Math.ceil(Number(s.tableCount) / tableCols);
    }
    if (s.deskSeats == null && Number(s.colCount) >= 1) (deskSeats = Math.min(20, Math.floor(Number(s.colCount)))), (deskCols = 1);
    num('planCols', (v) => (planCols = v));
    if (s.offs && typeof s.offs === 'object')
      offs = Object.fromEntries(Object.entries(s.offs).filter(([k, v]) => /^\d+(:\d+)?$/.test(k) && ['closed', 'gone', 'removed'].includes(v as string))) as Offs;
    if (Number(s.planBlock) >= 0) planBlock = Math.floor(Number(s.planBlock));
    if (METHODS.some(([m]) => m === s.method)) method = s.method;
    str('apartText', (v) => (apartText = v));
    str('togetherText', (v) => (togetherText = v));
    if (Array.isArray(s.tables) && s.tables.every((t: any) => t && typeof t.name === 'string' && Array.isArray(t.seats))) tables = s.tables;
    if (['round', 'long', 'pod', 'rows'].includes(s.planShape)) planShape = s.planShape;
    if (s.longDir === 'v') longDir = 'v';
    if (s.planDir === 'v') planDir = 'v';
    bool('colorBy', (v) => (colorBy = v));
    const L = s.layout;
    if (L && Number.isFinite(L.w) && Array.isArray(L.at) && L.at.every((p: any) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) layout = { w: L.w, at: L.at.map((p: any) => ({ x: p.x, y: p.y })) };
    measures = { name: makeMeasure(800), info: makeMeasure(500) };
    ready = true;
  });
  $effect(() => {
    const snap = {
      text, mode, paper, layoutId, custom: $state.snapshot(custom), start, cut, border, event, accent, band, align, logo, logoAspect, showInfo, showNo, showTable,
      qrOn, qrText, overrides: $state.snapshot(overrides), shape, seatsPer, tableCols, tableRows, deskSeats, deskCols, rowCount, method, apartText, togetherText,
      tables: $state.snapshot(tables), planShape, longDir, planDir, planCols, planBlock, offs: $state.snapshot(offs), colorBy, layout: $state.snapshot(layout),
    };
    if (ready) save(KEY, snap);
  });
</script>

<svelte:window onkeydown={onKey} />
<svelte:head>{@html pageCss}</svelte:head>

<ToolShell tool="badge">
  {#snippet actions()}
    <div class="seg" role="group" aria-label="무엇을 만들까">
      <button aria-pressed={mode === 'badge'} onclick={() => (mode = 'badge')}>이름표</button>
      <button aria-pressed={mode === 'seat'} onclick={() => (mode = 'seat')}>좌석표</button>
    </div>
  {/snippet}

  <div class="page badge-page">
    <section class="panel people">
      <div class="head">
        <h2>참가자</h2>
        <span class="count" class:zero={!people.length}>{people.length.toLocaleString('ko-KR')}명</span>
        {#if parsed.duplicates}
          <button class="warn-chip" onclick={() => (text = dedupeText(text))}>중복 {parsed.duplicates}건 · 정리하기</button>
        {/if}
      </div>
      <div class="tools">
        <button class="btn sm" onclick={() => (text = sampleText(22))}>예시 명단</button>
        <button class="btn sm ghost danger" disabled={!text} onclick={() => (text = '')}>비우기</button>
      </div>
      <textarea
        class="field list"
        bind:value={text}
        spellcheck="false"
        aria-label="참가자 명단"
        placeholder={'한 줄에 한 명씩 입력하거나, 엑셀에서 복사해 붙여넣으세요.\n\n김하늘\t개발팀\t팀장\n이서연\t디자인팀\n박민준\n\n첫 칸은 이름, 다음 칸은 소속 · 직함입니다.\n이름표에는 이름 아래에 작게 들어가고,\n좌석표에서는 소속을 섞거나 모을 때 씁니다.'}
      ></textarea>
      <p class="foot">명단과 로고는 이 브라우저에만 저장되며 서버로 전송되지 않습니다.</p>
    </section>

    {#if mode === 'badge'}
      <section class="panel setup">
        <h2>종이와 칸</h2>
        <div class="two">
          <label class="f">
            <span>종이</span>
            <select class="field" bind:value={paper} aria-label="종이">
              {#each Object.values(PAPERS) as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
            </select>
          </label>
          <label class="f">
            <span>몇 번째 칸부터</span>
            <input class="field" type="number" min="1" max={perPage(grid)} bind:value={start} aria-label="몇 번째 칸부터" disabled={perPage(grid) < 2} />
          </label>
        </div>
        <label class="f">
          <span>규격</span>
          <select class="field" bind:value={layoutId} aria-label="규격">
            {#each PRESETS as p (p.id)}<option value={p.id}>{presetName(p)}</option>{/each}
            <option value="tent">접는 명패 (한 장에 한 명, 반으로 접기)</option>
            <option value="custom">사용자 지정</option>
          </select>
        </label>
        {#if layoutId === 'custom'}
          <div class="custom">
            {#each CUSTOM_FIELDS as [k, label] (k)}
              <label class="f">
                <span>{label}{#if k !== 'cols' && k !== 'rows'}<small> mm</small>{/if}</span>
                <input class="field" type="number" min="0" step={k === 'cols' || k === 'rows' ? 1 : 0.1} bind:value={custom[k]} aria-label={label} />
              </label>
            {/each}
          </div>
        {/if}
        {#if gridError}<p class="alert" role="alert">{gridError}</p>{:else if shrunk}<p class="note">{shrunk}</p>{/if}
        {#if layoutId === 'tent'}
          <p class="note">종이를 가로로 놓고 가운데 줄을 따라 접으면 양쪽에서 이름이 보입니다. 위쪽 반은 거꾸로 찍힙니다.</p>
        {:else if int(start) > 1 && !gridError}
          <p class="note">첫 장은 {int(start, 1, perPage(grid))}번째 칸부터 채웁니다. 쓰다 남은 라벨 용지를 그대로 넣으세요.</p>
        {/if}
        <div class="checks">
          <label class="check"><input type="checkbox" bind:checked={cut} /> <span>{layoutId === 'tent' ? '접는 선' : '재단선'}</span></label>
          <label class="check"><input type="checkbox" bind:checked={border} /> <span>테두리</span></label>
        </div>

        <h2 class="sub">꾸미기</h2>
        <label class="f">
          <span>행사 이름</span>
          <input class="field" bind:value={event} aria-label="행사 이름" placeholder="2026 신입사원 환영회" />
        </label>
        <div class="f">
          <span>강조색</span>
          <div class="colors">
            {#each SWATCHES as c (c)}
              <button class="swatch" style:background={c} aria-label="강조색 {c}" aria-pressed={accent.toLowerCase() === c} onclick={() => (accent = c)}></button>
            {/each}
            <input type="color" bind:value={accent} aria-label="강조색 직접 고르기" />
          </div>
        </div>
        <div class="f">
          <span>색 띠</span>
          <div class="seg" role="group" aria-label="색 띠">
            <button aria-pressed={band === 'top'} onclick={() => (band = 'top')}>위</button>
            <button aria-pressed={band === 'side'} onclick={() => (band = 'side')}>옆</button>
            <button aria-pressed={band === 'none'} onclick={() => (band = 'none')}>없음</button>
          </div>
        </div>
        <div class="f">
          <span>글자 맞춤</span>
          <div class="seg" role="group" aria-label="글자 맞춤">
            <button aria-pressed={align === 'left'} onclick={() => (align = 'left')}>왼쪽</button>
            <button aria-pressed={align === 'center'} onclick={() => (align = 'center')}>가운데</button>
            <button aria-pressed={align === 'right'} onclick={() => (align = 'right')}>오른쪽</button>
          </div>
        </div>
        <div class="f">
          <span>로고</span>
          <div class="tools">
            <input class="sr-only" type="file" accept="image/*" bind:this={logoInput} onchange={pickLogo} aria-label="로고 이미지" tabindex="-1" />
            <button class="btn sm" onclick={() => logoInput?.click()}>{logo ? '다른 이미지' : '이미지 고르기'}</button>
            {#if logo}
              <img class="logo-thumb" src={logo} alt="고른 로고" />
              <button class="btn sm ghost danger" onclick={() => ((logo = ''), (logoAspect = 0))}>지우기</button>
            {/if}
          </div>
        </div>
        <div class="f">
          <span>함께 적을 것</span>
          <div class="checks">
            <label class="check"><input type="checkbox" bind:checked={showInfo} disabled={!hasInfo} /> <span>소속 · 직함</span></label>
            <label class="check"><input type="checkbox" bind:checked={showNo} /> <span>번호</span></label>
            <label class="check"><input type="checkbox" bind:checked={showTable} /> <span>테이블</span></label>
          </div>
          {#if showTable && !tables}<p class="note">아직 자리를 배치하지 않았습니다. <button class="link" onclick={() => (mode = 'seat')}>좌석표</button>에서 배치하면 이름표에 테이블이 들어갑니다.</p>{/if}
        </div>

        <h2 class="sub">QR</h2>
        <label class="check"><input type="checkbox" bind:checked={qrOn} /> <span>사람마다 QR 넣기</span></label>
        {#if qrOn}
          <label class="f">
            <span>QR 내용</span>
            <input class="field" bind:value={qrText} aria-label="QR 내용" spellcheck="false" placeholder={'https://example.com/checkin?no={번호}'} />
          </label>
          <div class="tools">
            {#each ['{이름}', '{소속}', '{번호}'] as k (k)}<button class="btn sm" onclick={() => (qrText += k)}>{k}</button>{/each}
          </div>
          <p class="note">{'{이름} {소속} {번호}'} 자리에 그 사람 것이 들어갑니다. 빼고 주소만 적으면 모두 같은 QR 이 됩니다.</p>
          {#if qrFailed}<p class="alert" role="alert">QR 에 담기에 내용이 너무 긴 사람이 {qrFailed}명 있습니다. 내용을 줄여 주세요.</p>{/if}
        {/if}
      </section>

      <section class="panel out">
        <div class="head noprint">
          <h2>미리보기</h2>
          {#if pages.length}<span class="count">{pages.length}장 · {grid.tent ? '명패' : '이름표'} {people.length}개</span>{/if}
          <div class="head-actions">
            {#if edited}<button class="btn sm ghost" onclick={() => ((overrides = {}), (editing = null))}>고친 것 {edited}개 되돌리기</button>{/if}
            <button class="btn sm primary" disabled={!pages.length} onclick={() => window.print()}>인쇄</button>
          </div>
        </div>
        {#if editing != null && people[editing]}
          {@const p = people[editing]}
          <div class="editor noprint" role="group" aria-label="{p.name} 이름표 고치기">
            <label class="f">
              <span>이름표에 적을 이름 <small>— {p.name}</small></span>
              <input class="field" value={overrides[p.key]?.text ?? p.name} oninput={(e) => setOverride({ text: e.currentTarget.value })} aria-label="이름표에 적을 이름" />
            </label>
            <label class="f">
              <span>글자 크기 <small>{Math.round((overrides[p.key]?.scale ?? 1) * 100)}%</small></span>
              <input type="range" min="50" max="120" step="5" value={(overrides[p.key]?.scale ?? 1) * 100} oninput={(e) => setOverride({ scale: Number(e.currentTarget.value) / 100 })} aria-label="글자 크기" />
            </label>
            <button class="btn sm" onclick={() => (editing = null)}>닫기</button>
          </div>
        {/if}
        {#if gridError}
          <p class="empty">칸이 종이에 들어가지 않습니다.<br />왼쪽에서 칸 크기나 여백을 고쳐 주세요.</p>
        {:else if !people.length}
          <p class="empty">명단을 넣으면 인쇄할 {grid.tent ? '명패' : '이름표'}가 여기에 나옵니다.<br />긴 이름은 줄이고 짧은 이름은 벌려서, 이름이 칸에 꽉 차게 맞춥니다.</p>
        {:else}
          <p class="hint noprint">
            인쇄 창에서 배율을 <b>100% (실제 크기)</b>, 여백을 <b>없음</b>으로 맞추세요. ‘용지에 맞춤’이면 칸이 어긋납니다. 이름표를 누르면 그 사람 것만 고칠 수 있습니다.
          </p>
          <div class="sheets" bind:clientWidth={previewW}>
            {#if layouts.length === people.length}
              {#each pages as page, pi (pi)}
                <div class="sheet-wrap" style:--s={scale} style:--w="{grid.pageW}mm" style:--h="{grid.pageH}mm">
                  <div class="sheet" aria-label="{pi + 1}번째 장">
                    {#each page as idx, ci (ci)}
                      {#if idx != null}
                        {@const p = people[idx]}
                        {@const c = cells[ci]}
                        <button class="cell" class:on={editing === idx} style:left="{c.x}mm" style:top="{c.y}mm" aria-label="{p.name} 이름표 고치기" onclick={() => (editing = editing === idx ? null : idx)}>
                          {#each grid.tent ? [true, false] : [false] as flipped (flipped)}
                            <div class:flipped>
                              <Face
                                w={grid.cellW}
                                h={grid.cellH}
                                l={layouts[idx]}
                                {event}
                                {band}
                                accent={accentOk}
                                {onAccent}
                                {align}
                                {logo}
                                no={showNo ? `No. ${p.no}` : ''}
                                table={tableText(idx)}
                                qr={qrs[idx] ?? ''}
                                {border}
                              />
                            </div>
                          {/each}
                        </button>
                      {/if}
                    {/each}
                    {#if cut}
                      <svg class="cuts" viewBox="0 0 {grid.pageW} {grid.pageH}" aria-hidden="true">
                        {#if grid.tent}
                          <line x1="0" x2={grid.pageW} y1={grid.pageH / 2} y2={grid.pageH / 2} />
                        {:else}
                          {#each cuts.xs as x (x)}<line x1={x} x2={x} y1="0" y2={grid.pageH} />{/each}
                          {#each cuts.ys as y (y)}<line x1="0" x2={grid.pageW} y1={y} y2={y} />{/each}
                        {/if}
                      </svg>
                    {/if}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        {/if}
      </section>
    {:else}
      <section class="panel setup">
        <h2>자리 모양</h2>
        <div class="f">
          <div class="seg" role="group" aria-label="자리 모양">
            <button aria-pressed={shape === 'round'} onclick={() => (shape = 'round')}>원탁</button>
            <button aria-pressed={shape === 'long'} onclick={() => (shape = 'long')}>긴 탁자</button>
            <button aria-pressed={shape === 'pod'} onclick={() => ((shape = 'pod'), seatsPer > 8 && (seatsPer = 6))} title="2인 책상을 칠판과 직각으로 마주 붙이고, 뒤쪽 끝에 칠판을 보는 책상 하나">모둠 책상</button>
            <button aria-pressed={shape === 'rows'} onclick={() => (shape = 'rows')}>줄 맞춤</button>
          </div>
        </div>
        {#if shape === 'long'}
          <div class="inline">
            <span>탁자 방향</span>
            <div class="seg" role="group" aria-label="탁자 방향">
              <button aria-pressed={longDir === 'h'} onclick={() => (longDir = 'h')}>가로</button>
              <button aria-pressed={longDir === 'v'} onclick={() => (longDir = 'v')}>세로</button>
            </div>
          </div>
        {:else if shape === 'pod'}
          <p class="note">2인 책상을 칠판과 직각으로 돌려 마주 붙이고, 다섯 명부터는 칠판에서 먼 쪽 끝에 칠판을 바라보는 책상을 하나 놓습니다. 여섯 자리면 책상 셋입니다.</p>
        {/if}
        <div class="inline grid-size">
          <input class="field num" type="number" min="1" max={rowsMode ? 20 : 30} value={blockN} onblur={(e) => (e.currentTarget.value = String(blockN))} oninput={(e) => setBlock(e.currentTarget.value)} aria-label={rowsMode ? '책상당 자리' : '테이블당 자리'} />
          <span>자리 ×</span>
          <input class="field num" type="number" min="1" max="20" value={colsN} onblur={(e) => (e.currentTarget.value = String(colsN))} oninput={(e) => setCols(e.currentTarget.value)} aria-label="열 수" />
          <span>열 ×</span>
          <input class="field num" type="number" min="1" max={rowsMode ? 200 : 100} value={rowsN} onblur={(e) => (e.currentTarget.value = String(rowsN))} oninput={(e) => setRows(e.currentTarget.value)} aria-label="행 수" />
          <span>행</span>
        </div>
        <p class="note fit">
          <span>{rowsMode ? `한 줄 ${seatsN}자리 · ${rowsN}줄` : `${shape === 'pod' ? '모둠' : '테이블'} ${groupsN}개`} · 자리 {capacity.toLocaleString('ko-KR')}개 · 참가자 {people.length.toLocaleString('ko-KR')}명</span>
          {#if people.length && needRows !== rowsN}
            <button class="btn sm" onclick={() => setRows(String(needRows))}>{needRows}행으로 맞추기</button>
          {/if}
        </p>
        {#if people.length > capacity}
          <p class="alert" role="alert">자리가 {people.length - capacity}개 모자랍니다. 행을 늘리지 않으면 그만큼은 앉지 못합니다.</p>
        {/if}

        <label class="f">
          <span>앉히는 방법</span>
          <select class="field" bind:value={method} aria-label="앉히는 방법">
            {#each METHODS as [m, label] (m)}<option value={m}>{label}</option>{/each}
          </select>
        </label>
        {#if (method === 'mix' || method === 'group') && people.length && !hasInfo}
          <p class="note">명단에 소속이 없습니다. 이름 옆 칸에 소속을 적으면 {method === 'mix' ? '섞어서' : '모아서'} 앉힙니다.</p>
        {/if}
        {#if constrained}
          <label class="f">
            <span>떨어뜨릴 사람 <small>— 한 줄에 한 묶음, 쉼표로</small></span>
            <textarea class="field" rows="2" bind:value={apartText} spellcheck="false" placeholder="김하늘, 이서연"></textarea>
          </label>
          <label class="f">
            <span>같은 테이블에 넣을 사람</span>
            <textarea class="field" rows="2" bind:value={togetherText} spellcheck="false" placeholder="박민준, 최지우"></textarea>
          </label>
          {#if unknown.length}<p class="alert">명단에 없는 이름: {unknown.join(', ')}</p>{/if}
        {/if}
        <label class="check"><input type="checkbox" bind:checked={colorBy} disabled={!hasInfo} /> <span>소속마다 색으로 표시</span></label>
        <button class="btn primary go" disabled={!people.length} onclick={assign}>다시 배치</button>
        <p class="keys">
          설정을 바꾸면 바로 다시 앉힙니다. {method === 'order' || method === 'group' ? shape === 'rows' ? '앞줄부터 차례로 채웁니다.' : '테이블마다 인원이 고르게 나뉩니다.' : '순서는 암호학적 난수로 정합니다.'} 배치한 뒤에는 자리 둘을 차례로 눌러 맞바꿀 수 있고, {shape === 'rows' ? '줄' : '테이블'} 이름도 고칠 수 있습니다.{shape === 'rows' ? '' : ' 테이블은 끌어서 실제 놓인 자리대로 옮길 수 있습니다.'}
        </p>
      </section>

      <section class="panel out results">
        <div class="head noprint">
          <h2>배치도</h2>
          {#if tables}<span class="count">{planShape === 'rows' ? `${seatedN ? tables.filter((t) => t.seats.some(Boolean)).length : tables.length}줄` : `${planShape === 'pod' ? '모둠' : '테이블'} ${tables.length}개`} · {seatedN}명</span>{/if}
          <div class="head-actions">
            <button class="btn sm" disabled={!tables} onclick={() => plan?.enter()} title="프로젝터에 띄워 놓고 그대로 앉게 합니다">전체 화면</button>
            <button class="btn sm" disabled={!tables} onclick={() => tables && copy(seatingText(tables))}>복사</button>
            <button class="btn sm" disabled={!tables} onclick={saveCsv}>CSV 저장</button>
            <button class="btn sm primary" disabled={!tables} onclick={() => window.print()}>인쇄</button>
          </div>
        </div>
        {#if unmet.length}<p class="alert noprint">테이블 수보다 많아 떨어뜨리지 못했습니다: {unmet.join(' / ')}</p>{/if}
        {#if standing.length}
          <p class="alert noprint" role="alert">
            자리가 없는 사람 {standing.length}명: {standing.slice(0, 8).join(', ')}{standing.length > 8 ? ' …' : ''} — 자리를 늘리거나 명단을 고쳤다면 다시 배치하세요.
          </p>
        {/if}
        {#if !tables}
          <p class="empty">배치도를 그리는 중입니다.</p>
        {:else}
          <p class="hint noprint">
            {#if !people.length}자리 모양을 미리 봅니다. <b>참가자 명단</b>에 이름을 넣으면 바로 자리를 채웁니다.{:else if picked}<b>{tables[picked[0]]?.seats[picked[1]]?.name ?? '빈 자리'}</b> — 바꿀 자리를 누르세요. <kbd>Esc</kbd> 로 그만둡니다.{:else}사람을 끌어 다른 자리에 놓거나, 자리를 누르고 다른 자리를 누르면 서로 바뀝니다. 빈 자리로 옮길 수도 있습니다.{planShape === 'rows' ? '' : ' 테이블은 끌어서 옮깁니다.'} 오른쪽 클릭으로 자리 · 책상 · {planShape === 'rows' ? '줄' : '테이블'}을 막거나 치웁니다.{/if}
            {#if Object.keys(offs).length}<button class="link" onclick={restoreAll}>막거나 치운 것 모두 되돌리기</button>{/if}
          </p>
          <Plan bind:this={plan} bind:tables bind:layout shape={planShape} vertical={planDir === 'v'} cols={planCols} block={planBlock} {colorBy} title={event} {picked} onpick={pick} onswap={swap} {holes} onoff={setOff} />

          <div class="lookup">
            <div class="head">
              <h2>이름으로 찾는 표</h2>
              <span class="count">가나다순 · {rowsOf.length}명</span>
              <div class="head-actions noprint">
                <button class="btn sm" onclick={() => tables && copy(lookupText(tables))}>찾는 표 복사</button>
              </div>
            </div>
            <ul>
              {#each rowsOf as row, i (i)}
                <li>
                  <span class="l-name">{row.name}{#if row.info}<small>{row.info}</small>{/if}</span>
                  <span class="l-seat">{row.table} <b>{row.seat}번</b></span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </section>
    {/if}
    {#if toast}<div class="toast noprint" role="status">{toast}</div>{/if}
  </div>
</ToolShell>

<style>
  .page {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(230px, 280px) minmax(280px, 330px) minmax(0, 1fr);
    gap: 14px;
    padding: 14px;
    max-width: 1560px;
    width: 100%;
    margin: 0 auto;
    position: relative;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    min-width: 0;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    overflow-y: auto;
  }
  h2 {
    font-size: 15px;
  }
  h2.sub {
    margin-top: 6px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  .head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .count {
    font-size: 12.5px;
    font-weight: 650;
    padding: 2px 9px;
    border-radius: 99px;
    background: var(--app-soft);
    font-variant-numeric: tabular-nums;
  }
  .count.zero {
    background: var(--surface-2);
    color: var(--faint);
  }
  .head-actions {
    margin-left: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .warn-chip {
    border: 0;
    padding: 2px 9px;
    border-radius: 99px;
    font-size: 12px;
    font-weight: 650;
    color: color-mix(in srgb, #f08c00 70%, var(--text));
    background: color-mix(in srgb, #f08c00 14%, var(--surface));
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .list {
    flex: 1;
    min-height: 180px;
    resize: none;
    font-size: 13.5px;
    tab-size: 12;
  }
  .foot,
  .keys,
  .note,
  .hint {
    font-size: 12px;
    color: var(--faint);
    line-height: 1.6;
  }
  .hint b {
    color: var(--muted);
  }
  .note.fit {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    font-variant-numeric: tabular-nums;
  }
  .link {
    border: 0;
    padding: 0;
    background: none;
    color: var(--app);
    font-weight: 650;
    text-decoration: underline;
  }
  .f {
    display: grid;
    gap: 6px;
    min-width: 0;
    font-size: 12.5px;
    color: var(--muted);
  }
  .f > span {
    font-weight: 650;
  }
  small {
    font-size: 12px;
    font-weight: 400;
    color: var(--faint);
  }
  .f .field {
    width: 100%;
    color: var(--text);
  }
  .f .seg {
    display: flex;
  }
  .f .seg button {
    flex: 1;
    padding: 0 6px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .custom {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 10px;
    padding: 10px;
    border-radius: 12px;
    background: var(--surface-2);
  }
  .inline {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .inline .num {
    width: 72px;
  }
  .grid-size {
    gap: 6px;
  }
  .grid-size .num {
    width: 0;
    flex: 1 1 0;
    min-width: 48px;
    max-width: 72px;
  }
  .grid-size span {
    white-space: nowrap;
  }
  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    font-size: 13px;
    color: var(--text);
  }
  .check input {
    accent-color: var(--app);
    margin: 4px 0 0;
  }
  .colors {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    width: 24px;
    height: 24px;
    padding: 0;
    border: 2px solid var(--surface);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--border-strong);
  }
  .swatch[aria-pressed='true'] {
    box-shadow: 0 0 0 2px var(--text);
  }
  .colors input[type='color'] {
    width: 34px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: none;
  }
  .logo-thumb {
    height: 28px;
    max-width: 90px;
    padding: 2px 4px;
    border-radius: 6px;
    background: #fff;
    border: 1px solid var(--border);
    object-fit: contain;
  }
  .alert {
    padding: 7px 11px;
    border-radius: 10px;
    font-size: 12.5px;
    color: color-mix(in srgb, #f08c00 70%, var(--text));
    background: color-mix(in srgb, #f08c00 12%, var(--surface));
  }
  .go {
    height: 42px;
    font-size: 15px;
    margin-top: 4px;
  }
  .empty {
    margin: auto;
    text-align: center;
    color: var(--faint);
    font-size: 13.5px;
    line-height: 1.8;
  }

  /* 이름표 미리보기: 종이를 실제 mm 로 그리고 통째로 줄여 보여 준다 */
  .sheets {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }
  .sheet-wrap {
    flex: none;
    width: calc(var(--w) * var(--s));
    height: calc(var(--h) * var(--s));
    box-shadow: 0 0 0 1px var(--border-strong), var(--shadow-md);
    background: #fff;
    overflow: hidden;
  }
  .sheet {
    position: relative;
    width: var(--w);
    height: var(--h);
    transform: scale(var(--s));
    transform-origin: 0 0;
    background: #fff;
    color: #111;
    color-scheme: light;
    overflow: hidden;
  }
  .cell {
    position: absolute;
    display: block;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    line-height: 1.5;
  }
  .cell:hover,
  .cell.on {
    outline: 0.6mm solid var(--app);
    outline-offset: -0.6mm;
    z-index: 1;
  }
  .flipped {
    transform: rotate(180deg);
  }
  .cuts {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .cuts line {
    stroke: #9a9a9a;
    stroke-width: 0.15;
    stroke-dasharray: 1.2 1.2;
  }
  .editor {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto;
    align-items: end;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--app-soft);
    border: 1px solid var(--app-line);
  }
  .editor input[type='range'] {
    width: 100%;
    height: 34px;
    accent-color: var(--app);
  }

  .lookup {
    display: grid;
    gap: 10px;
    margin-top: 6px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  .lookup ul {
    list-style: none;
    margin: 0;
    padding: 0;
    columns: 220px auto;
    column-gap: 22px;
  }
  .lookup li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 0;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
    break-inside: avoid;
  }
  .l-name {
    font-weight: 600;
    min-width: 0;
  }
  .l-name small {
    margin-left: 6px;
    font-size: 11.5px;
  }
  .l-seat {
    flex: none;
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .l-seat b {
    color: var(--text);
  }

  .toast {
    position: absolute;
    left: 50%;
    bottom: 20px;
    transform: translateX(-50%);
    padding: 7px 14px;
    border-radius: 99px;
    background: var(--text);
    color: var(--bg);
    font-size: 12.5px;
    font-weight: 600;
    z-index: 5;
  }

  @media (max-width: 1080px) {
    .page {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
      overflow-y: auto;
    }
    .out {
      grid-column: 1 / -1;
      overflow: visible;
      min-height: 260px;
    }
    .panel.people,
    .panel.setup {
      max-height: 480px;
    }
  }
  @media (max-width: 640px) {
    .page {
      display: flex;
      flex-direction: column;
      padding: 10px;
      gap: 10px;
    }
    .panel {
      overflow: visible;
      flex: none;
      max-height: none !important;
      padding: 14px;
    }
    .head-actions {
      margin-left: 0;
    }
    .editor {
      grid-template-columns: 1fr;
    }
    .toast {
      position: fixed;
    }
  }

  /* 인쇄: 종이(이름표) 또는 배치도와 찾는 표만. 화면 테마와 상관없이 흰 종이에 검은 글자. */
  @media print {
    :global(html:has(.badge-page)),
    :global(html:has(.badge-page) body) {
      height: auto !important;
      background: #fff !important;
    }
    :global(html:has(.badge-page) .shell) {
      display: block !important;
      height: auto !important;
    }
    :global(html:has(.badge-page) .shell > header) {
      display: none !important;
    }
    :global(html:has(.badge-page) main) {
      display: block !important;
    }
    .page {
      display: block;
      max-width: none;
      padding: 0;
      overflow: visible;
      --surface: #fff;
      --surface-2: #f3f3f3;
      --text: #111;
      --muted: #444;
      --faint: #777;
      --border: #ddd;
      --border-strong: #aaa;
      --app: #9c5a2b;
      --app-soft: #f6efe9;
      --app-line: #d9bfa9;
      color: #111;
      color-scheme: light;
    }
    .panel,
    .noprint {
      display: none !important;
    }
    .panel.out {
      display: block !important;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: none;
      overflow: visible;
      min-height: 0;
    }
    .sheets {
      display: block;
    }
    .sheet-wrap {
      --s: 1 !important;
      box-shadow: none;
      break-after: page;
      break-inside: avoid;
    }
    .sheet-wrap:last-child {
      break-after: auto;
    }
    .cell {
      outline: none !important;
    }
    .lookup {
      break-before: page;
      border: 0;
      margin: 0;
      padding: 0;
    }
    .lookup ul {
      columns: 3;
    }
  }
</style>
