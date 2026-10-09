import { attack, stepAttacks } from './attack';
import { botTick } from './bots';
import {
  BOT_EVERY, COST_GROWTH, COSTS, DAY, DOCTRINES, EMOJIS, GOLD_BASE, GOLD_PER_MINE, GOLD_PER_OIL, GOLD_PER_PORT, GOLD_PER_TILE, MAX_EVENTS,
  MERCHANT_GOLD, NIGHT_START, SABOTAGE_REACH2, SPAWN_RADIUS, SPAWN_TICKS, START_TROOPS, TROOPS_BASE, TROOPS_PER_CITY, TROOPS_PER_FERTILE,
  TROOPS_PER_TILE, WIN_SHARE,
} from './config';
import { ally, bounty, embargo, payBounties, sabotage, spy, unally } from './diplomacy';
import { build, economy } from './economy';
import { dist2, FERTILE, GameMap, generateMap, GOLD, H, neighbors, OIL, SEA, W, WATER } from './map';
import { rng } from './rng';
import { BuildKind, Doctrine, GameConfig, Intent, StructureType } from './types';
import { boat, nuke, stepNukes, stepShips } from './units';
import { stepWorld } from './world';

const DOCTRINE_KEYS = Object.keys(DOCTRINES) as Doctrine[];

export interface Player {
  id: number; name: string; bot: boolean; color: [number, number, number];
  troops: number; gold: number; tiles: number; alive: boolean; spawned: boolean; doctrine: Doctrine;
  allies: number[]; embargo: number[]; oil: number; mines: number; fertile: number;
  // Own tiles touching anything not owned by this player (enemies, neutral land or water); kept up to date by setOwner.
  border: Set<number>; sumX: number; sumY: number;
}
export interface Structure { type: StructureType; owner: number; tile: number; disabledUntil: number; readyAt: number }
export interface Attack { p: number; target: number; troops: number; queue: number[]; head: number; done?: boolean }
// value: troops (transport) or gold (trade). dest: landing tile, destination port or patrol target. home: source or home port.
export interface Ship { kind: 'transport' | 'trade' | 'war'; p: number; tile: number; path: number[]; pos: number; value: number; dest: number; home: number; hp: number; done?: boolean }
export interface Nuke { p: number; from: number; to: number; launch: number; impact: number }
export interface Storm { x: number; y: number; r: number; vx: number; vy: number }
export interface GameEvent { text: string; to: number; allyFrom?: number }
export interface Bounty { target: number; amount: number; captured: Map<number, number> }

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
  pathCache = new Map<string, number[] | null>();
  dirty: number[] = [];
  seaLevel = SEA;
  terrainVersion = 0;
  landTiles = 0;
  winner = 0;
  rand: () => number;

  constructor(cfg: GameConfig) {
    this.map = generateMap(cfg.seed);
    this.rand = rng(cfg.seed + 1);
    this.players = cfg.players.map((p, i): Player => ({
      id: i + 1, name: p.name, bot: p.bot, color: color(i), troops: 0, gold: 0, tiles: 0, alive: true, spawned: false,
      doctrine: 'blitz', allies: [], embargo: [], oil: 0, mines: 0, fertile: 0, border: new Set(), sumX: 0, sumY: 0,
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
  goldMult(p: Player) { return p.doctrine === 'merchant' ? MERCHANT_GOLD : 1; }
  maxTroops(p: Player) {
    return TROOPS_BASE + p.tiles * TROOPS_PER_TILE + p.fertile * TROOPS_PER_FERTILE + (this.cityCount[p.id] ?? 0) * TROOPS_PER_CITY;
  }
  goldRate(p: Player) {
    return (GOLD_BASE + p.tiles * GOLD_PER_TILE + p.oil * GOLD_PER_OIL + p.mines * GOLD_PER_MINE + (this.portCount[p.id] ?? 0) * GOLD_PER_PORT) * this.goldMult(p);
  }
  count(p: Player, type: StructureType) {
    let n = 0;
    for (const s of this.structures.values()) if (s.owner === p.id && s.type === type) n++;
    return n;
  }
  cost(p: Player, kind: BuildKind) {
    const n = kind === 'warship' ? this.ships.filter(s => s.kind === 'war' && s.p === p.id).length : this.count(p, kind);
    return COSTS[kind] * (1 + n * COST_GROWTH);
  }
  readySilo(id: number) {
    for (const s of this.structures.values()) if (s.type === 'silo' && s.owner === id && this.active(s) && s.readyAt <= this.tick) return s;
  }
  enemyStructureNear(id: number, i: number) {
    let best: Structure | undefined, bd = SABOTAGE_REACH2 + 1;
    for (const s of this.structures.values()) {
      const d = dist2(s.tile, i);
      if (this.hostile(id, s.owner) && d < bd) { best = s; bd = d; }
    }
    return best;
  }
  borders(a: number, b: number) {
    for (const i of this.pl(a).border) for (const n of neighbors(i)) if (this.owner[n] === b && this.isLand(n)) return true;
    return false;
  }

  event(text: string, to = 0, allyFrom?: number) {
    this.events.push({ text, to, allyFrom });
    this.eventCount++;
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  hash() {
    let h = 2166136261 ^ this.tick;
    for (let i = 0; i < W * H; i++) h = Math.imul(h ^ this.owner[i], 16777619);
    for (const p of this.players) h = Math.imul(h ^ Math.floor(p.troops) ^ (Math.floor(p.gold) << 8), 16777619);
    return h >>> 0;
  }

  setOwner(i: number, id: number) {
    const old = this.owner[i];
    if (old === id) return;
    if (old) { this.adjust(this.pl(old), i, -1); this.pl(old).border.delete(i); }
    if (id) this.adjust(this.pl(id), i, 1);
    this.owner[i] = id;
    this.refreshBorder(i);
    for (const n of neighbors(i)) this.refreshBorder(n);
    const s = this.structures.get(i);
    if (s) { if (id) s.owner = id; else this.structures.delete(i); }
    if (old && id) for (const b of this.bounties) if (b.target === old) b.captured.set(id, (b.captured.get(id) ?? 0) + 1);
    if (this.dirty.length < W * H) this.dirty.push(i);
  }

  private refreshBorder(i: number) {
    const o = this.owner[i];
    if (!o) return;
    if (neighbors(i).some(n => this.owner[n] !== o)) this.pl(o).border.add(i);
    else this.pl(o).border.delete(i);
  }

  private adjust(p: Player, i: number, d: number) {
    const r = this.map.resource[i];
    p.tiles += d;
    p.sumX += d * (i % W);
    p.sumY += d * ((i / W) | 0);
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
    for (const p of this.players) if (p.bot && p.alive && (this.tick + p.id) % BOT_EVERY === 0) botTick(this, p);
    stepAttacks(this);
    stepShips(this);
    stepNukes(this);
    stepWorld(this);
    economy(this);
    this.checkEnd();
  }

  private apply(it: Intent) {
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
      case 'attack': return attack(this, p, it.target, it.ratio);
      case 'boat': return boat(this, p, it.x, it.y, it.ratio);
      case 'build': return build(this, p, it.x, it.y, it.kind);
      case 'nuke': return nuke(this, p, it.x, it.y);
      case 'sabotage': return sabotage(this, p, it.x, it.y);
      case 'ally': return ally(this, p, this.pl(it.target));
      case 'unally': return unally(this, p, this.pl(it.target));
      case 'spy': return spy(this, p, this.pl(it.target));
      case 'bounty': return bounty(this, p, this.pl(it.target));
      case 'embargo': return embargo(this, p, this.pl(it.target));
      case 'emoji':
        if (EMOJIS.includes(it.emoji)) this.emojis.push({ target: it.target, emoji: it.emoji, tick: this.tick });
    }
  }

  private placeSpawn(p: Player, c: number, doctrine: Doctrine) {
    if (p.spawned) for (let i = 0; i < W * H; i++) if (this.owner[i] === p.id) this.setOwner(i, 0);
    const cx = c % W, cy = (c / W) | 0, r = SPAWN_RADIUS;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const j = this.tileAt(cx + dx, cy + dy);
      if (j >= 0 && dx * dx + dy * dy <= r * r && this.isLand(j) && this.owner[j] === 0) this.setOwner(j, p.id);
    }
    p.spawned = true;
    p.doctrine = doctrine;
    p.troops = START_TROOPS;
  }

  private randomSpawn(p: Player) {
    for (let t = 0; t < 5000; t++) {
      const i = Math.floor(this.rand() * W * H);
      if (!this.isLand(i) || this.owner[i] || (t < 3000 && !this.clearAround(i, 8))) continue;
      return this.placeSpawn(p, i, p.bot ? DOCTRINE_KEYS[Math.floor(this.rand() * DOCTRINE_KEYS.length)] : p.doctrine);
    }
  }

  private clearAround(i: number, r: number) {
    const cx = i % W, cy = (i / W) | 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const j = this.tileAt(cx + dx, cy + dy);
      if (j >= 0 && this.owner[j]) return false;
    }
    return true;
  }

  private checkEnd() {
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

  private kill(p: Player) {
    p.alive = false;
    p.troops = 0;
    this.event(`💀 ${p.name} was eliminated`);
    payBounties(this, p);
  }
}
