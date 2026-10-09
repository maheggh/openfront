import { readFile } from 'fs/promises';
import { createServer } from 'http';
import { extname, join, normalize } from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { botName, HASH_EVERY, TICK_MS } from '../core/config';
import { cleanIntent, ClientMsg, GameConfig, Intent, ServerMsg } from '../core/types';

interface Client { ws: WebSocket; cid: string; name: string; id: number; room?: Room; lastSeen: number; budget: number }
interface Room {
  code: string; isPublic: boolean; clients: Client[]; host?: Client; bots: number; startAt: number; started: boolean;
  config?: GameConfig; intents: Intent[]; turns: Intent[][]; members: Map<string, number>; hashes: Map<number, number>;
  emptySince: number; timer?: ReturnType<typeof setInterval>;
}

const PORT = Number(process.env.PORT ?? 3001);
const DIST = join(process.cwd(), 'dist');
const PUBLIC_WAIT_MS = 30000, MAX_HUMANS = 12, PUBLIC_BOTS = 16, MAX_BOTS = 40, EMPTY_GRACE_MS = 60000;
const IDLE_MS = 15000, INTENTS_PER_SEC = 20, MAX_BUFFERED = 1 << 20, MAX_PAYLOAD = 64 * 1024, HASH_WINDOW = 50;
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const rooms = new Map<string, Room>();
const clients = new Set<Client>();

const send = (c: Client, m: ServerMsg) => { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m)); };
const secondsUntil = (t: number) => Math.max(0, Math.ceil((t - Date.now()) / 1000));

function newRoom(isPublic: boolean, bots: number) {
  let code = '';
  do code = Math.random().toString(36).slice(2, 7).toUpperCase(); while (rooms.has(code));
  const r: Room = { code, isPublic, clients: [], bots, startAt: 0, started: false, intents: [], turns: [], members: new Map(), hashes: new Map(), emptySince: 0 };
  rooms.set(code, r);
  return r;
}

const publicRoom = () => [...rooms.values()].find(r => r.isPublic && !r.started) ?? newRoom(true, PUBLIC_BOTS);

function lobbyUpdate(r: Room) {
  const players = r.clients.map(c => c.name), startsIn = r.isPublic ? secondsUntil(r.startAt) : null;
  for (const c of r.clients) send(c, { t: 'lobby', code: r.code, players, host: c === r.host, startsIn });
}

function join(c: Client, r: Room, name: string) {
  leave(c);
  c.name = String(name).trim().slice(0, 16) || 'Player';
  r.clients.push(c);
  c.room = r;
  if (!r.isPublic) r.host ??= c;
  if (r.isPublic && !r.startAt) r.startAt = Date.now() + PUBLIC_WAIT_MS;
  if (r.clients.length >= MAX_HUMANS) start(r);
  else lobbyUpdate(r);
}

function leave(c: Client) {
  const r = c.room;
  if (!r) return;
  r.clients = r.clients.filter(x => x !== c);
  c.room = undefined;
  if (r.host === c) r.host = r.clients[0];
  if (r.started) return;
  if (r.clients.length) lobbyUpdate(r);
  else if (r.isPublic) r.startAt = 0;
  else rooms.delete(r.code);
}

function start(r: Room) {
  r.started = true;
  const players = [
    ...r.clients.map(c => ({ name: c.name, bot: false })),
    ...Array.from({ length: r.bots }, (_, i) => ({ name: botName(i), bot: true })),
  ];
  const config: GameConfig = (r.config = { seed: Math.floor(Math.random() * 2 ** 31), players });
  r.clients.forEach((c, i) => {
    c.id = i + 1;
    r.members.set(c.cid, c.id);
    send(c, { t: 'start', config, me: c.id });
  });
  r.timer = setInterval(() => broadcastTurn(r), TICK_MS);
}

function broadcastTurn(r: Room) {
  if (r.clients.length) r.emptySince = 0;
  else if (!r.emptySince) r.emptySince = Date.now();
  else if (Date.now() - r.emptySince > EMPTY_GRACE_MS) { clearInterval(r.timer); rooms.delete(r.code); return; }
  const intents = r.intents;
  r.intents = [];
  r.turns.push(intents);
  const msg = JSON.stringify(intents.length ? { t: 'turn', i: intents } : { t: 'turn' });
  for (const c of r.clients) {
    // A client this far behind can't keep lockstep; dropping it makes it reconnect and replay.
    if (c.ws.bufferedAmount > MAX_BUFFERED) c.ws.terminate();
    else if (c.ws.readyState === WebSocket.OPEN) c.ws.send(msg);
  }
}

function rejoin(c: Client) {
  for (const r of rooms.values()) {
    const id = r.started ? r.members.get(c.cid) : undefined;
    if (!id || !r.config) continue;
    r.clients = r.clients.filter(x => x.cid !== c.cid);
    r.clients.push(c);
    c.room = r;
    c.id = id;
    return send(c, { t: 'start', config: r.config, me: id, turns: r.turns });
  }
}

function checkHash(c: Client, tick: number, hash: number) {
  const r = c.room;
  if (!r?.started || tick > r.turns.length || tick < r.turns.length - HASH_WINDOW * HASH_EVERY) return;
  const h = r.hashes.get(tick);
  if (h === undefined) {
    r.hashes.set(tick, hash);
    if (r.hashes.size > HASH_WINDOW) r.hashes.delete(r.hashes.keys().next().value!);
  } else if (h !== hash) {
    console.warn(`[${r.code}] desync at tick ${tick}: player ${c.id} (${c.name}) disagrees`);
    send(c, { t: 'desync', tick });
  }
}

function handle(c: Client, m: ClientMsg) {
  c.lastSeen = Date.now();
  switch (m.t) {
    case 'hello':
      c.cid = String(m.cid).slice(0, 40);
      return rejoin(c);
    case 'ping':
      return send(c, { t: 'pong', ts: Number(m.ts) });
    case 'list': {
      publicRoom();
      const lobbies = [...rooms.values()].filter(r => r.isPublic && !r.started)
        .map(r => ({ id: r.code, players: r.clients.length, startsIn: r.startAt ? secondsUntil(r.startAt) : 0 }));
      return send(c, { t: 'lobbies', lobbies });
    }
    case 'joinPublic': {
      const r = rooms.get(String(m.id ?? ''));
      return join(c, r && r.isPublic && !r.started ? r : publicRoom(), m.name);
    }
    case 'create':
      return join(c, newRoom(false, Math.min(MAX_BOTS, Math.max(0, Math.floor(Number(m.bots) || 0)))), m.name);
    case 'joinCode': {
      const r = rooms.get(String(m.code).trim().toUpperCase());
      if (!r || r.started) return send(c, { t: 'error', msg: 'Game not found' });
      return join(c, r, m.name);
    }
    case 'start':
      if (c.room && c.room.host === c && !c.room.started) start(c.room);
      return;
    case 'intent': {
      const it = cleanIntent(m.intent);
      if (!c.room?.started || !c.id || !it || c.budget <= 0) return;
      c.budget--;
      c.room.intents.push({ ...it, p: c.id } as Intent);
      return;
    }
    case 'hash':
      return checkHash(c, Number(m.tick), Number(m.hash));
  }
}

setInterval(() => {
  const now = Date.now();
  for (const c of clients) {
    c.budget = INTENTS_PER_SEC;
    if (now - c.lastSeen > IDLE_MS) c.ws.terminate();
  }
  for (const r of rooms.values()) {
    if (r.started || !r.isPublic || !r.clients.length) continue;
    if (now >= r.startAt) start(r);
    else lobbyUpdate(r);
  }
}, 1000);

const server = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  const file = normalize(join(DIST, url === '/' ? 'index.html' : url));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' }).end(data);
  } catch {
    try {
      const data = await readFile(join(DIST, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(data);
    } catch {
      res.writeHead(404).end('Run "npm run build" first, or use "npm run dev".');
    }
  }
});

new WebSocketServer({ server, path: '/ws', maxPayload: MAX_PAYLOAD }).on('connection', ws => {
  const c: Client = { ws, cid: '', name: 'Player', id: 0, lastSeen: Date.now(), budget: INTENTS_PER_SEC };
  clients.add(c);
  ws.on('message', raw => {
    try {
      const m = JSON.parse(String(raw));
      if (typeof m?.t === 'string') handle(c, m);
    } catch { /* ignore malformed */ }
  });
  ws.on('close', () => { clients.delete(c); leave(c); });
});

server.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
