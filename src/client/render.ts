import { DAY, Game, NIGHT_START } from '../core/game';
import { FERTILE, GOLD, H, HIGHLANDS, OIL, PLAINS, W, WATER } from '../core/map';

const ICON: Record<string, string> = { city: 'C', port: 'P', defense: 'D', silo: 'S' };

export const fmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.floor(n)));

export class Renderer {
  ctx: CanvasRenderingContext2D;
  off = document.createElement('canvas');
  offCtx: CanvasRenderingContext2D;
  img = new ImageData(W, H);
  base = new Uint8ClampedArray(W * H * 3);
  version = -1;
  scale = 1;
  ox = 0;
  oy = 0;

  constructor(public canvas: HTMLCanvasElement, public g: Game, public me: number) {
    this.ctx = canvas.getContext('2d')!;
    this.off.width = W;
    this.off.height = H;
    this.offCtx = this.off.getContext('2d')!;
    this.resize();
    this.scale = Math.min(canvas.width / W, canvas.height / H);
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
    const s = Math.min(40, Math.max(0.5, this.scale * f));
    this.ox = sx - ((sx - this.ox) * s) / this.scale;
    this.oy = sy - ((sy - this.oy) * s) / this.scale;
    this.scale = s;
  }

  buildBase() {
    const { terrain, height, resource } = this.g.map;
    for (let i = 0; i < W * H; i++) {
      const h = height[i], t = terrain[i], r = resource[i];
      let c = t === WATER ? [20 + h * 60, 60 + h * 120, 130 + h * 120]
        : t === PLAINS ? [100 + h * 40, 160 + h * 30, 80]
        : t === HIGHLANDS ? [150, 145, 95]
        : [150 + h * 60, 145 + h * 60, 140 + h * 60];
      if (r === OIL) c = [45, 40, 50];
      else if (r === GOLD) c = [235, 195, 50];
      else if (r === FERTILE) c = [90, 220, 60];
      this.base.set(c, i * 3);
    }
    this.version = this.g.terrainVersion;
  }

  draw() {
    const g = this.g, ctx = this.ctx, o = g.owner, d = this.img.data, b = this.base;
    if (this.version !== g.terrainVersion) this.buildBase();
    const cs = g.players.map(() => ({ x: 0, y: 0, n: 0 }));
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
      const id = o[i];
      let r = b[i * 3], gg = b[i * 3 + 1], bb = b[i * 3 + 2];
      if (id) {
        const c = g.players[id - 1].color, cc = cs[id - 1];
        cc.x += x; cc.y += y; cc.n++;
        const edge = (x > 0 && o[i - 1] !== id) || (x < W - 1 && o[i + 1] !== id) || (y > 0 && o[i - W] !== id) || (y < H - 1 && o[i + W] !== id);
        if (edge) { r = c[0] * 0.6; gg = c[1] * 0.6; bb = c[2] * 0.6; }
        else { r = r * 0.4 + c[0] * 0.6; gg = gg * 0.4 + c[1] * 0.6; bb = bb * 0.4 + c[2] * 0.6; }
      }
      d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = bb; d[i * 4 + 3] = 255;
    }
    this.offCtx.putImageData(this.img, 0, 0);

    const cw = this.canvas.width, ch = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b1830';
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
    ctx.drawImage(this.off, 0, 0);

    ctx.fillStyle = 'rgba(140,150,175,0.35)';
    for (const s of g.storms) { ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 2.4px sans-serif';
    ctx.lineWidth = 0.3;
    ctx.strokeStyle = '#000';
    for (const s of g.structures.values()) {
      const x = (s.tile % W) + 0.5, y = ((s.tile / W) | 0) + 0.5;
      ctx.fillStyle = s.disabledUntil > g.tick ? '#666' : `rgb(${g.pl(s.owner).color})`;
      ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);
      ctx.strokeRect(x - 1.6, y - 1.6, 3.2, 3.2);
      ctx.fillStyle = '#fff';
      ctx.fillText(ICON[s.type], x, y + 0.1);
    }

    for (const bt of g.boats) {
      const t = bt.path[bt.pos];
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = `rgb(${g.pl(bt.p).color})`;
      ctx.beginPath(); ctx.arc((t % W) + 0.5, ((t / W) | 0) + 0.5, 1.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    for (const n of g.nukes) {
      const k = (g.tick - n.launch) / (n.impact - n.launch);
      const fx = n.from % W, fy = (n.from / W) | 0, tx = n.to % W, ty = (n.to / W) | 0;
      ctx.strokeStyle = 'rgba(255,60,60,0.8)';
      ctx.beginPath(); ctx.arc(tx, ty, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ff3';
      ctx.beginPath(); ctx.arc(fx + (tx - fx) * k, fy + (ty - fy) * k, 1.5, 0, Math.PI * 2); ctx.fill();
    }

    ctx.strokeStyle = '#000';
    for (const p of g.players) {
      const c = cs[p.id - 1];
      if (!p.alive || c.n < 5) continue;
      const size = Math.max(1.5, Math.sqrt(c.n) / 5), x = c.x / c.n + 0.5, y = c.y / c.n + 0.5;
      ctx.font = `bold ${size}px sans-serif`;
      ctx.lineWidth = size / 5;
      const label = g.bounties.some(bn => bn.target === p.id) ? `🎯 ${p.name}` : p.name;
      ctx.strokeText(label, x, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x, y);
      const troops = g.canSee(this.me, p.id) ? fmt(p.troops) : '?';
      ctx.font = `${size * 0.8}px sans-serif`;
      ctx.strokeText(troops, x, y + size);
      ctx.fillText(troops, x, y + size);
    }

    for (const e of g.emojis) {
      const c = cs[e.target - 1];
      if (!c?.n) continue;
      ctx.font = '8px sans-serif';
      ctx.fillText(e.emoji, c.x / c.n, c.y / c.n - 6 - (g.tick - e.tick) * 0.1);
    }

    const t = g.tick % DAY;
    const a = t >= NIGHT_START ? 0.4 * Math.min(1, (t - NIGHT_START) / 60, (DAY - t) / 60) : 0;
    if (a > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(5,10,40,${a})`;
      ctx.fillRect(0, 0, cw, ch);
    }
  }
}
