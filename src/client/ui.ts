import { BUFFER_TURNS, BUILDS, COSTS, DOCTRINES, EMOJIS, LABELS, SPAWN_TICKS, TICK_MS } from '../core/config';
import { FERTILE, GOLD, OIL, SEA } from '../core/map';
import type { Doctrine } from '../core/types';
import { costOf, Ctx, doAttack, Mode, modeLabel, pay, spawn, useMode } from './actions';
import { $, button, esc, fmt } from './dom';
import { net } from './net';

const HUD_MS = 250, LOG_LINES = 8, BOARD_SIZE = 10, CATCHUP_SHOWN = 20;
const DESC: Record<Mode, string> = {
  city: '+15k max troops', port: 'Gold income + trade ships (coast only)', defense: '3x defense within 12 tiles',
  silo: 'Launches nukes', sam: 'Intercepts nukes within 30 tiles', warship: 'Patrols near your port, sinks enemy ships',
  nuke: 'Needs a ready silo', sabotage: 'Disable an enemy structure for 60s',
};
const TERRAIN = ['Sea', 'Plains', 'Highlands', 'Mountains'];
const RESOURCE: Record<number, string> = { [OIL]: ' · 🛢 Oil', [GOLD]: ' · ⛏ Gold mine', [FERTILE]: ' · 🌾 Fertile' };
const pct = (n: number, of: number) => ((n / of) * 100).toFixed(1) + '%';

export const MODES: Mode[] = [...BUILDS, 'nuke', 'sabotage'];
let modeButtons: HTMLButtonElement[] = [];

export function setMode(c: Ctx, m: Mode | null) {
  c.mode = m;
  modeButtons.forEach((b, k) => b.classList.toggle('on', MODES[k] === m));
  c.r.canvas.style.cursor = m ? 'crosshair' : '';
}

export function setRatio(c: Ctx, v: number) {
  c.ratio = Math.min(1, Math.max(0.01, Math.round(v * 100) / 100));
  ($('ratio') as HTMLInputElement).value = String(Math.round(c.ratio * 100));
  $('rv').textContent = Math.round(c.ratio * 100) + '%';
}

export function initHud(c: Ctx) {
  const bar = $('bar');
  bar.innerHTML = `<label title="Shift + mouse wheel">Attack <span id="rv"></span> <input id="ratio" type="range" min="1" max="100" /></label>`;
  const ratio = $('ratio') as HTMLInputElement;
  ratio.oninput = () => setRatio(c, Number(ratio.value) / 100);
  setRatio(c, c.ratio);
  modeButtons = MODES.map((m, k) => button(`${k + 1} ${modeLabel(m)}`, bar, () => setMode(c, c.mode === m ? null : m)));

  const panel = $('spawn');
  panel.innerHTML = `<div>Pick a doctrine, then click the map to spawn — <b id="spawnt"></b></div>`;
  for (const [k, desc] of Object.entries(DOCTRINES) as [Doctrine, string][]) {
    const b = button(k[0].toUpperCase() + k.slice(1), panel, () => {
      c.doctrine = k;
      panel.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      if (c.spawnAt >= 0) spawn(c, c.spawnAt);
    }, desc);
    b.classList.toggle('on', k === c.doctrine);
  }
  setInterval(() => updateHud(c), HUD_MS);
}

let seenEvents = -1;
function updateHud(c: Ctx) {
  const { g, me, p } = c;
  const ping = net.online ? ` · 📶 ${Math.round(net.rtt)}ms` : '';
  const behind = c.runner.behind > CATCHUP_SHOWN ? `<br><b>⏩ Catching up… ${c.runner.behind} turns</b>` : '';
  $('stats').innerHTML = `<b>${esc(p.name)}</b> · ${p.doctrine}${ping}<br>
    ⚔ Troops: ${fmt(p.troops)} / ${fmt(g.maxTroops(p))}<br>
    💰 Gold: ${fmt(p.gold)} <small>(+${fmt(g.goldRate(p) * (1000 / TICK_MS))}/s)</small><br>
    🗺 Land: ${pct(p.tiles, g.landTiles)}<br>
    Resources: 🛢${p.oil} ⛏${p.mines} 🌾${p.fertile}<br>
    ${g.isNight() ? '🌙 Night — defenders +25%' : '☀️ Day'}
    ${g.seaLevel > SEA ? '<br>🌊 The sea is rising' : ''}
    ${p.alive ? '' : '<br><b>Eliminated — spectating</b>'}${behind}`;

  const top = g.players.filter(x => x.alive).sort((a, b) => b.tiles - a.tiles).slice(0, BOARD_SIZE);
  $('board').innerHTML = '<b>Leaderboard</b>' + top.map(x => {
    const tags = (g.allied(me, x.id) ? '🤝' : '') + (p.embargo.includes(x.id) ? '🚫' : '') + (g.bounties.some(b => b.target === x.id) ? '🎯' : '');
    return `<div class="${x.id === me ? 'me' : ''}"><span>${tags} ${esc(x.name)}</span><span>${pct(x.tiles, g.landTiles)} · ${g.canSee(me, x.id) ? fmt(x.troops) : '?'}</span></div>`;
  }).join('');

  modeButtons.forEach((b, k) => {
    const cost = costOf(c, MODES[k]);
    b.classList.toggle('poor', p.gold < cost);
    b.title = `${DESC[MODES[k]]} — ${fmt(cost)} gold`;
  });

  $('spawn').classList.toggle('hidden', g.tick >= SPAWN_TICKS || c.runner.behind > BUFFER_TURNS);
  $('spawnt').textContent = `${Math.ceil(((SPAWN_TICKS - g.tick) * TICK_MS) / 1000)}s`;

  if (g.eventCount !== seenEvents) {
    seenEvents = g.eventCount;
    const log = $('log');
    log.innerHTML = '';
    for (const ev of g.events.filter(ev => !ev.to || ev.to === me).slice(-LOG_LINES)) {
      const div = document.createElement('div');
      div.textContent = ev.text;
      const from = ev.allyFrom;
      if (from && !g.allied(me, from)) {
        const b = button('Accept', div, () => { c.send({ type: 'ally', target: from }); b.remove(); });
      }
      log.append(div);
    }
  }

  const over = $('over');
  if (g.winner && over.classList.contains('hidden')) {
    over.classList.remove('hidden');
    over.innerHTML = `<h2>${g.winner === me ? '🏆 Victory!' : 'Game over'}</h2><p>${g.winner > 0 ? esc(g.pl(g.winner).name) + ' wins' : 'Nobody survived'}</p>`;
    button('Back to menu', over, () => location.reload());
  }
}

export function openMenu(c: Ctx, i: number, sx: number, sy: number) {
  const { g, me, p } = c, menu = $('ctx');
  if (g.tick < SPAWN_TICKS || !p.alive) return;
  const o = g.owner[i], land = g.isLand(i);
  menu.innerHTML = `<b>${o ? esc(g.pl(o).name) : land ? 'Wilderness' : 'Sea'}</b><small>${TERRAIN[g.map.terrain[i]]}${RESOURCE[g.map.resource[i]] ?? ''}</small>`;
  const add = (label: string, fn: () => void, cost = 0, title = '', parent: HTMLElement = menu) => {
    const b = button(cost ? `${label} · ${fmt(cost)}` : label, parent, () => { menu.classList.add('hidden'); fn(); }, title);
    if (cost > p.gold) { b.classList.add('poor'); b.title = `Need ${fmt(cost)} gold`; }
  };

  if (o === me) {
    for (const k of BUILDS) if ((k !== 'port' || g.isCoastal(i)) && (k !== 'warship' || g.count(p, 'port')))
      add(`Build ${LABELS[k]}`, () => useMode(c, k, i), g.cost(p, k), DESC[k]);
  } else if (land && !(o && g.allied(me, o))) add(g.borders(me, o) ? `⚔ Attack (${Math.round(c.ratio * 100)}%)` : '⛵ Send boat', () => doAttack(c, i));
  if (g.readySilo(me) && o !== me) add('☢ Launch nuke here', () => useMode(c, 'nuke', i), COSTS.nuke, DESC.nuke);
  if (g.enemyStructureNear(me, i)) add('🧨 Sabotage structure', () => useMode(c, 'sabotage', i), COSTS.sabotage, DESC.sabotage);

  if (o && o !== me) {
    const t = g.pl(o);
    menu.insertAdjacentHTML('beforeend', `<small>${t.doctrine} · troops ${g.canSee(me, o) ? fmt(t.troops) : '?'}</small>`);
    if (g.allied(me, o)) add('💔 Break alliance', () => c.send({ type: 'unally', target: o }));
    else add(g.allyRequests.has(`${o}>${me}`) ? '🤝 Accept alliance' : '🤝 Request alliance', () => c.send({ type: 'ally', target: o }));
    add('🕵 Spy on troops', () => pay(c, COSTS.spy, 'Spies', { type: 'spy', target: o }), COSTS.spy, 'Reveal troops for 30s');
    add('🎯 Place bounty', () => pay(c, COSTS.bounty, 'Bounty', { type: 'bounty', target: o }), COSTS.bounty, 'Paid to whoever captures most of their land when they die');
    add(p.embargo.includes(o) ? '✅ Lift embargo' : '🚫 Embargo', () => c.send({ type: 'embargo', target: o }), 0, 'Stops trade ships between you');
    const emo = document.createElement('div');
    emo.className = 'emo';
    menu.append(emo);
    for (const e of EMOJIS) add(e, () => c.send({ type: 'emoji', target: o, emoji: e }), 0, '', emo);
  }
  if (menu.children.length <= 2) return;
  menu.classList.remove('hidden');
  menu.style.left = Math.min(sx, innerWidth - menu.offsetWidth - 10) + 'px';
  menu.style.top = Math.min(sy, innerHeight - menu.offsetHeight - 10) + 'px';
}
