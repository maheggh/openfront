import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { botName, ClientMsg, GameConfig, Intent, ServerMsg, TICK_MS } from '../core/types';

interface Client { ws: WebSocket; cid: string; name: string; id: number; room?: Room }
interface Room {
  code: string; isPublic: boolean; clients: Client[]; host?: Client; bots: number; startAt: number; started: boolean;
  config?: GameConfig; intents: Intent[]; turns: Intent[][]; members: Map<string, number>; hashes: Map<number, number>;
  emptySince: number; timer?: ReturnType<typeof setInterval>;
}

const PORT = Number(process.env.PORT ?? 3001);
const DIST = join(process.cwd(), 'dist');
const PUBLIC_WAIT_MS = 30000, MAX_HUMANS = 12, EMPTY_GRACE_MS = 60000;
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const rooms = new Map<string, Room>();

const send = (c: Client, m: ServerMsg) => { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m)); };

function newRoom(isPublic: boolean, bots: number) {
  let code = '';
  do code = Math.random().toString(36).slice(2, 7).toUpperCase(); while (rooms.has(code));
  const r: Room = { code, isPublic, clients: [], bots, startAt: 0, started: false, intents: [], turns: [], members: new Map(), hashes: new Map(), emptySince: 0 };
  rooms.set(code, r);
  return r;
}

const publicRoom = () => [...rooms.values()].find(r => r.isPublic && !r.started) ?? newRoom(true, 16);

function lobbyUpdate(r: Room) {
  const players = r.clients.map(c => c.name);
  const startsIn = r.isPublic ? Math.max(0, Math.ceil((r.startAt - Date.now()) / 1000)) : null;
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
  r.timer = setInterval(() => {
    if (r.clients.length) r.emptySince = 0;
    else if (!r.emptySince) r.emptySince = Date.now();
    else if (Date.now() - r.emptySince > EMPTY_GRACE_MS) { clearInterval(r.timer); rooms.delete(r.code); return; }
    r.turns.push(r.intents);
    const msg = JSON.stringify({ t: 'turn', intents: r.intents });
    r.intents = [];
    for (const c of r.clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(msg);
  }, TICK_MS);
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
  if (!r?.started) return;
  const h = r.hashes.get(tick);
  if (h === undefined) {
    r.hashes.set(tick, hash);
    if (r.hashes.size > 50) r.hashes.delete(r.hashes.keys().next().value!);
  } else if (h !== hash) {
    console.warn(`[${r.code}] desync at tick ${tick}: player ${c.id} (${c.name}) disagrees`);
    send(c, { t: 'desync', tick });
  }
}

function handle(c: Client, m: ClientMsg) {
  switch (m.t) {
    case 'hello':
      c.cid = String(m.cid).slice(0, 40);
      return rejoin(c);
    case 'list': {
      publicRoom();
      const lobbies = [...rooms.values()].filter(r => r.isPublic && !r.started)
        .map(r => ({ id: r.code, players: r.clients.length, startsIn: r.startAt ? Math.max(0, Math.ceil((r.startAt - Date.now()) / 1000)) : 0 }));
      return send(c, { t: 'lobbies', lobbies });
    }
    case 'joinPublic': {
      const r = rooms.get(m.id ?? '');
      return join(c, r && r.isPublic && !r.started ? r : publicRoom(), m.name);
    }
    case 'create':
      return join(c, newRoom(false, Math.min(40, Math.max(0, Math.floor(Number(m.bots) || 0)))), m.name);
    case 'joinCode': {
      const r = rooms.get(String(m.code).trim().toUpperCase());
      if (!r || r.started) return send(c, { t: 'error', msg: 'Game not found' });
      return join(c, r, m.name);
    }
    case 'start':
      if (c.room && c.room.host === c && !c.room.started) start(c.room);
      return;
    case 'intent':
      if (c.room?.started && c.id && typeof m.intent?.type === 'string') c.room.intents.push({ ...m.intent, p: c.id } as Intent);
      return;
    case 'hash':
      return checkHash(c, Number(m.tick), Number(m.hash));
  }
}

setInterval(() => {
  for (const r of rooms.values()) {
    if (r.started || !r.isPublic || !r.clients.length) continue;
    if (Date.now() >= r.startAt) start(r);
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

new WebSocketServer({ server, path: '/ws' }).on('connection', ws => {
  const c: Client = { ws, cid: '', name: 'Player', id: 0 };
  ws.on('message', raw => {
    try { handle(c, JSON.parse(String(raw))); } catch { /* ignore malformed */ }
  });
  ws.on('close', () => leave(c));
});

server.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
