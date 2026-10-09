import { COSTS, SABOTAGE_TICKS, SPY_TICKS, TICK_MS } from './config';
import type { Game, Player } from './game';

export function ally(g: Game, p: Player, t: Player) {
  if (t.id === p.id || !t.alive || g.allied(p.id, t.id)) return;
  const asked = g.allyRequests.has(`${t.id}>${p.id}`);
  const botAccepts = t.bot && g.rand() < (p.troops > t.troops ? 0.6 : 0.25) && !g.attacks.some(a => a.p === p.id && a.target === t.id);
  if (asked || botAccepts) {
    g.allyRequests.delete(`${t.id}>${p.id}`);
    g.allyRequests.delete(`${p.id}>${t.id}`);
    p.allies.push(t.id);
    t.allies.push(p.id);
    for (const a of g.attacks) if ((a.p === p.id && a.target === t.id) || (a.p === t.id && a.target === p.id)) a.done = true;
    g.event(`🤝 You are now allied with ${t.name}`, p.id);
    g.event(`🤝 You are now allied with ${p.name}`, t.id);
  } else if (t.bot) g.event(`${t.name} declined your alliance`, p.id);
  else if (!g.allyRequests.has(`${p.id}>${t.id}`)) {
    g.allyRequests.add(`${p.id}>${t.id}`);
    g.event(`${p.name} requests an alliance`, t.id, p.id);
  }
}

export function unally(g: Game, p: Player, t: Player) {
  if (!g.allied(p.id, t.id)) return;
  p.allies = p.allies.filter(a => a !== t.id);
  t.allies = t.allies.filter(a => a !== p.id);
  g.event(`💔 ${p.name} broke the alliance`, t.id);
  g.event(`You broke the alliance with ${t.name}`, p.id);
}

export function embargo(g: Game, p: Player, t: Player) {
  if (t.id === p.id) return;
  const on = p.embargo.includes(t.id);
  p.embargo = on ? p.embargo.filter(e => e !== t.id) : [...p.embargo, t.id];
  g.event(on ? `${p.name} lifted their embargo on you` : `🚫 ${p.name} placed an embargo on you`, t.id);
  g.event(on ? `Embargo on ${t.name} lifted` : `🚫 Embargo on ${t.name}: no trade between you`, p.id);
}

export function spy(g: Game, p: Player, t: Player) {
  if (t.id === p.id || p.gold < COSTS.spy) return;
  p.gold -= COSTS.spy;
  g.spies.push({ by: p.id, target: t.id, until: g.tick + SPY_TICKS });
  g.event(`🕵 Spies reveal ${t.name}'s troops for ${(SPY_TICKS * TICK_MS) / 1000}s`, p.id);
}

export function sabotage(g: Game, p: Player, x: number, y: number) {
  const i = g.tileAt(x, y), s = i >= 0 ? g.enemyStructureNear(p.id, i) : undefined;
  if (!s || p.gold < COSTS.sabotage) return;
  p.gold -= COSTS.sabotage;
  s.disabledUntil = g.tick + SABOTAGE_TICKS;
  g.event(`🧨 Your saboteurs disabled a ${s.type} of ${g.pl(s.owner).name}`, p.id);
  g.event(`🧨 Saboteurs disabled your ${s.type}!`, s.owner);
}

export function bounty(g: Game, p: Player, t: Player) {
  if (t.id === p.id || !t.alive || p.gold < COSTS.bounty) return;
  p.gold -= COSTS.bounty;
  g.bounties.push({ target: t.id, amount: COSTS.bounty, captured: new Map() });
  g.event(`🎯 ${p.name} placed a ${COSTS.bounty} gold bounty on ${t.name}`);
}

export function payBounties(g: Game, dead: Player) {
  for (const b of g.bounties) {
    if (b.target !== dead.id) continue;
    let best = 0, n = 0;
    for (const [id, c] of b.captured) if (c > n) { best = id; n = c; }
    if (!best) continue;
    g.pl(best).gold += b.amount;
    g.event(`🎯 ${g.pl(best).name} claimed the ${b.amount} gold bounty on ${dead.name}`);
  }
  g.bounties = g.bounties.filter(b => b.target !== dead.id);
}
