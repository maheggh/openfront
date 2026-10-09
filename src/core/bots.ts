import { attack } from './attack';
import { COSTS } from './config';
import { build } from './economy';
import type { Game, Player } from './game';
import { H, neighbors, W } from './map';
import type { BuildKind } from './types';
import { boat, nuke } from './units';

const BUILD_CHANCE = 0.5, LATE_GAME = 3000, BIG = 2000, GOLD_RESERVE = 500, WARSHIP_CHANCE = 0.15, NUKE_CHANCE = 0.3;
const COUNTER_MIN = 0.3, ATTACK_MIN = 0.5, SURPLUS = 0.9, ODDS = 0.8, HUMAN_WEIGHT = 1.2, BOAT_CHANCE = 0.3;

function interiorTile(g: Game, p: Player) {
  for (let t = 0; t < 30; t++) {
    const i = Math.floor(g.rand() * W * H);
    if (g.owner[i] === p.id && !p.border.has(i)) return i;
  }
  return p.border.values().next().value ?? -1;
}

export function botTick(g: Game, p: Player) {
  // neighbor owner -> one of our border tiles touching them
  const near = new Map<number, number>();
  let coast = -1;
  for (const i of p.border) for (const j of neighbors(i)) {
    if (!g.isLand(j)) coast = i;
    else if (g.owner[j] !== p.id && !near.has(g.owner[j])) near.set(g.owner[j], i);
  }
  const home = interiorTile(g, p);
  if (home < 0) return;
  const max = g.maxTroops(p);
  const threat = g.attacks.find(a => a.target === p.id && near.has(a.p))?.p ?? 0;
  const enemies = [...near.keys()].filter(o => o && !g.allied(p.id, o));
  const strongest = enemies.reduce((a, o) => (!a || g.pl(o).troops > g.pl(a).troops ? o : a), 0);

  if (g.rand() < BUILD_CHANCE) {
    const late = g.tick > LATE_GAME && p.tiles > BIG;
    const kind: BuildKind = threat ? 'defense'
      : coast >= 0 && !g.count(p, 'port') ? 'port'
      : late && !g.count(p, 'silo') ? 'silo'
      : late && !g.count(p, 'sam') ? 'sam'
      : g.count(p, 'port') && g.rand() < WARSHIP_CHANCE ? 'warship' : 'city';
    const at = kind === 'defense' ? near.get(threat)! : kind === 'port' ? coast : home;
    if (p.gold >= g.cost(p, kind) + (kind === 'city' ? 0 : GOLD_RESERVE)) build(g, p, at % W, (at / W) | 0, kind);
  }
  if (strongest && p.gold >= COSTS.nuke && g.readySilo(p.id) && g.rand() < NUKE_CHANCE) {
    const t = neighbors(near.get(strongest)!).find(j => g.owner[j] === strongest);
    if (t !== undefined) nuke(g, p, t % W, (t / W) | 0);
  }

  if (g.attacks.some(a => a.p === p.id)) return;
  if (threat && p.troops > max * COUNTER_MIN) return attack(g, p, threat, 0.4);
  if (p.troops < max * ATTACK_MIN) return;
  if (near.has(0)) return attack(g, p, 0, 0.35);
  let best = 0, bestScore = Infinity;
  for (const o of enemies) {
    const e = g.pl(o), score = e.troops * (e.bot ? 1 : HUMAN_WEIGHT);
    if (score < bestScore) { bestScore = score; best = o; }
  }
  if (best && (p.troops > g.pl(best).troops * ODDS || p.troops > max * SURPLUS)) return attack(g, p, best, 0.5);
  if (!enemies.length && coast >= 0 && g.rand() < BOAT_CHANCE) for (let t = 0; t < 200; t++) {
    const i = Math.floor(g.rand() * W * H);
    if (g.isCoastal(i) && g.hostile(p.id, g.owner[i])) return boat(g, p, i % W, (i / W) | 0, 0.3);
  }
}
