import { clampRatio } from './attack';
import {
  COSTS, MAX_TRADE_SHIPS, MAX_TRANSPORTS, NAVAL_SPEED, NAVAL_TROOPS, NUKE_DELAY, NUKE_R, NUKE_SPEED, NUKE_TROOP_LOSS, PATROL_R, SAM_COOLDOWN,
  SAM_R, SILO_COOLDOWN, TRADE_BASE, TRADE_EVERY, TRADE_PER_TILE, WARSHIP_DAMAGE, WARSHIP_HP, WARSHIP_REACH2, WARSHIP_SIGHT2,
} from './config';
import { unally } from './diplomacy';
import type { Game, Nuke, Player, Ship, Structure } from './game';
import { dist2, H, neighbors, W } from './map';

// BFS over water from the tiles next to `to`; the returned path runs from the goal tile to `to`.
export function waterPath(g: Game, to: number, goal: (w: number) => boolean) {
  const prev = new Int32Array(W * H).fill(-2), q: number[] = [];
  for (const n of neighbors(to)) if (!g.isLand(n)) { prev[n] = -1; q.push(n); }
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (goal(c)) {
      const path: number[] = [];
      for (let x = c; x !== -1; x = prev[x]) path.push(x);
      return path;
    }
    for (const n of neighbors(c)) if (!g.isLand(n) && prev[n] === -2) { prev[n] = c; q.push(n); }
  }
  return null;
}

export const routeTo = (g: Game, id: number, dest: number) => waterPath(g, dest, w => neighbors(w).some(n => g.owner[n] === id));

function tradePath(g: Game, from: number, to: number) {
  const key = `${from}>${to}`;
  if (!g.pathCache.has(key)) g.pathCache.set(key, waterPath(g, to, w => neighbors(w).includes(from)));
  return g.pathCache.get(key) ?? null;
}

const shipCount = (g: Game, kind: Ship['kind'], p: number) => g.ships.filter(s => s.kind === kind && s.p === p).length;

export function boat(g: Game, p: Player, x: number, y: number, ratio: number) {
  const dest = g.tileAt(x, y);
  if (dest < 0 || !g.isCoastal(dest) || !g.hostile(p.id, g.owner[dest]) || shipCount(g, 'transport', p.id) >= MAX_TRANSPORTS) return;
  const path = routeTo(g, p.id, dest);
  if (!path) return;
  const troops = p.troops * clampRatio(ratio);
  p.troops -= troops;
  g.ships.push({ kind: 'transport', p: p.id, tile: path[0], path, pos: 0, value: troops * (p.doctrine === 'naval' ? NAVAL_TROOPS : 1), dest, home: 0, hp: 0 });
}

export function buildWarship(g: Game, p: Player, near: number, cost: number) {
  let port: Structure | undefined, bd = Infinity;
  for (const s of g.structures.values()) {
    const d = dist2(s.tile, near);
    if (s.type === 'port' && s.owner === p.id && g.active(s) && d < bd) { bd = d; port = s; }
  }
  const w = port && neighbors(port.tile).find(n => !g.isLand(n));
  if (!port || w === undefined) return;
  p.gold -= cost;
  g.ships.push({ kind: 'war', p: p.id, tile: w, path: [], pos: 0, value: 0, dest: w, home: port.tile, hp: WARSHIP_HP });
}

export function stepShips(g: Game) {
  spawnTrade(g);
  for (const s of g.ships) {
    if (s.done) continue;
    if (s.kind === 'war') { stepWarship(g, s); continue; }
    const speed = s.kind === 'transport' && g.pl(s.p).doctrine === 'naval' ? NAVAL_SPEED : 1;
    for (let k = 0; k < speed && s.pos < s.path.length - 1; k++) {
      if (g.inStorm(s.path[s.pos + 1])) break;
      s.pos++;
    }
    s.tile = s.path[s.pos];
    if (s.pos >= s.path.length - 1) { s.done = true; arrive(g, s); }
  }
  g.ships = g.ships.filter(s => !s.done && g.pl(s.p).alive);
}

function spawnTrade(g: Game) {
  let ports: Structure[] | null = null;
  for (const s of g.structures.values()) {
    if (s.type !== 'port' || !g.active(s) || (g.tick + s.tile) % TRADE_EVERY || shipCount(g, 'trade', s.owner) >= MAX_TRADE_SHIPS) continue;
    ports ??= [...g.structures.values()].filter(d => d.type === 'port' && g.active(d));
    const dests = ports.filter(d => g.tradeOk(s.owner, d.owner));
    if (!dests.length) continue;
    const d = dests[Math.floor(g.rand() * dests.length)];
    const path = tradePath(g, s.tile, d.tile);
    if (path) g.ships.push({ kind: 'trade', p: s.owner, tile: path[0], path, pos: 0, value: TRADE_BASE + path.length * TRADE_PER_TILE, dest: d.tile, home: s.tile, hp: 0 });
  }
}

function arrive(g: Game, s: Ship) {
  const p = g.pl(s.p);
  if (s.kind === 'trade') {
    const port = g.structures.get(s.dest);
    if (port?.type !== 'port' || !g.tradeOk(s.p, port.owner)) return;
    const o = g.pl(port.owner);
    p.gold += s.value * g.goldMult(p);
    o.gold += s.value * g.goldMult(o);
    return;
  }
  const t = g.owner[s.dest];
  if (!g.isLand(s.dest) || !g.hostile(s.p, t)) p.troops += s.value;
  else g.attacks.push({ p: s.p, target: t, troops: s.value, queue: [s.dest], head: 0 });
}

function stepWarship(g: Game, w: Ship) {
  let prey: Ship | undefined, pd = WARSHIP_SIGHT2 + 1;
  for (const o of g.ships) {
    if (o.done || o === w || !g.hostile(w.p, o.p)) continue;
    const d = dist2(o.tile, w.tile);
    if (d < pd) { pd = d; prey = o; }
  }
  if (prey && pd <= WARSHIP_REACH2) return strike(g, w, prey);
  if (prey) w.dest = prey.tile;
  else if (w.tile === w.dest) w.dest = patrolTile(g, w.home);
  let next = -1, nd = dist2(w.tile, w.dest);
  for (const n of neighbors(w.tile)) {
    const d = dist2(n, w.dest);
    if (!g.isLand(n) && !g.inStorm(n) && d < nd) { nd = d; next = n; }
  }
  if (next >= 0) w.tile = next;
  else w.dest = patrolTile(g, w.home);
}

function strike(g: Game, w: Ship, prey: Ship) {
  const name = g.pl(w.p).name;
  if (prey.kind === 'war') {
    prey.hp -= WARSHIP_DAMAGE;
    if (prey.hp > 0) return;
    prey.done = true;
    g.event(`⚓ Your warship was sunk by ${name}`, prey.p);
  } else if (prey.kind === 'trade') {
    prey.done = true;
    g.pl(w.p).gold += prey.value;
    g.event(`⚓ Your warship captured a trade ship (+${Math.floor(prey.value)} gold)`, w.p);
  } else {
    prey.done = true;
    g.event(`⚓ Your transport was sunk by ${name}`, prey.p);
  }
}

function patrolTile(g: Game, home: number) {
  const hx = home % W, hy = (home / W) | 0;
  for (let t = 0; t < 20; t++) {
    const i = g.tileAt(hx + Math.floor((g.rand() * 2 - 1) * PATROL_R), hy + Math.floor((g.rand() * 2 - 1) * PATROL_R));
    if (i >= 0 && !g.isLand(i)) return i;
  }
  return home;
}

export function nuke(g: Game, p: Player, x: number, y: number) {
  const to = g.tileAt(x, y), silo = g.readySilo(p.id);
  if (to < 0 || !silo || p.gold < COSTS.nuke) return;
  p.gold -= COSTS.nuke;
  silo.readyAt = g.tick + SILO_COOLDOWN;
  g.nukes.push({ p: p.id, from: silo.tile, to, launch: g.tick, impact: g.tick + NUKE_DELAY + Math.floor(Math.sqrt(dist2(silo.tile, to)) / NUKE_SPEED) });
  g.event(`☢ ${p.name} launched a nuke!`);
}

export function stepNukes(g: Game) {
  for (const n of g.nukes) if (n.impact === g.tick) detonate(g, n);
  g.nukes = g.nukes.filter(n => n.impact > g.tick);
}

function detonate(g: Game, n: Nuke) {
  const sam = [...g.structures.values()].find(s =>
    s.type === 'sam' && g.active(s) && s.readyAt <= g.tick && g.hostile(n.p, s.owner) && dist2(s.tile, n.to) <= SAM_R * SAM_R);
  g.blasts.push({ tile: n.to, tick: g.tick, intercepted: !!sam });
  if (sam) {
    sam.readyAt = g.tick + SAM_COOLDOWN;
    g.event(`📡 ${g.pl(sam.owner).name}'s SAM intercepted a nuke`);
    return;
  }
  const cx = n.to % W, cy = (n.to / W) | 0, lost = new Map<number, number>();
  for (let dy = -NUKE_R; dy <= NUKE_R; dy++) for (let dx = -NUKE_R; dx <= NUKE_R; dx++) {
    const j = g.tileAt(cx + dx, cy + dy);
    if (j < 0 || dx * dx + dy * dy > NUKE_R * NUKE_R) continue;
    const o = g.owner[j];
    if (o && o !== n.p) { g.setOwner(j, 0); lost.set(o, (lost.get(o) ?? 0) + 1); }
  }
  for (const s of g.ships) if (s.p !== n.p && dist2(s.tile, n.to) <= NUKE_R * NUKE_R) s.done = true;
  const p = g.pl(n.p);
  for (const [o, c] of lost) {
    const v = g.pl(o);
    v.troops *= Math.max(0, 1 - (NUKE_TROOP_LOSS * c) / (v.tiles + c));
    if (g.allied(p.id, o)) unally(g, p, v);
  }
}
