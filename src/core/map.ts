import { rng } from './rng';

export const W = 480, H = 300, SEA = 0.45;
export const WATER = 0, PLAINS = 1, HIGHLANDS = 2, MOUNTAINS = 3;
export const OIL = 1, GOLD = 2, FERTILE = 3;

export interface GameMap { terrain: Uint8Array; height: Float32Array; resource: Uint8Array }

function hash(x: number, y: number, s: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function generateMap(seed: number): GameMap {
  const terrain = new Uint8Array(W * H), height = new Float32Array(W * H), resource = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let h = 0, amp = 1, f = 1 / 64, tot = 0;
    for (let o = 0; o < 5; o++) { h += noise(x * f, y * f, seed + o * 1013) * amp; tot += amp; amp *= 0.5; f *= 2; }
    h = (h / tot - 0.5) * 1.8 + 0.5;
    const edge = Math.max(Math.abs((x / W) * 2 - 1), Math.abs((y / H) * 2 - 1));
    h -= Math.max(0, edge - 0.7) * 2;
    const i = y * W + x;
    height[i] = h;
    terrain[i] = h < SEA ? WATER : h < 0.6 ? PLAINS : h < 0.72 ? HIGHLANDS : MOUNTAINS;
  }
  const r = rng(seed ^ 0x9e3779b9);
  for (let i = 0; i < W * H; i++) {
    if (terrain[i] === WATER || r() > 0.0012) continue;
    const kind = terrain[i] === PLAINS ? (r() < 0.5 ? OIL : FERTILE) : GOLD;
    const cx = i % W, cy = (i / W) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx, y = cy + dy, j = y * W + x;
      if (dx * dx + dy * dy <= 4 && x >= 0 && y >= 0 && x < W && y < H && terrain[j] !== WATER) resource[j] = kind;
    }
  }
  return { terrain, height, resource };
}
