import { W, H, WATER, OIL, GOLD, FERTILE, SEA, generateMap, GameMap } from './map';
import { rng } from './rng';
import { BuildKind, COSTS, DOCTRINES, Doctrine, EMOJIS, GameConfig, Intent, STRUCTURES, StructureType } from './types';

export const SPAWN_TICKS = 100, DAY = 1200, NIGHT_START = 800, SEA_START = 4000, WIN_SHARE = 0.65;
export const NUKE_R = 12, SAM_R = 30, DEFENSE_R = 12;
const TERRAIN_COST = [0, 1.5, 2.5, 4];
const TERRAIN_SPEED = [0, 1, 1.5, 2.5];
const DOCTRINE_KEYS = Object.keys(DOCTRINES) as Doctrine[];

export interface Player {
  id: number; name: string; bot: boolean; color: [number, number, number];
  troops: number; gold: number; tiles: number; alive: boolean; spawned: boolean;
  doctrine: Doctrine; allies: number[]; embargo: number[]; oil: number; mines: number; fertile: number;
}
export interface Structure { type: StructureType; owner: number; tile: number; disabledUntil: number; readyAt: number }
export interface Attack { p: number; target: number; troops: number; queue: number[]; head: number; done?: boolean }
// value = troops for transports, gold for trade ships. dest = landing tile / destination port / patrol target.
export interface Ship { kind: 'transport' | 'trade' | 'war'; p: number; tile: number; path: number[]; pos: number; value: number; dest: number; home: number; hp: number; done?: boolean }
export interface Nuke { p: number; from: number; to: number; launch: number; impact: number }
export interface Storm { x: number; y: number; r: number; vx: number; vy: number }
export interface GameEvent { text: string; to: number; allyFrom?: number }
export interface Bounty { target: number; amount: number; captured: Map<number, number> }

export function neighbors(i: number) {
  const x = i % W, r: number[] = [];
  if (x > 0) r.push(i - 1);
  if (x < W - 1) r.push(i + 1);
  if (i >= W) r.push(i - W);
  if (i < W * (H - 1)) r.push(i + W);
  return r;
}

export const dist2 = (a: number, b: number) => {
  const dx = (a % W) - (b % W), dy = ((a / W) | 0) - ((b / W) | 0);
  return dx * dx + dy * dy;
};

const clampRatio = (r: number) => Math.min(1, Math.max(0.01, Number(r) || 0));

function color(i: number): [number, number, number] {
  const h = (i * 137.508) % 360, s = 0.7, l = 0.5;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

export class Game {
  tick = 0;
  map: GameMap;
  owner = new Uint16Array(W * H);
  players: Player[];
  structures = new Map<number, Structure>();
  attacks: Attack[] = [];
  ships: Ship[] = [];
  nukes: Nuke[] = [];
  blasts: { tile: number; tick: number; intercepted: boolean }[] = [];
  storms: Storm[] = [];
  events: GameEvent[] = [];
  eventCount = 0;
  emojis: { target: number; emoji: string; tick: number }[] = [];
  bounties: Bounty[] = [];
  spies: { by: number; target: number; until: number }[] = [];
  allyRequests = new Set<string>();
  cityCount: number[] = [];
  portCount: number[] = [];
  seaLevel = SEA;
  terrainVersion = 0;
  landTiles = 0;
  winner = 0;
  rand: () => number;

  constructor(cfg: GameConfig) {
    this.map = generateMap(cfg.seed);
    this.rand = rng(cfg.seed + 1);
    this.players = cfg.players.map((p, i) => ({
      id: i + 1, name: p.name, bot: p.bot, color: color(i), troops: 0, gold: 0, tiles: 0, alive: true, spawned: false,
      doctrine: 'blitz', allies: [], embargo: [], oil: 0, mines: 0, fertile: 0,
    }));
    for (const t of this.map.terrain) if (t !== WATER) this.landTiles++;
  }

  pl(id: number) { return this.players[id - 1]; }
  valid(id: number) { return Number.isInteger(id) && id >= 1 && id <= this.players.length; }
  tileAt(x: number, y: number) { return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < W && y < H ? y * W + x : -1; }
  isLand(i: number) { return this.map.terrain[i] !== WATER; }
  isCoastal(i: number) { return this.isLand(i) && neighbors(i).some(n => !this.isLand(n)); }
  isNight() { return this.tick % DAY >= NIGHT_START; }
  allied(a: number, b: number) { return a > 0 && this.pl(a).allies.includes(b); }
  hostile(a: number, b: number) { return a !== b && !this.allied(a, b); }
  active(s: Structure) { return s.disabledUntil <= this.tick; }
  inStorm(i: number) {
    const x = i % W, y = (i / W) | 0;
    return this.storms.some(s => (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y) < s.r * s.r);
  }
  canSee(viewer: number, t: number) {
    return viewer === t || this.allied(viewer, t) || this.spies.some(s => s.by === viewer && s.target === t);
  }
  tradeOk(a: number, b: number) { return a !== b && !this.pl(a).embargo.includes(b) && !this.pl(b).embargo.includes(a); }
  goldMult(p: Player) { return p.doctrine === 'merchant' ? 1.35 : 1; }
  maxTroops(p: Player) { return 5000 + p.tiles * 15 + p.fertile * 40 + (this.cityCount[p.id] ?? 0) * 15000; }
  goldRate(p: Player) {
    return (0.5 + p.tiles * 0.002 + p.oil * 0.1 + p.mines * 0.2 + (this.portCount[p.id] ?? 0)) * this.goldMult(p);
  }
  count(p: Player, type: StructureType) {
    let n = 0;
    for (const s of this.structures.values()) if (s.owner === p.id && s.type === type) n++;
    return n;
  }
  cost(p: Player, kind: BuildKind) {
    const n = kind === 'warship' ? this.ships.filter(s => s.kind === 'war' && s.p === p.id).length : this.count(p, kind);
    return COSTS[kind] * (1 + n * 0.5);
  }
  readySilo(id: number) {
    for (const s of this.structures.values()) if (s.type === 'silo' && s.owner === id && this.active(s) && s.readyAt <= this.tick) return s;
  }
  enemyStructureNear(id: number, i: number) {
    let best: Structure | undefined, bd = 10;
    for (const s of this.structures.values()) {
      const d = dist2(s.tile, i);
      if (this.hostile(id, s.owner) && d < bd) { best = s; bd = d; }
    }
    return best;
  }
  event(text: string, to = 0, allyFrom?: number) {
    this.events.push({ text, to, allyFrom });
    this.eventCount++;
    if (this.events.length > 100) this.events.shift();
  }

  borders(a: number, b: number) {
    for (let i = 0; i < W * H; i++) if (this.owner[i] === b && this.isLand(i) && neighbors(i).some(n => this.owner[n] === a)) return true;
    return false;
  }

  // BFS over water from the tiles next to `to`; returned path runs from the goal tile to `to`.
  waterPath(to: number, goal: (w: number) => boolean) {
    const prev = new Int32Array(W * H).fill(-2), q: number[] = [];
    for (const n of neighbors(to)) if (!this.isLand(n)) { prev[n] = -1; q.push(n); }
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      if (goal(c)) {
        const path: number[] = [];
        for (let x = c; x !== -1; x = prev[x]) path.push(x);
        return path;
      }
      for (const n of neighbors(c)) if (!this.isLand(n) && prev[n] === -2) { prev[n] = c; q.push(n); }
    }
    return null;
  }

  routeTo(id: number, dest: number) { return this.waterPath(dest, w => neighbors(w).some(n => this.owner[n] === id)); }

  hash() {
    let h = 2166136261 ^ this.tick;
    for (let i = 0; i < W * H; i++) h = Math.imul(h ^ this.owner[i], 16777619);
    for (const p of this.players) h = Math.imul(h ^ Math.floor(p.troops) ^ (Math.floor(p.gold) << 8), 16777619);
    return h >>> 0;
  }

  setOwner(i: number, id: number) {
    const old = this.owner[i];
    if (old === id) return;
    const r = this.map.resource[i];
    if (old) this.adjust(this.pl(old), r, -1);
    if (id) this.adjust(this.pl(id), r, 1);
    this.owner[i] = id;
    const s = this.structures.get(i);
    if (s) { if (id) s.owner = id; else this.structures.delete(i); }
    if (old && id) for (const b of this.bounties) if (b.target === old) b.captured.set(id, (b.captured.get(id) ?? 0) + 1);
  }

  adjust(p: Player, r: number, d: number) {
    p.tiles += d;
    if (r === OIL) p.oil += d;
    else if (r === GOLD) p.mines += d;
    else if (r === FERTILE) p.fertile += d;
  }

  step(intents: Intent[]) {
    if (this.winner) return;
    for (const it of intents) this.apply(it);
    this.tick++;
    if (this.tick === 1) for (const p of this.players) if (p.bot) this.randomSpawn(p);
    if (this.tick === SPAWN_TICKS) for (const p of this.players) if (!p.spawned) this.randomSpawn(p);
    if (this.tick < SPAWN_TICKS) return;
    for (const p of this.players) if (p.bot && p.alive && (this.tick + p.id) % 10 === 0) this.botTick(p);
    this.stepAttacks();
    this.stepShips();
    for (const n of this.nukes) if (n.impact === this.tick) this.detonate(n);
    this.nukes = this.nukes.filter(n => n.impact > this.tick);
    this.stepWorld();
    this.economy();
    this.checkEnd();
  }

  apply(it: Intent) {
    if (!this.valid(it.p)) return;
    const p = this.pl(it.p);
    if (it.type === 'spawn') {
      const i = this.tileAt(it.x, it.y);
      if (this.tick < SPAWN_TICKS && i >= 0 && this.isLand(i) && (!this.owner[i] || this.owner[i] === p.id))
        this.placeSpawn(p, i, Object.hasOwn(DOCTRINES, it.doctrine) ? it.doctrine : 'blitz');
      return;
    }
    if (!p.alive || !p.spawned || this.tick < SPAWN_TICKS) return;
    if ('target' in it && !this.valid(it.target) && !(it.type === 'attack' && it.target === 0)) return;
    switch (it.type) {
      case 'attack': return this.attack(p, it.target, it.ratio);
      case 'boat': return this.boat(p, it.x, it.y, it.ratio);
      case 'build': return this.build(p, it.x, it.y, it.kind);
      case 'nuke': return this.nuke(p, it.x, it.y);
      case 'sabotage': return this.sabotage(p, it.x, it.y);
      case 'ally': return this.ally(p, this.pl(it.target));
      case 'unally': return this.unally(p, this.pl(it.target));
      case 'spy': return this.spy(p, this.pl(it.target));
      case 'bounty': return this.bounty(p, this.pl(it.target));
      case 'embargo': return this.embargo(p, this.pl(it.target));
      case 'emoji':
        if (EMOJIS.includes(it.emoji)) this.emojis.push({ target: it.target, emoji: it.emoji, tick: this.tick });
        return;
    }
  }

  placeSpawn(p: Player, c: number, doctrine: Doctrine) {
    if (p.spawned) for (let i = 0; i < W * H; i++) if (this.owner[i] === p.id) this.setOwner(i, 0);
    const cx = c % W, cy = (c / W) | 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const j = this.tileAt(cx + dx, cy + dy);
      if (j >= 0 && dx * dx + dy * dy <= 9 && this.isLand(j) && this.owner[j] === 0) this.setOwner(j, p.id);
    }
    p.spawned = true;
    p.doctrine = doctrine;
    p.troops = 3000;
  }

  randomSpawn(p: Player) {
    for (let t = 0; t < 5000; t++) {
      const i = Math.floor(this.rand() * W * H);
      if (!this.isLand(i) || this.owner[i] || (t < 3000 && !this.clearAround(i, 8))) continue;
      return this.placeSpawn(p, i, p.bot ? DOCTRINE_KEYS[Math.floor(this.rand() * DOCTRINE_KEYS.length)] : p.doctrine);
    }
  }

  clearAround(i: number, r: number) {
    const cx = i % W, cy = (i / W) | 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const j = this.tileAt(cx + dx, cy + dy);
      if (j >= 0 && this.owner[j]) return false;
    }
    return true;
  }

  attack(p: Player, target: number, ratio: number) {
    if (target === p.id || (target && (!this.pl(target).alive || this.allied(p.id, target)))) return;
    const troops = p.troops * clampRatio(ratio);
    if (troops < 1) return;
    p.troops -= troops;
    const ex = this.attacks.find(a => a.p === p.id && a.target === target && !a.done);
    if (ex) { ex.troops += troops; return; }
    const a: Attack = { p: p.id, target, troops, queue: [], head: 0 };
    this.fillQueue(a);
    this.attacks.push(a);
  }

  fillQueue(a: Attack) {
    const q: number[] = [];
    for (let i = 0; i < W * H; i++)
      if (this.owner[i] === a.target && this.isLand(i) && neighbors(i).some(n => this.owner[n] === a.p)) q.push(i);
    for (let k = q.length - 1; k > 0; k--) {
      const j = Math.floor(this.rand() * (k + 1));
      [q[k], q[j]] = [q[j], q[k]];
    }
    a.queue = q;
    a.head = 0;
  }

  nearDefense(i: number, owner: number) {
    for (const s of this.structures.values())
      if (s.type === 'defense' && s.owner === owner && this.active(s) && dist2(s.tile, i) <= DEFENSE_R * DEFENSE_R) return true;
    return false;
  }

  stepAttacks() {
    const night = this.isNight();
    for (const a of this.attacks) {
      const att = this.pl(a.p), def = a.target ? this.pl(a.target) : null;
      if (!att.alive || (def && !def.alive)) { a.done = true; continue; }
      let budget = (4 + Math.sqrt(a.troops) / 3) * (att.doctrine === 'blitz' ? 1.5 : 1), refilled = false;
      while (budget > 0 && !a.done) {
        if (a.head >= a.queue.length) {
          if (refilled) { a.done = true; break; }
          this.fillQueue(a);
          refilled = true;
          continue;
        }
        const i = a.queue[a.head++];
        if (this.owner[i] !== a.target || !this.isLand(i)) continue;
        const t = this.map.terrain[i], storm = this.inStorm(i);
        let cost = TERRAIN_COST[t] * (storm ? 1.5 : 1), loss = 0;
        if (def) {
          const d = def.troops / Math.max(1, def.tiles);
          const mult = (night ? 1.25 : 1) * (def.doctrine === 'fortress' ? 1.35 : 1) * (this.nearDefense(i, def.id) ? 3 : 1);
          cost += d * 1.2 * mult;
          loss = d * 0.6;
        }
        if (att.doctrine === 'blitz') cost *= 0.85;
        if (cost > a.troops) { a.done = true; break; }
        a.troops -= cost;
        if (def) def.troops = Math.max(0, def.troops - loss);
        budget -= TERRAIN_SPEED[t] * (storm ? 2 : 1);
        this.setOwner(i, a.p);
        for (const n of neighbors(i)) if (this.owner[n] === a.target && this.isLand(n)) a.queue.push(n);
      }
    }
    this.attacks = this.attacks.filter(a => {
      if (!a.done) return true;
      this.pl(a.p).troops += a.troops;
      return false;
    });
  }

  boat(p: Player, x: number, y: number, ratio: number) {
    const dest = this.tileAt(x, y);
    if (dest < 0 || !this.isCoastal(dest) || !this.hostile(p.id, this.owner[dest])) return;
    if (this.ships.filter(s => s.kind === 'transport' && s.p === p.id).length >= 3) return;
    const path = this.routeTo(p.id, dest);
    if (!path) return;
    const troops = p.troops * clampRatio(ratio);
    p.troops -= troops;
    this.ships.push({ kind: 'transport', p: p.id, tile: path[0], path, pos: 0, value: troops * (p.doctrine === 'naval' ? 1.25 : 1), dest, home: 0, hp: 0 });
  }

  stepShips() {
    if (this.tick % 10 === 0) this.spawnTrade();
    for (const s of this.ships) {
      if (s.done) continue;
      if (s.kind === 'war') { this.stepWarship(s); continue; }
      const speed = s.kind === 'transport' && this.pl(s.p).doctrine === 'naval' ? 2 : 1;
      for (let k = 0; k < speed && s.pos < s.path.length - 1; k++) {
        if (this.inStorm(s.path[s.pos + 1])) break;
        s.pos++;
      }
      s.tile = s.path[s.pos];
      if (s.pos >= s.path.length - 1) { s.done = true; this.arrive(s); }
    }
    this.ships = this.ships.filter(s => !s.done && this.pl(s.p).alive);
  }

  spawnTrade() {
    const ports = [...this.structures.values()].filter(s => s.type === 'port' && this.active(s));
    for (const s of ports) {
      if ((this.tick / 10 + s.tile) % 12 !== 0) continue;
      if (this.ships.filter(x => x.kind === 'trade' && x.p === s.owner).length >= 5) continue;
      const dests = ports.filter(d => this.tradeOk(s.owner, d.owner));
      if (!dests.length) continue;
      const d = dests[Math.floor(this.rand() * dests.length)];
      const path = this.waterPath(d.tile, w => neighbors(w).includes(s.tile));
      if (path) this.ships.push({ kind: 'trade', p: s.owner, tile: path[0], path, pos: 0, value: 30 + path.length * 0.8, dest: d.tile, home: s.tile, hp: 0 });
    }
  }

  arrive(s: Ship) {
    const p = this.pl(s.p);
    if (s.kind === 'trade') {
      const port = this.structures.get(s.dest);
      if (port?.type !== 'port' || !this.tradeOk(s.p, port.owner)) return;
      const o = this.pl(port.owner);
      p.gold += s.value * this.goldMult(p);
      o.gold += s.value * this.goldMult(o);
      return;
    }
    const t = this.owner[s.dest];
    if (!this.isLand(s.dest) || !this.hostile(s.p, t)) p.troops += s.value;
    else this.attacks.push({ p: s.p, target: t, troops: s.value, queue: [s.dest], head: 0 });
  }

  stepWarship(w: Ship) {
    let prey: Ship | undefined, pd = 145;
    for (const o of this.ships) {
      if (o.done || o === w || !this.hostile(w.p, o.p)) continue;
      const d = dist2(o.tile, w.tile);
      if (d < pd) { pd = d; prey = o; }
    }
    if (prey && pd <= 4) {
      if (prey.kind === 'war') {
        prey.hp -= 4;
        if (prey.hp <= 0) { prey.done = true; this.event(`⚓ Your warship was sunk by ${this.pl(w.p).name}`, prey.p); }
      } else {
        prey.done = true;
        if (prey.kind === 'trade') {
          this.pl(w.p).gold += prey.value;
          this.event(`⚓ Your warship captured a trade ship (+${Math.floor(prey.value)} gold)`, w.p);
        } else this.event(`⚓ Your transport was sunk by ${this.pl(w.p).name}`, prey.p);
      }
      return;
    }
    if (prey) w.dest = prey.tile;
    else if (w.tile === w.dest) w.dest = this.patrolTile(w.home);
    let next = -1, nd = dist2(w.tile, w.dest);
    for (const n of neighbors(w.tile)) {
      const d = dist2(n, w.dest);
      if (!this.isLand(n) && !this.inStorm(n) && d < nd) { nd = d; next = n; }
    }
    if (next >= 0) w.tile = next;
    else w.dest = this.patrolTile(w.home);
  }

  patrolTile(home: number) {
    const hx = home % W, hy = (home / W) | 0;
    for (let t = 0; t < 20; t++) {
      const i = this.tileAt(hx + Math.floor((this.rand() - 0.5) * 50), hy + Math.floor((this.rand() - 0.5) * 50));
      if (i >= 0 && !this.isLand(i)) return i;
    }
    return home;
  }

  build(p: Player, x: number, y: number, kind: BuildKind) {
    if (kind !== 'warship' && !STRUCTURES.includes(kind)) return;
    const i = this.tileAt(x, y), cost = this.cost(p, kind);
    if (i < 0 || p.gold < cost) return;
    if (kind === 'warship') {
      let port: Structure | undefined, bd = Infinity;
      for (const s of this.structures.values()) {
        const d = dist2(s.tile, i);
        if (s.type === 'port' && s.owner === p.id && this.active(s) && d < bd) { bd = d; port = s; }
      }
      if (!port) return;
      const w = neighbors(port.tile).find(n => !this.isLand(n));
      if (w === undefined) return;
      p.gold -= cost;
      this.ships.push({ kind: 'war', p: p.id, tile: w, path: [], pos: 0, value: 0, dest: w, home: port.tile, hp: 100 });
      return;
    }
    if (this.owner[i] !== p.id || (kind === 'port' && !this.isCoastal(i))) return;
    for (const s of this.structures.values()) if (dist2(s.tile, i) < 16) return;
    p.gold -= cost;
    this.structures.set(i, { type: kind, owner: p.id, tile: i, disabledUntil: 0, readyAt: 0 });
  }

  nuke(p: Player, x: number, y: number) {
    const to = this.tileAt(x, y), silo = this.readySilo(p.id);
    if (to < 0 || !silo || p.gold < COSTS.nuke) return;
    p.gold -= COSTS.nuke;
    silo.readyAt = this.tick + 100;
    this.nukes.push({ p: p.id, from: silo.tile, to, launch: this.tick, impact: this.tick + 20 + Math.floor(Math.sqrt(dist2(silo.tile, to)) / 4) });
    this.event(`☢ ${p.name} launched a nuke!`);
  }

  detonate(n: Nuke) {
    const sam = [...this.structures.values()].find(s =>
      s.type === 'sam' && this.active(s) && s.readyAt <= this.tick && this.hostile(n.p, s.owner) && dist2(s.tile, n.to) <= SAM_R * SAM_R);
    this.blasts.push({ tile: n.to, tick: this.tick, intercepted: !!sam });
    if (sam) {
      sam.readyAt = this.tick + 150;
      this.event(`📡 ${this.pl(sam.owner).name}'s SAM intercepted a nuke`);
      return;
    }
    const cx = n.to % W, cy = (n.to / W) | 0, lost = new Map<number, number>();
    for (let dy = -NUKE_R; dy <= NUKE_R; dy++) for (let dx = -NUKE_R; dx <= NUKE_R; dx++) {
      const j = this.tileAt(cx + dx, cy + dy);
      if (j < 0 || dx * dx + dy * dy > NUKE_R * NUKE_R) continue;
      const o = this.owner[j];
      if (o && o !== n.p) { this.setOwner(j, 0); lost.set(o, (lost.get(o) ?? 0) + 1); }
    }
    for (const s of this.ships) if (s.p !== n.p && dist2(s.tile, n.to) <= NUKE_R * NUKE_R) s.done = true;
    const p = this.pl(n.p);
    for (const [o, c] of lost) {
      const v = this.pl(o);
      v.troops *= Math.max(0, 1 - (1.5 * c) / (v.tiles + c));
      if (this.allied(p.id, o)) this.unally(p, v);
    }
  }

  sabotage(p: Player, x: number, y: number) {
    const i = this.tileAt(x, y), s = i >= 0 ? this.enemyStructureNear(p.id, i) : undefined;
    if (!s || p.gold < COSTS.sabotage) return;
    p.gold -= COSTS.sabotage;
    s.disabledUntil = this.tick + 600;
    this.event(`🧨 Your saboteurs disabled a ${s.type} of ${this.pl(s.owner).name}`, p.id);
    this.event(`🧨 Saboteurs disabled your ${s.type}!`, s.owner);
  }

  ally(p: Player, t: Player) {
    if (t.id === p.id || !t.alive || this.allied(p.id, t.id)) return;
    const botAccepts = t.bot && this.rand() < (p.troops > t.troops ? 0.6 : 0.25) && !this.attacks.some(a => a.p === p.id && a.target === t.id);
    if (this.allyRequests.has(`${t.id}>${p.id}`) || botAccepts) {
      this.allyRequests.delete(`${t.id}>${p.id}`);
      this.allyRequests.delete(`${p.id}>${t.id}`);
      p.allies.push(t.id);
      t.allies.push(p.id);
      for (const a of this.attacks) if ((a.p === p.id && a.target === t.id) || (a.p === t.id && a.target === p.id)) a.done = true;
      this.event(`🤝 You are now allied with ${t.name}`, p.id);
      this.event(`🤝 You are now allied with ${p.name}`, t.id);
    } else if (t.bot) this.event(`${t.name} declined your alliance`, p.id);
    else if (!this.allyRequests.has(`${p.id}>${t.id}`)) {
      this.allyRequests.add(`${p.id}>${t.id}`);
      this.event(`${p.name} requests an alliance`, t.id, p.id);
    }
  }

  unally(p: Player, t: Player) {
    if (!this.allied(p.id, t.id)) return;
    p.allies = p.allies.filter(a => a !== t.id);
    t.allies = t.allies.filter(a => a !== p.id);
    this.event(`💔 ${p.name} broke the alliance`, t.id);
    this.event(`You broke the alliance with ${t.name}`, p.id);
  }

  embargo(p: Player, t: Player) {
    if (t.id === p.id) return;
    const on = p.embargo.includes(t.id);
    p.embargo = on ? p.embargo.filter(e => e !== t.id) : [...p.embargo, t.id];
    this.event(on ? `${p.name} lifted their embargo on you` : `🚫 ${p.name} placed an embargo on you`, t.id);
    this.event(on ? `Embargo on ${t.name} lifted` : `🚫 Embargo on ${t.name}: no trade between you`, p.id);
  }

  spy(p: Player, t: Player) {
    if (t.id === p.id || p.gold < COSTS.spy) return;
    p.gold -= COSTS.spy;
    this.spies.push({ by: p.id, target: t.id, until: this.tick + 300 });
    this.event(`🕵 Spies reveal ${t.name}'s troops for 30s`, p.id);
  }

  bounty(p: Player, t: Player) {
    if (t.id === p.id || !t.alive || p.gold < COSTS.bounty) return;
    p.gold -= COSTS.bounty;
    this.bounties.push({ target: t.id, amount: COSTS.bounty, captured: new Map() });
    this.event(`🎯 ${p.name} placed a ${COSTS.bounty} gold bounty on ${t.name}`);
  }

  stepWorld() {
    if (this.tick % 500 === 0 && this.storms.length < 4) {
      const left = this.rand() < 0.5;
      this.storms.push({ x: left ? -40 : W + 40, y: this.rand() * H, r: 25 + this.rand() * 25, vx: (left ? 1 : -1) * (0.15 + this.rand() * 0.15), vy: (this.rand() - 0.5) * 0.2 });
    }
    for (const s of this.storms) { s.x += s.vx; s.y += s.vy; }
    this.storms = this.storms.filter(s => s.x > -60 && s.x < W + 60);
    if (this.tick >= SEA_START && this.tick % 300 === 0 && this.seaLevel < SEA + 0.04) {
      this.seaLevel += 0.004;
      const { terrain, height, resource } = this.map;
      for (let i = 0; i < W * H; i++) {
        if (terrain[i] === WATER || height[i] >= this.seaLevel) continue;
        this.setOwner(i, 0);
        terrain[i] = WATER;
        resource[i] = 0;
        this.landTiles--;
      }
      this.terrainVersion++;
      this.event('🌊 The sea is rising! Coastal land floods.');
    }
    this.blasts = this.blasts.filter(b => this.tick - b.tick < 20);
    this.emojis = this.emojis.filter(e => this.tick - e.tick < 50);
    this.spies = this.spies.filter(s => s.until > this.tick);
  }

  economy() {
    const cities = new Array<number>(this.players.length + 1).fill(0), ports = [...cities];
    for (const s of this.structures.values()) {
      if (!this.active(s)) continue;
      if (s.type === 'city') cities[s.owner]++;
      else if (s.type === 'port') ports[s.owner]++;
    }
    this.cityCount = cities;
    this.portCount = ports;
    for (const p of this.players) {
      if (!p.alive || !p.spawned) continue;
      const growth = (10 + Math.sqrt(p.troops) * 0.8 + p.fertile * 0.1) * (1 - p.troops / this.maxTroops(p));
      p.troops = Math.max(0, p.troops + growth);
      p.gold += this.goldRate(p);
    }
  }

  checkEnd() {
    for (const p of this.players) if (p.alive && p.tiles === 0) this.kill(p);
    if (this.tick % 10) return;
    const alive = this.players.filter(p => p.alive);
    if (!alive.length) { this.winner = -1; return; }
    const top = alive.reduce((a, b) => (b.tiles > a.tiles ? b : a));
    if (alive.length === 1 || top.tiles >= this.landTiles * WIN_SHARE) {
      this.winner = top.id;
      this.event(`🏆 ${top.name} wins!`);
    }
  }

  kill(p: Player) {
    p.alive = false;
    p.troops = 0;
    this.event(`💀 ${p.name} was eliminated`);
    for (const b of this.bounties) {
      if (b.target !== p.id) continue;
      let best = 0, n = 0;
      for (const [id, c] of b.captured) if (c > n) { best = id; n = c; }
      if (!best) continue;
      this.pl(best).gold += b.amount;
      this.event(`🎯 ${this.pl(best).name} claimed the ${b.amount} gold bounty on ${p.name}`);
    }
    this.bounties = this.bounties.filter(b => b.target !== p.id);
  }

  botTick(p: Player) {
    // border: neighbor owner -> one of our tiles touching them (Map keeps insertion order, so this stays deterministic)
    const border = new Map<number, number>();
    let pick = -1, n = 0, coast = -1;
    for (let i = 0; i < W * H; i++) {
      if (this.owner[i] !== p.id) continue;
      if (this.rand() * ++n < 1) pick = i;
      for (const j of neighbors(i)) {
        if (!this.isLand(j)) coast = i;
        else if (this.owner[j] !== p.id && !border.has(this.owner[j])) border.set(this.owner[j], i);
      }
    }
    if (pick < 0) return;
    const max = this.maxTroops(p);
    const threat = this.attacks.find(a => a.target === p.id && border.has(a.p))?.p ?? 0;
    const enemies = [...border.keys()].filter(o => o && !this.allied(p.id, o));
    const strongest = enemies.reduce((a, o) => (!a || this.pl(o).troops > this.pl(a).troops ? o : a), 0);

    if (this.rand() < 0.5) {
      const kind: BuildKind = threat ? 'defense'
        : coast >= 0 && !this.count(p, 'port') ? 'port'
        : this.tick > 3000 && !this.count(p, 'silo') && p.tiles > 2000 ? 'silo'
        : this.tick > 3000 && !this.count(p, 'sam') && p.tiles > 2000 ? 'sam'
        : this.count(p, 'port') && this.rand() < 0.15 ? 'warship' : 'city';
      const at = kind === 'defense' ? border.get(threat)! : kind === 'port' ? coast : pick;
      if (p.gold >= this.cost(p, kind) + (kind === 'city' ? 0 : 500)) this.build(p, at % W, (at / W) | 0, kind);
    }
    if (strongest && p.gold >= COSTS.nuke && this.readySilo(p.id) && this.rand() < 0.3) {
      const t = neighbors(border.get(strongest)!).find(j => this.owner[j] === strongest);
      if (t !== undefined) this.nuke(p, t % W, (t / W) | 0);
    }

    if (this.attacks.some(a => a.p === p.id)) return;
    if (threat && p.troops > max * 0.3) return this.attack(p, threat, 0.4);
    if (p.troops < max * 0.5) return;
    if (border.has(0)) return this.attack(p, 0, 0.35);
    let best = 0, bestScore = Infinity;
    for (const o of enemies) {
      const e = this.pl(o), score = e.troops * (e.bot ? 1 : 1.2);
      if (score < bestScore) { bestScore = score; best = o; }
    }
    if (best && (p.troops > this.pl(best).troops * 0.8 || p.troops > max * 0.9)) return this.attack(p, best, 0.5);
    if (!enemies.length && coast >= 0 && this.rand() < 0.3) for (let t = 0; t < 200; t++) {
      const i = Math.floor(this.rand() * W * H);
      if (this.isCoastal(i) && this.hostile(p.id, this.owner[i])) return this.boat(p, i % W, (i / W) | 0, 0.3);
    }
  }
}
