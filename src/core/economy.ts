import { BUILD_SPACING2, REGEN_BASE, REGEN_PER_FERTILE, REGEN_SQRT, STRUCTURES } from './config';
import type { Game, Player } from './game';
import { dist2 } from './map';
import type { BuildKind } from './types';
import { buildWarship } from './units';

export function build(g: Game, p: Player, x: number, y: number, kind: BuildKind) {
  if (kind !== 'warship' && !STRUCTURES.includes(kind)) return;
  const i = g.tileAt(x, y), cost = g.cost(p, kind);
  if (i < 0 || p.gold < cost) return;
  if (kind === 'warship') return buildWarship(g, p, i, cost);
  if (g.owner[i] !== p.id || (kind === 'port' && !g.isCoastal(i))) return;
  for (const s of g.structures.values()) if (dist2(s.tile, i) < BUILD_SPACING2) return;
  p.gold -= cost;
  g.structures.set(i, { type: kind, owner: p.id, tile: i, disabledUntil: 0, readyAt: 0 });
}

export function economy(g: Game) {
  const cities = new Array<number>(g.players.length + 1).fill(0), ports = [...cities];
  for (const s of g.structures.values()) {
    if (!g.active(s)) continue;
    if (s.type === 'city') cities[s.owner]++;
    else if (s.type === 'port') ports[s.owner]++;
  }
  g.cityCount = cities;
  g.portCount = ports;
  for (const p of g.players) {
    if (!p.alive || !p.spawned) continue;
    const growth = (REGEN_BASE + Math.sqrt(p.troops) * REGEN_SQRT + p.fertile * REGEN_PER_FERTILE) * (1 - p.troops / g.maxTroops(p));
    p.troops = Math.max(0, p.troops + growth);
    p.gold += g.goldRate(p);
  }
}
