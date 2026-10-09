import { DAY, Game, neighbors, NIGHT_START, NUKE_R } from '../core/game';
import { FERTILE, GOLD, H, HIGHLANDS, MOUNTAINS, OIL, PLAINS, SEA, W, WATER } from '../core/map';
import { TICK_MS } from '../core/types';

const ICON: Record<string, string> = { city: '🏠', port: '⚓', defense: '🛡', silo: '🚀', sam: '📡' };

export const fmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.floor(n)));

export class Renderer {
  ctx: CanvasRenderingContext2D;
  off = document.createElement('canvas');
  offCtx: CanvasRenderingContext2D;
  img = new ImageData(W, H);
  base = new Uint8ClampedArray(W * H * 3);
  version = -1;
  scale = 1;
  target = 1;
  ox = 0;
  oy = 0;
  ax = 0;
  ay = 0;
  hover = 0;
  stepAt = 0;

  constructor(public canvas: HTMLCanvasElement, public g: Game, public me: number) {
    this.ctx = canvas.getContext('2d')!;
    this.off.width = W;
    this.off.height = H;
    this.offCtx = this.off.getContext('2d')!;
    this.resize();
    this.scale = this.target = Math.min(canvas.width / W, canvas.height / H);
    this.ox = (canvas.width - W * this.scale) / 2;
    this.oy = (canvas.height - H * this.scale) / 2;
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.canvas.width = innerWidth;
    this.canvas.height = innerHeight;
  }

  toTile(sx: number, sy: number) {
    return [Math.floor((sx - this.ox) / this.scale), Math.floor((sy - this.oy) / this.scale)];
  }

  zoom(sx: number, sy: number, f: number) {
    this.target = Math.min(40, Math.max(0.5, this.target * f));
    this.ax = sx;
    this.ay = sy;
  }

  sx(i: number) { return this.ox + ((i % W) + 0.5) * this.scale; }
  sy(i: number) { return this.oy + (((i / W) | 0) + 0.5) * this.scale; }

  buildBase() {
    const { terrain, height, resource } = this.g.map;
    for (let i = 0; i < W * H; i++) {
      const h = height[i], t = terrain[i], r = resource[i], x = i % W, y = (i / W) | 0;
      const shore = neighbors(i).some(n => (terrain[n] === WATER) !== (t === WATER));
      let c: number[];
      if (t === WATER) {
        const k = Math.max(0, h) / SEA;
        c = shore ? [70, 140, 185] : [15 + 45 * k, 40 + 85 * k, 90 + 95 * k];
      } else {
        c = t === PLAINS ? [96, 150, 72] : t === HIGHLANDS ? [140, 132, 88] : h > 0.85 ? [235, 235, 240] : [150, 144, 138];
        if (shore && t === PLAINS) c = [205, 192, 135];
        if (r === OIL) c = [45, 40, 50];
        else if (r === GOLD) c = [235, 195, 60];
        else if (r === FERTILE) c = [120, 215, 70];
        if (r) c = c.map(v => v * ((x + y) % 2 ? 1 : 0.82));
        const shade = 1 + (h - (x > 0 && y > 0 ? height[i - W - 1] : h)) * (t === MOUNTAINS ? 14 : 8);
        c = c.map(v => v * shade);
      }
      this.base.set(c, i * 3);
    }
    this.version = this.g.terrainVersion;
  }

  draw() {
    const g = this.g, ctx = this.ctx, o = g.owner, d = this.img.data, b = this.base;
    if (Math.abs(this.target - this.scale) > 1e-3) {
      const s = this.scale + (this.target - this.scale) * 0.25;
      this.ox = this.ax - ((this.ax - this.ox) * s) / this.scale;
      this.oy = this.ay - ((this.ay - this.oy) * s) / this.scale;
      this.scale = s;
    }
    if (this.version !== g.terrainVersion) this.buildBase();
    const cs = g.players.map(() => ({ x: 0, y: 0, n: 0 }));
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
      const id = o[i];
      let r = b[i * 3], gg = b[i * 3 + 1], bb = b[i * 3 + 2];
      if (id) {
        const c = g.players[id - 1].color, cc = cs[id - 1];
        cc.x += x; cc.y += y; cc.n++;
        const edge = (x > 0 && o[i - 1] !== id) || (x < W - 1 && o[i + 1] !== id) || (y > 0 && o[i - W] !== id) || (y < H - 1 && o[i + W] !== id);
        if (edge && id === this.hover) { r = 255 - (255 - c[0]) * 0.3; gg = 255 - (255 - c[1]) * 0.3; bb = 255 - (255 - c[2]) * 0.3; }
        else if (edge) { r = c[0] * 0.5; gg = c[1] * 0.5; bb = c[2] * 0.5; }
        else { r = r * 0.45 + c[0] * 0.55; gg = gg * 0.45 + c[1] * 0.55; bb = bb * 0.45 + c[2] * 0.55; }
      }
      d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = bb; d[i * 4 + 3] = 255;
    }
    this.offCtx.putImageData(this.img, 0, 0);

    const cw = this.canvas.width, ch = this.canvas.height, sc = this.scale;
    const alpha = Math.min(1, (performance.now() - this.stepAt) / TICK_MS);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#081226';
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, this.ox, this.oy, W * sc, H * sc);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    for (const s of g.storms) {
      const x = this.ox + s.x * sc, y = this.oy + s.y * sc, R = s.r * sc;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, R);
      const flash = Math.random() < 0.01 ? 0.3 : 0;
      grad.addColorStop(0, `rgba(${60 + flash * 500},${70 + flash * 500},${100 + flash * 400},0.55)`);
      grad.addColorStop(0.7, 'rgba(80,90,120,0.35)');
      grad.addColorStop(1, 'rgba(80,90,120,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    }

    const t = g.tick % DAY;
    const night = t >= NIGHT_START ? 0.45 * Math.min(1, (t - NIGHT_START) / 60, (DAY - t) / 60) : 0;
    if (night > 0) {
      ctx.fillStyle = `rgba(5,10,45,${night})`;
      ctx.fillRect(0, 0, cw, ch);
      for (const s of g.structures.values()) {
        if (s.type !== 'city') continue;
        const x = this.sx(s.tile), y = this.sy(s.tile), R = 8 * sc;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, R);
        grad.addColorStop(0, `rgba(255,220,120,${night})`);
        grad.addColorStop(1, 'rgba(255,220,120,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(x - R, y - R, 2 * R, 2 * R);
      }
    }

    const icon = Math.min(30, Math.max(10, sc * 3.2));
    for (const s of g.structures.values()) {
      const x = this.sx(s.tile), y = this.sy(s.tile);
      ctx.globalAlpha = s.readyAt > g.tick ? 0.55 : 1;
      ctx.fillStyle = g.active(s) ? `rgb(${g.pl(s.owner).color})` : '#555';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, icon / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = `${icon * 0.6}px sans-serif`;
      ctx.fillText(ICON[s.type], x, y + 1);
      if (!g.active(s)) {
        ctx.strokeStyle = '#f33';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - icon / 2, y - icon / 2); ctx.lineTo(x + icon / 2, y + icon / 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    const ship = Math.min(16, Math.max(5, sc * 2));
    for (const s of g.ships) {
      if (s.done) continue;
      const nxt = s.path[Math.min(s.pos + 1, s.path.length - 1)] ?? s.tile;
      const x = this.sx(s.tile) + (this.sx(nxt) - this.sx(s.tile)) * alpha;
      const y = this.sy(s.tile) + (this.sy(nxt) - this.sy(s.tile)) * alpha;
      ctx.fillStyle = s.kind === 'trade' ? '#f2c94c' : s.kind === 'war' ? '#3a3f4a' : '#fff';
      ctx.strokeStyle = `rgb(${g.pl(s.p).color})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (s.kind === 'war') { ctx.moveTo(x, y - ship); ctx.lineTo(x + ship * 0.7, y + ship * 0.6); ctx.lineTo(x - ship * 0.7, y + ship * 0.6); ctx.closePath(); }
      else ctx.ellipse(x, y, ship * 0.8, ship * 0.45, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      if (s.kind === 'war' && s.hp < 100) {
        ctx.fillStyle = '#e33'; ctx.fillRect(x - ship, y + ship, ship * 2, 3);
        ctx.fillStyle = '#3e3'; ctx.fillRect(x - ship, y + ship, (ship * 2 * s.hp) / 100, 3);
      }
      if (s.kind === 'transport' && sc > 2 && g.canSee(this.me, s.p)) {
        ctx.font = 'bold 11px sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(fmt(s.value), x, y - ship - 4);
      }
    }

    for (const n of g.nukes) {
      const fx = this.sx(n.from), fy = this.sy(n.from), tx = this.sx(n.to), ty = this.sy(n.to);
      const k = Math.min(1, (g.tick - n.launch + alpha) / (n.impact - n.launch)), lift = Math.hypot(tx - fx, ty - fy) * 0.3;
      const at = (q: number) => [fx + (tx - fx) * q, fy + (ty - fy) * q - Math.sin(Math.PI * q) * lift];
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(255,60,60,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(tx, ty, NUKE_R * sc, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,200,80,0.7)';
      ctx.beginPath();
      for (let q = 0; q <= k; q += 0.02) { const [x, y] = at(q); q ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      const [hx, hy] = at(k);
      ctx.fillStyle = '#ffec6e';
      ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2); ctx.fill();
    }

    for (const bl of g.blasts) {
      const age = (g.tick - bl.tick + alpha) / 20, x = this.sx(bl.tile), y = this.sy(bl.tile);
      const R = (bl.intercepted ? 4 : NUKE_R) * sc * Math.min(1, age * 3 + 0.2);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, R);
      grad.addColorStop(0, bl.intercepted ? `rgba(200,230,255,${1 - age})` : `rgba(255,255,220,${1 - age})`);
      grad.addColorStop(0.5, bl.intercepted ? `rgba(120,180,255,${(1 - age) * 0.7})` : `rgba(255,140,40,${(1 - age) * 0.8})`);
      grad.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    }

    ctx.strokeStyle = '#000';
    for (const p of g.players) {
      const c = cs[p.id - 1];
      if (!p.alive || !c.n) continue;
      const size = Math.min(48, Math.sqrt(c.n) * sc * 0.22);
      if (size < 7) continue;
      const x = this.ox + (c.x / c.n + 0.5) * sc, y = this.oy + (c.y / c.n + 0.5) * sc;
      const label = (g.bounties.some(bn => bn.target === p.id) ? '🎯 ' : '') + p.name;
      ctx.font = `bold ${size}px sans-serif`;
      ctx.lineWidth = size / 5;
      ctx.fillStyle = p.id === this.me ? '#ffd34d' : g.allied(this.me, p.id) ? '#9ef' : '#fff';
      ctx.strokeText(label, x, y);
      ctx.fillText(label, x, y);
      const troops = g.canSee(this.me, p.id) ? fmt(p.troops) : '?';
      ctx.font = `${size * 0.75}px sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.strokeText(troops, x, y + size * 0.9);
      ctx.fillText(troops, x, y + size * 0.9);
    }

    ctx.font = '26px sans-serif';
    for (const e of g.emojis) {
      const c = cs[e.target - 1];
      if (!c?.n) continue;
      ctx.globalAlpha = 1 - (g.tick - e.tick) / 50;
      ctx.fillText(e.emoji, this.ox + (c.x / c.n) * sc, this.oy + (c.y / c.n) * sc - 30 - (g.tick - e.tick));
    }
    ctx.globalAlpha = 1;
  }
}
