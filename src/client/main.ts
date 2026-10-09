import { Game, SPAWN_TICKS } from '../core/game';
import { SEA } from '../core/map';
import { botName, ClientMsg, COSTS, Doctrine, DOCTRINES, EMOJIS, GameConfig, Intent, IntentBody, ServerMsg, StructureType, TICK_MS } from '../core/types';
import { fmt, Renderer } from './render';

type Mode = StructureType | 'nuke' | 'sabotage' | null;

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const nameInput = $('name') as HTMLInputElement;
nameInput.value = localStorage.getItem('name') ?? `Player${Math.floor(Math.random() * 1000)}`;
const myName = () => {
  const n = nameInput.value.trim().slice(0, 16) || 'Player';
  localStorage.setItem('name', n);
  return n;
};

let game: Game | null = null;
const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
const send = (m: ClientMsg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

ws.onopen = () => send({ t: 'list' });
ws.onclose = () => { if (!game) $('lobbies').innerHTML = '<i>Server offline — singleplayer only</i>'; };
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
    case 'start':
      startGame(m.config, m.me, intent => send({ t: 'intent', intent }));
      break;
    case 'turn':
      game?.step(m.intents);
      break;
    case 'error':
      alert(m.msg);
  }
};

$('sp').onclick = () => {
  const players = [{ name: myName(), bot: false }, ...Array.from({ length: 15 }, (_, i) => ({ name: botName(i), bot: true }))];
  let buf: Intent[] = [];
  const g = startGame({ seed: Math.floor(Math.random() * 2 ** 31), players }, 1, it => buf.push({ ...it, p: 1 } as Intent));
  setInterval(() => { g.step(buf); buf = []; }, TICK_MS);
};
$('create').onclick = () => send({ t: 'create', name: myName(), bots: Number(($('bots') as HTMLInputElement).value) });
$('joincode').onclick = () => send({ t: 'joinCode', name: myName(), code: ($('code') as HTMLInputElement).value });

function startGame(cfg: GameConfig, me: number, sendIntent: (i: IntentBody) => void) {
  const g = new Game(cfg);
  game = g;
  $('menu').classList.add('hidden');
  $('lobby').classList.add('hidden');
  $('hud').classList.remove('hidden');
  const canvas = $('c') as HTMLCanvasElement;
  const r = new Renderer(canvas, g, me);
  const ctxMenu = $('ctx');
  let ratio = 0.3, mode: Mode = null, doctrine: Doctrine = 'blitz', spawnAt: [number, number] | null = null;

  const modes: [Mode, string, number][] = [
    ['city', 'City', COSTS.city], ['port', 'Port', COSTS.port], ['defense', 'Defense', COSTS.defense],
    ['silo', 'Silo', COSTS.silo], ['nuke', 'Nuke', COSTS.nuke], ['sabotage', 'Sabotage', COSTS.sabotage],
  ];
  const bar = $('bar');
  bar.innerHTML = `<label>Attack <span id="rv">30%</span> <input id="ratio" type="range" min="1" max="100" value="30" /></label>`;
  const ratioInput = $('ratio') as HTMLInputElement;
  ratioInput.oninput = () => { ratio = Number(ratioInput.value) / 100; $('rv').textContent = ratioInput.value + '%'; };
  const modeButtons = modes.map(([m, label, cost], k) => {
    const b = document.createElement('button');
    b.textContent = `${k + 1} ${label} ${fmt(cost)}`;
    b.title = m === 'sabotage' ? 'Click an enemy structure to disable it for 60s' : m === 'nuke' ? 'Needs a silo' : '';
    b.onclick = () => setMode(mode === m ? null : m);
    bar.append(b);
    return b;
  });
  const setMode = (m: Mode) => {
    mode = m;
    modeButtons.forEach((b, k) => b.classList.toggle('on', modes[k][0] === m));
    canvas.style.cursor = m ? 'crosshair' : '';
  };

  const spawn = $('spawn');
  spawn.innerHTML = `<div>Pick a doctrine, then click the map to spawn — <b id="spawnt"></b></div>`;
  for (const [k, desc] of Object.entries(DOCTRINES) as [Doctrine, string][]) {
    const b = document.createElement('button');
    b.textContent = k[0].toUpperCase() + k.slice(1);
    b.title = desc;
    b.classList.toggle('on', k === doctrine);
    b.onclick = () => {
      doctrine = k;
      spawn.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      if (spawnAt) sendIntent({ type: 'spawn', x: spawnAt[0], y: spawnAt[1], doctrine });
    };
    spawn.append(b);
  }

  const click = (sx: number, sy: number) => {
    const [x, y] = r.toTile(sx, sy), i = g.tileAt(x, y);
    if (i < 0) return;
    if (g.tick < SPAWN_TICKS) { spawnAt = [x, y]; return sendIntent({ type: 'spawn', x, y, doctrine }); }
    if (mode) {
      const m = mode;
      setMode(null);
      if (m === 'nuke') sendIntent({ type: 'nuke', x, y });
      else if (m === 'sabotage') sendIntent({ type: 'sabotage', x, y });
      else sendIntent({ type: 'build', x, y, kind: m });
      return;
    }
    const o = g.owner[i];
    if (o === me || !g.isLand(i)) return;
    if (g.borders(me, o)) sendIntent({ type: 'attack', target: o, ratio });
    else if (g.isCoastal(i)) sendIntent({ type: 'boat', x, y, ratio });
  };

  const openCtx = (o: number, sx: number, sy: number) => {
    const p = g.pl(o);
    ctxMenu.innerHTML = `<b>${esc(p.name)}</b><small>${p.doctrine} · troops ${g.canSee(me, o) ? fmt(p.troops) : '?'}</small>`;
    ctxMenu.style.left = sx + 'px';
    ctxMenu.style.top = sy + 'px';
    ctxMenu.classList.remove('hidden');
    const add = (label: string, intent: IntentBody, parent: HTMLElement = ctxMenu) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => { sendIntent(intent); ctxMenu.classList.add('hidden'); };
      parent.append(b);
    };
    if (g.allied(me, o)) add('Break alliance', { type: 'unally', target: o });
    else add(g.allyRequests.has(`${o}>${me}`) ? 'Accept alliance' : 'Request alliance', { type: 'ally', target: o });
    add(`Spy on troops (${fmt(COSTS.spy)})`, { type: 'spy', target: o });
    add(`Place bounty (${fmt(COSTS.bounty)})`, { type: 'bounty', target: o });
    const emo = document.createElement('div');
    emo.className = 'emo';
    ctxMenu.append(emo);
    for (const e of EMOJIS) add(e, { type: 'emoji', target: o, emoji: e }, emo);
  };

  let down: { x: number; y: number; moved: boolean } | null = null, lx = 0, ly = 0;
  canvas.onmousedown = e => {
    ctxMenu.classList.add('hidden');
    if (e.button === 0) { down = { x: e.clientX, y: e.clientY, moved: false }; lx = e.clientX; ly = e.clientY; }
  };
  addEventListener('mousemove', e => {
    if (!down) return;
    if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 5) down.moved = true;
    if (down.moved) { r.ox += e.clientX - lx; r.oy += e.clientY - ly; }
    lx = e.clientX;
    ly = e.clientY;
  });
  addEventListener('mouseup', e => {
    if (down && !down.moved && e.button === 0) click(e.clientX, e.clientY);
    down = null;
  });
  canvas.oncontextmenu = e => {
    e.preventDefault();
    const [x, y] = r.toTile(e.clientX, e.clientY), i = g.tileAt(x, y);
    if (i >= 0 && g.owner[i] && g.owner[i] !== me) openCtx(g.owner[i], e.clientX, e.clientY);
  };
  canvas.addEventListener('wheel', e => r.zoom(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15), { passive: true });
  addEventListener('keydown', e => {
    if (e.key === 'Escape') setMode(null);
    const k = Number(e.key);
    if (k >= 1 && k <= modes.length) setMode(modes[k - 1][0]);
  });

  let seenEvents = -1;
  const hud = () => {
    const p = g.pl(me);
    $('stats').innerHTML = `<b>${esc(p.name)}</b> · ${p.doctrine}<br>
      Troops: ${fmt(p.troops)} / ${fmt(g.maxTroops(p))}<br>
      Gold: ${fmt(p.gold)}<br>
      Land: ${((p.tiles / g.landTiles) * 100).toFixed(1)}%<br>
      Resources: 🛢${p.oil} ⛏${p.mines} 🌾${p.fertile}<br>
      ${g.isNight() ? '🌙 Night — defenders +25%' : '☀️ Day'}
      ${g.seaLevel > SEA ? '<br>🌊 The sea is rising' : ''}
      ${p.alive ? '' : '<br><b>Eliminated — spectating</b>'}`;

    const top = g.players.filter(x => x.alive).sort((a, b) => b.tiles - a.tiles).slice(0, 10);
    $('board').innerHTML = '<b>Leaderboard</b>' + top.map(x =>
      `<div class="${x.id === me ? 'me' : ''}"><span>${g.allied(me, x.id) ? '🤝 ' : ''}${esc(x.name)}</span><span>${((x.tiles / g.landTiles) * 100).toFixed(1)}% · ${g.canSee(me, x.id) ? fmt(x.troops) : '?'}</span></div>`).join('');

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
          const b = document.createElement('button');
          b.textContent = 'Accept';
          b.onclick = () => { sendIntent({ type: 'ally', target: from }); b.remove(); };
          div.append(b);
        }
        log.append(div);
      }
    }

    if (g.winner) {
      const over = $('over');
      if (over.classList.contains('hidden')) {
        over.classList.remove('hidden');
        over.innerHTML = `<h2>${g.winner === me ? '🏆 Victory!' : 'Game over'}</h2><p>${g.winner > 0 ? esc(g.pl(g.winner).name) + ' wins' : 'Nobody survived'}</p>`;
        const b = document.createElement('button');
        b.textContent = 'Back to menu';
        b.onclick = () => location.reload();
        over.append(b);
      }
    }
  };

  const frame = () => { r.draw(); requestAnimationFrame(frame); };
  frame();
  setInterval(hud, 250);
  return g;
}
