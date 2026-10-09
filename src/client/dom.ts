export const $ = (id: string) => document.getElementById(id)!;
export const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
export const fmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.floor(n)));

export function button(label: string, parent: HTMLElement, onclick: () => void, title = '') {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.onclick = onclick;
  parent.append(b);
  return b;
}

let toastTimer = 0;
export function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.add('hidden'), 2500);
}
