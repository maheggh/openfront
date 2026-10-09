import {
  ATTACK_SPEED, ATTACK_SPEED_DIV, BLITZ_COST, BLITZ_SPEED, DEFENSE_MULT, DEFENSE_R, DENSITY_COST, DENSITY_LOSS, FORTRESS_DEFENSE,
  NIGHT_DEFENSE, STORM_COST, STORM_SLOW, TERRAIN_COST, TERRAIN_SPEED,
} from './config';
import type { Attack, Game, Player } from './game';
import { dist2, neighbors } from './map';

export const clampRatio = (r: number) => Math.min(1, Math.max(0.01, Number(r) || 0));

export function attack(g: Game, p: Player, target: number, ratio: number) {
  if (target === p.id || (target && (!g.pl(target).alive || g.allied(p.id, target)))) return;
  const troops = p.troops * clampRatio(ratio);
  if (troops < 1) return;
  p.troops -= troops;
  const ex = g.attacks.find(a => a.p === p.id && a.target === target && !a.done);
  if (ex) { ex.troops += troops; return; }
  const a: Attack = { p: p.id, target, troops, queue: [], head: 0 };
  fillQueue(g, a);
  g.attacks.push(a);
}

function fillQueue(g: Game, a: Attack) {
  const q: number[] = [];
  for (const i of g.pl(a.p).border) for (const n of neighbors(i)) if (g.owner[n] === a.target && g.isLand(n)) q.push(n);
  for (let k = q.length - 1; k > 0; k--) {
    const j = Math.floor(g.rand() * (k + 1));
    [q[k], q[j]] = [q[j], q[k]];
  }
  a.queue = q;
  a.head = 0;
}

function nearDefense(g: Game, i: number, owner: number) {
  for (const s of g.structures.values())
    if (s.type === 'defense' && s.owner === owner && g.active(s) && dist2(s.tile, i) <= DEFENSE_R * DEFENSE_R) return true;
  return false;
}

export function stepAttacks(g: Game) {
  const night = g.isNight();
  for (const a of g.attacks) {
    const att = g.pl(a.p), def = a.target ? g.pl(a.target) : null;
    if (!att.alive || (def && !def.alive)) { a.done = true; continue; }
    let budget = (ATTACK_SPEED + Math.sqrt(a.troops) / ATTACK_SPEED_DIV) * (att.doctrine === 'blitz' ? BLITZ_SPEED : 1), refilled = false;
    while (budget > 0 && !a.done) {
      if (a.head >= a.queue.length) {
        if (refilled) { a.done = true; break; }
        fillQueue(g, a);
        refilled = true;
        continue;
      }
      const i = a.queue[a.head++];
      if (g.owner[i] !== a.target || !g.isLand(i)) continue;
      const t = g.map.terrain[i], storm = g.inStorm(i);
      let cost = TERRAIN_COST[t] * (storm ? STORM_COST : 1), loss = 0;
      if (def) {
        const density = def.troops / Math.max(1, def.tiles);
        const mult = (night ? NIGHT_DEFENSE : 1) * (def.doctrine === 'fortress' ? FORTRESS_DEFENSE : 1) * (nearDefense(g, i, def.id) ? DEFENSE_MULT : 1);
        cost += density * DENSITY_COST * mult;
        loss = density * DENSITY_LOSS;
      }
      if (att.doctrine === 'blitz') cost *= BLITZ_COST;
      if (cost > a.troops) { a.done = true; break; }
      a.troops -= cost;
      if (def) def.troops = Math.max(0, def.troops - loss);
      budget -= TERRAIN_SPEED[t] * (storm ? STORM_SLOW : 1);
      g.setOwner(i, a.p);
      for (const n of neighbors(i)) if (g.owner[n] === a.target && g.isLand(n)) a.queue.push(n);
    }
  }
  g.attacks = g.attacks.filter(a => {
    if (!a.done) return true;
    g.pl(a.p).troops += a.troops;
    return false;
  });
}
