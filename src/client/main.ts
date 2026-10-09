import { Game, SPAWN_TICKS } from '../core/game';
import { FERTILE, GOLD, OIL, SEA, W } from '../core/map';
import {
  botName, BuildKind, BUILDS, ClientMsg, COSTS, Doctrine, DOCTRINES, EMOJIS, GameConfig, Intent, IntentBody, LABELS, ServerMsg, TICK_MS,
} from '../core/types';
import { fmt, Renderer } from './render';

type Mode = BuildKind | 'nuke' | 'sabotage' | null;

const DESC: Record<string, string> = {
  city: '+15k max troops', port: 'Gold income + trade ships (coast only)', defense: '3x defense within 12 tiles',
  silo: 'Launches nukes', sam: 'Intercepts nukes within 30 tiles', warship: 'Patrols near your port, sinks enemy ships',
  nuke: 'Needs a ready silo', sabotage: 'Disable an enemy structure for 60s',
};
const TERRAIN = ['Sea', 'Plains', 'Highlands', 'Mountains'];
const RESOURCE: Record<number, string> = { [OIL]: ' · 🛢 Oil', [GOLD]: ' · ⛏ Gold mine', [FERTILE]: ' · 🌾 Fertile' };

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const nameInput = $('name') as HTMLInputElement;
nameInput.value = localStorage.getItem('name') ?? `Player${Math.floor(Math.random() * 1000)}`;
const myName = () => {
  const n = nameInput.value.trim().slice(0, 16) || 'Player';
  localStorage.setItem('name', n);
  return n;
};
const cid = sessionStorage.getItem('cid') ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
sessionStorage.setItem('cid', cid);

let toastTimer = 0;
const toast = (msg: string) => {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.add('hidden'), 2500);
};

let game: Game | null = null, renderer: Renderer | null = null, online = false;
const stepGame = (g: Game, intents: Intent[]) => {
  g.step(intents);
  if (renderer) renderer.stepAt = performance.now();
};

const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
const send = (m: ClientMsg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

ws.onopen = () => { send({ t: 'hello', cid }); send({ t: 'list' }); };
ws.onclose = () => {
  if (game && online) { toast('Connection lost — reconnecting…'); setTimeout(() => location.reload(), 2000); }
  else if (!game) $('lobbies').innerHTML = '<i>Server offline — singleplayer only</i>';
};
setInterval(() => { if (!game) send({ t: 'list' }); }, 2000);

ws.onmessage = e => {
  const m: ServerMsg = JSON.parse(e.data);
  switch (m.t) {
    case 'lobbies': {
      const el = $('lobbies');
      el.innerHTML = '';
      for (const l of m.lobbies) {
        const b = document.createElement('button');
        b.textContent = `Join public game (${l.players} players${l.startsIn ? `, starts in ${l.startsIn}s` : ''})`;
        b.onclick = () => send({ t: 'joinPublic', name: myName(), id: l.id });
        el.append(b);
      }
      break;
    }
    case 'lobby': {
      $('menu').classList.add('hidden');
      const el = $('lobby');
      el.classList.remove('hidden');
      el.innerHTML = `<h2>${m.startsIn === null ? `Private game · code <b>${m.code}</b>` : 'Public game'}</h2>
        <p>${m.startsIn === null ? 'Share the code with friends. Bots fill empty slots.' : `Starting in ${m.startsIn}s…`}</p>
        <div>${m.players.map(n => `<div>• ${esc(n)}</div>`).join('')}</div>`;
      if (m.host) {
        const b = document.createElement('button');
        b.textContent = 'Start game';
        b.onclick = () => send({ t: 'start' });
        el.append(b);
      }
      break;
    }
    case 'start': {
      if (game) break;
      online = true;
      const g = startGame(m.config, m.me, intent => send({ t: 'intent', intent }));
      if (m.turns?.length) {
        for (const t of m.turns) g.step(t);
        toast('Rejoined the running game');
      }
      break;
    }
    case 'turn':
      if (!game) break;
      stepGame(game, m.intents);
      if (game.tick % 50 === 0) send({ t: 'hash', tick: game.tick, hash: game.hash() });
      break;
    case 'desync':
      toast(`⚠ Desync detected at tick ${m.tick} — your game state differs from other players`);
      break;
    case 'error':
      toast(m.msg);
  }
};

$('sp').onclick = () => {
  const players = [{ name: myName(), bot: false }, ...Array.from({ length: 15 }, (_, i) => ({ name: botName(i), bot: true }))];
  let buf: Intent[] = [];
  const g = startGame({ seed: Math.floor(Math.random() * 2 ** 31), players }, 1, it => buf.push({ ...it, p: 1 } as Intent));
  setInterval(() => { stepGame(g, buf); buf = []; }, TICK_MS);
};
$('create').onclick = () => send({ t: 'create', name: myName(), bots: Number(($('bots') as HTMLInputElement).value) });
$('joincode').onclick = () => send({ t: 'joinCode', name: myName(), code: ($('code') as HTMLInputElement).value });

function button(label: string, parent: HTMLElement, onclick: () => void, title = '') {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.onclick = onclick;
  parent.append(b);
  return b;
}

function startGame(cfg: GameConfig, me: number, sendIntent: (i: IntentBody) => void) {
  const g = new Game(cfg);
  game = g;
  $('menu').classList.add('hidden');
  $('lobby').classList.add('hidden');
  $('hud').classList.remove('hidden');
  const canvas = $('c') as HTMLCanvasElement;
  const r = (renderer = new Renderer(canvas, g, me));
  const menu = $('ctx');
  const p = g.pl(me);
  let ratio = 0.3, mode: Mode = null, doctrine: Doctrine = 'blitz', spawnAt: [number, number] | null = null;

  const costOf = (m: Exclude<Mode, null>) => (m === 'nuke' || m === 'sabotage' ? COSTS[m] : g.cost(p, m));
  const pay = (cost: number, what: string, intent: IntentBody) => {
    if (p.gold < cost) return toast(`Not enough gold for ${what} — need ${fmt(cost)}, have ${fmt(p.gold)}`);
    sendIntent(intent);
  };

  const doAttack = (i: number) => {
    const o = g.owner[i], x = i % W, y = (i / W) | 0;
    if (o === me || !g.isLand(i)) return;
    if (o && g.allied(me, o)) return toast(`${g.pl(o).name} is your ally — break the alliance first`);
    if (g.borders(me, o)) return sendIntent({ type: 'attack', target: o, ratio });
    if (!g.isCoastal(i)) return toast('No shared border and not a coast — cannot reach');
    if (g.ships.filter(s => s.kind === 'transport' && s.p === me).length >= 3) return toast('Max 3 transports at sea');
    if (!g.routeTo(me, i)) return toast('No sea route from your coast');
    sendIntent({ type: 'boat', x, y, ratio });
  };

  const useMode = (m: Exclude<Mode, null>, x: number, y: number) => {
    const i = g.tileAt(x, y), cost = costOf(m);
    if (m === 'nuke') {
      if (!g.readySilo(me)) return toast('You need a ready missile silo');
      return pay(cost, 'a nuke', { type: 'nuke', x, y });
    }
    if (m === 'sabotage') {
      if (!g.enemyStructureNear(me, i)) return toast('No enemy structure there');
      return pay(cost, 'sabotage', { type: 'sabotage', x, y });
    }
    if (m === 'warship' ? !g.count(p, 'port') : g.owner[i] !== me) return toast(m === 'warship' ? 'You need a port' : 'Build on your own land');
    if (m === 'port' && !g.isCoastal(i)) return toast('Ports must be on the coast');
    pay(cost, LABELS[m], { type: 'build', x, y, kind: m });
  };

  const bar = $('bar');
  bar.innerHTML = `<label title="Shift + mouse wheel">Attack <span id="rv"></span> <input id="ratio" type="range" min="1" max="100" /></label>`;
  const ratioInput = $('ratio') as HTMLInputElement;
  const setRatio = (v: number) => {
    ratio = Math.min(1, Math.max(0.01, Math.round(v * 100) / 100));
    ratioInput.value = String(Math.round(ratio * 100));
    $('rv').textContent = ratioInput.value + '%';
  };
  setRatio(ratio);
  ratioInput.oninput = () => setRatio(Number(ratioInput.value) / 100);
  const modes: Exclude<Mode, null>[] = [...BUILDS, 'nuke', 'sabotage'];
  const setMode = (m: Mode) => {
    mode = m;
    modeButtons.forEach((b, k) => b.classList.toggle('on', modes[k] === m));
    canvas.style.cursor = m ? 'crosshair' : '';
  };
  const modeButtons = modes.map((m, k) =>
    button(`${k + 1} ${m === 'nuke' ? 'Nuke' : m === 'sabotage' ? 'Sabotage' : LABELS[m]}`, bar, () => setMode(mode === m ? null : m), DESC[m]));

  const spawn = $('spawn');
  spawn.innerHTML = `<div>Pick a doctrine, then click the map to spawn — <b id="spawnt"></b></div>`;
  for (const [k, desc] of Object.entries(DOCTRINES) as [Doctrine, string][]) {
    const b = button(k[0].toUpperCase() + k.slice(1), spawn, () => {
      doctrine = k;
      spawn.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      if (spawnAt) sendIntent({ type: 'spawn', x: spawnAt[0], y: spawnAt[1], doctrine });
    }, desc);
    b.classList.toggle('on', k === doctrine);
  }

  const click = (sx: number, sy: number) => {
    const [x, y] = r.toTile(sx, sy), i = g.tileAt(x, y);
    if (i < 0) return;
    if (g.tick < SPAWN_TICKS) {
      if (!g.isLand(i)) return toast('Spawn on land');
      spawnAt = [x, y];
      return sendIntent({ type: 'spawn', x, y, doctrine });
    }
    if (!p.alive) return;
    if (mode) {
      const m = mode;
      setMode(null);
      return useMode(m, x, y);
    }
    doAttack(i);
  };

  const openMenu = (sx: number, sy: number) => {
    const [x, y] = r.toTile(sx, sy), i = g.tileAt(x, y);
    if (i < 0 || g.tick < SPAWN_TICKS || !p.alive) return;
    const o = g.owner[i], land = g.isLand(i);
    menu.innerHTML = `<b>${o ? esc(g.pl(o).name) : land ? 'Wilderness' : 'Sea'}</b><small>${TERRAIN[g.map.terrain[i]]}${RESOURCE[g.map.resource[i]] ?? ''}</small>`;
    const close = (fn: () => void) => () => { menu.classList.add('hidden'); fn(); };
    const add = (label: string, fn: () => void, cost = 0, title = '', parent: HTMLElement = menu) => {
      const b = button(cost ? `${label} · ${fmt(cost)}` : label, parent, close(fn), title);
      if (cost > p.gold) { b.classList.add('poor'); b.title = `Need ${fmt(cost)} gold`; }
    };
    if (o === me) {
      for (const k of BUILDS) if ((k !== 'port' || g.isCoastal(i)) && (k !== 'warship' || g.count(p, 'port')))
        add(`Build ${LABELS[k]}`, () => useMode(k, x, y), g.cost(p, k), DESC[k]);
    } else if (land && !(o && g.allied(me, o))) add(g.borders(me, o) ? `⚔ Attack (${Math.round(ratio * 100)}%)` : '⛵ Send boat', () => doAttack(i));
    if (g.readySilo(me) && o !== me) add('☢ Launch nuke here', () => useMode('nuke', x, y), COSTS.nuke, DESC.nuke);
    if (g.enemyStructureNear(me, i)) add('🧨 Sabotage structure', () => useMode('sabotage', x, y), COSTS.sabotage, DESC.sabotage);
    if (o && o !== me) {
      const t = g.pl(o);
      menu.insertAdjacentHTML('beforeend', `<small>${t.doctrine} · troops ${g.canSee(me, o) ? fmt(t.troops) : '?'}</small>`);
      if (g.allied(me, o)) add('💔 Break alliance', () => sendIntent({ type: 'unally', target: o }));
      else add(g.allyRequests.has(`${o}>${me}`) ? '🤝 Accept alliance' : '🤝 Request alliance', () => sendIntent({ type: 'ally', target: o }));
      add('🕵 Spy on troops', () => pay(COSTS.spy, 'spies', { type: 'spy', target: o }), COSTS.spy, 'Reveal troops for 30s');
      add('🎯 Place bounty', () => pay(COSTS.bounty, 'a bounty', { type: 'bounty', target: o }), COSTS.bounty, 'Paid to whoever captures most of their land when they die');
      add(p.embargo.includes(o) ? '✅ Lift embargo' : '🚫 Embargo', () => sendIntent({ type: 'embargo', target: o }), 0, 'Stops trade ships between you');
      const emo = document.createElement('div');
      emo.className = 'emo';
      menu.append(emo);
      for (const e of EMOJIS) add(e, () => sendIntent({ type: 'emoji', target: o, emoji: e }), 0, '', emo);
    }
    if (menu.children.length <= 2) return;
    menu.classList.remove('hidden');
    menu.style.left = Math.min(sx, innerWidth - menu.offsetWidth - 10) + 'px';
    menu.style.top = Math.min(sy, innerHeight - menu.offsetHeight - 10) + 'px';
  };

  let down: { x: number; y: number; moved: boolean } | null = null, lx = 0, ly = 0;
  canvas.onmousedown = e => {
    menu.classList.add('hidden');
    if (e.button === 0) { down = { x: e.clientX, y: e.clientY, moved: false }; lx = e.clientX; ly = e.clientY; }
  };
  addEventListener('mousemove', e => {
    const [x, y] = r.toTile(e.clientX, e.clientY), i = g.tileAt(x, y);
    r.hover = i >= 0 ? g.owner[i] : 0;
    if (!down) return;
    if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 5) down.moved = true;
    if (down.moved) { r.ox += e.clientX - lx; r.oy += e.clientY - ly; }
    lx = e.clientX;
    ly = e.clientY;
  });
  canvas.onmouseup = e => { if (down && !down.moved && e.button === 0) click(e.clientX, e.clientY); };
  addEventListener('mouseup', () => { down = null; });
  canvas.oncontextmenu = e => { e.preventDefault(); openMenu(e.clientX, e.clientY); };
  canvas.addEventListener('wheel', e => {
    const d = e.deltaY || e.deltaX;
    if (e.shiftKey) setRatio(ratio + (d < 0 ? 0.05 : -0.05));
    else r.zoom(e.clientX, e.clientY, d < 0 ? 1.2 : 1 / 1.2);
  }, { passive: true });
  addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
    if (e.key === 'Escape') { setMode(null); menu.classList.add('hidden'); }
    const k = Number(e.key);
    if (k >= 1 && k <= modes.length) setMode(mode === modes[k - 1] ? null : modes[k - 1]);
  });

  let seenEvents = -1;
  const hud = () => {
    $('stats').innerHTML = `<b>${esc(p.name)}</b> · ${p.doctrine}<br>
      ⚔ Troops: ${fmt(p.troops)} / ${fmt(g.maxTroops(p))}<br>
      💰 Gold: ${fmt(p.gold)} <small>(+${fmt(g.goldRate(p) * (1000 / TICK_MS))}/s)</small><br>
      🗺 Land: ${((p.tiles / g.landTiles) * 100).toFixed(1)}%<br>
      Resources: 🛢${p.oil} ⛏${p.mines} 🌾${p.fertile}<br>
      ${g.isNight() ? '🌙 Night — defenders +25%' : '☀️ Day'}
      ${g.seaLevel > SEA ? '<br>🌊 The sea is rising' : ''}
      ${p.alive ? '' : '<br><b>Eliminated — spectating</b>'}`;

    const top = g.players.filter(x => x.alive).sort((a, b) => b.tiles - a.tiles).slice(0, 10);
    $('board').innerHTML = '<b>Leaderboard</b>' + top.map(x => {
      const tags = (g.allied(me, x.id) ? '🤝' : '') + (p.embargo.includes(x.id) ? '🚫' : '') + (g.bounties.some(b => b.target === x.id) ? '🎯' : '');
      return `<div class="${x.id === me ? 'me' : ''}"><span>${tags} ${esc(x.name)}</span><span>${((x.tiles / g.landTiles) * 100).toFixed(1)}% · ${g.canSee(me, x.id) ? fmt(x.troops) : '?'}</span></div>`;
    }).join('');

    modeButtons.forEach((b, k) => {
      const cost = costOf(modes[k]);
      b.classList.toggle('poor', p.gold < cost);
      b.title = `${DESC[modes[k]]} — ${fmt(cost)} gold`;
    });

    spawn.classList.toggle('hidden', g.tick >= SPAWN_TICKS);
    $('spawnt').textContent = `${Math.ceil(((SPAWN_TICKS - g.tick) * TICK_MS) / 1000)}s`;

    if (g.eventCount !== seenEvents) {
      seenEvents = g.eventCount;
      const log = $('log');
      log.innerHTML = '';
      for (const ev of g.events.filter(ev => !ev.to || ev.to === me).slice(-8)) {
        const div = document.createElement('div');
        div.textContent = ev.text;
        const from = ev.allyFrom;
        if (from && !g.allied(me, from)) {
          const b = button('Accept', div, () => { sendIntent({ type: 'ally', target: from }); b.remove(); });
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
  };

  const frame = () => { r.draw(); requestAnimationFrame(frame); };
  frame();
  setInterval(hud, 250);
  return g;
}
