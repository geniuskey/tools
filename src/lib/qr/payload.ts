// QR 에 담는 내용의 형식들. 휴대폰 카메라가 알아보는 표준 표기를 만든다.

export interface Wifi {
  ssid: string;
  password: string;
  security: 'WPA' | 'WEP' | 'nopass';
  hidden: boolean;
}

// \ ; , : " 는 앞에 \ 를 붙인다
const wifiEsc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');

export function wifiPayload(w: Wifi): string {
  if (!w.ssid) return '';
  const pass = w.security === 'nopass' ? '' : `P:${wifiEsc(w.password)};`;
  return `WIFI:T:${w.security};S:${wifiEsc(w.ssid)};${pass}${w.hidden ? 'H:true;' : ''};`;
}

export interface Contact {
  name: string;
  phone: string;
  email: string;
  org: string;
  title: string;
  url: string;
}

const vEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

export function contactPayload(c: Contact): string {
  if (!c.name.trim() && !c.phone.trim() && !c.email.trim()) return '';
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  const name = c.name.trim();
  if (name) lines.push(`N:${vEsc(name)};;;;`, `FN:${vEsc(name)}`);
  if (c.org.trim()) lines.push(`ORG:${vEsc(c.org.trim())}`);
  if (c.title.trim()) lines.push(`TITLE:${vEsc(c.title.trim())}`);
  if (c.phone.trim()) lines.push(`TEL;TYPE=CELL:${c.phone.trim()}`);
  if (c.email.trim()) lines.push(`EMAIL:${c.email.trim()}`);
  if (c.url.trim()) lines.push(`URL:${c.url.trim()}`);
  lines.push('END:VCARD');
  return lines.join('\n');
}

export function emailPayload(to: string, subject: string, body: string): string {
  if (!to.trim()) return '';
  const q = [subject && `subject=${encodeURIComponent(subject)}`, body && `body=${encodeURIComponent(body)}`].filter(Boolean).join('&');
  return `mailto:${to.trim()}${q ? `?${q}` : ''}`;
}

export function smsPayload(phone: string, message: string): string {
  const p = phone.replace(/[^\d+]/g, '');
  if (!p) return '';
  return message ? `SMSTO:${p}:${message}` : `tel:${p}`;
}

/** 주소처럼 보이는데 앞머리가 없으면 https:// 를 붙인다 */
export function linkPayload(text: string): string {
  const t = text.trim();
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t) && !t.includes('@')) return `https://${t}`;
  return t;
}
