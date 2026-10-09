import { SPAWN_TICKS } from '../core/config';
import { Ctx, doAttack, spawn, useMode } from './actions';
import { $ } from './dom';
import { MODES, openMenu, setMode, setRatio } from './ui';

const DRAG_PX = 5, ZOOM_STEP = 1.2, RATIO_STEP = 0.05;

function click(c: Ctx, i: number) {
  if (i < 0) return;
  if (c.g.tick < SPAWN_TICKS) return spawn(c, i);
  if (!c.p.alive) return;
  const m = c.mode;
  if (!m) return doAttack(c, i);
  setMode(c, null);
  useMode(c, m, i);
}

export function bindInput(c: Ctx) {
  const { g, r } = c, canvas = r.canvas, menu = $('ctx');
  const tileOf = (e: MouseEvent) => {
    const [x, y] = r.toTile(e.clientX, e.clientY);
    return g.tileAt(x, y);
  };
  let down: { x: number; y: number; moved: boolean } | null = null, lx = 0, ly = 0;

  canvas.onmousedown = e => {
    menu.classList.add('hidden');
    if (e.button === 0) { down = { x: e.clientX, y: e.clientY, moved: false }; lx = e.clientX; ly = e.clientY; }
  };
  addEventListener('mousemove', e => {
    const i = tileOf(e);
    r.hover = i >= 0 ? g.owner[i] : 0;
    if (!down) return;
    if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > DRAG_PX) down.moved = true;
    if (down.moved) { r.ox += e.clientX - lx; r.oy += e.clientY - ly; }
    lx = e.clientX;
    ly = e.clientY;
  });
  canvas.onmouseup = e => { if (down && !down.moved && e.button === 0) click(c, tileOf(e)); };
  addEventListener('mouseup', () => { down = null; });
  canvas.oncontextmenu = e => {
    e.preventDefault();
    const i = tileOf(e);
    if (i >= 0) openMenu(c, i, e.clientX, e.clientY);
  };
  canvas.addEventListener('wheel', e => {
    const d = e.deltaY || e.deltaX;
    if (e.shiftKey) setRatio(c, c.ratio + (d < 0 ? RATIO_STEP : -RATIO_STEP));
    else r.zoom(e.clientX, e.clientY, d < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  }, { passive: true });
  addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
    if (e.key === 'Escape') { setMode(c, null); menu.classList.add('hidden'); }
    const k = Number(e.key);
    if (k >= 1 && k <= MODES.length) setMode(c, c.mode === MODES[k - 1] ? null : MODES[k - 1]);
  });
}
