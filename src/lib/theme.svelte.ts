// 테마: 시스템을 따르되, 사용자가 고르면 그 선택을 기억한다.
export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'tools:theme';

class Theme {
  choice = $state<ThemeChoice>('system');

  init() {
    try {
      const v = localStorage.getItem(KEY);
      if (v === 'light' || v === 'dark') this.choice = v;
    } catch {}
    this.apply();
  }

  get resolved(): 'light' | 'dark' {
    if (this.choice !== 'system') return this.choice;
    if (typeof matchMedia === 'undefined') return 'light';
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  toggle() {
    this.choice = this.resolved === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, this.choice);
    } catch {}
    this.apply();
  }

  private apply() {
    const el = document.documentElement;
    if (this.choice === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', this.choice);
  }
}

export const theme = new Theme();
