import { COSTS, LABELS, MAX_TRANSPORTS } from '../core/config';
import type { Game, Player } from '../core/game';
import { W } from '../core/map';
import type { BuildKind, Doctrine, IntentBody } from '../core/types';
import { routeTo } from '../core/units';
import { fmt, toast } from './dom';
import type { Renderer } from './render';
import type { Runner } from './runner';

export type Mode = BuildKind | 'nuke' | 'sabotage';

export interface Ctx {
  g: Game; me: number; p: Player; r: Renderer; runner: Runner;
  ratio: number; mode: Mode | null; doctrine: Doctrine; spawnAt: number;
  send(intent: IntentBody, tile?: number, label?: string): void;
}

export const modeLabel = (m: Mode) => (m === 'nuke' ? 'Nuke' : m === 'sabotage' ? 'Sabotage' : LABELS[m]);
export const costOf = (c: Ctx, m: Mode) => (m === 'nuke' || m === 'sabotage' ? COSTS[m] : c.g.cost(c.p, m));
const xy = (i: number) => ({ x: i % W, y: (i / W) | 0 });

export function pay(c: Ctx, cost: number, label: string, intent: IntentBody, tile = -1) {
  if (c.p.gold < cost) return toast(`Not enough gold for ${label} — need ${fmt(cost)}, have ${fmt(c.p.gold)}`);
  c.send(intent, tile, label);
}

export function spawn(c: Ctx, i: number) {
  if (!c.g.isLand(i)) return toast('Spawn on land');
  c.spawnAt = i;
  c.send({ type: 'spawn', ...xy(i), doctrine: c.doctrine }, i, 'Spawn');
}

export function doAttack(c: Ctx, i: number) {
  const { g, me } = c, o = g.owner[i], pct = `${Math.round(c.ratio * 100)}%`;
  if (o === me || !g.isLand(i)) return;
  if (o && g.allied(me, o)) return toast(`${g.pl(o).name} is your ally — break the alliance first`);
  if (g.borders(me, o)) return c.send({ type: 'attack', target: o, ratio: c.ratio }, i, `⚔ ${pct}`);
  if (!g.isCoastal(i)) return toast('No shared border and not a coast — cannot reach');
  if (g.ships.filter(s => s.kind === 'transport' && s.p === me).length >= MAX_TRANSPORTS) return toast(`Max ${MAX_TRANSPORTS} transports at sea`);
  if (!routeTo(g, me, i)) return toast('No sea route from your coast');
  c.send({ type: 'boat', ...xy(i), ratio: c.ratio }, i, `⛵ ${pct}`);
}

export function useMode(c: Ctx, m: Mode, i: number) {
  const { g, me, p } = c, cost = costOf(c, m), label = modeLabel(m);
  if (m === 'nuke') {
    if (!g.readySilo(me)) return toast('You need a ready missile silo');
    return pay(c, cost, label, { type: 'nuke', ...xy(i) }, i);
  }
  if (m === 'sabotage') {
    if (!g.enemyStructureNear(me, i)) return toast('No enemy structure there');
    return pay(c, cost, label, { type: 'sabotage', ...xy(i) }, i);
  }
  if (m === 'warship' ? !g.count(p, 'port') : g.owner[i] !== me) return toast(m === 'warship' ? 'You need a port' : 'Build on your own land');
  if (m === 'port' && !g.isCoastal(i)) return toast('Ports must be on the coast');
  pay(c, cost, label, { type: 'build', ...xy(i), kind: m }, i);
}
