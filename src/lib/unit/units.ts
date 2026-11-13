// 단위 표. 값은 모두 "기준 단위 몇 개인가" 를 정확한 분수(문자열)로 적는다.
// 옛 단위는 정해진 법정 값이 있는 것만 넣는다 (마지기처럼 지역마다 다른 것은 뺀다).

export type CatId = 'length' | 'area' | 'mass' | 'volume' | 'temp' | 'speed' | 'time' | 'data' | 'rate' | 'print' | 'energy' | 'pressure' | 'fuel';

export interface Category {
  id: CatId;
  name: string;
  /** 이 분류로 처음 올 때 쓰는 단위 */
  first: string;
  note?: string;
}

export interface UnitDef {
  id: string;
  cat: CatId;
  /** 화면에 적는 기호. 입력창에 다시 적어도 이 단위로 읽힌다 */
  sym: string;
  name: string;
  /** 1 단위 = 기준 단위 몇 개 (분수 문자열). 인쇄의 px 은 DPI 로 정한다 */
  f: string;
  /** 0점이 다른 단위 (온도): 기준 = (값 + off) × f */
  off?: string;
  /** 거꾸로 가는 단위 (L/100km): 기준 = f ÷ 값 */
  inv?: boolean;
  /** 1 px = 1/DPI in */
  dpi?: boolean;
  note?: string;
  /** 자주 쓰는 것 — 목록에서 진하게, 헷갈리는 입력에서 먼저 */
  main?: boolean;
  /** 이 단위로 적으면 크게 보여 줄 짝 */
  hero?: string;
  /**
   * 대소문자를 가리지 않는 이름.
   * ~ 로 시작하면 다른 뜻이 먼저인 이름 ("킬로" 는 kg 이 먼저, km 는 다음),
   * + 로 시작하면 다른 뜻이 하나도 맞지 않을 때만 쓰는 이름 ("1h 30m" 의 m)
   */
  alias: string[];
  /** 대소문자까지 맞아야 하는 이름 (MB 와 Mb 처럼) */
  cs?: string[];
}

export const categories: Category[] = [
  { id: 'length', name: '길이', first: 'm', note: '자 · 치 · 리는 옛 계량법 값입니다 (1자 = 10/33 m). 지금은 법정 단위가 아니어서 거래에는 m 를 씁니다.' },
  { id: 'area', name: '넓이', first: 'pyeong', note: '1평은 사방 6자, 400/121 m² 입니다. 마지기는 지역 · 논밭마다 150~300평으로 달라서 넣지 않았습니다.' },
  { id: 'mass', name: '무게', first: 'kg', note: '근은 무엇을 다느냐에 따라 다릅니다: 고기 · 한약재는 600g, 채소 · 과일은 375g. 돈 · 냥은 금 · 은을 잴 때 씁니다.' },
  { id: 'volume', name: '부피', first: 'L', note: '미국과 영국은 갤런 · 파인트 · 액량 온스가 서로 다릅니다. 홉 · 되 · 말은 옛 계량법 값(1되 = 2401/1331 L)입니다.' },
  { id: 'temp', name: '온도', first: 'C', note: '온도는 비율이 아니라 0점이 달라서 °F = °C × 9/5 + 32 로 바꿉니다. 온도 "차이" 를 바꿀 때는 아래 칸을 켜세요 (10°C 차이 = 18°F 차이).' },
  { id: 'speed', name: '속도', first: 'kmh', note: '마하는 해수면 · 15°C 공기에서 소리 빠르기(340.294 m/s)로 셉니다. 높이와 기온에 따라 달라집니다.' },
  { id: 'time', name: '시간', first: 'h', note: '한 달 · 한 해는 그레고리력 평균입니다 (365.2425일 ÷ 12 = 30.436875일).' },
  { id: 'data', name: '데이터 크기', first: 'GB', note: 'KB · MB · GB 는 1000씩, KiB · MiB · GiB 는 1024씩 커집니다. 디스크 · 통신사는 1000 단위로, 메모리는 1024 단위로 셉니다.' },
  { id: 'rate', name: '전송 속도', first: 'Mbps', note: '인터넷 속도(Mbps)는 비트, 내려받기 창의 속도(MB/s)는 바이트입니다. 1바이트 = 8비트라서 100 Mbps 는 12.5 MB/s 입니다.' },
  { id: 'print', name: '인쇄 · 화면', first: 'px', note: '1 in = 72 pt = 6 pica = 25.4 mm. px 은 해상도(DPI)에 따라 다릅니다 — 화면(CSS)은 96, 인쇄는 보통 300 입니다.' },
  { id: 'energy', name: '에너지', first: 'kcal', note: '1 cal = 4.184 J (열화학 칼로리). 음식에 적힌 "칼로리" 는 kcal 입니다.' },
  { id: 'pressure', name: '압력', first: 'bar', note: 'kgf/cm² 는 수압계 · 공구에 아직 많이 쓰는 공업 기압입니다. psi 는 미국식 타이어 공기압.' },
  { id: 'fuel', name: '연비', first: 'kmL', note: 'L/100km 는 거꾸로 가는 단위입니다 — 작을수록 좋습니다. 그래서 연비가 두 배가 되면 L/100km 는 절반이 됩니다.' },
];

const L = (id: string, sym: string, name: string, f: string, alias: string[], o: Partial<UnitDef> = {}): UnitDef => ({ id, cat: 'length', sym, name, f, alias, ...o });
const A = (id: string, sym: string, name: string, f: string, alias: string[], o: Partial<UnitDef> = {}): UnitDef => ({ id, cat: 'area', sym, name, f, alias, ...o });
const M = (id: string, sym: string, name: string, f: string, alias: string[], o: Partial<UnitDef> = {}): UnitDef => ({ id, cat: 'mass', sym, name, f, alias, ...o });
const V = (id: string, sym: string, name: string, f: string, alias: string[], o: Partial<UnitDef> = {}): UnitDef => ({ id, cat: 'volume', sym, name, f, alias, ...o });
const of = (cat: CatId) => (id: string, sym: string, name: string, f: string, alias: string[], o: Partial<UnitDef> = {}): UnitDef => ({ id, cat, sym, name, f, alias, ...o });
const T = of('temp');
const S = of('speed');
const Ti = of('time');
const Da = of('data');
const R = of('rate');
const P = of('print');
const E = of('energy');
const Pr = of('pressure');
const F = of('fuel');

/** 10^n 을 문자열로 */
const e = (n: number) => `1e${n}`;
// 1 lbf = 0.45359237 kg × 9.80665 m/s², 1 in² = 0.00064516 m²
const PSI = '4.4482216152605/0.00064516';
// 옛 계량법: 1되(升) = 2401/1331 L
const DOE = '2401000/1331';

export const units: UnitDef[] = [
  // ── 길이 (기준 m) ──
  L('nm', 'nm', '나노미터', e(-9), ['nm', '나노미터']),
  L('um', 'μm', '마이크로미터', e(-6), ['μm', 'um', '마이크로미터', '미크론', 'micron']),
  L('mm', 'mm', '밀리미터', '0.001', ['mm', '밀리미터', '밀리', '미리'], { main: true, hero: 'in' }),
  L('cm', 'cm', '센티미터', '0.01', ['cm', '센티미터', '센티', '센치', '센치미터'], { main: true, hero: 'in' }),
  L('m', 'm', '미터', '1', ['m', '미터', 'meter', 'meters', 'metre', 'metres'], { main: true, hero: 'ft' }),
  L('km', 'km', '킬로미터', '1000', ['km', '킬로미터', '키로미터', '~킬로', '~키로', 'kilometer', 'kilometers', 'kilometre'], { main: true, hero: 'mi' }),
  L('in', 'in', '인치', '0.0254', ['in', 'inch', 'inches', '인치', '"', '″', '”'], { main: true, hero: 'cm' }),
  L('ft', 'ft', '피트', '0.3048', ['ft', 'feet', 'foot', '피트', "'", '′', '’'], { main: true, hero: 'cm' }),
  L('yd', 'yd', '야드', '0.9144', ['yd', 'yds', 'yard', 'yards', '야드'], { hero: 'm' }),
  L('mi', 'mi', '마일', '1609.344', ['mi', 'mile', 'miles', '마일'], { main: true, hero: 'km' }),
  L('nmi', 'nmi', '해리', '1852', ['nmi', '해리', 'nautical mile', 'nautical miles'], { note: '국제 해리 1852 m', hero: 'km' }),
  L('ja', '자', '자 (척)', '10/33', ['자', '척', '尺'], { note: '10/33 m ≈ 30.3 cm', hero: 'cm' }),
  L('chi', '치', '치 (촌)', '1/33', ['치', '촌', '寸'], { note: '1/10 자 ≈ 3.03 cm', hero: 'cm' }),
  L('ri', '리', '리', '4320/11', ['리', '里'], { note: '1296자 ≈ 392.7 m. 흔히 "10리 = 4 km" 로 셉니다', hero: 'km' }),

  // ── 넓이 (기준 m²) ──
  A('cm2', 'cm²', '제곱센티미터', '0.0001', ['cm2', '제곱센티미터', '평방센티미터', 'sq cm']),
  A('m2', 'm²', '제곱미터', '1', ['m2', '제곱미터', '평방미터', '헤베', 'sqm', 'sq m', 'square meter', 'square meters', 'square metre'], { main: true, hero: 'pyeong' }),
  A('a', 'a', '아르', '100', ['아르', 'are'], { cs: ['a'] }),
  A('ha', 'ha', '헥타르', '10000', ['ha', '헥타르', '헥타', 'hectare', 'hectares'], { main: true, hero: 'pyeong' }),
  A('km2', 'km²', '제곱킬로미터', e(6), ['km2', '제곱킬로미터', '평방킬로미터', 'sq km'], { main: true, hero: 'mi2' }),
  A('pyeong', '평', '평', '400/121', ['평', '평형', '坪', 'py', 'pyeong'], { main: true, note: '6자 × 6자 = 400/121 m² ≈ 3.3058 m²', hero: 'm2' }),
  A('danbo', '단보', '단보', '120000/121', ['단보', '段步'], { note: '300평 ≈ 991.7 m² (논밭 넓이)', hero: 'm2' }),
  A('jeongbo', '정보', '정보', '1200000/121', ['정보', '町步'], { note: '3000평 ≈ 9917 m² ≈ 1 ha', hero: 'ha' }),
  A('in2', 'in²', '제곱인치', '0.00064516', ['in2', 'sq in', '제곱인치', 'square inch', 'square inches'], { hero: 'cm2' }),
  A('ft2', 'ft²', '제곱피트', '0.09290304', ['ft2', 'sq ft', 'sqft', 'sf', '제곱피트', '평방피트', 'square foot', 'square feet'], { main: true, hero: 'm2' }),
  A('yd2', 'yd²', '제곱야드', '0.83612736', ['yd2', 'sq yd', '제곱야드', 'square yard', 'square yards'], { hero: 'm2' }),
  A('acre', 'ac', '에이커', '4046.8564224', ['ac', 'acre', 'acres', '에이커'], { main: true, hero: 'pyeong' }),
  A('mi2', 'mi²', '제곱마일', '2589988.110336', ['mi2', 'sq mi', '제곱마일', 'square mile', 'square miles'], { hero: 'km2' }),

  // ── 무게 (기준 g) ──
  M('mg', 'mg', '밀리그램', '0.001', ['mg', '밀리그램', '미리그램']),
  M('g', 'g', '그램', '1', ['g', '그램', 'gram', 'grams', 'gr'], { main: true, hero: 'oz' }),
  M('kg', 'kg', '킬로그램', '1000', ['kg', '킬로그램', '키로그램', '킬로', '키로', 'kilo', 'kilos', 'kilogram', 'kilograms'], { main: true, hero: 'lb' }),
  M('t', 't', '톤', e(6), ['t', '톤', 'ton', 'tons', 'tonne', 'tonnes'], { main: true, note: '미터톤 1000 kg', hero: 'kg' }),
  M('ct', 'ct', '캐럿', '0.2', ['ct', '캐럿', 'carat', 'carats'], { note: '보석 무게 0.2 g', hero: 'g' }),
  M('oz', 'oz', '온스', '28.349523125', ['oz', '온스', 'ounce', 'ounces'], { main: true, hero: 'g' }),
  M('lb', 'lb', '파운드', '453.59237', ['lb', 'lbs', '파운드', 'pound', 'pounds'], { main: true, hero: 'kg' }),
  M('geun', '근', '근 (고기)', '600', ['근', '斤', '고기 근'], { main: true, note: '고기 · 한약재 600 g', hero: 'g' }),
  M('geunveg', '근(채소)', '근 (채소)', '375', ['근(채소)', '근 (채소)', '채소 근', '근(과일)', '근 (과일)', '~근'], { note: '채소 · 과일 375 g (100돈)', hero: 'g' }),
  M('don', '돈', '돈', '3.75', ['돈', '돈쭝'], { main: true, note: '금 · 은 3.75 g', hero: 'g' }),
  M('nyang', '냥', '냥', '37.5', ['냥', '兩'], { note: '10돈 = 37.5 g', hero: 'g' }),
  M('gwan', '관', '관', '3750', ['관', '貫'], { note: '1000돈 = 3.75 kg', hero: 'kg' }),

  // ── 부피 (기준 mL) ──
  V('mL', 'mL', '밀리리터', '1', ['ml', '밀리리터', '미리리터', 'milliliter', 'millilitre'], { main: true, hero: 'floz' }),
  V('cc', 'cc', '시시', '1', ['cc', '시시'], { note: '1 cc = 1 mL', hero: 'mL' }),
  V('dL', 'dL', '데시리터', '100', ['dl', '데시리터']),
  V('L', 'L', '리터', '1000', ['l', '리터', 'liter', 'liters', 'litre', 'litres'], { main: true, hero: 'usgal' }),
  V('m3', 'm³', '세제곱미터', e(6), ['m3', '세제곱미터', '입방미터', '루베', 'cbm'], { main: true, note: '1000 L', hero: 'L' }),
  V('tsp', '작은술', '작은술', '5', ['작은술', '티스푼', 'tsp', 'teaspoon', 'teaspoons'], { note: '5 mL', hero: 'mL' }),
  V('tbsp', '큰술', '큰술', '15', ['큰술', '밥숟가락', '테이블스푼', 'tbsp', 'tablespoon', 'tablespoons'], { note: '15 mL', hero: 'mL' }),
  V('cup', '컵', '컵 (한국)', '200', ['컵', '계량컵'], { main: true, note: '한국 요리책 계량컵 200 mL', hero: 'mL' }),
  V('uscup', 'US cup', '컵 (미국)', '236.5882365', ['us cup', 'cup (us)', 'cup', 'cups', '미국 컵', '컵 (미국)', '컵(미국)', '~컵'], { note: '8 US fl oz ≈ 236.6 mL', hero: 'mL' }),
  V('floz', 'fl oz', '액량 온스 (미국)', '29.5735295625', ['fl oz', 'floz', 'fl. oz', 'fl.oz', 'us fl oz', '액량 온스', '액량온스'], { main: true, hero: 'mL' }),
  V('ukfloz', 'UK fl oz', '액량 온스 (영국)', '28.4130625', ['uk fl oz', 'imp fl oz', '영국 액량 온스', '~fl oz'], { hero: 'mL' }),
  V('uspint', 'US pint', '파인트 (미국)', '473.176473', ['us pint', 'pint', 'pints', '파인트', '미국 파인트'], { hero: 'mL' }),
  V('ukpint', 'UK pint', '파인트 (영국)', '568.26125', ['uk pint', 'imp pint', '영국 파인트', '~pint'], { note: '영국 맥주 한 잔', hero: 'mL' }),
  V('usgal', 'gal', '갤런 (미국)', '3785.411784', ['gal', 'gallon', 'gallons', 'us gal', 'us gallon', '갤런', '미국 갤런'], { main: true, hero: 'L' }),
  V('ukgal', 'UK gal', '갤런 (영국)', '4546.09', ['uk gal', 'imp gal', 'uk gallon', '영국 갤런', '갤런', '~gal'], { hero: 'L' }),
  V('bbl', 'bbl', '배럴 (석유)', '158987.294928', ['bbl', '배럴', 'barrel', 'barrels'], { note: '42 US gal ≈ 159 L', hero: 'L' }),
  V('hop', '홉', '홉', '240100/1331', ['홉', '合'], { note: '1/10 되 ≈ 180 mL', hero: 'mL' }),
  V('doe', '되', '되', DOE, ['되', '升'], { note: '2401/1331 L ≈ 1.804 L', hero: 'L' }),
  V('mal', '말', '말', '24010000/1331', ['말', '斗'], { note: '10되 ≈ 18.04 L', hero: 'L' }),

  // ── 온도 (기준 K) ──
  T('C', '°C', '섭씨', '1', ['°c', '℃', '°', 'c', '도', '도씨', '섭씨', 'celsius', 'degc', 'deg c'], { main: true, off: '273.15', hero: 'F' }),
  T('F', '°F', '화씨', '5/9', ['°f', '℉', 'f', '화씨', 'fahrenheit', 'degf', 'deg f'], { main: true, off: '459.67', hero: 'C' }),
  T('K', 'K', '켈빈', '1', ['켈빈', 'kelvin'], { main: true, off: '0', cs: ['K'], hero: 'C' }),

  // ── 속도 (기준 m/s) ──
  S('mps', 'm/s', '미터/초', '1', ['m/s', 'mps', 'm/sec', '미터/초', '미터 매 초'], { main: true, hero: 'kmh' }),
  S('kmh', 'km/h', '킬로미터/시', '5/18', ['km/h', 'kmh', 'kph', 'km/hr', 'kmph', '킬로미터/시', '키로/시', '㎞/h'], { main: true, hero: 'mph' }),
  S('mph', 'mph', '마일/시', '0.44704', ['mph', 'mi/h', '마일/시'], { main: true, hero: 'kmh' }),
  S('kn', 'kn', '노트', '463/900', ['kn', 'kt', 'kts', 'knot', 'knots', '노트'], { main: true, note: '1해리/시', hero: 'kmh' }),
  S('fps', 'ft/s', '피트/초', '0.3048', ['ft/s', 'fps', 'ft/sec'], { hero: 'mps' }),
  S('mach', '마하', '마하', '340.294', ['마하', 'mach'], { note: '해수면 · 15°C 기준', hero: 'kmh' }),

  // ── 시간 (기준 초) ──
  Ti('ns', 'ns', '나노초', e(-9), ['ns', '나노초', 'nanosecond', 'nanoseconds']),
  Ti('us', 'μs', '마이크로초', e(-6), ['μs', 'us', '마이크로초', 'microsecond', 'microseconds']),
  Ti('ms', 'ms', '밀리초', '0.001', ['ms', '밀리초', 'millisecond', 'milliseconds', 'msec'], { main: true, hero: 's' }),
  Ti('s', '초', '초', '1', ['초', 's', 'sec', 'secs', 'second', 'seconds'], { main: true, hero: 'min' }),
  Ti('min', '분', '분', '60', ['분', 'min', 'mins', 'minute', 'minutes', '+m'], { main: true, hero: 'h' }),
  Ti('h', '시간', '시간', '3600', ['시간', 'h', 'hr', 'hrs', 'hour', 'hours'], { main: true, hero: 'min' }),
  Ti('d', '일', '일', '86400', ['일', '날', 'd', 'day', 'days'], { main: true, hero: 'h' }),
  Ti('wk', '주', '주', '604800', ['주', '주일', 'w', 'wk', 'wks', 'week', 'weeks'], { main: true, hero: 'd' }),
  Ti('mo', '개월', '개월 (평균)', '2629746', ['개월', '달', 'mo', 'month', 'months'], { note: '30.436875일', hero: 'd' }),
  Ti('yr', '년', '년 (평균)', '31556952', ['년', '해', 'y', 'yr', 'yrs', 'year', 'years'], { note: '365.2425일', hero: 'd' }),

  // ── 데이터 크기 (기준 바이트) ── 대소문자로 비트 · 바이트를 가른다
  Da('bit', 'bit', '비트', '1/8', ['bit', 'bits', '비트'], { cs: ['b'], hero: 'B' }),
  Da('B', 'B', '바이트', '1', ['byte', 'bytes', '바이트'], { cs: ['B'], main: true, hero: 'bit' }),
  Da('KB', 'KB', '킬로바이트', e(3), ['kb', 'kbyte', '킬로바이트', '키로바이트'], { cs: ['KB', 'kB'], main: true, hero: 'KiB' }),
  Da('MB', 'MB', '메가바이트', e(6), ['mb', 'mbyte', '메가바이트', '메가'], { cs: ['MB'], main: true, hero: 'MiB' }),
  Da('GB', 'GB', '기가바이트', e(9), ['gb', 'gbyte', '기가바이트', '기가'], { cs: ['GB'], main: true, hero: 'GiB' }),
  Da('TB', 'TB', '테라바이트', e(12), ['tb', 'tbyte', '테라바이트', '테라'], { cs: ['TB'], main: true, hero: 'GiB' }),
  Da('PB', 'PB', '페타바이트', e(15), ['pb', '페타바이트', '페타'], { cs: ['PB'], hero: 'PiB' }),
  Da('KiB', 'KiB', '키비바이트', '1024', ['kib', '키비바이트'], { hero: 'KB' }),
  Da('MiB', 'MiB', '메비바이트', String(1024 ** 2), ['mib', '메비바이트'], { hero: 'MB' }),
  Da('GiB', 'GiB', '기비바이트', String(1024 ** 3), ['gib', '기비바이트'], { hero: 'GB' }),
  Da('TiB', 'TiB', '테비바이트', String(1024 ** 4), ['tib', '테비바이트'], { hero: 'TB' }),
  Da('PiB', 'PiB', '페비바이트', String(1024 ** 5), ['pib', '페비바이트'], { hero: 'PB' }),
  Da('kbit', 'kbit', '킬로비트', '125', ['kbit', 'kbits', 'kb', '킬로비트'], { cs: ['Kb'], hero: 'KB' }),
  Da('Mbit', 'Mbit', '메가비트', '125000', ['mbit', 'mbits', 'mb', '메가비트'], { cs: ['Mb'], hero: 'MB' }),
  Da('Gbit', 'Gbit', '기가비트', '125000000', ['gbit', 'gbits', 'gb', '기가비트'], { cs: ['Gb'], hero: 'GB' }),

  // ── 전송 속도 (기준 비트/초) ──
  R('bps', 'bps', '비트/초', '1', ['bps', 'bit/s', 'b/s']),
  R('kbps', 'kbps', '킬로비트/초', e(3), ['kbps', 'kbit/s', 'kb/s'], { cs: ['Kbps'], hero: 'KBps' }),
  R('Mbps', 'Mbps', '메가비트/초', e(6), ['mbps', 'mbit/s', '메가비트/초'], { cs: ['Mb/s'], main: true, hero: 'MBps' }),
  R('Gbps', 'Gbps', '기가비트/초', e(9), ['gbps', 'gbit/s', '기가비트/초', '기가 인터넷'], { cs: ['Gb/s'], main: true, hero: 'MBps' }),
  R('Bps', 'B/s', '바이트/초', '8', ['byte/s', '바이트/초'], { cs: ['B/s', 'Bps'] }),
  R('KBps', 'KB/s', '킬로바이트/초', '8000', ['kbyte/s'], { cs: ['KB/s', 'kB/s', 'KBps'], hero: 'kbps' }),
  R('MBps', 'MB/s', '메가바이트/초', '8000000', ['mbyte/s', 'mb/s', '메가바이트/초'], { cs: ['MB/s', 'MBps', 'MB/S'], main: true, hero: 'Mbps' }),
  R('GBps', 'GB/s', '기가바이트/초', '8000000000', ['gbyte/s', '기가바이트/초'], { cs: ['GB/s', 'GBps'], hero: 'Gbps' }),
  R('MiBps', 'MiB/s', '메비바이트/초', '8388608', ['mib/s', 'mibps'], { hero: 'Mbps' }),

  // ── 인쇄 · 화면 (기준 인치) ──
  P('px', 'px', '픽셀', '1', ['px', '픽셀', 'pixel', 'pixels'], { dpi: true, main: true, hero: 'mmP' }),
  P('pt', 'pt', '포인트', '1/72', ['pt', '포인트', 'point', 'points'], { main: true, note: '1/72 in', hero: 'px' }),
  P('pica', 'pc', '파이카', '1/6', ['pc', 'pica', '파이카'], { note: '12 pt', hero: 'mmP' }),
  P('mmP', 'mm', '밀리미터', '1/25.4', ['mm', '밀리미터', '밀리', '미리'], { main: true, hero: 'px' }),
  P('cmP', 'cm', '센티미터', '1/2.54', ['cm', '센티미터', '센티', '센치'], { hero: 'px' }),
  P('inP', 'in', '인치', '1', ['in', 'inch', 'inches', '인치', '"', '″'], { main: true, hero: 'px' }),

  // ── 에너지 (기준 J) ──
  E('J', 'J', '줄', '1', ['j', '줄', 'joule', 'joules'], { main: true, hero: 'cal' }),
  E('kJ', 'kJ', '킬로줄', e(3), ['kj', '킬로줄', 'kilojoule', 'kilojoules'], { main: true, hero: 'kcal' }),
  E('MJ', 'MJ', '메가줄', e(6), ['mj', '메가줄'], { hero: 'kWh' }),
  E('cal', 'cal', '칼로리', '4.184', ['cal', 'calorie', 'calories', '칼로리', '열량'], { note: '열화학 칼로리 4.184 J', hero: 'J' }),
  E('kcal', 'kcal', '킬로칼로리', '4184', ['kcal', '킬로칼로리', '키로칼로리', '칼로리'], { cs: ['Cal'], main: true, note: '음식의 "칼로리"', hero: 'kJ' }),
  E('Wh', 'Wh', '와트시', '3600', ['wh', '와트시'], { hero: 'J' }),
  E('kWh', 'kWh', '킬로와트시', '3600000', ['kwh', '킬로와트시', '키로와트시'], { main: true, note: '전기 요금의 단위', hero: 'MJ' }),
  E('BTU', 'BTU', '영국 열량 단위', '1055.05585262', ['btu'], { note: '국제 증기표 BTU', hero: 'kJ' }),

  // ── 압력 (기준 Pa) ──
  Pr('Pa', 'Pa', '파스칼', '1', ['pa', '파스칼', 'pascal'], { hero: 'hPa' }),
  Pr('hPa', 'hPa', '헥토파스칼', '100', ['hpa', '헥토파스칼'], { main: true, note: '일기예보의 기압', hero: 'atm' }),
  Pr('kPa', 'kPa', '킬로파스칼', e(3), ['kpa', '킬로파스칼'], { main: true, hero: 'psi' }),
  Pr('MPa', 'MPa', '메가파스칼', e(6), ['mpa', '메가파스칼'], { hero: 'kgfcm2' }),
  Pr('bar', 'bar', '바', e(5), ['bar', '바'], { main: true, hero: 'psi' }),
  Pr('mbar', 'mbar', '밀리바', '100', ['mbar', '밀리바'], { note: '= hPa', hero: 'hPa' }),
  Pr('atm', 'atm', '기압', '101325', ['atm', '기압'], { main: true, note: '표준 대기압', hero: 'hPa' }),
  Pr('psi', 'psi', '제곱인치당 파운드', PSI, ['psi', '피에스아이'], { main: true, note: '타이어 공기압', hero: 'kPa' }),
  Pr('mmHg', 'mmHg', '수은주 밀리미터', '133.322387415', ['mmhg', '수은주밀리미터', '수은주 밀리미터'], { note: '혈압', hero: 'kPa' }),
  Pr('kgfcm2', 'kgf/cm²', '킬로그램힘/제곱센티미터', '98066.5', ['kgf/cm2', 'kg/cm2', 'kgf/㎠', 'kgf', '킬로그램힘'], { main: true, note: '수압계 · 공구', hero: 'bar' }),

  // ── 연비 (기준 km/L) ──
  F('kmL', 'km/L', '킬로미터/리터', '1', ['km/l', 'kmpl', 'km/리터', '킬로미터/리터', '키로/리터', 'km/ℓ'], { main: true, hero: 'L100' }),
  F('L100', 'L/100km', '리터/100킬로미터', '100', ['l/100km', 'l/100 km', '리터/100km'], { main: true, inv: true, hero: 'kmL' }),
  F('mpgUS', 'mpg', 'mpg (미국)', '1.609344/3.785411784', ['mpg', 'mpg (us)', 'mpg(us)', 'us mpg'], { main: true, hero: 'kmL' }),
  F('mpgUK', 'mpg (UK)', 'mpg (영국)', '1.609344/4.54609', ['mpg (uk)', 'mpg(uk)', 'uk mpg', 'imp mpg', 'mpg'], { hero: 'kmL' }),
];

export const unitById = new Map(units.map((u) => [u.id, u]));
export const catById = new Map(categories.map((c) => [c.id, c]));
export const unitsOf = (cat: CatId) => units.filter((u) => u.cat === cat);

export function unitOf(id: string): UnitDef {
  const u = unitById.get(id);
  if (!u) throw new Error(`unknown unit: ${id}`);
  return u;
}

// ── 용지 ──
export interface Paper {
  id: string;
  name: string;
  /** mm, 세로로 세운 크기 */
  w: number;
  h: number;
  group: string;
  note?: string;
}

const ISO_A: [number, number][] = [[841, 1189], [594, 841], [420, 594], [297, 420], [210, 297], [148, 210], [105, 148], [74, 105], [52, 74], [37, 52], [26, 37]];
const ISO_B: [number, number][] = [[1000, 1414], [707, 1000], [500, 707], [353, 500], [250, 353], [176, 250], [125, 176], [88, 125], [62, 88], [44, 62], [31, 44]];
const JIS_B: [number, number][] = [[1030, 1456], [728, 1030], [515, 728], [364, 515], [257, 364], [182, 257], [128, 182], [91, 128], [64, 91], [45, 64], [32, 45]];

export const papers: Paper[] = [
  ...ISO_A.map(([w, h], i) => ({ id: `A${i}`, name: `A${i}`, w, h, group: 'A (ISO)' })),
  ...JIS_B.map(([w, h], i) => ({ id: `JB${i}`, name: `B${i}`, w, h, group: 'B (JIS)', note: '한국 · 일본 문구에서 흔히 B 판이라 부르는 크기' })),
  ...ISO_B.map(([w, h], i) => ({ id: `IB${i}`, name: `B${i} (ISO)`, w, h, group: 'B (ISO)' })),
  { id: 'letter', name: 'Letter', w: 215.9, h: 279.4, group: '미국', note: '8.5 × 11 in' },
  { id: 'legal', name: 'Legal', w: 215.9, h: 355.6, group: '미국', note: '8.5 × 14 in' },
  { id: 'tabloid', name: 'Tabloid', w: 279.4, h: 431.8, group: '미국', note: '11 × 17 in' },
  { id: 'card', name: '명함', w: 50, h: 90, group: '기타', note: '한국에서 흔한 명함 크기 90 × 50 mm' },
];

export const paperById = new Map(papers.map((p) => [p.id, p]));
