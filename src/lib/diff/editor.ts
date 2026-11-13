// 비교 편집기(CodeMirror)에 얹는 장식: 바뀐 줄 색, 줄을 맞추는 빈 자리, 접힌 같은 부분.
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

/** 한 줄 높이(px). 줄 · 빈 자리 · 접힌 줄 모두 이 배수라 양쪽 높이가 맞는다. */
export const H = 20;

export const setDeco = StateEffect.define<DecorationSet>();

export const decoField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setDeco)) return e.value;
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** 반대쪽에만 있는 줄 수만큼 비워 두는 자리 */
export class Spacer extends WidgetType {
  n: number;
  constructor(n: number) {
    super();
    this.n = n;
  }
  eq(o: Spacer) {
    return o.n === this.n;
  }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-spacer';
    el.style.height = `${this.n * H}px`;
    return el;
  }
  get estimatedHeight() {
    return this.n * H;
  }
}

/** 접힌 같은 부분. 누르면 펼친다. */
export class Fold extends WidgetType {
  key: number;
  count: number;
  onExpand: (key: number) => void;
  constructor(key: number, count: number, onExpand: (key: number) => void) {
    super();
    this.key = key;
    this.count = count;
    this.onExpand = onExpand;
  }
  eq(o: Fold) {
    return o.key === this.key && o.count === this.count;
  }
  toDOM() {
    const el = document.createElement('button');
    el.className = 'cm-fold';
    el.type = 'button';
    el.textContent = `같은 내용 ${this.count.toLocaleString('ko-KR')}줄 펼치기`;
    el.onclick = () => this.onExpand(this.key);
    return el;
  }
  get estimatedHeight() {
    return H;
  }
  ignoreEvent() {
    return true;
  }
}
