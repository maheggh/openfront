import { botName, BUFFER_TURNS, HASH_EVERY, TICK_MS } from '../core/config';
import { Game } from '../core/game';
import type { GameConfig, Intent, IntentBody, ServerMsg } from '../core/types';
import type { Ctx } from './actions';
import { $, button, esc, toast } from './dom';
import { bindInput } from './input';
import { connect, net, send } from './net';
import { Renderer } from './render';
import { Runner } from './runner';
import { initHud } from './ui';

const SP_BOTS = 15, LIST_MS = 2000, RECONNECT_MS = 2000;

const nameInput = $('name') as HTMLInputElement;
nameInput.value = localStorage.getItem('name') ?? `Player${Math.floor(Math.random() * 1000)}`;
const myName = () => {
  const n = nameInput.value.trim().slice(0, 16) || 'Player';
  localStorage.setItem('name', n);
  return n;
};

let runner: Runner | null = null;

connect(onMessage, () => {
  if (runner && net.online) { toast('Connection lost — reconnecting…'); setTimeout(() => location.reload(), RECONNECT_MS); }
  else if (!runner) $('lobbies').innerHTML = '<i>Server offline — singleplayer only</i>';
});
setInterval(() => { if (!runner) send({ t: 'list' }); }, LIST_MS);

function onMessage(m: ServerMsg) {
  switch (m.t) {
    case 'lobbies': {
      const el = $('lobbies');
      el.innerHTML = '';
      for (const l of m.lobbies)
        button(`Join public game (${l.players} players${l.startsIn ? `, starts in ${l.startsIn}s` : ''})`, el, () => send({ t: 'joinPublic', name: myName(), id: l.id }));
      break;
    }
    case 'lobby': {
      $('menu').classList.add('hidden');
      const el = $('lobby');
      el.classList.remove('hidden');
      el.innerHTML = `<h2>${m.startsIn === null ? `Private game · code <b>${m.code}</b>` : 'Public game'}</h2>
        <p>${m.startsIn === null ? 'Share the code with friends. Bots fill empty slots.' : `Starting in ${m.startsIn}s…`}</p>
        <div>${m.players.map(n => `<div>• ${esc(n)}</div>`).join('')}</div>`;
      if (m.host) button('Start game', el, () => send({ t: 'start' }));
      break;
    }
    case 'start':
      if (runner) break;
      net.online = true;
      runner = startGame(m.config, m.me, intent => send({ t: 'intent', intent }));
      if (m.turns?.length) runner.queue = m.turns;
      break;
    case 'turn':
      runner?.push(m.i ?? []);
      break;
    case 'desync':
      if (sessionStorage.getItem('resynced')) toast(`⚠ Desync at tick ${m.tick}: your game differs from the others. Reload to resync.`);
      else {
        sessionStorage.setItem('resynced', '1');
        toast('Desync detected — replaying the game to resync…');
        setTimeout(() => location.reload(), RECONNECT_MS);
      }
      break;
    case 'error':
      toast(m.msg);
  }
}

$('sp').onclick = () => {
  const players = [{ name: myName(), bot: false }, ...Array.from({ length: SP_BOTS }, (_, i) => ({ name: botName(i), bot: true }))];
  let buf: Intent[] = [];
  const rn = (runner = startGame({ seed: Math.floor(Math.random() * 2 ** 31), players }, 1, it => buf.push({ ...it, p: 1 } as Intent)));
  setInterval(() => { rn.push(buf); buf = []; }, TICK_MS);
};
$('create').onclick = () => send({ t: 'create', name: myName(), bots: Number(($('bots') as HTMLInputElement).value) });
$('joincode').onclick = () => send({ t: 'joinCode', name: myName(), code: ($('code') as HTMLInputElement).value });

function startGame(cfg: GameConfig, me: number, sendIntent: (i: IntentBody) => void) {
  const g = new Game(cfg);
  $('menu').classList.add('hidden');
  $('lobby').classList.add('hidden');
  $('hud').classList.remove('hidden');
  const r = new Renderer($('c') as HTMLCanvasElement, g, me);
  const rn = new Runner(g, me, () => {
    if (net.online && g.tick % HASH_EVERY === 0 && rn.behind <= BUFFER_TURNS) send({ t: 'hash', tick: g.tick, hash: g.hash() });
  });
  const c: Ctx = {
    g, me, p: g.pl(me), r, runner: rn, ratio: 0.3, mode: null, doctrine: 'blitz', spawnAt: -1,
    send: (intent, tile = -1, label = '') => {
      rn.pending.push({ tile, label, at: performance.now() });
      sendIntent(intent);
    },
  };
  initHud(c);
  bindInput(c);
  const frame = () => {
    rn.pump();
    r.draw(rn.stepAt, rn.pending);
    requestAnimationFrame(frame);
  };
  frame();
  return rn;
}
